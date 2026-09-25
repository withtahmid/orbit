import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ENTITY_COLORS } from "@/lib/entityStyle";

/* ENTITY_COLORS is a flat list of ~40 hexes. Group them visually so the
   picker reads like the design's BRAND & SEMANTIC / GREENS & BLUES /
   PURPLES / WARMS & EARTH categories. We slice the existing array (which
   is already roughly hue-ordered) into named buckets so we don't have to
   migrate any data — every swatch is still a member of ENTITY_COLORS. */
const COLOR_GROUPS: Array<{ label: string; range: [number, number] }> = [
    /* "Brand & semantic" — pull a curated 6 from the top of the spectrum
       so it reads like the design's first row (jade / sky / coral / amber /
       gold / brand). The remaining hues fill out the spectrum groups. */
    { label: "Brand & semantic", range: [0, 6] },
    { label: "Reds & pinks", range: [6, 14] },
    { label: "Purples", range: [14, 21] },
    { label: "Blues & cyans", range: [21, 30] },
    { label: "Greens", range: [30, 36] },
    { label: "Warms & earth", range: [36, ENTITY_COLORS.length] },
];

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function ColorPicker({
    value,
    onChange,
    className,
}: {
    value: string;
    onChange: (c: string) => void;
    className?: string;
}) {
    const [custom, setCustom] = useState("");

    const applyCustom = () => {
        const trimmed = custom.trim();
        if (!HEX_RE.test(trimmed)) return;
        onChange(trimmed.startsWith("#") ? trimmed : `#${trimmed}`);
        setCustom("");
    };

    return (
        <div
            className={cn("orbit-design op-picker", className)}
            role="radiogroup"
            aria-label="Color"
        >
            <style>{COLOR_PICKER_STYLES}</style>
            <div className="op-picker-head">
                <span className="op-picker-swatch" style={{ background: value }} aria-hidden />
                <span className="op-picker-name">Color</span>
                <span className="op-picker-hex" aria-hidden>
                    {value.toLowerCase()}
                </span>
            </div>
            <div className="op-picker-body">
                {COLOR_GROUPS.map((g) => {
                    const slice = ENTITY_COLORS.slice(g.range[0], g.range[1]);
                    if (slice.length === 0) return null;
                    return (
                        <div key={g.label} className="op-color-group">
                            <span className="op-color-group-label">{g.label}</span>
                            <div className="op-color-grid">
                                {slice.map((c) => {
                                    const active = value?.toLowerCase() === c.toLowerCase();
                                    return (
                                        <button
                                            key={c}
                                            type="button"
                                            role="radio"
                                            aria-checked={active}
                                            aria-label={c}
                                            title={c}
                                            onClick={() => onChange(c)}
                                            className={cn("op-color-swatch", active && "is-active")}
                                            style={{
                                                background: c,
                                                boxShadow: active
                                                    ? `0 0 0 2px var(--bg-elev-1), 0 0 0 4px ${c}`
                                                    : undefined,
                                            }}
                                        >
                                            {active && (
                                                <Check
                                                    className="size-3.5"
                                                    style={{ color: "white" }}
                                                />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="op-picker-divider" />
            <div className="op-color-custom">
                <span className="op-color-custom-label">Custom · hex</span>
                <div className="op-color-custom-row">
                    <span className="op-color-prefix">#</span>
                    <input
                        type="text"
                        value={custom}
                        placeholder="3b82f6"
                        onChange={(e) =>
                            setCustom(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 8))
                        }
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                applyCustom();
                            }
                        }}
                        className="op-color-custom-input mono"
                        spellCheck={false}
                        aria-label="Custom hex"
                    />
                    <button
                        type="button"
                        onClick={applyCustom}
                        disabled={!HEX_RE.test(custom.trim())}
                        className="op-color-custom-apply"
                    >
                        Apply
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Compact popover-trigger that renders a small swatch + chevron button.
 * Opens the editorial-dark ColorPicker in a popover. Use this in dialogs
 * where the inline picker would dominate the form. `portal={false}` keeps
 * the popover inside the dialog's focus trap and scroll lock.
 */
export function ColorPickerButton({
    value,
    onChange,
    className,
}: {
    value: string;
    onChange: (c: string) => void;
    className?: string;
}) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn("op-picker-trigger", className)}
                    aria-label="Choose color"
                    title="Color"
                >
                    <style>{PICKER_TRIGGER_STYLES}</style>
                    <span
                        className="op-picker-trigger-swatch"
                        style={{ backgroundColor: value }}
                        aria-hidden
                    />
                    <span className="op-picker-trigger-hex">{value.toLowerCase()}</span>
                    <ChevronDown className="size-3 op-picker-trigger-chev" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                portal={false}
                collisionPadding={8}
                aria-label="Color picker"
                align="start"
                className="orbit-design w-[min(20rem,calc(100vw-1.5rem))] p-0 bg-transparent border-0 shadow-none"
            >
                <ColorPicker value={value} onChange={onChange} />
            </PopoverContent>
        </Popover>
    );
}

/** Shared by ColorPickerButton and IconPickerButton — each injects it so either can stand alone. */
export const PICKER_TRIGGER_STYLES = `
.op-picker-trigger {
    height: 38px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: 10px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg);
    cursor: pointer;
    font-family: inherit;
    font-size: 12.5px;
    transition: background 120ms ease, border-color 120ms ease;
}
.op-picker-trigger:hover {
    background: var(--bg-elev-2);
    border-color: var(--line-strong);
}
.op-picker-trigger-swatch {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 1px solid var(--line);
    flex-shrink: 0;
}
.op-picker-trigger-hex {
    font-family: "Geist Mono", ui-monospace, monospace;
    color: var(--fg-2);
    text-transform: lowercase;
    font-size: 11.5px;
}
.op-picker-trigger-icon {
    color: var(--fg-2);
}
.op-picker-trigger-chev {
    color: var(--fg-4);
    margin-left: auto;
}
`;

const COLOR_PICKER_STYLES = `
.op-picker {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    border-radius: 12px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg);
    font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
}
.op-picker-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 2px;
}
.op-picker-swatch {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    border: 1px solid var(--line);
    flex-shrink: 0;
}
.op-picker-name {
    font-size: 12px;
    color: var(--fg-2);
    font-weight: 500;
    flex: 1;
}
.op-picker-hex {
    font-size: 11px;
    color: var(--fg-4);
    font-family: "Geist Mono", ui-monospace, monospace;
    text-transform: lowercase;
}
.op-picker-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 280px;
    overflow-y: auto;
}
.op-color-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.op-color-group-label {
    font-size: 10px;
    color: var(--fg-4);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
    padding: 0 2px;
}
.op-color-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
}
.op-color-swatch {
    aspect-ratio: 1;
    border-radius: 8px;
    border: 1px solid color-mix(in oklab, white 8%, transparent);
    padding: 0;
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: transform 140ms ease;
}
.op-color-swatch:hover { transform: scale(1.06); }
.op-color-swatch.is-active { transform: scale(1.06); }

.op-picker-divider {
    height: 1px;
    background: var(--line-soft);
    margin: 0;
}
.op-color-custom {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.op-color-custom-label {
    font-size: 10px;
    color: var(--fg-4);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
    padding: 0 2px;
}
.op-color-custom-row {
    display: flex;
    align-items: center;
    height: 36px;
    border-radius: 10px;
    background: var(--bg-elev-2);
    border: 1px solid var(--line);
    overflow: hidden;
}
.op-color-prefix {
    padding: 0 10px;
    color: var(--fg-4);
    font-family: "Geist Mono", ui-monospace, monospace;
    font-size: 12px;
}
.op-color-custom-input {
    flex: 1;
    height: 100%;
    background: transparent;
    border: 0;
    outline: none;
    color: var(--fg);
    font-size: 16px; /* below 16px iOS Safari zooms the page on focus */
    font-family: "Geist Mono", ui-monospace, monospace;
    padding: 0 4px;
    text-transform: lowercase;
    min-width: 0;
}
@media (pointer: fine) {
    .op-color-custom-input { font-size: 12px; }
}
.op-color-custom-apply {
    height: calc(100% - 6px);
    margin-right: 3px;
    padding: 0 12px;
    border-radius: 8px;
    border: 0;
    background: var(--brand);
    color: var(--brand-fg);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: filter 140ms ease;
}
.op-color-custom-apply:hover:not(:disabled) {
    filter: brightness(1.05);
}
.op-color-custom-apply:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
`;
