import {
    type ReactNode,
    type InputHTMLAttributes,
    type TextareaHTMLAttributes,
    forwardRef,
    useId,
} from "react";
import { ChevronDown, Check, Delete, Info } from "lucide-react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { CALC_KEYS, CALC_KEY_LABELS, useCalcField } from "@/lib/useCalcField";

/* ============================================================
   Editorial-dark form primitives, shared by every modal/drawer.
   Render inside an `.orbit-design` ancestor (OrbitModalShell or
   OrbitDrawerShell) so the oklch tokens resolve correctly.
   ============================================================ */

export type OrbitInputProps = InputHTMLAttributes<HTMLInputElement> & {
    leadIcon?: ReactNode;
    prefix?: ReactNode;
    suffix?: ReactNode;
    mono?: boolean;
};

export const OrbitInput = forwardRef<HTMLInputElement, OrbitInputProps>(function OrbitInput(
    { leadIcon, prefix, suffix, mono, className, ...rest },
    ref
) {
    return (
        <span className={`of-input ${className ?? ""}`}>
            {leadIcon && (
                <span className="of-input-lead" aria-hidden>
                    {leadIcon}
                </span>
            )}
            {prefix && <span className="of-input-affix">{prefix}</span>}
            <input
                ref={ref}
                className={mono ? "of-input-control of-mono" : "of-input-control"}
                {...rest}
            />
            {suffix && <span className="of-input-affix of-input-suffix">{suffix}</span>}
        </span>
    );
});

export type OrbitTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const OrbitTextarea = forwardRef<HTMLTextAreaElement, OrbitTextareaProps>(
    function OrbitTextarea({ className, ...rest }, ref) {
        return <textarea ref={ref} className={`of-textarea ${className ?? ""}`} {...rest} />;
    }
);

/* ----- OrbitSelect — Radix Select wrapped with editorial-dark trigger ----- */

export type OrbitSelectItem = {
    value: string;
    label: ReactNode;
    leadIcon?: ReactNode;
    leadColor?: string;
};

export function OrbitSelect({
    value,
    onValueChange,
    items,
    placeholder,
    leadIcon,
    leadColor,
    disabled,
    children,
}: {
    value: string;
    onValueChange: (v: string) => void;
    items?: OrbitSelectItem[];
    placeholder?: string;
    leadIcon?: ReactNode;
    leadColor?: string;
    disabled?: boolean;
    /** Override the default item rendering (e.g. tree views). */
    children?: ReactNode;
}) {
    const selected = items?.find((x) => x.value === value);
    const visualLeadIcon = selected?.leadIcon ?? leadIcon;
    const visualLeadColor = selected?.leadColor ?? leadColor;
    return (
        <SelectPrimitive.Root
            value={value || undefined}
            onValueChange={onValueChange}
            disabled={disabled}
        >
            <SelectPrimitive.Trigger className="of-select-trigger" disabled={disabled}>
                {visualLeadIcon && (
                    <span
                        className="of-lead-pill of-lead-pill-sm"
                        style={
                            visualLeadColor
                                ? {
                                      background: `color-mix(in oklab, ${visualLeadColor} 18%, transparent)`,
                                      border: `1px solid color-mix(in oklab, ${visualLeadColor} 30%, transparent)`,
                                      color: visualLeadColor,
                                  }
                                : undefined
                        }
                        aria-hidden
                    >
                        {visualLeadIcon}
                    </span>
                )}
                <span className="of-select-value">
                    {selected ? (
                        selected.label
                    ) : (
                        <span className="of-select-placeholder">{placeholder ?? "Select…"}</span>
                    )}
                </span>
                <ChevronDown className="size-3 of-select-chev" aria-hidden />
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Portal>
                <SelectPrimitive.Content
                    className="orbit-design of-select-content"
                    position="popper"
                    sideOffset={4}
                >
                    <SelectPrimitive.Viewport className="of-select-viewport">
                        {items
                            ? items.map((item) => (
                                  <SelectPrimitive.Item
                                      key={item.value}
                                      value={item.value}
                                      className="of-select-item"
                                  >
                                      {item.leadIcon && (
                                          <span
                                              className="of-lead-pill of-lead-pill-sm"
                                              style={
                                                  item.leadColor
                                                      ? {
                                                            background: `color-mix(in oklab, ${item.leadColor} 18%, transparent)`,
                                                            border: `1px solid color-mix(in oklab, ${item.leadColor} 30%, transparent)`,
                                                            color: item.leadColor,
                                                        }
                                                      : undefined
                                              }
                                              aria-hidden
                                          >
                                              {item.leadIcon}
                                          </span>
                                      )}
                                      <SelectPrimitive.ItemText>
                                          {item.label}
                                      </SelectPrimitive.ItemText>
                                      <SelectPrimitive.ItemIndicator className="of-select-check">
                                          <Check className="size-3" />
                                      </SelectPrimitive.ItemIndicator>
                                  </SelectPrimitive.Item>
                              ))
                            : children}
                    </SelectPrimitive.Viewport>
                </SelectPrimitive.Content>
            </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
    );
}

/* ----- Hero amount card ----- */

/**
 * Hero amount input, with an inline calculator built in.
 *
 * The field accepts arithmetic (`1200+340+85`, `3*250`) so the user never has
 * to leave the form to add up a receipt. All of the draft/emit/caret mechanics
 * live in `useCalcField` — this component is the hero presentation of it (see
 * `OrbitCalcInput` for the compact one).
 *
 * `type="text"` (not `number`) is required: a number input rejects operator
 * characters outright. `inputMode="decimal"` keeps the phone keypad numeric,
 * and the operator strip supplies the symbols that keypad lacks.
 */
export function OrbitAmountCard({
    value,
    onChange,
    eyebrow = "Amount",
    suffix = "",
    autoFocus,
    tone = "fg",
    leadIconBefore,
}: {
    value: string;
    onChange: (v: string) => void;
    eyebrow?: ReactNode;
    suffix?: ReactNode;
    autoFocus?: boolean;
    tone?: "fg" | "brand" | "expense" | "income" | "transfer" | "gold";
    /** Optional small icon rendered before the input (e.g. arrow up/down). */
    leadIconBefore?: ReactNode;
}) {
    const toneColor =
        tone === "brand"
            ? "var(--brand)"
            : tone === "expense"
              ? "var(--expense)"
              : tone === "income"
                ? "var(--income)"
                : tone === "transfer"
                  ? "var(--transfer)"
                  : tone === "gold"
                    ? "var(--gold)"
                    : "var(--fg)";

    const resultId = useId();
    const calcField = useCalcField(value, onChange);
    const { message } = calcField;

    return (
        <div className="of-amount-card">
            <span className="of-amount-eyebrow">{eyebrow}</span>
            <div className="of-amount-row">
                {leadIconBefore && (
                    <span className="of-amount-leadicon" aria-hidden>
                        {leadIconBefore}
                    </span>
                )}
                <input
                    ref={calcField.inputRef}
                    className="of-amount-input"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={calcField.draft}
                    onChange={(e) => calcField.commit(e.target.value)}
                    onBlur={calcField.onBlur}
                    onKeyDown={calcField.onKeyDown}
                    autoFocus={autoFocus}
                    /* The eyebrow is a plain span, so without this the field
                       announces as "edit text, blank". */
                    aria-label={typeof eyebrow === "string" ? eyebrow : "Amount"}
                    /* Referenced unconditionally: a describedby that appears
                       and disappears is never re-announced while focus stays
                       put. The live region is deliberately NOT referenced —
                       accname would concatenate it and read the message twice
                       on focus. */
                    aria-describedby={resultId}
                    aria-invalid={message?.tone === "warn" || undefined}
                    style={{ color: toneColor }}
                />
                {suffix ? <span className="of-amount-unit">{suffix}</span> : null}
            </div>

            {/* Always mounted with a reserved height. Conditional mounting
                shifted the key strip ~22px vertically the instant the user
                tapped an operator — i.e. under their finger. */}
            <div
                id={resultId}
                className={`of-amount-result ${message?.tone === "warn" ? "is-warn" : ""}`}
                aria-hidden="true"
            >
                {message?.text ?? ""}
            </div>
            {/* Separate always-present live region: a live region that enters
                the DOM together with its first content is commonly dropped by
                screen readers, and that first announcement is the one that
                matters. Debounced inside the hook. */}
            <span className="of-sr-only" aria-live="polite" aria-atomic="true">
                {calcField.announcement}
            </span>

            <OrbitCalcKeys
                field={calcField}
                label={typeof eyebrow === "string" ? eyebrow : "Amount"}
            />
        </div>
    );
}

/**
 * Compact calculator-enabled money input, for the secondary amount fields.
 * Same arithmetic and same feedback line as the hero card, minus the eyebrow
 * and the 40px type.
 *
 * The rule is *every money field in the transaction sheets takes arithmetic* —
 * a capability that applies to some of them and not others is worse than one
 * that applies to none, because the user can't form a rule. That covers the
 * hero amount, the transfer fee, and the adjustment's reconciled balance.
 *
 * Outside the sheets the gap is real and deliberate, and it is NOT all one
 * reason: the envelope allocate / move / top-up dialogs are shadcn `Input`
 * inside dialogs that never render `OrbitFormStyles`, so this component can't
 * drop in there unstyled; but `BudgetsPage`'s envelope target IS an
 * `OrbitInput` on a page that already renders `OrbitFormStyles`, i.e. a
 * literal drop-in that simply wasn't in scope. Extending to either is a
 * separate change — just don't cite the styling reason for the second one.
 */
export function OrbitCalcInput({
    value,
    onChange,
    label,
    placeholder = "0.00",
    allowNegative,
}: {
    value: string;
    onChange: (v: string) => void;
    /**
     * Required. The host `OrbitField` must pass `noWrapperLabel` (this
     * component owns the input AND the key strip), and that drops the
     * implicit <label> association — without this the field announces as
     * "edit text, blank".
     */
    label: string;
    placeholder?: string;
    allowNegative?: boolean;
}) {
    const resultId = useId();
    const calcField = useCalcField(value, onChange, { allowNegative });
    const { message } = calcField;

    return (
        <div className="of-calc-wrap">
            <span className="of-input">
                <input
                    ref={calcField.inputRef}
                    className="of-input-control"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={placeholder}
                    value={calcField.draft}
                    onChange={(e) => calcField.commit(e.target.value)}
                    onBlur={calcField.onBlur}
                    onKeyDown={calcField.onKeyDown}
                    aria-label={label}
                    aria-describedby={resultId}
                    aria-invalid={message?.tone === "warn" || undefined}
                />
            </span>
            <div
                id={resultId}
                className={`of-amount-result ${message?.tone === "warn" ? "is-warn" : ""}`}
                aria-hidden="true"
            >
                {message?.text ?? ""}
            </div>
            <span className="of-sr-only" aria-live="polite" aria-atomic="true">
                {calcField.announcement}
            </span>
            <OrbitCalcKeys field={calcField} label={label} />
        </div>
    );
}

/**
 * The operator strip. A pointer affordance only — it exists because the
 * iOS/Android decimal keypad has digits and `.` and nothing else. Every key is
 * `tabIndex={-1}`: a keyboard user already has all four symbols on their
 * keyboard and should not tab through them to reach the next field.
 */
export function OrbitCalcKeys({
    field,
    label = "Calculator",
}: {
    field: ReturnType<typeof useCalcField>;
    /** Distinguishes the two strips on the Transfer tab (amount vs fee). */
    label?: string;
}) {
    const { canResolve } = field;
    return (
        <div className="of-amount-keys" role="group" aria-label={`${label} keys`}>
            {CALC_KEYS.map((k) => (
                <button
                    key={k}
                    type="button"
                    tabIndex={-1}
                    className="of-amount-key"
                    /* preventDefault keeps the caret in the input, so
                       inserting at the cursor still targets the right spot
                       after the tap. */
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => field.insert(k)}
                    aria-label={CALC_KEY_LABELS[k]}
                >
                    {k}
                </button>
            ))}
            <button
                type="button"
                tabIndex={-1}
                className="of-amount-key of-amount-key-back"
                onMouseDown={(e) => e.preventDefault()}
                onClick={field.backspace}
                aria-label="Backspace"
            >
                <Delete className="size-3.5" />
            </button>
            {/* Collapses the expression into its result in the field. The
                readout alone told the user what WOULD be saved but left
                `1200+340` sitting there permanently — the field never became
                the number. Dimmed rather than hidden on a plain literal, so
                the strip's geometry never shifts mid-entry. */}
            <button
                type="button"
                tabIndex={-1}
                className={`of-amount-key of-amount-key-eq ${canResolve ? "" : "is-idle"}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={field.resolve}
                aria-label="Equals — resolve to total"
                aria-disabled={!canResolve || undefined}
            >
                =
            </button>
        </div>
    );
}

/* ----- 2-col field row ----- */

export function OrbitFieldRow({
    children,
    cols = "1fr 1fr",
}: {
    children: ReactNode;
    cols?: string;
}) {
    /* On phones we stack into 1 column. The desktop column ratio is
       passed via a CSS variable so the @media (min-width: 520px) rule in
       ORBIT_FORM_STYLES can switch back to it without losing the prop. */
    return (
        <div className="of-row" style={{ "--of-row-cols": cols } as React.CSSProperties}>
            {children}
        </div>
    );
}

/* ----- Radio row (segmented "card" radios) ----- */

export function OrbitRadioRow<T extends string>({
    options,
    value,
    onChange,
    name,
    accent = "var(--brand)",
}: {
    options: Array<{ value: T; label: ReactNode; hint?: ReactNode }>;
    value: T;
    onChange: (v: T) => void;
    name: string;
    accent?: string;
}) {
    return (
        <div className="of-radio-row">
            {options.map((o) => {
                const active = o.value === value;
                return (
                    <label
                        key={o.value}
                        className={active ? "of-radio is-active" : "of-radio"}
                        style={
                            active
                                ? {
                                      borderColor: accent,
                                      background: `color-mix(in oklab, ${accent} 12%, transparent)`,
                                  }
                                : undefined
                        }
                    >
                        <input
                            type="radio"
                            name={name}
                            value={o.value}
                            checked={active}
                            onChange={() => onChange(o.value)}
                            className="of-radio-native"
                        />
                        <span
                            className="of-radio-dot"
                            style={active ? { borderColor: accent } : undefined}
                        >
                            {active && (
                                <span
                                    className="of-radio-dot-inner"
                                    style={{ background: accent }}
                                />
                            )}
                        </span>
                        <span className="of-radio-text">
                            <span className="of-radio-label">{o.label}</span>
                            {o.hint && <span className="of-radio-hint">{o.hint}</span>}
                        </span>
                    </label>
                );
            })}
        </div>
    );
}

/* ----- Info pill (tinted bg + info icon) ----- */

export function OrbitInfoPill({
    tone = "brand",
    children,
}: {
    tone?: "brand" | "gold" | "expense" | "transfer";
    children: ReactNode;
}) {
    const color =
        tone === "gold"
            ? "var(--gold)"
            : tone === "expense"
              ? "var(--expense)"
              : tone === "transfer"
                ? "var(--transfer)"
                : "var(--brand)";
    return (
        <div
            className="of-info-pill"
            style={{
                background: `color-mix(in oklab, ${color} 8%, transparent)`,
                border: `1px solid color-mix(in oklab, ${color} 25%, transparent)`,
            }}
        >
            <Info className="size-3.5" style={{ color, flexShrink: 0, marginTop: 2 }} aria-hidden />
            <span className="of-info-pill-text">{children}</span>
        </div>
    );
}

/* ----- Toggle (used for transfer fee enable etc.) ----- */

export function OrbitToggle({
    checked,
    onChange,
    label,
    hint,
    accent = "var(--brand)",
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: ReactNode;
    hint?: ReactNode;
    accent?: string;
}) {
    return (
        <label className="of-toggle-row">
            <span
                className={checked ? "of-toggle is-on" : "of-toggle"}
                style={checked ? { background: accent } : undefined}
                aria-hidden
            >
                <span className="of-toggle-dot" />
            </span>
            <input
                type="checkbox"
                className="of-radio-native"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
            />
            <span className="of-toggle-text">
                <span className="of-toggle-label">{label}</span>
                {hint && <span className="of-toggle-hint">{hint}</span>}
            </span>
        </label>
    );
}

/* ----- One-shot stylesheet. Hoisted by React 19 + de-duped by browser. ----- */

export function OrbitFormStyles() {
    return <style>{ORBIT_FORM_STYLES}</style>;
}

const ORBIT_FORM_STYLES = `
.of-input {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 12px;
    border-radius: 10px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg);
    font-size: 13.5px;
    transition: border-color 120ms ease, box-shadow 120ms ease;
    width: 100%;
}
.of-input:focus-within {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-soft);
}
.of-input-lead {
    flex-shrink: 0;
    color: var(--fg-3);
    display: inline-flex;
    align-items: center;
}
.of-input-affix {
    flex-shrink: 0;
    color: var(--fg-4);
    font-size: 12.5px;
}
.of-input-suffix { font-size: 12px; }
.of-input-control {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--fg);
    font-size: 13.5px;
    font-family: inherit;
    padding: 0;
}
.of-input-control::placeholder { color: var(--fg-4); }
.of-input-control.of-mono { font-family: "Geist Mono", ui-monospace, monospace; }
/* Hide native number-input spinners — they break the editorial look. */
.of-input-control[type="number"]::-webkit-outer-spin-button,
.of-input-control[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
.of-input-control[type="number"] {
    -moz-appearance: textfield;
}

.of-textarea {
    width: 100%;
    min-height: 60px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg);
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
    font-family: inherit;
    outline: 0;
    transition: border-color 120ms ease, box-shadow 120ms ease;
}
.of-textarea::placeholder { color: var(--fg-4); }
.of-textarea:focus {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-soft);
}

/* ---- Select trigger ---- */
.of-select-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 38px;
    padding: 0 12px;
    border-radius: 10px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition: border-color 120ms ease, box-shadow 120ms ease;
}
.of-select-trigger:hover { border-color: var(--line-strong); }
.of-select-trigger:focus,
.of-select-trigger[data-state="open"] {
    outline: 0;
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-soft);
}
.of-select-trigger:disabled { opacity: 0.55; cursor: not-allowed; }
.of-select-value {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.of-select-placeholder { color: var(--fg-4); }
.of-select-chev { color: var(--fg-4); flex-shrink: 0; }

.of-lead-pill {
    width: 24px;
    height: 24px;
    border-radius: 7px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    background: color-mix(in oklab, var(--fg) 8%, transparent);
    border: 1px solid var(--line);
    color: var(--fg-3);
}
.of-lead-pill-sm { width: 22px; height: 22px; border-radius: 6px; }

.of-select-content {
    z-index: 50;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--shadow-2);
    color: var(--fg);
    font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
    overflow: hidden;
    min-width: var(--radix-select-trigger-width);
    max-height: 340px;
}
.of-select-viewport { padding: 4px; }
.of-select-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 7px;
    font-size: 13px;
    color: var(--fg-2);
    cursor: pointer;
    outline: 0;
    user-select: none;
    position: relative;
}
.of-select-item[data-highlighted] {
    background: var(--bg-elev-2);
    color: var(--fg);
}
.of-select-item[data-state="checked"] { color: var(--fg); }
.of-select-check {
    margin-left: auto;
    color: var(--brand);
    display: inline-flex;
}

/* ---- Hero amount card ---- */
.of-amount-card {
    background: var(--bg-elev-2);
    border: 1px solid var(--line-soft);
    border-radius: 14px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.of-amount-eyebrow {
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 500;
}
.of-amount-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
}
.of-amount-leadicon {
    align-self: center;
    display: inline-flex;
    color: var(--fg-3);
}
.of-amount-input {
    font-size: 40px;
    line-height: 1;
    font-weight: 500;
    letter-spacing: -0.02em;
    background: transparent;
    border: 0;
    outline: 0;
    padding: 0;
    width: 100%;
    min-width: 0;
    font-family: "Newsreader", Georgia, serif;
    color: var(--fg);
}
.of-amount-input::placeholder { color: var(--fg-4); font-weight: 400; }
.of-amount-unit {
    margin-left: auto;
    font-size: 11px;
    color: var(--fg-4);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

/* Inline calculator — live result readout + operator strip. Both are always
   mounted: conditional mounting shifted the strip ~22px under the user's
   finger the moment an operator was tapped, and a live region that appears
   together with its first content is commonly never announced. */
.of-amount-result {
    /* Fixed height + nowrap, not min-height: the "from <expression>" tape is
       variable-length and wrapped at 6 terms on a 320px hero, dropping the key
       strip 18px — under the user's finger, which is the exact defect the
       reserved box was introduced to prevent. */
    height: 18px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
    margin-top: -2px;
}
/* --warn, not --fg-4: this is the only signal that Save is blocked, and
   --fg-4 is the placeholder token (~2.8:1 on the card) — it rendered the
   blocked state *less* legibly than the everything-is-fine state. */
.of-amount-result.is-warn { color: var(--warn); }

.of-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

/* Compact calculator input (transfer fee, reconciled balance). */
.of-calc-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

/* Fixed 6-column grid, NOT wrapping flex. As a wrapping flex row the
   44px touch-size keys overran the 238px card interior at 320px, so the
   strip broke onto a second row and margin-left:auto flung the backspace to
   the far right, alone. Grid tracks shrink instead: at 320px each track is
   (238 - 5*6)/6 = 34.6px, still clear of the WCAG 2.5.8 24px floor. */
.of-amount-keys {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 44px));
    gap: 6px;
    margin-top: 4px;
    /* Pays for .of-amount-key-eq's gutter out of the track budget. The keys
       are width:100% of their grid area, so a margin SHIFTS one out of its
       track rather than narrowing it — the = key hung 4px past the strip
       (and into the drift card's column gap) wherever tracks were shrinking. */
    padding-right: 4px;
}
.of-amount-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* 28px clears the WCAG 2.5.8 24px floor on pointer devices; the
       (hover: none) block below grows it to a comfortable touch target. */
    height: 28px;
    width: 100%;
    min-width: 0;
    padding: 0;
    border-radius: 8px;
    /* elev-3 on an elev-2 card: elev-1 was DARKER than its container, so the
       keys read as recessed holes rather than raised controls. */
    background: var(--bg-elev-3);
    border: 1px solid var(--line-strong);
    color: var(--fg-2);
    font-family: inherit;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
/* States are mixed FROM the key's own base rather than set to absolute
   elevation tokens. The strip now sits on three different surfaces (elev-2
   amount card, elev-2 drift card, elev-1 drawer body for the transfer fee),
   and a hard-coded :hover of elev-2 rendered at 1.00:1 — invisible — on the
   two elev-2 hosts, while :active at elev-1 vanished in the fee field. Mixing
   toward --fg keeps every state lighter than every host. */
.of-amount-key:hover {
    background: color-mix(in oklab, var(--bg-elev-3) 84%, var(--fg));
    color: var(--fg);
}
.of-amount-key:active {
    background: color-mix(in oklab, var(--bg-elev-3) 68%, var(--fg));
    /* Lighter than the pressed fill; --fg-4 sat at 1.04:1 against it and did
       no work at all. */
    border-color: color-mix(in oklab, var(--bg-elev-3) 20%, var(--fg));
    color: var(--fg);
}
/* Dead code today — the keys are tabIndex -1 and preventDefault their
   mousedown, so they never take focus. Kept deliberately: if they are ever
   made focusable the ring must already be here. */
.of-amount-key:focus-visible {
    outline: none;
    border-color: var(--brand);
    box-shadow: 0 0 0 2px var(--brand-soft);
}
.of-amount-key-back { color: var(--fg-3); }
/* The resolve key is the one that changes the field's contents, so it reads
   as the accent action. is-idle (a plain literal — nothing to resolve) dims
   it in place rather than removing it, keeping the strip geometry stable
   while the user types. */
.of-amount-key-eq {
    /* Extra gutter: backspace and resolve are the two thumb-landing keys at
       the right edge of the strip, and a mis-tap on backspace silently eats a
       digit out of a resolved total. */
    margin-left: 4px;
    color: var(--brand);
    border-color: color-mix(in oklab, var(--brand) 60%, transparent);
    font-weight: 600;
}
.of-amount-key-eq:hover {
    background: color-mix(in oklab, var(--brand) 16%, var(--bg-elev-3));
    color: var(--brand);
}
.of-amount-key-eq.is-idle {
    /* Dimmed brand (5.27:1), not --fg-4 (2.51:1) — the key must still read as
       the accent control, just unavailable. --line-strong keeps the outline
       matching its five siblings; plain --line is 1.03:1 against the key's own
       fill, which erased the key rather than dimming it. */
    color: color-mix(in oklab, var(--brand) 70%, var(--fg-4));
    border-color: var(--line-strong);
    font-weight: 400;
}
/* Pointer devices cap the track narrower: against the hero card's 440px
   interior the 44px cap gave 44x28 keys, a 1.57:1 slab that reads as a
   toolbar rather than a keypad. Touch keeps the full 44/40. */
@media (hover: hover) {
    .of-amount-keys { grid-template-columns: repeat(6, minmax(0, 34px)); }
}
@media (hover: none) {
    .of-amount-key { height: 40px; font-size: 16px; }
}

/* Paired 2-column cells: reserve the label row's height so a cell WITH a
   hint control (the Date field's Keep pill) stays aligned with one whose
   hint renders null (the Account pin on /s/me, or before an account is
   picked). Scoped to .of-row — putting it on bare .oms-field-row would add
   ~19px to every field in every Orbit form on touch. */
/* Gated to the 2-column breakpoint: below 520px .of-row is a single column,
   so there is no sibling to align to and the reserved height is pure dead
   space — up to 46px per row on a phone. */
@media (min-width: 520px) {
    .of-row > .oms-field > .oms-field-row {
        align-items: center;
        min-height: 24px;
    }
}
@media (min-width: 520px) and (hover: none) {
    .of-row > .oms-field > .oms-field-row { min-height: 36px; }
}

/* Phone — scale the hero amount card down so the 40px serif input doesn't
   overflow on a 320–360px viewport. */
@media (max-width: 480px) {
    .of-amount-card { padding: 14px; }
    .of-amount-input { font-size: 32px; }
    .of-amount-unit { font-size: 10px; }
}

/* ============================================================
   Mobile (≤640px) — bump every input/select/textarea so iOS Safari
   doesn't auto-zoom on focus (it zooms any input with font-size < 16px),
   and increases tap heights to a comfortable 44px. Native
   datetime-local / date inputs honor color-scheme: dark to render the
   editorial-dark picker chrome. Applies to every form using OrbitForm
   primitives — including New + Edit transaction drawers, and any
   future form that opts in.
   ============================================================ */
@media (max-width: 640px) {
    .of-input { height: 44px; }
    .of-input-control { font-size: 16px; }
    .of-input-control[type="datetime-local"],
    .of-input-control[type="date"],
    input[type="datetime-local"],
    input[type="date"] {
        color-scheme: dark;
        font-size: 16px;
        min-width: 0;
    }
    .of-textarea { font-size: 16px; }
    .of-select-trigger { height: 44px; font-size: 14px; }
    /* The hero amount input keeps its serif look but stops triggering
       the auto-zoom — at 32px on phone it's already over the threshold. */
}

/* ---- Field row ---- */
/* Stacks to one column on phones; uses the column template passed in via
   --of-row-cols at >= 520px. Keeps date + account paired on tablet+ but
   gives them full width on a 360-wide phone where datetime-local + a
   select side-by-side is too cramped to read. */
.of-row {
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr;
}
@media (min-width: 520px) {
    .of-row {
        grid-template-columns: var(--of-row-cols, 1fr 1fr);
    }
}

/* ---- Radio row ---- */
/* Auto-wrap radio cells: each is at least 120px wide; if the row can't
   fit them all on one line they flow to the next line. Container-aware
   without needing an explicit @container rule. */
.of-radio-row {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}
.of-radio {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg-elev-1);
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease;
}
.of-radio:hover:not(.is-active) { border-color: var(--line-strong); }
.of-radio-native {
    position: absolute;
    width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
.of-radio-dot {
    width: 14px;
    height: 14px;
    border-radius: 99px;
    border: 1px solid var(--line-strong);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.of-radio-dot-inner {
    width: 7px;
    height: 7px;
    border-radius: 99px;
}
.of-radio-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
}
.of-radio-label {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--fg);
}
.of-radio-hint {
    font-size: 10.5px;
    color: var(--fg-4);
}

/* ---- Info pill ---- */
.of-info-pill {
    padding: 12px;
    border-radius: 10px;
    display: flex;
    gap: 10px;
    align-items: flex-start;
}
.of-info-pill-text {
    font-size: 11.5px;
    color: var(--fg-2);
    line-height: 1.55;
}

/* ---- Toggle ---- */
.of-toggle-row {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
}
.of-toggle {
    width: 32px;
    height: 18px;
    border-radius: 99px;
    background: var(--bg-elev-3);
    position: relative;
    flex-shrink: 0;
    transition: background 140ms ease;
}
.of-toggle-dot {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 99px;
    background: var(--fg-3);
    transition: left 140ms ease, background 140ms ease;
}
.of-toggle.is-on .of-toggle-dot {
    left: 16px;
    background: var(--brand-fg);
}
.of-toggle-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.of-toggle-label {
    font-size: 13px;
    color: var(--fg);
    font-weight: 500;
}
.of-toggle-hint {
    font-size: 11px;
    color: var(--fg-4);
    line-height: 1.5;
}

/* ---- Footer / shell buttons ---- */
.orbit-btn {
    height: 36px;
    padding: 0 14px;
    border-radius: 10px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: background 140ms ease, border-color 140ms ease, filter 140ms ease, color 140ms ease;
}
.orbit-btn:hover:not(:disabled):not(.orbit-btn-primary):not(.orbit-btn-danger):not(.orbit-btn-ghost) {
    background: var(--bg-elev-2);
    border-color: var(--line-strong);
}
.orbit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.orbit-btn-primary {
    background: var(--brand);
    color: var(--brand-fg);
    border-color: oklch(78% 0.14 165);
}
.orbit-btn-primary:hover:not(:disabled) { filter: brightness(1.05); }
.orbit-btn-danger {
    background: var(--expense);
    color: white;
    border-color: var(--expense);
}
.orbit-btn-danger:hover:not(:disabled) { filter: brightness(1.05); }
.orbit-btn-ghost {
    background: transparent;
    border-color: transparent;
    color: var(--fg-3);
}
.orbit-btn-ghost:hover:not(:disabled) {
    background: var(--bg-elev-2);
    color: var(--fg);
}
.orbit-btn-sm { height: 30px; padding: 0 10px; font-size: 12px; }

/* ---- Stepper (used by NewPlan wizard) ---- */
.of-stepper {
    display: flex;
    align-items: center;
    gap: 10px;
}
.of-stepper-item {
    display: flex;
    align-items: center;
    gap: 8px;
}
.of-stepper-item.is-pending { opacity: 0.5; }
.of-stepper-num {
    width: 22px;
    height: 22px;
    border-radius: 99px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--fg-3);
    font-size: 11px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.of-stepper-item.is-active .of-stepper-num {
    background: var(--bg-elev-3);
    border-color: var(--brand);
    color: var(--brand);
}
.of-stepper-item.is-done .of-stepper-num {
    background: var(--brand);
    border-color: var(--brand);
    color: var(--brand-fg);
}
.of-stepper-label {
    font-size: 12px;
    color: var(--fg-3);
}
.of-stepper-item.is-active .of-stepper-label {
    color: var(--fg);
    font-weight: 500;
}
.of-stepper-bar {
    flex: 1;
    height: 1px;
    background: var(--line);
}
.of-stepper-bar.is-done { background: var(--brand); }

/* ---- Big radio cards (used by NewPlan funding strategies) ---- */
.of-radio-card-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.of-radio-card {
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg-elev-1);
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease;
}
.of-radio-card:hover:not(.is-active) { border-color: var(--line-strong); }
.of-radio-card.is-active {
    border-color: var(--brand);
    background: var(--brand-soft);
}
.of-radio-card-dot {
    width: 16px;
    height: 16px;
    border-radius: 99px;
    border: 1px solid var(--line-strong);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.of-radio-card.is-active .of-radio-card-dot { border-color: var(--brand); }
.of-radio-card-dot-inner {
    width: 8px;
    height: 8px;
    border-radius: 99px;
    background: var(--brand);
}
.of-radio-card-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.of-radio-card-label { font-size: 13px; font-weight: 500; color: var(--fg); }
.of-radio-card-hint { font-size: 11.5px; color: var(--fg-4); }

/* ---- Tile (account-type / method-button grids) ---- */
.of-tile {
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg-elev-1);
    color: var(--fg);
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    transition: border-color 120ms ease, background 120ms ease;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
}
.of-tile:hover:not(.is-active) { border-color: var(--line-strong); }
.of-tile.is-active { background: var(--brand-soft); border-color: var(--brand); }

/* ---- Account label inside an OrbitSelect value ----
   AccountLabel renders the account name and (when present) the
   owner avatar+name pill side-by-side inside the select trigger.
   Hard nowrap and ellipsis on the name keep the trigger to its
   fixed 38px height even when the owner pill makes content wide. */
.of-acc-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    flex-wrap: nowrap;
    overflow: hidden;
    line-height: 1;
}
.of-acc-name {
    color: var(--fg);
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.of-acc-meta {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--fg-3);
    flex-shrink: 0;
    white-space: nowrap;
}
.of-acc-meta::before {
    content: "·";
    margin: 0 2px;
    color: var(--fg-4);
}

/* ---- Form shell layout (shared by every transaction form) ----
   The .nt-form class is the outer <form> in both NewTransactionSheet
   and EditTransactionSheet; defining the gap rule here means both
   sheets get consistent vertical rhythm without each one redefining
   the layout in its own <style> block. */
.nt-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 16px;
}

/* ---- Inline envelope chip (expense forms) ----
   Theme-matched to .of-input / .of-select-trigger so it sits in the
   same vertical rhythm and doesn't visually clash with the form's
   editorial-dark surface. */
.of-chip-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 38px;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--bg-elev-2);
    border: 1px solid var(--line-soft);
}
.of-chip-row-content {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
}
.of-chip-eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 10.5px;
    font-weight: 500;
    color: var(--fg-3);
    flex-shrink: 0;
}
.of-chip-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 99px;
    flex-shrink: 0;
}
.of-chip-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* Name shrinks first so the meta signal (the "pinned" / "selected"
       word) stays fully visible on narrow phones. min-width:0 is
       required for ellipsis inside a flex parent; flex:1 takes the
       available slack. */
    flex: 1;
    min-width: 0;
}
.of-chip-meta {
    font-size: 11.5px;
    color: var(--fg-4);
    white-space: nowrap;
    /* Meta carries a load-bearing signal — keep it at content width. */
    flex-shrink: 0;
}
.of-chip-btn {
    flex-shrink: 0;
    padding: 4px 10px;
    border-radius: 8px;
    background: transparent;
    border: 1px solid var(--line);
    color: var(--fg-2);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 120ms, color 120ms, background 120ms;
}
.of-chip-btn:hover {
    border-color: var(--line-strong);
    color: var(--fg);
    background: var(--bg-elev-1);
}
/* Touch devices: the chip's Change/Cancel buttons are primary controls —
   grow them toward the 40px tap target. */
@media (hover: none) {
    .of-chip-btn { min-height: 36px; padding: 6px 12px; }
}

/* ---- Inline picker row (chip "Change" expanded mode) ----
   A select + cancel button side-by-side, occupying the same slot
   as the chip would. */
.of-inline-picker-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.of-inline-picker-row > :first-child {
    flex: 1;
    min-width: 0;
}

/* ---- Disclosure toggle for collapsing optional fields ---- */
.of-disclosure-toggle {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px;
    border-radius: 10px;
    border: 1px dashed var(--line);
    background: transparent;
    color: var(--fg-3);
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition: border-color 120ms, color 120ms, background 120ms;
}
.of-disclosure-toggle:hover {
    border-color: var(--line-strong);
    color: var(--fg-2);
    background: var(--bg-elev-1);
}
.of-disclosure-toggle svg {
    flex-shrink: 0;
    color: var(--fg-4);
}
`;
