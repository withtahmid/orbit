import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { differenceInCalendarDays } from "date-fns";
import { observer } from "mobx-react-lite";
import { formatInAppTz } from "@/lib/formatDate";
import { trpc } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { ROUTES } from "@/router/routes";
import {
    addDays,
    addMonths,
    endOfMonth,
    getAppTzDate,
    getAppTzMonth,
    getAppTzYear,
    startOfMonth,
} from "@/lib/dates";
import { UNALLOCATED_COLOR } from "@/lib/entityStyle";
import { computeQuantileEdges, bucketize, ramp, formatCompact } from "@/lib/spendHeatmapColor";
import { useStore } from "@/stores/useStore";
import { CumulativeRaceChart } from "@/pages/space/analytics/views/TrendsView";
import { MetricToggle, useMetricMode, type MetricMode } from "@/components/shared/MetricMode";
import { Donut } from "@/components/shared/charts/Donut";

/* =============================================================
   OVERVIEW PAGE — editorial-dark design (orbit-4)
   Same data surface as before; visual layer rebuilt to match the
   design canvas. Wraps in .orbit-design to opt into the scoped
   token set (deep-emerald near-black + emerald/gold accents).
   ============================================================= */
export default observer(function OverviewPage() {
    const { space } = useCurrentSpace();
    const { authStore } = useStore();
    const isPersonal = space.isPersonal;
    const userName = authStore.user?.name?.split(" ")[0] ?? "you";

    const [now] = useState(() => new Date());
    const thisMonthStart = startOfMonth(now);
    const thisMonthEnd = addMonths(thisMonthStart, 1);
    const lastMonthStart = addMonths(thisMonthStart, -1);
    const cashFlowStart = addMonths(thisMonthStart, -2);
    const trendStart = addDays(now, -29);
    /* Same trailing-12-month window the Spending calendar analytics page
     * uses (`addMonths(periodEnd, -12)` there, `periodEnd` = `thisMonthEnd`
     * here) — the daily heatmap's color-bucket edges need this space's
     * full yearly distribution, not just this month's data, or the two
     * calendars would share a palette but not a scale. */
    const heatmapEdgesStart = addMonths(thisMonthEnd, -12);

    /* Metric mode (URL-persisted via ?metric=cash|operational).
       Operational is the default everywhere — true income / expense
       is more useful as a headline. Users can toggle to cash to see
       the bank-balance view that includes cross-space transfers. */
    const { mode } = useMetricMode();

    /* ---------- Queries: real-space + personal variants ---------- */
    const summarySpace = trpc.analytics.spaceSummary.useQuery(
        { spaceId: space.id, periodStart: thisMonthStart, periodEnd: thisMonthEnd },
        { enabled: !isPersonal }
    );
    const summaryPersonal = trpc.personal.summary.useQuery(
        { periodStart: thisMonthStart, periodEnd: thisMonthEnd },
        { enabled: isPersonal }
    );
    const summary = isPersonal ? summaryPersonal : summarySpace;

    const lastMonthSpace = trpc.analytics.spaceSummary.useQuery(
        { spaceId: space.id, periodStart: lastMonthStart, periodEnd: thisMonthStart },
        { enabled: !isPersonal }
    );
    const lastMonthPersonal = trpc.personal.summary.useQuery(
        { periodStart: lastMonthStart, periodEnd: thisMonthStart },
        { enabled: isPersonal }
    );
    const lastMonthSummary = isPersonal ? lastMonthPersonal : lastMonthSpace;

    const cashFlowSpace = trpc.analytics.cashFlow.useQuery(
        {
            spaceId: space.id,
            periodStart: cashFlowStart,
            periodEnd: thisMonthEnd,
            bucket: "week",
            mode,
        },
        { enabled: !isPersonal }
    );
    const cashFlowPersonal = trpc.personal.cashFlow.useQuery(
        { periodStart: cashFlowStart, periodEnd: thisMonthEnd, bucket: "week", mode },
        { enabled: isPersonal }
    );
    const cashFlow = isPersonal ? cashFlowPersonal : cashFlowSpace;

    const balanceTrendSpace = trpc.analytics.balanceHistory.useQuery(
        { spaceId: space.id, periodStart: trendStart, periodEnd: now, bucket: "day" },
        { enabled: !isPersonal }
    );
    const balanceTrendPersonal = trpc.personal.balanceHistory.useQuery(
        { periodStart: trendStart, periodEnd: now, bucket: "day" },
        { enabled: isPersonal }
    );
    const balanceTrend = isPersonal ? balanceTrendPersonal : balanceTrendSpace;

    const balanceTrendSeries = useMemo(() => {
        if (!balanceTrend.data) return [] as Array<{ bucket: string; balance: number }>;
        const byBucket = new Map<string, number>();
        for (const row of balanceTrend.data.series) {
            const key =
                typeof row.bucket === "string" ? row.bucket : new Date(row.bucket).toISOString();
            byBucket.set(key, (byBucket.get(key) ?? 0) + row.balance);
        }
        return Array.from(byBucket.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([bucket, balance]) => ({ bucket, balance }));
    }, [balanceTrend.data]);

    const utilizationSpace = trpc.analytics.envelopeUtilization.useQuery(
        { spaceId: space.id, periodStart: thisMonthStart, periodEnd: thisMonthEnd },
        { enabled: !isPersonal }
    );
    const utilizationPersonal = trpc.personal.envelopeUtilization.useQuery(
        { periodStart: thisMonthStart, periodEnd: thisMonthEnd },
        { enabled: isPersonal }
    );
    const utilization = isPersonal ? utilizationPersonal : utilizationSpace;

    const priorityBreakdownQuery = trpc.analytics.priorityBreakdown.useQuery(
        { spaceId: space.id, periodStart: thisMonthStart, periodEnd: thisMonthEnd },
        { enabled: !isPersonal }
    );

    /* Personal-only: per-space net-worth split for the "Across N spaces"
       band at the top of the My-money overview. Only fetched when active. */
    const spaceBreakdown = trpc.personal.spaceBreakdown.useQuery(undefined, {
        enabled: isPersonal,
    });

    /* Per-account distribution (id, name, color, icon, balance, type) —
       drives Net worth composition + Accounts at a glance. Same shape
       across real-space and personal variants. */
    const acctDistSpace = trpc.analytics.accountDistribution.useQuery(
        { spaceId: space.id },
        { enabled: !isPersonal }
    );
    const acctDistPersonal = trpc.personal.accountDistribution.useQuery(undefined, {
        enabled: isPersonal,
    });
    const accountDistribution = isPersonal ? acctDistPersonal : acctDistSpace;

    /* Daily spend by day (for the calendar heatmap on FLOW). Window spans
     * the trailing 12 months, not just this month — `DailyHeatmap` only
     * renders this month's cells but needs the full year to compute color-
     * bucket edges on the same scale as the Spending calendar page. */
    const heatmapSpace = trpc.analytics.spendingHeatmap.useQuery(
        { spaceId: space.id, periodStart: heatmapEdgesStart, periodEnd: thisMonthEnd, mode },
        { enabled: !isPersonal }
    );
    const heatmapPersonal = trpc.personal.spendingHeatmap.useQuery(
        { periodStart: heatmapEdgesStart, periodEnd: thisMonthEnd, mode },
        { enabled: isPersonal }
    );
    const heatmap = isPersonal ? heatmapPersonal : heatmapSpace;
    /* Stable reference so `DailyHeatmap`'s internal `useMemo` (bucketing a
     * full year of rows into color edges) actually caches instead of
     * recomputing every render on a freshly-mapped array. */
    const heatmapData = useMemo(
        () =>
            (heatmap.data ?? []).map((r) => ({
                day: typeof r.day === "string" ? new Date(r.day) : r.day,
                total: r.total,
            })),
        [heatmap.data]
    );

    /* ---------- New procedures wired for v2 cards ---------- */
    const todaySpaceQ = trpc.analytics.todaySummary.useQuery(
        { spaceId: space.id, day: now },
        { enabled: !isPersonal }
    );
    const todayPersonalQ = trpc.personal.todaySummary.useQuery(
        { day: now },
        { enabled: isPersonal }
    );
    const todayData = (isPersonal ? todayPersonalQ.data : todaySpaceQ.data) ?? null;

    const moversSpaceQ = trpc.analytics.categoryWoW.useQuery(
        { spaceId: space.id, anchor: now, limit: 6 },
        { enabled: !isPersonal }
    );
    const moversPersonalQ = trpc.personal.categoryWoW.useQuery(
        { anchor: now, limit: 6 },
        { enabled: isPersonal }
    );
    const moversData = (isPersonal ? moversPersonalQ.data : moversSpaceQ.data) ?? [];

    /* Spending Trends powered by the same `dailyComparison` proc the
       /analytics/trends detail view uses — pinned to month granularity
       on the overview. The standalone `cumulativeSpend` proc was
       returning a flat projection that collapsed the dotted line; this
       proc returns reliable per-day deltas and we cumulate client-side
       (matching how the detail view does it). */
    const trendsSpaceQ = trpc.analytics.trends.dailyComparison.useQuery(
        {
            spaceId: space.id,
            anchor: now,
            granularity: "month",
            mode,
        },
        { enabled: !isPersonal }
    );
    const trendsPersonalQ = trpc.personal.trends.dailyComparison.useQuery(
        { anchor: now, granularity: "month", mode },
        { enabled: isPersonal }
    );
    const trendsData = (isPersonal ? trendsPersonalQ.data : trendsSpaceQ.data) ?? null;
    const trendsLoading = isPersonal ? trendsPersonalQ.isLoading : trendsSpaceQ.isLoading;

    const netWorthHistStart = useMemo(() => addMonths(thisMonthStart, -12), [thisMonthStart]);
    const netWorthHistSpaceQ = trpc.analytics.netWorthHistory.useQuery(
        {
            spaceId: space.id,
            periodStart: netWorthHistStart,
            periodEnd: thisMonthEnd,
            bucket: "month",
        },
        { enabled: !isPersonal }
    );
    const netWorthHistPersonalQ = trpc.personal.netWorthHistory.useQuery(
        {
            periodStart: netWorthHistStart,
            periodEnd: thisMonthEnd,
            bucket: "month",
        },
        { enabled: isPersonal }
    );
    const netWorthHistData =
        (isPersonal ? netWorthHistPersonalQ.data : netWorthHistSpaceQ.data) ?? [];

    /* ---------- Derived chart data ---------- */
    const topEnvelopesDonut = useMemo(
        () =>
            (utilization.data ?? [])
                .filter((e) => e.consumed > 0)
                .map((e) => ({
                    id: e.envelopId,
                    name: e.name,
                    value: e.consumed,
                    color: e.color,
                }))
                // envelopeUtilization orders by created_at — sort by spend
                // so `[0]` is actually the biggest spender, matching the
                // "Top envelope" center-value label below.
                .sort((a, b) => b.value - a.value),
        [utilization.data]
    );

    const priorityDonut = useMemo(
        () =>
            (priorityBreakdownQuery.data ?? [])
                .filter((t) => t.total > 0)
                .map((t) => ({
                    id: t.priority,
                    name: t.label,
                    value: Number(t.total),
                    color: t.color,
                })),
        [priorityBreakdownQuery.data]
    );

    const allocationDonut = useMemo(() => {
        // Split envelopes by whether they carry a target. Both contribute
        // to the held cash that the donut visualises; we just colour them
        // into two stacks so the user can see goals vs envelopes at a
        // glance.
        const slices = (utilization.data ?? [])
            .filter((e) => e.remaining > 0)
            .map((e) => ({
                id: (e.targetAmount != null ? "goal-" : "env-") + e.envelopId,
                name: e.name,
                value: e.remaining,
                color: e.color,
            }));
        const unallocated = summary.data?.unallocated ?? 0;
        const unSlice =
            unallocated > 0
                ? [
                      {
                          id: "unallocated",
                          name: "Unallocated",
                          value: unallocated,
                          color: UNALLOCATED_COLOR,
                      },
                  ]
                : [];
        return [...slices, ...unSlice];
    }, [utilization.data, summary.data]);

    const overAllocated = summary.data?.isOverAllocated ?? false;

    /* Picker for the "Net this month" eyebrow under the cash-flow
       chart — that single number does follow `mode` because it sits
       inside the cash-flow card. The Position row above is static
       (shows both pairs unconditionally) so it doesn't need a picker. */
    const pickNet = (s?: { periodNet: number; operationalNet: number } | null) =>
        mode === "cash" ? s?.periodNet : s?.operationalNet;

    /* MoM deltas for the operational Income / Expense tiles.
       Operational deltas mean "true earning / spending changed by X%"
       — cleaner than cash-flow deltas because cross-space transfer
       activity in one month doesn't masquerade as a spending spike. */
    const monthOverMonth = useMemo(() => {
        const cur = summary.data;
        const prev = lastMonthSummary.data;
        const delta = (c?: number, p?: number): number | null => {
            if (c == null || p == null) return null;
            if (p === 0) return c === 0 ? 0 : Infinity;
            return ((c - p) / Math.abs(p)) * 100;
        };
        return {
            incomeDelta: delta(cur?.operationalIncome, prev?.operationalIncome),
            expenseDelta: delta(cur?.operationalExpense, prev?.operationalExpense),
        };
    }, [summary.data, lastMonthSummary.data]);

    const monthProgress = useMemo(() => {
        const total = differenceInCalendarDays(endOfMonth(now), thisMonthStart);
        const elapsed = differenceInCalendarDays(now, thisMonthStart) + 1;
        const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
        return { elapsed, total, pct, remaining: Math.max(0, total - elapsed) };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* Short label for the prior calendar month — drives the
       month-over-month delta copy ("+12% vs Apr") so it stays
       in sync with the actual comparison window. */
    const lastMonthLabel = formatInAppTz(lastMonthStart, "MMM");

    const eyebrow = isPersonal
        ? "Personal · all spaces"
        : `${formatInAppTz(now, "MMMM yyyy")} · Day ${monthProgress.elapsed} of ${monthProgress.total}`;

    const title = isPersonal ? "Your money, across spaces" : `Welcome back, ${userName}`;
    const subtitle = isPersonal
        ? "A unified view of accounts you own — across every space you're in."
        : "Here's your money today.";

    return (
        <div className="orbit-design ov-root">
            <style>{OV_STYLES}</style>

            {/* Topbar */}
            <header className="ov-topbar">
                <div className="ov-topbar-text">
                    <span className="eyebrow">{eyebrow}</span>
                    <h1 className="display ov-title">{title}</h1>
                    <p className="ov-sub">{subtitle}</p>
                </div>
                <div className="ov-topbar-actions">
                    {/* Static badge, not a filter — this page always shows
                        the current month with no period switcher. Rendered
                        `disabled` so it doesn't look clickable. */}
                    <button
                        className="od-btn"
                        disabled
                        title="Overview always shows the current month"
                    >
                        <FilterIcon />
                        This month
                    </button>
                    {!isPersonal &&
                        (() => {
                            // Monthly-budget entry point. State-aware: when
                            // there's money to budget, goes primary with a
                            // "·Money free" chip; otherwise stays ghost.
                            // Label is stable as "Budget {Month}" to avoid a
                            // perceptible flicker between loading and loaded
                            // states — the style + chip carry the urgency
                            // signal. "New transaction" demotes to ghost
                            // only after the summary loads AND there's money
                            // to budget, so single-primary is preserved
                            // without flickering on first paint.
                            const planMonthSlug = formatInAppTz(now, "yyyy-MM");
                            const planMonthName = formatInAppTz(now, "MMMM");
                            const hasMoneyToBudget =
                                summary.data !== undefined && summary.data.unallocated > 0;
                            return (
                                <Link
                                    to={ROUTES.spaceBudgetMonth(space.id, planMonthSlug)}
                                    className={
                                        hasMoneyToBudget
                                            ? "od-btn od-btn-primary ov-link-btn"
                                            : "od-btn ov-link-btn"
                                    }
                                    aria-label={
                                        hasMoneyToBudget && summary.data
                                            ? `Budget ${planMonthName}, ${summary.data.unallocated.toFixed(2)} free to budget`
                                            : `Open the ${planMonthName} budget`
                                    }
                                >
                                    <DesignIcon
                                        name="calendar"
                                        size={13}
                                        color={hasMoneyToBudget ? "var(--brand-fg)" : "var(--fg-3)"}
                                    />
                                    {`Budget ${planMonthName}`}
                                    {hasMoneyToBudget && summary.data && (
                                        <span className="ov-plan-free">
                                            ·{" "}
                                            <Money amount={summary.data.unallocated} size={11.5} />{" "}
                                            free
                                        </span>
                                    )}
                                </Link>
                            );
                        })()}
                    <Link to={ROUTES.spaceAnalytics(space.id)} className="od-btn ov-link-btn">
                        <ChartIcon />
                        All analytics
                    </Link>
                    {!isPersonal && (
                        <Link
                            to={ROUTES.spaceTransactions(space.id)}
                            className={
                                summary.data !== undefined && summary.data.unallocated > 0
                                    ? "od-btn ov-link-btn"
                                    : "od-btn od-btn-primary ov-link-btn"
                            }
                        >
                            <PlusIcon />
                            New transaction
                        </Link>
                    )}
                </div>
            </header>

            <div className="ov-scroll">
                {/* Today band — quick-glance daily summary. Cleared /
                    pending / last-sync columns intentionally absent
                    (no transaction status field yet). */}
                <TodayBand now={now} data={todayData} />

                {/* Personal-only "across spaces" band — gold-accented
                    aggregator showing the user's share of every space
                    they're in plus accounts only they own. */}
                {isPersonal && spaceBreakdown.data && (
                    <PersonalSpaceBand data={spaceBreakdown.data} />
                )}

                {/* Over-allocation banner */}
                {!isPersonal && overAllocated && summary.data && (
                    <div className="od-card ov-over">
                        <div className="ov-drift-headline">
                            <span className="ov-drift-icon ov-over-icon">
                                <BoltIcon />
                            </span>
                            <div>
                                <div className="ov-drift-title" style={{ color: "var(--expense)" }}>
                                    Over-allocated by{" "}
                                    <Money
                                        amount={Math.abs(summary.data.unallocated)}
                                        variant="expense"
                                    />
                                </div>
                                <div className="ov-drift-sub">
                                    More money is allocated to envelopes than you actually have.
                                    Deallocate somewhere or record income to balance.
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <SectionEyebrow label="Position" sub="Where you stand right now" />

                {/* 4-stat row */}
                {/* Position row — Net worth, the cash-flow pair
                    (Inflow / Outflow, includes cross-space transfers),
                    the operational pair (Income / Expense, transfer
                    principal excluded), and Unallocated. Showing both
                    pairs side-by-side rather than toggling labels lets
                    the user compare at a glance — the gap between
                    Inflow and Income is exactly the cross-space
                    transfer activity for the month. */}
                <div className="ov-stat-row">
                    <StatTile
                        label="Net worth"
                        amount={summary.data?.totalBalance ?? 0}
                        loading={summary.isLoading}
                        icon={<LayersIcon />}
                        accent="color-mix(in oklab, var(--brand) 18%, transparent)"
                        delta={
                            summary.data && summary.data.lockedBalance > 0 ? (
                                <>
                                    <Money
                                        amount={summary.data.lockedBalance}
                                        size={11}
                                        variant="muted"
                                    />{" "}
                                    locked
                                </>
                            ) : null
                        }
                    />
                    <StatTile
                        label={`Inflow · ${formatInAppTz(now, "MMM")}`}
                        amount={summary.data?.periodIncome ?? 0}
                        variant="income"
                        loading={summary.isLoading}
                        icon={<TrendUpIcon />}
                        accent="color-mix(in oklab, var(--income) 14%, transparent)"
                        delta="incl. transfers in"
                        signed
                    />
                    <StatTile
                        label={`Outflow · ${formatInAppTz(now, "MMM")}`}
                        amount={summary.data?.periodExpense ?? 0}
                        variant="expense"
                        loading={summary.isLoading}
                        icon={<TrendDownIcon />}
                        accent="color-mix(in oklab, var(--expense) 14%, transparent)"
                        delta="incl. transfers out"
                    />
                    <StatTile
                        label={`Income · ${formatInAppTz(now, "MMM")}`}
                        amount={summary.data?.operationalIncome ?? 0}
                        variant="income"
                        loading={summary.isLoading}
                        icon={<TrendUpIcon />}
                        accent="color-mix(in oklab, var(--income) 14%, transparent)"
                        delta={renderDelta(
                            monthOverMonth.incomeDelta,
                            "higher-better",
                            lastMonthLabel
                        )}
                        signed
                    />
                    <StatTile
                        label={`Expense · ${formatInAppTz(now, "MMM")}`}
                        amount={summary.data?.operationalExpense ?? 0}
                        variant="expense"
                        loading={summary.isLoading}
                        icon={<TrendDownIcon />}
                        accent="color-mix(in oklab, var(--expense) 14%, transparent)"
                        delta={renderDelta(
                            monthOverMonth.expenseDelta,
                            "lower-better",
                            lastMonthLabel
                        )}
                    />
                    {!isPersonal && (
                        <StatTile
                            label="Unallocated"
                            amount={summary.data?.unallocated ?? 0}
                            loading={summary.isLoading}
                            variant={overAllocated ? "expense" : "fg"}
                            icon={<WalletIcon />}
                            delta={
                                overAllocated
                                    ? "Over-allocated"
                                    : summary.data && summary.data.lockedBalance > 0
                                      ? "Locked excluded"
                                      : "Free to allocate"
                            }
                        />
                    )}
                </div>

                {/* Balance trend */}
                <div className="od-card ov-section">
                    <SectionHead
                        title={
                            <>
                                <TrendUpIcon color="var(--brand)" /> Balance trend
                            </>
                        }
                        sub="Last 30 days · across all accounts"
                        action={
                            <Link
                                to={ROUTES.spaceAnalyticsDetail(space.id, "balance")}
                                className="ov-details-link"
                            >
                                Details →
                            </Link>
                        }
                    />
                    {balanceTrend.isLoading ? (
                        <Skeleton height={210} />
                    ) : balanceTrendSeries.length === 0 ? (
                        <EmptyHint>No balance history yet.</EmptyHint>
                    ) : (
                        <BalanceTrend series={balanceTrendSeries} />
                    )}
                </div>

                {/* Net worth composition — assets minus liabilities, with
                    the 12-month trendline and per-category split bars.
                    Derived from accountDistribution; history comes from
                    `analytics.netWorthHistory` / its personal twin. */}
                <NetWorthComposition
                    accounts={accountDistribution.data ?? []}
                    loading={accountDistribution.isLoading}
                    history={netWorthHistData}
                    spaceId={space.id}
                />

                <SectionEyebrow label="Composition" sub="How money is split, parked & spent" />

                {/* Donut trio */}
                <div className={`ov-trio ${isPersonal ? "ov-trio-2" : ""}`}>
                    <DonutCard
                        title={
                            <>
                                <LayersIcon color="var(--fg-3)" /> Where money sits
                            </>
                        }
                        sub="Held in envelopes, or free to spend"
                        // `/budgets` operates on a real space's envelopes and
                        // doesn't work for the "me" virtual space — same
                        // personal-parity gate as the Unallocated tile and
                        // the "Budget {Month}" topbar button below.
                        action={
                            isPersonal ? undefined : (
                                <Link
                                    to={ROUTES.spaceBudgets(space.id)}
                                    className="ov-details-link"
                                >
                                    Details →
                                </Link>
                            )
                        }
                        slices={allocationDonut}
                        centerLabel="Spendables"
                        centerValue={summary.data?.spendableBalance ?? 0}
                        loading={utilization.isLoading || summary.isLoading}
                    />
                    <DonutCard
                        title={
                            <>
                                <CartIcon color="var(--ent-2)" /> Spending by envelope
                            </>
                        }
                        sub="This month's biggest spends. Click to drill."
                        action={
                            <Link
                                to={ROUTES.spaceAnalyticsDetail(space.id, "envelopes")}
                                className="ov-details-link"
                            >
                                Details →
                            </Link>
                        }
                        slices={topEnvelopesDonut}
                        centerLabel="Top envelope"
                        centerValue={topEnvelopesDonut[0]?.value ?? 0}
                        loading={utilization.isLoading}
                    />
                    {!isPersonal && (
                        <DonutCard
                            title={
                                <>
                                    <FlagIcon color="var(--expense)" /> By priority
                                </>
                            }
                            sub="Must vs want this month"
                            action={
                                <Link
                                    to={ROUTES.spaceAnalyticsDetail(space.id, "priority")}
                                    className="ov-details-link"
                                >
                                    Details →
                                </Link>
                            }
                            slices={priorityDonut}
                            centerLabel="Total spent"
                            centerValue={priorityDonut.reduce((s, x) => s + x.value, 0)}
                            loading={priorityBreakdownQuery.isLoading}
                        />
                    )}
                </div>

                <SectionEyebrow label="Flow" sub="Money moving in and out" />

                {/* Cash flow */}
                <div className="od-card ov-section">
                    <SectionHead
                        title={
                            <>
                                <TrendUpIcon color="var(--income)" />{" "}
                                {mode === "cash" ? "Cash flow" : "Operational flow"}
                            </>
                        }
                        sub={
                            mode === "cash"
                                ? "Weekly inflow vs outflow, last 3 months — incl. cross-space transfers"
                                : "Weekly income vs expense, last 3 months — true earnings vs spending"
                        }
                        action={
                            <span className="ov-cf-legend">
                                <MetricToggle />
                                <span className="ov-legend-chip">
                                    <span style={{ background: "var(--income)" }} />{" "}
                                    {mode === "cash" ? "Inflow" : "Income"}
                                </span>
                                <span className="ov-legend-chip">
                                    <span style={{ background: "var(--expense)" }} />{" "}
                                    {mode === "cash" ? "Outflow" : "Expense"}
                                </span>
                                <Link
                                    to={ROUTES.spaceAnalyticsDetail(space.id, "cash-flow")}
                                    className="ov-details-link"
                                >
                                    Details →
                                </Link>
                            </span>
                        }
                    />
                    {cashFlow.isLoading ? (
                        <Skeleton height={200} />
                    ) : !cashFlow.data || cashFlow.data.length === 0 ? (
                        <EmptyHint>No cash flow data yet.</EmptyHint>
                    ) : (
                        <CashFlow
                            data={cashFlow.data.map((d) => ({
                                bucket:
                                    typeof d.bucket === "string"
                                        ? d.bucket
                                        : new Date(d.bucket).toISOString(),
                                income: d.income,
                                expense: d.expense,
                            }))}
                        />
                    )}
                </div>

                {/* Month progress strip — only on real space */}
                {!isPersonal && summary.data && (
                    <div className="od-card ov-progress-strip">
                        <div className="ov-progress-bar">
                            <div className="ov-progress-bar-head">
                                <span className="ov-progress-label">Month progress</span>
                                <span className="ov-progress-meta">
                                    {monthProgress.elapsed} / {monthProgress.total} days ·{" "}
                                    {monthProgress.remaining} left
                                </span>
                            </div>
                            <ProgressBar
                                value={monthProgress.pct / 100}
                                color="var(--brand)"
                                height={6}
                            />
                        </div>
                        <div className="ov-progress-stats">
                            <div>
                                <div className="ov-stat-eyebrow">
                                    {mode === "cash" ? "Net cash this month" : "Net this month"}
                                </div>
                                <Money
                                    amount={pickNet(summary.data) ?? 0}
                                    variant={
                                        (pickNet(summary.data) ?? 0) < 0 ? "expense" : "income"
                                    }
                                    size={14}
                                    weight={500}
                                    signed
                                />
                            </div>
                            <div>
                                <div className="ov-stat-eyebrow">Envelope spend</div>
                                <Money
                                    amount={summary.data.envelopeConsumed}
                                    variant="expense"
                                    size={14}
                                    weight={500}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Heatmap + Top movers (row 2 of FLOW) */}
                <div className="ov-grid-7-5">
                    <DailyHeatmap
                        now={now}
                        spaceId={space.id}
                        data={heatmapData}
                        loading={heatmap.isLoading}
                        mode={mode}
                    />
                    {/* Top movers — week-over-week category shifts. */}
                    <TopMovers movers={moversData} spaceId={space.id} />
                </div>

                <SectionEyebrow label="Targets" sub="Envelopes, goals, spending against budget" />

                {/* Envelopes + Goals */}
                <div className="ov-grid-2">
                    <div className="od-card ov-section">
                        <SectionHead
                            title={
                                <>
                                    <CartIcon color="var(--ent-2)" /> Envelope utilization
                                </>
                            }
                            sub="This month's consumption"
                            action={
                                <Link
                                    to={ROUTES.spaceAnalyticsDetail(space.id, "envelopes")}
                                    className="ov-details-link"
                                >
                                    Details →
                                </Link>
                            }
                        />
                        <div className="ov-list-col">
                            {utilization.isLoading ? (
                                Array.from({ length: 3 }).map((_, i) => (
                                    <Skeleton key={i} height={32} />
                                ))
                            ) : !utilization.data || utilization.data.length === 0 ? (
                                <EmptyHint compact>No envelopes yet</EmptyHint>
                            ) : (
                                // envelopeUtilization orders by created_at — sort by spend
                                // so this reads as "top envelopes," matching the donut above.
                                [...utilization.data]
                                    .sort((a, b) => b.consumed - a.consumed)
                                    .slice(0, 5)
                                    .map((e) => {
                                        const rawPct =
                                            e.allocated > 0 ? e.consumed / e.allocated : 0;
                                        const over = rawPct > 1;
                                        return (
                                            <Link
                                                key={e.envelopId}
                                                to={ROUTES.spaceBudgetDetail(space.id, e.envelopId)}
                                                className="ov-list-row"
                                            >
                                                <div className="ov-list-row-head">
                                                    <span className="ov-list-row-name">
                                                        <EntityAvatar
                                                            icon={e.icon}
                                                            colorVar={e.color}
                                                            size={22}
                                                        />
                                                        {e.name}
                                                        {over && (
                                                            <span className="ov-chip ov-chip-drift">
                                                                over
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="ov-list-row-amt">
                                                        <Money
                                                            amount={e.consumed}
                                                            size={11.5}
                                                            variant={over ? "expense" : "neutral"}
                                                        />{" "}
                                                        <span style={{ color: "var(--fg-4)" }}>
                                                            /{" "}
                                                            <Money
                                                                amount={e.allocated}
                                                                size={11.5}
                                                                variant="muted"
                                                            />
                                                        </span>
                                                    </span>
                                                </div>
                                                <ProgressBar
                                                    value={rawPct}
                                                    color={e.color}
                                                    height={4}
                                                />
                                            </Link>
                                        );
                                    })
                            )}
                        </div>
                    </div>

                    <div className="od-card ov-section">
                        <SectionHead
                            title={
                                <>
                                    <TargetIcon color="var(--gold)" /> Goals
                                </>
                            }
                            sub="Long-term goal progress"
                            // The Envelope utilization analytics page (not
                            // `/budgets`, which doesn't work for the "me"
                            // virtual space) lists every active envelope
                            // including goals — a real destination on both
                            // a regular space and personal.
                            action={
                                <Link
                                    to={ROUTES.spaceAnalyticsDetail(space.id, "envelopes")}
                                    className="ov-details-link"
                                >
                                    View all →
                                </Link>
                            }
                        />
                        {(() => {
                            // Aggregate rollup: surface "$X saved toward
                            // $Y across N goals" so the section reads
                            // like every other Overview block that has a
                            // header total. Excludes archived rows so a
                            // retired goal doesn't pad the denominator.
                            const activeGoals = (utilization.data ?? []).filter(
                                (e) =>
                                    e.targetAmount != null &&
                                    !(e as { archived?: boolean }).archived
                            );
                            if (utilization.isLoading || activeGoals.length === 0) {
                                return null;
                            }
                            const totalSaved = activeGoals.reduce(
                                (s, e) => s + (e.lifetimeFunded ?? 0),
                                0
                            );
                            const totalTarget = activeGoals.reduce(
                                (s, e) => s + (e.targetAmount ?? 0),
                                0
                            );
                            return (
                                <div
                                    className="ov-goal-rollup"
                                    style={{
                                        marginBottom: 10,
                                        fontSize: 12,
                                        color: "var(--fg-3)",
                                    }}
                                    aria-label={`${totalSaved.toFixed(2)} saved toward ${totalTarget.toFixed(2)} across ${activeGoals.length} ${activeGoals.length === 1 ? "goal" : "goals"}`}
                                >
                                    <Money amount={totalSaved} size={12.5} /> saved toward{" "}
                                    <Money amount={totalTarget} size={12.5} variant="muted" />{" "}
                                    across {activeGoals.length}{" "}
                                    {activeGoals.length === 1 ? "goal" : "goals"}
                                </div>
                            );
                        })()}
                        <div className="ov-list-col">
                            {utilization.isLoading
                                ? Array.from({ length: 3 }).map((_, i) => (
                                      <Skeleton key={i} height={32} />
                                  ))
                                : (() => {
                                      // Goals are envelopes that carry a target. On personal
                                      // (cross-space) views we also want the rows to link into
                                      // the originating space rather than the `/s/me` sentinel.
                                      const goals = (utilization.data ?? []).filter(
                                          (e) =>
                                              e.targetAmount != null &&
                                              !(e as { archived?: boolean }).archived
                                      );
                                      if (goals.length === 0) {
                                          return <EmptyHint compact>No goals yet</EmptyHint>;
                                      }
                                      // envelopeUtilization orders by created_at — sort by
                                      // progress so the goals closest to funded surface first.
                                      return [...goals]
                                          .sort(
                                              (a, b) =>
                                                  (b.pctSaved ?? b.pctComplete ?? 0) -
                                                  (a.pctSaved ?? a.pctComplete ?? 0)
                                          )
                                          .slice(0, 5)
                                          .map((g) => {
                                              const pctRaw = g.pctSaved ?? g.pctComplete;
                                              const pct = pctRaw != null ? pctRaw / 100 : 0;
                                              // Personal twin attaches spaceId/spaceName for
                                              // per-row linking; in a real space they're absent
                                              // and the link falls back to the active space.
                                              const personalRow = g as {
                                                  spaceId?: string;
                                                  spaceName?: string;
                                              };
                                              const linkSpaceId = personalRow.spaceId ?? space.id;
                                              const saved = g.lifetimeFunded ?? 0;
                                              const target = g.targetAmount ?? 0;
                                              return (
                                                  <Link
                                                      key={g.envelopId}
                                                      to={ROUTES.spaceBudgetDetail(
                                                          linkSpaceId,
                                                          g.envelopId
                                                      )}
                                                      className="ov-list-row"
                                                      aria-label={
                                                          g.targetAmount != null
                                                              ? `${g.name}${personalRow.spaceName && isPersonal ? ` in ${personalRow.spaceName}` : ""}: ${saved.toFixed(2)} saved of ${target.toFixed(2)} target, ${Math.round(pctRaw ?? 0)}% complete`
                                                              : `${g.name}${personalRow.spaceName && isPersonal ? ` in ${personalRow.spaceName}` : ""}`
                                                      }
                                                  >
                                                      <div className="ov-list-row-head">
                                                          <span className="ov-list-row-name">
                                                              <EntityAvatar
                                                                  icon={g.icon}
                                                                  colorVar={g.color}
                                                                  size={22}
                                                              />
                                                              {g.name}
                                                              {personalRow.spaceName &&
                                                              isPersonal ? (
                                                                  <span
                                                                      style={{
                                                                          marginLeft: 6,
                                                                          color: "var(--fg-4)",
                                                                          fontSize: 11,
                                                                      }}
                                                                  >
                                                                      · {personalRow.spaceName}
                                                                  </span>
                                                              ) : null}
                                                          </span>
                                                          <span className="ov-list-row-amt">
                                                              <Money amount={saved} size={11.5} />
                                                              {g.targetAmount ? (
                                                                  <>
                                                                      {" "}
                                                                      <span
                                                                          style={{
                                                                              color: "var(--fg-4)",
                                                                          }}
                                                                      >
                                                                          /{" "}
                                                                          <Money
                                                                              amount={
                                                                                  g.targetAmount
                                                                              }
                                                                              size={11.5}
                                                                              variant="muted"
                                                                          />
                                                                      </span>
                                                                  </>
                                                              ) : null}
                                                          </span>
                                                      </div>
                                                      {g.targetAmount && g.targetAmount > 0 ? (
                                                          <ProgressBar
                                                              value={pct}
                                                              color={g.color}
                                                              height={4}
                                                          />
                                                      ) : (
                                                          <span
                                                              style={{
                                                                  fontSize: 11,
                                                                  color: "var(--fg-4)",
                                                              }}
                                                          >
                                                              No target set
                                                          </span>
                                                      )}
                                                  </Link>
                                              );
                                          });
                                  })()}
                        </div>
                    </div>
                </div>

                {/* Spending trends — cumulative spend vs last month + projection.
                    `trendsData` (the chart's own cur/prev lines) comes from
                    `trends.dailyComparison` in the active metric `mode`, so
                    the stat-tile baselines must read the same-mode summary
                    field — mixing cash `periodExpense` with an operational
                    chart would compare unlike totals (cross-space transfer
                    principal counted on one side only). */}
                <SpendingTrends
                    monthExpense={
                        (mode === "cash"
                            ? summary.data?.periodExpense
                            : summary.data?.operationalExpense) ?? 0
                    }
                    lastMonthExpense={
                        (mode === "cash"
                            ? lastMonthSummary.data?.periodExpense
                            : lastMonthSummary.data?.operationalExpense) ?? 0
                    }
                    trendsData={trendsData}
                    loading={trendsLoading}
                    periodStart={thisMonthStart}
                    detailHref={ROUTES.spaceAnalyticsDetail(space.id, "trends")}
                />

                {/* Accounts at a glance */}
                <AccountsGlance
                    accounts={accountDistribution.data ?? []}
                    loading={accountDistribution.isLoading}
                    spaceId={space.id}
                    isPersonal={isPersonal}
                    balanceSeries={balanceTrend.data?.series ?? []}
                />
            </div>
        </div>
    );
});

/* =============================================================
   Helper components
   ============================================================= */

function Money({
    amount,
    variant = "neutral",
    signed = false,
    size = 13,
    weight = 500,
    decimals = 2,
}: {
    amount: number;
    variant?: "neutral" | "income" | "expense" | "transfer" | "muted" | "warn" | "gold" | "brand";
    signed?: boolean;
    size?: number;
    weight?: number;
    decimals?: number;
}) {
    const colorMap: Record<string, string> = {
        income: "var(--income)",
        expense: "var(--expense)",
        transfer: "var(--transfer)",
        warn: "var(--warn)",
        muted: "var(--fg-3)",
        gold: "var(--gold)",
        brand: "var(--brand)",
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
            style={{ color: colorMap[variant], fontSize: size, fontWeight: weight }}
        >
            {text}
        </span>
    );
}

const SPACE_ICONS: ReadonlyArray<string> = ["home", "briefcase", "terminal", "book"];
const SPACE_COLORS: ReadonlyArray<string> = [
    "var(--ent-1)",
    "var(--ent-3)",
    "var(--ent-4)",
    "var(--ent-2)",
    "var(--ent-5)",
    "var(--ent-6)",
];

function PersonalSpaceBand({
    data,
}: {
    data: {
        personalBalance: number;
        spaces: Array<{
            id: string;
            name: string;
            memberCount: number;
            myRole: "owner" | "editor" | "viewer";
            balance: number;
        }>;
        total: number;
    };
}) {
    const cells: Array<{
        kind: "personal" | "space";
        id: string;
        name: string;
        sub: string;
        balance: number;
        color: string;
        icon: string;
        share?: string;
    }> = [
        {
            kind: "personal" as const,
            id: "__personal",
            name: "Personal-only",
            sub: "Accounts only you own",
            balance: data.personalBalance,
            color: "var(--gold)",
            icon: "sparkle",
        },
        ...data.spaces.map((s, i) => ({
            kind: "space" as const,
            id: s.id,
            name: s.name,
            sub: `Shared · ${s.memberCount} member${s.memberCount === 1 ? "" : "s"}`,
            balance: s.balance,
            color: SPACE_COLORS[i % SPACE_COLORS.length]!,
            icon: SPACE_ICONS[i % SPACE_ICONS.length]!,
            share: `1/${s.memberCount}`,
        })),
    ].filter((c) => c.balance !== 0 || c.kind === "personal");

    const total = data.total || 1; // avoid /0

    return (
        <div className="od-card ov-personal-band">
            <span className="ov-personal-band-glow" aria-hidden />
            <div className="ov-personal-band-head">
                <div className="ov-personal-band-headline">
                    <span className="ov-personal-band-icon">
                        <DesignIcon name="sparkle" size={14} color="var(--gold)" />
                    </span>
                    <div>
                        <div className="ov-personal-band-title">
                            Across {data.spaces.length} space
                            {data.spaces.length === 1 ? "" : "s"}
                        </div>
                        <div className="ov-personal-band-sub">
                            Your share of every space you&apos;re in, plus accounts only you own.
                        </div>
                    </div>
                </div>
                <Link to={ROUTES.spaces} className="ov-personal-band-link">
                    Manage spaces →
                </Link>
            </div>

            {/* Stacked proportion bar */}
            <div className="ov-personal-band-bar" aria-hidden>
                {cells.map((c) => {
                    const pct = total > 0 ? (c.balance / total) * 100 : 0;
                    if (pct <= 0) return null;
                    return (
                        <span
                            key={c.id}
                            style={{
                                width: `${pct}%`,
                                background: c.color,
                                opacity: c.kind === "personal" ? 1 : 0.85,
                            }}
                        />
                    );
                })}
            </div>

            {/* Per-bucket cards */}
            <div className="ov-personal-band-grid">
                {cells.map((c) => {
                    const pct = total > 0 ? (c.balance / total) * 100 : 0;
                    const target = c.kind === "personal" ? ROUTES.myAccounts : ROUTES.space(c.id);
                    return (
                        <Link key={c.id} to={target} className="ov-personal-band-cell">
                            <div className="ov-personal-band-cell-head">
                                <span className="ov-personal-band-cell-name">
                                    <EntityAvatar icon={c.icon} colorVar={c.color} size={22} />
                                    <span className="ov-personal-band-cell-label">{c.name}</span>
                                </span>
                                {c.share && (
                                    <span className="ov-personal-band-chip">your {c.share}</span>
                                )}
                            </div>
                            <div className="ov-personal-band-cell-foot">
                                <Money amount={c.balance} size={15} weight={500} />
                                <span className="ov-personal-band-pct">{pct.toFixed(0)}%</span>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

function StatTile({
    label,
    amount,
    variant = "fg",
    delta,
    icon,
    accent,
    loading,
    signed,
}: {
    label: string;
    amount: number;
    variant?: "fg" | "income" | "expense";
    delta?: ReactNode;
    icon?: ReactNode;
    accent?: string;
    loading?: boolean;
    signed?: boolean;
}) {
    return (
        <div className="od-card ov-stat-tile">
            {accent && (
                <span
                    className="ov-stat-accent"
                    style={{
                        background: `radial-gradient(80% 80% at 100% 0%, ${accent}, transparent 60%)`,
                    }}
                />
            )}
            <div className="ov-stat-head">
                <span className="ov-stat-label">{label}</span>
                {icon && <span className="ov-stat-icon">{icon}</span>}
            </div>
            <div className="ov-stat-amount">
                {loading ? (
                    <Skeleton width={140} height={28} />
                ) : (
                    <Money
                        amount={amount}
                        size={26}
                        weight={500}
                        variant={variant === "fg" ? "neutral" : variant}
                        signed={signed && variant === "income"}
                    />
                )}
            </div>
            {delta && <div className="ov-stat-delta">{delta}</div>}
        </div>
    );
}

function SectionHead({
    title,
    sub,
    action,
}: {
    title: ReactNode;
    sub?: ReactNode;
    action?: ReactNode;
}) {
    return (
        <div className="ov-sect-head">
            <div className="ov-sect-text">
                <h2 className="display ov-sect-title">{title}</h2>
                {sub && <span className="ov-sect-sub">{sub}</span>}
            </div>
            {action}
        </div>
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
    return (
        <span
            className="ov-avatar"
            style={{
                width: size,
                height: size,
                color: colorVar,
                background: `color-mix(in oklab, ${colorVar} 18%, transparent)`,
                border: `1px solid color-mix(in oklab, ${colorVar} 30%, transparent)`,
            }}
        >
            <DesignIcon name={icon} size={size * 0.5} color={colorVar} />
        </span>
    );
}

function ProgressBar({
    value,
    color = "var(--brand)",
    height = 6,
}: {
    value: number;
    color?: string;
    height?: number;
}) {
    const clamped = Math.max(0, Math.min(1.5, value));
    const over = clamped > 1;
    return (
        <div
            className="ov-progress"
            style={{
                height,
                borderRadius: 999,
                background: "var(--bg-elev-3)",
                overflow: "hidden",
                position: "relative",
            }}
        >
            <div
                style={{
                    height: "100%",
                    width: `${Math.min(clamped, 1) * 100}%`,
                    background: over ? "var(--expense)" : color,
                    borderRadius: 999,
                    transition: "width 600ms cubic-bezier(0.2,0.7,0.2,1)",
                }}
            />
        </div>
    );
}

function Skeleton({ width, height = 16 }: { width?: number | string; height?: number }) {
    return (
        <div
            style={{
                width: width ?? "100%",
                height,
                borderRadius: 6,
                background:
                    "linear-gradient(90deg, var(--bg-elev-1), var(--bg-elev-2), var(--bg-elev-1))",
                backgroundSize: "200% 100%",
                animation: "ov-shimmer 1.6s ease-in-out infinite",
            }}
        />
    );
}

function EmptyHint({ children, compact }: { children: ReactNode; compact?: boolean }) {
    return (
        <div
            style={{
                fontSize: 13,
                color: "var(--fg-3)",
                padding: compact ? "12px 0" : "24px 0",
                textAlign: "center",
            }}
        >
            {children}
        </div>
    );
}

/* ---------- Charts ---------- */

function BalanceTrend({ series }: { series: Array<{ bucket: string; balance: number }> }) {
    if (series.length === 0) return null;
    const first = series[0]!.balance;
    const last = series[series.length - 1]!.balance;
    const delta = last - first;
    const firstBucket = series[0]!.bucket;
    return (
        <>
            <div className="ov-trend-kpis">
                <KpiCol label={formatInAppTz(firstBucket, "MMM d")} amount={first} />
                <KpiCol label="Today" amount={last} />
                <KpiCol
                    label="Change"
                    amount={delta}
                    variant={delta >= 0 ? "income" : "expense"}
                    signed
                />
            </div>
            <AreaChart series={series} height={210} />
        </>
    );
}

function KpiCol({
    label,
    amount,
    variant = "neutral",
    signed,
}: {
    label: string;
    amount: number;
    variant?: "neutral" | "income" | "expense";
    signed?: boolean;
}) {
    return (
        <div>
            <div className="ov-kpi-eyebrow">{label}</div>
            <Money amount={amount} size={16} weight={500} variant={variant} signed={signed} />
        </div>
    );
}

/**
 * Position an HTML dot overlay at an SVG-space coordinate from a chart
 * using `preserveAspectRatio="none"` (which stretches width only — see
 * `AreaChart`). `left` is percentage-based so it tracks the horizontal
 * stretch; `top` is a literal px since the SVG's height isn't stretched.
 * A native SVG `<circle>` at the same coordinate would have its radius
 * squashed into an ellipse whenever the rendered width isn't exactly
 * `viewBoxWidth`.
 */
function dotStyle(
    viewBoxWidth: number,
    svgX: number,
    svgY: number,
    diameter: number,
    color: string,
    opacity = 1
): React.CSSProperties {
    return {
        position: "absolute",
        left: `${(svgX / viewBoxWidth) * 100}%`,
        top: svgY,
        width: diameter,
        height: diameter,
        transform: "translate(-50%, -50%)",
        borderRadius: "9999px",
        background: color,
        opacity,
        pointerEvents: "none",
    };
}

/**
 * Hand-rolled area chart with mouse-tracking hover. Uses two distinct
 * hues (warm gold line + cool green fill) to mirror the editorial
 * treatment from the Balance history detail view. On hover, snaps a
 * vertical guide + dot to the nearest data point and shows a tooltip
 * with the date and value at that point — recharts is overkill for the
 * overview's small chart and brings in extra bundle weight we don't
 * need here.
 */
function AreaChart({
    series,
    height = 200,
    /** Base color for stroke and end-dot — warm gold by default. */
    lineColor = "oklch(82% 0.16 95)",
    /** Base color for the area gradient — cooler green by default. */
    fillColor = "oklch(60% 0.16 145)",
}: {
    series: Array<{ bucket: string; balance: number }>;
    height?: number;
    lineColor?: string;
    fillColor?: string;
}) {
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);

    if (series.length < 2) return <EmptyHint>Not enough points yet.</EmptyHint>;

    const w = 800;
    const h = height;
    const p = 12;
    const data = series.map((d) => d.balance);
    const max = Math.max(...data);
    const min = Math.min(...data);
    const sx = (i: number) => p + (i / (data.length - 1)) * (w - p * 2);
    const sy = (v: number) => h - p - ((v - min) / (max - min || 1)) * (h - p * 2);
    const path = data
        .map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`)
        .join(" ");
    const area = `${path} L ${sx(data.length - 1)} ${h - p} L ${p} ${h - p} Z`;
    const lastIdx = data.length - 1;

    const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
        // Translate cursor x into a `viewBox` x coord, then snap to the
        // closest data point. Tracked on the wrapping div (not the SVG)
        // so the SVG can keep `preserveAspectRatio="none"` and stretch
        // horizontally without the math going off — we use the wrapper's
        // bounding rect to remap.
        const rect = e.currentTarget.getBoundingClientRect();
        const xRatio = (e.clientX - rect.left) / Math.max(1, rect.width);
        if (xRatio < 0 || xRatio > 1) {
            setHoverIdx(null);
            return;
        }
        const xInChart = p + xRatio * (w - p * 2);
        const i = Math.round(((xInChart - p) / (w - p * 2)) * lastIdx);
        const clamped = Math.max(0, Math.min(lastIdx, i));
        setHoverIdx(clamped);
    };

    const active = hoverIdx ?? lastIdx;
    const activeX = sx(active);
    const activeY = sy(data[active]!);
    const tooltipPctLeft = (activeX / w) * 100;

    return (
        <div
            onMouseMove={onMove}
            onMouseLeave={() => setHoverIdx(null)}
            style={{ position: "relative" }}
        >
            <svg
                viewBox={`0 0 ${w} ${h}`}
                width="100%"
                height={h}
                preserveAspectRatio="none"
                style={{ display: "block" }}
            >
                <defs>
                    <linearGradient id="ov-area-grad" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={fillColor} stopOpacity="0.5" />
                        <stop offset="100%" stopColor={fillColor} stopOpacity="0" />
                    </linearGradient>
                </defs>
                {[0, 1, 2, 3].map((i) => (
                    <line
                        key={i}
                        x1={p}
                        x2={w - p}
                        y1={p + (i * (h - p * 2)) / 3}
                        y2={p + (i * (h - p * 2)) / 3}
                        stroke="var(--line-soft, var(--border))"
                        strokeDasharray="2 4"
                    />
                ))}
                <path d={area} fill="url(#ov-area-grad)" />
                <path d={path} fill="none" stroke={lineColor} strokeWidth="1.6" />

                {/* Hover guide line only — the dots are HTML overlays below
                    (see `dotStyle`); the SVG uses `preserveAspectRatio="none"`
                    to stretch horizontally, which would squash a native
                    `<circle>`'s radius into an ellipse on any width other
                    than the `w=800` viewBox. */}
                {hoverIdx !== null && (
                    <line
                        x1={activeX}
                        x2={activeX}
                        y1={p}
                        y2={h - p}
                        stroke={lineColor}
                        strokeOpacity={0.4}
                        strokeDasharray="3 4"
                    />
                )}
            </svg>

            {/* Hover dot (or end-point dot when not hovering) — HTML overlays,
                not SVG circles, so they stay round regardless of how much
                the SVG above stretches horizontally. */}
            {hoverIdx !== null ? (
                <>
                    <span style={dotStyle(w, activeX, activeY, 14, lineColor, 0.22)} />
                    <span style={dotStyle(w, activeX, activeY, 7, lineColor)} />
                </>
            ) : (
                <>
                    <span
                        style={dotStyle(w, sx(lastIdx), sy(data[lastIdx]!), 14, lineColor, 0.18)}
                    />
                    <span style={dotStyle(w, sx(lastIdx), sy(data[lastIdx]!), 7, lineColor)} />
                </>
            )}

            {/* Tooltip — absolutely positioned over the wrapper. Pointer
                events disabled so it doesn't steal hover from the SVG;
                left clamps to keep the bubble fully on-screen near the
                edges. */}
            {hoverIdx !== null && (
                <div
                    style={{
                        position: "absolute",
                        top: 8,
                        left: `${Math.max(4, Math.min(96, tooltipPctLeft))}%`,
                        transform: "translateX(-50%)",
                        pointerEvents: "none",
                        background: "var(--popover, var(--background))",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: 11,
                        lineHeight: 1.3,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                        whiteSpace: "nowrap",
                        zIndex: 1,
                    }}
                >
                    <div
                        style={{
                            color: "var(--muted-foreground, #888)",
                            fontSize: 10,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                            marginBottom: 2,
                        }}
                    >
                        {formatInAppTz(series[active]!.bucket, "MMM d, yyyy")}
                    </div>
                    <Money amount={data[active]!} size={13} weight={600} />
                </div>
            )}
        </div>
    );
}

function CashFlow({ data }: { data: Array<{ bucket: string; income: number; expense: number }> }) {
    if (data.length === 0) return null;
    const w = 800;
    const h = 200;
    const p = 18;
    const n = data.length;
    const max = Math.max(...data.map((d) => Math.max(d.income, d.expense))) || 1;
    const slot = (w - p * 2) / n;
    const bw = Math.max(3, slot / 2 - 4);
    const sx = (i: number) => p + i * slot;
    const sy = (v: number) => h - p - 12 - (v / max) * (h - p * 2 - 12);
    return (
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ display: "block" }}>
            {[0, 1, 2, 3].map((i) => (
                <line
                    key={i}
                    x1={p}
                    x2={w - p}
                    y1={p + (i * (h - p * 2 - 12)) / 3}
                    y2={p + (i * (h - p * 2 - 12)) / 3}
                    stroke="var(--line-soft)"
                    strokeDasharray="2 4"
                />
            ))}
            {data.map((d, i) => {
                const incomeH = d.income > 0 ? Math.max(3, h - p - 12 - sy(d.income)) : 0;
                const expenseH = d.expense > 0 ? Math.max(3, h - p - 12 - sy(d.expense)) : 0;
                return (
                    <g key={i}>
                        {incomeH > 0 && (
                            <rect
                                x={sx(i) + 4}
                                y={h - p - 12 - incomeH}
                                width={bw}
                                height={incomeH}
                                fill="var(--income)"
                                opacity="0.85"
                                rx="2"
                            />
                        )}
                        {expenseH > 0 && (
                            <rect
                                x={sx(i) + 4 + bw + 3}
                                y={h - p - 12 - expenseH}
                                width={bw}
                                height={expenseH}
                                fill="var(--expense)"
                                opacity="0.85"
                                rx="2"
                            />
                        )}
                        <text
                            x={sx(i) + slot / 2}
                            y={h - 4}
                            fontSize="9.5"
                            fill="var(--fg-4)"
                            textAnchor="middle"
                            style={{ letterSpacing: "0.04em" }}
                        >
                            {formatInAppTz(d.bucket, "MMM d")}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

/**
 * Wraps the shared `Donut` (`@/components/shared/charts/Donut` — the same
 * recharts-based ring used on the envelope details page) in an Overview
 * card shell. Previously this rendered a bespoke hand-rolled SVG ring
 * with its own static legend markup; that's gone in favor of the shared
 * component's hover-swappable center label, built-in scrollable legend,
 * and tooltip, so every donut in the app now looks and behaves the same.
 */
function DonutCard({
    title,
    sub,
    action,
    slices,
    centerLabel,
    centerValue,
    loading,
}: {
    title: ReactNode;
    sub?: ReactNode;
    action?: ReactNode;
    slices: Array<{ id: string; name: string; value: number; color: string }>;
    centerLabel: string;
    centerValue: number;
    loading?: boolean;
}) {
    return (
        <div className="od-card ov-section ov-donut-card">
            <SectionHead title={title} sub={sub} action={action} />
            {loading ? (
                <Skeleton height={200} />
            ) : (
                <Donut
                    data={slices}
                    centerLabel={centerLabel}
                    centerValue={centerValue}
                    height={220}
                    format={formatShort}
                    emptyLabel="No data yet."
                />
            )}
        </div>
    );
}

function renderDelta(
    delta: number | null,
    dir: "higher-better" | "lower-better",
    /** Caller passes the prior-period label (e.g. "Apr") so the comparison
     *  reads correctly regardless of which month we're actually viewing. */
    priorLabel: string
): ReactNode {
    if (delta == null) return null;
    if (delta === Infinity) return `New vs ${priorLabel}`;
    if (delta === 0) return "No change";
    const good = dir === "higher-better" ? delta > 0 : delta < 0;
    const sign = delta > 0 ? "+" : "−";
    const color = good ? "var(--income)" : "var(--expense)";
    return (
        <span style={{ color }}>
            {sign}
            {Math.abs(delta).toFixed(0)}% vs {priorLabel}
        </span>
    );
}

function formatShort(n: number): string {
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/* ---------- Inline icons ---------- */
const ICON_PATHS: Record<string, string> = {
    home: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
    wallet: "M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1h2v8h-2v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm14 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
    cart: "M3 4h2l3 12h11l2-8H7M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    car: "M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13m-14 0v5h2v-2h10v2h2v-5m-14 0h14M7 16h.01M17 16h.01",
    book: "M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM4 17a3 3 0 0 1 3-3h11",
    flame: "M12 22s7-4 7-10c0-3-2-5-3-6 0 2-1 3-2 3-1-3-3-5-3-7-2 1-6 5-6 10 0 6 7 10 7 10z",
    bolt: "M13 2 3 14h7l-1 8 10-12h-7z",
    coffee: "M5 8h12v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zm12 1h2a2 2 0 1 1 0 4h-2zM7 4v2M11 4v2M15 4v2",
    layers: "m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5M3 17l9 5 9-5",
    target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-4a6 6 0 1 0 0-12 6 6 0 0 0 0 12zm0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    calendar: "M5 5h14v14H5zM5 9h14M9 3v4M15 3v4",
    chart: "M3 21V3m18 18H3m4-4 4-6 4 4 6-8",
    plus: "M12 5v14M5 12h14",
    trendUp: "M3 17 9 11 13 15 21 7M14 7h7v7",
    trendDown: "M3 7 9 13 13 9 21 17M14 17h7v-7",
    flag: "M4 21v-7M4 4h13l-2 4 2 4H4",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    filter: "M3 5h18l-7 9v6l-4-2v-4z",
    chevronRight: "m9 6 6 6-6 6",
    arrowUp: "M12 19V5m-7 7 7-7 7 7",
    arrowDown: "M12 5v14m7-7-7 7-7-7",
    share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4m4-4v13",
    music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z",
    camera: "M3 8h4l2-3h6l2 3h4v11H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    sparkle: "M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z",
    repeat: "M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5",
};

function DesignIcon({
    name,
    size = 14,
    color = "currentColor",
}: {
    name: string;
    size?: number;
    color?: string;
}) {
    const d = ICON_PATHS[name] ?? ICON_PATHS.layers;
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d={d} />
        </svg>
    );
}

const TrendUpIcon = ({ color = "currentColor" }: { color?: string }) => (
    <DesignIcon name="trendUp" size={13} color={color} />
);
const TrendDownIcon = ({ color = "currentColor" }: { color?: string }) => (
    <DesignIcon name="trendDown" size={13} color={color} />
);
const LayersIcon = ({ color = "currentColor" }: { color?: string }) => (
    <DesignIcon name="layers" size={13} color={color} />
);
const WalletIcon = () => <DesignIcon name="wallet" size={13} color="var(--fg-4)" />;
const CartIcon = ({ color = "currentColor" }: { color?: string }) => (
    <DesignIcon name="cart" size={13} color={color} />
);
const FlagIcon = ({ color = "currentColor" }: { color?: string }) => (
    <DesignIcon name="flag" size={13} color={color} />
);
const TargetIcon = ({ color = "currentColor" }: { color?: string }) => (
    <DesignIcon name="target" size={13} color={color} />
);
const FilterIcon = () => <DesignIcon name="filter" size={13} color="var(--fg-3)" />;
const ChartIcon = () => <DesignIcon name="chart" size={13} color="var(--fg-3)" />;
const PlusIcon = () => <DesignIcon name="plus" size={13} color="var(--brand-fg)" />;
const BoltIcon = () => <DesignIcon name="bolt" size={16} color="var(--warn)" />;

/* =============================================================
   New (design-driven) components
   ============================================================= */

/** Section eyebrow — small label + subtitle separating big page bands. */
function SectionEyebrow({ label, sub }: { label: string; sub: string }) {
    return (
        <div className="ov-section-eyebrow">
            <span className="eyebrow">{label}</span>
            <span className="ov-section-eyebrow-sub">· {sub}</span>
        </div>
    );
}

/** Today band — quick-glance daily summary at the very top.
 *  Cleared/pending counts and last-sync are intentionally absent (the
 *  schema has no transaction-status field yet — see plan §2.1). */
function TodayBand({
    now,
    data,
}: {
    now: Date;
    data: {
        inTotal: number;
        outTotal: number;
        net: number;
        txnCount: number;
    } | null;
}) {
    const net = data?.net ?? 0;
    const txnCount = data?.txnCount ?? 0;
    const inflow = data?.inTotal ?? 0;
    const outflow = data?.outTotal ?? 0;
    /* Cleared / pending / last-sync intentionally absent — those fields
       require schema changes (transactions.status, integration sync metadata)
       that don't exist yet. See plans/orbit-v2-backend-gaps.md §2.1. */
    const cells: Array<{ label: string; value: ReactNode; tone?: string }> = [
        {
            label: "Today",
            value: <span style={{ color: "var(--fg-2)" }}>{formatInAppTz(now, "MMM d")}</span>,
        },
        {
            label: "Net today",
            value: (
                <Money
                    amount={Math.abs(net)}
                    variant={net >= 0 ? "income" : "expense"}
                    size={13}
                    signed
                />
            ),
        },
        {
            label: "Transactions",
            value: <span className="tabular">{txnCount}</span>,
        },
        {
            label: "Inflow",
            value: <Money amount={inflow} variant="income" size={13} />,
        },
        {
            label: "Outflow",
            value: <Money amount={outflow} variant="expense" size={13} />,
        },
    ];
    return (
        <div className="od-card ov-today-band">
            {cells.map((c, i) => (
                <div key={c.label} className="ov-today-cell">
                    <span className="ov-today-label">{c.label}</span>
                    <span className="ov-today-value">{c.value}</span>
                    {i < cells.length - 1 && <span className="ov-today-divider" />}
                </div>
            ))}
        </div>
    );
}

/** Net worth composition — assets minus liabilities, with horizontal
 *  split bars. Built from accountDistribution. */
function NetWorthComposition({
    accounts,
    loading,
    history,
    spaceId,
}: {
    spaceId: string;
    accounts: Array<{
        accountId: string;
        name: string;
        accountType: "asset" | "liability" | "locked";
        color: string;
        balance: number;
    }>;
    loading?: boolean;
    history: Array<{
        bucket: Date | string;
        assets: number;
        liabilities: number;
        netWorth: number;
    }>;
}) {
    const assets = accounts.filter((a) => a.accountType === "asset" || a.accountType === "locked");
    const liabs = accounts.filter((a) => a.accountType === "liability");
    const assetTotal = assets.reduce((s, x) => s + x.balance, 0);
    const liabTotal = liabs.reduce((s, x) => s + x.balance, 0);
    const net = assetTotal - liabTotal;

    /* YoY = compare the most recent bucket's netWorth to the bucket
       12 months prior. Only computed when the series has at least 13
       buckets (current + 12 prior); otherwise we hide the line. */
    const yoy = useMemo(() => {
        if (history.length < 13) return null;
        const last = history[history.length - 1];
        const prior = history[history.length - 13];
        if (prior.netWorth === 0) return null;
        const delta = last.netWorth - prior.netWorth;
        const pct = (delta / Math.abs(prior.netWorth)) * 100;
        return { delta, pct };
    }, [history]);

    return (
        <div className="od-card ov-section ov-nwc">
            <SectionHead
                title={
                    <>
                        <LayersIcon color="var(--brand)" /> Net worth composition
                    </>
                }
                sub="Assets minus liabilities · 12-month trend"
                action={
                    <Link className="ov-details-link" to={ROUTES.spaceAccounts(spaceId)}>
                        Open breakdown →
                    </Link>
                }
            />
            {loading ? (
                <Skeleton height={140} />
            ) : (
                <div className="ov-nwc-body">
                    <div className="ov-nwc-numbers">
                        <div className="ov-stat-eyebrow">Net worth</div>
                        <div className="ov-nwc-net">
                            <Money amount={net} size={32} weight={500} />
                        </div>
                        {yoy ? (
                            <div
                                style={{
                                    fontSize: 11.5,
                                    color: yoy.delta >= 0 ? "var(--income)" : "var(--expense)",
                                    marginTop: 2,
                                }}
                            >
                                {yoy.delta >= 0 ? "+" : ""}
                                {yoy.pct.toFixed(1)}% YoY · {yoy.delta >= 0 ? "+" : "−"}
                                <Money
                                    amount={Math.abs(yoy.delta)}
                                    size={11.5}
                                    variant={yoy.delta >= 0 ? "income" : "expense"}
                                />
                            </div>
                        ) : (
                            <div
                                style={{
                                    fontSize: 11.5,
                                    color: "var(--fg-3)",
                                    marginTop: 2,
                                }}
                            >
                                Building 12-month history…
                            </div>
                        )}
                        <div className="ov-nwc-pair">
                            <div>
                                <div className="ov-stat-eyebrow">Assets</div>
                                <Money
                                    amount={assetTotal}
                                    size={14}
                                    weight={500}
                                    variant="income"
                                />
                            </div>
                            <div>
                                <div className="ov-stat-eyebrow">Liabilities</div>
                                <Money
                                    amount={liabTotal}
                                    size={14}
                                    weight={500}
                                    variant="expense"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="ov-nwc-bars">
                        <div className="ov-nwc-trendwrap">
                            <AreaChart
                                series={history.map((p) => ({
                                    bucket:
                                        p.bucket instanceof Date
                                            ? p.bucket.toISOString()
                                            : p.bucket,
                                    balance: p.netWorth,
                                }))}
                                height={120}
                            />
                        </div>
                        <NwcSplitBar
                            label={`Assets · ${formatShort(assetTotal)}`}
                            badge="Composition"
                            items={assets}
                            total={assetTotal}
                        />
                        <NwcSplitBar
                            label={`Liabilities · ${formatShort(liabTotal)}`}
                            items={liabs}
                            total={liabTotal}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

function NwcSplitBar({
    label,
    badge,
    items,
    total,
}: {
    label: string;
    badge?: string;
    items: Array<{ accountId: string; name: string; balance: number; color: string }>;
    total: number;
}) {
    return (
        <div className="ov-nwc-split">
            <div className="ov-nwc-split-head">
                <span className="ov-stat-eyebrow">{label}</span>
                {badge && <span className="ov-stat-eyebrow">{badge}</span>}
            </div>
            <div className="ov-nwc-split-bar">
                {items.map((it) => {
                    const pct = total > 0 ? (it.balance / total) * 100 : 0;
                    if (pct <= 0) return null;
                    return (
                        <span
                            key={it.accountId}
                            style={{ width: `${pct}%`, background: it.color }}
                        />
                    );
                })}
            </div>
            <div className="ov-nwc-split-legend">
                {items.slice(0, 6).map((it) => {
                    const pct = total > 0 ? (it.balance / total) * 100 : 0;
                    return (
                        <span key={it.accountId} className="ov-nwc-split-legend-cell">
                            <span className="ov-donut-dot" style={{ background: it.color }} />
                            <span style={{ color: "var(--fg-2)" }}>{it.name}</span>
                            <span style={{ color: "var(--fg-4)" }}>· {pct.toFixed(0)}%</span>
                        </span>
                    );
                })}
            </div>
        </div>
    );
}

const MONTH_ABBR = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

/**
 * Daily spend heatmap — calendar grid shaded by the same data-driven
 * quantile ramp as the "Spending calendar" analytics page
 * (`@/lib/spendHeatmapColor`): bucket edges are the 20/40/60/80th
 * percentile of the space's trailing 12-month distribution
 * (IQR-outlier-trimmed), the same window the Spending calendar uses, so
 * a given day's amount buckets the same way on both pages when the
 * Spending calendar is unfiltered — that page recomputes its edges from
 * whatever the active envelope/account/category filters leave in view,
 * while this widget always uses the space's unfiltered distribution (it
 * has no filters of its own). Colors are drawn from the shared `AMBER`
 * palette so the two calendars are the same system, not just a
 * similar-looking one.
 *
 * `mode` (the page-level Cash/Operational toggle, same URL-persisted
 * state the "Operational flow" chart below reads) is threaded straight
 * into the `spendingHeatmap` query: `operational` counts only true
 * expenses, `cash` also counts cross-space outbound transfer principal.
 * A transfer to your own savings account isn't spending, so it
 * shouldn't paint a calendar day as a heavy one by default.
 */
function DailyHeatmap({
    now,
    data,
    loading,
    spaceId,
    mode,
}: {
    now: Date;
    data: Array<{ day: Date; total: number }>;
    loading?: boolean;
    spaceId: string;
    mode: MetricMode;
}) {
    const monthLabel = formatInAppTz(now, "MMMM yyyy");
    // App-tz fields throughout — `byDay` below is keyed off `formatInAppTz`,
    // so the grid frame (which day is "today", how many cells, which
    // weekday the 1st falls on) must use the same wall-clock, not the
    // browser's local tz.
    const year = getAppTzYear(now);
    const month = getAppTzMonth(now); // 0-indexed, matches MONTH_ABBR below
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0 = Sun
    const today = getAppTzDate(now);

    /* `r.day` is an absolute instant (an app-tz day boundary from the
     * server), not a date-only value — reading it with native
     * `getMonth()`/`getDate()` returns the *browser-local* calendar day,
     * which silently disagrees with the app-tz day for any viewer west
     * of Asia/Dhaka. That was harmless while this query only ever
     * returned the current month's rows, but now that it spans a full
     * year (for the shared color-bucket edges below), a browser-local
     * misread could both misplace a day within the grid *and* — since
     * the check only compared month-of-year, not year — inject a
     * same-numbered month from a different year into this month's
     * total/peak. Compare the full app-tz "yyyy-MM" prefix instead,
     * matching the `formatInAppTz`-keyed convention the Spending
     * calendar page uses for the same data. */
    const monthKey = formatInAppTz(now, "yyyy-MM");
    const byDay = new Map<number, number>();
    for (const r of data) {
        const key = formatInAppTz(r.day, "yyyy-MM-dd");
        if (key.startsWith(monthKey)) byDay.set(Number(key.slice(8, 10)), r.total);
    }
    /* Bucket edges come from `data`'s full trailing-12-month span (the same
     * window the Spending calendar analytics page uses — see the widened
     * query at this component's call site), not just this month's ~30
     * days. Otherwise the two calendars would share a palette but not a
     * scale: the same day's amount could land in a different bucket on
     * each page, and a partial month's small sample would recolor already-
     * rendered days as more of the month's data arrives. `byDay` above
     * stays scoped to this month — it drives the grid and this month's
     * stats, not the color scale. */
    const edges = useMemo(() => computeQuantileEdges(data.map((r) => r.total)), [data]);
    const totalMonth = Array.from(byDay.values()).reduce((s, x) => s + x, 0);
    const noSpendDays = Array.from({ length: today }, (_, i) => i + 1).filter(
        (d) => !byDay.has(d) || byDay.get(d) === 0
    ).length;
    let peakDay: number | null = null;
    let peakAmt = 0;
    for (const [d, v] of byDay) {
        if (v > peakAmt) {
            peakAmt = v;
            peakDay = d;
        }
    }

    /* Build a calendar grid: leading empties + days. 7 cols. */
    const cells: Array<{ d: number | null; v: number }> = [];
    for (let i = 0; i < firstWeekday; i++) cells.push({ d: null, v: 0 });
    for (let d = 1; d <= daysInMonth; d++) {
        cells.push({ d, v: byDay.get(d) ?? 0 });
    }
    while (cells.length % 7 !== 0) cells.push({ d: null, v: 0 });

    return (
        <div className="od-card ov-section ov-heatmap">
            <SectionHead
                title={
                    <>
                        <DesignIcon name="calendar" size={13} color="var(--gold)" /> Daily spend
                        heatmap
                    </>
                }
                sub={
                    mode === "cash"
                        ? `${monthLabel} · brighter = heavier day (incl. transfers out)`
                        : `${monthLabel} · brighter = heavier day for you`
                }
                action={
                    <Link
                        className="ov-details-link"
                        to={ROUTES.spaceAnalyticsDetail(spaceId, "heatmap")}
                    >
                        Open calendar →
                    </Link>
                }
            />
            {loading ? (
                <Skeleton height={240} />
            ) : (
                <>
                    <div className="ov-heatmap-grid">
                        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
                            <span key={i} className="ov-heatmap-weekday">
                                {w}
                            </span>
                        ))}
                        {cells.map((c, i) => {
                            const isToday = c.d === today;
                            const isFuture = c.d != null && c.d > today;
                            const isPlaceholder = c.d == null;
                            const isPeak = c.d != null && c.d === peakDay;
                            const r = ramp(bucketize(c.v, edges));
                            return (
                                <div
                                    key={i}
                                    className={`ov-heatmap-cell${isToday ? " is-today" : ""}${isFuture ? " is-future" : ""}${isPlaceholder ? " is-empty" : ""}`}
                                    style={{
                                        background: isPlaceholder
                                            ? "transparent"
                                            : isFuture
                                              ? "var(--bg-elev-2)"
                                              : r.bg,
                                        /* Peak day gets the same dual-tone halo as the
                                           Spending calendar page — a dark inner ring
                                           plus a light outer ring reads clearly
                                           regardless of the cell's own bucket color,
                                           unlike a single-color ring that can vanish
                                           against an already-bright cell. */
                                        boxShadow: isPeak
                                            ? "0 0 0 1px var(--bg), 0 0 0 2.5px var(--fg)"
                                            : undefined,
                                    }}
                                >
                                    {c.d != null && (
                                        <>
                                            <span
                                                className="ov-heatmap-dnum"
                                                style={
                                                    !isFuture && !isPlaceholder
                                                        ? { color: r.fg }
                                                        : undefined
                                                }
                                            >
                                                {c.d}
                                            </span>
                                            {c.v > 0 && (
                                                <span
                                                    className="ov-heatmap-damt"
                                                    style={!isFuture ? { color: r.fg } : undefined}
                                                >
                                                    {formatCompact(c.v)}
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="ov-heatmap-foot">
                        <div>
                            <div className="ov-stat-eyebrow">This month</div>
                            <Money amount={totalMonth} size={14} weight={500} />
                        </div>
                        <div>
                            <div className="ov-stat-eyebrow">No-spend days</div>
                            <span
                                className="tabular"
                                style={{
                                    fontSize: 14,
                                    color: "var(--income)",
                                    fontWeight: 500,
                                }}
                            >
                                {noSpendDays}
                            </span>
                        </div>
                        <div>
                            <div className="ov-stat-eyebrow">Peak day</div>
                            {peakDay ? (
                                <span style={{ fontSize: 14 }}>
                                    {MONTH_ABBR[month]} {peakDay}
                                    {" · "}
                                    <Money
                                        amount={peakAmt}
                                        size={14}
                                        weight={500}
                                        variant="expense"
                                    />
                                </span>
                            ) : (
                                <span style={{ fontSize: 14, color: "var(--fg-4)" }}>—</span>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

/** Top movers — biggest week-over-week category shifts. */
function TopMovers({
    movers,
    spaceId,
}: {
    spaceId: string;
    movers: Array<{
        categoryId: string;
        name: string;
        color: string;
        icon: string;
        thisWeek: number;
        lastWeek: number;
        deltaAmount: number;
        deltaPct: number;
    }>;
}) {
    const rows = movers.map((m) => ({
        name: m.name,
        icon: m.icon,
        color: m.color,
        cur: m.thisWeek,
        prev: m.lastWeek,
    }));
    const max = Math.max(1, ...rows.flatMap((r) => [r.cur, r.prev]));
    return (
        <div className="od-card ov-section ov-movers">
            <SectionHead
                title={
                    <>
                        <DesignIcon name="repeat" size={13} color="var(--brand)" /> Top movers
                    </>
                }
                sub="Biggest week-over-week shifts"
                action={
                    <Link
                        className="ov-details-link"
                        to={ROUTES.spaceAnalyticsDetail(spaceId, "categories")}
                    >
                        View all →
                    </Link>
                }
            />
            <div className="ov-list-col">
                {rows.length === 0 ? (
                    <EmptyHint>No category movement vs last week.</EmptyHint>
                ) : null}
                {rows.map((r) => {
                    // No spend last week means "% change" isn't a real number —
                    // show "New" instead of a misleading "▲ 0%" for a category
                    // that only started showing up this week.
                    const isNew = r.prev <= 0 && r.cur > 0;
                    const pct = r.prev > 0 ? ((r.cur - r.prev) / r.prev) * 100 : 0;
                    const isUp = r.cur > r.prev;
                    const isDown = r.cur < r.prev;
                    const arrow = isUp ? "▲" : isDown ? "▼" : "•";
                    const tone = isUp ? "var(--expense)" : isDown ? "var(--income)" : "var(--fg-3)";
                    return (
                        <div key={r.name} className="ov-mover-row">
                            <EntityAvatar icon={r.icon} colorVar={r.color} size={26} />
                            <div className="ov-mover-text">
                                <div className="ov-mover-name">{r.name}</div>
                                <div className="ov-mover-bar">
                                    <span
                                        style={{
                                            width: `${(r.cur / max) * 100}%`,
                                            background: r.color,
                                        }}
                                    />
                                </div>
                            </div>
                            <div className="ov-mover-amt">
                                <Money amount={r.cur} size={11.5} />{" "}
                                <span style={{ color: "var(--fg-4)", fontSize: 10.5 }}>
                                    vs <Money amount={r.prev} size={10.5} variant="muted" />
                                </span>
                            </div>
                            <div
                                className="ov-mover-delta"
                                style={{ color: tone, fontSize: 12, fontWeight: 500 }}
                            >
                                {isNew ? "New" : `${arrow} ${Math.abs(pct).toFixed(0)}%`}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** Spending trends — embeds the same `CumulativeRaceChart` the
 *  /analytics/trends detail view uses, pinned to month granularity.
 *  Driven by `analytics.trends.dailyComparison`. */
function SpendingTrends({
    monthExpense,
    lastMonthExpense,
    trendsData,
    loading,
    periodStart,
    detailHref,
}: {
    monthExpense: number;
    lastMonthExpense: number;
    trendsData: {
        today: number;
        periodLength: number;
        current: number[];
        previous: number[];
        average: number[] | null;
        bucketDays: number;
        bucketUnit: "day" | "week" | "month";
    } | null;
    /** True while the underlying `dailyComparison` query is still in
     *  flight — `trendsData` is also `null` once it's errored out, so
     *  this only covers the load, not a permanent error state. Without
     *  this the cumulative math below quietly degrades to "Day 1 of 30"
     *  and a −100% pace instead of a loading skeleton. */
    loading?: boolean;
    /** Start of the current period — month start for the overview
     *  card. Passed straight through to the chart for date labelling. */
    periodStart: Date;
    /** Target for the "Open view →" link in the section head. */
    detailHref: string;
}) {
    const TODAY = trendsData?.today ?? 1;
    const DAYS_IN_MONTH = trendsData?.periodLength ?? 30;
    const CUR_DAILY = trendsData?.current ?? [];
    const PRV_DAILY = trendsData?.previous ?? [];
    const AVG_DAILY = trendsData?.average ?? null;
    const BUCKET_UNIT = trendsData?.bucketUnit ?? "day";

    /* Cumulate the per-bucket deltas client-side — mirrors what the
       detail view does so both surfaces stay in sync. */
    const cumulative = useMemo(() => {
        const cur: number[] = [];
        const prv: number[] = [];
        const avg: number[] | null = AVG_DAILY ? [] : null;
        let curAcc = 0;
        let prvAcc = 0;
        let avgAcc = 0;
        /* Each series over its OWN length: `previous` is sized to the PRIOR
           month's day count, which can exceed this month's (Jan 31 → Feb 28).
           Running all three to `max(…)` padded `cur`/`avg` with repeats of
           their final value, which the chart then plotted past its right
           edge. Mirrors TrendsView's accumulator. */
        for (let i = 0; i < DAYS_IN_MONTH; i++) {
            curAcc += CUR_DAILY[i] ?? 0;
            cur.push(curAcc);
            if (avg && AVG_DAILY) {
                avgAcc += AVG_DAILY[i] ?? 0;
                avg.push(avgAcc);
            }
        }
        for (let i = 0; i < PRV_DAILY.length; i++) {
            prvAcc += PRV_DAILY[i] ?? 0;
            prv.push(prvAcc);
        }
        return { cur, prv, avg };
    }, [CUR_DAILY, PRV_DAILY, AVG_DAILY, DAYS_IN_MONTH]);

    const monthSoFar = cumulative.cur[TODAY - 1] ?? monthExpense;
    const dailyAvg = TODAY > 0 ? monthSoFar / TODAY : 0;
    const projectedTotal = Math.max(monthSoFar, dailyAvg * DAYS_IN_MONTH);
    const paceDelta =
        lastMonthExpense > 0 ? ((projectedTotal - lastMonthExpense) / lastMonthExpense) * 100 : 0;

    return (
        <div className="od-card ov-section ov-trends">
            <SectionHead
                title={
                    <>
                        <DesignIcon name="chart" size={13} color="var(--gold)" /> Spending trends
                    </>
                }
                sub={`Day ${TODAY} of ${DAYS_IN_MONTH} · cumulative spend vs last month`}
                action={
                    <Link to={detailHref} className="ov-details-link">
                        Open view →
                    </Link>
                }
            />
            {loading ? (
                <div className="ov-trends-body">
                    {/* Matches `CumulativeRaceChart`'s own rendered footprint
                        (fixed SVG height + date-axis row) — a shorter
                        placeholder here would make every card below this
                        one jump down once the real (taller) chart replaces
                        it. */}
                    <Skeleton height={478} />
                </div>
            ) : (
                <div className="ov-trends-body">
                    <div className="ov-trends-chart">
                        <CumulativeRaceChart
                            cur={cumulative.cur}
                            prv={cumulative.prv}
                            /* The prior month can have more days than this
                               one; the chart scales it on its own axis. */
                            prvLength={cumulative.prv.length}
                            avg={cumulative.avg}
                            today={TODAY}
                            daysInMonth={DAYS_IN_MONTH}
                            projection={projectedTotal}
                            bucketUnit={BUCKET_UNIT}
                            periodStart={periodStart}
                        />
                        <div className="ov-trends-legend">
                            <span>
                                <span
                                    style={{
                                        width: 14,
                                        height: 2,
                                        background: "var(--warning)",
                                        display: "inline-block",
                                        verticalAlign: "middle",
                                        marginRight: 4,
                                    }}
                                />
                                This month
                            </span>
                            <span>
                                <span
                                    style={{
                                        width: 14,
                                        height: 2,
                                        borderTop: "1px dashed var(--fg-3)",
                                        display: "inline-block",
                                        verticalAlign: "middle",
                                        marginRight: 4,
                                    }}
                                />
                                Last month
                            </span>
                            <span>
                                <span
                                    style={{
                                        width: 14,
                                        height: 2,
                                        borderTop: "1px dotted var(--warning)",
                                        display: "inline-block",
                                        verticalAlign: "middle",
                                        marginRight: 4,
                                    }}
                                />
                                Projection
                            </span>
                        </div>
                    </div>
                    <div className="ov-trends-stats">
                        <div className="od-card ov-trends-stat">
                            <div className="ov-stat-eyebrow">Spent so far</div>
                            <div className="ov-trends-stat-amt">
                                <Money amount={monthSoFar} size={26} weight={500} />
                            </div>
                            <div className="ov-trends-stat-sub">
                                Day {TODAY} ·{" "}
                                <Money amount={dailyAvg} size={11.5} variant="muted" />
                                /day avg
                            </div>
                        </div>
                        <div className="od-card ov-trends-stat">
                            <div className="ov-stat-eyebrow">Projected month</div>
                            <div className="ov-trends-stat-amt">
                                <Money amount={projectedTotal} size={26} weight={500} />
                            </div>
                            <div className="ov-trends-stat-sub">
                                vs <Money amount={lastMonthExpense} size={11.5} variant="muted" />{" "}
                                last month
                            </div>
                        </div>
                        <div className="od-card ov-trends-stat">
                            <div className="ov-stat-eyebrow">Pace ahead</div>
                            <div
                                className="ov-trends-stat-amt"
                                style={{
                                    color: paceDelta > 0 ? "var(--expense)" : "var(--income)",
                                }}
                            >
                                {paceDelta >= 0 ? "+" : "−"}
                                {Math.abs(paceDelta).toFixed(1)}
                                <span style={{ fontSize: 16 }}>%</span>
                            </div>
                            <div className="ov-trends-stat-sub">
                                % {paceDelta > 0 ? "faster" : "slower"} than last month
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** Accounts at a glance — list of accounts with 7-day micro-trends,
 *  sourced from `accountDistribution` and the per-account balance
 *  series (`analytics.balanceHistory` / its personal twin). */
function AccountsGlance({
    accounts,
    loading,
    spaceId,
    isPersonal,
    balanceSeries,
}: {
    accounts: Array<{
        accountId: string;
        name: string;
        accountType: "asset" | "liability" | "locked";
        color: string;
        icon?: string;
        balance: number;
    }>;
    loading?: boolean;
    spaceId: string;
    isPersonal: boolean;
    balanceSeries: Array<{
        accountId: string;
        bucket: Date | string;
        balance: number;
    }>;
}) {
    /* Pivot the flat (accountId, bucket, balance) series into per-account
       sparkline arrays. Slice the trailing 7 days per account. */
    const seriesByAccount = useMemo(() => {
        const map = new Map<string, number[]>();
        const grouped = new Map<string, Array<{ bucket: Date; balance: number }>>();
        for (const row of balanceSeries) {
            const list = grouped.get(row.accountId) ?? [];
            list.push({
                bucket: row.bucket instanceof Date ? row.bucket : new Date(row.bucket),
                balance: row.balance,
            });
            grouped.set(row.accountId, list);
        }
        for (const [id, rows] of grouped) {
            rows.sort((a, b) => a.bucket.getTime() - b.bucket.getTime());
            map.set(
                id,
                rows.slice(-7).map((r) => r.balance)
            );
        }
        return map;
    }, [balanceSeries]);
    return (
        <div className="od-card ov-section ov-glance">
            <SectionHead
                title={
                    <>
                        <DesignIcon name="wallet" size={13} color="var(--brand)" /> Accounts at a
                        glance
                    </>
                }
                sub="Live balances · 7-day micro-trend"
                action={
                    <Link
                        to={isPersonal ? ROUTES.myAccounts : ROUTES.spaceAccounts(spaceId)}
                        className="ov-details-link"
                    >
                        All accounts →
                    </Link>
                }
            />
            {loading ? (
                <div className="ov-list-col">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} height={36} />
                    ))}
                </div>
            ) : accounts.length === 0 ? (
                <EmptyHint compact>No accounts yet.</EmptyHint>
            ) : (
                <div className="ov-list-col" style={{ gap: 14 }}>
                    {accounts.slice(0, 5).map((a) => {
                        const real = seriesByAccount.get(a.accountId);
                        const series =
                            real && real.length > 1 ? real : new Array(7).fill(a.balance);
                        const liability = a.accountType === "liability";
                        // Sign-adjust liabilities the same way the headline
                        // `Money` amount below does, so a growing debt reads
                        // as a *worsening* (red, not green) delta instead of
                        // contradicting the headline's own sign flip.
                        const signedSeries = liability ? series.map((v) => -v) : series;
                        // A near-zero (or negative) 7-day-ago balance makes
                        // the percentage meaningless (or, with a raw floor,
                        // makes it blow up arbitrarily for a newly-funded
                        // account) — show "New" instead of a number then.
                        const base = Math.abs(signedSeries[0]!);
                        const delta =
                            base < 1
                                ? null
                                : ((signedSeries[series.length - 1]! - signedSeries[0]!) / base) *
                                  100;
                        return (
                            <div key={a.accountId} className="ov-glance-row">
                                <EntityAvatar
                                    icon={a.icon ?? "wallet"}
                                    colorVar={a.color}
                                    size={28}
                                />
                                <div className="ov-glance-text">
                                    <div className="ov-glance-name">{a.name}</div>
                                    <div className="ov-glance-id">·· {a.accountId.slice(-4)}</div>
                                </div>
                                <div className="ov-glance-spark">
                                    <Sparkline
                                        data={series}
                                        color={liability ? "var(--expense)" : "var(--income)"}
                                    />
                                </div>
                                <span
                                    className="tabular"
                                    style={{
                                        fontSize: 11,
                                        color:
                                            delta == null
                                                ? "var(--fg-3)"
                                                : delta >= 0
                                                  ? "var(--income)"
                                                  : "var(--expense)",
                                    }}
                                >
                                    {delta == null
                                        ? "New"
                                        : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}%`}
                                </span>
                                <Money
                                    amount={liability ? -a.balance : a.balance}
                                    size={13}
                                    weight={500}
                                />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function Sparkline({ data, color = "var(--brand)" }: { data: number[]; color?: string }) {
    if (data.length < 2) return null;
    const w = 80;
    const h = 22;
    const p = 1;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const sx = (i: number) => p + (i / (data.length - 1)) * (w - p * 2);
    const sy = (v: number) => h - p - ((v - min) / (max - min || 1)) * (h - p * 2);
    const path = data
        .map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`)
        .join(" ");
    return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: "block" }}>
            <path d={path} fill="none" stroke={color} strokeWidth="1.4" />
        </svg>
    );
}

/* =============================================================
   Styles — scoped to .ov-root inside .orbit-design
   ============================================================= */
const OV_STYLES = `
.ov-root {
    /* Cancel SpaceLayout's outer padding so the editorial topbar can sit
       flush against the sidebar / mobile-header edges. */
    margin: -1.5rem -1rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
}
@media (min-width: 768px) {
    .ov-root { margin: -2rem; }
}

@keyframes ov-shimmer {
    0%   { background-position: 100% 0; }
    100% { background-position: -100% 0; }
}

/* Topbar */
.ov-topbar {
    padding: 26px 32px 18px;
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    background: var(--bg);
    flex-wrap: wrap;
}
.ov-topbar-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ov-title {
    font-size: 26px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--fg);
    margin: 0;
}
.ov-sub { font-size: 13px; color: var(--fg-3); margin: 0; }
.ov-topbar-actions {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
}
.ov-link-btn { text-decoration: none; }
.ov-plan-free {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    color: var(--fg-3);
    font-size: 11.5px;
    margin-left: 2px;
}
/* When the chip sits inside the primary state of the Plan button the
   button background is --brand; the default --fg-3 muted gray is too
   low-contrast on that tint. Pull the chip into the brand foreground
   palette so the number stays legible. */
.od-btn-primary .ov-plan-free,
.od-btn-primary .ov-plan-free > * {
    color: color-mix(in oklab, var(--brand-fg) 82%, transparent);
}

/* Scroll body */
.ov-scroll {
    flex: 1;
    padding: 22px 32px 36px;
    display: flex;
    flex-direction: column;
    gap: 18px;
}
@media (max-width: 720px) {
    .ov-topbar { padding: 18px 18px 14px; }
    .ov-scroll { padding: 16px 18px 28px; }
}

/* Section heading */
.ov-sect-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-bottom: 14px;
    gap: 12px;
    flex-wrap: wrap;
}
/* The text block stacks title + subtitle vertically. Without this the
   subtitle would inline next to the title (h2 is inline-flex). */
.ov-sect-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.ov-sect-title {
    font-size: 16px;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--fg);
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
}
.ov-sect-sub { font-size: 12px; color: var(--fg-3); }

.ov-section { padding: 22px; }

.ov-details-link {
    font-size: 12px;
    color: var(--fg-3);
    text-decoration: none;
    padding: 4px 8px;
    border-radius: 6px;
    transition: color 140ms ease, background 140ms ease;
}
.ov-details-link:hover { color: var(--fg); background: var(--bg-elev-2); }

/* Stat row — 6 tiles at wide widths (Net worth, Inflow, Outflow,
   Income, Expense, Unallocated). Drops to 3 then 2 then 1 on smaller
   viewports. Uses an explicit ladder rather than auto-fit so all
   tiles stay the same width within a row. */
.ov-stat-row {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 12px;
}
@media (max-width: 1400px) {
    .ov-stat-row { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
}
@media (max-width: 800px) {
    .ov-stat-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.ov-stat-tile {
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    position: relative;
    overflow: hidden;
}
.ov-stat-accent {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.5;
}
.ov-stat-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
}
.ov-stat-label {
    font-size: 10px;
    color: var(--fg-4);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
}
.ov-stat-icon { color: var(--fg-4); display: inline-flex; }
.ov-stat-amount { position: relative; }
.ov-stat-delta { font-size: 11px; color: var(--fg-3); position: relative; }

/* Personal-only "across spaces" band */
.orbit-design .od-card.ov-personal-band {
    padding: 18px;
    position: relative;
    overflow: hidden;
    border-color: color-mix(in oklab, var(--gold) 22%, var(--line));
    background: color-mix(in oklab, var(--gold) 4%, var(--bg-elev-1));
}
.ov-personal-band-glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(70% 60% at 0% 0%, var(--gold-soft), transparent 60%);
}
.ov-personal-band-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
    position: relative;
    flex-wrap: wrap;
}
.ov-personal-band-headline {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}
.ov-personal-band-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: color-mix(in oklab, var(--gold) 22%, transparent);
    border: 1px solid color-mix(in oklab, var(--gold) 35%, transparent);
    color: var(--gold);
    display: grid;
    place-items: center;
    flex-shrink: 0;
}
.ov-personal-band-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
}
.ov-personal-band-sub {
    font-size: 11.5px;
    color: var(--fg-3);
}
.ov-personal-band-link {
    font-size: 12px;
    color: var(--fg-3);
    text-decoration: none;
    padding: 4px 8px;
    border-radius: 6px;
    transition: color 140ms ease, background 140ms ease;
}
.ov-personal-band-link:hover {
    color: var(--fg);
    background: var(--bg-elev-2);
}
.ov-personal-band-bar {
    display: flex;
    height: 8px;
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 14px;
    position: relative;
    background: var(--bg-elev-3);
}
.ov-personal-band-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    position: relative;
}
@media (max-width: 1100px) {
    .ov-personal-band-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
    .ov-personal-band-grid { grid-template-columns: 1fr; }
}
.ov-personal-band-cell {
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--bg-elev-2);
    border: 1px solid var(--line-soft);
    display: flex;
    flex-direction: column;
    gap: 8px;
    cursor: pointer;
    text-decoration: none;
    color: inherit;
    transition: border-color 140ms ease, background 140ms ease;
}
.ov-personal-band-cell:hover {
    border-color: var(--line-strong);
    background: var(--bg-elev-3);
}
.ov-personal-band-cell-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.ov-personal-band-cell-name {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.ov-personal-band-cell-label {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ov-personal-band-chip {
    height: 18px;
    font-size: 9.5px;
    padding: 0 6px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg-3);
    flex-shrink: 0;
}
.ov-personal-band-cell-foot {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
}
.ov-personal-band-pct {
    font-size: 10.5px;
    color: var(--fg-4);
    font-variant-numeric: tabular-nums;
}

/* Drift / over-allocation banners.
   The selector is doubled (.od-card.ov-*) so it beats the global
   .orbit-design .od-card rule (specificity 0,2,0) — otherwise the
   default card background overrides the warm tint and the banner
   reads as a plain dark card with no amber/red signal. */
.orbit-design .od-card.ov-over {
    padding: 18px;
    border-color: color-mix(in oklab, var(--expense) 35%, var(--line));
    background: color-mix(in oklab, var(--expense) 6%, var(--bg-elev-1));
}
.ov-drift-headline { display: flex; gap: 14px; min-width: 0; }
.ov-drift-icon {
    width: 36px; height: 36px;
    border-radius: 10px;
    background: var(--warn-soft);
    color: var(--warn);
    display: grid; place-items: center;
    flex-shrink: 0;
}
.ov-over-icon {
    background: var(--expense-soft);
    color: var(--expense);
}
.ov-drift-title { font-size: 13.5px; color: var(--fg); font-weight: 500; }
.ov-drift-sub { font-size: 12px; color: var(--fg-3); margin-top: 2px; }

/* Donut trio */
.ov-trio {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
}
.ov-trio-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 1100px) {
    .ov-trio,
    .ov-trio-2 { grid-template-columns: 1fr; }
}
.ov-donut-card { display: flex; flex-direction: column; gap: 16px; }
.ov-donut-dot {
    width: 7px;
    height: 7px;
    border-radius: 99px;
    flex-shrink: 0;
}

/* Trend KPI row */
.ov-trend-kpis {
    display: grid;
    grid-template-columns: auto auto auto 1fr;
    gap: 28px;
    align-items: center;
    margin-bottom: 12px;
}
.ov-kpi-eyebrow {
    font-size: 10.5px;
    color: var(--fg-4);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 4px;
}

/* Cash flow legend */
.ov-cf-legend {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
}
.ov-legend-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--fg-3);
}
.ov-legend-chip > span:first-child {
    width: 8px; height: 8px; border-radius: 2px;
}

/* Month progress strip */
.ov-progress-strip {
    padding: 16px 22px;
    display: flex;
    align-items: center;
    gap: 22px;
    flex-wrap: wrap;
}
.ov-progress-bar { flex: 1; min-width: 240px; }
.ov-progress-bar-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
}
.ov-progress-label { font-size: 12.5px; color: var(--fg); font-weight: 500; }
.ov-progress-meta { font-size: 11px; color: var(--fg-4); letter-spacing: 0.04em; }
.ov-progress-stats { display: flex; gap: 24px; flex-wrap: wrap; }
.ov-stat-eyebrow {
    font-size: 10px;
    color: var(--fg-4);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 2px;
}

/* Two-column grids */
.ov-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
}
.ov-grid-7-5 {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 14px;
}
@media (max-width: 1100px) {
    .ov-grid-2,
    .ov-grid-7-5 { grid-template-columns: 1fr; }
}

/* List rows (envelopes / plans) */
.ov-list-col { display: flex; flex-direction: column; gap: 14px; }
.ov-list-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-decoration: none;
    color: inherit;
    padding: 4px;
    margin: -4px;
    border-radius: 8px;
    transition: background 140ms ease;
}
.ov-list-row:hover { background: var(--bg-elev-2); }
.ov-list-row-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.ov-list-row-name {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--fg);
    min-width: 0;
}
.ov-list-row-amt {
    font-size: 11.5px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

/* Avatars */
.ov-avatar {
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

/* Chips */
.ov-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    background: var(--bg-elev-2);
    border: 1px solid var(--line);
    color: var(--fg-2);
    text-transform: capitalize;
}
.ov-chip-drift {
    height: 18px;
    font-size: 10px;
    color: var(--expense);
    border-color: color-mix(in oklab, var(--expense) 30%, transparent);
    background: transparent;
}
/* ===== Section eyebrows (POSITION / COMPOSITION / FLOW / etc.) ===== */
.ov-section-eyebrow {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 8px 4px 4px;
}
.ov-section-eyebrow-sub {
    font-size: 11px;
    color: var(--fg-4);
    letter-spacing: 0.04em;
}

/* ===== Today band ===== */
.orbit-design .od-card.ov-today-band {
    padding: 16px 22px;
    display: flex;
    align-items: center;
    gap: 0;
    overflow-x: auto;
    background: linear-gradient(
        90deg,
        color-mix(in oklab, var(--brand) 6%, var(--bg-elev-1)) 0%,
        var(--bg-elev-1) 80%
    );
    border-color: color-mix(in oklab, var(--brand) 18%, var(--line));
}
.ov-today-cell {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 22px;
    position: relative;
    flex: 1;
    min-width: 120px;
}
.ov-today-cell:first-child { padding-left: 0; }
.ov-today-cell:last-child { padding-right: 0; }
.ov-today-divider {
    position: absolute;
    right: 0;
    top: 4px;
    bottom: 4px;
    width: 1px;
    background: var(--line-soft);
}
.ov-today-label {
    font-size: 10px;
    color: var(--fg-4);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
    flex-shrink: 0;
}
.ov-today-value {
    font-size: 13px;
    color: var(--fg);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ===== Net worth composition ===== */
.ov-nwc { padding: 22px; }
.ov-nwc-body {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 24px;
    align-items: start;
}
@media (max-width: 900px) {
    .ov-nwc-body { grid-template-columns: 1fr; }
}
.ov-nwc-numbers { display: flex; flex-direction: column; gap: 4px; }
.ov-nwc-net { font-size: 32px; font-weight: 500; line-height: 1; color: var(--fg); margin: 4px 0 2px; }
.ov-nwc-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--line-soft);
}
.ov-nwc-bars { display: flex; flex-direction: column; gap: 12px; }
.ov-nwc-trendwrap { padding-bottom: 8px; }
.ov-nwc-split { display: flex; flex-direction: column; gap: 6px; }
.ov-nwc-split-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.ov-nwc-split-bar {
    display: flex;
    height: 10px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--bg-elev-3);
}
.ov-nwc-split-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-size: 11px;
}
.ov-nwc-split-legend-cell {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

/* ===== Daily spend heatmap ===== */
.ov-heatmap-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 8px;
}
.ov-heatmap-weekday {
    font-size: 10.5px;
    color: var(--fg-4);
    text-align: center;
    padding: 4px 0;
    letter-spacing: 0.06em;
}
.ov-heatmap-cell {
    aspect-ratio: 1.2;
    min-height: 56px;
    border-radius: 10px;
    border: 1px solid var(--line-soft);
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    transition: border-color 140ms ease;
    color: var(--fg-2);
}
.ov-heatmap-cell.is-today {
    border-color: var(--brand);
    box-shadow: 0 0 0 1px var(--brand-soft) inset;
}
.ov-heatmap-cell.is-future {
    color: var(--fg-4);
    opacity: 0.55;
}
.ov-heatmap-cell.is-empty {
    border: 1px dashed var(--line-soft);
    background: transparent !important;
}
.ov-heatmap-dnum {
    font-size: 10.5px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
}
.ov-heatmap-damt {
    font-size: 10px;
    color: var(--fg-4);
    text-align: right;
    font-variant-numeric: tabular-nums;
}
.ov-heatmap-foot {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--line-soft);
    display: flex;
    gap: 32px;
    flex-wrap: wrap;
}

/* ===== Top movers ===== */
.ov-mover-row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 12px;
}
.ov-mover-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
}
.ov-mover-bar {
    height: 4px;
    border-radius: 999px;
    background: var(--bg-elev-3);
    overflow: hidden;
    margin-top: 4px;
}
.ov-mover-bar > span {
    display: block;
    height: 100%;
    border-radius: 999px;
}
.ov-mover-amt {
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
}
.ov-mover-delta {
    text-align: right;
    min-width: 60px;
    white-space: nowrap;
}

/* ===== Spending trends ===== */
.ov-trends-body {
    display: grid;
    grid-template-columns: 1fr 220px;
    gap: 18px;
    align-items: stretch;
}
@media (max-width: 1100px) {
    .ov-trends-body { grid-template-columns: 1fr; }
}
.ov-trends-chart {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.ov-trends-legend {
    display: flex;
    gap: 18px;
    font-size: 11px;
    color: var(--fg-3);
    flex-wrap: wrap;
}
.ov-trends-stats {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.orbit-design .od-card.ov-trends-stat {
    padding: 14px 16px;
    background: var(--bg-elev-2);
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.ov-trends-stat-amt {
    font-size: 26px;
    font-weight: 500;
    line-height: 1;
    color: var(--fg);
}
.ov-trends-stat-sub { font-size: 11px; color: var(--fg-4); }

/* ===== Accounts at a glance ===== */
.ov-glance-row {
    display: grid;
    grid-template-columns: auto 1fr auto auto auto;
    align-items: center;
    gap: 14px;
}
.ov-glance-text { min-width: 0; }
.ov-glance-name {
    font-size: 13px;
    color: var(--fg);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ov-glance-id {
    font-size: 11px;
    color: var(--fg-4);
    font-variant-numeric: tabular-nums;
}
.ov-glance-spark { width: 80px; height: 22px; }

/* ============================================================
   MOBILE — phone (<640px) tightening for the Overview page
   ============================================================
   The desktop layout uses many fixed grid columns (4-up tiles,
   auto+1fr+auto+auto rows for transaction/bill/mover lists, a
   280-px sidebar in the net-worth band, etc.). On phones these
   either crowd or overflow. The block below scales everything
   down to a single-column, generous-touch-target layout while
   leaving the desktop styles untouched.
   ============================================================ */
@media (max-width: 640px) {
    .ov-topbar { padding: 14px 14px 10px; gap: 10px; }
    .ov-title { font-size: 22px; }
    .ov-scroll { padding: 12px 14px 24px; gap: 14px; }
    .ov-section { padding: 16px; }
    .ov-section-eyebrow { margin: 6px 2px 2px; }

    /* Stat tiles: 1-up on the smallest screens. */
    .ov-stat-row { grid-template-columns: 1fr; gap: 10px; }
    .ov-stat-tile { padding: 14px 16px; }

    /* Today band — let cells stack instead of horizontally scrolling. */
    .orbit-design .od-card.ov-today-band {
        flex-wrap: wrap;
        padding: 14px 16px;
        overflow-x: visible;
    }
    .ov-today-cell {
        flex: 1 1 45%;
        padding: 6px 10px;
        min-width: 0;
    }
    .ov-today-divider { display: none; }

    /* Heatmap shrinks dramatically on phone. */
    .ov-heatmap-grid { gap: 4px; }
    .ov-heatmap-cell { min-height: 40px; padding: 4px; aspect-ratio: 1; }
    .ov-heatmap-dnum { font-size: 9.5px; }
    .ov-heatmap-damt { font-size: 9px; }
    .ov-heatmap-foot { gap: 16px; padding-top: 10px; margin-top: 10px; }

    /* Trend KPI row: stack instead of inline. */
    .ov-trend-kpis {
        grid-template-columns: 1fr 1fr;
        gap: 12px;
    }

    /* Movers / glance: drop the bar/spark/meta auto column to keep
       names readable. */
    .ov-mover-row,
    .ov-glance-row { grid-template-columns: auto 1fr auto; gap: 10px; }
    .ov-glance-spark { display: none; }
    .ov-mover-delta { display: none; }

    /* Net worth composition */
    .ov-nwc { padding: 16px; }
    .ov-nwc-net { font-size: 26px; }
    .ov-nwc-pair { grid-template-columns: 1fr; gap: 10px; }

    /* Trends panel */
    .ov-trends-stat-amt { font-size: 22px; }

    /* Progress strip — unwrap the meta line so labels don't overlap. */
    .ov-progress-strip { padding: 14px 16px; gap: 14px; }
    .ov-progress-bar { min-width: 0; }
    .ov-progress-stats { gap: 14px; }

    /* Two-up grids drop to one column. */
    .ov-grid-2,
    .ov-grid-7-5 { grid-template-columns: 1fr; gap: 12px; }

    /* Section heading: titles can wrap, links shrink. */
    .ov-sect-head { gap: 8px; }
    .ov-sect-title { font-size: 14.5px; }
}

/* Very narrow phones (<= 380px) need even tighter padding. */
@media (max-width: 380px) {
    .ov-topbar { padding: 12px 12px 8px; }
    .ov-scroll { padding: 10px 12px 20px; }
    .ov-section { padding: 14px; }
    .ov-title { font-size: 20px; }
    .ov-stat-tile { padding: 12px 14px; }
    .ov-trend-kpis { grid-template-columns: 1fr; gap: 8px; }
    .ov-heatmap-grid { gap: 3px; }
    .ov-heatmap-cell { min-height: 34px; padding: 3px; }
    .ov-today-cell { flex-basis: 100%; }
}
`;
