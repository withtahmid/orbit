import {
    Fragment,
    useMemo,
    useRef,
    useState,
    type ComponentProps,
    type CSSProperties,
    type ReactNode,
    type TouchEvent as ReactTouchEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
    ArchiveRestore,
    ArrowRightLeft,
    ChevronLeft,
    ChevronRight,
    Coins,
    Pencil,
    TrendingDown,
    TrendingUp,
} from "lucide-react";
import { formatInAppTz } from "@/lib/formatDate";
import { startOfMonth, endOfMonth, addMonths, getAppTzYear } from "@/lib/dates";
import { compactMoney } from "@/lib/chartBucket";
import { toast } from "sonner";
import { PermissionGate } from "@/components/shared/PermissionGate";
import { EnvelopeAllocateDialog } from "@/features/allocations/EnvelopeAllocateDialog";
import { EnvelopeMoveDialog } from "@/features/allocations/EnvelopeMoveDialog";
import { EnvelopeTopUpDialog } from "@/features/allocations/EnvelopeTopUpDialog";
import { EnvelopeGlass } from "@/components/budget-gauge/EnvelopeGlass";
import { EnvelopePaceChart, type ChartPoint } from "@/components/budget-gauge/EnvelopePaceChart";
import { EnvelopeSpendChart } from "@/components/budget-gauge/EnvelopeSpendChart";
import { Donut } from "@/components/shared/charts/Donut";
import { trpc } from "@/trpc";
import { useCanEdit, useCurrentSpace } from "@/hooks/useCurrentSpace";
import { ROUTES } from "@/router/routes";
import { getIcon } from "@/lib/entityIcons";
import { CreateOrEditEnvelopeDialog } from "./BudgetsPage";

const DAY = 86_400_000;
const daysBetween = (a: Date, b: Date) =>
    Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY));
const money2 = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n: number) => Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

type Tone = "brand" | "warn" | "expense" | "gold";
const toneVar: Record<Tone, string> = {
    brand: "var(--brand)",
    warn: "var(--warn)",
    expense: "var(--expense)",
    gold: "var(--gold)",
};

interface GoalChart {
    kind: "goal";
    title: string;
    subtitle: string;
    legend: Array<{ label: string; kind: "solid" | "dash" | "dot"; color: string }>;
    foot: ReactNode;
    props: ComponentProps<typeof EnvelopePaceChart>;
}
interface SpendChart {
    kind: "spend";
    title: string;
    subtitle: string;
    legend: Array<{ label: string; kind: "solid" | "dash" | "dot"; color: string }>;
    foot: ReactNode;
    race: ComponentProps<typeof EnvelopeSpendChart>;
}
type ChartVM = GoalChart | SpendChart;

export default function BudgetDetailPage() {
    const { space } = useCurrentSpace();
    const canEdit = useCanEdit();
    const { envelopeId } = useParams<{ envelopeId: string }>();
    const [editOpen, setEditOpen] = useState(false);
    const [monthOffset, setMonthOffset] = useState(0);

    const now = useMemo(() => new Date(), []);
    // Step from a MONTH-START, not the raw current date — otherwise
    // addMonths preserves the day-of-month and overflows short months (on
    // the 31st, stepping back skips Feb/Apr/Jun and repeats others).
    const viewingDate = useMemo(
        () => addMonths(startOfMonth(now), monthOffset),
        [now, monthOffset]
    );
    const periodStart = useMemo(() => startOfMonth(viewingDate), [viewingDate]);
    const periodEnd = useMemo(() => endOfMonth(viewingDate), [viewingDate]);
    // The dailyComparison "anchor" is where the period + the "today" marker
    // land. For the current month that's now (mid-month); for a past month we
    // anchor at the LAST INSTANT of that month so the whole, completed month
    // renders. NB: endOfMonth() returns the *exclusive* next-month start, so we
    // step back 1ms — otherwise date_trunc('month', anchor) would land on the
    // following month and the chart wouldn't move.
    const anchor = useMemo(
        () => (monthOffset === 0 ? now : new Date(periodEnd.getTime() - 1)),
        [monthOffset, now, periodEnd]
    );

    const utilizationQuery = trpc.analytics.envelopeUtilization.useQuery({
        spaceId: space.id,
        periodStart,
        periodEnd,
    });

    const envelope = utilizationQuery.data?.find((e) => e.envelopId === envelopeId);
    const isGoal = !!envelope && envelope.targetAmount != null && envelope.targetAmount > 0;

    // Daily spend series for the pace chart (monthly + rolling only; goals
    // have no per-deposit funding history to plot, so they use envelope
    // fields directly). Scoped to this envelope via the envelopeIds filter.
    const dailyQuery = trpc.analytics.trends.dailyComparison.useQuery(
        {
            spaceId: space.id,
            granularity: "month",
            anchor,
            // Expense-only, so the chart's "spent" matches the hero's
            // `consumed` (which excludes cross-space transfer principal).
            mode: "operational",
            envelopeIds: envelopeId ? [envelopeId] : [],
        },
        { enabled: !!envelope && !isGoal }
    );

    // Coaching KPIs (last month / 3-mo avg) — returns every envelope; filter.
    // Reference the viewed month so "last month" is relative to it.
    const averagesQuery = trpc.analytics.envelopeRecentAverages.useQuery(
        { spaceId: space.id, referenceDate: periodStart },
        { enabled: !!envelope && !isGoal }
    );
    const averages = averagesQuery.data?.find((a) => a.envelopId === envelopeId);

    // Velocity — "how fast money is leaving," envelope-scoped. Same math as
    // the space-level Velocity card on the Spending Trends page
    // (TrendsView.tsx), just derived from this envelope's own dailyQuery
    // series instead of the space-wide one. granularity is always "month"
    // here, so bucketDays is always 1 (one bucket = one day).
    const velocity = useMemo(() => {
        const daily = dailyQuery.data;
        if (!daily) return null;
        const cur = daily.current;
        const prv = daily.previous;
        const avg = daily.average;
        const bucketDays = daily.bucketDays;
        const today = daily.today;
        const len = Math.max(daily.periodLength, prv.length);
        let curAcc = 0;
        let prvAcc = 0;
        let avgAcc = 0;
        let curAtToday = 0;
        let prvAtToday = 0;
        for (let i = 0; i < len; i++) {
            curAcc += cur[i] ?? 0;
            prvAcc += prv[i] ?? 0;
            if (avg) avgAcc += avg[i] ?? 0;
            if (i === today - 1) {
                curAtToday = curAcc;
                prvAtToday = prvAcc;
            }
        }
        const perDayThisMonth = today > 0 ? curAtToday / today / bucketDays : 0;
        const perDayLastMonth = today > 0 ? prvAtToday / today / bucketDays : 0;
        const perDayTypical =
            avg && daily.periodLength > 0 ? avgAcc / (daily.periodLength * bucketDays) : null;
        const acceleration = prvAtToday > 0 ? (curAtToday / prvAtToday - 1) * 100 : null;
        return { perDayThisMonth, perDayLastMonth, perDayTypical, acceleration, today };
    }, [dailyQuery.data]);

    // Monthly spend — trailing 12 months (this year vs last), envelope-
    // scoped via the same trends.yearOverYear procedure the Spending
    // Trends page uses for its YoY chart. Anchored to the viewed month's
    // year (not always "now") so stepping the month nav into a different
    // calendar year keeps this section in sync with the rest of the page.
    const yoyQuery = trpc.analytics.trends.yearOverYear.useQuery(
        {
            spaceId: space.id,
            envelopeIds: envelopeId ? [envelopeId] : [],
            year: getAppTzYear(viewingDate),
        },
        { enabled: !!envelope && !isGoal }
    );
    const monthly = useMemo(() => {
        const data = yoyQuery.data;
        if (!data) return null;
        const thisYear = data.thisYear.map((v) => v ?? 0);
        const lastYear = data.lastYear.map((v) => v ?? 0);
        // Compare the same window-of-year on both sides (only months that
        // have actually happened in `thisYear`) so the headline delta
        // isn't asymmetric YTD-vs-full-year — mid-year flat spend should
        // read ~0%, not deeply negative just because the rest of `lastYear`
        // has more months of data.
        const futureStartIdx = data.thisYear.findIndex((v) => v == null);
        const windowMonths = futureStartIdx === -1 ? 12 : futureStartIdx;
        const thisTotal = thisYear.slice(0, windowMonths).reduce((s, v) => s + v, 0);
        const lastTotal = lastYear.slice(0, windowMonths).reduce((s, v) => s + v, 0);
        const totalDelta = lastTotal > 0 ? (thisTotal / lastTotal - 1) * 100 : null;
        const hasData = thisYear.some((v) => v > 0) || lastYear.some((v) => v > 0);
        return {
            year: data.year,
            months: data.months,
            thisYear,
            lastYear,
            totalDelta,
            hasData,
            ytdSpent: thisTotal,
            windowMonths,
        };
    }, [yoyQuery.data]);

    // Monthly ALLOCATED, for monthly-cadence envelopes only — rolling/goal
    // envelopes have a single lifetime pool, not a per-month figure. Paired
    // with `monthly.thisYear` (spend) so the chart can show a bullet-style
    // spent-bar + allocated-marker per month instead of a bare spend bar.
    const allocQuery = trpc.analytics.envelopeMonthlyAllocations.useQuery(
        { spaceId: space.id, envelopeId: envelopeId ?? "", year: monthly?.year },
        { enabled: !!envelope && !isGoal && envelope.cadence === "monthly" && !!envelopeId }
    );

    // "Where it went" — this envelope's spend split across its categories for
    // the period. Reuses the analytics categoryBreakdown query (envelope-scoped)
    // + the shared Donut chart.
    const catQuery = trpc.analytics.categoryBreakdown.useQuery(
        {
            spaceId: space.id,
            periodStart,
            periodEnd,
            envelopeIds: envelopeId ? [envelopeId] : [],
        },
        { enabled: !!envelope }
    );
    const catData = useMemo(() => {
        const rows = catQuery.data ?? [];
        // Roll spend up to ROOT categories: only top-level rows (parentId
        // null), valued by their subtree total (own + descendants), which the
        // query already computes envelope-scoped.
        const roots = rows
            .filter((r) => r.parentId === null && r.subtreeTotal > 0)
            .sort((a, b) => b.subtreeTotal - a.subtreeTotal)
            .map((r) => ({
                id: r.id,
                name: r.name,
                value: r.subtreeTotal,
                color: r.color,
            }));
        // The donut is scoped to THIS MONTH (categoryBreakdown uses
        // periodStart/End), so reconcile it against this-month spend and show
        // any uncategorized remainder as its own wedge. The authoritative
        // this-month total differs by cadence:
        //   - monthly: `consumed` is already period-windowed.
        //   - rolling: `consumed` is LIFETIME, so use the cumulated this-month
        //     spend from the daily series instead (else the donut under-counts
        //     vs. the chart directly above it).
        // Goals fund via allocations, not category spend, so skip them.
        if (envelope && !isGoal) {
            const daily = dailyQuery.data;
            const periodSpend =
                envelope.cadence === "monthly"
                    ? envelope.consumed
                    : daily
                      ? daily.current.reduce((s, v) => s + (v ?? 0), 0)
                      : null;
            const categorized = roots.reduce((s, d) => s + d.value, 0);
            // Dormant caveat: categoryBreakdown also scopes to space accounts
            // while the spend totals don't, so an expense sourced from a
            // non-space account (not a normal case for an envelope) would land
            // here as "Uncategorized". Guarded to non-negative below.
            const uncat =
                periodSpend != null ? Math.round((periodSpend - categorized) * 100) / 100 : 0;
            if (uncat > 0.005) {
                roots.push({
                    id: "__uncat",
                    name: "Uncategorized",
                    value: uncat,
                    // Neutral tokens (not hardcoded slate) so the misc wedges
                    // track the theme; the page renders inside .orbit-design.
                    color: "var(--fg-3)",
                });
            }
        }
        return roots;
    }, [catQuery.data, envelope, isGoal, dailyQuery.data]);
    const catTotal = useMemo(() => catData.reduce((s, d) => s + d.value, 0), [catData]);
    // Donut is unreadable past ~8 slices, so cap it to the top few + an
    // "Other" wedge. The full per-category breakdown is still readable via
    // the donut's own aria-label and its hover-driven center-label swap.
    const donutSlices = useMemo(() => {
        const TOP = 8;
        if (catData.length <= TOP + 1) return catData;
        const top = catData.slice(0, TOP);
        const restTotal = catData.slice(TOP).reduce((s, d) => s + d.value, 0);
        return restTotal > 0
            ? [...top, { id: "__other", name: "Other", value: restTotal, color: "var(--fg-4)" }]
            : top;
    }, [catData]);

    const monthLabel = formatInAppTz(viewingDate, "MMM yyyy");

    // ---- the numbers shown in the hero ----
    const total = envelope ? envelope.allocated : 0;
    const remaining = envelope ? envelope.remaining : 0;
    const over = !!envelope && !isGoal && envelope.consumed > total && total > 0;
    // No budget allocated yet is not a failure, just un-budgeted — show it
    // neutrally rather than as a red overspend or a misleading gold "Remaining"
    // (which would read as money still available). Covers a fresh envelope
    // (nothing spent yet) too, so it never renders a gold "Remaining 0.00".
    const noBudget = !!envelope && !isGoal && total <= 0;
    const goalSaved = envelope?.lifetimeFunded ?? 0;
    const goalTarget = envelope?.targetAmount ?? 0;
    // A goal that's been spent against — its saved pool has drained. Surfaces
    // "Spent" and softens "Goal reached" → "Funded" so the drain is visible.
    const goalSpent = isGoal ? (envelope?.consumed ?? 0) : 0;
    // Archived envelopes are frozen/read-only — never paint a red/amber alarm
    // on them anywhere (label still carries the fact). Neutralize alarm tones.
    const archived = !!envelope?.archived;
    const muteTone = <T extends string>(t: T): T | "fg" =>
        archived && (t === "expense" || t === "warn") ? "fg" : t;

    // ---- assemble the pace chart per cadence ----
    const chart = useMemo<ChartVM | null>(() => {
        if (!envelope) return null;
        // Alarm colours are muted on archived (frozen) envelopes so the chart
        // foot doesn't shout red/amber at a read-only object.
        const expenseC = archived ? "var(--fg-3)" : "var(--expense)";
        const warnC = archived ? "var(--fg-3)" : "var(--warn)";

        // ------- GOAL: saving pace toward the target -------
        if (isGoal) {
            const now = new Date();
            const start = envelope.firstAllocatedAt ? new Date(envelope.firstAllocatedAt) : now;
            const elapsedDays = daysBetween(start, now);
            // A per-day rate needs at least a full day of history — otherwise a
            // same-day lump sum implies a multi-million/mo pace and a "done
            // tomorrow" projection on a goal's very first day.
            const trackable = elapsedDays >= 1;
            const nowX = Math.max(elapsedDays, 0.0001);
            const saved = goalSaved;
            const target = goalTarget;
            const reached = saved >= target;
            const targetDate = envelope.targetDate ? new Date(envelope.targetDate) : null;
            const targetX = targetDate ? daysBetween(start, targetDate) : null;

            // Projected completion at the realized average funding rate.
            const rate = trackable && saved > 0 ? saved / nowX : 0; // per day
            const rawCompletionX = !reached && rate > 0 ? target / rate : null;
            const completionDate =
                rawCompletionX != null ? new Date(start.getTime() + rawCompletionX * DAY) : null;
            // Cap how far right a badly-behind projection can push the x-axis
            // (a goal 100 days in with almost nothing saved projects ~100k days
            // out, crushing the realized line into the y-axis). The foot text
            // still states the true, un-capped completion date.
            const capX = Math.max(targetX ?? 0, nowX) * 3;
            const completionX = rawCompletionX != null ? Math.min(rawCompletionX, capX) : null;

            const xMax =
                // Floor at ~30 days so a brand-new / same-day-funded goal with
                // no deadline shows a sensible month-wide window instead of a
                // degenerate ~0-width chart pinned to the y-axis.
                Math.max(nowX, targetX ?? 0, completionX ?? 0, nowX * 1.2, 30) * 1.04;
            const yMax = Math.max(target, saved) * 1.1 || 1;

            const actual: ChartPoint[] = [
                { x: 0, y: 0 },
                { x: nowX, y: Math.min(saved, yMax) },
            ];
            const pace: ChartPoint[] | null =
                targetX != null
                    ? [
                          { x: 0, y: 0 },
                          { x: targetX, y: target },
                      ]
                    : null;
            const projection: ChartPoint[] | null =
                rawCompletionX != null && completionX != null
                    ? [
                          { x: nowX, y: saved },
                          {
                              // If the projection was capped, stop the line at
                              // the edge with the interpolated y so its slope
                              // stays truthful.
                              x: completionX,
                              y:
                                  completionX >= rawCompletionX
                                      ? target
                                      : saved +
                                        (target - saved) *
                                            ((completionX - nowX) / (rawCompletionX - nowX)),
                          },
                      ]
                    : null;

            const xTicks: Array<{ x: number; label: string }> = [
                { x: 0, label: formatInAppTz(start, "MMM ''yy") },
            ];
            if (targetX != null && targetDate)
                xTicks.push({ x: targetX, label: formatInAppTz(targetDate, "MMM ''yy") });
            else if (completionDate && completionX != null)
                xTicks.push({
                    x: completionX,
                    label: formatInAppTz(completionDate, "MMM ''yy"),
                });

            const overFunded = saved - target;
            let foot: ReactNode;
            if (reached) {
                // Don't announce an unclamped ">100%"; state over-funding
                // explicitly instead so the number never reads oddly.
                foot =
                    overFunded > 0.005 ? (
                        <span>
                            Goal reached — <b style={{ color: "var(--gold)" }}>fully funded</b>,{" "}
                            {money0(overFunded)} over target
                            {goalSpent > 0 ? (
                                <>
                                    {" "}
                                    · <b className="tabular">{money0(goalSpent)}</b> spent
                                </>
                            ) : null}
                            .
                        </span>
                    ) : (
                        <span>
                            Goal reached — <b style={{ color: "var(--gold)" }}>100% funded</b>
                            {goalSpent > 0 ? (
                                <>
                                    {" "}
                                    · <b className="tabular">{money0(goalSpent)}</b> spent
                                </>
                            ) : null}
                            .
                        </span>
                    );
            } else if (completionDate) {
                const onTime = targetDate ? completionDate <= targetDate : true;
                foot = (
                    <span>
                        At your average of <b className="tabular">{money0(rate * 30)}/mo</b> you'll
                        reach {money0(target)} by <b>{formatInAppTz(completionDate, "MMM yyyy")}</b>
                        {targetDate ? (
                            <>
                                {" "}
                                —{" "}
                                <b style={{ color: onTime ? "var(--income)" : expenseC }}>
                                    {onTime ? "on track" : "behind"}
                                </b>{" "}
                                for the {formatInAppTz(targetDate, "MMM yyyy")} target.
                            </>
                        ) : (
                            "."
                        )}
                    </span>
                );
            } else if (saved > 0) {
                foot = (
                    <span>
                        Funded <b className="tabular">{money0(saved)}</b> so far — your saving pace
                        appears once there's more than a day of history.
                    </span>
                );
            } else {
                foot = <span>Fund this goal to start tracking your pace.</span>;
            }

            return {
                kind: "goal",
                title: "Saving pace",
                subtitle:
                    "Average saved-so-far (no per-deposit history) vs. the pace that reaches your target on time.",
                legend: [
                    { label: "Saved (avg)", kind: "dash", color: envelope.color },
                    { label: "On-time pace", kind: "dash", color: "var(--fg-2)" },
                    { label: "Projected", kind: "dot", color: "var(--warn)" },
                ],
                foot,
                props: {
                    xMax,
                    yMax,
                    yTicks: niceTicks(yMax),
                    xTicks,
                    actual,
                    pace,
                    projection,
                    capY: target,
                    capLabel: `TARGET ${money0(target)}`,
                    todayX: nowX,
                    accent: envelope.color,
                    projColor: "var(--warn)",
                    fmtY: compactMoney,
                    actualKind: "synthetic",
                    ariaLabel: `Saving pace: ${money0(saved)} of ${money0(target)} saved`,
                },
            };
        }

        // ------- SPEND (monthly + rolling) — reuse the interactive
        // analytics cumulative-race chart, scoped to this envelope, and
        // (monthly only) overlay the on-budget pace line via `budget`. -------
        const daily = dailyQuery.data;
        if (!daily) return null;
        const pl = daily.periodLength;
        const today = Math.min(daily.today, pl);

        // Cumulate the daily series exactly as the Trends view does.
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

        const isMonthly = envelope.cadence === "monthly";
        const budget = isMonthly && total > 0 ? total : null;

        let foot: ReactNode;
        if (budget != null) {
            const paceNow = budget * (today / pl);
            const diff = spentToDate - paceNow;
            const under = diff <= 0;
            foot = over ? (
                <span>
                    You've spent{" "}
                    <b style={{ color: expenseC }}>{money0(spentToDate - budget)} over</b> budget
                    with {pl - today} day{pl - today === 1 ? "" : "s"} to go.
                </span>
            ) : (
                <span>
                    You're{" "}
                    <b style={{ color: under ? "var(--income)" : warnC }}>
                        {money0(Math.abs(diff))} {under ? "under" : "over"}
                    </b>{" "}
                    the pace line today — at this rate you'll finish at{" "}
                    <b className="tabular">{money0(projected)}</b>,{" "}
                    <b style={{ color: projected > budget ? expenseC : "var(--income)" }}>
                        {money0(Math.abs(projected - budget))}{" "}
                        {projected > budget ? "over" : "under"}
                    </b>
                    .
                </span>
            );
        } else {
            const typicalNow = avg ? (avg[today - 1] ?? 0) : 0;
            const diff = spentToDate - typicalNow;
            foot =
                avg && typicalNow > 0 ? (
                    <span>
                        You've spent <b className="tabular">{money0(spentToDate)}</b> so far —{" "}
                        <b style={{ color: diff <= 0 ? "var(--income)" : warnC }}>
                            {money0(Math.abs(diff))} {diff <= 0 ? "below" : "above"}
                        </b>{" "}
                        your typical pace by now.
                    </span>
                ) : (
                    <span>
                        Spent <b className="tabular">{money0(spentToDate)}</b> this month —
                        projected <b className="tabular">{money0(projected)}</b> by month end.
                    </span>
                );
        }

        const spendLegend: SpendChart["legend"] = [
            { label: "This period", kind: "solid", color: envelope.color },
        ];
        if (budget != null)
            spendLegend.push({
                label: "On-budget pace",
                kind: "dash",
                color: "var(--foreground)",
            });
        spendLegend.push({
            label: "Last period",
            kind: "dash",
            color: "var(--muted-foreground)",
        });
        // Only advertise "Typical" when the average line actually draws (its
        // endpoint is > 0) — an all-zero history has no visible line.
        if (avg && (avg[avg.length - 1] ?? 0) > 0)
            spendLegend.push({ label: "Typical", kind: "solid", color: "var(--income)" });
        // Matches the chart's own bar fillOpacity — a lighter tint of the
        // same envelope color, not a separate hue, since the bars are the
        // same "this period" series broken into daily amounts.
        spendLegend.push({
            label: "Daily spend",
            kind: "solid",
            color: `color-mix(in oklab, ${envelope.color} 45%, transparent)`,
        });

        return {
            kind: "spend",
            // Rolling envelopes show LIFETIME totals in the hero, so name the
            // month explicitly here to seam the two: this section is always
            // one month, even when the numbers above it are all-time.
            title: isMonthly
                ? `Spending pace — ${formatInAppTz(periodStart, "MMMM")}`
                : `This month's spending — ${formatInAppTz(periodStart, "MMMM")}`,
            subtitle: isMonthly
                ? "Cumulative spend vs. the pace that keeps you on budget — plus last month and your typical pace."
                : "This month only — the totals above are your all-time rolling pool.",
            legend: spendLegend,
            foot,
            race: {
                cur,
                prv,
                avg,
                today,
                daysInMonth: pl,
                projection: projected,
                bucketUnit: daily.bucketUnit,
                periodStart,
                budget,
                color: envelope.color,
                showToday: monthOffset === 0,
                archived,
                ariaLabel: `Spent ${money0(spentToDate)} so far${
                    budget != null ? ` of a ${money0(budget)} budget` : ""
                }, projected ${money0(projected)} by month end.${
                    budget != null && spentToDate > budget
                        ? " Currently over budget."
                        : budget != null && spentToDate > budget * (today / pl)
                          ? " Currently over the on-budget pace line."
                          : ""
                }`,
                emptyLabel:
                    isMonthly && total <= 0
                        ? canEdit
                            ? "Use Allocate above to set this month's amount, then your pace charts here."
                            : "No budget set for this month yet."
                        : "No spending logged yet — it'll chart here as you use this envelope.",
            },
        };
    }, [
        envelope,
        isGoal,
        dailyQuery.data,
        total,
        over,
        goalSaved,
        goalTarget,
        periodStart,
        monthOffset,
        canEdit,
        archived,
        goalSpent,
    ]);

    // KPI strip values
    const kpis = useMemo(() => {
        if (!envelope) return null;
        if (isGoal) {
            const now = new Date();
            const start = envelope.firstAllocatedAt ? new Date(envelope.firstAllocatedAt) : now;
            const months = Math.max(daysBetween(start, now) / 30, 0.001);
            const perMonth = goalSaved / months;
            const toGo = Math.max(0, goalTarget - goalSaved);
            const pct = goalTarget > 0 ? Math.round((goalSaved / goalTarget) * 100) : 0;
            const monthsToDeadline = envelope.targetDate
                ? daysBetween(now, new Date(envelope.targetDate)) / 30
                : null;
            return [
                {
                    label: "Avg / month",
                    val: money0(perMonth),
                    sub: "funded so far",
                    tone: "fg" as const,
                },
                { label: "% complete", val: `${pct}%`, sub: "of target", tone: "gold" as const },
                {
                    label: "Needed / mo",
                    val:
                        monthsToDeadline && monthsToDeadline > 0
                            ? money0(toGo / monthsToDeadline)
                            : "—",
                    sub: envelope.targetDate ? "to finish on time" : "no deadline",
                    tone: "fg" as const,
                },
                {
                    label: "Deadline",
                    val: envelope.targetDate ? formatInAppTz(envelope.targetDate, "MMM yyyy") : "—",
                    sub: envelope.targetDate ? "target date" : "none set",
                    tone: "fg" as const,
                },
            ];
        }
        const daily = dailyQuery.data;
        const spent = envelope.consumed;
        const pl = daily?.periodLength ?? 30;
        const today = daily ? Math.min(daily.today, pl) : 1;
        const projEnd = today > 0 ? (spent / today) * pl : spent;
        // Days remaining INCLUDING today (you can still spend today), so the
        // final day of the month reads "1 day left", hitting 0 only once the
        // period has rolled over. Uses the memoized `now` for consistency with
        // the rest of the page rather than a fresh Date.now().
        const daysLeft = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / DAY));
        const isPast = monthOffset < 0;
        const pctBudget = total > 0 ? Math.round((spent / total) * 100) : 0;
        // Same on-budget-pace math as the Spending pace chart's footnote
        // (budget * elapsed/total-days vs. spent-to-date) — surfaced here as
        // its own tile instead of a sentence below the chart, for the
        // current month only (a completed past period has no "today" to
        // pace against).
        const budget = envelope.cadence === "monthly" && total > 0 ? total : null;
        const paceNow = daily && budget != null ? (budget * today) / pl : null;
        const paceDiff = !isPast && paceNow != null ? spent - paceNow : null;
        const paceUnder = paceDiff != null && paceDiff <= 0;
        return [
            {
                label: "Last month",
                val: averages ? money0(averages.lastMonthSpend) : "—",
                sub:
                    averages && averages.lastMonthPlanned > 0
                        ? `${Math.round((averages.lastMonthSpend / averages.lastMonthPlanned) * 100)}% of plan`
                        : "spent",
                tone: "fg" as const,
            },
            {
                label: "3-month avg",
                val: averages ? money0(averages.avg3MonthSpend) : "—",
                sub: "per month",
                tone: "fg" as const,
            },
            {
                label: "Daily burn",
                val: velocity ? money0(velocity.perDayThisMonth) : "—",
                sub: isPast ? "avg per day" : "avg per day this month",
                tone: "fg" as const,
            },
            // "allocated", not "budget/plan" — same noun the hero and the
            // budgets-index tiles use.
            isPast
                ? {
                      label: "% of allocated",
                      val: total > 0 ? `${pctBudget}%` : "—",
                      sub: total > 0 ? "spent" : "no budget set",
                      tone: total > 0 && spent > total ? ("expense" as const) : ("fg" as const),
                  }
                : {
                      label: "Projected end",
                      val: daily ? money0(projEnd) : "—",
                      sub: "at current pace",
                      // Neutral when there's no budget — green would read
                      // "on track" against nothing (mirrors the index tile).
                      tone:
                          daily && total > 0
                              ? projEnd > total
                                  ? ("expense" as const)
                                  : ("income" as const)
                              : ("fg" as const),
                  },
            isPast
                ? {
                      label: spent > total ? "Over by" : "Left over",
                      val: total > 0 ? money0(Math.abs(total - spent)) : "—",
                      sub: "vs allocated",
                      tone: total > 0 && spent > total ? ("expense" as const) : ("income" as const),
                  }
                : {
                      label: "Days left",
                      val: String(daysLeft),
                      sub: "this month",
                      tone: "fg" as const,
                  },
            // Same two-tier severity as the chart's own over-pace escalation:
            // warn (amber) while merely ahead of pace but still within the
            // month's budget, expense (red) reserved for actually over the
            // whole budget — so this tile never screams louder than the
            // more serious "Over by" tile above it.
            paceDiff != null
                ? {
                      label: "Pace today",
                      val: money0(Math.abs(paceDiff)),
                      sub: paceUnder ? "under pace" : "over pace",
                      tone: paceUnder
                          ? ("income" as const)
                          : total > 0 && spent > total
                            ? ("expense" as const)
                            : ("warn" as const),
                  }
                : // Past tense on completed months; while the daily series
                  // loads, don't claim "no budget set" when one exists.
                  {
                      label: isPast ? "Pace" : "Pace today",
                      val: "—",
                      sub: isPast
                          ? "month completed"
                          : budget != null
                            ? "checking pace…"
                            : "no budget set",
                      tone: "fg" as const,
                  },
        ];
    }, [
        envelope,
        isGoal,
        dailyQuery.data,
        averages,
        velocity,
        total,
        goalSaved,
        goalTarget,
        periodEnd,
        monthOffset,
        now,
    ]);

    // status pill for the hero
    const status = useMemo((): { label: string; tone: Tone | "income" | "fg" } | null => {
        if (!envelope) return null;
        type S = { label: string; tone: Tone | "income" | "fg" };
        let result: S;
        if (isGoal) {
            result =
                goalSaved >= goalTarget
                    ? // Fund-then-spend: once you've spent against a reached
                      // goal, "Funded" reads more truthfully than a permanent
                      // "Goal reached" while the pool drains.
                      {
                          label: goalSpent > 0 ? "Funded" : "Goal reached",
                          tone: "gold",
                      }
                    : {
                          label: `${goalTarget > 0 ? Math.round((goalSaved / goalTarget) * 100) : 0}% funded`,
                          tone: "gold",
                      };
        } else if (over) {
            result = { label: "Over budget", tone: "expense" };
        } else {
            const daily = dailyQuery.data;
            const pl = daily?.periodLength ?? 0;
            const today = daily ? Math.min(daily.today, pl) : 0;
            const projEnd = today > 0 ? (envelope.consumed / today) * pl : 0;
            // Only warn "Trending over" once the month is at least half gone
            // (an early large payment shouldn't project a scary overspend from
            // 3 days of noise) AND the projection clears budget by >10%. Orbit
            // shows overspend, it doesn't nag about a maybe.
            if (
                daily &&
                envelope.cadence === "monthly" &&
                total > 0 &&
                today / pl >= 0.5 &&
                projEnd > total * 1.1
            ) {
                result = { label: "Trending over", tone: "warn" };
            } else if (total > 0) {
                result = { label: "On track", tone: "income" };
            } else {
                result = { label: "No budget set", tone: "fg" };
            }
        }
        // Archived envelopes are frozen/read-only — never flash a red or amber
        // alarm on them. Keep the informative label, but neutralize the tone.
        if (envelope.archived && (result.tone === "expense" || result.tone === "warn")) {
            return { ...result, tone: "fg" };
        }
        return result;
    }, [envelope, isGoal, over, dailyQuery.data, total, goalSaved, goalTarget, goalSpent]);

    return (
        <div className="orbit-design ed-root">
            <style>{ED_STYLES}</style>

            {/* Topbar */}
            <header className="ed-topbar">
                <div className="ed-topbar-text">
                    <span className="eyebrow ed-breadcrumb">
                        <Link to={ROUTES.spaceBudgets(space.id)} className="ed-crumb">
                            Budgets
                        </Link>
                        <ChevronRight className="size-3" style={{ color: "var(--fg-4)" }} />{" "}
                        <span style={{ color: "var(--fg-2)" }}>{envelope?.name ?? "Loading…"}</span>
                    </span>
                    <h1 className="display ed-title">
                        {envelope ? (
                            <>
                                <Avatar icon={envelope.icon} color={envelope.color} size={36} />
                                {envelope.name}
                                {envelope.archived && (
                                    <span className="ed-archived-badge">Archived</span>
                                )}
                            </>
                        ) : (
                            "Envelope"
                        )}
                    </h1>
                    <p className="ed-sub">
                        {envelope
                            ? `${isGoal ? "Goal" : envelope.cadence === "monthly" ? "Monthly" : "Rolling"}${
                                  envelope.description ? ` · ${envelope.description}` : ""
                              }`
                            : "Utilization and recent activity"}
                    </p>
                </div>
                <div className="ed-topbar-actions">
                    {/* Month stepper — only for monthly envelopes, where the
                        whole page re-prices per month. Rolling/goal envelopes
                        are a single lifetime pool (their hero can't move with
                        the month), so a stepper there would disagree with
                        itself. */}
                    {envelope && envelope.cadence === "monthly" && (
                        <div className="ed-month-nav" role="group" aria-label="Month">
                            <button
                                type="button"
                                className="ed-mo-arrow"
                                onClick={() => setMonthOffset((m) => m - 1)}
                                aria-label="Previous month"
                            >
                                <ChevronLeft className="size-3.5" />
                            </button>
                            <span className="ed-mo-label">{monthLabel}</span>
                            <button
                                type="button"
                                className="ed-mo-arrow"
                                onClick={() => setMonthOffset((m) => Math.min(0, m + 1))}
                                disabled={monthOffset >= 0}
                                aria-label="Next month"
                            >
                                <ChevronRight className="size-3.5" />
                            </button>
                        </div>
                    )}
                    {envelope && !envelope.archived && (
                        <PermissionGate roles={["owner", "editor"]}>
                            <EnvelopeAllocateDialog
                                envelopId={envelope.envelopId}
                                envelopCadence={envelope.cadence}
                                direction="allocate"
                                trigger={
                                    <button type="button" className="od-btn">
                                        Allocate
                                    </button>
                                }
                            />
                            <EnvelopeAllocateDialog
                                envelopId={envelope.envelopId}
                                envelopCadence={envelope.cadence}
                                direction="deallocate"
                                trigger={
                                    <button type="button" className="od-btn">
                                        Deallocate
                                    </button>
                                }
                            />
                            <EnvelopeTopUpDialog
                                envelopId={envelope.envelopId}
                                envelopeName={envelope.name}
                                envelopeColor={envelope.color}
                                trigger={
                                    <button type="button" className="od-btn">
                                        <Coins className="size-3.5" /> Top up…
                                    </button>
                                }
                            />
                            <EnvelopeMoveDialog
                                sourceEnvelopId={envelope.envelopId}
                                sourceEnvelopeName={envelope.name}
                                sourceEnvelopeColor={envelope.color}
                                trigger={
                                    <button type="button" className="od-btn">
                                        <ArrowRightLeft className="size-3.5" /> Move to…
                                    </button>
                                }
                            />
                        </PermissionGate>
                    )}
                    {envelope?.archived && envelope.remaining > 0 && (
                        <PermissionGate roles={["owner", "editor"]}>
                            <EnvelopeAllocateDialog
                                envelopId={envelope.envelopId}
                                envelopCadence={envelope.cadence}
                                direction="deallocate"
                                trigger={
                                    <button type="button" className="od-btn">
                                        Free trapped cash
                                    </button>
                                }
                            />
                        </PermissionGate>
                    )}
                    {envelope?.archived && (
                        <PermissionGate roles={["owner"]}>
                            <UnarchiveButton envelopId={envelope.envelopId} spaceId={space.id} />
                        </PermissionGate>
                    )}
                    {envelope && !envelope.archived && (
                        <PermissionGate roles={["owner"]}>
                            <button
                                type="button"
                                className="od-btn od-btn-primary"
                                onClick={() => setEditOpen(true)}
                            >
                                <Pencil className="size-3.5" /> Edit
                            </button>
                            <CreateOrEditEnvelopeDialog
                                envelope={{
                                    envelopId: envelope.envelopId,
                                    name: envelope.name,
                                    color: envelope.color,
                                    icon: envelope.icon,
                                    description: envelope.description,
                                    cadence: envelope.cadence,
                                    targetAmount: envelope.targetAmount,
                                    targetDate: envelope.targetDate,
                                }}
                                open={editOpen}
                                onOpenChange={setEditOpen}
                                hideDefaultTrigger
                            />
                        </PermissionGate>
                    )}
                </div>
            </header>

            <div className="ed-scroll">
                {/* Hero: glass + numbers */}
                {envelope ? (
                    <section className="od-card ed-hero">
                        <div className="ed-hero-glass">
                            <EnvelopeGlass
                                variant={isGoal ? "save" : "spend"}
                                current={isGoal ? goalSaved : envelope.consumed}
                                total={isGoal ? goalTarget : total}
                                height={168}
                                color={envelope.color}
                            />
                        </div>
                        <div className="ed-hero-body">
                            <div className="ed-hero-nums">
                                {isGoal ? (
                                    <>
                                        <HeroNum label="Saved" value={goalSaved} tone="gold" />
                                        <span className="ed-hero-div" />
                                        <HeroNum label="Target" value={goalTarget} tone="fg" />
                                        <span className="ed-hero-div" />
                                        {goalSpent > 0 ? (
                                            <HeroNum label="Spent" value={goalSpent} tone="fg" />
                                        ) : (
                                            <HeroNum
                                                label="To go"
                                                value={Math.max(0, goalTarget - goalSaved)}
                                                tone="fg"
                                            />
                                        )}
                                    </>
                                ) : noBudget ? (
                                    <>
                                        <HeroNum label="Allocated" value={0} tone="fg" />
                                        <span className="ed-hero-div" />
                                        <HeroNum
                                            label="Spent"
                                            value={envelope.consumed}
                                            tone="fg"
                                        />
                                    </>
                                ) : (
                                    <>
                                        <HeroNum label="Allocated" value={total} tone="fg" />
                                        <span className="ed-hero-div" />
                                        <HeroNum
                                            label="Spent"
                                            value={envelope.consumed}
                                            tone="brand"
                                        />
                                        <span className="ed-hero-div" />
                                        <HeroNum
                                            label={over ? "Over by" : "Remaining"}
                                            value={Math.abs(remaining)}
                                            tone={muteTone(over ? "expense" : "gold")}
                                        />
                                    </>
                                )}
                            </div>
                            {status && (
                                <div className="ed-hero-status">
                                    {(() => {
                                        const pillColor =
                                            status.tone === "income"
                                                ? "var(--income)"
                                                : status.tone === "fg"
                                                  ? "var(--fg-3)"
                                                  : toneVar[status.tone];
                                        return (
                                            <span
                                                className="ed-pill"
                                                style={{
                                                    color: pillColor,
                                                    background: `color-mix(in oklab, ${pillColor} 12%, transparent)`,
                                                    borderColor: `color-mix(in oklab, ${pillColor} 28%, transparent)`,
                                                }}
                                            >
                                                {status.label}
                                            </span>
                                        );
                                    })()}
                                    <span className="ed-status-note">
                                        {isGoal
                                            ? envelope.targetDate
                                                ? `Target by ${formatInAppTz(envelope.targetDate, "MMM d, yyyy")}`
                                                : "No deadline set"
                                            : envelope.cadence === "monthly"
                                              ? `${monthLabel}`
                                              : "Rolling · lifetime total"}
                                    </span>
                                </div>
                            )}
                        </div>
                        {kpis && (
                            <div className="ed-hero-facts">
                                {kpis.map((k) => (
                                    <div key={k.label} className="ed-fact">
                                        <span className="ed-fact-label">{k.label}</span>
                                        <span
                                            className="ed-fact-val tabular"
                                            style={{ color: factColor(muteTone(k.tone)) }}
                                        >
                                            {k.val}
                                        </span>
                                        <span className="ed-fact-sub">{k.sub}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                ) : utilizationQuery.isLoading ? (
                    <Skeleton height={200} />
                ) : (
                    <div className="od-card ed-hero">
                        <p style={{ color: "var(--fg-3)", fontSize: 13 }}>
                            This envelope no longer exists.{" "}
                            <Link to={ROUTES.spaceBudgets(space.id)} className="ed-crumb">
                                Back to budgets
                            </Link>
                        </p>
                    </div>
                )}

                {/* Pace chart */}
                {envelope && (
                    <section className="od-card ed-chart">
                        <div className="ed-sect-head">
                            <div className="ed-sect-text">
                                <h2 className="display ed-sect-title">
                                    {chart?.title ?? "Spending pace"}
                                </h2>
                                <span className="ed-sect-sub">{chart?.subtitle ?? ""}</span>
                            </div>
                            {chart?.legend && (
                                <div className="ed-legend">
                                    {chart.legend.map((l) => (
                                        <span key={l.label}>
                                            <i
                                                className={`ed-sw ed-sw-${l.kind}`}
                                                style={
                                                    l.kind === "solid"
                                                        ? { background: l.color }
                                                        : ({
                                                              ["--c" as never]: l.color,
                                                          } as CSSProperties)
                                                }
                                            />
                                            {l.label}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                        {chart?.kind === "goal" ? (
                            <>
                                <div className="ed-chart-wrap">
                                    <EnvelopePaceChart {...chart.props} />
                                </div>
                                <div className="ed-chart-foot">{chart.foot}</div>
                            </>
                        ) : chart?.kind === "spend" ? (
                            <>
                                <div className="ed-chart-wrap">
                                    <EnvelopeSpendChart {...chart.race} />
                                </div>
                                {chart.foot && <div className="ed-chart-foot">{chart.foot}</div>}
                            </>
                        ) : dailyQuery.isLoading && !isGoal ? (
                            // Matches the loaded chart-wrap + foot-text block's
                            // measured height (~540 + ~40px) so the loading→
                            // loaded transition doesn't snap the card taller
                            // once data arrives.
                            <Skeleton height={580} />
                        ) : (
                            <div className="ed-empty">
                                {total > 0
                                    ? "Spending will chart here as you log transactions."
                                    : canEdit
                                      ? "Use Allocate above to set an amount, then this pace chart fills in as you spend."
                                      : "No budget set for this envelope yet."}
                            </div>
                        )}
                    </section>
                )}

                {/* Monthly spend, Where it went, and Velocity — one
                    analytics row, three columns. "Daily burn" (per day
                    this month) already lives in the hero KPI strip above;
                    this row covers the rest: the trailing-12-month bar
                    chart, the spend-by-category donut, and a visual
                    this/last/typical comparison + acceleration. Monthly
                    spend and Velocity are monthly/rolling-only — goals
                    fund via allocations rather than categorized spend, so
                    a goal envelope renders the donut alone. */}
                {envelope &&
                    (() => {
                        const columns: ReactNode[] = [];
                        if (!isGoal) {
                            columns.push(
                                <div className="ed-row3-col" key="monthly">
                                    <div className="ed-row3-head">
                                        <h2 className="display ed-row3-title">Monthly spend</h2>
                                        <span className="ed-row3-sub">
                                            {envelope.cadence === "monthly"
                                                ? `Spent vs allocated · ${monthly?.year ?? "this year"}`
                                                : monthly
                                                  ? `${monthly.year} vs ${monthly.year - 1}`
                                                  : "This year vs last"}
                                        </span>
                                    </div>
                                    {(() => {
                                        const isMonthlyCadence = envelope.cadence === "monthly";
                                        const allocatedArr = isMonthlyCadence
                                            ? (allocQuery.data?.allocated ?? null)
                                            : null;
                                        const hasAllocData =
                                            allocatedArr?.some((v) => v > 0) ?? false;
                                        const hasData = (monthly?.hasData ?? false) || hasAllocData;
                                        // Window the allocated sum to the same
                                        // year-to-date range as `ytdSpent` — summing
                                        // all 12 months (including ones that haven't
                                        // happened yet) against a YTD spend figure
                                        // would flip the over/under verdict for any
                                        // envelope mid-way through the current year.
                                        const ytdAllocated = allocatedArr
                                            ? allocatedArr
                                                  .slice(0, monthly?.windowMonths ?? 12)
                                                  .reduce((s, v) => s + v, 0)
                                            : 0;
                                        const overAlloc =
                                            ytdAllocated > 0 &&
                                            (monthly?.ytdSpent ?? 0) > ytdAllocated;
                                        return yoyQuery.isLoading ||
                                            (isMonthlyCadence && allocQuery.isLoading) ? (
                                            <Skeleton height={200} />
                                        ) : !monthly || !hasData ? (
                                            <div className="ed-empty">
                                                No monthly spend history yet.
                                            </div>
                                        ) : (
                                            <>
                                                <div className="ed-chart-wrap">
                                                    <EnvelopeMonthlyBars
                                                        labels={monthly.months}
                                                        thisYear={monthly.thisYear}
                                                        lastYear={monthly.lastYear}
                                                        allocated={allocatedArr}
                                                        yearThis={monthly.year}
                                                        yearLast={monthly.year - 1}
                                                        color={envelope.color}
                                                    />
                                                </div>
                                                {isMonthlyCadence
                                                    ? ytdAllocated > 0 && (
                                                          <div className="ed-chart-foot">
                                                              Spent{" "}
                                                              <b className="tabular">
                                                                  {money0(monthly.ytdSpent)}
                                                              </b>{" "}
                                                              of{" "}
                                                              <b className="tabular">
                                                                  {money0(ytdAllocated)}
                                                              </b>{" "}
                                                              allocated so far this year —{" "}
                                                              <b
                                                                  style={{
                                                                      color: overAlloc
                                                                          ? "var(--expense)"
                                                                          : "var(--income)",
                                                                  }}
                                                              >
                                                                  {money0(
                                                                      Math.abs(
                                                                          monthly.ytdSpent -
                                                                              ytdAllocated
                                                                      )
                                                                  )}{" "}
                                                                  {overAlloc ? "over" : "under"}
                                                              </b>
                                                              .
                                                          </div>
                                                      )
                                                    : monthly.totalDelta != null && (
                                                          <div className="ed-chart-foot">
                                                              <b
                                                                  style={{
                                                                      color:
                                                                          monthly.totalDelta > 0
                                                                              ? "var(--expense)"
                                                                              : "var(--income)",
                                                                  }}
                                                              >
                                                                  {monthly.totalDelta >= 0
                                                                      ? "+"
                                                                      : ""}
                                                                  {monthly.totalDelta.toFixed(0)}%
                                                              </b>{" "}
                                                              · this year vs last year (so far)
                                                          </div>
                                                      )}
                                            </>
                                        );
                                    })()}
                                </div>
                            );
                        }

                        columns.push(
                            <div className="ed-row3-col ed-row3-col-donut" key="donut">
                                <div className="ed-row3-head">
                                    <h2 className="display ed-row3-title">Where it went</h2>
                                    <span className="ed-row3-sub">
                                        {envelope.cadence === "monthly"
                                            ? `By category · ${monthLabel}`
                                            : "By category this month"}
                                    </span>
                                </div>
                                {catQuery.isLoading ? (
                                    <Skeleton height={220} />
                                ) : catData.length === 0 ? (
                                    <div className="ed-empty">
                                        {monthOffset < 0
                                            ? `No spending in this envelope in ${monthLabel}.`
                                            : "No spending logged yet."}
                                    </div>
                                ) : (
                                    <Donut
                                        data={donutSlices}
                                        centerLabel="Spent"
                                        centerValue={catTotal}
                                        height={220}
                                        hideLegend
                                        hideTooltip
                                    />
                                )}
                            </div>
                        );

                        if (!isGoal) {
                            columns.push(
                                <div className="ed-row3-col" key="velocity">
                                    <div className="ed-row3-head">
                                        <h2 className="display ed-row3-title">Velocity</h2>
                                        <span className="ed-row3-sub">
                                            Per day, how fast money is leaving.
                                        </span>
                                    </div>
                                    {velocity ? (
                                        <VelocityViz
                                            thisMonth={velocity.perDayThisMonth}
                                            lastMonth={velocity.perDayLastMonth}
                                            typical={velocity.perDayTypical}
                                            acceleration={velocity.acceleration}
                                            color={envelope.color}
                                        />
                                    ) : (
                                        <Skeleton height={180} />
                                    )}
                                </div>
                            );
                        }

                        return (
                            <section className="od-card ed-row3">
                                {columns.map((col, i) => (
                                    <Fragment key={i}>
                                        {i > 0 && <div className="ed-row3-divider" />}
                                        {col}
                                    </Fragment>
                                ))}
                            </section>
                        );
                    })()}
            </div>
        </div>
    );
}

/** A small set of "nice" gridline values for [0, yMax]. Bounded to ~5 ticks
 * (never loops on tiny/fractional targets) and no rounding (so sub-unit
 * targets don't collapse to duplicate zeros — fmtY handles display). */
function niceTicks(yMax: number): number[] {
    if (!(yMax > 0)) return [0];
    const step = niceStep(yMax / 4);
    if (!(step > 0)) return [0, yMax];
    const ticks: number[] = [];
    for (let v = 0; v <= yMax + step * 0.001 && ticks.length < 8; v += step) {
        ticks.push(v);
    }
    return ticks;
}
function niceStep(raw: number): number {
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return nice * mag;
}

function factColor(tone: string): string {
    return tone === "brand"
        ? "var(--brand)"
        : tone === "gold"
          ? "var(--gold)"
          : tone === "expense"
            ? "var(--expense)"
            : tone === "income"
              ? "var(--income)"
              : tone === "warn"
                ? "var(--warn)"
                : "var(--fg)";
}

/** Velocity as a visual — a mini bullet-style bar comparison (this month /
 * last month / typical, all scaled to their shared max, value labeled
 * directly so the comparison never depends on hover) plus an acceleration
 * stat that pairs an icon with the signed percentage — direction is never
 * color-only. */
function VelocityViz({
    thisMonth,
    lastMonth,
    typical,
    acceleration,
    color,
}: {
    thisMonth: number;
    lastMonth: number;
    typical: number | null;
    acceleration: number | null;
    /** Envelope's own color. These three bars are the same metric at
     *  different time windows, so they're a single-hue value scale (full
     *  strength → muted → light outline) rather than unrelated hues per
     *  row — that reads as "comparable values," ties this panel to the
     *  same identity as the pace chart and Monthly spend bars above it,
     *  and avoids reusing tokens (--transfer, --ent-4) that already mean
     *  something specific elsewhere in the app (transfer transactions,
     *  another envelope's own color). */
    color: string;
}) {
    const bars = [
        {
            label: "This month",
            value: thisMonth,
            kind: "solid" as const,
            color,
            track: `color-mix(in oklab, ${color} 14%, transparent)`,
        },
        {
            label: "Last month",
            value: lastMonth,
            kind: "solid" as const,
            // Fade toward transparent (alpha), not toward a fixed opaque
            // color like --fg-3 — mixing a dark envelope color *up* toward
            // a light gray would make "Last month" visually louder than
            // "This month" instead of receding, inverting the hierarchy.
            // Alpha-fading never inverts that way, though a very dark base
            // color will still look faint here — acceptable since the
            // exact value is always labeled in text right next to the bar.
            color: `color-mix(in oklab, ${color} 62%, transparent)`,
            track: `color-mix(in oklab, ${color} 8%, transparent)`,
        },
        ...(typical != null
            ? [
                  {
                      label: "Typical",
                      value: typical,
                      kind: "outline" as const,
                      color: `color-mix(in oklab, ${color} 70%, transparent)`,
                      track: `color-mix(in oklab, ${color} 8%, transparent)`,
                  },
              ]
            : []),
    ];
    const max = Math.max(1, ...bars.map((b) => b.value));
    const accelerating = acceleration != null && acceleration >= 0;
    return (
        <div className="ed-velocity-viz">
            <div className="ed-vbar-rows">
                {bars.map((b) => (
                    <div key={b.label} className="ed-vbar-row">
                        <span className="ed-vbar-label">{b.label}</span>
                        <div className="ed-vbar-track" style={{ background: b.track }}>
                            <div
                                className={
                                    b.kind === "outline"
                                        ? "ed-vbar-fill ed-vbar-fill-outline"
                                        : "ed-vbar-fill"
                                }
                                style={{
                                    width: `${Math.max(3, (b.value / max) * 100)}%`,
                                    ...(b.kind === "outline"
                                        ? { borderColor: b.color }
                                        : { background: b.color }),
                                }}
                            />
                        </div>
                        <span className="ed-vbar-val tabular">{money0(b.value)}</span>
                    </div>
                ))}
            </div>
            <div
                className="ed-vaccel"
                style={{
                    background:
                        acceleration != null
                            ? accelerating
                                ? "var(--expense-soft)"
                                : "var(--income-soft)"
                            : "var(--bg-elev-1)",
                }}
            >
                {acceleration != null ? (
                    <>
                        {accelerating ? (
                            <TrendingUp size={15} style={{ color: "var(--expense)" }} />
                        ) : (
                            <TrendingDown size={15} style={{ color: "var(--income)" }} />
                        )}
                        <span
                            className="ed-vaccel-val tabular"
                            style={{ color: accelerating ? "var(--expense)" : "var(--income)" }}
                        >
                            {acceleration >= 0 ? "+" : ""}
                            {acceleration.toFixed(1)}%
                        </span>
                        <span className="ed-vaccel-sub">vs last month's pace</span>
                    </>
                ) : (
                    <span className="ed-vaccel-sub">No spend last month to compare</span>
                )}
            </div>
        </div>
    );
}

/** Trailing-12-month bar chart, this year (solid) vs last year (faded),
 *  scoped to a single envelope. Same shape as the Spending Trends page's
 *  YoY chart, adapted to this page's own hover-tooltip convention (the
 *  Tailwind/shadcn tokens already used by EnvelopeSpendChart's tooltip
 *  right above this section on the page). */
function EnvelopeMonthlyBars({
    labels,
    thisYear,
    lastYear,
    allocated,
    yearThis,
    yearLast,
    color,
}: {
    labels: string[];
    thisYear: number[];
    lastYear: number[];
    /** Monthly-cadence envelopes only — when present, renders a bullet-style
     *  spent-bar + allocated-marker per month instead of the this/last-year
     *  comparison (rolling/goal envelopes have no per-month allocation). */
    allocated?: number[] | null;
    yearThis: number;
    yearLast: number;
    /** Envelope's own color — themes the "spent"/"this year" series, same
     *  as EnvelopeSpendChart's pace line right above this section, so the
     *  page's charts read as one consistent identity per envelope instead
     *  of an unrelated fixed palette. */
    color: string;
}) {
    const bulletMode = !!allocated;
    const w = 600;
    const h = 220;
    const p = 28;
    const rawMax = Math.max(0, ...thisYear, ...(bulletMode ? allocated : lastYear));
    // A little headroom above the tallest bar/marker so a month that's
    // exactly at (or over) its allocation doesn't clip its marker line
    // against the chart's top edge.
    const max = rawMax > 0 ? rawMax * 1.08 : 1;
    const cw = labels.length > 0 ? (w - p * 2) / labels.length : 0;
    const bw = bulletMode ? cw - 10 : (cw - 6) / 2;
    const sy = (v: number) => h - p - (v / max) * (h - p * 2);
    const xPct = (svgX: number) => (svgX / w) * 100;

    const containerRef = useRef<HTMLDivElement>(null);
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const setIdxFromClientX = (clientX: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || labels.length === 0) return;
        const svgX = ((clientX - rect.left) / rect.width) * w;
        const idx = Math.max(0, Math.min(labels.length - 1, Math.floor((svgX - p) / cw)));
        setHoverIdx(idx);
    };
    const handleMove: React.MouseEventHandler<HTMLDivElement> = (e) => setIdxFromClientX(e.clientX);
    const handleTouch = (e: ReactTouchEvent<HTMLDivElement>) => {
        const t = e.touches[0];
        if (t) setIdxFromClientX(t.clientX);
    };

    return (
        <div className="ed-monthly-bars">
            <div className="ed-legend">
                {bulletMode ? (
                    <>
                        <span>
                            <i className="ed-sw" style={{ background: color }} />
                            Spent
                        </span>
                        <span>
                            <i className="ed-sw ed-sw-marker" />
                            Allocated
                        </span>
                        <span>
                            <i className="ed-sw" style={{ background: "var(--expense)" }} />
                            Over
                        </span>
                    </>
                ) : (
                    <>
                        <span>
                            <i className="ed-sw" style={{ background: color }} />
                            {yearThis}
                        </span>
                        <span>
                            <i className="ed-sw" style={{ background: "var(--fg-3)" }} />
                            {yearLast}
                        </span>
                    </>
                )}
            </div>
            <div
                ref={containerRef}
                className="relative w-full"
                style={{ height: h, touchAction: "pan-y" }}
                onMouseMove={handleMove}
                onMouseLeave={() => setHoverIdx(null)}
                onTouchStart={handleTouch}
                onTouchMove={handleTouch}
                onTouchEnd={() => setHoverIdx(null)}
            >
                <svg
                    viewBox={`0 0 ${w} ${h}`}
                    width="100%"
                    height="100%"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={
                        bulletMode
                            ? "Monthly spend vs allocated"
                            : "Monthly spend, this year vs last year"
                    }
                >
                    {[0, 1, 2, 3].map((i) => (
                        <line
                            key={i}
                            x1={p}
                            x2={w - p}
                            y1={p + (i * (h - p * 2)) / 3}
                            y2={p + (i * (h - p * 2)) / 3}
                            stroke="var(--line-soft)"
                        />
                    ))}
                    {labels.map((l, i) => {
                        const isHover = hoverIdx === i;
                        if (bulletMode) {
                            const cx = p + i * cw + 5;
                            const alloc = allocated[i] ?? 0;
                            const spent = thisYear[i] ?? 0;
                            const isOver = alloc > 0 && spent > alloc;
                            const ySpent = sy(spent);
                            const yAlloc = sy(alloc);
                            return (
                                <g key={l}>
                                    {isOver ? (
                                        <>
                                            <rect
                                                x={cx}
                                                y={yAlloc}
                                                width={bw}
                                                height={h - p - yAlloc}
                                                fill={color}
                                                opacity={isHover ? 1 : 0.85}
                                                rx={2}
                                            />
                                            {/* Over-allocation cap — the part of
                                                the bar past the white marker
                                                colors red, so overspending a
                                                month is visible at a glance,
                                                not just via the marker line. */}
                                            <rect
                                                x={cx}
                                                y={ySpent}
                                                width={bw}
                                                height={yAlloc - ySpent}
                                                fill="var(--expense)"
                                                opacity={isHover ? 1 : 0.9}
                                                rx={2}
                                            />
                                        </>
                                    ) : (
                                        <rect
                                            x={cx}
                                            y={ySpent}
                                            width={bw}
                                            height={h - p - ySpent}
                                            fill={color}
                                            opacity={isHover ? 1 : 0.85}
                                            rx={2}
                                        />
                                    )}
                                    {alloc > 0 && (
                                        <line
                                            x1={cx - 3}
                                            x2={cx + bw + 3}
                                            y1={yAlloc}
                                            y2={yAlloc}
                                            stroke="var(--fg)"
                                            strokeWidth={2.5}
                                        />
                                    )}
                                </g>
                            );
                        }
                        const cx = p + i * cw + 3;
                        const yt = sy(thisYear[i] ?? 0);
                        const yl = sy(lastYear[i] ?? 0);
                        return (
                            <g key={l}>
                                <rect
                                    x={cx}
                                    y={yl}
                                    width={bw}
                                    height={h - p - yl}
                                    fill="var(--fg-3)"
                                    opacity={isHover ? 0.55 : 0.35}
                                    rx={2}
                                />
                                <rect
                                    x={cx + bw + 2}
                                    y={yt}
                                    width={bw}
                                    height={h - p - yt}
                                    fill={color}
                                    opacity={isHover ? 1 : 0.9}
                                    rx={2}
                                />
                            </g>
                        );
                    })}
                </svg>

                {[0, 1, 2, 3].map((i) => {
                    const yPx = p + (i * (h - p * 2)) / 3;
                    const value = ((3 - i) * max) / 3;
                    return (
                        <span
                            key={`yt-${i}`}
                            className="absolute text-[10px] tabular-nums text-muted-foreground"
                            style={{
                                left: `${xPct(p - 4)}%`,
                                top: yPx,
                                transform: "translate(-100%, -50%)",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {compactMoney(value)}
                        </span>
                    );
                })}

                {labels.map((l, i) => {
                    const cx = bulletMode ? p + i * cw + 5 + bw / 2 : p + i * cw + 3 + bw + 1;
                    return (
                        <span
                            key={l}
                            className="absolute text-[10.5px] text-muted-foreground"
                            style={{
                                left: `${xPct(cx)}%`,
                                top: h - p + 4,
                                transform: "translateX(-50%)",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {l}
                        </span>
                    );
                })}

                {hoverIdx !== null ? (
                    <div
                        className="pointer-events-none absolute z-10 min-w-[150px] rounded-md border border-border bg-card px-3 py-2 text-[11px] shadow-lg"
                        style={{
                            left: `${xPct(p + hoverIdx * cw + cw / 2)}%`,
                            top: 8,
                            maxWidth: "min(200px, calc(100% - 16px))",
                            transform:
                                hoverIdx >= labels.length / 2
                                    ? "translateX(calc(-100% - 12px))"
                                    : "translateX(12px)",
                        }}
                    >
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            {labels[hoverIdx]}
                        </div>
                        {bulletMode ? (
                            <>
                                <MonthlyTooltipRow
                                    label="Spent"
                                    value={thisYear[hoverIdx] ?? 0}
                                    color={color}
                                />
                                <MonthlyTooltipRow
                                    label="Allocated"
                                    value={allocated[hoverIdx] ?? 0}
                                    color="var(--fg)"
                                />
                            </>
                        ) : (
                            <>
                                <MonthlyTooltipRow
                                    label={String(yearThis)}
                                    value={thisYear[hoverIdx] ?? 0}
                                    color={color}
                                />
                                <MonthlyTooltipRow
                                    label={String(yearLast)}
                                    value={lastYear[hoverIdx] ?? 0}
                                    color="var(--fg-3)"
                                />
                            </>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function MonthlyTooltipRow({
    label,
    value,
    color,
}: {
    label: string;
    value: number;
    color: string;
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-foreground/85">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
                {label}
            </span>
            <span className="tabular-nums font-medium">{money0(value)}</span>
        </div>
    );
}

function HeroNum({ label, value, tone }: { label: string; value: number; tone: Tone | "fg" }) {
    const color =
        tone === "fg"
            ? "var(--fg)"
            : tone === "brand"
              ? "var(--brand)"
              : tone === "gold"
                ? "var(--gold)"
                : tone === "expense"
                  ? "var(--expense)"
                  : "var(--warn)";
    return (
        <div className="ed-hero-num">
            <span className="ed-hero-num-label">{label}</span>
            <span className="ed-hero-num-val tabular" style={{ color }}>
                {money2(value)}
            </span>
        </div>
    );
}

function UnarchiveButton({ envelopId, spaceId }: { envelopId: string; spaceId: string }) {
    const utils = trpc.useUtils();
    const mutation = trpc.envelop.archive.useMutation({
        onSuccess: async () => {
            toast.success("Unarchived");
            await Promise.all([
                utils.envelop.listBySpace.invalidate({ spaceId }),
                utils.analytics.envelopeUtilization.invalidate({ spaceId }),
                utils.analytics.spaceSummary.invalidate(),
            ]);
        },
        onError: (e) => toast.error(e.message),
    });
    return (
        <button
            type="button"
            className="od-btn od-btn-primary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ envelopId, archived: false })}
        >
            <ArchiveRestore className="size-3.5" />
            {mutation.isPending ? "Unarchiving…" : "Unarchive"}
        </button>
    );
}

function Avatar({ icon, color, size = 32 }: { icon: string; color: string; size?: number }) {
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
                background: `color-mix(in oklab, ${color} 18%, transparent)`,
                border: `1px solid color-mix(in oklab, ${color} 30%, transparent)`,
                color: color,
                flexShrink: 0,
            }}
        >
            <IconCmp size={size * 0.5} color={color} strokeWidth={1.7} />
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

const ED_STYLES = `
.ed-root {
    margin: -1.5rem -1rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
}
@media (min-width: 768px) { .ed-root { margin: -2rem; } }

.ed-topbar {
    padding: 26px 32px 18px;
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    background: var(--bg);
    flex-wrap: wrap;
}
.ed-topbar-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ed-breadcrumb { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; }
.ed-crumb { color: var(--fg-3); text-decoration: none; transition: color 140ms ease; border-radius: 6px; }
.ed-crumb:hover { color: var(--fg); }
.ed-crumb:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.ed-title {
    font-size: 26px; font-weight: 500; letter-spacing: -0.02em; color: var(--fg);
    margin: 0; display: inline-flex; align-items: center; gap: 14px;
}
.ed-sub { font-size: 13px; color: var(--fg-3); margin: 0; }
.ed-archived-badge {
    display: inline-flex; align-items: center; height: 20px; padding: 0 8px; margin-left: 10px;
    border-radius: 999px; background: var(--bg-elev-3); color: var(--fg-3);
    font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; vertical-align: middle;
}
.ed-topbar-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
/* Month stepper — browse this envelope across months. */
.ed-month-nav {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 4px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg-elev-1);
    margin-right: 4px;
}
.ed-mo-arrow {
    width: 34px;
    height: 34px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-3);
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
}
.ed-mo-arrow:hover:not(:disabled) { background: var(--bg-elev-2); color: var(--fg); }
.ed-mo-arrow:disabled { opacity: 0.4; cursor: not-allowed; }
.ed-mo-arrow:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
@media (max-width: 640px) { .ed-mo-arrow { width: 44px; height: 44px; } }
.ed-mo-label {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--fg);
    min-width: 82px;
    text-align: center;
    font-variant-numeric: tabular-nums;
}
@media (max-width: 720px) { .ed-topbar { padding: 18px 18px 14px; } }

.ed-scroll {
    flex: 1;
    padding: 22px 32px 40px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
}
@media (max-width: 720px) { .ed-scroll { padding: 16px 18px 28px; } }

/* Hero */
.orbit-design .od-card.ed-hero {
    padding: 22px 24px;
    display: flex;
    align-items: center;
    gap: 28px;
    flex-wrap: wrap;
}
.ed-hero-glass { flex: 0 0 auto; }
.ed-hero-body { flex: 1 1 240px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.ed-hero-nums { display: flex; align-items: center; gap: 26px; flex-wrap: wrap; }
.ed-hero-num { display: flex; flex-direction: column; gap: 3px; }
.ed-hero-num-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--fg-3); font-weight: 500; }
.ed-hero-num-val { font-size: 30px; font-weight: 500; letter-spacing: -0.03em; }
.ed-hero-div { width: 1px; align-self: stretch; min-height: 42px; background: var(--line-soft); }
@media (max-width: 520px) { .ed-hero-div { display: none; } .ed-hero-nums { gap: 18px; } }
.ed-hero-status { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ed-pill { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; border: 1px solid transparent; }
.ed-status-note { font-size: 12.5px; color: var(--fg-3); }
/* Secondary facts, right side of the hero — fills the space that was empty
   and consolidates the old separate KPI strip. */
.ed-hero-facts {
    flex: 1 1 300px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px 24px;
    align-self: stretch;
    align-content: center;
    padding-left: 28px;
    border-left: 1px solid var(--line-soft);
}
.ed-fact { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ed-fact-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-3); font-weight: 500; }
.ed-fact-val { font-size: 19px; font-weight: 500; letter-spacing: -0.02em; }
.ed-fact-sub { font-size: 10.5px; color: var(--fg-3); }
@media (max-width: 900px) {
    .ed-hero-facts { padding-left: 0; border-left: none; flex-basis: 100%; }
}
@media (max-width: 640px) {
    .ed-hero-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* Chart */
.orbit-design .od-card.ed-chart { padding: 20px 22px 16px; }
.ed-chart-wrap { width: 100%; }
.ed-chart-foot {
    margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line-soft);
    font-size: 12.5px; color: var(--fg-3);
}
.ed-chart-foot b { font-weight: 600; color: var(--fg); }
.ed-legend { display: flex; gap: 14px; font-size: 11.5px; color: var(--fg-3); flex-wrap: wrap; }
.ed-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ed-sw { width: 14px; height: 3px; border-radius: 2px; }
.ed-sw-dash { height: 0; border-top: 2px dashed var(--c); }
.ed-sw-dot { height: 0; border-top: 2px dotted var(--c); }
.ed-sw-marker { height: 0; border-top: 2.5px solid var(--fg); }

.ed-monthly-bars { display: flex; flex-direction: column; gap: 10px; }


/* Sections */
.ed-sect-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; margin-bottom: 14px; flex-wrap: wrap;
}
.ed-sect-text { display: flex; flex-direction: column; gap: 2px; }
.ed-sect-title { font-size: 16px; font-weight: 500; letter-spacing: -0.01em; color: var(--fg); margin: 0; }
.ed-sect-sub { font-size: 12px; color: var(--fg-3); }

.ed-empty { padding: 30px 0; text-align: center; color: var(--fg-3); font-size: 13px; }

/* Monthly spend + Where it went + Velocity — one analytics row, three
   columns divided by a soft rule. Monthly/Velocity are monthly/rolling-only
   (goal envelopes render the donut column alone). Collapses to stacked
   full-width columns with horizontal rules below 960px. */
/* flex-wrap is intentionally "nowrap": at 3 columns + 2 dividers, the row
   needs ~930px of inner width to lay out un-wrapped (the sidebar + card
   padding push that past the raw viewport width at common laptop sizes
   like 1024/1152/1200px). Wrapping there would strand a divider between
   an orphaned pair of columns; shrinking (flex-shrink:1, the default)
   instead keeps all 3 columns on one row, just narrower, until the
   max-width query below stacks them properly. */
.ed-row3 { display: flex; align-items: stretch; gap: 24px; padding: 20px 22px; flex-wrap: nowrap; }
.ed-row3-col { display: flex; flex-direction: column; min-width: 0; flex: 1 1 320px; }
.ed-row3-col-donut { flex: 0 1 240px; }
.ed-row3-divider { width: 1px; align-self: stretch; background: var(--line-soft); flex: 0 0 auto; }
.ed-row3-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
.ed-row3-title { font-size: 14px; font-weight: 500; letter-spacing: -0.01em; color: var(--fg); margin: 0; }
.ed-row3-sub { font-size: 11.5px; color: var(--fg-3); }
@media (max-width: 1280px) {
    .ed-row3 { flex-direction: column; }
    .ed-row3-divider { width: auto; height: 1px; }
    .ed-row3-col-donut { flex-basis: auto; }
}

/* Velocity visual — mini bullet-style bar comparison (this/last/typical,
   value always labeled) + an acceleration stat pairing an icon with the
   signed percentage, so direction is never color-only. */
.ed-velocity-viz { display: flex; flex-direction: column; gap: 14px; justify-content: center; flex: 1; }
.ed-vbar-rows { display: flex; flex-direction: column; gap: 10px; }
.ed-vbar-row { display: grid; grid-template-columns: 72px 1fr auto; align-items: center; gap: 8px; }
.ed-vbar-label {
    font-size: 11px; color: var(--fg-3); white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
}
.ed-vbar-track { height: 8px; border-radius: 4px; background: var(--bg-elev-1); overflow: hidden; }
.ed-vbar-fill { height: 100%; border-radius: 4px; }
.ed-vbar-fill-outline { box-sizing: border-box; background: transparent; border: 1.5px dashed; }
.ed-vbar-val { font-size: 12px; font-weight: 500; color: var(--fg); white-space: nowrap; }
.ed-vaccel {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 10px 12px; border-radius: 10px;
}
.ed-vaccel-val { font-size: 17px; font-weight: 600; }
.ed-vaccel-sub { font-size: 11px; color: var(--fg-3); }

@media (max-width: 640px) {
    .ed-topbar { padding: 14px 14px 10px; }
    .ed-title { font-size: 20px; gap: 10px; }
    .ed-scroll { padding: 12px 14px 22px; gap: 12px; }
    .orbit-design .od-card.ed-hero { padding: 16px; gap: 18px; }
    .ed-hero-num-val { font-size: 26px; }
    .orbit-design .od-card.ed-chart { padding: 16px; }
    .ed-sect-head { margin-bottom: 10px; }
    /* This is the densest button cluster on the page — give the wrapped
       action buttons a full 44px touch target on mobile. */
    .ed-topbar-actions .od-btn { min-height: 44px; }
}
`;
