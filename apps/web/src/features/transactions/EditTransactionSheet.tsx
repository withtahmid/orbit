import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
    ArrowDown,
    ArrowUp,
    ArrowLeftRight,
    SlidersHorizontal,
    Calendar,
    Wallet,
    Check,
    Layers,
    ChevronDown,
    ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { OrbitDrawerShell, OrbitField } from "@/components/orbit/OrbitModalShell";
import {
    OrbitAmountCard,
    OrbitFormStyles,
    OrbitInfoPill,
    OrbitInput,
    OrbitSelect,
    OrbitTextarea,
    type OrbitSelectItem,
} from "@/components/orbit/OrbitForm";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CategoryTreeSelect } from "@/components/shared/CategoryTreeSelect";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { trpc } from "@/trpc";
import { useInvalidateAnalytics } from "@/lib/invalidate";
import type { RouterOutput } from "@/trpc";
import { toInputDateTime, fromInputDateTime } from "@/lib/dates";
import { getIcon } from "@/lib/entityIcons";
import { NT_STYLES, SourceOverspendHint } from "./NewTransactionSheet";
import { TransactionDatePicker, TDP_POPOVER_STYLES } from "./TransactionDatePicker";

type SpaceAccount = RouterOutput["account"]["listBySpace"][number];
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

function toAccountItem(a: SpaceAccount): OrbitSelectItem {
    const Icon = getIcon(a.icon ?? null);
    return {
        value: a.id,
        label: <AccountLabel account={a} />,
        leadIcon: <Icon className="size-3.5" />,
        leadColor: a.color ?? "var(--ent-1)",
    };
}

type TxType = "income" | "expense" | "transfer" | "adjustment";

export interface EditableTransaction {
    id: string;
    space_id: string;
    type: unknown;
    amount: string | number;
    source_account_id: string | null;
    destination_account_id: string | null;
    description: string | null;
    location: string | null;
    transaction_datetime: Date | string;
    expense_category_id: string | null;
    envelop_id: string | null;
    event_id: string | null;
    /**
     * Set on the linked-expense row that mirrors a transfer's fee.
     * `null` on regular rows. Transfers themselves never carry this.
     */
    parent_transfer_id?: string | null;
}

const EDIT_META: Record<
    TxType,
    {
        title: string;
        color: string;
        icon: typeof ArrowDown;
        tone: "fg" | "income" | "brand" | "gold";
    }
> = {
    expense: {
        title: "Edit expense",
        color: "var(--expense)",
        icon: ArrowUp,
        tone: "fg",
    },
    income: {
        title: "Edit income",
        color: "var(--income)",
        icon: ArrowDown,
        tone: "income",
    },
    transfer: {
        title: "Edit transfer",
        color: "var(--transfer)",
        icon: ArrowLeftRight,
        tone: "brand",
    },
    adjustment: {
        title: "Edit adjustment",
        color: "var(--gold)",
        icon: SlidersHorizontal,
        tone: "gold",
    },
};

/**
 * Edit sheet for a transaction. Always controlled by a parent that owns
 * the open/closed state — there is no internal trigger button anymore.
 * Mount this once at page level and pass `transaction` when the user
 * asks to edit something; pass `null`/unmount to dismiss.
 */
export function EditTransactionSheet({
    transaction,
    open,
    onClose,
}: {
    transaction: EditableTransaction;
    open: boolean;
    onClose: () => void;
}) {
    const type = transaction.type as unknown as TxType;
    const meta = EDIT_META[type];
    const LeadIcon = meta.icon;
    /* Lifted from EditForm so the footer Save button can reflect the
       mutation's pending state (disable + spinner + "Saving…" label).
       Without this, the button looks unresponsive on click — and worse,
       double-clicks could fire two updates. Matches NewTransactionSheet
       pattern. */
    const [isSaving, setIsSaving] = useState(false);

    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent side="right" className="orbit-shell-host !p-0 sm:max-w-[520px]">
                <SheetTitle className="sr-only">{meta.title}</SheetTitle>
                <OrbitDrawerShell
                    eyebrow="Edit transaction"
                    title={meta.title}
                    subtitle="Balances and envelope usage will recompute automatically."
                    leadIcon={<LeadIcon className="size-4" />}
                    leadColor={meta.color}
                    onClose={onClose}
                    footer={
                        <>
                            <button
                                type="button"
                                className="nt-btn"
                                onClick={onClose}
                                disabled={isSaving}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="edit-tx-form"
                                className="nt-btn nt-btn-primary"
                                disabled={isSaving}
                            >
                                {isSaving ? (
                                    <span className="nt-spinner" aria-hidden />
                                ) : (
                                    <Check className="size-3.5" />
                                )}
                                {isSaving ? "Saving…" : "Save changes"}
                            </button>
                        </>
                    }
                >
                    <OrbitFormStyles />
                    <style>{NT_STYLES}</style>
                    <style>{TDP_POPOVER_STYLES}</style>
                    <EditForm
                        key={transaction.id}
                        transaction={transaction}
                        onDone={onClose}
                        onPendingChange={setIsSaving}
                    />
                </OrbitDrawerShell>
            </SheetContent>
        </Sheet>
    );
}

function EditForm({
    transaction,
    onDone,
    onPendingChange,
}: {
    transaction: EditableTransaction;
    onDone: () => void;
    onPendingChange: (pending: boolean) => void;
}) {
    const spaceId = transaction.space_id;
    const type = transaction.type as unknown as TxType;
    const meta = EDIT_META[type];
    const invalidate = useInvalidateAnalytics();
    const isFeeExpense = type === "expense" && transaction.parent_transfer_id != null;

    const accountsQuery = trpc.account.listBySpace.useQuery({ spaceId });
    const categoriesQuery = trpc.expenseCategory.listBySpace.useQuery({ spaceId });
    const envelopesQuery = trpc.envelop.listBySpace.useQuery({ spaceId });
    const eventsQuery = trpc.event.listBySpace.useQuery({ spaceId });

    const initialDatetime = toInputDateTime(new Date(transaction.transaction_datetime));

    const [amount, setAmount] = useState(String(transaction.amount));
    const [datetime, setDatetime] = useState(initialDatetime);
    const [description, setDescription] = useState(transaction.description ?? "");
    const [location, setLocation] = useState(transaction.location ?? "");
    const [sourceAccountId, setSource] = useState(transaction.source_account_id ?? "");
    const [destinationAccountId, setDest] = useState(transaction.destination_account_id ?? "");
    const [categoryId, setCategoryId] = useState<string | null>(
        transaction.expense_category_id ?? null
    );
    const [envelopeId, setEnvelopeId] = useState<string>(transaction.envelop_id ?? "");
    const [envelopePickerOpen, setEnvelopePickerOpen] = useState(false);
    const [eventId, setEventId] = useState(transaction.event_id ?? "");

    // Optional-field disclosure mirrors the new-tx form. Auto-opens if
    // any optional field already has content so the user never loses
    // visibility into data they entered earlier.
    const optionalFieldsHaveContent =
        location.trim().length > 0 ||
        (eventId !== "" && eventId !== "__none") ||
        description.trim().length > 0;
    const [showMore, setShowMore] = useState<boolean>(optionalFieldsHaveContent);
    useEffect(() => {
        if (optionalFieldsHaveContent && !showMore) setShowMore(true);
    }, [optionalFieldsHaveContent, showMore]);

    const allItems = useMemo(
        () => (accountsQuery.data ?? []).map(toAccountItem),
        [accountsQuery.data]
    );
    const spendableItems = useMemo(
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

    const selectedEnvelope = useMemo(
        () => (envelopeId ? (envelopesQuery.data ?? []).find((e) => e.id === envelopeId) : null),
        [envelopeId, envelopesQuery.data]
    );

    const eventItems: OrbitSelectItem[] = useMemo(() => {
        const evs = eventsQuery.data ?? [];
        /* Hide closed events from the picker, but keep the one currently
           linked to this transaction (even if closed) so users editing
           an old transaction can see what it's tied to. */
        const active = evs.filter((ev) => ev.status === "active");
        const linkedClosed = transaction.event_id
            ? evs.find((ev) => ev.id === transaction.event_id && ev.status === "closed")
            : null;
        const visible = linkedClosed ? [...active, linkedClosed] : active;
        return [
            { value: "__none", label: "No event" },
            ...visible.map((ev) => ({
                value: ev.id,
                label: ev.status === "closed" ? `${ev.name} (closed)` : ev.name,
                leadIcon: <Calendar className="size-3.5" />,
                leadColor: "var(--ent-5)",
            })),
        ];
    }, [eventsQuery.data, transaction.event_id]);

    const envelopeItems: OrbitSelectItem[] = useMemo(
        () =>
            (envelopesQuery.data ?? [])
                // Allow the currently selected envelope through even if
                // archived — otherwise the picker would silently strip
                // the existing assignment on open.
                .filter((e) => !e.archived || e.id === envelopeId)
                .map((e) => ({
                    value: e.id,
                    label: e.name,
                    leadIcon: <Layers className="size-3.5" />,
                    leadColor: e.color || "var(--ent-2)",
                })),
        [envelopesQuery.data, envelopeId]
    );

    const mutate = trpc.transaction.update.useMutation({
        onSuccess: async () => {
            toast.success("Transaction updated");
            await invalidate(spaceId);
            onDone();
        },
        onError: (e) => toast.error(e.message),
    });
    useEffect(() => {
        onPendingChange(mutate.isPending);
    }, [mutate.isPending, onPendingChange]);

    /* Net new debit applied to the (possibly newly-picked) source. When
       the source is unchanged, only the delta vs. the existing amount
       counts; reducing the amount won't make the source any more
       negative, so the hint stays silent. When the source changes, the
       entire new amount lands on the new source. Fee changes aren't
       editable from this sheet, so they cancel out either way. */
    const newAmountForHint = Number(amount) || 0;
    const existingAmountForHint = Number(transaction.amount) || 0;
    const sourceChangedForHint = sourceAccountId !== (transaction.source_account_id ?? "");
    const editAdditionalDebit = sourceChangedForHint
        ? newAmountForHint
        : newAmountForHint - existingAmountForHint;
    const sourceAccountForHint = (accountsQuery.data ?? []).find((a) => a.id === sourceAccountId);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const parsed = Number(amount);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            toast.error("Amount must be greater than zero");
            return;
        }
        if (type === "expense" && (!sourceAccountId || !categoryId)) {
            toast.error("Pick an account and category");
            return;
        }
        if (type === "expense" && !envelopeId) {
            toast.error("Pick an envelope");
            return;
        }
        if (type === "income" && !destinationAccountId) {
            toast.error("Pick a destination account");
            return;
        }
        if (type === "transfer") {
            if (!sourceAccountId || !destinationAccountId) {
                toast.error("Pick both accounts");
                return;
            }
            if (sourceAccountId === destinationAccountId) {
                toast.error("Source and destination must differ");
                return;
            }
        }
        const envelopeChanged =
            type === "expense" &&
            envelopeId !== "" &&
            envelopeId !== (transaction.envelop_id ?? "");
        // For fee-expense rows we don't allow editing source_account from
        // here — keep server payload consistent with the parent transfer
        // by sending undefined (no change) rather than the form value.
        const sendSource =
            type === "income" || type === "adjustment"
                ? undefined
                : isFeeExpense
                  ? undefined
                  : sourceAccountId || null;
        mutate.mutate({
            transactionId: transaction.id,
            amount: parsed,
            datetime: fromInputDateTime(datetime),
            description: description.trim() === "" ? null : description.trim(),
            location: location.trim() === "" ? null : location.trim(),
            sourceAccountId: sendSource,
            destinationAccountId:
                type === "expense" || type === "adjustment"
                    ? undefined
                    : destinationAccountId || null,
            expenseCategoryId: type === "expense" ? categoryId : undefined,
            envelopId: envelopeChanged ? envelopeId : undefined,
            eventId: type === "adjustment" ? undefined : eventId === "" ? null : eventId,
        });
    };

    return (
        <form id="edit-tx-form" className="nt-form" onSubmit={submit}>
            {isFeeExpense && (
                <OrbitInfoPill tone="transfer">
                    This is a transfer fee. Edit the parent transfer to change the fee's amount or
                    source account.
                </OrbitInfoPill>
            )}

            <OrbitAmountCard value={amount} onChange={setAmount} tone={meta.tone} autoFocus />

            {type !== "adjustment" && (
                <OrbitField label="Date">
                    <TransactionDatePicker value={datetime} onChange={setDatetime} />
                </OrbitField>
            )}

            {type === "income" && (
                <OrbitField label="Into account" required>
                    <OrbitSelect
                        value={destinationAccountId}
                        onValueChange={setDest}
                        items={allItems}
                        placeholder="Choose account"
                        leadIcon={<Wallet className="size-3.5" />}
                        leadColor="var(--ent-1)"
                    />
                </OrbitField>
            )}

            {type === "expense" && (
                <>
                    <OrbitField
                        label="From account"
                        required
                        hint={
                            isFeeExpense
                                ? "Locked — fees share the parent transfer's source"
                                : undefined
                        }
                    >
                        <OrbitSelect
                            value={sourceAccountId}
                            onValueChange={setSource}
                            items={spendableItems}
                            placeholder="Choose account"
                            leadIcon={<Wallet className="size-3.5" />}
                            leadColor="var(--ent-1)"
                            disabled={isFeeExpense}
                        />
                    </OrbitField>
                    {!isFeeExpense && (
                        <SourceOverspendHint
                            account={sourceAccountForHint}
                            additionalDebit={editAdditionalDebit}
                        />
                    )}
                    <OrbitField label="Category" hint="Tag for what the spend was" required>
                        <CategoryTreeSelect
                            categories={categoriesQuery.data ?? []}
                            value={categoryId}
                            onChange={setCategoryId}
                            placeholder="Choose category"
                            allowAll={false}
                        />
                    </OrbitField>

                    {/* Empty envelope never collapses to the chip — show the
                        labeled picker until a real envelope exists. */}
                    {categoryId &&
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
                                            backgroundColor:
                                                selectedEnvelope?.color || "var(--ent-2)",
                                        }}
                                    />
                                    <span className="of-chip-name">
                                        {selectedEnvelope?.name ?? "—"}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className="of-chip-btn"
                                    onClick={() => setEnvelopePickerOpen(true)}
                                >
                                    Change
                                </button>
                            </div>
                        ))}
                </>
            )}

            {type === "transfer" && (
                <>
                    <OrbitField label="From" required>
                        <OrbitSelect
                            value={sourceAccountId}
                            onValueChange={setSource}
                            items={spendableItems}
                            placeholder="Choose source"
                            leadIcon={<Wallet className="size-3.5" />}
                            leadColor="var(--ent-1)"
                        />
                    </OrbitField>
                    <SourceOverspendHint
                        account={sourceAccountForHint}
                        additionalDebit={editAdditionalDebit}
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
                            placeholder="Choose destination"
                            leadIcon={<Wallet className="size-3.5" />}
                            leadColor="var(--ent-3)"
                        />
                    </OrbitField>
                </>
            )}

            {type === "adjustment" && (
                <OrbitField label="Date">
                    <TransactionDatePicker value={datetime} onChange={setDatetime} />
                </OrbitField>
            )}

            {/* Optional fields collapsed behind a disclosure to match the
                new-transaction form. Auto-opens (above) when any of the
                wrapped fields already has content. Adjustments have no
                optional fields available, so the disclosure is hidden. */}
            {type !== "adjustment" && (
                <>
                    <button
                        type="button"
                        onClick={() => setShowMore((v) => !v)}
                        className="of-disclosure-toggle"
                    >
                        <span>
                            {showMore
                                ? "Hide notes, location, event"
                                : "Add notes, location, or event"}
                        </span>
                        {showMore ? (
                            <ChevronUp className="size-4" />
                        ) : (
                            <ChevronDown className="size-4" />
                        )}
                    </button>

                    {showMore && (
                        <>
                            {(type === "expense" || type === "income") && (
                                <OrbitField label="Location" hint="Optional">
                                    <OrbitInput
                                        value={location}
                                        onChange={(e) => setLocation(e.target.value)}
                                        placeholder="Where did this happen?"
                                    />
                                </OrbitField>
                            )}

                            <OrbitField label="Description" hint="Optional">
                                <OrbitTextarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Optional note"
                                    rows={2}
                                />
                            </OrbitField>

                            {(eventsQuery.data?.length ?? 0) > 0 && (
                                <OrbitField label="Link to event" hint="Optional">
                                    <OrbitSelect
                                        value={eventId || "__none"}
                                        onValueChange={(v) => setEventId(v === "__none" ? "" : v)}
                                        items={eventItems}
                                        placeholder="No event"
                                    />
                                </OrbitField>
                            )}
                        </>
                    )}
                </>
            )}

            {type === "adjustment" && (
                <OrbitField label="Description" hint="Optional">
                    <OrbitTextarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Optional note"
                        rows={2}
                    />
                </OrbitField>
            )}

            {type === "transfer" && (
                <OrbitInfoPill tone="transfer">
                    Transfers don't show up in income/expense totals. They're recorded as a paired
                    (out, in) ledger entry.
                </OrbitInfoPill>
            )}

            {type === "adjustment" && (
                <OrbitInfoPill tone="gold">
                    Adjustments don't appear in income or expense totals — they correct your account
                    balance only.
                </OrbitInfoPill>
            )}
        </form>
    );
}
