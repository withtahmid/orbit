import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/shared/MoneyDisplay";
import { PeriodChip } from "@/components/shared/PeriodChip";
import { KpiStrip, type KpiItem } from "@/components/shared/KpiStrip";
import { DrillableDonut } from "@/components/shared/charts/DrillableDonut";
import { AnalyticsDetailLayout } from "./_AnalyticsLayout";
import { trpc } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { usePeriod } from "@/hooks/usePeriod";
import { cn } from "@/lib/utils";

type Tier = "essential" | "important" | "discretionary" | "luxury" | "unclassified";

/**
 * Sub-label appended to each tier in the breakdown list. Static because
 * the priority-tier definitions are part of the product copy, not data.
 */
const TIER_DESCRIPTION: Record<Tier, string> = {
    essential: "rent · utilities · insurance",
    important: "groceries · transport",
    discretionary: "self-care · subscriptions",
    luxury: "premium imports · splurges",
    unclassified: "transfer principal · pre-categorization",
};


export default function PriorityView() {
    const { space } = useCurrentSpace();
    const { period } = usePeriod("this-month");

    const q = trpc.analytics.priorityBreakdown.useQuery(
        {
            spaceId: space.id,
            periodStart: period.start,
            periodEnd: period.end,
        },
        { enabled: !space.isPersonal }
    );

    const rows = useMemo(() => q.data ?? [], [q.data]);
    const tierByKey = useMemo(() => {
        const m = new Map<Tier, (typeof rows)[number]>();
        for (const r of rows) m.set(r.priority as Tier, r);
        return m;
    }, [rows]);

    const total = useMemo(
        () => rows.reduce((acc, r) => acc + Number(r.total), 0),
        [rows]
    );

    const must =
        Number(tierByKey.get("essential")?.total ?? 0) +
        Number(tierByKey.get("important")?.total ?? 0);
    const want =
        Number(tierByKey.get("discretionary")?.total ?? 0) +
        Number(tierByKey.get("luxury")?.total ?? 0);
    const unclassified = Number(tierByKey.get("unclassified")?.total ?? 0);
    const categorized = must + want;

    const donutData = useMemo(
        () =>
            rows
                .filter((r) => r.total > 0)
                .map((r) => ({
                    id: r.priority,
                    name: r.label,
                    value: Number(r.total),
                    color: r.color,
                    drillable: false,
                })),
        [rows]
    );

    /** Center-of-donut value: the largest visible tier — sets the eye. */
    const donutFocus = useMemo(() => {
        const max = donutData.reduce(
            (best, d) => (d.value > best.value ? d : best),
            donutData[0]
        );
        return max;
    }, [donutData]);

    const kpiItems: KpiItem[] = [
        {
            label: "Must-spend",
            value: must,
            money: true,
            sub:
                total > 0
                    ? `Essential + Important · ${pct(must, total)}% of total`
                    : "Essential + Important",
        },
        {
            label: "Want-spend",
            value: want,
            money: true,
            sub:
                total > 0
                    ? `Discretionary + Luxury · ${pct(want, total)}%`
                    : "Discretionary + Luxury",
        },
        {
            label: "Unclassified",
            value: unclassified,
            money: true,
            tone: unclassified > categorized ? "muted" : "neutral",
            sub:
                total > 0
                    ? `${pct(unclassified, total)}% — uncategorized residue`
                    : "Uncategorized residue",
        },
        {
            label: "Categorized total",
            value: categorized,
            money: true,
            sub:
                total > 0
                    ? `${pct(categorized, total)}% of expenses are tagged`
                    : "—",
        },
    ];

    if (space.isPersonal) {
        return (
            <AnalyticsDetailLayout
                title="Expenses by priority"
                description="Each envelope inherits a priority tier from its categories. This view rolls up to four buckets — must-spend versus want-spend, with the unclassified residue separated."
            >
                <Card>
                    <CardContent className="py-12 text-center text-sm text-muted-foreground">
                        Priority breakdown is a per-space view. Open a real space
                        to see it.
                    </CardContent>
                </Card>
            </AnalyticsDetailLayout>
        );
    }

    return (
        <AnalyticsDetailLayout
            title="Expenses by priority"
            description="Each envelope inherits a priority tier from its categories. This view rolls up to four buckets — must-spend versus want-spend, with the unclassified residue separated."
            actions={<PeriodChip defaultPreset="this-month" />}
        >
            <KpiStrip items={kpiItems} isLoading={q.isLoading} />

            <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                {/* Donut */}
                <Card>
                    <CardHeader>
                        <CardTitle>Where the month went</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        {q.isLoading ? (
                            <Skeleton className="h-[280px] w-full" />
                        ) : donutData.length === 0 ? (
                            <p className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                                No expenses to classify.
                            </p>
                        ) : (
                            <DrillableDonut
                                slices={donutData}
                                centerLabel={
                                    donutFocus
                                        ? donutFocus.name.toUpperCase()
                                        : "Total"
                                }
                                centerValue={
                                    donutFocus
                                        ? donutFocus.value.toLocaleString(
                                              "en-US",
                                              { maximumFractionDigits: 0 }
                                          )
                                        : undefined
                                }
                                size={240}
                            />
                        )}
                        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                            Transfer principal is excluded from breakdowns by
                            default — toggle below to include it.
                        </p>
                    </CardContent>
                </Card>

                {/* Tier breakdown list */}
                <Card className="overflow-hidden p-0">
                    <div className="flex flex-col gap-0.5 px-6 pt-5 pb-3">
                        <CardTitle>Tier breakdown</CardTitle>
                        <p className="text-xs text-muted-foreground">
                            Drilldown shows envelopes contributing to each tier.
                        </p>
                    </div>
                    {q.isLoading ? (
                        <div className="px-6 pb-5">
                            <Skeleton className="h-64 w-full" />
                        </div>
                    ) : rows.length === 0 ? (
                        <p className="px-6 pb-5 text-sm text-muted-foreground">
                            No expense data yet.
                        </p>
                    ) : (
                        <div className="flex flex-col">
                            {rows.map((r, i) => {
                                const v = Number(r.total);
                                const pctOfTotal =
                                    total > 0 ? (v / total) * 100 : 0;
                                return (
                                    <button
                                        type="button"
                                        key={r.priority}
                                        className={cn(
                                            "grid items-center gap-3 px-6 py-3.5 text-left transition-colors hover:bg-accent/30",
                                            "grid-cols-[14px_minmax(0,2fr)_minmax(0,1fr)_88px_56px]",
                                            i > 0 && "border-t border-border/40"
                                        )}
                                    >
                                        <span
                                            className="size-2 rounded-full"
                                            style={{ backgroundColor: r.color }}
                                        />
                                        <span className="flex min-w-0 flex-col gap-0.5">
                                            <span className="text-[13px] font-medium">
                                                {r.label}
                                            </span>
                                            <span className="text-[11px] text-muted-foreground">
                                                {TIER_DESCRIPTION[
                                                    r.priority as Tier
                                                ] ?? ""}
                                            </span>
                                        </span>
                                        <span className="relative block h-1 overflow-hidden rounded-full bg-muted/40">
                                            <span
                                                className="absolute inset-y-0 left-0 rounded-full"
                                                style={{
                                                    width: `${pctOfTotal}%`,
                                                    backgroundColor: r.color,
                                                }}
                                            />
                                        </span>
                                        <MoneyDisplay
                                            amount={v}
                                            variant="neutral"
                                            className="text-right text-[13px] font-semibold"
                                        />
                                        <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                                            {pctOfTotal.toFixed(0)}%
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Envelopes by tier</CardTitle>
                    <p className="text-xs text-muted-foreground">
                        Which envelopes contribute to each priority bucket.
                    </p>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                        {(
                            ["essential", "important", "discretionary", "luxury"] as const
                        ).map((tier) => {
                            const data = tierByKey.get(tier);
                            const color = data?.color ?? "var(--muted-foreground)";
                            const label = data?.label ?? capitalize(tier);
                            return (
                                <div
                                    key={tier}
                                    className="flex flex-col gap-2.5 rounded-lg border border-border/40 bg-muted/20 p-3.5"
                                >
                                    <span className="flex items-center gap-2">
                                        <span
                                            className="size-1.5 rounded-full"
                                            style={{ backgroundColor: color }}
                                        />
                                        <span className="text-[12px] font-semibold">
                                            {label}
                                        </span>
                                    </span>
                                    <div className="flex flex-col gap-1">
                                        {(data?.envelopes ?? []).length === 0 ? (
                                            <span className="text-[11.5px] text-muted-foreground italic">
                                                No envelopes contributing
                                            </span>
                                        ) : (
                                            (data?.envelopes ?? []).map(
                                                (env) => (
                                                    <span
                                                        key={env.id}
                                                        className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
                                                    >
                                                        <span
                                                            className="size-1 rounded-full"
                                                            style={{
                                                                backgroundColor:
                                                                    env.color,
                                                            }}
                                                        />
                                                        <span className="truncate">
                                                            {env.name}
                                                        </span>
                                                    </span>
                                                )
                                            )
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
        </AnalyticsDetailLayout>
    );
}

function pct(part: number, whole: number): number {
    return Math.round((part / whole) * 100);
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
