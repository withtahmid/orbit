import { useRef } from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2, Paperclip, Pencil, Trash2, X } from "lucide-react";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Separator } from "@/components/ui/separator";
import { MoneyDisplay } from "@/components/shared/MoneyDisplay";
import { TransactionTypeBadge } from "@/components/shared/TransactionTypeBadge";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { trpc } from "@/trpc";
import { formatInAppTz } from "@/lib/formatDate";

type TxType = "income" | "expense" | "transfer" | "adjustment";

type Transaction = {
    id: string;
    space_id: string;
    type: unknown;
    amount: string | number;
    source_account_id: string | null;
    destination_account_id: string | null;
    description: string | null;
    location: string | null;
    transaction_datetime: Date | string;
    created_at: Date | string;
    event_id: string | null;
    expense_category_id: string | null;
    created_by: string;
    created_by_first_name?: string | null;
    created_by_last_name?: string | null;
    created_by_avatar_file_id?: string | null;
    /**
     * Non-null on a fee-expense row that mirrors a transfer's fee.
     * Points at the originating transfer; deleting that transfer
     * cascades to this row.
     */
    parent_transfer_id?: string | null;
};

type Props = {
    transaction: Transaction | null;
    open: boolean;
    onClose: () => void;
    accountsById: Map<string, { name: string }>;
    categoriesById: Map<string, { name: string }>;
    eventsById: Map<string, { name: string }>;
    /** Ownership: the caller may modify this transaction at all. Gates
     *  Delete and the attachment controls as well as Edit. */
    canEdit: boolean;
    /**
     * True while this row's own update is still in flight. Gates ONLY the
     * Edit hand-off — re-editing mid-flight would snapshot already-
     * optimistic values as the rollback baseline. Delete and attachments
     * stay available on purpose: nothing guarantees the in-flight flag ever
     * clears (a hung request leaves it set), and a row that can't be
     * deleted or have its receipts touched, with no explanation, is the
     * same dead end this state was designed to avoid.
     */
    isSaving?: boolean;
    /**
     * Hand off to the page-level edit sheet. The page is expected to
     * close the details sheet itself; this is just the "user clicked
     * Edit" signal.
     */
    onEdit?: () => void;
    /**
     * Confirm + delete the transaction. The page is expected to run
     * the mutation and close the details sheet; this is just the
     * "user confirmed Delete" signal.
     */
    onDelete?: () => void;
};

export function TransactionDetailsSheet({
    transaction,
    open,
    onClose,
    accountsById,
    categoriesById,
    eventsById,
    canEdit,
    isSaving,
    onEdit,
    onDelete,
}: Props) {
    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
                {transaction ? (
                    <Details
                        transaction={transaction}
                        accountsById={accountsById}
                        categoriesById={categoriesById}
                        eventsById={eventsById}
                        canEdit={canEdit}
                        isSaving={isSaving}
                        onEdit={onEdit}
                        onDelete={onDelete}
                    />
                ) : (
                    <div className="p-8 text-sm text-muted-foreground">No transaction</div>
                )}
            </SheetContent>
        </Sheet>
    );
}

function Details({
    transaction,
    accountsById,
    categoriesById,
    eventsById,
    canEdit,
    isSaving,
    onEdit,
    onDelete,
}: {
    transaction: Transaction;
    accountsById: Map<string, { name: string }>;
    categoriesById: Map<string, { name: string }>;
    eventsById: Map<string, { name: string }>;
    canEdit: boolean;
    isSaving?: boolean;
    onEdit?: () => void;
    onDelete?: () => void;
}) {
    const type = transaction.type as unknown as TxType;
    const variant = type === "income" ? "income" : type === "expense" ? "expense" : "transfer";
    const attachments = trpc.file.listForTransaction.useQuery({
        transactionId: transaction.id,
    });
    const utils = trpc.useUtils();

    const source = transaction.source_account_id
        ? accountsById.get(transaction.source_account_id)?.name
        : null;
    const destination = transaction.destination_account_id
        ? accountsById.get(transaction.destination_account_id)?.name
        : null;
    const category = transaction.expense_category_id
        ? categoriesById.get(transaction.expense_category_id)?.name
        : null;
    const event = transaction.event_id ? eventsById.get(transaction.event_id)?.name : null;

    return (
        <>
            <SheetHeader className="border-b border-border p-5">
                {/* pr-10 clears Radix's absolutely-positioned close × in
                    the top-right of SheetContent so the action buttons on
                    this row don't sit flush against the X. */}
                <SheetTitle className="flex items-center justify-between gap-2 pr-10">
                    <span className="flex items-center gap-2">
                        Transaction details
                        <TransactionTypeBadge type={type} />
                    </span>
                    {canEdit && (onEdit || onDelete) && (
                        <span className="flex items-center gap-2">
                            {onEdit && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={onEdit}
                                    /* No `title`: shadcn's base button sets
                                       disabled:pointer-events-none, so a tooltip
                                       on it can never fire. The role="status"
                                       note in the body carries the reason. */
                                    disabled={isSaving}
                                >
                                    <Pencil className="size-3" />
                                    Edit
                                </Button>
                            )}
                            {onDelete && (
                                <ConfirmDialog
                                    trigger={
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="gap-1.5 text-[color:var(--destructive,#ef4444)] hover:text-[color:var(--destructive,#ef4444)]"
                                        >
                                            <Trash2 className="size-3" />
                                            Delete
                                        </Button>
                                    }
                                    title="Delete transaction?"
                                    description="Balances will update automatically."
                                    confirmLabel="Delete"
                                    destructive
                                    onConfirm={onDelete}
                                />
                            )}
                        </span>
                    )}
                </SheetTitle>
                <SheetDescription className="flex items-baseline justify-between">
                    <span>
                        {formatInAppTz(transaction.transaction_datetime, "MMM d, yyyy · h:mm a")}
                    </span>
                    <MoneyDisplay
                        amount={transaction.amount}
                        variant={variant}
                        className="text-lg font-bold"
                    />
                </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
                {/* Say why Edit is disabled. Without this the button is just
                    greyed out with no cause — and the values shown below are
                    the optimistic ones, so the sheet would otherwise look
                    like it had simply stopped working. role="status" so the
                    reason reaches AT too. */}
                {isSaving && (
                    <p
                        role="status"
                        className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                    >
                        <Loader2 className="size-3 shrink-0 animate-spin" />
                        Saving your last change — editing is available in a moment.
                    </p>
                )}
                <dl className="grid gap-2 text-sm">
                    {source && <Row label="From">{source}</Row>}
                    {destination && <Row label="To">{destination}</Row>}
                    {category && <Row label="Category">{category}</Row>}
                    {event && <Row label="Event">{event}</Row>}
                    {transaction.location && <Row label="Location">{transaction.location}</Row>}
                    {transaction.description && (
                        <Row label="Note">
                            <span className="whitespace-pre-wrap">{transaction.description}</span>
                        </Row>
                    )}
                    <Row label="Created by">
                        <span className="inline-flex items-center gap-2">
                            <UserAvatar
                                fileId={transaction.created_by_avatar_file_id}
                                firstName={transaction.created_by_first_name}
                                lastName={transaction.created_by_last_name}
                                size="xs"
                            />
                            {transaction.created_by_first_name ?? "Unknown"}{" "}
                            {transaction.created_by_last_name ?? ""}
                        </span>
                    </Row>
                </dl>

                <Separator />

                <section className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Attachments</h3>
                        {canEdit && (
                            <AttachButton
                                transactionId={transaction.id}
                                onDone={() => {
                                    void utils.file.listForTransaction.invalidate({
                                        transactionId: transaction.id,
                                    });
                                }}
                            />
                        )}
                    </div>
                    {attachments.isLoading ? (
                        <p className="text-xs text-muted-foreground">Loading…</p>
                    ) : (attachments.data?.length ?? 0) === 0 ? (
                        <p className="text-xs text-muted-foreground">No attachments yet.</p>
                    ) : (
                        <ul className="grid grid-cols-2 gap-3">
                            {attachments.data!.map((a) => (
                                <AttachmentCard
                                    key={a.id}
                                    fileId={a.id}
                                    mimeType={a.mimeType}
                                    name={a.originalName}
                                    transactionId={transaction.id}
                                    canRemove={canEdit}
                                    onRemoved={() => {
                                        void utils.file.listForTransaction.invalidate({
                                            transactionId: transaction.id,
                                        });
                                    }}
                                />
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[100px_1fr] items-baseline gap-3 border-b border-border/40 py-1.5 last:border-b-0">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{children}</dd>
        </div>
    );
}

function AttachButton({ transactionId, onDone }: { transactionId: string; onDone: () => void }) {
    const { upload, uploading } = useFileUpload();
    const update = trpc.transaction.update.useMutation();
    const inputRef = useRef<HTMLInputElement>(null);

    const onPick = async (file: File) => {
        try {
            const fileId = await upload(file, "transaction_receipt");
            await update.mutateAsync({
                transactionId,
                addAttachmentFileIds: [fileId],
            });
            toast.success("Attachment added");
            onDone();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Upload failed");
        }
    };

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading || update.isPending}
                onClick={() => inputRef.current?.click()}
            >
                {uploading || update.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                ) : (
                    <Paperclip className="size-3" />
                )}
                Add file
            </Button>
            <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onPick(f);
                    e.target.value = "";
                }}
            />
        </>
    );
}

function AttachmentCard({
    fileId,
    mimeType,
    name,
    transactionId,
    canRemove,
    onRemoved,
}: {
    fileId: string;
    mimeType: string;
    name: string;
    transactionId: string;
    canRemove: boolean;
    onRemoved: () => void;
}) {
    const isImage = mimeType.startsWith("image/");
    const { url, isLoading } = useSignedUrl(fileId);
    const remove = trpc.file.removeFromTransaction.useMutation({
        onSuccess: () => {
            toast.success("Removed");
            onRemoved();
        },
        onError: (e) => toast.error(e.message),
    });
    return (
        <li className="group relative overflow-hidden rounded-md border">
            <div className="flex aspect-square items-center justify-center bg-muted/40">
                {isLoading ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : isImage && url ? (
                    <img
                        src={url}
                        alt={name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <FileText className="size-8 text-muted-foreground" />
                )}
            </div>
            <div className="flex items-center justify-between gap-1 border-t border-border bg-background/90 px-2 py-1">
                <span className="truncate text-[11px]" title={name}>
                    {name}
                </span>
                <div className="flex items-center gap-0.5">
                    {url && (
                        <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                            title="Open"
                        >
                            <Download className="size-3" />
                        </a>
                    )}
                    {canRemove && (
                        <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:text-destructive"
                            onClick={() => remove.mutate({ transactionId, fileId })}
                            disabled={remove.isPending}
                            title="Remove"
                        >
                            {remove.isPending ? (
                                <Loader2 className="size-3 animate-spin" />
                            ) : (
                                <Trash2 className="size-3" />
                            )}
                        </button>
                    )}
                </div>
            </div>
        </li>
    );
}

// Unused but kept for future expansion; the attach flow uses AttachButton.
export const _UnusedXIcon = X;
