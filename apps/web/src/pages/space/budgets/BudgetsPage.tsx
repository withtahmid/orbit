import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
    Mail,
    ChevronLeft,
    ChevronRight,
    MoreHorizontal,
    Pencil,
    Plus,
    Search,
    Trash2,
    Filter as FilterIcon,
    ChevronDown,
    Check,
    ArrowRightLeft,
    Coins,
    Archive,
    ArchiveRestore,
    AlertTriangle,
    NotebookPen,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PermissionGate } from "@/components/shared/PermissionGate";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ColorPickerButton } from "@/components/shared/ColorPicker";
import { IconPickerButton } from "@/components/shared/IconPicker";
import { OrbitModalShell, OrbitField } from "@/components/orbit/OrbitModalShell";
import {
    OrbitFormStyles,
    OrbitInput,
    OrbitSelect,
    OrbitTextarea,
    OrbitFieldRow,
} from "@/components/orbit/OrbitForm";
import { getIcon } from "@/lib/entityIcons";
import { compactMoney } from "@/lib/chartBucket";
import { EnvelopeAllocateDialog } from "@/features/allocations/EnvelopeAllocateDialog";
import { EnvelopeMoveDialog } from "@/features/allocations/EnvelopeMoveDialog";
import { EnvelopeTopUpDialog } from "@/features/allocations/EnvelopeTopUpDialog";
import { trpc } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { ROUTES } from "@/router/routes";
import { DEFAULT_COLOR } from "@/lib/entityStyle";
import {
    addMonthsClamped,
    startOfMonth,
    endOfMonth,
    makeAppTzDate,
    getAppTzYear,
    getAppTzMonth,
    getAppTzDate,
} from "@/lib/dates";
import { formatInAppTz } from "@/lib/formatDate";
import { EnvelopeTargetDatePicker } from "./EnvelopeTargetDatePicker";
import { EnvelopeGlass } from "@/components/budget-gauge/EnvelopeGlass";
import type { RouterOutput } from "@/trpc";

type Cadence = "none" | "monthly";
type EnvelopeRow = RouterOutput["analytics"]["envelopeUtilization"][number];
type SortMode = "cadence" | "urgency" | "remaining" | "spent" | "name" | "deadline" | "progress";

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
    { value: "cadence", label: "Cadence" },
    { value: "urgency", label: "Urgency" },
    { value: "spent", label: "Spent" },
    { value: "remaining", label: "Remaining" },
    { value: "deadline", label: "Deadline" },
    { value: "progress", label: "Progress" },
    { value: "name", label: "Name" },
];

const money0 = (n: number) => Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

function pctOf(consumed: number, allocated: number): number {
    if (allocated > 0) return (consumed / allocated) * 100;
    if (consumed > 0) return Infinity;
    return 0;
}

/** Overspend label kept legible at both extremes: a sub-1% overspend reads
 * "<1%" (instead of a misleading "0%"), and once the percentage stops being
 * meaningful (≥10× over) it switches to a multiple ("12× over budget"). */
function overBudgetLabel(consumed: number, total: number): string {
    const r = (consumed - total) / total;
    if (r < 0.01) return "<1% over budget";
    const pct = Math.round(r * 100);
    // Gate the ×-switch on the rounded percent (not the raw ratio) so the
    // %-branch can never print an unwieldy "1000% over budget".
    if (pct >= 1000) return `${Math.round(r)}× over budget`;
    return `${pct}% over budget`;
}

/** Concise spoken summary of an envelope's gauge for screen readers. The card
 * is a navigable <Link>, so without this a reader would announce the raw
 * concatenation of every figure on the card; this gives the gauge's value as a
 * single sentence (the accessible-value standard for a performance gauge). */
function envelopeAriaLabel(env: EnvelopeRow): string {
    const fmt = (n: number) =>
        Math.abs(n).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    const total = env.allocated;
    const isGoal = env.targetAmount != null && env.targetAmount > 0;
    if (isGoal) {
        const saved = env.lifetimeFunded ?? 0;
        const target = env.targetAmount ?? 0;
        const pct = Math.round(Math.min(1, saved / target) * 100);
        return saved > target
            ? `${env.name} goal: ${fmt(saved)} saved, over-funded past a ${fmt(target)} target`
            : `${env.name} goal: ${fmt(saved)} saved of a ${fmt(target)} target, ${pct}% complete`;
    }
    if (env.consumed > total) {
        const over = env.consumed - total;
        const pct = Math.round((over / total) * 100);
        // Match the visible label: never announce a misleading "0%" for a
        // sub-1% overspend.
        const pctStr = pct < 1 ? "<1%" : `${pct}%`;
        return total > 0
            ? `${env.name}: ${fmt(over)} (${pctStr}) over a ${fmt(total)} budget`
            : `${env.name}: ${fmt(env.consumed)} spent with no budget set`;
    }
    return total > 0
        ? `${env.name}: ${fmt(total - env.consumed)} left of a ${fmt(total)} budget`
        : `${env.name}: no budget set`;
}

function sortEnvelopes(list: EnvelopeRow[], mode: SortMode): EnvelopeRow[] {
    const arr = [...list];
    if (mode === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (mode === "spent") arr.sort((a, b) => b.consumed - a.consumed);
    else if (mode === "remaining") arr.sort((a, b) => b.remaining - a.remaining);
    else if (mode === "urgency")
        arr.sort((a, b) => pctOf(b.consumed, b.allocated) - pctOf(a.consumed, a.allocated));
    else if (mode === "deadline")
        // Earliest target_date first; rows without a deadline drop to
        // the end so goal envelopes with an upcoming target lead.
        arr.sort((a, b) => {
            const aDate = a.targetDate ? new Date(a.targetDate).getTime() : Infinity;
            const bDate = b.targetDate ? new Date(b.targetDate).getTime() : Infinity;
            return aDate - bDate;
        });
    else if (mode === "progress")
        // Highest pctComplete (== pctSaved) first; rows without a target
        // are treated as 0 so plain envelopes sink below goals.
        arr.sort((a, b) => (b.pctComplete ?? 0) - (a.pctComplete ?? 0));
    else {
        // Default "cadence" sort, three tiers so the flat grid reads as
        // contiguous bands without a grouped view: monthly budgets first,
        // then rolling envelopes, then goals (gold cards) clustered last.
        // Within each tier, preserve the server's natural order (created_at
        // ASC) — Array.sort is spec-stable (ES2019+), so equal tiers keep
        // input order and editing a name never relocates a row.
        const tier = (e: EnvelopeRow) =>
            e.cadence === "monthly" ? 0 : e.targetAmount != null && e.targetAmount > 0 ? 2 : 1;
        arr.sort((a, b) => tier(a) - tier(b));
    }
    return arr;
}

export default function BudgetsPage() {
    const { space } = useCurrentSpace();
    const [monthOffset, setMonthOffset] = useState(0);
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<SortMode>("cadence");
    const debouncedQuery = useDebouncedValue(query, 200);

    const now = useMemo(() => new Date(), []);
    // Clamped: plain addMonths lets Jul 31 − 1mo overflow to Jul 1, which
    // makes the ‹ stepper appear to do nothing on month-end days.
    const viewingDate = useMemo(() => addMonthsClamped(now, monthOffset), [now, monthOffset]);
    const periodStart = useMemo(() => startOfMonth(viewingDate), [viewingDate]);
    const periodEnd = useMemo(() => endOfMonth(viewingDate), [viewingDate]);

    const utilizationQuery = trpc.analytics.envelopeUtilization.useQuery({
        spaceId: space.id,
        periodStart,
        periodEnd,
    });

    const summaryQuery = trpc.analytics.spaceSummary.useQuery({
        spaceId: space.id,
        periodStart,
        periodEnd,
    });

    const allEnvelopes = useMemo(() => utilizationQuery.data ?? [], [utilizationQuery.data]);

    // Active envelopes drive the main list, hero stats, and "needs attention".
    // Archived envelopes are revealed via the toggle below; they have no
    // current activity (server blocks new transactions/allocations) so
    // including them in totals would just be misleading zeros.
    const envelopes = useMemo(() => allEnvelopes.filter((e) => !e.archived), [allEnvelopes]);
    const archivedEnvelopes = useMemo(() => allEnvelopes.filter((e) => e.archived), [allEnvelopes]);
    const [showArchived, setShowArchived] = useState(false);

    const filtered = useMemo(() => {
        if (!debouncedQuery.trim()) return envelopes;
        const q = debouncedQuery.trim().toLowerCase();
        return envelopes.filter(
            (e) =>
                e.name.toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q)
        );
    }, [envelopes, debouncedQuery]);

    const sorted = useMemo(() => sortEnvelopes(filtered, sort), [filtered, sort]);

    const totals = useMemo(() => {
        const allocated = envelopes.reduce((s, e) => s + e.allocated, 0);
        const consumed = envelopes.reduce((s, e) => s + e.consumed, 0);
        const remaining = envelopes.reduce((s, e) => s + e.remaining, 0);
        // Zero-budget envelopes are "spent · no budget" on their cards, not
        // "over budget" — keep this sum aligned with overCount so the sub
        // never reads "−X over in 0 envelopes".
        const overAmount = envelopes.reduce(
            (s, e) => s + (e.allocated > 0 ? Math.max(0, e.consumed - e.allocated) : 0),
            0
        );
        const overCount = envelopes.filter(
            (e) => e.consumed > e.allocated && e.allocated > 0
        ).length;
        return { allocated, consumed, remaining, overAmount, overCount };
    }, [envelopes]);

    // ── Space-level pace analytics (fills the dead space below the grid) ──
    // Same anchor trick as the envelope detail page: current month anchors
    // at `now` (mid-month "today" marker), a past month anchors at its last
    // instant so the whole completed month renders.
    const anchor = useMemo(
        () => (monthOffset === 0 ? now : new Date(periodEnd.getTime() - 1)),
        [monthOffset, now, periodEnd]
    );
    // Scope the daily series to the active envelopes so the chart's
    // cumulative "spent" agrees with the summary strip's Spent (which sums
    // envelope consumption) — unscoped, it would also count spend that was
    // never assigned to an envelope.
    const activeEnvelopeIds = useMemo(() => envelopes.map((e) => e.envelopId), [envelopes]);
    const dailyQuery = trpc.analytics.trends.dailyComparison.useQuery(
        {
            spaceId: space.id,
            granularity: "month",
            anchor,
            mode: "operational",
            envelopeIds: activeEnvelopeIds,
        },
        { enabled: envelopes.length > 0 }
    );
    const paceData = useMemo(() => {
        const daily = dailyQuery.data;
        if (!daily) return null;
        const pl = daily.periodLength;
        const today = Math.min(daily.today, pl);
        const cur: number[] = [];
        const prv: number[] = [];
        const avg: number[] | null = daily.average ? [] : null;
        let ca = 0,
            pa = 0,
            aa = 0;
        const len = Math.max(pl, daily.previous.length);
        for (let i = 0; i < len; i++) {
            ca += daily.current[i] ?? 0;
            pa += daily.previous[i] ?? 0;
            cur.push(ca);
            prv.push(pa);
            if (avg && daily.average) {
                aa += daily.average[i] ?? 0;
                avg.push(aa);
            }
        }
        const spentToDate = cur[today - 1] ?? 0;
        const projected = today > 0 ? (spentToDate / today) * pl : 0;
        return {
            cur,
            prv,
            avg,
            today,
            pl,
            projected,
            spentToDate,
            bucketUnit: daily.bucketUnit,
        };
    }, [dailyQuery.data]);

    // Coaching KPIs (last month / 3-mo avg) for the at-a-glance tiles —
    // same procedure the detail page uses, referenced to the viewed month
    // so "last month" stays relative to the stepper.
    const averagesQuery = trpc.analytics.envelopeRecentAverages.useQuery(
        { spaceId: space.id, referenceDate: periodStart },
        { enabled: envelopes.length > 0 }
    );

    // APP_TZ, not browser-local — keeps the label in lockstep with the
    // "Plan this month" link's yyyy-MM slug at month boundaries.
    const monthLabel = formatInAppTz(viewingDate, "MMMM yyyy");
    const daysLeft =
        monthOffset === 0
            ? Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / 86_400_000))
            : null;

    // At-a-glance tiles — the detail hero's 3x2 KPI grid, aggregated to
    // space level (sums across active envelopes). Same tile set, same
    // isPast swaps, same two-tier pace severity as the detail page.
    const glanceTiles = useMemo(() => {
        const isPast = monthOffset < 0;
        const activeIds = new Set(envelopes.map((e) => e.envelopId));
        const av = averagesQuery.data?.filter((a) => activeIds.has(a.envelopId));
        const lastSpend = av ? av.reduce((s, a) => s + a.lastMonthSpend, 0) : null;
        const lastPlanned = av ? av.reduce((s, a) => s + a.lastMonthPlanned, 0) : null;
        const avg3 = av ? av.reduce((s, a) => s + a.avg3MonthSpend, 0) : null;
        const spent = totals.consumed;
        const alloc = totals.allocated;
        const today = paceData?.today ?? null;
        const pl = paceData?.pl ?? null;
        const dailyBurn =
            paceData && paceData.today > 0 ? paceData.spentToDate / paceData.today : null;
        const projEnd = paceData?.projected ?? null;
        const pctBudget = alloc > 0 ? Math.round((spent / alloc) * 100) : null;
        const paceNow =
            !isPast && alloc > 0 && today != null && today > 0 && pl != null && pl > 0
                ? (alloc * today) / pl
                : null;
        const paceDiff = paceNow != null ? spent - paceNow : null;
        const paceUnder = paceDiff != null && paceDiff <= 0;
        const overBudget = alloc > 0 && spent > alloc;
        return [
            {
                label: "Last month",
                val: lastSpend != null ? money0(lastSpend) : "—",
                sub:
                    lastSpend != null && lastPlanned != null && lastPlanned > 0
                        ? `${Math.round((lastSpend / lastPlanned) * 100)}% of plan`
                        : "spent",
            },
            {
                label: "3-month avg",
                val: avg3 != null ? money0(avg3) : "—",
                sub: "per month",
            },
            {
                label: "Daily burn",
                val: dailyBurn != null ? money0(dailyBurn) : "—",
                sub: isPast ? "avg per day" : "avg per day this month",
            },
            isPast
                ? {
                      // "allocated", not "budget/plan" — same noun the
                      // current-month Spent sub and the cards use.
                      label: "% of allocated",
                      val: pctBudget != null ? `${pctBudget}%` : "—",
                      sub: alloc > 0 ? "spent" : "no budget set",
                      color: overBudget ? "var(--expense)" : undefined,
                  }
                : {
                      label: "Projected end",
                      val: projEnd != null ? money0(projEnd) : "—",
                      sub: "at current pace",
                      color:
                          projEnd != null && alloc > 0
                              ? projEnd > alloc
                                  ? "var(--expense)"
                                  : "var(--income)"
                              : undefined,
                  },
            isPast
                ? {
                      label: overBudget ? "Over by" : "Left over",
                      val: alloc > 0 ? money0(Math.abs(alloc - spent)) : "—",
                      sub: "vs allocated",
                      color: overBudget ? "var(--expense)" : "var(--income)",
                  }
                : {
                      label: "Days left",
                      val: daysLeft != null ? String(daysLeft) : "—",
                      sub: "this month",
                  },
            paceDiff != null
                ? {
                      label: "Pace today",
                      val: money0(Math.abs(paceDiff)),
                      sub: paceUnder ? "under pace" : "over pace",
                      color: paceUnder
                          ? "var(--income)"
                          : overBudget
                            ? "var(--expense)"
                            : "var(--warn)",
                  }
                : {
                      // Past tense on completed months; and while the daily
                      // series is still loading, don't claim "no budget set"
                      // when one exists.
                      label: isPast ? "Pace" : "Pace today",
                      val: "—",
                      sub: isPast
                          ? "month completed"
                          : alloc > 0
                            ? "checking pace…"
                            : "no budget set",
                  },
        ];
    }, [envelopes, averagesQuery.data, totals, paceData, monthOffset, daysLeft]);

    // Mid-month gentle nudge. After day 21 of the current month, surface a
    // one-time toast for each envelope that's already > 80% spent. Tracked
    // via localStorage so we don't spam — once per envelope per month.
    // Overspend is never blocked — this is just a soft heads-up.
    useEffect(() => {
        if (monthOffset !== 0) return;
        const today = new Date();
        if (getAppTzDate(today) < 21) return;
        const monthKey = `${getAppTzYear(today)}-${getAppTzMonth(today) + 1}`;
        const storageKey = `orbit:nudge:${space.id}:${monthKey}`;
        let dismissed: string[] = [];
        try {
            dismissed = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
        } catch {
            dismissed = [];
        }
        for (const e of envelopes) {
            if (e.cadence !== "monthly") continue;
            const total = e.allocated;
            if (total <= 0) continue;
            const ratio = e.consumed / total;
            if (ratio < 0.8 || ratio > 1.5) continue;
            if (dismissed.includes(e.envelopId)) continue;
            const pct = Math.round(ratio * 100);
            toast.message(`${e.name} is ${pct}% spent`, {
                description: `${daysLeft} day${daysLeft === 1 ? "" : "s"} left this month. Pull from another envelope, or just stay aware.`,
                duration: 8000,
            });
            dismissed.push(e.envelopId);
        }
        try {
            localStorage.setItem(storageKey, JSON.stringify(dismissed));
        } catch {
            // localStorage might be disabled (private mode) — fail silently.
        }
        // We intentionally exclude `daysLeft` from the dep array — the
        // effect should fire when the envelope set materializes, not on
        // every minute as `now` shifts. envelopes is the meaningful trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [envelopes, monthOffset, space.id]);

    return (
        <div className="orbit-design env-root">
            <style>{ENV_STYLES}</style>

            {/* Topbar */}
            <header className="env-topbar">
                <div className="env-topbar-text">
                    {/* Period context lives in the summary strip's month nav
                        below — don't duplicate the month/days-left here. */}
                    <h1 className="display env-title">Budgets</h1>
                </div>
                <div className="env-topbar-actions">
                    {/* Persistent entry to the month planning page — the
                        start-of-month ritual is a routine action with a
                        stable home here, not just the CTA inside the
                        over-budgeted warning banner (which stays as a
                        contextual nudge). Month-stepper aware: viewing a
                        past month links to that month's review. */}
                    <Link
                        to={ROUTES.spaceBudgetMonth(
                            space.id,
                            formatInAppTz(viewingDate, "yyyy-MM")
                        )}
                        className="od-btn"
                    >
                        <NotebookPen className="size-3.5" />
                        {monthOffset === 0
                            ? "Plan this month"
                            : `Review ${formatInAppTz(viewingDate, "MMM")}`}
                    </Link>
                    <SortPicker sort={sort} setSort={setSort} />
                    <PermissionGate roles={["owner"]}>
                        <CreateOrEditEnvelopeDialog
                            trigger={
                                <button type="button" className="od-btn od-btn-primary">
                                    <Plus className="size-3.5" /> New envelope
                                </button>
                            }
                        />
                    </PermissionGate>
                </div>
            </header>

            <div className="env-scroll">
                {/* Summary strip — month nav, period totals, unbudgeted. The
                    envelope cards below carry their own over / running-low
                    state, so there's no separate attention or priority surface. */}
                <div className="od-card env-summary">
                    <div className="env-summary-main">
                        <div className="env-summary-left">
                            <div className="env-month-nav">
                                <button
                                    type="button"
                                    className="env-hero-arrow"
                                    onClick={() => setMonthOffset((m) => m - 1)}
                                    aria-label="Previous month"
                                >
                                    <ChevronLeft className="size-3.5" />
                                </button>
                                <span className="env-month-label">{monthLabel}</span>
                                <button
                                    type="button"
                                    className="env-hero-arrow"
                                    onClick={() => setMonthOffset((m) => m + 1)}
                                    disabled={monthOffset >= 0}
                                    aria-label="Next month"
                                >
                                    <ChevronRight className="size-3.5" />
                                </button>
                                {/* Days-left lives in the "Days left" glance
                                    tile on the right — don't repeat it here. */}
                            </div>
                            {/* First-run: no envelopes means three hollow
                                0.00s — lead with the empty state + banner
                                CTA below instead. */}
                            {(envelopes.length > 0 || utilizationQuery.isLoading) && (
                                <div className="env-summary-stats">
                                    <HeroStat
                                        label="Allocated"
                                        amount={totals.allocated}
                                        size={34}
                                        sub={`${envelopes.length} envelope${envelopes.length === 1 ? "" : "s"}`}
                                    />
                                    <span className="env-summary-divider" />
                                    <HeroStat
                                        label="Spent"
                                        amount={totals.consumed}
                                        tone="brand"
                                        size={34}
                                        sub={
                                            // Past months already carry this
                                            // number in the "% of budget"
                                            // tile — don't say it twice.
                                            monthOffset === 0 && totals.allocated > 0
                                                ? `${((totals.consumed / totals.allocated) * 100).toFixed(0)}% of allocated`
                                                : ""
                                        }
                                    />
                                    <span className="env-summary-divider" />
                                    <HeroStat
                                        label="Remaining"
                                        amount={totals.remaining}
                                        tone="gold"
                                        size={34}
                                        sub={
                                            totals.overAmount > 0 ? (
                                                <span style={{ color: "var(--expense)" }}>
                                                    −
                                                    <Money
                                                        amount={totals.overAmount}
                                                        size={11}
                                                        variant="expense"
                                                    />{" "}
                                                    over in {totals.overCount} envelope
                                                    {totals.overCount === 1 ? "" : "s"}
                                                </span>
                                            ) : monthOffset === 0 ? (
                                                // Neutral — the pace tiles own
                                                // the forward-looking verdict.
                                                "left this month"
                                            ) : (
                                                "left unspent"
                                            )
                                        }
                                    />
                                </div>
                            )}
                        </div>
                        {/* At-a-glance facts — the detail hero's KPI grid,
                            aggregated across active envelopes, in the same
                            top-right position as the detail page. Also
                            rendered (as em-dashes) while utilization loads,
                            so the summary card doesn't grow when data
                            lands. */}
                        {(envelopes.length > 0 || utilizationQuery.isLoading) && (
                            <div className="env-facts env-summary-facts">
                                {glanceTiles.map((t) => (
                                    <div key={t.label} className="env-fact">
                                        <span className="env-fact-label">{t.label}</span>
                                        <span
                                            className="env-fact-val tabular"
                                            style={{
                                                color:
                                                    "color" in t && t.color ? t.color : "var(--fg)",
                                            }}
                                        >
                                            {t.val}
                                        </span>
                                        <span className="env-fact-sub">{t.sub}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    {/* Distribution bar — every envelope's *remaining* (left)
                        balance as a colored segment against the "cash you have"
                        tick. Segments show held cash, not the original plan:
                        spent money has already left the envelope, so drawing
                        `allocated` would overstate the bar and paint a false
                        over-allocation hatch whenever you'd spent anything.
                        (The month-plan page's sibling bar deliberately shows
                        the *plan* — each bar's caption names its quantity.)
                        Held sums over ALL envelopes — archived ones keep their
                        allocation rows and still tie up cash — with each
                        clamped at 0, matching the server's envelopeRemaining
                        (GREATEST(0, …)) that drives `unallocated`/
                        `isOverAllocated`. So the gap between the segments' end
                        and the cash tick *is* the banner's unbudgeted cash.
                        (It is NOT the REMAINING headline, which is active
                        envelopes only and unclamped.) Current month only —
                        "funded" means nothing for a past month's view. The bar
                        is aria-hidden: every number is already text in the
                        strip, caption, and banner. The gate spans ALL
                        envelopes for the same reason held does: a space whose
                        only current-month budget sits in archived envelopes
                        still has cash tied up, and the banner below reflects
                        it — hiding the bar there would drop the visual while
                        keeping the verdict. */}
                    {monthOffset === 0 &&
                        allEnvelopes.some((e) => e.allocated > 0) &&
                        (() => {
                            const funded = Math.max(0, summaryQuery.data?.spendableBalance ?? 0);
                            const held = allEnvelopes.reduce(
                                (s, e) => s + Math.max(0, e.remaining),
                                0
                            );
                            const scale = Math.max(funded, held, 1);
                            let acc = 0;
                            const segs = allEnvelopes
                                .map((e) => {
                                    const value = Math.max(0, e.remaining);
                                    const seg = {
                                        id: e.envelopId,
                                        left: (acc / scale) * 100,
                                        width: (value / scale) * 100,
                                        color: e.color,
                                        name: e.name,
                                        value,
                                        archived: e.archived,
                                    };
                                    acc += value;
                                    return seg;
                                })
                                .filter((s) => s.width > 0);
                            // Fully spent AND no spendable cash: nothing to
                            // draw — a bare empty track reads as a rendering
                            // bug, not as data.
                            if (segs.length === 0 && funded <= 0) return null;
                            // Same sub-cent epsilon as the server's
                            // isOverAllocated guard: two PG-rounded sums can
                            // differ by a residue, and a hairline hatch here
                            // would contradict the banner saying "balanced".
                            // No `funded > 0` gate: with zero/negative
                            // spendable cash and envelopes still holding
                            // budget, the whole bar hatches — agreeing with
                            // the banner's "over-budgeted" verdict.
                            const overHeld = held > funded + 0.005;
                            return (
                                <div className="env-dist">
                                    <div className="env-dist-bar" aria-hidden>
                                        {segs.map((s, i) => (
                                            <span
                                                key={s.id}
                                                className="env-dist-seg"
                                                style={{
                                                    left: `${s.left}%`,
                                                    width: `${s.width}%`,
                                                    background: s.color,
                                                    // Inline, not :last-child — the
                                                    // overlay/tick spans render after
                                                    // the segments in this parent.
                                                    ...(i === segs.length - 1 && {
                                                        borderTopRightRadius: 5,
                                                        borderBottomRightRadius: 5,
                                                        borderRight: "none",
                                                    }),
                                                }}
                                                // Archived envelopes still hold
                                                // cash (their allocation rows
                                                // stay put) but are hidden from
                                                // the default list below — the
                                                // suffix is the one channel that
                                                // identifies such a segment.
                                                title={`${s.name}: ${s.value.toLocaleString(
                                                    "en-US",
                                                    {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                    }
                                                )} left${s.archived ? " · archived" : ""}`}
                                            />
                                        ))}
                                        {overHeld && (
                                            <span
                                                className="env-dist-over"
                                                style={{
                                                    left: `${(funded / scale) * 100}%`,
                                                    width: `${((held - funded) / scale) * 100}%`,
                                                }}
                                            />
                                        )}
                                        {funded > 0 && (
                                            <span
                                                className="env-dist-tick"
                                                style={{
                                                    left: `${(funded / scale) * 100}%`,
                                                }}
                                                title={`Cash you have: ${funded.toLocaleString(
                                                    "en-US",
                                                    {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                    }
                                                )}`}
                                            />
                                        )}
                                    </div>
                                    {/* One caption line — names the quantity so
                                        this bar can't be misread as the month
                                        page's plan bar. A legend, not a number:
                                        the figures live in the strip/banner. */}
                                    <div className="env-dist-caption">
                                        <span>Each segment is cash still in its envelope</span>
                                        {funded > 0 && (
                                            <span className="env-dist-caption-tick">
                                                <i aria-hidden /> cash you have (
                                                {compactMoney(funded)})
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
                    {/* Unbudgeted is only meaningful for the current month.
                        `spaceSummary.unallocated` now honors the requested
                        window server-side, but it subtracts the viewed month's
                        held from *current* spendable cash — for a past/future
                        month that mixes today's cash with another month's plan,
                        a hypothetical rather than a real balance. So we gate the
                        banner to the current month; do not relax this. */}
                    {summaryQuery.data && monthOffset === 0 && (
                        <UnbudgetedBanner
                            unallocated={summaryQuery.data.unallocated}
                            isOverAllocated={summaryQuery.data.isOverAllocated}
                            spaceId={space.id}
                            viewingDate={viewingDate}
                        />
                    )}
                </div>

                {/* Search */}
                <div className="env-toolbar">
                    <label className="env-search">
                        <Search className="size-3.5" style={{ color: "var(--fg-4)" }} />
                        <input
                            className="od-input env-search-input"
                            placeholder="Search envelopes…"
                            aria-label="Search envelopes"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </label>
                </div>

                {/* Content */}
                {utilizationQuery.isLoading ? (
                    <div className="env-grid">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                            <Skeleton key={i} height={160} />
                        ))}
                    </div>
                ) : envelopes.length === 0 ? (
                    <div className="od-card env-empty">
                        <Mail className="size-6" style={{ color: "var(--fg-4)" }} />
                        <div
                            style={{
                                fontSize: 14,
                                color: "var(--fg-2)",
                                fontWeight: 500,
                            }}
                        >
                            No budgets yet
                        </div>
                        <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>
                            Create an envelope for monthly spending, or a goal for long-term saving.
                        </div>
                        <PermissionGate roles={["owner"]}>
                            <CreateOrEditEnvelopeDialog
                                trigger={
                                    <button className="od-btn od-btn-primary">
                                        <Plus className="size-3.5" /> New envelope
                                    </button>
                                }
                            />
                        </PermissionGate>
                    </div>
                ) : sorted.length === 0 ? (
                    <div
                        className="od-card"
                        style={{
                            padding: 40,
                            textAlign: "center",
                            color: "var(--fg-3)",
                        }}
                    >
                        No envelopes match &ldquo;{debouncedQuery}&rdquo;.
                    </div>
                ) : (
                    <div className="env-grid">
                        {sorted.map((e) => (
                            <EnvelopeCard
                                key={e.envelopId}
                                env={e}
                                spaceId={space.id}
                                pace={
                                    monthOffset === 0 && paceData && paceData.today > 0
                                        ? { today: paceData.today, pl: paceData.pl }
                                        : null
                                }
                            />
                        ))}
                    </div>
                )}

                {archivedEnvelopes.length > 0 && (
                    <div className="env-archived-section">
                        <button
                            type="button"
                            className="env-archived-toggle"
                            onClick={() => setShowArchived((v) => !v)}
                        >
                            {showArchived ? "Hide" : "Show"} archived
                            <span className="env-archived-count">{archivedEnvelopes.length}</span>
                            <ChevronDown
                                className="size-3"
                                style={{
                                    transform: showArchived ? "rotate(180deg)" : "none",
                                    transition: "transform 140ms ease",
                                }}
                            />
                        </button>
                        {showArchived && (
                            <div className="env-grid env-archived-grid">
                                {archivedEnvelopes.map((e) => (
                                    <EnvelopeCard key={e.envelopId} env={e} spaceId={space.id} />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/* ============================================================
   Card / row renderers
   ============================================================ */

function EnvelopeCard({
    env,
    spaceId,
    pace,
}: {
    env: EnvelopeRow;
    spaceId: string;
    /** Current-month elapsed time (day-of-month / period length) — lets the
     *  card judge spend against the calendar instead of a time-blind 80%
     *  threshold. Null for past months and archived envelopes. */
    pace?: { today: number; pl: number } | null;
}) {
    // Period-scoped pool: what's available to spend this period.
    const total = env.allocated;
    const remaining = total - env.consumed;
    const drift = env.consumed > total;
    // A target of exactly 0 is not a goal — treat it like a plain envelope so
    // the gauge and the "over-funded" copy stay consistent.
    const isGoal = env.targetAmount != null && env.targetAmount > 0;
    // Pace-aware warning: projected to overrun at the current run-rate —
    // the same math as the "By envelope" list's ⚠ flag, so card and list
    // always agree. Falls back to the static ≥80%-spent heuristic when no
    // pace context is available (past months, data still loading). Paired
    // with a textual cue below so the amber glass isn't a colour-only signal.
    const projectedOver =
        pace != null &&
        !isGoal &&
        !drift &&
        total > 0 &&
        pace.today > 0 &&
        (env.consumed / pace.today) * pace.pl > total;
    const low =
        !isGoal &&
        !drift &&
        total > 0 &&
        (pace != null ? projectedOver : env.consumed / total >= 0.8);
    const goalSaved = env.lifetimeFunded ?? 0;
    const goalPct =
        isGoal && env.targetAmount && env.targetAmount > 0
            ? Math.max(0, Math.min(1, goalSaved / env.targetAmount))
            : 0;
    const targetDate = env.targetDate ? new Date(env.targetDate) : null;

    return (
        <Link
            to={ROUTES.spaceBudgetDetail(spaceId, env.envelopId)}
            aria-label={envelopeAriaLabel(env)}
            className={`od-card env-card${isGoal ? " env-card-goal" : ""}${env.archived ? " env-card-archived" : ""}${drift && !isGoal ? " env-card-over" : ""}`}
        >
            <div className="env-card-head">
                <span className="env-card-name">
                    <EntityAvatar icon={env.icon} colorVar={env.color} size={32} />
                    <span className="env-card-text">
                        <span className="env-card-title" title={env.name}>
                            {env.name}
                            {env.archived && <span className="env-archived-pill">Archived</span>}
                        </span>
                        <span className="env-card-cadence">
                            <span>
                                {isGoal
                                    ? "Goal"
                                    : env.cadence === "monthly"
                                      ? "Monthly"
                                      : "Rolling"}
                            </span>
                            {isGoal && targetDate && (
                                <>
                                    <span aria-hidden>·</span>
                                    <span style={{ color: "var(--fg-3)" }}>
                                        by {formatInAppTz(targetDate, "MMM yyyy")}
                                    </span>
                                </>
                            )}
                            {/* Only the no-pace-context fallback lives up
                                here — when pace is known, the footer's
                                "91% left · over pace" already carries the
                                verdict, and saying it twice on one small
                                card is noise. */}
                            {low && pace == null && (
                                <>
                                    <span aria-hidden>·</span>
                                    <span style={{ color: "var(--warn)" }}>running low</span>
                                </>
                            )}
                            {(env.lifetimeOverrun ?? 0) > 0 && (
                                <>
                                    <span aria-hidden>·</span>
                                    {/* Lifetime overrun on a rolling envelope. */}
                                    <span
                                        style={{ color: "var(--expense)" }}
                                        title={`This rolling envelope has spent ${(env.lifetimeOverrun ?? 0).toFixed(2)} more than allocated across all time.`}
                                        aria-label={`Net overspent across all time by ${(env.lifetimeOverrun ?? 0).toFixed(2)}`}
                                    >
                                        net overspent (lifetime){" "}
                                        <Money
                                            amount={env.lifetimeOverrun ?? 0}
                                            size={11}
                                            variant="expense"
                                        />
                                    </span>
                                </>
                            )}
                        </span>
                    </span>
                </span>
                <EnvelopeMenu env={env} />
            </div>

            {/* The gauge: a fluid glass of money, centered as the card's hero.
                Cards are narrow (the grid packs several per row) so the bottle
                fills the card instead of stranding it in empty space. */}
            <div className="env-card-glass-wrap">
                <EnvelopeGlass
                    variant={isGoal ? "save" : "spend"}
                    current={isGoal ? goalSaved : env.consumed}
                    total={isGoal ? (env.targetAmount ?? 0) : total}
                    height={132}
                    color={env.color}
                />
            </div>

            {isGoal ? (
                <>
                    <div className="env-card-hero env-card-hero-center">
                        <span className="env-card-hero-amt">
                            <Money amount={goalSaved} size={24} weight={600} variant="neutral" />
                        </span>
                        <span className="env-card-hero-label">
                            saved of{" "}
                            <Money amount={env.targetAmount ?? 0} variant="muted" size={11} />
                        </span>
                    </div>
                    <div className="env-card-foot">
                        {goalSaved > (env.targetAmount ?? 0) ? (
                            <span
                                style={{
                                    color: "var(--gold)",
                                    fontWeight: 500,
                                }}
                            >
                                Over-funded by{" "}
                                <Money amount={goalSaved - (env.targetAmount ?? 0)} size={11} />
                            </span>
                        ) : (
                            <span style={{ color: "var(--fg-3)" }}>
                                {`${Math.round(goalPct * 100)}% complete`}
                            </span>
                        )}
                        {env.consumed > 0 && (
                            <span style={{ color: "var(--fg-3)" }}>
                                spent <Money amount={env.consumed} size={11} variant="muted" />
                            </span>
                        )}
                    </div>
                </>
            ) : (
                <>
                    {/* Hero: what's left this period. When overspent we show a
                        SIGNED negative figure ("−2,029.77") in the expense color
                        and label it "over" — never a bare positive number. */}
                    <div className="env-card-hero env-card-hero-center">
                        <span className="env-card-hero-amt">
                            <Money
                                amount={remaining}
                                size={26}
                                weight={600}
                                variant={drift ? "expense" : "neutral"}
                            />
                        </span>
                        <span
                            className="env-card-hero-label"
                            style={drift ? { color: "var(--expense)" } : undefined}
                        >
                            {/* Color alone can't carry overspend (invisible to
                                color-blind users) — pair it with an icon + word. */}
                            {drift && <AlertTriangle className="size-3" aria-hidden />}
                            {total > 0
                                ? drift
                                    ? overBudgetLabel(env.consumed, total)
                                    : "left"
                                : env.consumed > 0
                                  ? "spent · no budget"
                                  : "no budget"}
                        </span>
                    </div>
                    <div className="env-card-stats">
                        <div className="env-card-stat">
                            <span className="env-card-stat-label">Spent</span>
                            <Money
                                amount={env.consumed}
                                size={12}
                                weight={500}
                                variant={drift ? "expense" : "neutral"}
                            />
                        </div>
                        <div className="env-card-stat env-card-stat-end">
                            <span className="env-card-stat-label">Allocated</span>
                            <Money amount={total} size={12} weight={500} />
                        </div>
                    </div>
                    {/* Share of budget still in the glass, so the words agree
                        with the draining liquid — plus the pace verdict when
                        we know where we are in the month. Suppressed when
                        overspent (the hero already carries that state). */}
                    {!drift && total > 0 && (
                        <div className="env-card-foot env-card-foot-center">
                            <span style={{ color: "var(--fg-3)" }}>
                                {Math.min(100, Math.round((remaining / total) * 100))}% left
                                {pace != null && (
                                    <>
                                        {" · "}
                                        <span
                                            style={{
                                                color: projectedOver
                                                    ? "var(--warn)"
                                                    : "var(--fg-3)",
                                            }}
                                        >
                                            {projectedOver ? "over pace" : "on pace"}
                                        </span>
                                    </>
                                )}
                            </span>
                        </div>
                    )}
                </>
            )}
        </Link>
    );
}

function EnvelopeMenu({ env }: { env: EnvelopeRow }) {
    const [editOpen, setEditOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);
    const [topUpOpen, setTopUpOpen] = useState(false);
    return (
        // EnvelopeCard wraps everything in a <Link>, so we need to stop the
        // menu/dialog clicks from bubbling up and triggering navigation.
        // stopPropagation alone is enough — preventDefault would also cancel
        // browser defaults like `<label>` → input activation, which silently
        // kills label/radio/checkbox controls inside the edit modal (Radix
        // portals the dialog out of the DOM, but synthetic events still
        // bubble up through the React component tree).
        <span onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button type="button" className="env-card-menu" aria-label="More">
                        <MoreHorizontal className="size-3.5" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    {!env.archived && (
                        <PermissionGate roles={["owner", "editor"]}>
                            <EnvelopeAllocateDialog
                                envelopId={env.envelopId}
                                envelopCadence={env.cadence as Cadence}
                                direction="allocate"
                            />
                            <EnvelopeAllocateDialog
                                envelopId={env.envelopId}
                                envelopCadence={env.cadence as Cadence}
                                direction="deallocate"
                            />
                            <DropdownMenuItem
                                onSelect={(e) => {
                                    e.preventDefault();
                                    setTopUpOpen(true);
                                }}
                            >
                                <Coins className="size-3.5" /> Top up…
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={(e) => {
                                    e.preventDefault();
                                    setMoveOpen(true);
                                }}
                            >
                                <ArrowRightLeft className="size-3.5" /> Move to…
                            </DropdownMenuItem>
                        </PermissionGate>
                    )}
                    <PermissionGate roles={["owner"]}>
                        {!env.archived && (
                            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                                <Pencil className="size-3.5" /> Edit envelope
                            </DropdownMenuItem>
                        )}
                        <ArchiveEnvelopeMenuItem
                            envelopId={env.envelopId}
                            envelopName={env.name}
                            archived={env.archived}
                            currentRemaining={env.remaining}
                        />
                        {!env.archived && <DeleteEnvelopeMenuItem envelopId={env.envelopId} />}
                    </PermissionGate>
                </DropdownMenuContent>
            </DropdownMenu>
            <CreateOrEditEnvelopeDialog
                envelope={env}
                open={editOpen}
                onOpenChange={setEditOpen}
                hideDefaultTrigger
            />
            <EnvelopeMoveDialog
                sourceEnvelopId={env.envelopId}
                sourceEnvelopeName={env.name}
                sourceEnvelopeColor={env.color}
                open={moveOpen}
                onOpenChange={setMoveOpen}
                hideDefaultTrigger
            />
            <EnvelopeTopUpDialog
                envelopId={env.envelopId}
                envelopeName={env.name}
                envelopeColor={env.color}
                open={topUpOpen}
                onOpenChange={setTopUpOpen}
                hideDefaultTrigger
            />
        </span>
    );
}

/* ============================================================
   Helpers
   ============================================================ */

function UnbudgetedBanner({
    unallocated,
    isOverAllocated,
    spaceId,
    viewingDate,
}: {
    unallocated: number;
    isOverAllocated: boolean;
    spaceId: string;
    viewingDate: Date;
}) {
    const monthSlug = `${getAppTzYear(viewingDate)}-${String(
        getAppTzMonth(viewingDate) + 1
    ).padStart(2, "0")}`;
    const tone = isOverAllocated ? "var(--expense)" : "var(--income)";
    const title = isOverAllocated ? "Over-budgeted by" : "Unbudgeted";
    const value = Math.abs(unallocated);
    const sub = isOverAllocated
        ? "Your envelopes hold more than your accounts have. Add income or reduce an envelope."
        : "Money in your accounts that isn't planned for anything yet.";

    return (
        <div className="env-unbudgeted">
            <div className="env-unbudgeted-cell">
                <span className="env-unbudgeted-dot" style={{ background: tone }} />
                <span className="env-unbudgeted-text">
                    <span className="env-unbudgeted-title">
                        {title}{" "}
                        <span
                            className="tabular"
                            style={{
                                fontWeight: 600,
                                color: tone,
                                marginLeft: 4,
                            }}
                        >
                            {isOverAllocated ? "−" : "+"}
                            {value.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                            })}
                        </span>
                    </span>
                    <span className="env-unbudgeted-sub">{sub}</span>
                </span>
            </div>
            <Link to={ROUTES.spaceBudgetMonth(spaceId, monthSlug)} className="env-unbudgeted-cta">
                Budget this month →
            </Link>
        </div>
    );
}

function HeroStat({
    label,
    amount,
    tone,
    sub,
    size = 28,
}: {
    label: string;
    amount: number;
    tone?: "fg" | "brand" | "gold";
    sub?: ReactNode;
    size?: number;
}) {
    const color = tone === "brand" ? "var(--brand)" : tone === "gold" ? "var(--gold)" : "var(--fg)";
    return (
        <div className="env-hero-stat">
            <span className="eyebrow">{label}</span>
            <span
                className="tabular"
                style={{
                    fontSize: `var(--hero-num, ${size}px)`,
                    fontWeight: 500,
                    color,
                    letterSpacing: "-0.04em",
                    marginTop: 2,
                }}
            >
                {amount.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                })}
            </span>
            {sub && <span className="env-hero-stat-sub">{sub}</span>}
        </div>
    );
}

function Money({
    amount,
    variant = "neutral",
    signed = false,
    size = 13,
    weight = 500,
    decimals = 2,
}: {
    amount: number;
    variant?: "neutral" | "income" | "expense" | "muted";
    signed?: boolean;
    size?: number;
    weight?: number;
    decimals?: number;
}) {
    const colorMap: Record<string, string> = {
        income: "var(--income)",
        expense: "var(--expense)",
        muted: "var(--fg-3)",
        neutral: "var(--fg)",
    };
    const abs = Math.abs(amount).toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
    let text = abs;
    if (amount < 0) text = "−" + abs;
    else if (signed && amount > 0) text = "+" + abs;
    return (
        <span
            className="tabular"
            style={{
                color: colorMap[variant],
                fontSize: size,
                fontWeight: weight,
                letterSpacing: size >= 24 ? "-0.04em" : undefined,
            }}
        >
            {text}
        </span>
    );
}

function EntityAvatar({
    icon,
    colorVar,
    size = 32,
}: {
    icon: string;
    colorVar: string;
    size?: number;
}) {
    const IconCmp = getIcon(icon);
    return (
        <span
            style={{
                width: size,
                height: size,
                borderRadius: 8,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: `color-mix(in oklab, ${colorVar} 18%, transparent)`,
                border: `1px solid color-mix(in oklab, ${colorVar} 30%, transparent)`,
                color: colorVar,
                flexShrink: 0,
            }}
        >
            <IconCmp size={size * 0.5} color={colorVar} strokeWidth={1.7} />
        </span>
    );
}

function Skeleton({ height = 16 }: { height?: number }) {
    return (
        <div
            style={{
                width: "100%",
                height,
                borderRadius: 12,
                background:
                    "linear-gradient(90deg, var(--bg-elev-1), var(--bg-elev-2), var(--bg-elev-1))",
                backgroundSize: "200% 100%",
                animation: "ov-shimmer 1.6s ease-in-out infinite",
            }}
        />
    );
}

function SortPicker({ sort, setSort }: { sort: SortMode; setSort: (v: SortMode) => void }) {
    const label = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "Cadence";
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" className="od-btn">
                    <FilterIcon className="size-3.5" /> Sort: {label}
                    <ChevronDown className="size-3" style={{ color: "var(--fg-4)" }} />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="orbit-design env-popover w-52 p-1">
                {SORT_OPTIONS.map((o) => {
                    // Deadline + Progress are goal-only axes; in the
                    // grouped view they reorder the Goals section but
                    // leave Monthly + Rolling on cadence order so the
                    // page doesn't look broken under those sorts.
                    const isGoalOnly = o.value === "deadline" || o.value === "progress";
                    return (
                        <button
                            key={o.value}
                            type="button"
                            className="env-popover-item env-sort-item"
                            onClick={() => setSort(o.value)}
                        >
                            <span className="env-sort-item-text">
                                {o.label}
                                {isGoalOnly && (
                                    <span className="env-sort-item-sub">Reorders Goals only</span>
                                )}
                            </span>
                            {sort === o.value && (
                                <Check
                                    className="ml-auto size-3.5"
                                    style={{ color: "var(--brand)" }}
                                />
                            )}
                        </button>
                    );
                })}
            </PopoverContent>
        </Popover>
    );
}

/* ============================================================
   Dialogs (preserved)
   ============================================================ */

export interface EditableEnvelope {
    envelopId: string;
    name: string;
    color: string;
    icon: string;
    description: string | null;
    cadence: Cadence;
    targetAmount?: number | null;
    targetDate?: Date | string | null;
}

export function CreateOrEditEnvelopeDialog({
    envelope,
    open: controlledOpen,
    onOpenChange,
    hideDefaultTrigger,
    trigger,
}: {
    envelope?: EditableEnvelope;
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
    hideDefaultTrigger?: boolean;
    trigger?: ReactNode;
}) {
    const { space } = useCurrentSpace();
    const utils = trpc.useUtils();
    const editing = !!envelope;
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const open = controlledOpen ?? uncontrolledOpen;
    const setOpen = onOpenChange ?? setUncontrolledOpen;
    const [name, setName] = useState(envelope?.name ?? "");
    const [color, setColor] = useState(envelope?.color ?? DEFAULT_COLOR);
    const [icon, setIcon] = useState(envelope?.icon ?? "mail");
    const [description, setDescription] = useState(envelope?.description ?? "");
    const [cadence, setCadence] = useState<Cadence>(envelope?.cadence ?? "none");
    const [targetAmount, setTargetAmount] = useState<string>(
        envelope?.targetAmount != null ? String(envelope.targetAmount) : ""
    );
    const [targetDate, setTargetDate] = useState<string>(
        envelope?.targetDate ? new Date(envelope.targetDate).toISOString().slice(0, 10) : ""
    );

    const invalidate = async () => {
        await utils.envelop.listBySpace.invalidate({ spaceId: space.id });
        await utils.analytics.envelopeUtilization.invalidate({ spaceId: space.id });
    };

    const idem = useIdempotencyKey();
    const create = trpc.envelop.create.useMutation({
        onSuccess: async () => {
            toast.success("Envelope created");
            idem.rotate();
            await invalidate();
            setOpen(false);
        },
        onError: (e) => toast.error(e.message),
    });
    const update = trpc.envelop.update.useMutation({
        onSuccess: async () => {
            toast.success("Envelope updated");
            await invalidate();
            setOpen(false);
        },
        onError: (e) => toast.error(e.message),
    });
    const pending = create.isPending || update.isPending;

    const submit = () => {
        if (pending) return;
        if (!name.trim()) return;
        // Targets only ride along on rolling (cadence='none') envelopes.
        // Server validates the same constraint; we mirror it here so the
        // submit button can't ship contradictory state.
        const parsedAmountRaw =
            cadence === "none" && targetAmount.trim() ? Number(targetAmount) : null;
        const parsedTargetAmount =
            parsedAmountRaw != null && Number.isFinite(parsedAmountRaw) ? parsedAmountRaw : null;
        // `<input type="date">` emits "YYYY-MM-DD". `new Date(s)` would
        // parse it as UTC midnight and then PG's session-tz conversion
        // could shift the stored `date` column by one day for any user
        // outside Asia/Dhaka — use the APP_TZ-aware builder instead.
        let parsedTargetDate: Date | null = null;
        if (cadence === "none" && targetDate.trim()) {
            const [yStr, mStr, dStr] = targetDate.split("-");
            const y = Number(yStr);
            const m = Number(mStr);
            const d = Number(dStr);
            if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
                parsedTargetDate = makeAppTzDate(y, m - 1, d);
            }
        }
        if (editing) {
            // Only include target fields in the update payload when the
            // user actually changed them. The form initializes from the
            // stored row, so an untouched field would otherwise echo the
            // stored value back as an explicit write — and a stored-null
            // field would echo `null`, which the server reads as an
            // intentional clear and lock-step cascades the other column.
            // Track change vs the original envelope's serialized state.
            const origAmountStr =
                envelope?.targetAmount != null ? String(envelope.targetAmount) : "";
            const origDateStr = envelope?.targetDate
                ? new Date(envelope.targetDate).toISOString().slice(0, 10)
                : "";
            const amountChanged = targetAmount !== origAmountStr;
            const dateChanged = targetDate !== origDateStr;
            update.mutate({
                envelopId: envelope!.envelopId,
                name: name.trim(),
                color,
                icon,
                description: description.trim() || null,
                cadence,
                ...(amountChanged ? { targetAmount: parsedTargetAmount } : {}),
                ...(dateChanged ? { targetDate: parsedTargetDate } : {}),
            });
        } else {
            create.mutate({
                spaceId: space.id,
                name: name.trim(),
                color,
                icon,
                description: description.trim() || undefined,
                cadence,
                targetAmount: parsedTargetAmount ?? undefined,
                targetDate: parsedTargetDate ?? undefined,
                idempotencyKey: idem.key,
            });
        }
    };

    const IconCmp = getIcon(icon);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {!hideDefaultTrigger && (
                <DialogTrigger asChild>
                    {trigger ??
                        (editing ? (
                            <Button size="icon" variant="ghost" className="size-7">
                                <Pencil className="size-3.5" />
                            </Button>
                        ) : (
                            <Button variant="gradient">
                                <Plus />
                                New envelope
                            </Button>
                        ))}
                </DialogTrigger>
            )}
            <DialogContent className="orbit-shell-host">
                <DialogTitle className="sr-only">
                    {editing ? "Edit envelope" : "Create envelope"}
                </DialogTitle>
                <OrbitModalShell
                    width={560}
                    eyebrow="Budgets"
                    title={editing ? "Edit envelope" : "New envelope"}
                    subtitle="A bucket for a category — funded and tracked, monthly or rolling."
                    leadIcon={<IconCmp className="size-4" />}
                    leadColor={color}
                    onClose={() => setOpen(false)}
                    footer={
                        <>
                            <button
                                type="button"
                                className="orbit-btn"
                                onClick={() => setOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="orbit-btn orbit-btn-primary"
                                disabled={!name.trim() || pending}
                                onClick={submit}
                            >
                                <Plus className="size-3.5" />
                                {pending ? "Saving…" : editing ? "Save changes" : "Create envelope"}
                            </button>
                        </>
                    }
                >
                    <OrbitFormStyles />
                    <style>{ENV_MODAL_STYLES}</style>

                    {/* Color/icon row + Name */}
                    <div className="env-mod-id-row">
                        <div className="env-mod-style-row">
                            <ColorPickerButton value={color} onChange={setColor} />
                            <IconPickerButton value={icon} onChange={setIcon} color={color} />
                        </div>
                        <div className="env-mod-name-wrap">
                            <OrbitField label="Name" required>
                                <OrbitInput
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Groceries, Entertainment…"
                                    required
                                    maxLength={255}
                                    autoFocus
                                />
                            </OrbitField>
                        </div>
                    </div>

                    <OrbitField label="Description" hint="Optional">
                        <OrbitTextarea
                            rows={2}
                            maxLength={2000}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What does this envelope cover?"
                        />
                    </OrbitField>

                    <OrbitField label="Cadence">
                        <OrbitSelect
                            value={cadence}
                            onValueChange={(v) => setCadence(v as Cadence)}
                            items={[
                                {
                                    value: "none",
                                    label: "Rolling (accumulates)",
                                },
                                {
                                    value: "monthly",
                                    label: "Monthly (resets on the 1st)",
                                },
                            ]}
                            placeholder="Choose cadence"
                        />
                    </OrbitField>

                    {/* Goal target — only on rolling envelopes. Both fields
                       are optional; setting either turns the envelope into
                       a goal card with a progress bar. */}
                    {cadence === "none" ? (
                        <OrbitFieldRow>
                            <OrbitField
                                label="Target amount"
                                hint="Optional — turns this envelope into a goal"
                            >
                                <OrbitInput
                                    type="number"
                                    inputMode="decimal"
                                    min={0}
                                    step="0.01"
                                    value={targetAmount}
                                    onChange={(e) => setTargetAmount(e.target.value)}
                                    placeholder="0.00"
                                />
                            </OrbitField>
                            <OrbitField label="Target date" hint="Optional">
                                <EnvelopeTargetDatePicker
                                    value={targetDate}
                                    onChange={setTargetDate}
                                />
                            </OrbitField>
                        </OrbitFieldRow>
                    ) : null}
                </OrbitModalShell>
            </DialogContent>
        </Dialog>
    );
}

const ENV_MODAL_STYLES = `
.env-mod-id-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.env-mod-style-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
`;

function DeleteEnvelopeMenuItem({ envelopId }: { envelopId: string }) {
    const { space } = useCurrentSpace();
    const utils = trpc.useUtils();
    const del = trpc.envelop.delete.useMutation({
        onSuccess: async () => {
            toast.success("Envelope deleted");
            await utils.envelop.listBySpace.invalidate({ spaceId: space.id });
            await utils.analytics.envelopeUtilization.invalidate({ spaceId: space.id });
        },
        onError: (e) => toast.error(e.message),
    });
    return (
        <ConfirmDialog
            trigger={
                <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    className="text-destructive focus:text-destructive"
                >
                    <Trash2 className="size-3.5" /> Delete envelope
                </DropdownMenuItem>
            }
            title="Delete envelope?"
            description="You cannot delete an envelope that still has categories. Move or delete its categories first."
            confirmLabel="Delete"
            destructive
            onConfirm={() => del.mutate({ envelopId })}
        />
    );
}

function ArchiveEnvelopeMenuItem({
    envelopId,
    envelopName,
    archived,
    currentRemaining,
}: {
    envelopId: string;
    envelopName: string;
    archived: boolean;
    currentRemaining: number;
}) {
    const { space } = useCurrentSpace();
    const utils = trpc.useUtils();
    const mutation = trpc.envelop.archive.useMutation({
        onSuccess: async () => {
            toast.success(archived ? "Unarchived" : "Archived");
            await Promise.all([
                utils.envelop.listBySpace.invalidate({ spaceId: space.id }),
                utils.analytics.envelopeUtilization.invalidate({
                    spaceId: space.id,
                }),
                utils.analytics.spaceSummary.invalidate(),
            ]);
        },
        onError: (e) => toast.error(e.message),
    });

    if (archived) {
        return (
            <DropdownMenuItem
                onSelect={(e) => {
                    e.preventDefault();
                    mutation.mutate({ envelopId, archived: false });
                }}
            >
                <ArchiveRestore className="size-3.5" /> Unarchive
            </DropdownMenuItem>
        );
    }

    const allocationNote =
        currentRemaining > 0
            ? ` It currently has ${currentRemaining.toFixed(2)} allocated this period — that allocation stays put. Deallocate first if you want the cash back.`
            : "";

    return (
        <ConfirmDialog
            trigger={
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                    <Archive className="size-3.5" /> Archive…
                </DropdownMenuItem>
            }
            title={`Archive "${envelopName}"?`}
            description={`This hides ${envelopName} from the envelopes list and prevents new transactions in its categories. Existing data is preserved.${allocationNote}`}
            confirmLabel="Archive"
            onConfirm={() => mutation.mutate({ envelopId, archived: true })}
        />
    );
}

const ENV_STYLES = `
.env-root {
    margin: -1.5rem -1rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
}
@media (min-width: 768px) {
    .env-root { margin: -2rem; }
}

.env-topbar {
    padding: 26px 32px 18px;
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    background: var(--bg);
    flex-wrap: wrap;
}
.env-topbar-text { display: flex; flex-direction: column; gap: 6px; }
.env-title {
    font-size: 26px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--fg);
    margin: 0;
}
.env-topbar-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
@media (max-width: 720px) {
    .env-topbar { padding: 18px 18px 14px; }
}

.env-scroll {
    flex: 1;
    padding: 22px 32px 36px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
@media (max-width: 720px) {
    .env-scroll { padding: 16px 18px 28px; }
}

/* Summary strip — the period header: month nav + the three headline totals,
   with the unbudgeted banner beneath. Given real presence so the top of the
   page reads as a deliberate summary, not a cramped toolbar. */
.orbit-design .od-card.env-summary {
    padding: 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 18px;
}
.env-summary-main {
    display: flex;
    align-items: stretch;
    gap: 28px;
    flex-wrap: wrap;
}
/* Left column — month nav stacked above the three hero stats, so the
   at-a-glance facts grid fits beside it (detail-hero layout). */
.env-summary-left {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 16px;
    flex: 1 1 400px;
    min-width: 0;
}
.env-month-nav {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}
.env-month-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--fg);
    min-width: 96px;
}
.env-summary-stats {
    display: flex;
    align-items: center;
    gap: 32px;
    flex-wrap: wrap;
}
.env-summary-divider {
    width: 1px;
    align-self: stretch;
    min-height: 40px;
    background: var(--line-soft);
}
/* Below ~1440px the three stats can wrap (34px numbers + the facts grid
   squeezing the left column between 1101px and ~1430px), which strands a
   divider at a row end — hide them across the whole wrap band. Verified
   one-row only at ≥1440. */
@media (max-width: 1439px) {
    .env-summary-divider { display: none; }
}
@media (max-width: 640px) {
    .orbit-design .od-card.env-summary { padding: 16px; gap: 14px; }
    .env-summary-main { gap: 16px; }
    .env-summary-stats { gap: 18px; --hero-num: 26px; }
}
.env-hero-arrow {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-3);
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
}
.env-hero-arrow:hover:not(:disabled) {
    background: var(--bg-elev-2);
    color: var(--fg);
}
.env-hero-arrow:disabled { opacity: 0.4; cursor: not-allowed; }
/* Comfortable tap targets on touch widths. */
@media (max-width: 640px) {
    .env-hero-arrow { width: 40px; height: 40px; }
}
.env-unbudgeted {
    margin-top: 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--bg-elev-2);
    border: 1px solid var(--line-soft);
    position: relative;
    z-index: 1;
    flex-wrap: wrap;
}
.env-unbudgeted-cell {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}
.env-unbudgeted-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    flex-shrink: 0;
}
.env-unbudgeted-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    line-height: 1.25;
    min-width: 0;
}
.env-unbudgeted-title {
    font-size: 13px;
    color: var(--fg-2);
    font-weight: 500;
}
.env-unbudgeted-sub {
    font-size: 11px;
    color: var(--fg-4);
}
.env-unbudgeted-cta {
    font-size: 12px;
    font-weight: 500;
    color: var(--brand);
    text-decoration: none;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    transition: background 140ms ease, border-color 140ms ease;
    white-space: nowrap;
}
.env-unbudgeted-cta:hover {
    background: var(--bg-elev-3);
    border-color: var(--line-strong);
}
.env-hero-stat {
    display: flex;
    flex-direction: column;
    gap: 3px;
}
.env-hero-stat-sub { font-size: 11px; color: var(--fg-3); }

/* Toolbar */
.env-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}
.env-search {
    position: relative;
    display: flex;
    flex: 1;
    width: 100%;
    align-items: center;
}
.env-search > svg {
    position: absolute;
    left: 12px;
    z-index: 1;
}
.orbit-design .od-input.env-search-input {
    flex: 1;
    width: 100%;
    padding-left: 36px;
}
/* Grid */
.env-grid {
    display: grid;
    /* Narrow auto-fill columns so the portrait bottle cards pack several per
       row and each card hugs its gauge instead of stranding it. */
    grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
    gap: 14px;
}

.orbit-design .od-card.env-card {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-decoration: none;
    color: inherit;
    transition: border-color 140ms ease, background 140ms ease;
    position: relative;
}
.orbit-design .od-card.env-card:hover {
    border-color: var(--line-strong);
    background: var(--bg-elev-2);
}
.orbit-design .od-card.env-card:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
}
/* The bottle gauge, centered as the card's hero. Cards are narrow (see the
   grid) so a centered portrait glass fills the card cleanly. */
.env-card-glass-wrap {
    display: flex;
    justify-content: center;
    padding: 2px 0;
}
/* Centered readout under the glass (number stacked over its label). */
.env-card-hero-center {
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 3px;
}
.env-card-foot-center {
    justify-content: center;
}
/* Overspent cards earn a quiet red edge — the glass already shows the red
   deficit, so this is a calm reinforcement, not a second alarm. */
.orbit-design .od-card.env-card.env-card-over {
    border-color: color-mix(in oklab, var(--expense) 32%, var(--line));
}
.orbit-design .od-card.env-card.env-card-over:hover {
    border-color: color-mix(in oklab, var(--expense) 45%, var(--line));
}
/* Goal envelopes (cadence='none' + target_amount). Gold tint matches
   the goal accent used on Overview/section headers so the user can
   pick goal cards out of a mixed grid at a glance. */
.orbit-design .od-card.env-card.env-card-goal {
    background: color-mix(in oklab, var(--gold) 5%, var(--bg-elev-1));
    border-color: color-mix(in oklab, var(--gold) 28%, var(--line));
}
.orbit-design .od-card.env-card.env-card-goal:hover {
    background: color-mix(in oklab, var(--gold) 12%, var(--bg-elev-2));
    border-color: color-mix(in oklab, var(--gold) 40%, var(--line));
}
.env-card-goal .env-card-cadence > span:first-child {
    color: var(--gold);
    font-weight: 500;
}
/* Archive wins over goal: an archived goal should read as muted, not
   as a gold-accent active card. Reset background and border at higher
   specificity. */
.orbit-design .od-card.env-card.env-card-goal.env-card-archived {
    background: var(--bg-elev-1);
    border-color: var(--line);
}
.orbit-design .od-card.env-card.env-card-goal.env-card-archived:hover {
    background: var(--bg-elev-2);
    border-color: var(--line-strong);
}
.env-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}
.env-card-name {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}
.env-card-text {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
    min-width: 0;
}
.env-card-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.env-card-cadence {
    font-size: 11px;
    color: var(--fg-4);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 4px;
    row-gap: 2px;
}
/* Hero amount: the big "left / over" number with a small label beneath. */
.env-card-hero {
    display: flex;
    align-items: baseline;
    gap: 6px;
}
.env-card-hero-amt {
    line-height: 1;
}
.env-card-hero-label {
    display: inline-flex;
    /* baseline (not center): the parent .env-card-hero aligns its children on
       the text baseline, and a flex container's baseline is its first item's
       baseline — so the label's word must sit on its own text baseline to line
       up with the big hero number. The icon has no text baseline, so it's
       nudged to optical center via the svg rule below. */
    align-items: baseline;
    /* wrap + center so a long overspend label ("900% over budget") on a
       narrow card breaks onto a second line cleanly instead of lopsiding. */
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    /* --fg-3 (not --fg-4) keeps this meaningful label above the 4.5:1
       contrast floor at 11px. */
    color: var(--fg-3);
}
.env-card-hero-label svg {
    /* Icons carry no text baseline; pin to optical center against the cap
       height so the triangle doesn't ride up off the word. */
    align-self: center;
    position: relative;
    top: 0.5px;
}
/* Allocated · Spent mini-stats. Two cells: label left-aligned, Spent
   right-aligned, space-between so each figure gets ~half the card and large
   taka values don't clip at the 2-up tablet breakpoint. (Left is the hero,
   not repeated here.) */
.env-card-stats {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding-top: 2px;
}
.env-card-stat {
    display: flex;
    flex-direction: column;
    gap: 3px;
    /* Equal halves + clip so one large taka figure can't steal the other's
       space or spill past the narrow card edge (numbers don't wrap). */
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
}
.env-card-stat-end {
    align-items: flex-end;
    text-align: right;
}
.env-card-stat-label {
    font-size: 10.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    /* --fg-3 for legibility — small uppercase labels need the contrast. */
    color: var(--fg-3);
}
.env-card-foot {
    display: flex;
    justify-content: space-between;
    font-size: 11.5px;
    /* Pin the foot to the card bottom so spend cards (with a stats row) and
       goal cards (without) bottom-align in a stretched grid row. */
    margin-top: auto;
}
.env-card-menu {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* 34px hit area (icon stays its own size, centered) — this is the one
       control that must not trigger card navigation and it opens a menu with
       Delete, so it warrants a comfortable mobile tap target. */
    width: 34px;
    height: 34px;
    border-radius: 6px;
    background: transparent;
    border: 0;
    color: var(--fg-4);
    cursor: pointer;
    flex-shrink: 0;
}
.env-card-menu:hover {
    background: var(--bg-elev-2);
    color: var(--fg);
}

/* Empty */
.orbit-design .od-card.env-empty {
    padding: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
}

/* Sort popover */
.env-popover-item {
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border-radius: 6px;
    background: transparent;
    border: 0;
    font-size: 13px;
    color: var(--fg-2);
    cursor: pointer;
    font-family: inherit;
    display: flex;
    align-items: center;
    gap: 8px;
}
.env-popover-item:hover { background: var(--bg-elev-2); color: var(--fg); }
/* Sort items with a goal-only hint stack label + 11px muted subhead. */
.env-sort-item { align-items: flex-start; }
.env-sort-item-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
}
.env-sort-item-sub {
    font-size: 11px;
    color: var(--fg-4);
    font-weight: 400;
}

/* Distribution bar — the month-plan page's bar, thinner. Segments = each
   envelope's clamped remaining (held cash), tick = cash you have, red
   overlay = held past your cash. Not overflow-clipped so the tick
   survives sitting at 100%. */
.env-dist {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.env-dist-bar {
    position: relative;
    height: 9px;
    border-radius: 5px;
    background: var(--bg-elev-2);
}
.env-dist-seg {
    position: absolute;
    top: 0;
    bottom: 0;
    border-right: 1px solid var(--bg-elev-1);
}
.env-dist-seg:first-child { border-top-left-radius: 5px; border-bottom-left-radius: 5px; }
/* Right-end rounding is applied inline on the last segment — :last-child
   can't match it (the overlay/tick spans are later siblings). */
.env-dist-over {
    position: absolute;
    top: -2px;
    bottom: -2px;
    /* Diagonal hatching — a flat tint disappears on top of the bright
       segment colors; stripes read as "this part exceeds your cash". */
    background: repeating-linear-gradient(
        135deg,
        color-mix(in oklab, var(--expense) 65%, transparent) 0 3px,
        transparent 3px 6px
    );
    border: 1px solid color-mix(in oklab, var(--expense) 80%, transparent);
    border-radius: 4px;
    pointer-events: none;
}
.env-dist-tick {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2.5px;
    transform: translateX(-50%);
    background: var(--fg);
    border-radius: 2px;
}
/* Caption — same pattern as the month page's plan-dist-caption, so the
   two sibling bars are explicitly-different rather than silently so. */
.env-dist-caption {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 11px;
    color: var(--fg-3); /* fg-4 fails AA at this size */
}
.env-dist-caption-tick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-3);
}
.env-dist-caption-tick i {
    width: 2.5px;
    height: 12px;
    background: var(--fg);
    border-radius: 2px;
}

/* At-a-glance facts — the detail hero's KPI grid pattern, docked to the
   right side of the summary strip (border-left divider, 3x2). */
.env-facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px 24px;
    align-content: center;
}
.env-summary-facts {
    flex: 1 1 320px;
    min-width: 0;
    align-self: stretch;
    padding-left: 28px;
    border-left: 1px solid var(--line-soft);
}
.env-fact { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.env-fact-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-3); font-weight: 500; }
.env-fact-val { font-size: 19px; font-weight: 500; letter-spacing: -0.02em; }
.env-fact-sub { font-size: 10.5px; color: var(--fg-3); }
@media (max-width: 1100px) {
    .env-summary-facts { padding-left: 0; border-left: none; flex-basis: 100%; }
}
@media (max-width: 640px) {
    .env-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }
}

/* Archived envelopes — collapsible reveal section + dimmed cards. */
.env-archived-section {
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-top: 18px;
    border-top: 1px dashed var(--line-soft);
}
.env-archived-toggle {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 0;
    color: var(--fg-3);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    padding: 4px 6px;
    border-radius: 6px;
    transition: color 140ms ease, background 140ms ease;
}
.env-archived-toggle:hover {
    color: var(--fg);
    background: var(--bg-elev-2);
}
.env-archived-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--bg-elev-3);
    font-size: 10.5px;
    font-weight: 600;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
}
.env-archived-grid .env-card {
    opacity: 0.7;
}
.env-archived-grid .env-card:hover {
    opacity: 1;
}
.env-card-archived {
    background: var(--bg-elev-1);
}
.env-archived-pill {
    display: inline-flex;
    align-items: center;
    height: 16px;
    padding: 0 6px;
    margin-left: 6px;
    border-radius: 999px;
    background: var(--bg-elev-3);
    color: var(--fg-3);
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    vertical-align: middle;
}

/* Phone (<640px) — tighter spacing on the envelope page. */
@media (max-width: 640px) {
    .env-topbar { padding: 14px 14px 10px; }
    .env-title { font-size: 22px; }
    .env-scroll { padding: 12px 14px 22px; gap: 12px; }
    /* Two compact bottle cards fit a phone comfortably; let auto-fill pack
       them (narrowing the floor a touch) rather than forcing a single column. */
    .env-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
    .env-empty { padding: 24px; }
    .orbit-design .od-card.env-summary { padding: 14px; }
    .env-unbudgeted {
        padding: 10px 12px;
        gap: 10px;
    }
    .env-unbudgeted-cta {
        padding: 8px 12px;
        min-height: 36px;
        display: inline-flex;
        align-items: center;
    }
    .orbit-design .od-card.env-card { padding: 14px; gap: 12px; }
    .env-card-menu {
        width: 32px;
        height: 32px;
    }
    .env-archived-section { margin-top: 16px; padding-top: 14px; }
}
`;
