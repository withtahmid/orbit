import { useState, type ReactNode } from "react";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { EntityStyleFields } from "@/components/shared/EntityStyleFields";
import { FileUploadField } from "@/components/file-upload-field";
import { trpc } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { DEFAULT_COLOR } from "@/lib/entityStyle";
import { toInputDateTime, fromInputDateTime } from "@/lib/dates";
import type { EventTotal } from "./types";

export function CreateOrEditEventDialog({
    event,
    trigger,
    onOpenChange,
    initialOpen,
}: {
    event?: EventTotal;
    trigger?: ReactNode;
    onOpenChange?: (open: boolean) => void;
    initialOpen?: boolean;
}) {
    const { space } = useCurrentSpace();
    const editing = !!event;
    const [open, setOpen] = useState(!!initialOpen);
    const [name, setName] = useState(event?.name ?? "");
    const [start, setStart] = useState(toInputDateTime(event?.startTime ?? null));
    const [end, setEnd] = useState(toInputDateTime(event?.endTime ?? null));
    const [color, setColor] = useState(event?.color ?? DEFAULT_COLOR);
    const [icon, setIcon] = useState(event?.icon ?? "calendar-days");
    const [description, setDescription] = useState(event?.description ?? "");
    const [estimatedAmount, setEstimatedAmount] = useState(
        event?.estimatedAmount != null ? String(event.estimatedAmount) : ""
    );
    const [attachmentFileIds, setAttachmentFileIds] = useState<string[]>([]);
    const utils = trpc.useUtils();

    const setOpenAndNotify = (next: boolean) => {
        setOpen(next);
        onOpenChange?.(next);
    };

    const invalidate = async () => {
        await utils.event.listBySpace.invalidate({ spaceId: space.id });
        await utils.analytics.eventTotals.invalidate({ spaceId: space.id });
        if (event) {
            await utils.event.getById.invalidate({ eventId: event.eventId });
        }
    };

    const create = trpc.event.create.useMutation({
        onSuccess: async () => {
            toast.success("Event created");
            await invalidate();
            setOpenAndNotify(false);
        },
        onError: (e) => toast.error(e.message),
    });
    const update = trpc.event.update.useMutation({
        onSuccess: async () => {
            toast.success("Event updated");
            await invalidate();
            setOpenAndNotify(false);
        },
        onError: (e) => toast.error(e.message),
    });
    const pending = create.isPending || update.isPending;

    /* Parse the estimate input: empty string → null, anything else
       must be a non-negative finite number. Zero collapses to null
       so we don't render a divide-by-zero progress bar. */
    const parseEstimate = (raw: string): number | null => {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n;
    };

    return (
        <Dialog open={open} onOpenChange={setOpenAndNotify}>
            <DialogTrigger asChild>
                {trigger ??
                    (editing ? (
                        <Button size="icon" variant="ghost" className="size-7">
                            <Pencil className="size-3.5" />
                        </Button>
                    ) : (
                        <Button variant="gradient">
                            <Plus />
                            New event
                        </Button>
                    ))}
            </DialogTrigger>
            {/* Scroll lives on an inner wrapper: shadcn's DialogContent is transformed
                (translate -50%), which makes it the containing block for the pickers'
                position:fixed popovers — overflow on it would clip them. */}
            <DialogContent className="max-h-none overflow-visible sm:max-w-lg">
                <div className="grid max-h-[calc(100dvh-5rem)] gap-4 overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editing ? "Edit event" : "Create event"}</DialogTitle>
                        <DialogDescription>
                            Events group related transactions (weddings, trips, etc).
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="grid gap-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!name.trim() || !start || !end) return;
                            const estimate = parseEstimate(estimatedAmount);
                            if (editing) {
                                update.mutate({
                                    eventId: event!.eventId,
                                    name: name.trim(),
                                    startTime: fromInputDateTime(start),
                                    endTime: fromInputDateTime(end),
                                    color,
                                    icon,
                                    description: description.trim() || null,
                                    estimatedAmount: estimate,
                                    addAttachmentFileIds:
                                        attachmentFileIds.length > 0
                                            ? attachmentFileIds
                                            : undefined,
                                });
                            } else {
                                create.mutate({
                                    spaceId: space.id,
                                    name: name.trim(),
                                    startTime: fromInputDateTime(start),
                                    endTime: fromInputDateTime(end),
                                    color,
                                    icon,
                                    description: description.trim() || undefined,
                                    estimatedAmount: estimate,
                                    attachmentFileIds:
                                        attachmentFileIds.length > 0
                                            ? attachmentFileIds
                                            : undefined,
                                });
                            }
                        }}
                    >
                        <div className="grid gap-1.5">
                            <Label htmlFor="ev-name">Name</Label>
                            <Input
                                id="ev-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                                autoFocus
                            />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="grid gap-1.5">
                                <Label htmlFor="ev-start">Starts</Label>
                                <Input
                                    id="ev-start"
                                    type="datetime-local"
                                    value={start}
                                    onChange={(e) => setStart(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="ev-end">Ends</Label>
                                <Input
                                    id="ev-end"
                                    type="datetime-local"
                                    value={end}
                                    onChange={(e) => setEnd(e.target.value)}
                                    required
                                />
                            </div>
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="ev-est">Estimated spend (optional)</Label>
                            <Input
                                id="ev-est"
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                placeholder="e.g. 50000"
                                value={estimatedAmount}
                                onChange={(e) => setEstimatedAmount(e.target.value)}
                            />
                            <span className="text-[11.5px] text-muted-foreground">
                                Tracks progress on the event card. Edit any time.
                            </span>
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="ev-desc">Description (optional)</Label>
                            <Textarea
                                id="ev-desc"
                                rows={2}
                                maxLength={2000}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>
                        <EntityStyleFields
                            defaultIcon={event?.icon ?? "calendar-days"}
                            name={name}
                            color={color}
                            setColor={setColor}
                            icon={icon}
                            setIcon={setIcon}
                        />
                        <FileUploadField
                            purpose="event_attachment"
                            fileIds={attachmentFileIds}
                            onChange={setAttachmentFileIds}
                        />
                        <DialogFooter className="gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setOpenAndNotify(false)}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" variant="gradient" disabled={pending}>
                                {pending ? "Saving…" : editing ? "Save" : "Create"}
                            </Button>
                        </DialogFooter>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    );
}
