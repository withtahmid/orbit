import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MoneyDisplay } from "@/components/shared/MoneyDisplay";
import { Skeleton } from "@/components/ui/skeleton";

export type KpiTone = "neutral" | "income" | "expense" | "muted";

export interface KpiItem {
    label: string;
    /** When provided as a number, rendered with `MoneyDisplay`; otherwise rendered as-is. */
    value: number | React.ReactNode;
    /** Mark `value` as money so it gets the income/expense color treatment. */
    money?: boolean;
    /** Color treatment for the value — overrides money inference. */
    tone?: KpiTone;
    /** Subtle line under the value. */
    sub?: React.ReactNode;
    /** Tiny indicator chip drawn next to the value. */
    delta?: { label: string; direction: "up" | "down" | "flat" };
    /** Override formatter when value is a number. */
    valueFormat?: "money" | "integer" | "percent";
}

/**
 * Editorial KPI bar — a single rounded card with N evenly-divided cells. Used at
 * the top of every analytics detail view as the headline strip.
 */
export function KpiStrip({
    items,
    isLoading,
    className,
}: {
    items: KpiItem[];
    isLoading?: boolean;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "kpi-strip grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-[var(--kpi-cols-sm)] lg:grid-cols-[var(--kpi-cols-lg)]",
                className
            )}
            style={
                {
                    // 2-up at sm if we have 2+ items, otherwise 1.
                    "--kpi-cols-sm": items.length >= 2 ? "repeat(2, minmax(0, 1fr))" : "1fr",
                    // At lg: one row for up to 6 items. Wrapping 5 items onto a
                    // second row left a single lonely tile at quarter width,
                    // and the strip's height then changed whenever an
                    // optional KPI appeared — shifting everything below it.
                    "--kpi-cols-lg":
                        items.length <= 6
                            ? `repeat(${items.length}, minmax(0, 1fr))`
                            : "repeat(4, minmax(0, 1fr))",
                } as React.CSSProperties
            }
        >
            {items.map((it, i) => (
                <div
                    key={i}
                    className={cn(
                        "flex flex-col gap-1 bg-card p-4 sm:p-5",
                        // An odd item count leaves a hole in the last 2-up row
                        // at sm; let the final tile span it instead.
                        items.length % 2 === 1 &&
                            i === items.length - 1 &&
                            "sm:col-span-2 lg:col-span-1"
                    )}
                >
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {it.label}
                    </span>
                    <div className="flex items-baseline gap-2">
                        {isLoading ? (
                            /* Matches `KpiValue`'s line box exactly (28px at
                               base, 32px from sm where it goes text-2xl) so
                               swapping in the real number doesn't nudge
                               everything below the strip. */
                            <Skeleton className="h-7 w-24 sm:h-8" />
                        ) : (
                            <KpiValue item={it} />
                        )}
                        {!isLoading && it.delta && (
                            <span
                                className={cn(
                                    "inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
                                    it.delta.direction === "up" && "text-[color:var(--income)]",
                                    it.delta.direction === "down" && "text-[color:var(--expense)]",
                                    it.delta.direction === "flat" && "text-muted-foreground"
                                )}
                            >
                                {it.delta.direction === "up" && <ArrowUpRight className="size-3" />}
                                {it.delta.direction === "down" && (
                                    <ArrowDownRight className="size-3" />
                                )}
                                {it.delta.label}
                            </span>
                        )}
                    </div>
                    {/* One line, always. A sub that wrapped at some widths and
                        not others changed the strip's height whenever the copy
                        changed, shifting every card below it. */}
                    {it.sub && (
                        <span
                            className="truncate text-[11px] text-muted-foreground"
                            title={typeof it.sub === "string" ? it.sub : undefined}
                        >
                            {it.sub}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}

function KpiValue({ item }: { item: KpiItem }) {
    const cls = "text-xl font-bold tabular-nums sm:text-2xl";

    if (typeof item.value === "number") {
        const fmt = item.valueFormat ?? (item.money ? "money" : "money");
        if (fmt === "money") {
            const variant: "income" | "expense" | "neutral" | "muted" =
                item.tone === "income"
                    ? "income"
                    : item.tone === "expense"
                      ? "expense"
                      : item.tone === "muted"
                        ? "muted"
                        : "neutral";
            return (
                <MoneyDisplay
                    amount={item.value}
                    variant={variant}
                    signed={false}
                    className={cls}
                />
            );
        }
        if (fmt === "integer") {
            return (
                <span className={cn(cls, item.tone === "muted" && "text-muted-foreground")}>
                    {Math.round(item.value).toLocaleString("en-US")}
                </span>
            );
        }
        // percent
        return (
            <span
                className={cn(
                    cls,
                    item.tone === "income" && "text-[color:var(--income)]",
                    item.tone === "expense" && "text-[color:var(--expense)]",
                    // Was silently dropped here, so a "no data to compare"
                    // percentage rendered at full strength like a real one.
                    item.tone === "muted" && "text-muted-foreground"
                )}
            >
                {item.value.toFixed(1)}
                <span className="ml-0.5 text-base font-medium text-muted-foreground">%</span>
            </span>
        );
    }
    /* Non-numeric values (an em-dash for "nothing to compare against")
       still honor `tone` so they read as absent rather than as data. */
    return (
        <span className={cn(cls, item.tone === "muted" && "text-muted-foreground")}>
            {item.value}
        </span>
    );
}
