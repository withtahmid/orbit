import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { LogOut, Mail, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { PermissionGate } from "@/components/shared/PermissionGate";
import { RoleBadge } from "@/components/shared/RoleBadge";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/trpc";
import { useCurrentSpace, useIsOwner } from "@/hooks/useCurrentSpace";
import { ROUTES } from "@/router/routes";
import type { SpaceRole } from "@/lib/permissions";

export default function SpaceSettingsPage() {
    const { space, isPersonal } = useCurrentSpace();
    const isOwner = useIsOwner();
    const navigate = useNavigate();
    const utils = trpc.useUtils();

    const [newName, setNewName] = useState(space.name);
    const update = trpc.space.update.useMutation({
        onSuccess: async () => {
            toast.success("Space renamed");
            await utils.space.list.invalidate();
        },
        onError: (e) => toast.error(e.message),
    });
    const del = trpc.space.delete.useMutation({
        onSuccess: async () => {
            toast.success("Space deleted");
            await utils.space.list.invalidate();
            navigate(ROUTES.spaces, { replace: true });
        },
        onError: (e) => toast.error(e.message),
    });

    /**
     * The personal space is a synthesized virtual space — no members, no
     * roles, no danger zone, and any backend query taking a real `spaceId`
     * (memberList, listInvites, …) rejects "me" as a non-UUID. Redirect
     * instead of rendering.
     *
     * This guard MUST stay below every hook above. It used to sit at the
     * top of the component, which made `useState` and both `useMutation`
     * calls conditional: this route keeps one component instance across a
     * `:spaceId` param change, so going from `/s/me/settings` to
     * `/s/<uuid>/settings` flipped `isPersonal` true→false and the hook
     * count 0→3 — "Rendered more hooks than during the previous render",
     * i.e. a hard crash. The mutations below are lazy, so declaring them
     * for the personal case costs nothing.
     */
    if (isPersonal) {
        return <Navigate to={ROUTES.space(space.id)} replace />;
    }

    return (
        <div className="grid gap-6">
            <PageHeader title="Space settings" description="Manage this workspace" />

            <Tabs defaultValue="general">
                <TabsList>
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="members">Members</TabsTrigger>
                    <TabsTrigger value="danger">Danger</TabsTrigger>
                </TabsList>

                <TabsContent value="general">
                    <div className="grid gap-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Space name</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <form
                                    className="flex gap-2"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        if (!newName.trim() || newName.trim() === space.name)
                                            return;
                                        update.mutate({
                                            spaceId: space.id,
                                            name: newName.trim(),
                                        });
                                    }}
                                >
                                    <Input
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        disabled={!isOwner}
                                        maxLength={255}
                                    />
                                    {isOwner && (
                                        <Button
                                            type="submit"
                                            disabled={
                                                !newName.trim() ||
                                                newName.trim() === space.name ||
                                                update.isPending
                                            }
                                        >
                                            Save
                                        </Button>
                                    )}
                                </form>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="members" className="grid gap-4">
                    <MembersCard />
                    <PermissionGate roles={["owner", "editor"]}>
                        <PendingInvitesCard />
                    </PermissionGate>
                </TabsContent>

                <TabsContent value="danger" className="grid gap-4">
                    <LeaveSpaceCard />
                    {isOwner && (
                        <Card className="border-destructive/40">
                            <CardHeader>
                                <CardTitle className="text-destructive">Delete space</CardTitle>
                            </CardHeader>
                            <CardContent className="grid gap-3">
                                <p className="text-sm text-muted-foreground">
                                    Deleting the space removes all its accounts, transactions,
                                    envelopes, and categories. This cannot be undone.
                                </p>
                                <ConfirmDialog
                                    trigger={
                                        <Button variant="destructive" className="w-fit">
                                            <Trash2 />
                                            Delete this space
                                        </Button>
                                    }
                                    title="Delete this space?"
                                    description="All data will be permanently removed."
                                    confirmLabel="Delete"
                                    destructive
                                    typedConfirmationText={space.name}
                                    onConfirm={() => del.mutate({ spaceId: space.id })}
                                />
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}

function MembersCard() {
    const { space } = useCurrentSpace();
    const isOwner = useIsOwner();
    const membersQuery = trpc.space.memberList.useQuery({ spaceId: space.id });

    return (
        <Card className="p-0">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        {isOwner && <TableHead className="w-12" />}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {(membersQuery.data ?? []).map((m) => (
                        <TableRow key={m.id}>
                            <TableCell className="font-medium">
                                <span className="inline-flex items-center gap-2">
                                    <UserAvatar
                                        fileId={m.avatar_file_id}
                                        firstName={m.first_name}
                                        lastName={m.last_name}
                                        size="sm"
                                    />
                                    {m.first_name} {m.last_name}
                                </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{m.email}</TableCell>
                            <TableCell>
                                {/* kysely-codegen misreads the space-role
                                    Postgres enum as an array type, so the
                                    double cast is the repo-wide workaround
                                    (see useOptimisticTransactionCache.ts). The
                                    runtime value is a scalar role string. */}
                                {isOwner ? (
                                    <RoleSelect
                                        userId={m.id}
                                        role={m.role as unknown as SpaceRole}
                                    />
                                ) : (
                                    <RoleBadge role={m.role as unknown as SpaceRole} />
                                )}
                            </TableCell>
                            {isOwner && (
                                <TableCell>
                                    <RemoveMember userId={m.id} />
                                </TableCell>
                            )}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            <PermissionGate roles={["owner", "editor"]}>
                <InviteMember />
            </PermissionGate>
        </Card>
    );
}

function RoleSelect({ userId, role }: { userId: string; role: SpaceRole }) {
    const { space } = useCurrentSpace();
    const utils = trpc.useUtils();
    const change = trpc.space.changeMemberRole.useMutation({
        onSuccess: async () => {
            toast.success("Role updated");
            await utils.space.memberList.invalidate({ spaceId: space.id });
        },
        onError: (e) => toast.error(e.message),
    });
    return (
        <Select
            value={role}
            onValueChange={(v) =>
                change.mutate({
                    spaceId: space.id,
                    userId,
                    role: v as SpaceRole,
                })
            }
        >
            <SelectTrigger className="h-8 w-28">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
        </Select>
    );
}

function RemoveMember({ userId }: { userId: string }) {
    const { space } = useCurrentSpace();
    const utils = trpc.useUtils();
    const remove = trpc.space.removeMember.useMutation({
        onSuccess: async () => {
            toast.success("Member removed");
            await utils.space.memberList.invalidate({ spaceId: space.id });
        },
        onError: (e) => toast.error(e.message),
    });
    return (
        <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => remove.mutate({ spaceId: space.id, userIds: [userId] })}
            disabled={remove.isPending}
        >
            <Trash2 className="size-3.5 text-destructive" />
        </Button>
    );
}

function InviteMember() {
    const { space } = useCurrentSpace();
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<SpaceRole>("editor");
    const utils = trpc.useUtils();

    const invite = trpc.space.sendInvite.useMutation({
        onSuccess: async () => {
            toast.success("Invite sent");
            setEmail("");
            await utils.space.listInvites.invalidate({ spaceId: space.id });
        },
        onError: (e) => toast.error(e.message),
    });

    const valid = /.+@.+\..+/.test(email.trim());

    return (
        <div className="grid gap-2 border-t border-border/60 p-4 sm:flex sm:items-end">
            <div className="grid flex-1 gap-2">
                <Label>Invite by email</Label>
                <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@example.com"
                />
                <p className="text-xs text-muted-foreground">
                    They&apos;ll get a link to accept. Invites expire in 72 hours.
                </p>
            </div>
            <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as SpaceRole)}>
                    <SelectTrigger className="w-28">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <Button
                onClick={() => {
                    if (!valid) {
                        toast.error("Enter a valid email");
                        return;
                    }
                    invite.mutate({ spaceId: space.id, email: email.trim(), role });
                }}
                disabled={!valid || invite.isPending}
            >
                <UserPlus />
                {invite.isPending ? "Sending…" : "Send invite"}
            </Button>
        </div>
    );
}

function PendingInvitesCard() {
    const { space } = useCurrentSpace();
    const invitesQuery = trpc.space.listInvites.useQuery({ spaceId: space.id });
    const utils = trpc.useUtils();
    const revoke = trpc.space.revokeInvite.useMutation({
        onSuccess: async () => {
            toast.success("Invite revoked");
            await utils.space.listInvites.invalidate({ spaceId: space.id });
        },
        onError: (e) => toast.error(e.message),
    });

    const invites = invitesQuery.data ?? [];

    return (
        <Card>
            <CardHeader className="flex-row items-center gap-2">
                <Mail className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Pending invites</CardTitle>
            </CardHeader>
            {invites.length === 0 ? (
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        Sent invites will appear here until they&apos;re accepted, revoked, or
                        expire.
                    </p>
                </CardContent>
            ) : (
                <CardContent className="p-0">
                    <div className="hidden sm:block">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Invited by</TableHead>
                                    <TableHead>Expires</TableHead>
                                    <TableHead className="w-12" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {invites.map((inv) => {
                                    const expires = new Date(inv.expiresAt);
                                    return (
                                        <TableRow key={inv.id}>
                                            <TableCell className="font-medium break-all">
                                                {inv.email}
                                            </TableCell>
                                            <TableCell>
                                                <RoleBadge role={inv.role} />
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {inv.invitedByName}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {expires.toLocaleDateString(undefined, {
                                                    month: "short",
                                                    day: "numeric",
                                                })}
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="size-9"
                                                    onClick={() =>
                                                        revoke.mutate({
                                                            spaceId: space.id,
                                                            inviteId: inv.id,
                                                        })
                                                    }
                                                    disabled={revoke.isPending}
                                                    aria-label={`Revoke invite for ${inv.email}`}
                                                >
                                                    <X className="size-3.5 text-destructive" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                    <ul className="sm:hidden divide-y">
                        {invites.map((inv) => {
                            const expires = new Date(inv.expiresAt);
                            return (
                                <li key={inv.id} className="p-4 flex flex-col gap-2">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium break-all">{inv.email}</div>
                                            <div className="mt-1 flex items-center gap-2">
                                                <RoleBadge role={inv.role} />
                                                <span className="text-xs text-muted-foreground">
                                                    Invited by {inv.invitedByName}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs text-muted-foreground">
                                            Expires{" "}
                                            {expires.toLocaleDateString(undefined, {
                                                month: "short",
                                                day: "numeric",
                                            })}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="min-h-9 text-destructive"
                                            onClick={() =>
                                                revoke.mutate({
                                                    spaceId: space.id,
                                                    inviteId: inv.id,
                                                })
                                            }
                                            disabled={revoke.isPending}
                                            aria-label={`Revoke invite for ${inv.email}`}
                                        >
                                            <X className="size-3.5" />
                                            Revoke
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </CardContent>
            )}
        </Card>
    );
}

function LeaveSpaceCard() {
    const { space } = useCurrentSpace();
    const navigate = useNavigate();
    const utils = trpc.useUtils();
    const leave = trpc.space.leave.useMutation({
        onSuccess: async () => {
            toast.success("You left the space");
            await utils.space.list.invalidate();
            navigate(ROUTES.spaces, { replace: true });
        },
        onError: (e) => toast.error(e.message),
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle>Leave this space</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                    Removes your membership. The space and its data remain available to the other
                    members. If you&apos;re the sole owner, transfer ownership or delete the space
                    first.
                </p>
                <ConfirmDialog
                    trigger={
                        <Button variant="outline" className="w-fit">
                            <LogOut />
                            Leave space
                        </Button>
                    }
                    title={`Leave "${space.name}"?`}
                    description="You can be re-invited later."
                    confirmLabel={leave.isPending ? "Leaving…" : "Leave"}
                    onConfirm={() => leave.mutate({ spaceId: space.id })}
                />
            </CardContent>
        </Card>
    );
}
