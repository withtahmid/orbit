import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { toInputDateTimeSeconds, fromInputDateTime } from "@/lib/dates";
import { formatInAppTz } from "@/lib/formatDate";
import { getIcon } from "@/lib/entityIcons";
import { NT_STYLES, SourceOverspendHint } from "./NewTransactionSheet";
import { TransactionDatePicker, TDP_POPOVER_STYLES } from "./TransactionDatePicker";
import { useOptimisticTransactionCache } from "./useOptimisticTransactionCache";
import { useStore } from "@/stores/useStore";

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
    /** Who recorded the row — drives the money-lock for income/adjustments. */
    created_by: string;
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
    /* No pending/"Saving…" state here on purpose: the save is optimistic,
       so the sheet closes on submit and the edited row carries the saving
       spinner in the list instead. EditForm's own same-frame submit lock
       covers the double-fire the old disabled state used to. */

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
                            <button type="button" className="nt-btn" onClick={onClose}>
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="edit-tx-form"
                                className="nt-btn nt-btn-primary"
                            >
                                <Check className="size-3.5" />
                                Save changes
                            </button>
                        </>
                    }
                >
                    <OrbitFormStyles />
                    <style>{NT_STYLES}</style>
                    <style>{TDP_POPOVER_STYLES}</style>
                    <EditForm key={transaction.id} transaction={transaction} onDone={onClose} />
                </OrbitDrawerShell>
            </SheetContent>
        </Sheet>
    );
}

function EditForm({
    transaction,
    onDone,
}: {
    transaction: EditableTransaction;
    onDone: () => void;
}) {
    const spaceId = transaction.space_id;
    const type = transaction.type as unknown as TxType;
    const meta = EDIT_META[type];
    const invalidate = useInvalidateAnalytics();
    const optimistic = useOptimisticTransactionCache();
    const isFeeExpense = type === "expense" && transaction.parent_transfer_id != null;
    const { authStore } = useStore();
    const myUserId = authStore.user?.id;

    const accountsQuery = trpc.account.listBySpace.useQuery({ spaceId });
    const categoriesQuery = trpc.expenseCategory.listBySpace.useQuery({ spaceId });
    const envelopesQuery = trpc.envelop.listBySpace.useQuery({ spaceId });
    const eventsQuery = trpc.event.listBySpace.useQuery({ spaceId });

    /* Seconds-preserving: the create path seeds entries with second precision
       so a rapid batch keeps its order (list ties break on a random uuid).
       Hydrating through the minute-only `toInputDateTime` and writing it back
       would truncate them, so fixing a typo on one row of a 20-row batch would
       silently jump that row to the front of its minute. */
    const initialDatetime = toInputDateTimeSeconds(new Date(transaction.transaction_datetime));

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
    /* Source accounts the caller may MOVE this row onto: owned + unlocked.
       The row's CURRENT source is kept even when the caller doesn't own it
       — any space owner/editor may edit a teammate's row's metadata (the
       picker is disabled via `moneyLocked` below in that case), and
       dropping the current source from the list would blank the field. */
    const spendableItems = useMemo(
        () =>
            (accountsQuery.data ?? [])
                .filter(
                    (a) =>
                        (a.account_type !== "locked" && ownedByMe(a)) ||
                        a.id === transaction.source_account_id
                )
                .map(toAccountItem),
        [accountsQuery.data, transaction.source_account_id]
    );
    /* "Metadata is shared, money is owned" (server rule in update.mts): any
       space owner/editor may fix a teammate's description, category,
       envelope, event, date or location, but the amount and the accounts
       may only be changed by whoever owns the money — the source owner for
       expense/transfer/fee rows; for an adjustment, the owner of its
       account; for income, the owner of the receiving account OR whoever
       recorded the deposit. Locking those fields up-front beats a FORBIDDEN
       toast after the sheet has already closed. Only lock when we can SEE
       the account and know it isn't ours; an account outside this space
       isn't in the list, so we let the server decide for it. */
    const moneyLocked = useMemo(() => {
        const accounts = accountsQuery.data ?? [];
        const find = (id: string | null) => (id ? accounts.find((a) => a.id === id) : undefined);
        if (type === "income") {
            if (transaction.created_by === myUserId) return false;
            const dest = find(transaction.destination_account_id);
            return dest ? !ownedByMe(dest) : false;
        }
        if (type === "adjustment") {
            const acct = find(transaction.source_account_id ?? transaction.destination_account_id);
            return acct ? !ownedByMe(acct) : false;
        }
        const source = find(transaction.source_account_id);
        return source ? !ownedByMe(source) : false;
    }, [
        accountsQuery.data,
        type,
        myUserId,
        transaction.created_by,
        transaction.source_account_id,
        transaction.destination_account_id,
    ]);

    /* Transfer destinations: every account in this space except the source
       — same rule as NewTransactionSheet. */
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

    /* Same-frame double-submit lock. The sheet closes synchronously on
       submit, but the form is still in the DOM until React re-renders, so
       a second Enter/click in the same frame could fire a second update.
       Effectively single-use per mount: closing unmounts EditForm, so a
       reopened sheet always gets a fresh ref (onSettled clears it for the
       no-close case only — a failed submit that kept the form alive). */
    const submittingRef = useRef(false);
    const mutate = trpc.transaction.update.useMutation({
        onMutate: async (variables) => {
            await optimistic.cancelBoth();
            /* Only the columns this submit actually sends get patched:
               `undefined` means "leave unchanged" server-side, so it must
               mean the same in the cache. `prev` mirrors `patch`
               key-for-key from the row as the sheet opened it, so the
               error path can put exactly those columns back. */
            const patch: Record<string, unknown> = {};
            const prev: Record<string, unknown> = {};
            const put = (column: string, next: unknown, before: unknown) => {
                patch[column] = next;
                prev[column] = before;
            };
            if (variables.amount !== undefined) {
                // Numeric columns arrive as strings over the wire — keep
                // the optimistic value in the same shape the row already
                // has so every formatter treats it identically.
                put("amount", String(variables.amount), transaction.amount);
            }
            if (variables.datetime !== undefined) {
                put(
                    "transaction_datetime",
                    new Date(variables.datetime).toISOString(),
                    transaction.transaction_datetime
                );
            }
            if (variables.description !== undefined) {
                put("description", variables.description, transaction.description);
            }
            if (variables.location !== undefined) {
                put("location", variables.location, transaction.location);
            }
            if (variables.sourceAccountId !== undefined) {
                put("source_account_id", variables.sourceAccountId, transaction.source_account_id);
            }
            if (variables.destinationAccountId !== undefined) {
                put(
                    "destination_account_id",
                    variables.destinationAccountId,
                    transaction.destination_account_id
                );
            }
            if (variables.expenseCategoryId !== undefined) {
                put(
                    "expense_category_id",
                    variables.expenseCategoryId,
                    transaction.expense_category_id
                );
            }
            if (variables.envelopId !== undefined) {
                put("envelop_id", variables.envelopId, transaction.envelop_id);
            }
            if (variables.eventId !== undefined) {
                put("event_id", variables.eventId, transaction.event_id);
            }
            /* Blank the server-computed running balance whenever the edit
               invalidates it. Amount and "Balance after" are an arithmetic
               pair on a ledger row: showing the NEW amount beside the
               PRE-EDIT balance is two numbers that can't both be true, and
               the window isn't a frame — invalidating an infinite query
               refetches every loaded page. `rowBalanceEntries` renders an
               empty map as "—", which is the honest state until the server
               recomputes. Same stance as the create path, which seeds
               `account_balances_after: {}` for exactly this reason.
               Every input is COMPARED, not merely checked for presence: the
               form always sends the amount, and always sends whichever
               account its type owns, so a bare `!== undefined` blanked the
               balance even when the user changed nothing but a note. */
            const amountChanged =
                variables.amount !== undefined && variables.amount !== Number(transaction.amount);
            const sourceChanged =
                variables.sourceAccountId !== undefined &&
                variables.sourceAccountId !== transaction.source_account_id;
            const destinationChanged =
                variables.destinationAccountId !== undefined &&
                variables.destinationAccountId !== transaction.destination_account_id;
            if (amountChanged || sourceChanged || destinationChanged) {
                put(
                    "account_balances_after",
                    {},
                    (transaction as { account_balances_after?: unknown }).account_balances_after ??
                        null
                );
            }
            /* Row only — the IN/OUT/NET/AVG tiles are NOT patched here.
               `filteredTotals` is filtered on nine dimensions this form can
               all change, so an edit can move the row out of (or into) the
               counted set; a `next - previous` bump would then be wrong,
               not merely early. They resync on the invalidate() below.
               See the note in useOptimisticTransactionCache.ts. */
            optimistic.patchSavingRow(transaction.id, patch);
            return { prev };
        },
        onSuccess: async (_data, _variables, ctx) => {
            /* Clear the row's saving state BEFORE invalidating — the
               refetch reconciles to server truth (balances, fee row,
               ordering) but must never be the only thing that clears the
               spinner: it can fail or be cancelled silently. */
            if (ctx) optimistic.settleRow(transaction.id);
            toast.success("Transaction updated");
            await invalidate(spaceId);
        },
        onError: async (e, _variables, ctx) => {
            if (ctx) {
                optimistic.restoreRow(transaction.id, ctx.prev);
                // `prev` is the row as the sheet opened it, which a
                // refetch in between may have moved past — resync to
                // truth rather than trust the local restore.
                await invalidate(spaceId);
            }
            /* Name the row. The sheet is already gone by the time this fires,
               so an anonymous "changes didn't save" leaves a user who edited
               two rows in a row unable to tell WHICH one reverted.
               Deliberately the PRE-EDIT identity rather than `variables`: the
               row has just been rolled back, so naming the attempted amount
               and date would point at figures that appear nowhere on screen. */
            const when = formatInAppTz(transaction.transaction_datetime, "MMM d");
            toast.error(
                `Couldn't save changes to that ${type} of ${transaction.amount} on ${when} — ${e.message}`,
                { duration: Infinity }
            );
        },
        onSettled: () => {
            submittingRef.current = false;
        },
    });

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
        if (submittingRef.current || mutate.isPending) return;
        const parsed = Number(amount);
        /* Skipped when locked: the amount isn't sent then, and a draft
           cleared before the lock engaged would otherwise block every
           submit with no way to fix the disabled field. */
        if (!moneyLocked && (!Number.isFinite(parsed) || parsed <= 0)) {
            toast.error("Amount must be greater than zero");
            return;
        }
        /* `fromInputDateTime` returns `new Date(NaN)` for any string its
           regex misses. That would throw inside onMutate at
           `.toISOString()`, and a throw there rejects the mutation BEFORE
           the request is ever sent — a silent no-save with no error. The
           date picker guards its own segments, so this is a backstop for
           the one field submit never validated. */
        const parsedDatetime = fromInputDateTime(datetime);
        if (!Number.isFinite(parsedDatetime.getTime())) {
            toast.error("Pick a valid date and time");
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
        submittingRef.current = true;
        /* When the money fields are locked, send none of them. If the lock
           flipped on after the field had already taken focus (accounts
           loading), a stray draft could otherwise reach the server and be
           rejected after the sheet has closed. */
        mutate.mutate({
            transactionId: transaction.id,
            amount: moneyLocked ? undefined : parsed,
            /* Parent-owned on a fee row (the server re-syncs both from the
               transfer), so send nothing rather than echo a value we don't
               control — same stance as `sendSource` below. */
            datetime: isFeeExpense ? undefined : parsedDatetime,
            description: description.trim() === "" ? null : description.trim(),
            location: location.trim() === "" ? null : location.trim(),
            sourceAccountId: moneyLocked ? undefined : sendSource,
            destinationAccountId:
                moneyLocked || type === "expense" || type === "adjustment"
                    ? undefined
                    : destinationAccountId || null,
            expenseCategoryId: type === "expense" ? categoryId : undefined,
            envelopId: envelopeChanged ? envelopeId : undefined,
            eventId:
                type === "adjustment" || isFeeExpense ? undefined : eventId === "" ? null : eventId,
        });
        /* Close immediately — the edited row shows the new values with a
           saving spinner, and onError rolls it back with a persistent
           toast. Mirrors the create path in NewTransactionSheet. */
        onDone();
    };

    return (
        <form id="edit-tx-form" className="nt-form" onSubmit={submit}>
            {isFeeExpense && (
                /* Says what is actually true of this form. The previous copy
                   sent the user to the parent transfer to change the fee's
                   amount — but the amount field right below IS editable and
                   does save, while the transfer's own edit form has no fee
                   controls at all, so the instruction pointed at a screen
                   that doesn't exist. Only the account is locked (the select
                   below is disabled, and the submit sends no source for fee
                   rows so it can't drift from its parent). */
                <OrbitInfoPill tone="transfer">
                    This is a transfer fee. Its account, date, and event follow the parent transfer
                    and are locked here —{" "}
                    {moneyLocked
                        ? "the category, envelope, and notes are yours to edit."
                        : "the amount, category, envelope, and notes are yours to edit."}
                </OrbitInfoPill>
            )}
            {moneyLocked && (
                <OrbitInfoPill tone="gold">
                    {type === "income"
                        ? "You can edit the details. The amount and account are locked — only the account's owner or whoever recorded this can change them."
                        : type === "adjustment"
                          ? "You can edit the details. The amount and account are locked — only the account's owner can change them."
                          : "You can edit the details. The amount and accounts are locked — only the owner of the paying account can change them."}
                </OrbitInfoPill>
            )}

            {/* autoFocus waits for the account list: if `moneyLocked` flips
                to true after the field has already taken focus, focus drops
                to <body> and the mobile keyboard flashes. */}
            <OrbitAmountCard
                value={amount}
                onChange={setAmount}
                tone={meta.tone}
                autoFocus={accountsQuery.isSuccess && !moneyLocked}
                disabled={moneyLocked}
            />

            {type !== "adjustment" &&
                (isFeeExpense ? (
                    /* A fee's date is the parent transfer's date: the server
                       re-syncs it on every transfer edit (see update.mts), so
                       an editable field here would accept a value and then
                       silently lose it the next time the parent changed. Show
                       it, locked, instead of lying about it. */
                    <OrbitField label="Date" hint="Locked — follows the parent transfer">
                        <OrbitInput
                            value={formatInAppTz(
                                fromInputDateTime(datetime),
                                "MMM d, yyyy · h:mm a"
                            )}
                            readOnly
                            disabled
                        />
                    </OrbitField>
                ) : (
                    <OrbitField label="Date">
                        <TransactionDatePicker value={datetime} onChange={setDatetime} />
                    </OrbitField>
                ))}

            {type === "income" && (
                <OrbitField
                    label="Into account"
                    required
                    hint={moneyLocked ? "Locked — see note above" : undefined}
                >
                    <OrbitSelect
                        value={destinationAccountId}
                        onValueChange={setDest}
                        items={allItems}
                        placeholder="Choose account"
                        leadIcon={<Wallet className="size-3.5" />}
                        leadColor="var(--ent-1)"
                        disabled={moneyLocked}
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
                                : moneyLocked
                                  ? "Locked — see note above"
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
                            disabled={isFeeExpense || moneyLocked}
                        />
                    </OrbitField>
                    {!isFeeExpense && (
                        <SourceOverspendHint
                            account={sourceAccountForHint}
                            additionalDebit={editAdditionalDebit}
                        />
                    )}
                    <OrbitField
                        label="Category"
                        hint="Tag for what the spend was"
                        required
                        noWrapperLabel
                    >
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
                    <OrbitField
                        label="From"
                        required
                        hint={moneyLocked ? "Locked — see note above" : undefined}
                    >
                        <OrbitSelect
                            value={sourceAccountId}
                            onValueChange={setSource}
                            items={spendableItems}
                            placeholder="Choose source"
                            leadIcon={<Wallet className="size-3.5" />}
                            leadColor="var(--ent-1)"
                            disabled={moneyLocked}
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
                    <OrbitField
                        label="To"
                        required
                        hint={moneyLocked ? "Locked — see note above" : "Any account in this space"}
                    >
                        <OrbitSelect
                            value={destinationAccountId}
                            onValueChange={setDest}
                            items={destItems}
                            placeholder="Choose destination"
                            leadIcon={<Wallet className="size-3.5" />}
                            leadColor="var(--ent-3)"
                            disabled={moneyLocked}
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
                                <OrbitField
                                    label="Link to event"
                                    /* Same reason as the Date field above: the
                                       server keeps a fee's event in lockstep
                                       with its parent transfer. */
                                    hint={
                                        isFeeExpense
                                            ? "Locked — follows the parent transfer"
                                            : "Optional"
                                    }
                                >
                                    <OrbitSelect
                                        value={eventId || "__none"}
                                        onValueChange={(v) => setEventId(v === "__none" ? "" : v)}
                                        items={eventItems}
                                        placeholder="No event"
                                        disabled={isFeeExpense}
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
