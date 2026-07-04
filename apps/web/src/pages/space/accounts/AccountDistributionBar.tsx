import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";

export interface AccountSlice {
    id: string;
    name: string;
    value: number;
    /** Hex color (or CSS var) for the segment. */
    color: string;
}

interface Props {
    data: AccountSlice[];
    /** Eyebrow above the bar. */
    label?: string;
    /** Called when the user taps a segment or a chip (navigates to the account). */
    onSelect?: (slice: AccountSlice) => void;
    emptyLabel?: string;
}

/**
 * Horizontal stacked distribution bar — each positive-balance account is a
 * colored segment sized by its share of holdings, with name + percent chips
 * underneath. Same visual family as the Budgets summary's allocation bar,
 * but interactive: hovering a segment/chip swaps the readout line to that
 * account's name / value / percent; a tap navigates. Chips carry percent
 * only — exact balances live on the account cards, and repeating them here
 * was the reason the old legend got cut.
 * Styles live in the parent page's AC_STYLES (`.ac-dist-*`) since this
 * component is accounts-page-only.
 */
export function AccountDistributionBar({
    data,
    label = "Where it sits",
    onSelect,
    emptyLabel = "No positive balances yet",
}: Props) {
    const normalized = useMemo(
        () => data.filter((d) => Number.isFinite(d.value) && d.value > 0),
        [data]
    );
    const total = useMemo(
        () => normalized.reduce((acc, d) => acc + d.value, 0),
        [normalized]
    );

    const [activeId, setActiveId] = useState<string | null>(null);
    const active = normalized.find((d) => d.id === activeId) ?? null;

    // Text summary for screen readers — the bar itself is presentational.
    const summaryLabel = useMemo(() => {
        const parts = normalized
            .map((d) => `${d.name} ${formatMoney(d.value)}`)
            .join(", ");
        return `Holdings ${formatMoney(total)}${parts ? `. Breakdown: ${parts}` : ""}`;
    }, [normalized, total]);

    const pctFmt = (v: number) => {
        const p = total > 0 ? (v / total) * 100 : 0;
        return p < 1 ? "<1%" : `${p.toFixed(0)}%`;
    };

    // Data arrives sorted desc with any "Other" rollup appended last, so the
    // first entry is always the single largest real holding — surfaced in the
    // idle readout since it's the one distribution insight worth stating.
    const largest = normalized[0] ?? null;

    if (normalized.length === 0) {
        return (
            <div className="ac-dist">
                <div className="ac-dist-head">
                    <span className="eyebrow">{label}</span>
                </div>
                <p className="ac-dist-empty">{emptyLabel}</p>
            </div>
        );
    }

    return (
        <div className="ac-dist" onMouseLeave={() => setActiveId(null)}>
            <div className="ac-dist-head">
                <span className="eyebrow">{label}</span>
                <span className="tabular ac-dist-readout">
                    {active ? (
                        <>
                            <span style={{ color: "var(--fg)" }}>
                                {active.name}
                            </span>
                            {" · "}
                            {formatMoney(active.value)}
                            {" · "}
                            {pctFmt(active.value)}
                        </>
                    ) : largest ? (
                        <>
                            <span style={{ color: "var(--fg)" }}>
                                {largest.name}
                            </span>{" "}
                            leads · {pctFmt(largest.value)} of{" "}
                            {formatMoney(total)} holdings
                        </>
                    ) : (
                        <>{formatMoney(total)}</>
                    )}
                </span>
            </div>

            <div className="ac-dist-track" role="img" aria-label={summaryLabel}>
                {normalized.map((s) => (
                    <span
                        key={s.id}
                        className="ac-dist-seg"
                        style={{
                            flexGrow: s.value,
                            background: s.color,
                            opacity: activeId && activeId !== s.id ? 0.4 : 1,
                            cursor: onSelect ? "pointer" : "default",
                        }}
                        // Hover inspects on desktop (readout swap); a tap
                        // navigates — same single-tap behavior as this
                        // segment's chip below, so the two representations
                        // of one account never disagree. Touch users read
                        // per-account name/% from the always-visible chips.
                        onMouseEnter={() => setActiveId(s.id)}
                        onClick={() => onSelect?.(s)}
                    />
                ))}
            </div>

            <div className="ac-dist-chips">
                {normalized.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        className="ac-dist-chip"
                        data-active={activeId === s.id || undefined}
                        onMouseEnter={() => setActiveId(s.id)}
                        onFocus={() => setActiveId(s.id)}
                        // Clear the dim/readout swap when keyboard focus
                        // leaves — a keyboard user never fires mouseleave.
                        onBlur={() => setActiveId(null)}
                        onClick={() => onSelect?.(s)}
                    >
                        <span
                            className="ac-dist-dot"
                            style={{ background: s.color }}
                            aria-hidden
                        />
                        <span className="ac-dist-chip-name">{s.name}</span>
                        <span className="tabular ac-dist-chip-pct">
                            {pctFmt(s.value)}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}
