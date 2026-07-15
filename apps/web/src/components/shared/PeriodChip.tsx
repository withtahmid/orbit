import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { usePeriod } from "@/hooks/usePeriod";
import { formatInAppTz } from "@/lib/formatDate";
import { PERIOD_LABELS, type PeriodPresetId } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Modern period selector chip — the same dropdown the Transactions page
 * uses in its topbar and filter row. Wraps `<DateRangePicker>` (presets
 * sidebar + dual-month calendars + From/To inputs) in a popover and a
 * compact orbit-design pill trigger.
 *
 * Drives the URL-backed `usePeriod` hook directly, so any view that
 * already consumes `usePeriod` will pick up the new range automatically
 * — no prop wiring needed at the call site.
 */
export function PeriodChip({
    defaultPreset,
    icon,
    className,
}: {
    /** Initial preset when no `?period=` query param is set. */
    defaultPreset?: PeriodPresetId;
    /** Override the trigger icon (defaults to a calendar). */
    icon?: ReactNode;
    className?: string;
}) {
    const { period, preset, setCustom } = usePeriod(defaultPreset);
    const [open, setOpen] = useState(false);

    /**
     * Trigger label. Named presets get their canonical name; "custom"
     * (user-picked range) renders the dates compactly so the chip stays
     * a one-line summary even on tight layouts.
     */
    const label = useMemo(() => {
        if (preset !== "custom") return PERIOD_LABELS[preset];
        // Render the inclusive end (period.end is exclusive in usePeriod).
        const inclusiveEnd = new Date(period.end.getTime() - 1);
        return `${formatInAppTz(period.start, "MMM d")} → ${formatInAppTz(
            inclusiveEnd,
            "MMM d"
        )}`;
    }, [preset, period.start, period.end]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        // Orbit-design chip — thin-border pill, hairline
                        // hover lift, matches the Transactions page chips.
                        "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] text-foreground/85 transition-colors hover:border-foreground/30 hover:text-foreground",
                        className
                    )}
                >
                    {icon ?? (
                        <CalendarIcon className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="truncate">{label}</span>
                    <ChevronDown className="size-3 text-muted-foreground/70" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="orbit-design border-0 bg-transparent p-0 shadow-none"
                style={{ width: "min(640px, calc(100vw - 32px))" }}
            >
                <DateRangePicker
                    start={period.start}
                    end={period.end}
                    // Commits to the URL on edits that are already
                    // complete on their own (typing a From/To value). The
                    // first click of a fresh calendar range deliberately
                    // does NOT call this — see DateRangePicker's onPickDay
                    // — since a lone first click is a half-finished
                    // selection, not something that should overwrite the
                    // active filter if the user walks away.
                    onChange={(s, e) => setCustom(s, e)}
                    // Fires automatically once a selection reads as done
                    // (preset click, second day of a range) — closes the
                    // popover so there's no separate Apply step to miss.
                    onApply={(s, e) => {
                        setCustom(s, e);
                        setOpen(false);
                    }}
                    onCancel={() => setOpen(false)}
                />
            </PopoverContent>
        </Popover>
    );
}
