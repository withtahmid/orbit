import { useRef, useState, useMemo, useEffect, type FormEvent, type ReactNode } from "react";
import { useCanEdit } from "@/hooks/useCurrentSpace";
import { useStore } from "@/stores/useStore";
import { usePins, type PinField } from "./usePins";
import { PinControl, PIN_CONTROL_STYLES } from "./PinControl";
import {
    useOptimisticTransactionCache,
    computeDelta,
    type OptimisticTxRow,
} from "./useOptimisticTransactionCache";
import { TransactionDatePicker, TDP_POPOVER_STYLES } from "./TransactionDatePicker";
import {
    Plus,
    ArrowDown,
    ArrowUp,
    ArrowLeftRight,
    SlidersHorizontal,
    Check,
    Calendar,
    Wallet,
    Layers,
    ChevronDown,
    ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { OrbitDrawerShell, OrbitField } from "@/components/orbit/OrbitModalShell";
import {
    OrbitAmountCard,
    OrbitFieldRow,
    OrbitFormStyles,
    OrbitInput,
    OrbitRadioRow,
    OrbitSelect,
    OrbitTextarea,
    OrbitToggle,
    type OrbitSelectItem,
} from "@/components/orbit/OrbitForm";
import { CategoryTreeSelect } from "@/components/shared/CategoryTreeSelect";
import { FileUploadField } from "@/components/file-upload-field";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { trpc } from "@/trpc";
import type { RouterOutput } from "@/trpc";
import { useInvalidateAnalytics } from "@/lib/invalidate";
import { cn } from "@/lib/utils";
import { useCurrentSpaceId } from "@/hooks/useCurrentSpace";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import { toInputDateTime, fromInputDateTime, startOfMonth, endOfMonth } from "@/lib/dates";
import { getIcon } from "@/lib/entityIcons";

type SpaceAccount = RouterOutput["account"]["listBySpace"][number];
type Envelop = RouterOutput["envelop"]["listBySpace"][number];

const ownedByMe = (a: SpaceAccount) => a.myRole === "owner";

function AccountLabel({ account }: { account: SpaceAccount }) {
    const first = account.owners?.[0];
    const extra = (account.owners?.length ?? 0) - 1;
    return (
        <span className="of-acc-label">
            <span className="of-acc-name">{account.name}</span>
            {first && (
                <span className="of-acc-meta">
                    <UserAvatar
                        fileId={first.avatar_file_id}
                        firstName={first.first_name}
                        size="xs"
                    />
                    {first.first_name}
                    {extra > 0 && ` +${extra}`}
                </span>
            )}
        </span>
    );
}

/** Convert a SpaceAccount to an OrbitSelectItem with its icon/color. */
function toAccountItem(a: SpaceAccount): OrbitSelectItem {
    const Icon = getIcon(a.icon ?? null);
    return {
        value: a.id,
        label: <AccountLabel account={a} />,
        leadIcon: <Icon className="size-3.5" />,
        leadColor: a.color ?? "var(--ent-1)",
    };
}

type TxTab = "income" | "expense" | "transfer" | "adjustment";

const TAB_META: Record<
    TxTab,
    {
        label: string;
        icon: typeof ArrowDown;
        color: string;
        eyebrow: string;
        title: string;
        subtitle: string;
        leadIcon: typeof ArrowDown;
    }
> = {
    expense: {
        label: "Expense",
        icon: ArrowUp,
        color: "var(--expense)",
        eyebrow: "New transaction",
        title: "Add expense",
        subtitle: "Posted to ledger immediately. Drafts auto-save.",
        leadIcon: ArrowUp,
    },
    income: {
        label: "Income",
        icon: ArrowDown,
        color: "var(--income)",
        eyebrow: "New transaction",
        title: "Add income",
        subtitle: "Posted to ledger immediately. Drafts auto-save.",
        leadIcon: ArrowDown,
    },
    transfer: {
        label: "Transfer",
        icon: ArrowLeftRight,
        color: "var(--transfer)",
        eyebrow: "New transfer",
        title: "Move money",
        subtitle: "Between accounts within this space. Doesn't affect totals.",
        leadIcon: ArrowLeftRight,
    },
    adjustment: {
        label: "Adjust",
        icon: SlidersHorizontal,
        color: "var(--gold)",
        eyebrow: "New transaction",
        title: "Reconcile balance",
        subtitle:
            "Correct a drift between Orbit's balance and your bank's. Posted as a one-line adjustment.",
        leadIcon: SlidersHorizontal,
    },
};

const TAB_ORDER: TxTab[] = ["expense", "income", "transfer", "adjustment"];

export function NewTransactionSheet({ trigger }: { trigger?: React.ReactNode } = {}) {
    const [open, setOpen] = useState(false);
    const [activeType, setActiveType] = useState<TxTab>("expense");
    const [formKey, setFormKey] = useState(0);
    /* Lifted from each tab's form. The Save buttons live in the footer
       (outside the form), so the mutation's isPending state has to be
       surfaced upward — otherwise the click is silent until the server
       responds. */
    const [isSaving, setIsSaving] = useState(false);
    /* When true, the next successful submit re-renders the form with a fresh
       key (resetting all field state) instead of closing the sheet. Held in a
       ref because the mutation's onSuccess fires before React would observe
       a state change scheduled in the same tick. */
    const addAnotherRef = useRef(false);
    const meta = TAB_META[activeType];
    const LeadIcon = meta.leadIcon;

    const handleDone = () => {
        if (addAnotherRef.current) {
            addAnotherRef.current = false;
            /* Clear isSaving BEFORE bumping formKey. The new form mounts
               next render with mutate.isPending=false and would fire its
               onPendingChange effect to clear, but between unmount and
               remount the parent renders once with the old form's last
               true value — leaving Save disabled for a frame. Explicit
               reset closes that gap. */
            setIsSaving(false);
            setFormKey((k) => k + 1);
        } else {
            setOpen(false);
        }
    };

    const submitAddAnother = () => {
        addAnotherRef.current = true;
        const form = document.getElementById("nt-form") as HTMLFormElement | null;
        form?.requestSubmit();
    };

    return (
        <Sheet
            open={open}
            onOpenChange={(v) => {
                setOpen(v);
                if (!v) addAnotherRef.current = false;
            }}
        >
            <SheetTrigger asChild>
                {trigger ?? (
                    <Button variant="gradient">
                        <Plus />
                        <span className="hidden sm:inline">New transaction</span>
                        <span className="sm:hidden">New</span>
                    </Button>
                )}
            </SheetTrigger>
            <SheetContent side="right" className="orbit-shell-host !p-0 sm:max-w-[520px]">
                <SheetTitle className="sr-only">{meta.title}</SheetTitle>
                <OrbitDrawerShell
                    eyebrow={meta.eyebrow}
                    title={meta.title}
                    subtitle={meta.subtitle}
                    leadIcon={<LeadIcon className="size-4" />}
                    leadColor={meta.color}
                    onClose={() => setOpen(false)}
                    footer={
                        <>
                            {activeType !== "adjustment" && (
                                <button
                                    type="button"
                                    className="nt-btn"
                                    onClick={submitAddAnother}
                                    disabled={isSaving}
                                >
                                    {isSaving ? "Saving…" : "Save & add another"}
                                </button>
                            )}
                            <button
                                type="submit"
                                form="nt-form"
                                className="nt-btn nt-btn-primary"
                                disabled={isSaving}
                            >
                                {isSaving ? (
                                    <span className="nt-spinner" aria-hidden />
                                ) : (
                                    <Check className="size-3.5" />
                                )}
                                {isSaving
                                    ? "Saving…"
                                    : activeType === "adjustment"
                                      ? "Post adjustment"
                                      : activeType === "transfer"
                                        ? "Transfer"
                                        : "Save transaction"}
                            </button>
                        </>
                    }
                >
                    <OrbitFormStyles />
                    <style>{NT_STYLES}</style>
                    <style>{PIN_CONTROL_STYLES}</style>
                    <style>{TDP_POPOVER_STYLES}</style>
                    {/* 4-tab type bar */}
                    <div className="nt-tabs" role="tablist">
                        {TAB_ORDER.map((id) => {
                            const m = TAB_META[id];
                            const active = id === activeType;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    className={cn("nt-tab", active && "is-active")}
                                    style={active ? { color: m.color } : undefined}
                                    onClick={() => setActiveType(id)}
                                >
                                    <m.icon className="size-3" />
                                    {m.label}
                                </button>
                            );
                        })}
                    </div>

                    <Tabs value={activeType} onValueChange={(v) => setActiveType(v as TxTab)}>
                        <TabsContent value="income">
                            <IncomeForm
                                key={`income-${formKey}`}
                                onDone={handleDone}
                                onPendingChange={setIsSaving}
                            />
                        </TabsContent>
                        <TabsContent value="expense">
                            <ExpenseForm
                                key={`expense-${formKey}`}
                                onDone={handleDone}
                                onPendingChange={setIsSaving}
                            />
                        </TabsContent>
                        <TabsContent value="transfer">
                            <TransferForm
                                key={`transfer-${formKey}`}
                                onDone={handleDone}
                                onPendingChange={setIsSaving}
                            />
                        </TabsContent>
                        <TabsContent value="adjustment">
                            <AdjustmentForm
                                key={`adjustment-${formKey}`}
                                onDone={handleDone}
                                onPendingChange={setIsSaving}
                            />
                        </TabsContent>
                    </Tabs>
                </OrbitDrawerShell>
            </SheetContent>
        </Sheet>
    );
}

/* Exported so EditTransactionSheet — which shares the .nt-form / .nt-btn /
   .nt-swap layout — can mount the same rules without duplicating them. */
export const NT_STYLES = `
.nt-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 4px;
    padding: 4px;
    background: var(--bg-elev-2);
    border-radius: 10px;
    border: 1px solid var(--line-soft);
}
.nt-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    padding: 0 6px;
    border-radius: 7px;
    border: 0;
    background: transparent;
    color: var(--fg-3);
    font-weight: 400;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    transition: background 140ms ease, color 140ms ease;
}
.nt-tab:hover { color: var(--fg-2); }
.nt-tab.is-active {
    background: var(--bg-elev-1);
    color: var(--fg);
    font-weight: 500;
    box-shadow: var(--shadow-1);
}

/* Form layout */
.nt-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 16px;
}

/* Inline hint row that mixes text with a small action button (PinControl).
   OrbitField gives us a single hint span; this wraps multi-piece hints
   so the gap reads as a row rather than tight-packed inline content. */
.nt-hint-row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

/* Stale-event row inside EventSelect — used when the form was hydrated
   from a pin that points at a now-closed event. The Closed badge is
   flex-shrink: 0 so it survives the trigger's ellipsis behavior on
   narrow viewports. */
.nt-stale-row {
    /* Plain flex (not inline-flex) + min-width:0 lets the child name
       shrink inside the trigger's nowrap+overflow:hidden container.
       Otherwise the inline parent has no constrained width and the name
       hard-clips without ever showing the ellipsis glyph the badge is
       supposed to sit next to. */
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
}
.nt-stale-badge {
    flex-shrink: 0;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--fg-3) 14%, transparent);
    color: var(--fg-3);
    border: 1px solid var(--line);
}
.nt-stale-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}

/* Action cluster on the right side of the envelope chip row — keeps
   the Pin and Change buttons side-by-side with breathing room. */
.of-chip-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}

/* On narrow phones, the envelope chip's content row (eyebrow + name +
   meta) competes with the actions cluster (Pin + Change). Forcing the
   row to wrap drops the actions below the content so the "pinned" /
   "selected" meta — the whole signal of this row — never truncates. */
@media (max-width: 480px) {
    .of-chip-row { flex-wrap: wrap; row-gap: 8px; }
    .of-chip-row-content { flex-basis: 100%; }
    .of-chip-actions { margin-left: auto; }
}

/* Inline spinner that replaces the check glyph on the Save button while
   the mutation is pending. Sized to match the Check icon (size-3.5 ≈
   14px) so layout doesn't shift between idle and saving. */
.nt-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 999px;
    animation: nt-spin 600ms linear infinite;
}
@keyframes nt-spin {
    to { transform: rotate(360deg); }
}

/* AccountLabel styles moved to OrbitFormStyles (shared) so both
   NewTransactionSheet and EditTransactionSheet render the account
   select trigger as a single line. */


/* Override CategoryTreeSelect's shadcn outline-button trigger so it matches
   the editorial-dark Select look. The combobox role is unique to that comp. */
.orbit-design [role="combobox"] {
    height: 38px !important;
    border-radius: 10px !important;
    background: var(--bg-elev-1) !important;
    border-color: var(--line) !important;
    color: var(--fg) !important;
    font-weight: 400 !important;
    font-size: 13px !important;
    box-shadow: none !important;
    padding-left: 10px !important;
    padding-right: 10px !important;
}
.orbit-design [role="combobox"]:hover {
    background: var(--bg-elev-1) !important;
    border-color: var(--line-strong) !important;
}
.orbit-design [role="combobox"][data-state="open"] {
    border-color: var(--brand) !important;
    box-shadow: 0 0 0 3px var(--brand-soft) !important;
}

/* Envelope-draw chip (expense only) */
.nt-env-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 9px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid var(--line);
}
.nt-env-card {
    padding: 12px 14px;
    background: var(--bg-elev-2);
    border: 1px solid var(--line-soft);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.nt-env-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
}
.nt-env-card-meta {
    font-size: 11.5px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
}
.nt-env-warn {
    border-top: 1px dashed var(--line);
    padding-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.nt-env-warn-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
}
.nt-env-warn-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--expense);
    flex-shrink: 0;
    margin-top: 6px;
}
.nt-env-warn-head-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
}
.nt-env-warn-title {
    font-size: 13px;
    color: var(--fg);
    font-weight: 500;
    line-height: 1.35;
}
.nt-env-warn-sub {
    font-size: 11.5px;
    color: var(--fg-3);
}

.nt-source-warn {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    background: color-mix(in oklab, var(--expense) 7%, transparent);
    border: 1px solid color-mix(in oklab, var(--expense) 22%, transparent);
    border-radius: 10px;
}
.nt-source-warn-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--expense);
    flex-shrink: 0;
    margin-top: 6px;
}
.nt-source-warn-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
}
.nt-source-warn-title {
    font-size: 13px;
    color: var(--fg);
    font-weight: 500;
    line-height: 1.35;
}
.nt-source-warn-sub {
    font-size: 11.5px;
    color: var(--fg-3);
}

.nt-recover-card {
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: border-color 140ms ease;
}
.nt-recover-card:hover {
    border-color: var(--line-strong);
}
.nt-recover-card-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.nt-recover-card-title {
    font-size: 12.5px;
    color: var(--fg);
    font-weight: 500;
    line-height: 1.3;
}
.nt-recover-card-hint {
    font-size: 11px;
    color: var(--fg-4);
    line-height: 1.4;
}
.nt-recover-card-row {
    display: flex;
    align-items: stretch;
    gap: 8px;
    flex-wrap: wrap;
}
.nt-recover-card-row--end {
    justify-content: flex-end;
}
.nt-recover-select {
    flex: 1 1 180px;
    min-width: 0;
    height: 36px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font-size: 12.5px;
    padding: 0 10px;
    font-family: inherit;
    transition: border-color 140ms ease;
}
.nt-recover-select:focus {
    outline: none;
    border-color: var(--brand);
}
.nt-recover-btn {
    height: 36px;
    padding: 0 16px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg-elev-2);
    color: var(--fg);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: background 140ms ease, border-color 140ms ease;
    white-space: nowrap;
    flex-shrink: 0;
}
.nt-recover-btn:hover:not(:disabled) {
    background: var(--bg-elev-3);
    border-color: var(--line-strong);
}
.nt-recover-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
@media (max-width: 480px) {
    .nt-recover-card-row {
        flex-direction: column;
        align-items: stretch;
    }
    .nt-recover-card-row--end {
        align-items: stretch;
    }
}

/* Transfer swap circle */
.nt-swap {
    display: flex;
    justify-content: center;
    margin: -4px 0;
}
.nt-swap > span {
    width: 36px;
    height: 36px;
    border-radius: 99px;
    border: 1px solid var(--line);
    background: var(--bg-elev-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-2);
}

/* Drift card (adjustment) */
.nt-drift {
    background: var(--bg-elev-2);
    border: 1px solid var(--line-soft);
    border-radius: 14px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.nt-drift-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.nt-drift-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.nt-drift-eyebrow {
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 500;
}
.nt-drift-num {
    font-family: "Newsreader", Georgia, serif;
    font-size: 24px;
    line-height: 1;
    color: var(--fg);
    font-weight: 500;
    letter-spacing: -0.01em;
    display: flex;
    align-items: baseline;
    gap: 4px;
}
.nt-drift-actual-input {
    display: flex;
    align-items: baseline;
    gap: 4px;
    height: 34px;
    padding: 0 10px;
    border-radius: 10px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    transition: border-color 120ms ease, box-shadow 120ms ease;
}
.nt-drift-actual-input:focus-within {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-soft);
}
.nt-drift-actual-input > input {
    flex: 1; min-width: 0; height: 100%;
    border: 0; outline: 0; background: transparent;
    font-family: "Newsreader", Georgia, serif;
    font-size: 22px; color: var(--fg); font-weight: 500;
    padding: 0;
}
.nt-drift-actual-input > input::-webkit-outer-spin-button,
.nt-drift-actual-input > input::-webkit-inner-spin-button {
    -webkit-appearance: none; margin: 0;
}
.nt-drift-actual-input > input { -moz-appearance: textfield; }
.nt-drift-foot { font-size: 10.5px; color: var(--fg-4); }
.nt-drift-divider { height: 1px; background: var(--line-soft); }
.nt-drift-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.nt-drift-summary-label { font-size: 11px; color: var(--fg-3); }
.nt-drift-summary-num {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-family: "Newsreader", Georgia, serif;
    font-size: 26px;
    line-height: 1;
    font-weight: 500;
    letter-spacing: -0.01em;
}
.nt-drift-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 500;
}
.nt-drift-chip > .dot { width: 5px; height: 5px; border-radius: 99px; }

/* Footer buttons */
.nt-btn {
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
    transition: background 140ms ease, border-color 140ms ease, filter 140ms ease;
}
.nt-btn:hover:not(:disabled):not(.nt-btn-primary) {
    background: var(--bg-elev-2);
    border-color: var(--line-strong);
}
.nt-btn-primary {
    background: var(--brand);
    color: var(--brand-fg);
    border-color: oklch(78% 0.14 165);
}
.nt-btn-primary:hover:not(:disabled) {
    filter: brightness(1.05);
}

/* Scope FileUploadField inside the drawer to look at home */
.orbit-design .nt-form label.text-sm,
.orbit-design .nt-form .text-sm.font-medium {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--fg-2);
    letter-spacing: 0.02em;
}

/* Phone (<640px): tighter tabs, drawer ergonomics. */
@media (max-width: 640px) {
    .nt-tabs { padding: 3px; gap: 3px; }
    .nt-tab { height: 30px; font-size: 11.5px; gap: 5px; padding: 0 6px; }
    .nt-form { gap: 14px; margin-top: 12px; }
    /* Footer buttons fill the row on phone for big tap targets. */
    .nt-btn { flex: 1 1 auto; justify-content: center; height: 40px; }
}

/* Phone (<480px): single-column drift grid + smaller amount input. */
@media (max-width: 480px) {
    .nt-tab { font-size: 11px; gap: 4px; padding: 0 4px; }
    /* Hide the tab text label, keep the icon, when the screen can't fit
       all four labels comfortably. The lucide icon alone communicates
       expense / income / transfer / adjust. */
    .nt-tab svg { width: 14px; height: 14px; }
    .nt-drift-grid { grid-template-columns: 1fr; gap: 12px; }
    .nt-drift { padding: 14px; }
    .nt-drift-num { font-size: 20px; }
    .nt-drift-summary-num { font-size: 22px; }
}

@media (max-width: 360px) {
    /* On the smallest phones, the four-up tab bar packs into icon-only
       buttons so the drawer header doesn't clip the last tab. */
    .nt-tab {
        gap: 0;
        padding: 0 4px;
        font-size: 0;
    }
    .nt-tab svg { font-size: initial; width: 15px; height: 15px; }
}
`;

function defaultDateTime(): string {
    const d = new Date();
    d.setSeconds(0, 0);
    return toInputDateTime(d);
}

/**
 * Decides which pin state to render for a field and dispatches to
 * `pinState`. Hidden when there's nothing to pin (no current value AND
 * no existing pin). Disabled — but still rendered — when the caller
 * doesn't have permission to mutate the pin (e.g. viewer setting a
 * space-wide pin). When the current form value matches the existing
 * pin, the control reads as "Pinned" and clicking unpins.
 */
function FieldPin({
    field,
    currentValue,
    pinValue,
    canPin,
    available,
    onPin,
    onClear,
}: {
    field: PinField;
    currentValue: string;
    pinValue: string | null;
    canPin: boolean;
    /** False on /s/me where pins don't apply — hides the control entirely. */
    available?: boolean;
    onPin: () => void;
    onClear: () => void;
}) {
    void field;
    if (available === false) return null;
    const hasValue = currentValue.length > 0;
    /* Three observable states. Label ↔ action MUST match:
     *   pinned  → label "Pinned",  click unpins.
     *   pinnable→ label "Pin",     click pins the current value.
     *   hidden  → nothing rendered.
     *
     * Important edge: if a pin exists but the user has explicitly
     * cleared the field for this entry (e.g. picked "No event" with
     * an event pinned), we *hide* the control. The previous shape
     * showed "Pinned" while the field read "No event" — visually
     * confusing, and clicking would have silently destroyed the team
     * pin from a form state that doesn't even use it. Users can still
     * unpin from any transaction where they pick the pinned value.
     */
    if (pinValue != null && !hasValue) return null;
    const isPinned = pinValue != null && pinValue === currentValue;
    const state: "pinned" | "pinnable" | "hidden" = isPinned
        ? "pinned"
        : hasValue
          ? "pinnable"
          : "hidden";
    return (
        <PinControl
            state={state}
            disabled={!canPin}
            onClick={() => {
                if (isPinned) onClear();
                else if (hasValue) onPin();
            }}
        />
    );
}

/** Render an OrbitSelect of events for the current space, including a
 *  "None" item. Returns null until events are loaded. `pinSlot` is
 *  rendered in the field's hint row when provided. */
function EventSelect({
    spaceId,
    value,
    onChange,
    pinSlot,
}: {
    spaceId: string;
    value: string;
    onChange: (v: string) => void;
    pinSlot?: ReactNode;
}) {
    const eventsQuery = trpc.event.listBySpace.useQuery({ spaceId });
    if (!eventsQuery.data) return null;
    const activeEvents = eventsQuery.data.filter((ev) => ev.status === "active");
    /* If `value` is already set (typically hydrated from an event pin)
       but the event is no longer active, surface it as a stale row so
       the user can clear it. Without this branch the dropdown would
       unmount and the form would submit a closed event id with no UI
       to fix it. */
    const valueEvent = value ? eventsQuery.data.find((ev) => ev.id === value) : null;
    const isStaleValue = !!valueEvent && valueEvent.status !== "active";
    if (activeEvents.length === 0 && !value) return null;
    const items: OrbitSelectItem[] = [
        { value: "__none", label: "No event" },
        ...activeEvents.map((ev) => ({
            value: ev.id,
            label: ev.name,
            leadIcon: <Calendar className="size-3.5" />,
            leadColor: "var(--ent-5)",
        })),
    ];
    if (isStaleValue) {
        /* Inject the stale value's id at the top so the OrbitSelect can
           render its label. The Closed badge sits inside the label as a
           non-truncatable element so the staleness signal survives even
           when the event name itself ellipses on narrow mobile. Keep
           the calendar lead pill in `--ent-5` so it still reads as an
           event row rather than a placeholder. */
        items.splice(1, 0, {
            value: valueEvent.id,
            label: (
                <span className="nt-stale-row">
                    {/* Screen-reader prefix — the visual badge below
                        only reads as "Closed" in isolation, which is
                        ambiguous in flat dropdown enumeration. */}
                    <span className="sr-only">Closed event: </span>
                    <span className="nt-stale-badge" aria-hidden>
                        Closed
                    </span>
                    <span className="nt-stale-name">{valueEvent.name}</span>
                </span>
            ),
            leadIcon: <Calendar className="size-3.5" />,
            leadColor: "var(--ent-5)",
        });
    }
    return (
        <OrbitField
            label="Link to event"
            /* The pin button inside the hint is its own interactive
               element — switch the wrapper to a non-label so semantics
               match the Account/Source fields above. */
            interactiveHint={!!pinSlot}
            hint={
                pinSlot ? (
                    <span className="nt-hint-row">
                        <span>Optional · groups related transactions</span>
                        {pinSlot}
                    </span>
                ) : (
                    "Optional · groups related transactions"
                )
            }
        >
            <OrbitSelect
                value={value || "__none"}
                onValueChange={(v) => onChange(v === "__none" ? "" : v)}
                items={items}
                placeholder="No event"
            />
        </OrbitField>
    );
}

/** Rich status card under the category dropdown — shows the envelope's
 *  current period spent/planned/remaining, and if this transaction would
 *  push it negative, offers to pull cover from another envelope. The
 *  transaction can also be saved as overspend (the warning is
 *  informational, not a block). */
function EnvelopeStatusCard({
    spaceId,
    envelopeId,
    envelopes,
    pendingAmount,
}: {
    spaceId: string;
    envelopeId: string | null;
    envelopes: Envelop[];
    pendingAmount: number;
}) {
    const env = envelopeId ? envelopes.find((e) => e.id === envelopeId) : null;

    // APP_TZ month window so the envelope's spent/remaining and the
    // overspend warning reflect the right month for users in any browser
    // timezone (native getFullYear/getMonth would drift near the boundary).
    const periodStart = useMemo(() => startOfMonth(new Date()), []);
    const periodEnd = useMemo(() => endOfMonth(new Date()), []);

    const utilizationQuery = trpc.analytics.envelopeUtilization.useQuery(
        { spaceId, periodStart, periodEnd },
        { enabled: !!envelopeId }
    );

    const utils = trpc.useUtils();
    const pullIdem = useIdempotencyKey();
    const transferMutation = trpc.allocation.transfer.useMutation({
        onSuccess: async () => {
            toast.success("Pulled funds");
            pullIdem.rotate();
            await Promise.all([
                utils.envelop.allocationListBySpace.invalidate({ spaceId }),
                utils.analytics.envelopeUtilization.invalidate({ spaceId }),
                utils.analytics.spaceSummary.invalidate(),
            ]);
        },
        onError: (e) => toast.error(e.message),
    });
    const [pullSourceId, setPullSourceId] = useState<string>("");

    if (!env) return null;

    const color = env.color || "var(--ent-2)";
    const Icon = getIcon(env.icon ?? null);

    const utilRow = utilizationQuery.data?.find((u) => u.envelopId === env.id);
    const allocated = utilRow ? utilRow.allocated : 0;
    const consumed = utilRow?.consumed ?? 0;
    const remaining = utilRow?.remaining ?? 0;

    const overBy = pendingAmount > remaining ? pendingAmount - remaining : 0;
    const willOverspend = overBy > 0 && pendingAmount > 0;

    // Other envelopes with positive remaining — sources for the "Pull"
    // picker. Skip archived envelopes; they won't accept allocation
    // changes via transfer either way.
    const pullCandidates = (utilizationQuery.data ?? []).filter(
        (u) => u.envelopId !== env.id && u.remaining > 0 && !u.archived
    );

    return (
        <div className="nt-env-card">
            <div className="nt-env-card-head">
                <span
                    className="nt-env-chip"
                    style={{
                        background: `color-mix(in oklab, ${color} 12%, transparent)`,
                        borderColor: `color-mix(in oklab, ${color} 30%, transparent)`,
                        color,
                    }}
                >
                    <Icon className="size-3" />
                    {env.name}
                </span>
                <span className="nt-env-card-meta">
                    Spent {consumed.toFixed(2)} of {allocated.toFixed(2)}
                    {" · "}
                    <strong
                        style={{
                            color: remaining < 0 ? "var(--expense)" : "var(--fg)",
                        }}
                    >
                        {remaining.toFixed(2)} left
                    </strong>
                </span>
            </div>

            {willOverspend && (
                <div className="nt-env-warn">
                    <div className="nt-env-warn-head">
                        <span className="nt-env-warn-dot" />
                        <div className="nt-env-warn-head-text">
                            <span className="nt-env-warn-title">
                                Will overspend {env.name} by{" "}
                                <span className="tabular">{overBy.toFixed(2)}</span>
                            </span>
                            <span className="nt-env-warn-sub">
                                {pullCandidates.length > 0
                                    ? "Save as-is, or pull cover from another envelope:"
                                    : "Save as-is — no other envelope has budget to pull from."}
                            </span>
                        </div>
                    </div>

                    {pullCandidates.length > 0 && (
                        <div className="nt-recover-card">
                            <div className="nt-recover-card-head">
                                <span className="nt-recover-card-title">
                                    Pull from another envelope
                                </span>
                                <span className="nt-recover-card-hint">
                                    Move {overBy.toFixed(2)} of budget from another bucket into{" "}
                                    {env.name}.
                                </span>
                            </div>
                            <div className="nt-recover-card-row">
                                <select
                                    className="nt-recover-select"
                                    value={pullSourceId}
                                    onChange={(e) => setPullSourceId(e.target.value)}
                                >
                                    <option value="">Choose source envelope…</option>
                                    {pullCandidates.map((c) => (
                                        <option key={c.envelopId} value={c.envelopId}>
                                            {c.name} · {c.remaining.toFixed(2)} left
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    className="nt-recover-btn"
                                    disabled={!pullSourceId || transferMutation.isPending}
                                    onClick={() =>
                                        transferMutation.mutate({
                                            amount: overBy,
                                            from: {
                                                envelopId: pullSourceId,
                                            },
                                            to: {
                                                envelopId: env.id,
                                            },
                                            idempotencyKey: pullIdem.key,
                                        })
                                    }
                                >
                                    {transferMutation.isPending
                                        ? "Pulling…"
                                        : `Pull ${overBy.toFixed(2)}`}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/** Inline overspend hint that sits under the source-account picker.
 *  Mirrors the envelope-overspend warning: informational, never blocking.
 *  Suppressed for liability accounts — those naturally go more negative
 *  to mean "more owed" and the running balance display already says so. */
export function SourceOverspendHint({
    account,
    additionalDebit,
}: {
    account: SpaceAccount | undefined;
    additionalDebit: number;
}) {
    if (!account) return null;
    if (account.account_type === "liability") return null;
    if (!(additionalDebit > 0)) return null;
    const resulting = account.balance - additionalDebit;
    if (resulting >= 0) return null;
    return (
        <div className="nt-source-warn" role="status">
            <span className="nt-source-warn-dot" />
            <div className="nt-source-warn-text">
                <span className="nt-source-warn-title">
                    Heads up — this will take <strong>{account.name}</strong> to{" "}
                    <span className="tabular">{resulting.toFixed(2)}</span>.
                </span>
                <span className="nt-source-warn-sub">Save anyway, or pick a different source.</span>
            </div>
        </div>
    );
}

/* ============================================================
   INCOME FORM
   ============================================================ */
function IncomeForm({
    onDone,
    onPendingChange,
}: {
    onDone: () => void;
    onPendingChange: (pending: boolean) => void;
}) {
    const spaceId = useCurrentSpaceId();
    const canEdit = useCanEdit();
    const accountsQuery = trpc.account.listBySpace.useQuery({ spaceId });
    const invalidate = useInvalidateAnalytics();
    const pinState = usePins(spaceId);
    const optimistic = useOptimisticTransactionCache();
    const { authStore } = useStore();

    const lastAccountKey = `orbit:last-account:${spaceId}:income`;
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [datetime, setDatetime] = useState(defaultDateTime());
    const [accountId, setAccountId] = useState<string>(() => {
        if (pinState.pins?.account) return pinState.pins.account.id;
        if (typeof window === "undefined") return "";
        return window.localStorage.getItem(lastAccountKey) ?? "";
    });
    const [eventId, setEventId] = useState<string>(() => pinState.pins?.event?.id ?? "");
    const [attachmentFileIds, setAttachmentFileIds] = useState<string[]>([]);

    /* Hydrate from pins once after they load. Pin supersedes the
       lastAccountKey fallback; if there is no pin, the previously-loaded
       localStorage value stays. Guarded by a ref so user-initiated
       pin/unpin clicks inside the form don't trigger re-hydration.
       The initializers above already seed both fields synchronously when
       pinState.pins is warm in cache (the common case on every remount
       after the sheet's first open) — this effect is only the fallback
       for a cold cache, where the pins query is still in flight when
       these fields first mount. Seeding synchronously instead of via a
       post-mount effect matters for eventId specifically: a controlled
       Radix Select whose value changes right after mount (before the
       user has ever opened it) can fire a spurious onValueChange(""),
       which silently wiped the event pin's hydration on every "Save &
       add another" cycle. */
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (hydratedRef.current) return;
        if (!pinState.pins) return;
        hydratedRef.current = true;
        if (pinState.pins.account) setAccountId(pinState.pins.account.id);
        if (pinState.pins.event) setEventId(pinState.pins.event.id);
    }, [pinState.pins]);

    const accountItems = useMemo(
        () => (accountsQuery.data ?? []).map(toAccountItem),
        [accountsQuery.data]
    );

    useEffect(() => {
        if (!accountId) return;
        if (accountItems.length === 0) return;
        if (!accountItems.some((i) => i.value === accountId)) {
            setAccountId("");
        }
    }, [accountId, accountItems]);

    const showMoreKey = `orbit:nt-income-show-more:${spaceId}`;
    const [showMore, setShowMore] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        return window.localStorage.getItem(showMoreKey) === "1";
    });
    useEffect(() => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(showMoreKey, showMore ? "1" : "0");
    }, [showMore, showMoreKey]);
    const optionalFieldsHaveContent = eventId.length > 0 || attachmentFileIds.length > 0;
    useEffect(() => {
        if (optionalFieldsHaveContent && !showMore) setShowMore(true);
    }, [optionalFieldsHaveContent, showMore]);

    const idem = useIdempotencyKey();
    const mutate = trpc.transaction.income.useMutation({
        onMutate: async (variables) => {
            await optimistic.cancelBoth();
            const tempId = variables.idempotencyKey ?? idem.key;
            const delta = computeDelta("income", variables.amount);
            const row: OptimisticTxRow = {
                id: tempId,
                space_id: variables.spaceId,
                created_by: authStore.user?.id ?? "",
                type: "income",
                amount: String(variables.amount),
                source_account_id: null,
                destination_account_id: variables.accountId,
                description: variables.description ?? null,
                location: null,
                transaction_datetime: (variables.datetime ?? new Date()).toISOString(),
                created_at: new Date().toISOString(),
                expense_category_id: null,
                envelop_id: null,
                event_id: variables.eventId ?? null,
                parent_transfer_id: null,
                created_by_first_name: authStore.user?.name?.split(" ")[0] ?? null,
                created_by_last_name: authStore.user?.name?.split(" ").slice(1).join(" ") || null,
                created_by_avatar_file_id: authStore.user?.avatarFileId ?? null,
                account_balances_after: {},
                __pending: true,
            };
            optimistic.addPendingRow(row);
            optimistic.applyDelta(delta);
            return { tempId, delta };
        },
        onSuccess: async () => {
            toast.success("Income recorded");
            if (typeof window !== "undefined" && accountId) {
                window.localStorage.setItem(lastAccountKey, accountId);
            }
            await invalidate(spaceId);
        },
        onError: async (e, variables, ctx) => {
            if (ctx) {
                optimistic.removePendingRow(ctx.tempId);
                optimistic.reverseDelta(ctx.delta);
                // A sibling "Save & add another" submission may have already
                // invalidated filteredTotals to server truth (which never
                // included this failed row) before this reverseDelta runs —
                // blind arithmetic reversal would then undercount. Resync to
                // truth rather than trust the local subtraction.
                await invalidate(spaceId);
            }
            toast.error(`Income of ${variables.amount} didn't save — ${e.message}`, {
                duration: Infinity,
            });
        },
    });
    useEffect(() => {
        onPendingChange(mutate.isPending);
    }, [mutate.isPending, onPendingChange]);

    return (
        <form
            id="nt-form"
            className="nt-form"
            onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (mutate.isPending) return;
                if (!accountId) {
                    toast.error("Pick an account");
                    return;
                }
                if (!(Number(amount) > 0)) {
                    toast.error("Enter an amount");
                    return;
                }
                mutate.mutate({
                    spaceId,
                    accountId,
                    amount: Number(amount),
                    datetime: fromInputDateTime(datetime),
                    description: description || undefined,
                    eventId: eventId || undefined,
                    attachmentFileIds: attachmentFileIds.length > 0 ? attachmentFileIds : undefined,
                    idempotencyKey: idem.key,
                });
                idem.rotate();
                onDone();
            }}
        >
            <OrbitAmountCard value={amount} onChange={setAmount} tone="income" autoFocus />

            <OrbitFieldRow>
                <OrbitField label="Date">
                    <TransactionDatePicker value={datetime} onChange={setDatetime} />
                </OrbitField>
                <OrbitField
                    label="Account"
                    required
                    interactiveHint
                    hint={
                        <FieldPin
                            field="account"
                            currentValue={accountId}
                            pinValue={pinState.pins?.account?.id ?? null}
                            available={!pinState.isPersonal}
                            canPin={true}
                            onPin={() => pinState.pinAccount(accountId)}
                            onClear={() => pinState.clearPin("account")}
                        />
                    }
                >
                    <OrbitSelect
                        value={accountId}
                        onValueChange={setAccountId}
                        items={accountItems}
                        placeholder="Choose account"
                        leadIcon={<Wallet className="size-3.5" />}
                        leadColor="var(--ent-1)"
                    />
                </OrbitField>
            </OrbitFieldRow>

            <OrbitField label="Source / Payer" hint="Optional">
                <OrbitInput
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Acme Corp · Salary"
                />
            </OrbitField>

            <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="of-disclosure-toggle"
            >
                <span>{showMore ? "Hide event or receipt" : "Add event or receipt"}</span>
                {showMore ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>

            {showMore && (
                <>
                    <EventSelect
                        spaceId={spaceId}
                        value={eventId}
                        onChange={setEventId}
                        pinSlot={
                            <FieldPin
                                field="event"
                                currentValue={eventId}
                                pinValue={pinState.pins?.event?.id ?? null}
                                available={!pinState.isPersonal}
                                canPin={canEdit}
                                onPin={() => pinState.pinEvent(eventId)}
                                onClear={() => pinState.clearPin("event")}
                            />
                        }
                    />

                    <OrbitField label="Receipts" hint="Optional · PNG · JPG · PDF">
                        <FileUploadField
                            purpose="transaction_receipt"
                            fileIds={attachmentFileIds}
                            onChange={setAttachmentFileIds}
                            label=""
                        />
                    </OrbitField>
                </>
            )}
        </form>
    );
}

/* ============================================================
   EXPENSE FORM
   ============================================================ */
function ExpenseForm({
    onDone,
    onPendingChange,
}: {
    onDone: () => void;
    onPendingChange: (pending: boolean) => void;
}) {
    const spaceId = useCurrentSpaceId();
    const canEdit = useCanEdit();
    const accountsQuery = trpc.account.listBySpace.useQuery({ spaceId });
    const categoriesQuery = trpc.expenseCategory.listBySpace.useQuery({ spaceId });
    const envelopesQuery = trpc.envelop.listBySpace.useQuery({ spaceId });
    const invalidate = useInvalidateAnalytics();
    const pinState = usePins(spaceId);
    const optimistic = useOptimisticTransactionCache();
    const { authStore } = useStore();

    // Remember the user's last-used source account per space so the
    // form doesn't make them re-pick the same account every time. The
    // value is validated against the available accountItems below;
    // stale IDs (deleted/archived) silently fall back to empty.
    const lastAccountKey = `orbit:last-account:${spaceId}:expense`;
    const [amount, setAmount] = useState("");
    const [datetime, setDatetime] = useState(defaultDateTime());
    const [sourceAccountId, setSource] = useState<string>(() => {
        if (pinState.pins?.account) return pinState.pins.account.id;
        if (typeof window === "undefined") return "";
        return window.localStorage.getItem(lastAccountKey) ?? "";
    });
    const [categoryId, setCategoryId] = useState<string | null>(null);
    const [envelopeId, setEnvelopeId] = useState<string>(() => pinState.pins?.envelop?.id ?? "");
    const [envelopePickerOpen, setEnvelopePickerOpen] = useState(false);
    const [eventId, setEventId] = useState<string>(() => pinState.pins?.event?.id ?? "");
    const [attachmentFileIds, setAttachmentFileIds] = useState<string[]>([]);

    // Optional fields (event/receipts) collapse behind one disclosure so
    // the default form weight matches the user's real decisions. Persist
    // open/closed per space so a user who always attaches receipts
    // doesn't pay the expand-cost each time.
    const showMoreKey = `orbit:nt-expense-show-more:${spaceId}`;
    const [showMore, setShowMore] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        return window.localStorage.getItem(showMoreKey) === "1";
    });
    useEffect(() => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(showMoreKey, showMore ? "1" : "0");
    }, [showMore, showMoreKey]);
    // Auto-open if any optional field has content so users never lose
    // visibility into data they've entered.
    const optionalFieldsHaveContent = eventId.length > 0 || attachmentFileIds.length > 0;
    useEffect(() => {
        if (optionalFieldsHaveContent && !showMore) setShowMore(true);
    }, [optionalFieldsHaveContent, showMore]);

    const accountItems = useMemo(
        () =>
            (accountsQuery.data ?? [])
                .filter((a) => a.account_type !== "locked")
                .filter(ownedByMe)
                .map(toAccountItem),
        [accountsQuery.data]
    );

    // Validate the pre-filled last-account against currently available
    // items once the accounts query resolves. If the saved ID is stale,
    // reset to empty so the placeholder shows.
    useEffect(() => {
        if (!sourceAccountId) return;
        if (accountItems.length === 0) return;
        if (!accountItems.some((i) => i.value === sourceAccountId)) {
            setSource("");
        }
    }, [sourceAccountId, accountItems]);

    // Categories are pure labels (migration 050 dropped their envelope
    // link) — every category is always selectable.
    const activeCategories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

    const envelopeItems: OrbitSelectItem[] = useMemo(
        () =>
            (envelopesQuery.data ?? [])
                .filter((e) => !e.archived)
                .map((e) => ({
                    value: e.id,
                    label: e.name,
                    leadIcon: <Layers className="size-3.5" />,
                    leadColor: e.color || "var(--ent-2)",
                })),
        [envelopesQuery.data]
    );

    // Categories are pure labels (migration 050) — no envelope auto-fill.
    // The envelope comes from the pin, the previous pick, or an explicit
    // choice. While it's EMPTY the row renders as a labeled, required
    // picker (never the collapsed chip), so the field can't be missed.
    const envelopePinnedAndActive =
        pinState.pins?.envelop?.id != null && pinState.pins.envelop.id === envelopeId;

    /* Hydrate pinned values once. The initializers above already seed
       account/envelope/event synchronously from pinState.pins when the
       pins query is warm in cache (e.g. every remount after the sheet's
       first open) — that's the common case, and it avoids ever mounting
       EventSelect's Radix Select with an empty value that gets corrected
       a moment later: a controlled Radix Select whose value changes
       right after mount (before the user has ever opened it) can fire a
       spurious onValueChange("") itself, which silently wiped the event
       pin's hydration on every "Save & add another" cycle. This effect
       is now only the fallback for a cold cache (the very first open
       after a page load), where the pins query is still in flight when
       these fields first mount. */
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (hydratedRef.current) return;
        if (!pinState.pins) return;
        hydratedRef.current = true;
        if (pinState.pins.account) setSource(pinState.pins.account.id);
        if (pinState.pins.envelop) setEnvelopeId(pinState.pins.envelop.id);
        if (pinState.pins.event) setEventId(pinState.pins.event.id);
    }, [pinState.pins]);

    const selectedEnvelope = useMemo(
        () => (envelopeId ? (envelopesQuery.data ?? []).find((e) => e.id === envelopeId) : null),
        [envelopeId, envelopesQuery.data]
    );
    const idem = useIdempotencyKey();
    const mutate = trpc.transaction.expense.useMutation({
        onMutate: async (variables) => {
            await optimistic.cancelBoth();
            const tempId = variables.idempotencyKey ?? idem.key;
            const delta = computeDelta("expense", variables.amount);
            const row: OptimisticTxRow = {
                id: tempId,
                space_id: variables.spaceId,
                created_by: authStore.user?.id ?? "",
                type: "expense",
                amount: String(variables.amount),
                source_account_id: variables.sourceAccountId,
                destination_account_id: null,
                description: null,
                location: null,
                transaction_datetime: (variables.datetime ?? new Date()).toISOString(),
                created_at: new Date().toISOString(),
                expense_category_id: variables.expense_category_id,
                envelop_id: variables.envelopId,
                event_id: variables.eventId ?? null,
                parent_transfer_id: null,
                created_by_first_name: authStore.user?.name?.split(" ")[0] ?? null,
                created_by_last_name: authStore.user?.name?.split(" ").slice(1).join(" ") || null,
                created_by_avatar_file_id: authStore.user?.avatarFileId ?? null,
                account_balances_after: {},
                __pending: true,
            };
            optimistic.addPendingRow(row);
            optimistic.applyDelta(delta);
            return { tempId, delta };
        },
        onSuccess: async () => {
            toast.success("Expense recorded");
            // Remember this source account so the next expense entry
            // pre-fills with the same choice.
            if (typeof window !== "undefined" && sourceAccountId) {
                window.localStorage.setItem(lastAccountKey, sourceAccountId);
            }
            await invalidate(spaceId);
        },
        onError: async (e, variables, ctx) => {
            if (ctx) {
                optimistic.removePendingRow(ctx.tempId);
                optimistic.reverseDelta(ctx.delta);
                // See IncomeForm's onError for why: a sibling submission's
                // invalidate() may have already reset totals to server
                // truth that never included this failed row.
                await invalidate(spaceId);
            }
            toast.error(`Expense of ${variables.amount} didn't save — ${e.message}`, {
                duration: Infinity,
            });
        },
    });
    useEffect(() => {
        onPendingChange(mutate.isPending);
    }, [mutate.isPending, onPendingChange]);

    return (
        <form
            id="nt-form"
            className="nt-form"
            onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (mutate.isPending) return;
                if (!sourceAccountId || !categoryId) {
                    toast.error("Pick an account and category");
                    return;
                }
                if (!envelopeId) {
                    toast.error("Pick an envelope");
                    return;
                }
                if (!(Number(amount) > 0)) {
                    toast.error("Enter an amount");
                    return;
                }
                mutate.mutate({
                    spaceId,
                    sourceAccountId,
                    expense_category_id: categoryId,
                    envelopId: envelopeId,
                    amount: Number(amount),
                    datetime: fromInputDateTime(datetime),
                    eventId: eventId || undefined,
                    attachmentFileIds: attachmentFileIds.length > 0 ? attachmentFileIds : undefined,
                    idempotencyKey: idem.key,
                });
                idem.rotate();
                onDone();
            }}
        >
            <OrbitAmountCard value={amount} onChange={setAmount} tone="fg" autoFocus />

            <OrbitField label="Category" required>
                <CategoryTreeSelect
                    categories={activeCategories}
                    value={categoryId}
                    onChange={setCategoryId}
                    placeholder="Choose category"
                    allowAll={false}
                />
            </OrbitField>

            {/* Empty envelope NEVER collapses to the chip — a required field
                must not read as "selected —". The picker stays mounted (with
                label + asterisk) until a real envelope exists. */}
            {(categoryId || envelopeId) &&
                (envelopePickerOpen || !envelopeId ? (
                    <OrbitField label="Envelope" required>
                        <div className="of-inline-picker-row">
                            <OrbitSelect
                                value={envelopeId}
                                onValueChange={(v) => {
                                    setEnvelopeId(v);
                                    setEnvelopePickerOpen(false);
                                }}
                                items={envelopeItems}
                                placeholder="Choose envelope"
                                leadIcon={<Layers className="size-3.5" />}
                                leadColor="var(--ent-2)"
                            />
                            {envelopeId && (
                                <button
                                    type="button"
                                    className="of-chip-btn"
                                    onClick={() => setEnvelopePickerOpen(false)}
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </OrbitField>
                ) : (
                    <div className="of-chip-row">
                        <div className="of-chip-row-content">
                            <span className="of-chip-eyebrow">Envelope</span>
                            <span
                                className="of-chip-dot"
                                style={{
                                    backgroundColor: selectedEnvelope?.color || "var(--ent-2)",
                                }}
                            />
                            <span className="of-chip-name">{selectedEnvelope?.name ?? "—"}</span>
                            <span className="of-chip-meta">
                                · {envelopePinnedAndActive ? "pinned" : "selected"}
                            </span>
                        </div>
                        <div className="of-chip-actions">
                            <FieldPin
                                field="envelop"
                                currentValue={envelopeId}
                                pinValue={pinState.pins?.envelop?.id ?? null}
                                available={!pinState.isPersonal}
                                canPin={canEdit}
                                onPin={() => pinState.pinEnvelop(envelopeId)}
                                onClear={() => pinState.clearPin("envelop")}
                            />
                            <button
                                type="button"
                                className="of-chip-btn"
                                onClick={() => setEnvelopePickerOpen(true)}
                            >
                                Change
                            </button>
                        </div>
                    </div>
                ))}

            <EnvelopeStatusCard
                spaceId={spaceId}
                envelopeId={envelopeId || null}
                envelopes={(envelopesQuery.data ?? []) as Envelop[]}
                pendingAmount={Number(amount) || 0}
            />

            <OrbitFieldRow>
                <OrbitField label="Date">
                    <TransactionDatePicker value={datetime} onChange={setDatetime} />
                </OrbitField>
                <OrbitField
                    label="Account"
                    required
                    interactiveHint
                    hint={
                        <FieldPin
                            field="account"
                            currentValue={sourceAccountId}
                            pinValue={pinState.pins?.account?.id ?? null}
                            available={!pinState.isPersonal}
                            canPin={true}
                            onPin={() => pinState.pinAccount(sourceAccountId)}
                            onClear={() => pinState.clearPin("account")}
                        />
                    }
                >
                    <OrbitSelect
                        value={sourceAccountId}
                        onValueChange={setSource}
                        items={accountItems}
                        placeholder="Choose account"
                        leadIcon={<Wallet className="size-3.5" />}
                        leadColor="var(--ent-1)"
                    />
                </OrbitField>
            </OrbitFieldRow>

            <SourceOverspendHint
                account={(accountsQuery.data ?? []).find((a) => a.id === sourceAccountId)}
                additionalDebit={Number(amount) || 0}
            />

            <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="of-disclosure-toggle"
            >
                <span>{showMore ? "Hide event or receipt" : "Add event or receipt"}</span>
                {showMore ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>

            {showMore && (
                <>
                    <EventSelect
                        spaceId={spaceId}
                        value={eventId}
                        onChange={setEventId}
                        pinSlot={
                            <FieldPin
                                field="event"
                                currentValue={eventId}
                                pinValue={pinState.pins?.event?.id ?? null}
                                available={!pinState.isPersonal}
                                canPin={canEdit}
                                onPin={() => pinState.pinEvent(eventId)}
                                onClear={() => pinState.clearPin("event")}
                            />
                        }
                    />

                    <OrbitField label="Receipts" hint="Optional · PNG · JPG · PDF">
                        <FileUploadField
                            purpose="transaction_receipt"
                            fileIds={attachmentFileIds}
                            onChange={setAttachmentFileIds}
                            label=""
                        />
                    </OrbitField>
                </>
            )}
        </form>
    );
}

/* ============================================================
   TRANSFER FORM
   ============================================================ */
function TransferForm({
    onDone,
    onPendingChange,
}: {
    onDone: () => void;
    onPendingChange: (pending: boolean) => void;
}) {
    const spaceId = useCurrentSpaceId();
    const canEdit = useCanEdit();
    const accountsQuery = trpc.account.listBySpace.useQuery({ spaceId });
    const categoriesQuery = trpc.expenseCategory.listBySpace.useQuery({ spaceId });
    const envelopesQuery = trpc.envelop.listBySpace.useQuery({ spaceId });
    const invalidate = useInvalidateAnalytics();
    const pinState = usePins(spaceId);
    const optimistic = useOptimisticTransactionCache();
    const { authStore } = useStore();

    /* Categories are pure labels (migration 050) — the fee's envelope is
       picked explicitly below, like any other expense. */
    const feeEnvelopeItems: OrbitSelectItem[] = useMemo(
        () =>
            (envelopesQuery.data ?? [])
                .filter((e) => !e.archived)
                .map((e) => ({
                    value: e.id,
                    label: e.name,
                    leadIcon: <Layers className="size-3.5" />,
                    leadColor: e.color || "var(--ent-2)",
                })),
        [envelopesQuery.data]
    );

    const lastSourceKey = `orbit:last-account:${spaceId}:transfer-source`;
    const [amount, setAmount] = useState("");
    const [datetime, setDatetime] = useState(defaultDateTime());
    const [sourceAccountId, setSource] = useState<string>(() => {
        if (pinState.pins?.account) return pinState.pins.account.id;
        if (typeof window === "undefined") return "";
        return window.localStorage.getItem(lastSourceKey) ?? "";
    });
    const [destinationAccountId, setDest] = useState("");
    const [eventId, setEventId] = useState<string>(() => pinState.pins?.event?.id ?? "");
    const [attachmentFileIds, setAttachmentFileIds] = useState<string[]>([]);
    // Optional fee that banks / ATMs / FX providers skim off the top.
    // When enabled, the source is debited `amount + fee` while the
    // destination still receives `amount`. The fee shows up in every
    // analytics view via its category — see project-spec §11.6.
    const [feeEnabled, setFeeEnabled] = useState(false);
    const [feeAmount, setFeeAmount] = useState("");
    const [feeCategoryId, setFeeCategoryId] = useState<string | null>(null);
    const [feeEnvelopeId, setFeeEnvelopeId] = useState("");

    const sourceItems = useMemo(
        () =>
            (accountsQuery.data ?? [])
                .filter((a) => a.account_type !== "locked")
                .filter(ownedByMe)
                .map(toAccountItem),
        [accountsQuery.data]
    );

    const destItems = useMemo(
        () => (accountsQuery.data ?? []).filter((a) => a.id !== sourceAccountId).map(toAccountItem),
        [accountsQuery.data, sourceAccountId]
    );

    useEffect(() => {
        if (!sourceAccountId) return;
        if (sourceItems.length === 0) return;
        if (!sourceItems.some((i) => i.value === sourceAccountId)) {
            setSource("");
        }
    }, [sourceAccountId, sourceItems]);

    /* Pin the SOURCE account for transfers — the destination is
       intentionally not pin-hydrated. Pinning a destination would be
       weird (the user is usually transferring TO different accounts),
       and pinning both could conflict (source==dest is invalid).
       The initializers above already seed source/event synchronously
       when pinState.pins is warm in cache (the common case on every
       remount after the sheet's first open); this effect is only the
       fallback for a cold cache. See the eventId initializer's comment
       in IncomeForm for why synchronous seeding matters here. */
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (hydratedRef.current) return;
        if (!pinState.pins) return;
        hydratedRef.current = true;
        if (pinState.pins.account) setSource(pinState.pins.account.id);
        if (pinState.pins.event) setEventId(pinState.pins.event.id);
    }, [pinState.pins]);

    const showMoreKey = `orbit:nt-transfer-show-more:${spaceId}`;
    const [showMore, setShowMore] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        return window.localStorage.getItem(showMoreKey) === "1";
    });
    useEffect(() => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(showMoreKey, showMore ? "1" : "0");
    }, [showMore, showMoreKey]);
    const optionalFieldsHaveContent = eventId.length > 0 || attachmentFileIds.length > 0;
    useEffect(() => {
        if (optionalFieldsHaveContent && !showMore) setShowMore(true);
    }, [optionalFieldsHaveContent, showMore]);

    const idem = useIdempotencyKey();
    const mutate = trpc.transaction.transfer.useMutation({
        onMutate: async (variables) => {
            await optimistic.cancelBoth();
            const tempId = variables.idempotencyKey ?? idem.key;
            // A transfer alone contributes nothing to in/out totals — its
            // optional fee is a separate server-side expense-type row this
            // optimistic layer doesn't synthesize (known, accepted gap:
            // the totals strip may briefly undercount a fee until the
            // real invalidate lands).
            const delta = computeDelta("transfer", variables.amount);
            const row: OptimisticTxRow = {
                id: tempId,
                space_id: variables.spaceId,
                created_by: authStore.user?.id ?? "",
                type: "transfer",
                amount: String(variables.amount),
                source_account_id: variables.sourceAccountId,
                destination_account_id: variables.destinationAccountId,
                description: null,
                location: null,
                transaction_datetime: (variables.datetime ?? new Date()).toISOString(),
                created_at: new Date().toISOString(),
                expense_category_id: null,
                envelop_id: null,
                event_id: variables.eventId ?? null,
                parent_transfer_id: null,
                created_by_first_name: authStore.user?.name?.split(" ")[0] ?? null,
                created_by_last_name: authStore.user?.name?.split(" ").slice(1).join(" ") || null,
                created_by_avatar_file_id: authStore.user?.avatarFileId ?? null,
                account_balances_after: {},
                __pending: true,
            };
            optimistic.addPendingRow(row);
            optimistic.applyDelta(delta);
            return { tempId, delta };
        },
        onSuccess: async () => {
            toast.success("Transfer recorded");
            if (typeof window !== "undefined" && sourceAccountId) {
                window.localStorage.setItem(lastSourceKey, sourceAccountId);
            }
            await invalidate(spaceId);
        },
        onError: async (e, variables, ctx) => {
            if (ctx) {
                optimistic.removePendingRow(ctx.tempId);
                optimistic.reverseDelta(ctx.delta);
                // See IncomeForm's onError for why: a sibling submission's
                // invalidate() may have already reset totals to server
                // truth that never included this failed row.
                await invalidate(spaceId);
            }
            toast.error(`Transfer of ${variables.amount} didn't save — ${e.message}`, {
                duration: Infinity,
            });
        },
    });
    useEffect(() => {
        onPendingChange(mutate.isPending);
    }, [mutate.isPending, onPendingChange]);

    const feeNum = feeEnabled ? Number(feeAmount) : 0;
    const amountNum = Number(amount);
    const totalOut = (amountNum || 0) + (Number.isFinite(feeNum) ? feeNum : 0);

    return (
        <form
            id="nt-form"
            className="nt-form"
            onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (mutate.isPending) return;
                if (!sourceAccountId || !destinationAccountId) {
                    toast.error("Pick both accounts");
                    return;
                }
                if (sourceAccountId === destinationAccountId) {
                    toast.error("Source and destination must differ");
                    return;
                }
                if (!(Number(amount) > 0)) {
                    toast.error("Enter an amount");
                    return;
                }
                if (feeEnabled) {
                    if (!(feeNum > 0)) {
                        toast.error("Fee must be greater than 0");
                        return;
                    }
                    if (!feeCategoryId) {
                        toast.error("Pick a category for the fee");
                        return;
                    }
                    if (!feeEnvelopeId) {
                        toast.error("Pick an envelope for the fee");
                        return;
                    }
                }
                mutate.mutate({
                    spaceId,
                    sourceAccountId,
                    destinationAccountId,
                    amount: Number(amount),
                    datetime: fromInputDateTime(datetime),
                    eventId: eventId || undefined,
                    attachmentFileIds: attachmentFileIds.length > 0 ? attachmentFileIds : undefined,
                    feeAmount: feeEnabled ? feeNum : undefined,
                    feeExpenseCategoryId: feeEnabled && feeCategoryId ? feeCategoryId : undefined,
                    feeEnvelopId: feeEnabled ? feeEnvelopeId : undefined,
                    idempotencyKey: idem.key,
                });
                idem.rotate();
                onDone();
            }}
        >
            <OrbitField
                label="From"
                required
                interactiveHint
                hint={
                    <FieldPin
                        field="account"
                        currentValue={sourceAccountId}
                        pinValue={pinState.pins?.account?.id ?? null}
                        available={!pinState.isPersonal}
                        canPin={true}
                        onPin={() => pinState.pinAccount(sourceAccountId)}
                        onClear={() => pinState.clearPin("account")}
                    />
                }
            >
                <OrbitSelect
                    value={sourceAccountId}
                    onValueChange={setSource}
                    items={sourceItems}
                    placeholder="Choose source account"
                    leadIcon={<Wallet className="size-3.5" />}
                    leadColor="var(--ent-1)"
                />
            </OrbitField>

            <SourceOverspendHint
                account={(accountsQuery.data ?? []).find((a) => a.id === sourceAccountId)}
                additionalDebit={totalOut}
            />

            <div className="nt-swap" aria-hidden>
                <span>
                    <ArrowDown className="size-3.5" />
                </span>
            </div>

            <OrbitField label="To" required>
                <OrbitSelect
                    value={destinationAccountId}
                    onValueChange={setDest}
                    items={destItems}
                    placeholder="Choose destination account"
                    leadIcon={<Wallet className="size-3.5" />}
                    leadColor="var(--ent-3)"
                />
            </OrbitField>

            <OrbitAmountCard value={amount} onChange={setAmount} tone="brand" />

            <OrbitField label="Date">
                <TransactionDatePicker value={datetime} onChange={setDatetime} />
            </OrbitField>

            <OrbitToggle
                checked={feeEnabled}
                onChange={setFeeEnabled}
                label="There's a fee on this transfer"
                hint="Wire fee, ATM fee, FX margin. Deducted from source on top of the amount and logged as a regular expense."
            />

            {feeEnabled && (
                <OrbitFieldRow>
                    <OrbitField label="Fee amount" hint="Charged by source" required>
                        <OrbitInput
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={feeAmount}
                            onChange={(e) => setFeeAmount(e.target.value)}
                            placeholder="0.00"
                        />
                    </OrbitField>
                    <OrbitField label="Fee category" hint="Where the fee is logged" required>
                        <CategoryTreeSelect
                            categories={categoriesQuery.data ?? []}
                            value={feeCategoryId}
                            onChange={setFeeCategoryId}
                            placeholder="Choose category"
                            allowAll={false}
                        />
                    </OrbitField>
                </OrbitFieldRow>
            )}

            {feeEnabled && (
                <OrbitField label="Fee envelope" hint="The fee spends from here" required>
                    <OrbitSelect
                        value={feeEnvelopeId}
                        onValueChange={setFeeEnvelopeId}
                        items={feeEnvelopeItems}
                        placeholder="Choose envelope"
                        leadIcon={<Layers className="size-3.5" />}
                        leadColor="var(--ent-2)"
                    />
                </OrbitField>
            )}

            {feeEnabled && amountNum > 0 && feeNum > 0 && (
                <FeeBreakdown totalOut={totalOut} delivered={amountNum} fee={feeNum} />
            )}

            <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="of-disclosure-toggle"
            >
                <span>{showMore ? "Hide event or receipt" : "Add event or receipt"}</span>
                {showMore ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>

            {showMore && (
                <>
                    <EventSelect
                        spaceId={spaceId}
                        value={eventId}
                        onChange={setEventId}
                        pinSlot={
                            <FieldPin
                                field="event"
                                currentValue={eventId}
                                pinValue={pinState.pins?.event?.id ?? null}
                                available={!pinState.isPersonal}
                                canPin={canEdit}
                                onPin={() => pinState.pinEvent(eventId)}
                                onClear={() => pinState.clearPin("event")}
                            />
                        }
                    />

                    <OrbitField label="Receipts" hint="Optional · PNG · JPG · PDF">
                        <FileUploadField
                            purpose="transaction_receipt"
                            fileIds={attachmentFileIds}
                            onChange={setAttachmentFileIds}
                            label=""
                        />
                    </OrbitField>
                </>
            )}
        </form>
    );
}

function FeeBreakdown({
    totalOut,
    delivered,
    fee,
}: {
    totalOut: number;
    delivered: number;
    fee: number;
}) {
    return (
        <div
            style={{
                background: "var(--bg-elev-2)",
                border: "1px solid var(--line-soft)",
                borderRadius: 10,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 11,
            }}
        >
            <FeeRow label="Source debited" value={`−${totalOut.toFixed(2)}`} strong />
            <FeeRow label="Destination credited" value={`+${delivered.toFixed(2)}`} />
            <FeeRow label="Fee (lost to provider)" value={fee.toFixed(2)} tone="expense" />
        </div>
    );
}

function FeeRow({
    label,
    value,
    strong,
    tone,
}: {
    label: ReactNode;
    value: ReactNode;
    strong?: boolean;
    tone?: "expense";
}) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", color: "var(--fg-3)" }}>
            <span>{label}</span>
            <span
                style={{
                    fontFamily: "var(--font-mono, ui-monospace), monospace",
                    fontVariantNumeric: "tabular-nums",
                    color:
                        tone === "expense"
                            ? "var(--expense)"
                            : strong
                              ? "var(--fg)"
                              : "var(--fg-2)",
                    fontWeight: strong ? 600 : 400,
                }}
            >
                {value}
            </span>
        </div>
    );
}

/* ============================================================
   ADJUSTMENT FORM
   ============================================================ */
type AdjReason = "bank-fee" | "missed" | "rounding";

function AdjustmentForm({
    onDone,
    onPendingChange,
}: {
    onDone: () => void;
    onPendingChange: (pending: boolean) => void;
}) {
    const spaceId = useCurrentSpaceId();
    const accountsQuery = trpc.account.listBySpace.useQuery({ spaceId });
    const invalidate = useInvalidateAnalytics();
    const pinState = usePins(spaceId);

    const lastAccountKey = `orbit:last-account:${spaceId}:adjustment`;
    const [accountId, setAccountId] = useState<string>(() => {
        if (pinState.pins?.account) return pinState.pins.account.id;
        if (typeof window === "undefined") return "";
        return window.localStorage.getItem(lastAccountKey) ?? "";
    });
    const [newBalance, setNewBalance] = useState("");
    const [description, setDescription] = useState("");
    const [datetime, setDatetime] = useState(defaultDateTime());
    const [reason, setReason] = useState<AdjReason>("bank-fee");
    const [attachmentFileIds, setAttachmentFileIds] = useState<string[]>([]);

    const adjustableItems = useMemo(
        () => (accountsQuery.data ?? []).filter(ownedByMe).map(toAccountItem),
        [accountsQuery.data]
    );

    useEffect(() => {
        if (!accountId) return;
        if (adjustableItems.length === 0) return;
        if (!adjustableItems.some((i) => i.value === accountId)) {
            setAccountId("");
        }
    }, [accountId, adjustableItems]);

    const hydratedRef = useRef(false);
    useEffect(() => {
        if (hydratedRef.current) return;
        if (!pinState.pins) return;
        hydratedRef.current = true;
        if (pinState.pins.account) setAccountId(pinState.pins.account.id);
    }, [pinState.pins]);

    const idem = useIdempotencyKey();
    // Deliberately no onMutate/optimistic row here, unlike Income/Expense/
    // Transfer: an adjustment's amount and which account is source vs.
    // destination are computed server-side from a live read of
    // account_balances (see adjust.mts) at the moment it runs. Replicating
    // that from the client's own (possibly stale) cached balance risks
    // showing a backwards or wrong-amount pending row. Adjustments are
    // also rare, one-off corrections — not the "many in a row" case this
    // feature targets — so they just get the non-blocking submit below.
    const mutate = trpc.transaction.adjust.useMutation({
        onSuccess: async () => {
            toast.success("Balance adjusted");
            if (typeof window !== "undefined" && accountId) {
                window.localStorage.setItem(lastAccountKey, accountId);
            }
            await invalidate(spaceId);
        },
        onError: (e) => {
            toast.error(`Balance adjustment didn't save — ${e.message}`, { duration: Infinity });
        },
    });
    useEffect(() => {
        onPendingChange(mutate.isPending);
    }, [mutate.isPending, onPendingChange]);

    const selected = (accountsQuery.data ?? []).find((a) => a.id === accountId);
    const orbitBalance = selected ? Number(selected.balance) : 0;
    const actualBalance = newBalance === "" ? null : Number(newBalance);
    const delta =
        actualBalance != null && Number.isFinite(actualBalance)
            ? actualBalance - orbitBalance
            : null;
    const isIncrease = delta != null && delta >= 0;

    return (
        <form
            id="nt-form"
            className="nt-form"
            onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (mutate.isPending) return;
                if (!accountId) {
                    toast.error("Pick an account");
                    return;
                }
                if (delta == null) {
                    toast.error("Enter the actual balance");
                    return;
                }
                if (delta === 0) {
                    toast.error("New balance matches the current balance");
                    return;
                }
                const reasonText =
                    reason === "bank-fee"
                        ? "Bank correction"
                        : reason === "missed"
                          ? "Missed transaction"
                          : "Rounding / FX";
                const finalDesc = description.trim()
                    ? `${reasonText} — ${description.trim()}`
                    : reasonText;
                mutate.mutate({
                    spaceId,
                    accountId,
                    newBalance: Number(newBalance),
                    datetime: fromInputDateTime(datetime),
                    description: finalDesc,
                    attachmentFileIds: attachmentFileIds.length > 0 ? attachmentFileIds : undefined,
                    idempotencyKey: idem.key,
                });
                idem.rotate();
                onDone();
            }}
        >
            <OrbitField
                label="Account"
                required
                interactiveHint
                hint={
                    <FieldPin
                        field="account"
                        currentValue={accountId}
                        pinValue={pinState.pins?.account?.id ?? null}
                        available={!pinState.isPersonal}
                        canPin={true}
                        onPin={() => pinState.pinAccount(accountId)}
                        onClear={() => pinState.clearPin("account")}
                    />
                }
            >
                <OrbitSelect
                    value={accountId}
                    onValueChange={setAccountId}
                    items={adjustableItems}
                    placeholder="Choose account"
                    leadIcon={<Wallet className="size-3.5" />}
                    leadColor="var(--ent-1)"
                />
            </OrbitField>

            {/* Drift card */}
            <div className="nt-drift">
                <div className="nt-drift-grid">
                    <div className="nt-drift-col">
                        <span className="nt-drift-eyebrow">Orbit balance</span>
                        <div className="nt-drift-num">
                            {selected ? formatNum(orbitBalance) : "0.00"}
                        </div>
                        <span className="nt-drift-foot">
                            {selected
                                ? `as of ${new Date().toLocaleString(undefined, {
                                      month: "short",
                                      day: "numeric",
                                      hour: "numeric",
                                      minute: "2-digit",
                                  })}`
                                : "Pick an account first"}
                        </span>
                    </div>
                    <div className="nt-drift-col">
                        <span className="nt-drift-eyebrow">Actual balance</span>
                        <div className="nt-drift-actual-input">
                            <input
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                value={newBalance}
                                onChange={(e) => setNewBalance(e.target.value)}
                                placeholder="0.00"
                                required
                            />
                        </div>
                        <span className="nt-drift-foot">What does your bank say?</span>
                    </div>
                </div>

                <div className="nt-drift-divider" />

                <div className="nt-drift-summary">
                    <div className="nt-drift-col">
                        <span className="nt-drift-summary-label">Adjustment posted</span>
                        <span
                            className="nt-drift-summary-num"
                            style={{
                                color:
                                    delta == null
                                        ? "var(--fg-3)"
                                        : isIncrease
                                          ? "var(--income)"
                                          : "var(--expense)",
                            }}
                        >
                            {delta == null ? (
                                <>—</>
                            ) : (
                                <>
                                    {isIncrease ? (
                                        <ArrowUp
                                            className="size-3.5"
                                            style={{ color: "var(--income)" }}
                                        />
                                    ) : (
                                        <ArrowDown
                                            className="size-3.5"
                                            style={{ color: "var(--expense)" }}
                                        />
                                    )}
                                    {formatNum(Math.abs(delta))}
                                </>
                            )}
                        </span>
                    </div>
                    <span
                        className="nt-drift-chip"
                        style={
                            delta == null
                                ? {
                                      background: "var(--bg-elev-1)",
                                      color: "var(--fg-3)",
                                      border: "1px solid var(--line)",
                                  }
                                : isIncrease
                                  ? {
                                        background: "var(--income-soft)",
                                        color: "var(--income)",
                                        border: "1px solid var(--income)",
                                    }
                                  : {
                                        background: "var(--expense-soft)",
                                        color: "var(--expense)",
                                        border: "1px solid var(--expense)",
                                    }
                        }
                    >
                        <span
                            className="dot"
                            style={{
                                background:
                                    delta == null
                                        ? "var(--fg-3)"
                                        : isIncrease
                                          ? "var(--income)"
                                          : "var(--expense)",
                            }}
                        />
                        {delta == null ? "No drift" : isIncrease ? "Increase" : "Decrease"}
                    </span>
                </div>
            </div>

            <OrbitField label="Reason" hint="Required for audit trail" required>
                <OrbitRadioRow
                    name="adj-reason"
                    value={reason}
                    onChange={setReason}
                    accent="var(--gold)"
                    options={[
                        {
                            value: "bank-fee",
                            label: "Bank correction",
                            hint: "Fees · interest · refunds",
                        },
                        {
                            value: "missed",
                            label: "Missed transaction",
                            hint: "Forgot to log",
                        },
                        {
                            value: "rounding",
                            label: "Rounding / FX",
                            hint: "Pennies & exchange",
                        },
                    ]}
                />
            </OrbitField>

            <OrbitField label="Date">
                <TransactionDatePicker value={datetime} onChange={setDatetime} />
            </OrbitField>

            <OrbitField label="Notes" hint="Optional but recommended">
                <OrbitTextarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Bank credited interest for April — caught at month-end reconcile."
                />
            </OrbitField>

            <OrbitField label="Receipts" hint="Optional · PNG · JPG · PDF">
                <FileUploadField
                    purpose="transaction_receipt"
                    fileIds={attachmentFileIds}
                    onChange={setAttachmentFileIds}
                    label=""
                />
            </OrbitField>
        </form>
    );
}

/* Format a number with thousand separators + 2 decimals. Defensive against
   NaN — falls back to "0.00". */
function formatNum(n: number): string {
    if (!Number.isFinite(n)) return "0.00";
    return n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}
