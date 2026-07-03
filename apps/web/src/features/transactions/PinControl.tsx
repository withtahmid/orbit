import { Pin } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tiny inline action that sits in an OrbitField hint slot. Communicates
 * whether the current value of a field is the user's pinned default —
 * and offers a one-click pin/unpin.
 *
 * Visual states:
 *   - `pinned`     filled glyph + "Pinned" label. Click → unpin.
 *   - `pinnable`   outline glyph + "Pin" label.    Click → pin.
 *   - hidden       returns null (nothing to act on).
 *
 * Pass `disabled` to render an inert grey state (viewer trying to set a
 * space-wide pin). We still render so the affordance is visible — just
 * not actionable.
 */
export function PinControl({
    state,
    onClick,
    disabled,
    title,
}: {
    state: "pinned" | "pinnable" | "hidden";
    onClick: () => void;
    disabled?: boolean;
    title?: string;
}) {
    if (state === "hidden") return null;
    const isPinned = state === "pinned";
    const accessibleName = disabled
        ? "Only owner or editor can pin this"
        : isPinned
          ? "Unpin this default"
          : "Pin this as your default";
    return (
        <button
            type="button"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (disabled) return;
                onClick();
            }}
            className={cn("nt-pin-btn", isPinned && "is-pinned", disabled && "is-disabled")}
            aria-pressed={isPinned}
            aria-label={accessibleName}
            /* aria-label is the canonical announcement; title is kept
               only as a desktop hover tooltip, since title is unreliable
               on touch devices and many screen readers ignore it. */
            title={title ?? accessibleName}
        >
            <Pin className="size-3" style={isPinned ? { fill: "currentColor" } : undefined} />
            <span className="nt-pin-label">{isPinned ? "Pinned" : "Pin"}</span>
        </button>
    );
}

export const PIN_CONTROL_STYLES = `
.nt-pin-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    /* WCAG 2.5.8 AA touch-target minimum is 24×24 CSS pixels. The
       previous 20px height failed; the icon-only collapse at <420px
       also dropped below the minimum width. Both are now safe. */
    height: 24px;
    min-width: 24px;
    padding: 0 8px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--fg-3);
    font-size: 10.5px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    font-family: inherit;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.nt-pin-btn:hover { color: var(--fg); border-color: var(--line-strong); }
.nt-pin-btn:focus-visible {
    outline: none;
    border-color: var(--brand);
    box-shadow: 0 0 0 2px var(--brand-soft);
}
.nt-pin-btn.is-pinned {
    /* Filled brand for AA contrast — the 14% tint with brand text on
       bg-elev-1 was ~3.5:1, below 4.5:1. Filled brand uses the design
       system's official brand-fg pair. */
    background: var(--brand);
    border-color: var(--brand);
    color: var(--brand-fg, var(--bg));
}
.nt-pin-btn.is-pinned:hover {
    filter: brightness(1.05);
}
.nt-pin-btn.is-disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
@media (max-width: 420px) {
    .nt-pin-btn .nt-pin-label { display: none; }
    /* Icon-only collapse — keep the 24×24 square clean, no padding. */
    .nt-pin-btn { padding: 0; width: 24px; }
}
/* Touch devices: grow toward the comfortable tap size (24px is only the
   WCAG floor). Wins over the 420px icon-only rule via source order. */
@media (hover: none) {
    .nt-pin-btn { height: 36px; min-width: 36px; }
}
`;
