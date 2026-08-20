import { CalendarClock, Pin } from "lucide-react";
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
/**
 * Two vocabularies, one control.
 *
 * `pin` — the server-side Account / Envelope / Event *defaults*: stored in
 * Postgres, two of the three team-wide, meant to outlive the session.
 *
 * `keep` — the browser-local *kept date*: a mode ("which day am I entering
 * for?") that expires with the sitting. It shares this button's geometry,
 * states and focus ring because consistency of form is worth having, but it
 * must not share the word "Pinned": that would teach the user one label
 * spanning everything from "forever, shared with my partner" to "until I stop
 * for the evening, on this device only".
 */
const VARIANTS = {
    pin: { Icon: Pin, on: "Pinned", off: "Pin" },
    keep: { Icon: CalendarClock, on: "Keeping", off: "Keep" },
} as const;

export function PinControl({
    state,
    onClick,
    disabled,
    title,
    detail,
    variant = "pin",
    tone = "brand",
}: {
    state: "pinned" | "pinnable" | "hidden";
    onClick: () => void;
    disabled?: boolean;
    title?: string;
    /**
     * Extra clause appended after the visible label in the announced name,
     * e.g. "Aug 20 for new entries". WCAG 2.5.3 requires the accessible name
     * to START with the visible text so speech-input users can say what they
     * see — hence a suffix rather than a free-form override.
     */
    detail?: string;
    variant?: keyof typeof VARIANTS;
    /**
     * Colour of the *pinned* fill. `warn` for a kept date that isn't today —
     * a solid emerald pill reads as "confirmed, all good" directly beside the
     * amber banner and amber trigger edge warning about that same fact.
     * Keeping *today* is benign, so it stays brand.
     */
    tone?: "brand" | "warn";
}) {
    if (state === "hidden") return null;
    const { Icon, on, off } = VARIANTS[variant];
    const isPinned = state === "pinned";
    const visibleLabel = isPinned ? on : off;
    const accessibleName = disabled
        ? `${visibleLabel} — only owner or editor can change this`
        : detail
          ? `${visibleLabel} — ${detail}`
          : isPinned
            ? `${visibleLabel} — unpin this default`
            : `${visibleLabel} — pin this as your default`;
    return (
        <button
            type="button"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (disabled) return;
                onClick();
            }}
            className={cn(
                "nt-pin-btn",
                isPinned && "is-pinned",
                isPinned && tone === "warn" && "is-warn",
                disabled && "is-disabled"
            )}
            aria-pressed={isPinned}
            aria-label={accessibleName}
            /* aria-label is the canonical announcement; title is kept
               only as a desktop hover tooltip, since title is unreliable
               on touch devices and many screen readers ignore it. */
            title={title ?? accessibleName}
        >
            <Icon
                className="size-3"
                style={isPinned && variant === "pin" ? { fill: "currentColor" } : undefined}
            />
            <span className="nt-pin-label">{visibleLabel}</span>
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
/* Warn tone for a kept PAST date. Solid, matching the brand pinned pill's
   weight — an 18% tint cleared AA on text (6.77:1) but measured 1.39:1 as a
   fill against the drawer body, so the higher-stakes state ended up the
   quieter one: benign "Keeping today" a bright solid pill, and the state that
   can silently mis-date a transaction a near-invisible outline. --bg on
   --warn is 9.69:1. */
.nt-pin-btn.is-pinned.is-warn {
    background: var(--warn);
    border-color: var(--warn);
    color: var(--bg);
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
