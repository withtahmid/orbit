import { Link, useParams, useNavigate } from "react-router-dom";
import {
    ArrowLeft,
    Clock,
    Loader2,
    Trash2,
    TrendingDown,
    TrendingUp,
    UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip as RTooltip,
    XAxis,
    YAxis,
} from "recharts";
import { PeriodSelector } from "@/components/shared/PeriodSelector";
import { usePeriod } from "@/hooks/usePeriod";
import { formatMoney } from "@/lib/money";
import {
    autoBucket,
    bucketLabelPattern,
    bucketTickPattern,
    BUCKET_LABEL,
    compactMoney,
    type Bucket,
    type BucketSelection,
} from "@/lib/chartBucket";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { AccountTypeBadge } from "@/components/shared/AccountTypeBadge";
import { MoneyDisplay } from "@/components/shared/MoneyDisplay";
import { TransactionTypeBadge } from "@/components/shared/TransactionTypeBadge";
import { PermissionGate } from "@/components/shared/PermissionGate";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { EntityStyleFields } from "@/components/shared/EntityStyleFields";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { ROUTES } from "@/router/routes";
import { formatInAppTz } from "@/lib/formatDate";

export default function AccountDetailPage() {
    const { space } = useCurrentSpace();
    const { accountId } = useParams<{ accountId: string }>();
    const navigate = useNavigate();
    const utils = trpc.useUtils();

    const accountsQuery = trpc.account.listBySpace.useQuery({ spaceId: space.id });
    const account = accountsQuery.data?.find((a) => a.id === accountId);

    const txQuery = trpc.transaction.listBySpace.useQuery(
        { spaceId: space.id, accountId, limit: 50 },
        { enabled: !!accountId }
    );

    const usersQuery = trpc.account.listUsers.useQuery(
        { accountId: accountId! },
        { enabled: !!accountId }
    );

    const del = trpc.account.delete.useMutation({
        onSuccess: async () => {
            toast.success("Account deleted");
            await utils.account.listBySpace.invalidate({ spaceId: space.id });
            navigate(ROUTES.spaceAccounts(space.id));
        },
        onError: (e) => toast.error(e.message),
    });

    if (accountsQuery.isLoading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (!account) {
        return (
            <div className="grid gap-4">
                <Button asChild variant="ghost" size="sm">
                    <Link to={ROUTES.spaceAccounts(space.id)}>
                        <ArrowLeft />
                        All accounts
                    </Link>
                </Button>
                <p className="text-muted-foreground">Account not found.</p>
            </div>
        );
    }

    return (
        <div className="grid gap-6">
            <Button asChild variant="ghost" size="sm" className="w-fit">
                <Link to={ROUTES.spaceAccounts(space.id)}>
                    <ArrowLeft />
                    All accounts
                </Link>
            </Button>
            <PageHeader
                title={account.name}
                description={
                    <span className="flex items-center gap-2">
                        <AccountTypeBadge type={account.account_type} />
                        <span className="text-sm text-muted-foreground">Current balance:</span>
                        <MoneyDisplay
                            amount={
                                account.account_type === "liability"
                                    ? -Number(account.balance)
                                    : Number(account.balance)
                            }
                            className="text-sm"
                        />
                    </span>
                }
            />

            <Tabs defaultValue="transactions">
                <TabsList className="h-auto flex-wrap">
                    <TabsTrigger value="transactions">Transactions</TabsTrigger>
                    <TabsTrigger value="history">Balance history</TabsTrigger>
                    <TabsTrigger value="shared">Shared with</TabsTrigger>
                    <TabsTrigger value="members">Members</TabsTrigger>
                    <PermissionGate roles={["owner"]}>
                        <TabsTrigger value="settings">Settings</TabsTrigger>
                    </PermissionGate>
                </TabsList>

                <TabsContent value="history">
                    <AccountBalanceHistoryTab
                        spaceId={space.id}
                        accountId={account.id}
                        accountColor={account.color}
                    />
                </TabsContent>

                <TabsContent value="shared">
                    <SharedSpacesTab accountId={account.id} currentSpaceId={space.id} />
                </TabsContent>

                <TabsContent value="transactions">
                    <Card className="p-0">
                        {txQuery.isLoading ? (
                            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                        ) : !txQuery.data || txQuery.data.items.length === 0 ? (
                            <div className="p-6 text-center text-sm text-muted-foreground">
                                No transactions for this account yet.
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Description</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead className="text-right">Balance</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {txQuery.data.items.map((t) => {
                                        const isIncoming = t.destination_account_id === account.id;
                                        return (
                                            <TableRow key={t.id}>
                                                <TableCell className="text-muted-foreground">
                                                    {formatInAppTz(t.transaction_datetime, "MMM d")}
                                                </TableCell>
                                                <TableCell>
                                                    {/* kysely-codegen misreads
                                                        the transaction-type enum
                                                        as an array; the runtime
                                                        value is a scalar string.
                                                        Repo-wide workaround. */}
                                                    <TransactionTypeBadge
                                                        type={
                                                            t.type as unknown as
                                                                | "income"
                                                                | "expense"
                                                                | "transfer"
                                                                | "adjustment"
                                                        }
                                                    />
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground">
                                                    {t.description ?? "—"}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <MoneyDisplay
                                                        amount={t.amount}
                                                        variant={isIncoming ? "income" : "expense"}
                                                        signed
                                                    />
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {t.account_balances_after?.[account.id] !=
                                                    null ? (
                                                        <MoneyDisplay
                                                            amount={
                                                                t.account_balances_after[account.id]
                                                            }
                                                        />
                                                    ) : (
                                                        <span className="text-muted-foreground">
                                                            —
                                                        </span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </Card>
                </TabsContent>

                <TabsContent value="members">
                    <Card className="p-0">
                        {usersQuery.isLoading ? (
                            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Role</TableHead>
                                        <TableHead className="w-12" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {(usersQuery.data ?? []).map((u) => (
                                        <TableRow key={u.id}>
                                            <TableCell className="font-medium">
                                                <span className="inline-flex items-center gap-2">
                                                    <UserAvatar
                                                        fileId={u.avatar_file_id}
                                                        firstName={u.first_name}
                                                        lastName={u.last_name}
                                                        size="sm"
                                                    />
                                                    {u.first_name} {u.last_name}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {u.email}
                                            </TableCell>
                                            <TableCell className="capitalize">{u.role}</TableCell>
                                            <TableCell>
                                                <PermissionGate roles={["owner"]}>
                                                    <RemoveAccountMember
                                                        accountId={account.id}
                                                        userId={u.id}
                                                    />
                                                </PermissionGate>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                        <PermissionGate roles={["owner"]}>
                            <AddAccountMember accountId={account.id} />
                        </PermissionGate>
                    </Card>
                </TabsContent>

                <TabsContent value="settings">
                    <Card>
                        <CardHeader>
                            <CardTitle>Account settings</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <AccountAppearanceForm
                                accountId={account.id}
                                currentName={account.name}
                                currentColor={account.color}
                                currentIcon={account.icon}
                            />
                        </CardContent>
                    </Card>
                    <Card className="mt-6 border-destructive/40">
                        <CardHeader>
                            <CardTitle className="text-destructive">Danger zone</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ConfirmDialog
                                trigger={
                                    <Button variant="destructive">
                                        <Trash2 />
                                        Delete account
                                    </Button>
                                }
                                title="Delete this account?"
                                description="This will remove the account and all its transactions from this space."
                                confirmLabel="Delete"
                                destructive
                                typedConfirmationText={account.name}
                                onConfirm={() => del.mutate({ accountId: account.id })}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

function AccountAppearanceForm({
    accountId,
    currentName,
    currentColor,
    currentIcon,
}: {
    accountId: string;
    currentName: string;
    currentColor: string;
    currentIcon: string;
}) {
    const utils = trpc.useUtils();
    const [name, setName] = useState(currentName);
    const [color, setColor] = useState(currentColor);
    const [icon, setIcon] = useState(currentIcon);

    const update = trpc.account.update.useMutation({
        onSuccess: async () => {
            toast.success("Account updated");
            await utils.account.listBySpace.invalidate();
            await utils.account.listByUser.invalidate();
        },
        onError: (e) => toast.error(e.message),
    });

    const dirty = name.trim() !== currentName || color !== currentColor || icon !== currentIcon;

    return (
        <form
            className="grid gap-4"
            onSubmit={(e) => {
                e.preventDefault();
                if (!dirty || !name.trim()) return;
                update.mutate({
                    accountId,
                    name: name.trim() !== currentName ? name.trim() : undefined,
                    color: color !== currentColor ? color : undefined,
                    icon: icon !== currentIcon ? icon : undefined,
                });
            }}
        >
            <div className="grid gap-1.5">
                <Label htmlFor="account-name">Name</Label>
                <Input
                    id="account-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={currentName}
                    required
                />
            </div>
            <EntityStyleFields
                name={name}
                color={color}
                setColor={setColor}
                icon={icon}
                setIcon={setIcon}
            />
            <div className="flex justify-end">
                <Button type="submit" disabled={!dirty || update.isPending}>
                    {update.isPending ? "Saving…" : "Save changes"}
                </Button>
            </div>
        </form>
    );
}

function RemoveAccountMember({ accountId, userId }: { accountId: string; userId: string }) {
    const utils = trpc.useUtils();
    const remove = trpc.account.removeMember.useMutation({
        onSuccess: async () => {
            toast.success("Removed from account");
            await utils.account.listUsers.invalidate({ accountId });
        },
        onError: (e) => toast.error(e.message),
    });
    return (
        <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => remove.mutate({ accountId, userIds: [userId] })}
            disabled={remove.isPending}
        >
            <Trash2 className="text-destructive" />
        </Button>
    );
}

function AddAccountMember({ accountId }: { accountId: string }) {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<"owner" | "viewer">("viewer");
    const utils = trpc.useUtils();

    const findUser = trpc.auth.findUserByEmail.useQuery(
        { email },
        { enabled: email.length > 3 && email.includes("@") }
    );
    const addMember = trpc.account.addMember.useMutation({
        onSuccess: async () => {
            toast.success("Member added");
            await utils.account.listUsers.invalidate({ accountId });
            setEmail("");
        },
        onError: (e) => toast.error(e.message),
    });

    return (
        <div className="grid gap-2 border-t border-border/60 p-4 sm:flex sm:items-end">
            <div className="grid flex-1 gap-2">
                <Label>Add member by email</Label>
                <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@example.com"
                />
                {findUser.data && (
                    <p className="text-xs text-muted-foreground">
                        Found: {findUser.data.first_name} {findUser.data.last_name}
                    </p>
                )}
            </div>
            <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as "owner" | "viewer")}>
                    <SelectTrigger className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <Button
                onClick={() => {
                    if (!findUser.data) {
                        toast.error("No user found with that email");
                        return;
                    }
                    addMember.mutate({
                        accountId,
                        users: [{ id: findUser.data.id, role }],
                    });
                }}
                disabled={!findUser.data || addMember.isPending}
            >
                <UserPlus />
                Add
            </Button>
        </div>
    );
}

function SharedSpacesTab({
    accountId,
    currentSpaceId,
}: {
    accountId: string;
    currentSpaceId: string;
}) {
    const spacesQuery = trpc.account.listSpaces.useQuery({ accountId });
    const utils = trpc.useUtils();
    const unshare = trpc.account.unshareFromSpace.useMutation({
        onSuccess: async () => {
            toast.success("Account unshared from space");
            await Promise.all([
                utils.account.listSpaces.invalidate({ accountId }),
                utils.account.listBySpace.invalidate(),
                utils.account.listByUser.invalidate(),
            ]);
        },
        onError: (e) => toast.error(e.message),
    });

    return (
        <div className="grid gap-4">
            <Card>
                <CardHeader className="flex-row items-start justify-between gap-3">
                    <div>
                        <CardTitle className="text-base">Spaces</CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                            This account can be used in every space listed below. Each space keeps
                            its own transactions and allocations; only the cash balance is shared.
                        </p>
                    </div>
                    <PermissionGate roles={["owner", "editor"]}>
                        <ShareWithAnotherSpaceDialog
                            accountId={accountId}
                            alreadyIn={spacesQuery.data?.map((s) => s.spaceId) ?? []}
                        />
                    </PermissionGate>
                </CardHeader>
                <CardContent className="p-0">
                    {spacesQuery.isLoading ? (
                        <div className="p-4">
                            <Skeleton className="h-14 w-full" />
                        </div>
                    ) : (spacesQuery.data ?? []).length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground">No spaces linked.</div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Space</TableHead>
                                    <TableHead>Your role</TableHead>
                                    <TableHead>Shared since</TableHead>
                                    <TableHead className="w-28" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {(spacesQuery.data ?? []).map((s) => {
                                    const isCurrent = s.spaceId === currentSpaceId;
                                    const isOnly = (spacesQuery.data ?? []).length === 1;
                                    return (
                                        <TableRow key={s.spaceId}>
                                            <TableCell>
                                                <span className="flex items-center gap-2">
                                                    <Link
                                                        to={ROUTES.space(s.spaceId)}
                                                        className="font-medium hover:text-primary"
                                                    >
                                                        {s.name}
                                                    </Link>
                                                    {isCurrent && (
                                                        <span className="rounded-sm bg-primary/15 px-1.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                                                            Current
                                                        </span>
                                                    )}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-sm capitalize text-muted-foreground">
                                                {s.myRole ?? "—"}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {formatInAppTz(s.sharedAt, "MMM d, yyyy")}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {!isOnly && (
                                                    <ConfirmDialog
                                                        trigger={
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="text-destructive"
                                                            >
                                                                Unshare
                                                            </Button>
                                                        }
                                                        title={`Unshare from ${s.name}?`}
                                                        description="Transactions and allocations in that space tied to this account must be removed first."
                                                        confirmLabel="Unshare"
                                                        destructive
                                                        onConfirm={() =>
                                                            unshare.mutate({
                                                                accountId,
                                                                spaceId: s.spaceId,
                                                            })
                                                        }
                                                    />
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function ShareWithAnotherSpaceDialog({
    accountId,
    alreadyIn,
}: {
    accountId: string;
    alreadyIn: string[];
}) {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const utils = trpc.useUtils();
    const spacesQuery = trpc.space.list.useQuery();

    const share = trpc.account.shareWithSpace.useMutation({
        onSuccess: async () => {
            toast.success("Account shared");
            await Promise.all([
                utils.account.listSpaces.invalidate({ accountId }),
                utils.account.listBySpace.invalidate(),
                utils.account.listByUser.invalidate(),
            ]);
            setSelected(null);
            setOpen(false);
        },
        onError: (e) => toast.error(e.message),
    });

    const alreadySet = new Set(alreadyIn);
    const candidates = (spacesQuery.data ?? []).filter(
        (s) => !alreadySet.has(s.id) && (s.myRole === "owner" || s.myRole === "editor")
    );

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="gradient" size="sm">
                    <UserPlus />
                    Share to another space
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Share this account</DialogTitle>
                    <DialogDescription>
                        Pick a space where you&apos;re an owner or editor. The account becomes
                        usable there &mdash; existing transactions stay where they are.
                    </DialogDescription>
                </DialogHeader>
                <div className="max-h-[50vh] overflow-y-auto">
                    {spacesQuery.isLoading ? (
                        <Skeleton className="h-24 w-full" />
                    ) : candidates.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            No eligible spaces. The account is already in every space you can share
                            to.
                        </p>
                    ) : (
                        <div className="grid gap-1.5">
                            {candidates.map((s) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => setSelected(s.id)}
                                    className={`flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:border-foreground/30 ${
                                        selected === s.id ? "border-primary/60 bg-primary/5" : ""
                                    }`}
                                >
                                    <span className="text-sm font-medium">{s.name}</span>
                                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                        {s.myRole}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="gradient"
                        disabled={!selected || share.isPending}
                        onClick={() => selected && share.mutate({ accountId, spaceId: selected })}
                    >
                        {share.isPending ? "Sharing…" : "Share"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function AccountBalanceHistoryTab({
    spaceId,
    accountId,
    accountColor,
}: {
    spaceId: string;
    accountId: string;
    accountColor: string;
}) {
    const { period } = usePeriod("last-3-months");
    const [bucketSelection, setBucketSelection] = useState<BucketSelection>("auto");
    const resolvedBucket = useMemo(
        () => autoBucket(period.start, period.end),
        [period.start, period.end]
    );
    const effectiveBucket: Bucket = bucketSelection === "auto" ? resolvedBucket : bucketSelection;

    const q = trpc.analytics.balanceHistory.useQuery({
        spaceId,
        accountIds: [accountId],
        periodStart: period.start,
        periodEnd: period.end,
        bucket: effectiveBucket,
    });

    // The server returns long-form rows keyed by accountId. Since we're
    // scoped to one account, fold directly into [{bucket, balance}].
    const series = useMemo(() => {
        if (!q.data) return [];
        return q.data.series
            .map((r) => ({
                bucket: typeof r.bucket === "string" ? r.bucket : new Date(r.bucket).toISOString(),
                balance: r.balance,
            }))
            .sort((a, b) => a.bucket.localeCompare(b.bucket));
    }, [q.data]);

    // Per-bucket delta = net flow into the account during that bucket.
    // First bucket has no predecessor, so its delta is 0 (rendered as
    // an empty bar, which keeps the x-axis aligned with the trend chart
    // above).
    const activity = useMemo(
        () =>
            series.map((row, i) => ({
                bucket: row.bucket,
                delta: i === 0 ? 0 : row.balance - series[i - 1].balance,
            })),
        [series]
    );

    const stats = useMemo(() => {
        if (series.length === 0) return null;
        const start = series[0].balance;
        const end = series[series.length - 1].balance;
        const change = end - start;
        const pct = start !== 0 ? (change / Math.abs(start)) * 100 : change === 0 ? 0 : null;
        return { start, end, change, pct };
    }, [series]);

    const gradId = `acct-history-grad-${accountId}`;

    return (
        <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
                <Select
                    value={bucketSelection}
                    onValueChange={(v) => setBucketSelection(v as BucketSelection)}
                >
                    <SelectTrigger className="w-full min-w-[10rem] sm:w-auto">
                        <Clock className="size-4 text-muted-foreground" />
                        <SelectValue>
                            {bucketSelection === "auto"
                                ? `Auto · ${BUCKET_LABEL[resolvedBucket]}`
                                : BUCKET_LABEL[bucketSelection]}
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="day">Day</SelectItem>
                        <SelectItem value="week">Week</SelectItem>
                        <SelectItem value="month">Month</SelectItem>
                        <SelectItem value="year">Year</SelectItem>
                    </SelectContent>
                </Select>
                <PeriodSelector defaultPreset="last-3-months" />
            </div>

            <Card>
                <CardContent className="grid grid-cols-1 gap-3 pt-6 sm:grid-cols-3">
                    <Stat label="Starting balance" value={stats?.start} />
                    <Stat label="Ending balance" value={stats?.end} />
                    <Stat
                        label="Net change"
                        value={stats?.change}
                        variant={
                            stats == null || stats.change === 0
                                ? "neutral"
                                : stats.change > 0
                                  ? "income"
                                  : "expense"
                        }
                        subtext={
                            stats?.pct == null
                                ? undefined
                                : `${stats.change >= 0 ? "+" : ""}${stats.pct.toFixed(1)}%`
                        }
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Balance trend</CardTitle>
                </CardHeader>
                <CardContent className="h-[340px] px-1 sm:h-[420px] sm:px-4">
                    {q.isLoading ? (
                        <Skeleton className="h-full w-full" />
                    ) : series.length === 0 ? (
                        <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            No balance data in this period yet.
                        </p>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                                data={series}
                                margin={{ top: 16, right: 16, bottom: 8, left: 0 }}
                            >
                                <defs>
                                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                                        <stop
                                            offset="0%"
                                            stopColor={accountColor}
                                            stopOpacity={0.45}
                                        />
                                        <stop
                                            offset="100%"
                                            stopColor={accountColor}
                                            stopOpacity={0}
                                        />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid
                                    strokeDasharray="2 6"
                                    stroke="var(--border)"
                                    vertical={false}
                                />
                                <XAxis
                                    dataKey="bucket"
                                    tickFormatter={(v) =>
                                        formatInAppTz(v, bucketTickPattern(effectiveBucket))
                                    }
                                    stroke="var(--muted-foreground)"
                                    fontSize={11}
                                    tickLine={false}
                                    axisLine={{ stroke: "var(--border)" }}
                                    tickMargin={8}
                                />
                                <YAxis
                                    stroke="var(--muted-foreground)"
                                    fontSize={11}
                                    width={56}
                                    tickFormatter={compactMoney}
                                    tickLine={false}
                                    axisLine={false}
                                    tickMargin={4}
                                />
                                <RTooltip
                                    contentStyle={{
                                        background: "var(--popover)",
                                        border: "1px solid var(--border)",
                                        borderRadius: 8,
                                    }}
                                    labelFormatter={(v) =>
                                        formatInAppTz(
                                            v as string,
                                            bucketLabelPattern(effectiveBucket)
                                        )
                                    }
                                    formatter={(value) => [
                                        formatMoney(Number(value ?? 0)),
                                        "Balance",
                                    ]}
                                    cursor={{
                                        stroke: "var(--muted-foreground)",
                                        strokeOpacity: 0.3,
                                        strokeDasharray: "3 3",
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="balance"
                                    stroke={accountColor}
                                    strokeWidth={2.25}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    fill={`url(#${gradId})`}
                                    activeDot={{
                                        r: 4,
                                        strokeWidth: 2,
                                        stroke: "var(--background)",
                                    }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        Activity per {BUCKET_LABEL[effectiveBucket].toLowerCase()}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        Net money flowing into (green) or out of (red) this account.
                    </p>
                </CardHeader>
                <CardContent className="h-[200px] px-1 sm:h-[240px] sm:px-4">
                    {q.isLoading ? (
                        <Skeleton className="h-full w-full" />
                    ) : activity.length === 0 ? (
                        <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            No activity yet.
                        </p>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={activity}
                                margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                            >
                                <CartesianGrid
                                    strokeDasharray="2 6"
                                    stroke="var(--border)"
                                    vertical={false}
                                />
                                <XAxis
                                    dataKey="bucket"
                                    tickFormatter={(v) =>
                                        formatInAppTz(v, bucketTickPattern(effectiveBucket))
                                    }
                                    stroke="var(--muted-foreground)"
                                    fontSize={11}
                                    tickLine={false}
                                    axisLine={{ stroke: "var(--border)" }}
                                    tickMargin={8}
                                />
                                <YAxis
                                    stroke="var(--muted-foreground)"
                                    fontSize={11}
                                    width={56}
                                    tickFormatter={compactMoney}
                                    tickLine={false}
                                    axisLine={false}
                                    tickMargin={4}
                                />
                                <RTooltip
                                    contentStyle={{
                                        background: "var(--popover)",
                                        border: "1px solid var(--border)",
                                        borderRadius: 8,
                                    }}
                                    labelFormatter={(v) =>
                                        formatInAppTz(
                                            v as string,
                                            bucketLabelPattern(effectiveBucket)
                                        )
                                    }
                                    formatter={(value) => {
                                        const n = Number(value ?? 0);
                                        return [
                                            `${n >= 0 ? "+" : ""}${formatMoney(n)}`,
                                            "Net change",
                                        ];
                                    }}
                                    cursor={{
                                        fill: "var(--muted-foreground)",
                                        fillOpacity: 0.08,
                                    }}
                                />
                                <Bar dataKey="delta" radius={[3, 3, 0, 0]} maxBarSize={20}>
                                    {activity.map((row, i) => (
                                        <Cell
                                            key={i}
                                            fill={
                                                row.delta > 0
                                                    ? "var(--primary)"
                                                    : row.delta < 0
                                                      ? "var(--destructive)"
                                                      : "var(--border)"
                                            }
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function Stat({
    label,
    value,
    variant = "neutral",
    subtext,
}: {
    label: string;
    value: number | null | undefined;
    variant?: "neutral" | "income" | "expense";
    subtext?: string;
}) {
    const Icon = variant === "income" ? TrendingUp : variant === "expense" ? TrendingDown : null;
    const tone =
        variant === "income"
            ? "text-emerald-500"
            : variant === "expense"
              ? "text-destructive"
              : "text-foreground";
    return (
        <div className="rounded-lg border border-border/60 bg-card/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <div className={`mt-1 flex items-baseline gap-2 text-lg font-bold ${tone}`}>
                {Icon && <Icon className="size-4" />}
                <span className="font-mono tabular-nums">
                    {value == null ? "—" : formatMoney(value)}
                </span>
            </div>
            {subtext && <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>}
        </div>
    );
}
