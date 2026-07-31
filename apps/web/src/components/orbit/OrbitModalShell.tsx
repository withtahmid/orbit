import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Editorial-dark modal/drawer shell — renders the design's exact header
 * composition (lead-icon pill, eyebrow, display title, subtitle, close X)
 * and an optional sticky footer. Designed to live INSIDE shadcn's
 * `<DialogContent>` or `<SheetContent>` so the existing radix portal,
 * focus trap, and dismiss handlers continue to work.
 *
 * Usage:
 *   <Dialog>
 *     <DialogContent className="orbit-shell-host">
 *       <OrbitModalShell
 *         eyebrow="Categories"
 *         title="New category"
 *         subtitle="Hierarchical labels for transactions."
 *         leadIcon={<FolderIcon />}
 *         leadColor="var(--ent-3)"
 *         onClose={() => setOpen(false)}
 *         footer={<>...</>}
 *       >
 *         {form fields}
 *       </OrbitModalShell>
 *     </DialogContent>
 *   </Dialog>
 *
 * The `orbit-shell-host` class on DialogContent strips shadcn's default
 * padding so the shell controls the entire layout.
 */
export function OrbitModalShell({
    eyebrow,
    title,
    subtitle,
    leadIcon,
    leadColor = "var(--brand)",
    onClose,
    footer,
    children,
    width = 520,
    bodyClassName,
}: {
    eyebrow?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    leadIcon?: ReactNode;
    leadColor?: string;
    onClose?: () => void;
    footer?: ReactNode;
    children: ReactNode;
    width?: number;
    bodyClassName?: string;
}) {
    return (
        <div className="orbit-design oms-root" style={{ width }}>
            <style>{OMS_STYLES}</style>
            <header className="oms-head">
                {leadIcon && (
                    <span
                        className="oms-lead"
                        style={{
                            background: `color-mix(in oklab, ${leadColor} 18%, transparent)`,
                            border: `1px solid color-mix(in oklab, ${leadColor} 30%, transparent)`,
                            color: leadColor,
                        }}
                        aria-hidden
                    >
                        {leadIcon}
                    </span>
                )}
                <div className="oms-head-text">
                    {eyebrow && <span className="eyebrow oms-eyebrow">{eyebrow}</span>}
                    <h2 className="display oms-title">{title}</h2>
                    {subtitle && <p className="oms-sub">{subtitle}</p>}
                </div>
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="oms-close"
                        aria-label="Close"
                    >
                        <X className="size-3.5" />
                    </button>
                )}
            </header>
            <div className={`oms-body ${bodyClassName ?? ""}`}>{children}</div>
            {footer && <footer className="oms-foot">{footer}</footer>}
        </div>
    );
}

/**
 * Drawer variant — taller, full-height layout with a scrolling middle.
 * Same header + footer composition as OrbitModalShell. Render inside
 * shadcn's `<SheetContent side="right" className="orbit-shell-host">`.
 */
export function OrbitDrawerShell({
    eyebrow,
    title,
    subtitle,
    leadIcon,
    leadColor = "var(--brand)",
    onClose,
    footer,
    children,
    bodyClassName,
}: {
    eyebrow?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    leadIcon?: ReactNode;
    leadColor?: string;
    onClose?: () => void;
    footer?: ReactNode;
    children: ReactNode;
    bodyClassName?: string;
}) {
    return (
        <div className="orbit-design ods-root">
            <style>{OMS_STYLES}</style>
            <header className="ods-head">
                {leadIcon && (
                    <span
                        className="oms-lead"
                        style={{
                            background: `color-mix(in oklab, ${leadColor} 18%, transparent)`,
                            border: `1px solid color-mix(in oklab, ${leadColor} 30%, transparent)`,
                            color: leadColor,
                        }}
                        aria-hidden
                    >
                        {leadIcon}
                    </span>
                )}
                <div className="oms-head-text">
                    {eyebrow && <span className="eyebrow oms-eyebrow">{eyebrow}</span>}
                    <h2 className="display oms-title">{title}</h2>
                    {subtitle && <p className="oms-sub">{subtitle}</p>}
                </div>
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="oms-close"
                        aria-label="Close"
                    >
                        <X className="size-3.5" />
                    </button>
                )}
            </header>
            <div className={`ods-body ${bodyClassName ?? ""}`}>{children}</div>
            {footer && <footer className="ods-foot">{footer}</footer>}
        </div>
    );
}

/* Field helpers used inside the shells. Match the design's "Field" block
   (label row with optional hint right-aligned, then input). */

export function OrbitField({
    label,
    hint,
    required,
    children,
    /**
     * Render the wrapper as a <div> instead of a <label>. Pass this
     * whenever the field owns MORE than one interactive element, or one
     * that isn't a plain text input — because a <label> forwards every
     * click anywhere inside it to its first labelable descendant
     * (`button`, `input`, `select`, `textarea`, …), so the whole field
     * row silently becomes a hit target for that one control:
     *
     *  - the hint slot holds its own control (e.g. a Pin toggle) — a
     *    single <label> must not wrap two separate interactive elements;
     *  - the content holds a button rather than an input (e.g.
     *    FileUploadField's "Add file", a colour/icon picker) — without
     *    this, clicking the field's label text or any empty space in the
     *    row fires that button, which for a file field means the OS file
     *    picker opening from a stray click.
     *
     * Only omit it for the plain single-input case, where "click the
     * label to focus the input" is exactly what you want.
     */
    noWrapperLabel = false,
}: {
    label: ReactNode;
    hint?: ReactNode;
    required?: boolean;
    children: ReactNode;
    noWrapperLabel?: boolean;
}) {
    const Tag = (noWrapperLabel ? "div" : "label") as "div" | "label";
    return (
        <Tag className="oms-field">
            <span className="oms-field-row">
                <span className="oms-field-label">
                    {label}
                    {required && <span className="oms-field-required">*</span>}
                </span>
                {hint && <span className="oms-field-hint">{hint}</span>}
            </span>
            {children}
        </Tag>
    );
}

const OMS_STYLES = `
.oms-root {
    background: var(--bg-elev-1);
    border-radius: 18px;
    border: 1px solid var(--line);
    color: var(--fg);
    font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
    box-shadow: 0 32px 80px -16px rgb(0 0 0 / 0.7),
        0 1px 0 0 var(--inset-hi) inset;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    max-height: calc(100vh - 64px);
    max-width: calc(100vw - 32px);
}
.oms-head {
    padding: 22px 24px 18px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    border-bottom: 1px solid var(--line);
}
.oms-head-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.oms-eyebrow {
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 500;
}
.oms-title {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--fg);
    margin: 2px 0 0;
}
.oms-sub {
    font-size: 12.5px;
    color: var(--fg-3);
    margin: 5px 0 0;
    line-height: 1.5;
}
.oms-lead {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
}
.oms-close {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    background: transparent;
    border-radius: 6px;
    color: var(--fg-3);
    cursor: pointer;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    transition: background 140ms ease, color 140ms ease;
}
.oms-close:hover { background: var(--bg-elev-2); color: var(--fg); }

.oms-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.oms-foot {
    padding: 14px 24px;
    border-top: 1px solid var(--line);
    background: var(--bg);
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
}

/* Drawer variant — full height, slightly narrower padding */
.ods-root {
    background: var(--bg-elev-1);
    color: var(--fg);
    font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.ods-head {
    padding: 20px 22px 16px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    border-bottom: 1px solid var(--line);
}
.ods-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 18px;
}
.ods-foot {
    padding: 14px 22px;
    border-top: 1px solid var(--line);
    background: var(--bg);
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
}

/* Form fields */
.oms-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.oms-field-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
}
.oms-field-label {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--fg-2);
    letter-spacing: 0.02em;
}
.oms-field-required {
    color: var(--brand);
    margin-left: 4px;
}
.oms-field-hint {
    font-size: 11px;
    color: var(--fg-4);
    text-align: right;
}

/* Strip shadcn DialogContent's default padding so the shell takes
   over the whole layout. Hides shadcn's default close button too.
   width:auto is critical — shadcn applies w-full max-w-lg which makes
   the content fill the viewport; combined with translate-x:-50% that
   pushes the inner OrbitModalShell to the left edge. width:auto sizes
   the content to the shell width so it centers properly. */
.orbit-shell-host[data-slot="dialog-content"],
.orbit-shell-host[data-slot="alert-dialog-content"] {
    padding: 0 !important;
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
    width: auto !important;
    max-width: calc(100vw - 32px) !important;
    overflow: visible !important;
    display: block !important;
    gap: 0 !important;
}
.orbit-shell-host > button[data-slot="dialog-close"],
.orbit-shell-host > button[data-slot="sheet-close"],
.orbit-shell-host > button[data-slot="alert-dialog-cancel"] + button[data-slot="dialog-close"] {
    display: none !important;
}
/* The Sheet/Dialog content is OUTSIDE the .orbit-design scope, so the
   oklch tokens defined under .orbit-design don't resolve here. Use literal
   colors (matching --bg-elev-1) and kill the shadcn border so we don't get
   a stray light-mode hairline showing through. */
.orbit-shell-host[data-slot="sheet-content"] {
    padding: 0 !important;
    background: oklch(17% 0.006 180) !important;
    border: 0 !important;
    box-shadow: -32px 0 80px -16px rgb(0 0 0 / 0.6) !important;
}

/* Lighten the shadcn overlay. Default bg-black/70 + backdrop-blur-sm was
   crushing everything behind the drawer/dialog into a heavy black blur.
   Editorial-dark uses a lighter dim with no blur. */
[data-slot="sheet-overlay"],
[data-slot="dialog-overlay"],
[data-slot="alert-dialog-overlay"] {
    background-color: rgb(0 0 0 / 0.45) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}

/* Editorial-dark buttons usable inside the shell footer.  These mirror
   the .od-btn primitives but namespaced so they don't depend on the
   .orbit-design root class wrapping the whole document — the shell
   already provides that wrapper. */

/* ============================================================
   Mobile (<640px) — drawer + modal
   ============================================================
   Tighten paddings, allow footer buttons to grow to full width
   (since on phones two side-by-side actions can overflow), and
   ensure the modal shell doesn't outgrow the screen.
   ============================================================ */
@media (max-width: 640px) {
    .oms-root {
        max-width: calc(100vw - 1rem);
        max-height: calc(100dvh - 1rem);
    }
    .oms-head,
    .ods-head {
        padding: 16px 16px 12px;
        gap: 12px;
    }
    .oms-body,
    .ods-body {
        padding: 14px 16px;
        gap: 14px;
    }
    .oms-foot,
    .ods-foot {
        padding: 12px 16px;
        gap: 8px;
    }
    /* Footer buttons fill the row on phone so the primary CTA is always
       large enough to tap. Two-button footers wrap with the primary on
       top (visual order via order:1 on .oms-foot > :last-child). */
    .oms-foot > *,
    .ods-foot > * {
        flex: 1 1 auto;
        justify-content: center;
    }
    /* Smaller display title so it doesn't crowd the close button. */
    .oms-title { font-size: 18px; }
    .oms-sub { font-size: 12px; }
    /* Lead icon shrinks. */
    .oms-lead { width: 32px; height: 32px; }
}

@media (max-width: 380px) {
    .oms-head,
    .ods-head {
        padding: 14px 14px 10px;
        gap: 10px;
    }
    .oms-body,
    .ods-body { padding: 12px 14px; }
    .oms-foot,
    .ods-foot { padding: 10px 14px; }
    .oms-title { font-size: 17px; }
}
`;
