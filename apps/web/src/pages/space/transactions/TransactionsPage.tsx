import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
    Plus,
    Search,
    X,
    Check,
    ChevronDown,
    CalendarClock,
    Coins,
    Calendar as CalendarIcon,
    FileText,
    ArrowDown,
    ArrowUp,
    ArrowRightLeft,
    Edit3,
    Loader2,
} from "lucide-react";
import { formatInAppTz } from "@/lib/formatDate";
import type { PeriodPresetId } from "@/lib/dates";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { getIcon } from "@/lib/entityIcons";
import { cn } from "@/lib/utils";
import { PermissionGate } from "@/components/shared/PermissionGate";
import { PeriodChip } from "@/components/shared/PeriodChip";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { EmptyState } from "@/components/shared/EmptyState";
import { Filter as FilterEmptyIcon, Receipt } from "lucide-react";
import { AnalyticsFilterBar } from "../analytics/components/AnalyticsFilterBar";
import { useAnalyticsFilters } from "../analytics/components/useAnalyticsFilters";
import { trpc } from "@/trpc";
import type { RouterOutput } from "@/trpc";
import { useInvalidateAnalytics } from "@/lib/invalidate";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { usePeriod } from "@/hooks/usePeriod";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { NewTransactionSheet } from "@/features/transactions/NewTransactionSheet";
import { EditTransactionSheet } from "@/features/transactions/EditTransactionSheet";
import { TransactionDetailsSheet } from "@/features/transactions/TransactionDetailsSheet";
import { ROUTES } from "@/router/routes";
import { useStore } from "@/stores/useStore";
import { UNALLOCATED_COLOR } from "@/lib/entityStyle";

type TxType = "income" | "expense" | "transfer" | "adjustment";

/** Per-row "balance after" entries — the account(s) a transaction moved,
    in From→To order (source then destination), each with that account's
    post-transaction balance. One entry for income/expense/adjustment, two
    for a transfer. Empty when the row has no balance data. */
type RowBalance = { accountId: string; balance: string; role: "source" | "dest" };
function rowBalanceEntries(t: {
    source_account_id: string | null;
    destination_account_id: string | null;
    account_balances_after?: Record<string, string> | null;
}): RowBalance[] {
    const map = t.account_balances_after ?? {};
    const out: RowBalance[] = [];
    if (t.source_account_id && map[t.source_account_id] != null) {
        out.push({
            accountId: t.source_account_id,
            balance: map[t.source_account_id],
            role: "source",
        });
    }
    if (t.destination_account_id && map[t.destination_account_id] != null) {
        out.push({
            accountId: t.destination_account_id,
            balance: map[t.destination_account_id],
            role: "dest",
        });
    }
    return out;
}

/** True for a client-synthesized optimistic row (see
 *  useOptimisticTransactionCache.ts) that hasn't been confirmed by the
 *  server yet — never present on a real row. */
const isPendingRow = (t: { id: string; __pending?: boolean }) => t.__pending === true;

/** A rendered list row — the page shows either the space list or its
 *  personal cross-space twin, so selection state carries the union. */
type TxRow =
    | RouterOutput["transaction"]["listBySpace"]["items"][number]
    | RouterOutput["personal"]["transactions"]["items"][number];

const TYPE_OPTIONS: Array<{ value: TxType | null; label: string }> = [
    { value: null, label: "All" },
    { value: "income", label: "Income" },
    { value: "expense", label: "Expense" },
    { value: "transfer", label: "Transfer" },
    { value: "adjustment", label: "Adjustment" },
];

/* Group a flat list of transactions into consecutive same-calendar-day
   buckets in the app timezone. The list arrives ordered by
   `transaction_datetime DESC`, so a single linear pass produces groups
   in display order with no extra sorting. Labels: "Today" / "Yesterday"
   for the recent two, day-name + date for older entries, with year
   appended once we cross years. */
type DayGroup<T> = { key: string; label: string; items: T[] };

function groupByDay<T extends { transaction_datetime: string | Date }>(
    items: T[],
    todayKey: string,
    yesterdayKey: string,
    thisYear: string
): DayGroup<T>[] {
    if (items.length === 0) return [];
    const groups: DayGroup<T>[] = [];
    for (const item of items) {
        const key = formatInAppTz(item.transaction_datetime, "yyyy-MM-dd");
        let group = groups[groups.length - 1];
        if (!group || group.key !== key) {
            let label: string;
            if (key === todayKey) label = "Today";
            else if (key === yesterdayKey) label = "Yesterday";
            else {
                const year = formatInAppTz(item.transaction_datetime, "yyyy");
                label =
                    year === thisYear
                        ? formatInAppTz(item.transaction_datetime, "EEEE, MMM d")
                        : formatInAppTz(
                              item.transaction_datetime,
                              "EEEE, MMM d, yyyy"
                          );
            }
            group = { key, label, items: [] };
            groups.push(group);
        }
        group.items.push(item);
    }
    return groups;
}

function DayHeader({ label }: { label: string }) {
    return (
        <div className="tx-day-header" role="separator">
            <span className="tx-day-label">{label}</span>
        </div>
    );
}

/** Single source of truth for the page's default period — `usePeriod` and
    `<PeriodChip>` below each read the URL independently, so they must be
    given the same default or they'd disagree on first load. */
const DEFAULT_PERIOD_PRESET: PeriodPresetId = "last-30-days";

const PERIOD_PRESETS: Array<{ value: string; label: string }> = [
    { value: "last-30-days", label: "Last 30 days" },
    { value: "this-month", label: "This month" },
    { value: "last-month", label: "Last month" },
    { value: "last-3-months", label: "Last 3 months" },
    { value: "last-12-months", label: "Last 12 months" },
    { value: "this-year", label: "This year" },
    { value: "all-time", label: "All time" },
];

export default function TransactionsPage() {
    const { space } = useCurrentSpace();
    const isPersonal = space.isPersonal;
    const { authStore } = useStore();
    const { period, preset } = usePeriod(DEFAULT_PERIOD_PRESET);
    /* Envelope / Account / Category multi-select — the same URL-backed
       (`env`/`acc`/`cat`) filter state the analytics Spending views use,
       via the shared AnalyticsFilterBar below. */
    const f = useAnalyticsFilters();

    const [params, setParams] = useSearchParams();
    const setParam = (key: string, v: string | null) =>
        setParams(
            (p) => {
                const next = new URLSearchParams(p);
                if (v === null || v === "") next.delete(key);
                else next.set(key, v);
                return next;
            },
            { replace: true }
        );

    const type = (params.get("type") as TxType | null) ?? null;
    // Envelopes/categories are space-scoped, so the AnalyticsFilterBar
    // hides them on the `/s/me` cross-space view; guard the query args to
    // match (a stale `env`/`cat` from a regular space must not silently
    // filter the personal list where there's no UI to clear it).
    const accountIdsArg = f.accountIdsArg;
    // Categories work on the personal cross-space view too (the bar sources
    // them from personal.listCategories); envelopes stay space-only.
    const categoryIdsArg = f.categoryIdsArg;
    const envelopIdsArg = isPersonal ? undefined : f.envelopeIdsArg;
    // Events are space-scoped and the Event chip is hidden on the personal
    // cross-space view — treat a stale `?event=` as absent there so it can't
    // silently filter the list with no UI to clear it (mirrors env/cat).
    const eventId = isPersonal ? null : params.get("event");
    const userId = params.get("user");
    const searchRaw = params.get("q") ?? "";
    const amountMin = params.get("min");
    const amountMax = params.get("max");
    const search = useDebouncedValue(searchRaw, 300);

    /* The Balance column always shows. With exactly one account selected it
       reads as a clean running balance (statement mode: dots hidden, caption
       shown); across accounts each row shows its own account's balance —
       two lines for a transfer. */
    const singleAccountId =
        f.accountIds.length === 1 ? f.accountIds[0] : null;
    const isStatementMode = !!singleAccountId;

    const accountsSpaceQuery = trpc.account.listBySpace.useQuery(
        { spaceId: space.id },
        { enabled: !isPersonal }
    );
    const accountsPersonalQuery = trpc.personal.ownedAccounts.useQuery(undefined, {
        enabled: isPersonal,
    });
    const accountsData = isPersonal
        ? (accountsPersonalQuery.data ?? []).map((a) => ({
              id: a.id,
              name: a.name,
              color: a.color,
              icon: a.icon,
          }))
        : (accountsSpaceQuery.data ?? []).map((a) => ({
              id: a.id,
              name: a.name,
              color: a.color,
              icon: a.icon,
          }));

    const categoriesSpaceQuery = trpc.expenseCategory.listBySpace.useQuery(
        { spaceId: space.id },
        { enabled: !isPersonal }
    );
    const categoriesPersonalQuery = trpc.personal.listCategories.useQuery(undefined, {
        enabled: isPersonal,
    });
    const categoriesData = useMemo(
        () =>
            isPersonal
                ? categoriesPersonalQuery.data ?? []
                : categoriesSpaceQuery.data ?? [],
        [isPersonal, categoriesPersonalQuery.data, categoriesSpaceQuery.data]
    );

    // Envelopes only exist per-space; in the personal cross-space view we
    // don't have a flat envelope list to look up against, so the Envelope
    // column renders "—" there.
    const envelopesQuery = trpc.envelop.listBySpace.useQuery(
        { spaceId: space.id },
        { enabled: !isPersonal }
    );

    const eventsQuery = trpc.event.listBySpace.useQuery(
        { spaceId: space.id },
        { enabled: !isPersonal }
    );

    const [selectedTx, setSelectedTx] = useState<TxRow | null>(null);
    /**
     * Page-owned edit state. Previously each row mounted its own
     * EditTransactionSheet, which could stack on top of the details
     * sheet and double up two right-side Radix sheets. Owning open
     * state here lets the details sheet hand off cleanly:
     *   click row -> selectedTx set -> details sheet opens
     *   click Edit in details -> selectedTx cleared, editingTx set
     *   close edit sheet -> editingTx cleared
     */
    const [editingTx, setEditingTx] = useState<TxRow | null>(null);

    /**
     * Keyset-cursor infinite list. tRPC's `useInfiniteQuery` manages the
     * cursor itself — never pass `cursor` in the input dictionary. When
     * filters change, the query key changes and the list resets to page 1
     * automatically. `nextCursor` of `null` on the latest page signals
     * the end of the dataset.
     */
    const listSpaceQuery = trpc.transaction.listBySpace.useInfiniteQuery(
        {
            spaceId: space.id,
            type,
            accountIds: accountIdsArg,
            expenseCategoryIds: categoryIdsArg,
            envelopIds: envelopIdsArg,
            eventId: eventId || null,
            userId: userId || null,
            search: search || null,
            amountMin: amountMin ? Number(amountMin) : null,
            amountMax: amountMax ? Number(amountMax) : null,
            dateFrom: period.start,
            dateTo: period.end,
            limit: 50,
        },
        {
            enabled: !isPersonal,
            getNextPageParam: (last) => last.nextCursor,
        }
    );
    const listPersonalQuery = trpc.personal.transactions.useInfiniteQuery(
        {
            type,
            accountIds: accountIdsArg,
            expenseCategoryIds: categoryIdsArg,
            envelopIds: envelopIdsArg,
            eventId: eventId || null,
            userId: userId || null,
            search: search || null,
            amountMin: amountMin ? Number(amountMin) : null,
            amountMax: amountMax ? Number(amountMax) : null,
            dateFrom: period.start,
            dateTo: period.end,
            limit: 50,
        },
        {
            enabled: isPersonal,
            getNextPageParam: (last) => last.nextCursor,
        }
    );
    const listQuery = isPersonal ? listPersonalQuery : listSpaceQuery;

    const accountsById = useMemo(() => {
        const m = new Map<string, { name: string; color: string; icon: string }>();
        for (const a of accountsData)
            m.set(a.id, { name: a.name, color: a.color, icon: a.icon });
        return m;
    }, [accountsData]);

    const categoriesById = useMemo(() => {
        const m = new Map<string, { name: string; color: string; icon: string }>();
        for (const c of categoriesData)
            m.set(c.id, { name: c.name, color: c.color, icon: c.icon });
        return m;
    }, [categoriesData]);

    const envelopesById = useMemo(() => {
        const m = new Map<string, { name: string; color: string; icon: string }>();
        for (const e of envelopesQuery.data ?? [])
            m.set(e.id, { name: e.name, color: e.color, icon: e.icon });
        return m;
    }, [envelopesQuery.data]);

    const eventsById = useMemo(() => {
        const m = new Map<string, { name: string; color: string; icon: string }>();
        for (const ev of eventsQuery.data ?? [])
            m.set(ev.id, { name: ev.name, color: ev.color, icon: ev.icon });
        return m;
    }, [eventsQuery.data]);

    const invalidate = useInvalidateAnalytics();
    const del = trpc.transaction.delete.useMutation({
        onSuccess: async () => {
            toast.success("Transaction deleted");
            await invalidate(space.id);
        },
        onError: (e) => toast.error(e.message),
    });

    /* Count only the filters NOT owned by the AnalyticsFilterBar — the
       bar renders its own summary + "Clear all" for env/acc/cat. This
       badges the "Add filter" popover (type/event/amount/user). */
    const activeFilterCount = [
        type,
        eventId,
        userId,
        amountMin,
        amountMax,
    ].filter(Boolean).length;

    /* Whether ANY filter is narrowing the list — includes the env/acc/cat
       multi-selects (owned by the bar) and the search box, not just the
       "Add filter" popover's set. Drives the page-level "Clear" button and
       the "no match" vs "nothing yet" empty state. */
    const hasActiveFilters =
        activeFilterCount > 0 || f.hasAnyFilter || !!search;

    /* Flatten all loaded pages into a single list. Each page carries its
       own `nextCursor`; the latest page's nextCursor === null means the
       end. */
    const items = useMemo(
        () => listQuery.data?.pages.flatMap((p) => p.items) ?? [],
        [listQuery.data]
    );
    const hasNextPage = listQuery.hasNextPage ?? false;
    const isFetchingNextPage = listQuery.isFetchingNextPage ?? false;
    /* Recompute the "Today" / "Yesterday" reference keys on every render
       (cheap), then memoize the actual grouping on those keys. This way
       a page left open across midnight relabels its rows the next time
       anything triggers a re-render, instead of staying stuck on the
       previous day's labels until the query data changes. */
    const now = new Date();
    const todayKey = formatInAppTz(now, "yyyy-MM-dd");
    const yesterdayKey = formatInAppTz(
        new Date(now.getTime() - 86_400_000),
        "yyyy-MM-dd"
    );
    const thisYear = formatInAppTz(now, "yyyy");
    const dayGroups = useMemo(
        () => groupByDay(items, todayKey, yesterdayKey, thisYear),
        [items, todayKey, yesterdayKey, thisYear]
    );

    /* IN/OUT/NET/AVG-DAY summary for the entire filtered set (not just
       the current page). Same filter shape as listBySpace / personal.transactions.
       Memoized so the object identity is stable across renders — cheap,
       and avoids a fresh hash key in tRPC's react-query layer per render. */
    const filteredTotalsInput = useMemo(
        () => ({
            type,
            accountIds: accountIdsArg,
            expenseCategoryIds: categoryIdsArg,
            envelopIds: envelopIdsArg,
            eventId: eventId || null,
            userId: userId || null,
            search: search || null,
            amountMin: amountMin ? Number(amountMin) : null,
            amountMax: amountMax ? Number(amountMax) : null,
            dateFrom: period.start,
            dateTo: period.end,
        }),
        [
            type,
            accountIdsArg,
            categoryIdsArg,
            envelopIdsArg,
            eventId,
            userId,
            search,
            amountMin,
            amountMax,
            period.start,
            period.end,
        ]
    );
    const filteredTotalsSpaceQuery = trpc.transaction.filteredTotals.useQuery(
        { spaceId: space.id, ...filteredTotalsInput },
        { enabled: !isPersonal }
    );
    const filteredTotalsPersonalQuery =
        trpc.personal.transactionFilteredTotals.useQuery(filteredTotalsInput, {
            enabled: isPersonal,
        });
    const totalsData =
        (isPersonal
            ? filteredTotalsPersonalQuery.data
            : filteredTotalsSpaceQuery.data) ?? null;
    const summary = totalsData
        ? {
              inTotal: totalsData.inTotal,
              outTotal: totalsData.outTotal,
              net: totalsData.net,
              avg: totalsData.avgPerDay,
          }
        : { inTotal: 0, outTotal: 0, net: 0, avg: 0 };

    const periodLabel = useMemo(() => {
        if (preset === "this-month") return formatInAppTz(period.start, "MMMM yyyy");
        if (preset === "last-month") return formatInAppTz(period.start, "MMMM yyyy");
        if (preset === "this-year") return formatInAppTz(period.start, "yyyy");
        if (preset === "all-time") return "All time";
        const found = PERIOD_PRESETS.find((p) => p.value === preset);
        if (found) return found.label;
        return `${formatInAppTz(period.start, "MMM d")} → ${formatInAppTz(period.end, "MMM d, yyyy")}`;
    }, [preset, period.start, period.end]);

    const resetFilters = () => {
        setParams(
            (p) => {
                const next = new URLSearchParams();
                const period = p.get("period");
                const from = p.get("from");
                const to = p.get("to");
                if (period) next.set("period", period);
                if (from) next.set("from", from);
                if (to) next.set("to", to);
                return next;
            },
            { replace: true }
        );
    };

    return (
        <div className="orbit-design tx-root">
            <style>{TX_STYLES}</style>

            {/* Topbar */}
            <header className="tx-topbar">
                <div className="tx-topbar-text">
                    <span className="eyebrow">
                        {(totalsData?.count ?? items.length).toLocaleString(
                            "en-US"
                        )}{" "}
                        results · {periodLabel}
                    </span>
                    <h1 className="display tx-title">Transactions</h1>
                    <p className="tx-sub">
                        {isPersonal
                            ? "Every transaction across the accounts you own."
                            : "All money movement in this space."}
                    </p>
                </div>
                <div className="tx-topbar-actions">
                    <button type="button" className="od-btn">
                        <FileText className="size-3.5" /> Export
                    </button>
                    <PermissionGate roles={["owner", "editor"]}>
                        <NewTransactionSheet
                            trigger={
                                <button
                                    type="button"
                                    className="od-btn od-btn-primary"
                                >
                                    <Plus className="size-3.5" /> New transaction
                                </button>
                            }
                        />
                    </PermissionGate>
                </div>
            </header>

            <div className="tx-scroll">
                {/* Filter strip */}
                <div className="od-card tx-filters">
                    <div className="tx-filter-row1">
                        <label className="tx-search">
                            <Search
                                className="size-3.5"
                                style={{ color: "var(--fg-4)" }}
                            />
                            <input
                                className="od-input tx-search-input"
                                placeholder="Search description, location, or amount…"
                                value={searchRaw}
                                onChange={(e) => setParam("q", e.target.value)}
                            />
                        </label>
                        <PeriodChip
                            defaultPreset={DEFAULT_PERIOD_PRESET}
                            icon={<CalendarIcon className="size-3.5" />}
                        />
                    </div>

                    {/* Envelope / Account / Category multi-select — same
                        shared bar as the analytics Spending views. Envelopes
                        and categories auto-hide on the personal cross-space
                        view (space-scoped). */}
                    <AnalyticsFilterBar
                        className="tx-analytics-filter-bar"
                        spaceId={space.id}
                        isPersonal={isPersonal}
                        personalCategories
                        envelopeIds={f.envelopeIds}
                        accountIds={f.accountIds}
                        categoryIds={f.categoryIds}
                        onChange={f.setFilterIds}
                        onClearAll={resetFilters}
                        hasAnyFilter={hasActiveFilters}
                        accountsFootnote="Money moving in or out of the selected account(s)."
                        trailingChips={
                            <>
                                {!isPersonal && (
                                    <TxEventChip
                                        events={eventsQuery.data ?? []}
                                        value={eventId}
                                        onChange={(v) => setParam("event", v)}
                                    />
                                )}
                                <TxAmountChip
                                    min={amountMin}
                                    max={amountMax}
                                    onApply={(lo, hi) => {
                                        setParams(
                                            (p) => {
                                                const next = new URLSearchParams(p);
                                                if (lo) next.set("min", lo);
                                                else next.delete("min");
                                                if (hi) next.set("max", hi);
                                                else next.delete("max");
                                                return next;
                                            },
                                            { replace: true }
                                        );
                                    }}
                                />
                            </>
                        }
                    />

                    <div className="tx-filter-row2">
                        <div
                            className="tx-typebar"
                            role="group"
                            aria-label="Filter by transaction type"
                        >
                            {TYPE_OPTIONS.map((o) => (
                                <button
                                    key={String(o.value)}
                                    type="button"
                                    className={`tx-typebar-cell ${type === o.value ? "is-active" : ""}`}
                                    aria-pressed={type === o.value}
                                    onClick={() => setParam("type", o.value)}
                                >
                                    {o.label}
                                </button>
                            ))}
                        </div>

                        <span className="tx-filter-count">
                            {(totalsData?.count ?? items.length).toLocaleString(
                                "en-US"
                            )}{" "}
                            transactions
                        </span>
                    </div>
                </div>

                {/* Daily summary strip */}
                <div className="od-card tx-summary">
                    <SummaryCell
                        label="In"
                        amount={summary.inTotal}
                        variant="income"
                        signed
                    />
                    <SummaryCell
                        label="Out"
                        amount={summary.outTotal}
                        variant="expense"
                    />
                    <SummaryCell
                        label="Net"
                        amount={summary.net}
                        variant={summary.net >= 0 ? "income" : "expense"}
                        signed
                    />
                    <SummaryCell
                        label="Avg / day"
                        amount={summary.avg}
                        variant="neutral"
                    />
                </div>

                {/* Table */}
                <div
                    className={`od-card tx-table-card tx-show-balance${
                        isPersonal ? " tx-table-no-event" : ""
                    }`}
                >
                    {/* Balance is always the account's true balance across its
                        full history — it ignores the active filters, so it
                        won't step by the visible row amount once a non-account
                        filter narrows which rows are shown. Call that out
                        whenever it could otherwise read as a bug: always in
                        statement mode (a single account, where a stepping
                        running balance is the whole point), and in multi-
                        account mode once another filter is actually hiding
                        rows (the default period alone doesn't count). */}
                    {isStatementMode ? (
                        <div className="tx-statement-note">
                            <Coins className="size-3.5" />
                            Each row shows{" "}
                            <strong>
                                {singleAccountId
                                    ? accountsById.get(singleAccountId)?.name ??
                                      "this account"
                                    : "this account"}
                            </strong>
                            's balance after that transaction, across all
                            activity — filters above narrow which rows you see,
                            not the balances.
                        </div>
                    ) : (
                        (activeFilterCount > 0 || !!search) && (
                            <div className="tx-statement-note">
                                <Coins className="size-3.5" />
                                Balance reflects each account's full history,
                                not just these filtered rows.
                            </div>
                        )
                    )}
                    {/* Hide column headers when there's nothing to label —
                        a row of empty headings above the EmptyState reads
                        as broken data rather than "empty state". */}
                    {!listQuery.isLoading && items.length > 0 && (
                    <div className="tx-table-head tx-row-grid">
                        {[
                            "Date",
                            "Type",
                            "From / To",
                            "Category",
                            "Envelope",
                            ...(isPersonal ? [] : ["Event"]),
                            "By",
                            "Amount",
                            "Balance after",
                            "",
                        ].map((h, i) => (
                            <span
                                key={i}
                                className={cn(
                                    "tx-th",
                                    h === "Balance after" && "tx-th-balance"
                                )}
                                style={{
                                    textAlign:
                                        h === "Amount" || h === "Balance after"
                                            ? "right"
                                            : "left",
                                }}
                            >
                                {h}
                            </span>
                        ))}
                    </div>
                    )}
                    {listQuery.isLoading ? (
                        <div className="tx-empty">
                            <Loader2 className="size-4 animate-spin" />
                            Loading…
                        </div>
                    ) : items.length === 0 ? (
                        <div style={{ padding: 24 }}>
                            {hasActiveFilters ? (
                                <EmptyState
                                    icon={FilterEmptyIcon}
                                    title="No transactions match these filters"
                                    description="Try widening the date range or clearing a filter."
                                    action={
                                        <button
                                            type="button"
                                            className="od-btn"
                                            onClick={resetFilters}
                                        >
                                            <X className="size-3.5" /> Clear filters
                                        </button>
                                    }
                                />
                            ) : (
                                <EmptyState
                                    icon={Receipt}
                                    title="No transactions yet"
                                    description="Add your first transaction to start tracking this space."
                                    action={
                                        !isPersonal && (
                                            <PermissionGate
                                                roles={["owner", "editor"]}
                                            >
                                                <NewTransactionSheet
                                                    trigger={
                                                        <button
                                                            type="button"
                                                            className="od-btn od-btn-primary"
                                                        >
                                                            <Plus className="size-3.5" />{" "}
                                                            Add transaction
                                                        </button>
                                                    }
                                                />
                                            </PermissionGate>
                                        )
                                    }
                                />
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Desktop rows */}
                            <div className="tx-rows tx-rows-desktop">
                                {dayGroups.map((g) => (
                                    <div key={g.key} className="tx-day-block">
                                        <DayHeader label={g.label} />
                                        {g.items.map((t) => {
                                            const tt =
                                                (t.type as unknown as TxType) ?? "expense";
                                            const cat = t.expense_category_id
                                                ? categoriesById.get(t.expense_category_id)
                                                : null;
                                            const env = t.envelop_id
                                                ? envelopesById.get(t.envelop_id)
                                                : null;
                                            const ev = t.event_id
                                                ? eventsById.get(t.event_id)
                                                : null;
                                            const pending = isPendingRow(t);
                                            return (
                                        <div
                                            key={t.id}
                                            /* Focusable + Enter/Space so keyboard users
                                               can open the details sheet, but NOT
                                               role="button": the row contains account
                                               <Link>s, and interactive descendants
                                               inside a button are invalid ARIA that can
                                               hide those links from screen readers. */
                                            tabIndex={pending ? -1 : 0}
                                            className={cn(
                                                "tx-row tx-row-grid",
                                                pending && "tx-row-pending"
                                            )}
                                            aria-busy={pending || undefined}
                                            aria-disabled={pending || undefined}
                                            onClick={() => {
                                                if (!pending) setSelectedTx(t);
                                            }}
                                            onKeyDown={(e) => {
                                                /* Row-level key handling only — inner
                                                   links/buttons keep their own native
                                                   Enter/Space without also opening the
                                                   details sheet (keydown bubbles), and
                                                   holding Space must not re-fire. */
                                                if (e.target !== e.currentTarget) return;
                                                if (e.repeat) return;
                                                if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault();
                                                    if (!pending) setSelectedTx(t);
                                                }
                                            }}
                                        >
                                            <span className="tx-cell-date">
                                                <span className="tx-date">
                                                    {formatInAppTz(
                                                        t.transaction_datetime,
                                                        "MMM d"
                                                    )}
                                                </span>
                                                <span className="tx-time mono">
                                                    {formatInAppTz(
                                                        t.transaction_datetime,
                                                        "HH:mm"
                                                    )}
                                                </span>
                                            </span>
                                            <span className="tx-type-slot">
                                                {pending ? (
                                                    <span
                                                        className="tx-pending-spinner"
                                                        role="status"
                                                        aria-label="Saving"
                                                    />
                                                ) : (
                                                    <TxBadge type={tt} />
                                                )}
                                            </span>
                                            <AccountFlow
                                                spaceId={
                                                    (t as { space_id?: string })
                                                        .space_id ?? space.id
                                                }
                                                from={t.source_account_id}
                                                to={t.destination_account_id}
                                                accountsById={accountsById}
                                            />
                                            <span className="tx-cell-cat">
                                                {cat ? (
                                                    <>
                                                        <Avatar
                                                            color={cat.color}
                                                            icon={cat.icon}
                                                            size={20}
                                                        />
                                                        <span style={{ color: "var(--fg-2)" }}>
                                                            {cat.name}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span style={{ color: "var(--fg-4)" }}>
                                                        —
                                                    </span>
                                                )}
                                            </span>
                                            <span className="tx-cell-env">
                                                {env ? (
                                                    <>
                                                        <Avatar
                                                            color={env.color}
                                                            icon={env.icon}
                                                            size={20}
                                                        />
                                                        <span style={{ color: "var(--fg-2)" }}>
                                                            {env.name}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span style={{ color: "var(--fg-4)" }}>
                                                        —
                                                    </span>
                                                )}
                                            </span>
                                            {!isPersonal && (
                                                <span style={{ color: "var(--fg-4)" }}>
                                                    {ev ? (
                                                        <span
                                                            className="tx-event-chip"
                                                            style={{
                                                                background: `color-mix(in oklab, ${ev.color} 12%, transparent)`,
                                                                color: ev.color,
                                                                borderColor: `color-mix(in oklab, ${ev.color} 30%, transparent)`,
                                                            }}
                                                        >
                                                            {ev.name}
                                                        </span>
                                                    ) : (
                                                        "—"
                                                    )}
                                                </span>
                                            )}
                                            <span className="tx-cell-by">
                                                <UserAvatar
                                                    fileId={
                                                        t.created_by_avatar_file_id
                                                    }
                                                    firstName={
                                                        t.created_by_first_name
                                                    }
                                                    lastName={
                                                        t.created_by_last_name
                                                    }
                                                    size="xs"
                                                />
                                                <span
                                                    style={{
                                                        color: "var(--fg-3)",
                                                        fontSize: 12,
                                                    }}
                                                >
                                                    {t.created_by_first_name ?? "—"}
                                                </span>
                                            </span>
                                            <span className="tx-cell-amt">
                                                <Money
                                                    amount={
                                                        tt === "expense"
                                                            ? -Number(t.amount)
                                                            : Number(t.amount)
                                                    }
                                                    variant={
                                                        tt === "income"
                                                            ? "income"
                                                            : tt === "transfer"
                                                              ? "transfer"
                                                              : tt === "adjustment"
                                                                ? "warn"
                                                                : "expense"
                                                    }
                                                    signed={tt === "income"}
                                                    size={13}
                                                    weight={500}
                                                />
                                                {t.description && (
                                                    <span className="tx-cell-desc">
                                                        {t.description}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="tx-cell-balance">
                                                {(() => {
                                                        const entries =
                                                            rowBalanceEntries(t);
                                                        if (entries.length === 0)
                                                            return (
                                                                <span
                                                                    style={{
                                                                        color: "var(--fg-4)",
                                                                    }}
                                                                >
                                                                    —
                                                                </span>
                                                            );
                                                        return entries.map((b) => (
                                                            <span
                                                                key={b.accountId}
                                                                className="tx-bal-line"
                                                            >
                                                                {!isStatementMode && (
                                                                    <span
                                                                        className="tx-bal-dot"
                                                                        style={{
                                                                            background:
                                                                                accountsById.get(
                                                                                    b.accountId
                                                                                )
                                                                                    ?.color ??
                                                                                UNALLOCATED_COLOR,
                                                                        }}
                                                                        title={
                                                                            accountsById.get(
                                                                                b.accountId
                                                                            )?.name
                                                                        }
                                                                    />
                                                                )}
                                                                {/* Statement mode (one account selected) exists
                                                                    to READ the running balance — full prominence
                                                                    there, matching AccountDetailPage. In the
                                                                    multi-account view balance is context: muted
                                                                    + smaller so it can't be mistaken for Amount
                                                                    (the divider + grey do the fencing). */}
                                                                <Money
                                                                    amount={Number(
                                                                        b.balance
                                                                    )}
                                                                    variant={
                                                                        isStatementMode
                                                                            ? "neutral"
                                                                            : "muted"
                                                                    }
                                                                    size={
                                                                        isStatementMode
                                                                            ? 13
                                                                            : 12
                                                                    }
                                                                    weight={
                                                                        isStatementMode
                                                                            ? 500
                                                                            : 400
                                                                    }
                                                                />
                                                            </span>
                                                        ));
                                                    })()}
                                            </span>
                                        </div>
                                    );
                                        })}
                                    </div>
                                ))}
                            </div>

                            {/* Mobile rows — compressed list */}
                            <div className="tx-rows-mobile">
                                {dayGroups.map((g) => (
                                    <div key={g.key} className="tx-day-block">
                                        <DayHeader label={g.label} />
                                        {g.items.map((t) => {
                                    const tt = (t.type as unknown as TxType) ?? "expense";
                                    const cat = t.expense_category_id
                                        ? categoriesById.get(t.expense_category_id)
                                        : null;
                                    const pendingMobile = isPendingRow(t);
                                    return (
                                        <button
                                            key={t.id}
                                            type="button"
                                            className={cn("tx-mrow", pendingMobile && "tx-mrow-pending")}
                                            disabled={pendingMobile}
                                            aria-busy={pendingMobile || undefined}
                                            onClick={() => {
                                                if (!pendingMobile) setSelectedTx(t);
                                            }}
                                        >
                                            <Avatar
                                                color={cat?.color ?? UNALLOCATED_COLOR}
                                                icon={cat?.icon ?? "wallet"}
                                                size={32}
                                            />
                                            <div className="tx-mrow-text">
                                                <div className="tx-mrow-top">
                                                    <span className="tx-type-slot">
                                                    {pendingMobile ? (
                                                        <span
                                                        className="tx-pending-spinner"
                                                        role="status"
                                                        aria-label="Saving"
                                                    />
                                                    ) : (
                                                        <TxBadge type={tt} />
                                                    )}
                                                    </span>
                                                    <span className="tx-mrow-date">
                                                        {formatInAppTz(
                                                            t.transaction_datetime,
                                                            "MMM d"
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="tx-mrow-name">
                                                    {cat?.name ?? t.description ?? "—"}
                                                </div>
                                                {t.description && cat && (
                                                    <div className="tx-mrow-desc">
                                                        {t.description}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="tx-mrow-amt">
                                                <Money
                                                    amount={
                                                        tt === "expense"
                                                            ? -Number(t.amount)
                                                            : Number(t.amount)
                                                    }
                                                    variant={
                                                        tt === "income"
                                                            ? "income"
                                                            : tt === "transfer"
                                                              ? "transfer"
                                                              : tt === "adjustment"
                                                                ? "warn"
                                                                : "expense"
                                                    }
                                                    signed={tt === "income"}
                                                    size={14}
                                                    weight={500}
                                                />
                                                {rowBalanceEntries(t).map(
                                                    (b) => (
                                                            <span
                                                                key={b.accountId}
                                                                className="tx-mrow-balance"
                                                            >
                                                                {!isStatementMode && (
                                                                    <span
                                                                        className="tx-bal-dot"
                                                                        style={{
                                                                            background:
                                                                                accountsById.get(
                                                                                    b.accountId
                                                                                )
                                                                                    ?.color ??
                                                                                UNALLOCATED_COLOR,
                                                                        }}
                                                                    />
                                                                )}
                                                                <Money
                                                                    amount={Number(
                                                                        b.balance
                                                                    )}
                                                                    variant={
                                                                        isStatementMode
                                                                            ? "neutral"
                                                                            : "muted"
                                                                    }
                                                                    size={
                                                                        isStatementMode
                                                                            ? 12
                                                                            : 11
                                                                    }
                                                                    weight={
                                                                        isStatementMode
                                                                            ? 500
                                                                            : 400
                                                                    }
                                                                />
                                                            </span>
                                                        )
                                                )}
                                            </div>
                                        </button>
                                    );
                                        })}
                                    </div>
                                ))}
                            </div>

                            <div className="tx-table-foot">
                                <span style={{ fontSize: 12, color: "var(--fg-4)" }}>
                                    Showing {items.length}
                                    {totalsData
                                        ? ` of ${totalsData.count.toLocaleString("en-US")}`
                                        : ""}{" "}
                                    transactions
                                </span>
                                {hasNextPage ? (
                                    <button
                                        type="button"
                                        className="od-btn od-btn-sm"
                                        disabled={isFetchingNextPage}
                                        onClick={() => listQuery.fetchNextPage()}
                                    >
                                        {isFetchingNextPage
                                            ? "Loading…"
                                            : "Load 50 more"}
                                    </button>
                                ) : (
                                    <span
                                        style={{
                                            fontSize: 12,
                                            color: "var(--fg-4)",
                                        }}
                                    >
                                        You've reached the end.
                                    </span>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <TransactionDetailsSheet
                transaction={selectedTx}
                open={selectedTx !== null}
                onClose={() => setSelectedTx(null)}
                accountsById={accountsById}
                categoriesById={categoriesById}
                eventsById={eventsById}
                canEdit={selectedTx?.created_by === authStore.user?.id}
                onEdit={() => {
                    // Hand off from details -> edit. Capture the row,
                    // close details first so the two right-side sheets
                    // never coexist (this was the bug that motivated
                    // hoisting edit state to the page).
                    const tx = selectedTx;
                    setSelectedTx(null);
                    setEditingTx(tx);
                }}
                onDelete={() => {
                    const tx = selectedTx;
                    if (!tx) return;
                    setSelectedTx(null);
                    del.mutate({ transactionId: tx.id });
                }}
            />

            {editingTx && (
                <EditTransactionSheet
                    transaction={editingTx}
                    open
                    onClose={() => setEditingTx(null)}
                />
            )}
        </div>
    );
}

/* ============================================================
   Helper components
   ============================================================ */

function Money({
    amount,
    variant = "neutral",
    signed = false,
    size = 13,
    weight = 500,
    decimals = 2,
}: {
    amount: number;
    variant?:
        | "neutral"
        | "income"
        | "expense"
        | "transfer"
        | "muted"
        | "warn";
    signed?: boolean;
    size?: number;
    weight?: number;
    decimals?: number;
}) {
    const colorMap: Record<string, string> = {
        income: "var(--income)",
        expense: "var(--expense)",
        transfer: "var(--transfer)",
        warn: "var(--warn)",
        muted: "var(--fg-3)",
        neutral: "var(--fg)",
    };
    const abs = Math.abs(amount).toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
    let text = abs;
    if (amount < 0) text = "−" + abs;
    else if (signed && amount > 0) text = "+" + abs;
    return (
        <span
            className="tabular"
            style={{ color: colorMap[variant], fontSize: size, fontWeight: weight }}
        >
            {text}
        </span>
    );
}

function TxBadge({ type }: { type: TxType }) {
    const map: Record<
        TxType,
        { color: string; label: string; icon: ReactNode }
    > = {
        income: { color: "var(--income)", label: "Income", icon: <ArrowDown className="size-3" /> },
        expense: { color: "var(--expense)", label: "Expense", icon: <ArrowUp className="size-3" /> },
        transfer: { color: "var(--transfer)", label: "Transfer", icon: <ArrowRightLeft className="size-3" /> },
        adjustment: { color: "var(--warn)", label: "Adjustment", icon: <Edit3 className="size-3" /> },
    };
    const m = map[type];
    return (
        <span
            className="tx-badge"
            style={{
                color: m.color,
                background: `color-mix(in oklab, ${m.color} 12%, transparent)`,
                borderColor: `color-mix(in oklab, ${m.color} 30%, transparent)`,
            }}
        >
            {m.icon} {m.label}
        </span>
    );
}

function Avatar({
    icon,
    color,
    size = 22,
}: {
    icon: string;
    color: string;
    size?: number;
}) {
    const IconCmp = getIcon(icon);
    return (
        <span
            style={{
                width: size,
                height: size,
                borderRadius: 6,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: `color-mix(in oklab, ${color} 18%, transparent)`,
                border: `1px solid color-mix(in oklab, ${color} 30%, transparent)`,
                color: color,
                flexShrink: 0,
            }}
        >
            <IconCmp size={size * 0.5} color={color} strokeWidth={1.7} />
        </span>
    );
}

function AccountFlow({
    spaceId,
    from,
    to,
    accountsById,
}: {
    spaceId: string;
    from: string | null;
    to: string | null;
    accountsById: Map<string, { name: string; color: string; icon: string }>;
}) {
    const fromAcc = from ? accountsById.get(from) : null;
    const toAcc = to ? accountsById.get(to) : null;
    return (
        <span
            className="tx-cell-flow"
            onClick={(e) => e.stopPropagation()}
        >
            {fromAcc ? (
                <Link
                    to={ROUTES.spaceAccountDetail(spaceId, from!)}
                    className="tx-flow-acct"
                >
                    <span style={{ color: "var(--fg-2)" }}>{fromAcc.name}</span>
                </Link>
            ) : (
                <span style={{ color: "var(--fg-4)" }}>—</span>
            )}
            {toAcc && (
                <>
                    <ArrowRightLeft className="size-3" style={{ color: "var(--fg-4)" }} />
                    <Link
                        to={ROUTES.spaceAccountDetail(spaceId, to!)}
                        className="tx-flow-acct"
                    >
                        <span style={{ color: "var(--fg)" }}>{toAcc.name}</span>
                    </Link>
                </>
            )}
        </span>
    );
}

function SummaryCell({
    label,
    amount,
    variant,
    signed,
}: {
    label: string;
    amount: number;
    variant: "income" | "expense" | "neutral";
    signed?: boolean;
}) {
    return (
        <div className="tx-summary-cell">
            <span className="tx-summary-label">{label}</span>
            <span className="tx-summary-amt">
                <Money
                    amount={amount}
                    variant={variant}
                    signed={signed}
                    size={20}
                    weight={500}
                />
            </span>
        </div>
    );
}

/* Chip styling shared with the AnalyticsFilterBar dropdowns so the
   transaction-only filters (Event / Amount / No-envelope) sit in the same
   row and read as one cohesive control set. */
const FILTER_CHIP_CLASS = "h-9 gap-1.5 px-2.5 text-sm sm:h-7 sm:text-[12px]";
const FILTER_CHIP_ACTIVE = "border-warning/40 bg-warning/5 text-foreground";

/** Single-select Event filter, styled to match the multi-select chips. */
function TxEventChip({
    events,
    value,
    onChange,
}: {
    events: Array<{
        id: string;
        name: string;
        color?: string | null;
        icon?: string | null;
    }>;
    value: string | null;
    onChange: (v: string | null) => void;
}) {
    const selected = value ? events.find((e) => e.id === value) : null;
    const label = selected ? selected.name : "Event · All";
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn(FILTER_CHIP_CLASS, value && FILTER_CHIP_ACTIVE)}
                >
                    <CalendarClock className="size-3.5" />
                    <span className="max-w-[150px] truncate">{label}</span>
                    <ChevronDown className="size-3 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="w-[min(16rem,calc(100vw-1.5rem))]"
            >
                <DropdownMenuLabel className="text-xs">
                    Filter by event
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    className="text-xs"
                    disabled={!value}
                    onSelect={() => onChange(null)}
                >
                    Any event
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div className="max-h-[260px] overflow-y-auto">
                    {events.length === 0 ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">
                            No events.
                        </p>
                    ) : (
                        events.map((e) => (
                            <DropdownMenuItem
                                key={e.id}
                                onSelect={() => onChange(e.id)}
                                className="gap-2"
                            >
                                <EntityAvatar
                                    size="sm"
                                    color={e.color ?? "#64748b"}
                                    icon={e.icon ?? "calendar"}
                                />
                                <span className="truncate">{e.name}</span>
                                {value === e.id && (
                                    <Check className="ml-auto size-3.5" />
                                )}
                            </DropdownMenuItem>
                        ))
                    )}
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** Amount-range filter (inclusive min/max) in a small popover. */
function TxAmountChip({
    min,
    max,
    onApply,
}: {
    min: string | null;
    max: string | null;
    onApply: (min: string | null, max: string | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const [lo, setLo] = useState(min ?? "");
    const [hi, setHi] = useState(max ?? "");
    const active = !!(min || max);
    const label = active ? `Amount · ${min || "0"}–${max || "∞"}` : "Amount";
    const apply = () => {
        onApply(lo.trim() || null, hi.trim() || null);
        setOpen(false);
    };
    return (
        <Popover
            open={open}
            onOpenChange={(o) => {
                setOpen(o);
                if (o) {
                    setLo(min ?? "");
                    setHi(max ?? "");
                }
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn(FILTER_CHIP_CLASS, active && FILTER_CHIP_ACTIVE)}
                >
                    <Coins className="size-3.5" />
                    <span className="max-w-[150px] truncate">{label}</span>
                    <ChevronDown className="size-3 opacity-60" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="orbit-design w-64 p-3"
                onKeyDown={(e) => {
                    if (e.key === "Enter") apply();
                }}
            >
                <div className="tx-amount-pop">
                    <span className="tx-amount-pop-label">Amount range</span>
                    <div className="tx-amount-pop-row">
                        <input
                            className="od-input"
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            placeholder="Min"
                            aria-label="Minimum amount"
                            value={lo}
                            onChange={(e) => setLo(e.target.value)}
                        />
                        <span className="tx-amount-pop-dash">–</span>
                        <input
                            className="od-input"
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            placeholder="Max"
                            aria-label="Maximum amount"
                            value={hi}
                            onChange={(e) => setHi(e.target.value)}
                        />
                    </div>
                    <div className="tx-amount-pop-foot">
                        <button
                            type="button"
                            className="od-btn od-btn-ghost od-btn-sm"
                            onClick={() => {
                                setLo("");
                                setHi("");
                                onApply(null, null);
                                setOpen(false);
                            }}
                            disabled={!active && !lo && !hi}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            className="od-btn od-btn-primary od-btn-sm"
                            onClick={apply}
                        >
                            Apply
                        </button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

const TX_STYLES = `
.tx-root {
    margin: -1.5rem -1rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
}
@media (min-width: 768px) {
    .tx-root { margin: -2rem; }
}

/* Topbar */
.tx-topbar {
    padding: 26px 32px 18px;
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    background: var(--bg);
    flex-wrap: wrap;
}
.tx-topbar-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tx-title {
    font-size: 26px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--fg);
    margin: 0;
}
.tx-sub { font-size: 13px; color: var(--fg-3); margin: 0; }
.tx-topbar-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
}
@media (max-width: 720px) {
    .tx-topbar { padding: 18px 18px 14px; }
}

/* Scroll body */
.tx-scroll {
    flex: 1;
    padding: 22px 32px 36px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}
@media (max-width: 720px) {
    .tx-scroll { padding: 16px 18px 28px; }
}

/* Filters */
.orbit-design .od-card.tx-filters {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.tx-filter-row1 {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
}
.tx-search {
    position: relative;
    flex: 1;
    min-width: 240px;
    display: flex;
    align-items: center;
}
.tx-search > svg {
    position: absolute;
    left: 12px;
    pointer-events: none;
    z-index: 1;
    color: var(--fg-4);
}
/* Doubled selector beats .orbit-design .od-input (0,2,0) so the
   left padding actually applies and the icon doesn't overlap text. */
.orbit-design .od-input.tx-search-input {
    flex: 1;
    width: 100%;
    padding-left: 36px;
}
.tx-filter-row2 {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
}
.tx-filter-divider {
    width: 1px;
    height: 18px;
    background: var(--line);
    margin: 0 6px;
}
.tx-filter-count {
    margin-left: auto;
    font-size: 11px;
    color: var(--fg-4);
}
.tx-typebar {
    display: inline-flex;
    align-items: center;
    gap: 2px;
}
.tx-typebar-cell {
    height: 26px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--line-soft);
    background: transparent;
    color: var(--fg-3);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: all 140ms ease;
}
.tx-typebar-cell:hover {
    color: var(--fg-2);
    border-color: var(--line);
}
.tx-typebar-cell.is-active {
    background: var(--bg-elev-3);
    border-color: var(--line-strong);
    color: var(--fg);
}
.tx-active-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid color-mix(in oklab, var(--brand) 30%, transparent);
    background: var(--brand-soft);
    color: var(--brand);
    cursor: pointer;
    font-family: inherit;
    transition: filter 140ms ease;
    /* Match the top-row filter chip cap so a long envelope name in the
       chip doesn't stretch a single pill past its siblings. The X icon
       stays visible because it's after the text in DOM order — ellipsis
       happens inside the label before the icon. */
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tx-active-chip:hover { filter: brightness(1.08); }
.tx-add-filter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 11px;
    border: 1px dashed var(--line-strong);
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
    font-family: inherit;
}
.tx-add-filter:hover { color: var(--fg); border-color: var(--brand); }
.tx-filter-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    border-radius: 999px;
    background: var(--brand);
    color: var(--brand-fg);
    font-size: 10px;
    font-weight: 600;
    padding: 0 4px;
}

/* Popover items */
.tx-popover-item {
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border-radius: 6px;
    background: transparent;
    border: 0;
    font-size: 13px;
    color: var(--fg-2);
    cursor: pointer;
    font-family: inherit;
    display: flex;
    align-items: center;
    gap: 8px;
}
.tx-popover-item:hover { background: var(--bg-elev-2); color: var(--fg); }

/* Period picker popover */
.tx-period-pop {
    width: 320px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.tx-period-section-label {
    font-size: 10px;
    color: var(--fg-4);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
    padding: 0 4px 4px;
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.tx-period-active-pill {
    display: inline-flex;
    align-items: center;
    height: 16px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--brand-soft);
    color: var(--brand);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: none;
}
.tx-period-presets {
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.tx-period-divider {
    height: 1px;
    background: var(--line-soft);
    margin: 2px 0;
}
.tx-period-custom {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.tx-period-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}
.tx-period-input-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}
.tx-period-input-wrap > span {
    font-size: 10.5px;
    color: var(--fg-4);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding-left: 2px;
}
.orbit-design .od-input.tx-period-input {
    height: 36px;
    font-size: 12.5px;
    padding: 0 10px;
    color-scheme: dark;
}
.orbit-design .od-input.tx-period-input::-webkit-calendar-picker-indicator {
    filter: invert(0.85);
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 140ms ease;
}
.orbit-design .od-input.tx-period-input::-webkit-calendar-picker-indicator:hover {
    opacity: 1;
}

/* Daily summary strip */
.orbit-design .od-card.tx-summary {
    padding: 14px 18px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
}
@media (max-width: 720px) {
    .orbit-design .od-card.tx-summary { grid-template-columns: repeat(2, 1fr); }
}
.tx-summary-cell { display: flex; flex-direction: column; gap: 6px; }
.tx-summary-label {
    font-size: 10px;
    color: var(--fg-4);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
}
.tx-summary-amt { line-height: 1; }

/* Table */
.orbit-design .od-card.tx-table-card {
    padding: 0;
    /* clip (not hidden) keeps the border-radius clipping WITHOUT creating
       a scroll box — an overflow:hidden ancestor silently disables the
       position:sticky day/column headers inside. The hidden line first is
       the Safari <16 fallback (it drops the clip declaration): corners
       stay clipped there and only the sticky headers degrade. */
    overflow: hidden;
    overflow: clip;
}
.tx-statement-note {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 9px 18px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-elev-2);
    font-size: 11.5px;
    color: var(--fg-3);
}
.tx-statement-note strong { color: var(--fg-2); font-weight: 600; }
.tx-row-grid {
    display: grid;
    grid-template-columns: 100px 120px minmax(0, 1.3fr) minmax(0, 1.1fr) minmax(0, 1.1fr) minmax(0, 0.6fr) 100px 130px 60px;
    align-items: center;
}
/* Personal cross-space view: drop the Event column entirely — there's
   no scoped event picker and the column resolves to "—" for most rows. */
.tx-table-no-event .tx-row-grid {
    grid-template-columns: 100px 120px minmax(0, 1.3fr) minmax(0, 1.1fr) minmax(0, 1.1fr) 100px 130px 60px;
}
/* Statement mode (single account selected): a "Balance after" column is
   appended before the actions cell. Other columns tighten slightly to fit. */
.tx-show-balance .tx-row-grid {
    grid-template-columns: 96px 116px minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.55fr) 92px 124px 124px 56px;
}
.tx-show-balance.tx-table-no-event .tx-row-grid {
    grid-template-columns: 96px 116px minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) 92px 124px 124px 56px;
}
.tx-table-head {
    padding: 12px 18px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-elev-2);
    /* Column labels stay visible while scrolling a long list; day headers
       pin just below (see .tx-day-header's 901px+ offset). Above the
       day headers' z-index:2, below .sl-mobile-header's 5. */
    position: sticky;
    top: 0;
    z-index: 3;
}
.tx-th {
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-4);
    font-weight: 500;
    /* "Balance after" is the longest label (~98px in a 120px track) —
       nowrap so zoom / wider system fonts can't wrap it to two lines,
       and line-height:1 makes the head's height deterministic for the
       day headers' sticky offset below. */
    white-space: nowrap;
    line-height: 1;
}
/* Start the balance column's fence at the header so it reads as one
   column boundary. Negative margins punch through the head's 12px
   padding so the rule meets the head's bottom border. */
.tx-th-balance {
    align-self: stretch;
    margin: -12px 0;
    border-left: 1px solid var(--line-soft);
    padding-left: 12px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
}
.tx-rows-desktop { display: block; }
.tx-rows-mobile { display: none; }
@media (max-width: 900px) {
    .tx-rows-desktop, .tx-table-head { display: none; }
    .tx-rows-mobile { display: block; }
}
.tx-row {
    padding: 13px 18px;
    font-size: 13px;
    transition: background 120ms ease;
    cursor: pointer;
}
.tx-row:hover { background: var(--bg-elev-2); }
/* Optimistic row awaiting server confirmation — dimmed + non-interactive,
   settles into a normal row (or disappears on failure) within moments. */
.tx-row-pending {
    opacity: 0.55;
    cursor: default;
    pointer-events: none;
}
.tx-row-pending:hover { background: transparent; }
/* Holds the type badge / pending spinner so swapping between them doesn't
   shift the row's height or push the date sideways. */
.tx-type-slot {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
}
.tx-pending-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--fg-2);
    border-right-color: transparent;
    border-radius: 999px;
    animation: tx-pending-spin 600ms linear infinite;
}
@keyframes tx-pending-spin {
    to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
    .tx-pending-spinner { animation: none; }
}
.tx-cell-date {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
}
.tx-date { color: var(--fg); font-weight: 500; }
.tx-time {
    font-size: 12px;
    color: var(--fg-3);
    font-family: "Geist Mono", monospace;
    letter-spacing: 0.02em;
}

/* Day partition — quiet eyebrow above each consecutive same-day
   group, with a hairline separating groups. No background, no chip. */
.tx-day-block {
    display: flex;
    flex-direction: column;
}
/* Day headers stick while their block scrolls, so the reader always knows
   which day they're in on long lists. Each header is only sticky within
   its own .tx-day-block, so the next day's header pushes it away
   naturally. The hairline shadow matches the row separators and keeps a
   visible seam when rows slide beneath the stuck label. */
.tx-day-header {
    padding: 12px 18px 6px;
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg-elev-1);
    box-shadow: 0 1px 0 var(--line-soft);
}
@media (max-width: 767px) {
    /* Tuck 1px behind the sticky .sl-mobile-header (opaque, z-index 5 >
       2) — an overlap is invisible, a gap would show rows scrolling
       through. --sl-mobile-header-h is defined next to that header's
       rule in SpaceLayout.tsx so the two can't silently drift. */
    .tx-day-header { top: calc(var(--sl-mobile-header-h, 53px) - 1px); }
}
@media (min-width: 901px) {
    /* Below the sticky column-header band: 12+12 padding + 10.5px label
       (line-height 1) + 1px border ≈ 35.5px; 34px tucks 1.5px behind its
       opaque background. Only ≥901px — the 768-900px band shows the
       mobile card list with no column head, so top:0 applies there. */
    .tx-day-header { top: 34px; }
}
.tx-day-block + .tx-day-block .tx-day-header {
    border-top: 1px solid var(--line-soft);
    padding-top: 14px;
}
.tx-day-label {
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 10.5px;
    font-weight: 500;
    color: var(--fg-3);
}
.tx-day-block .tx-row {
    border-bottom: 1px solid var(--line-soft);
}
.tx-day-block .tx-row:last-child {
    border-bottom: 0;
}
@media (max-width: 720px) {
    .tx-day-header { padding: 10px 12px 4px; }
    .tx-day-block + .tx-day-block .tx-day-header { padding-top: 12px; }
}
.tx-cell-flow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--fg-2);
    min-width: 0;
}
.tx-flow-acct {
    text-decoration: none;
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 140ms ease;
}
.tx-flow-acct:hover { color: var(--brand); }
.tx-cell-cat,
.tx-cell-env {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.tx-cell-env > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tx-event-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid;
    font-size: 11px;
}
.tx-cell-by { display: inline-flex; align-items: center; gap: 6px; }
.tx-cell-amt {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    text-align: right;
}
.tx-cell-desc {
    font-size: 11px;
    color: var(--fg-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 130px;
}
/* Running balance is context, not the transaction itself — a hairline
   fences it off from the Amount column and the muted number (vs Amount's
   colored 13px/500) keeps the two from reading as twins. No margin-left:
   the fixed 120/124px track must keep ~107px for the figure so 7-8 digit
   balances (routine in BDT) never spill left across the fence into
   Amount. The negative vertical margins extend the cell through the
   row's own 13px padding so the border meets the row separators as one
   continuous rule instead of floating per-row dashes. */
.tx-cell-balance {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    gap: 2px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    align-self: stretch;
    margin-top: -13px;
    margin-bottom: -13px;
    border-left: 1px solid var(--line-soft);
    padding-left: 12px;
}
.tx-bal-line {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}
.tx-bal-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    flex-shrink: 0;
    /* Hairline ring keeps a pale account colour visible on the card. */
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--fg) 18%, transparent);
}
.tx-mrow-amt {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    margin-left: auto;
}
.tx-mrow-balance {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
}
/* Neutralise the shared bar's -mt-1 (meant for analytics page headers) so
   it respects the filter card's own 12px stack gap. */
.tx-filters .tx-analytics-filter-bar { margin-top: 0; }
/* Amount-range popover */
.tx-amount-pop { display: flex; flex-direction: column; gap: 10px; }
.tx-amount-pop-label {
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-4);
    font-weight: 500;
}
.tx-amount-pop-row { display: flex; align-items: center; gap: 8px; }
/* 16px on mobile stops iOS Safari from auto-zooming on focus; shrink back
   to the compact 13px on wider screens. */
.tx-amount-pop-row .od-input { min-width: 0; text-align: right; font-size: 16px; }
@media (min-width: 640px) {
    .tx-amount-pop-row .od-input { font-size: 13px; }
}
.tx-amount-pop-dash { color: var(--fg-4); }
.tx-amount-pop-foot { display: flex; justify-content: flex-end; gap: 8px; }
.tx-cell-actions {
    display: inline-flex;
    justify-content: flex-end;
    gap: 4px;
}
.tx-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid;
    font-size: 11px;
    font-weight: 500;
}
.tx-empty {
    padding: 60px 18px;
    text-align: center;
    color: var(--fg-3);
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
}
.tx-table-foot {
    padding: 14px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-elev-2);
    border-top: 1px solid var(--line-soft);
    flex-wrap: wrap;
    gap: 12px;
    /* Lock min-height so the footer doesn't subtly resize when the
       "Load 50 more" button is replaced by the "You've reached the
       end." caption on the last page. */
    min-height: 56px;
}

/* Mobile rows */
.tx-mrow {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border: 0;
    border-bottom: 1px solid var(--line-soft);
    background: transparent;
    width: 100%;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    color: inherit;
    /* Touch ergonomics: kill the 300ms double-tap delay and the default
       grey tap flash — the :active state below is the press feedback. */
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition: background 120ms ease;
}
.tx-mrow:last-child { border-bottom: 0; }
.tx-mrow:hover { background: var(--bg-elev-2); }
/* Pressed state = immediate feedback on touch, where :hover never fires. */
.tx-mrow:active:not(:disabled) { background: var(--bg-elev-2); }
/* Keyboard focus ring for both row surfaces. Inset so the ring survives
   the card's clipped rounded corners on first/last rows. */
.tx-row:focus-visible,
.tx-mrow:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: -2px;
}
.tx-mrow-pending {
    opacity: 0.55;
    cursor: default;
}
.tx-mrow-pending:hover { background: transparent; }
.tx-mrow-text { flex: 1; min-width: 0; }
.tx-mrow-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
}
.tx-mrow-date {
    font-size: 11.5px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
}
.tx-mrow-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tx-mrow-desc {
    font-size: 11px;
    color: var(--fg-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Filter chip buttons in the top row can render long envelope/account
   names; cap their width so a single long chip doesn't push siblings to
   wrap into orphan rows. Internal text ellipses past the cap. */
.tx-filter-row1 .od-btn {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Mid-tablet band: between the desktop layout and the <640px mobile
   rules, the search field's 240px floor crowds the four-chip row out of
   one line. Collapse the search to full width earlier so the chips get
   a clean second row. */
@media (max-width: 768px) {
    .tx-search { min-width: 0; width: 100%; flex: 1 1 100%; }
}

/* Footer "Load 50 more" is the primary mobile pagination interaction.
   30px is too small for fingers; bump to the 44px touch-target minimum
   and span full width on phones so it pairs visually with the
   "Showing X of Y" line above. */
@media (max-width: 640px) {
    .tx-table-foot .od-btn-sm {
        height: 44px;
        padding: 0 14px;
        flex: 1 1 100%;
    }
}

/* Tighter table at <1280 — drop event + by columns. Envelope (col 5)
   stays since it's the column the user explicitly wants surfaced.
   Personal variant already drops event globally; only the By column
   is hidden at this breakpoint there (now at nth-child(6)). */
@media (max-width: 1280px) and (min-width: 901px) {
    .tx-row-grid {
        grid-template-columns: 100px 120px minmax(0, 1.3fr) minmax(0, 1.1fr) minmax(0, 1.1fr) 130px 60px;
    }
    .tx-row-grid > :nth-child(6),
    .tx-row-grid > :nth-child(7) { display: none; }
    .tx-table-no-event .tx-row-grid {
        grid-template-columns: 100px 120px minmax(0, 1.3fr) minmax(0, 1.1fr) minmax(0, 1.1fr) 130px 60px;
    }
    .tx-table-no-event .tx-row-grid > :nth-child(6) { display: none; }
    .tx-table-no-event .tx-row-grid > :nth-child(7) { display: revert; }
    /* Keep the Balance column at this width; event/by still hidden by the
       nth-child rules above (Balance sits after Amount, so its index is
       unaffected). */
    .tx-show-balance .tx-row-grid,
    .tx-show-balance.tx-table-no-event .tx-row-grid {
        /* Balance track 124px (not 120) — a 14-char BDT figure
           (−12,345,678.90) on a multi-account transfer line needs ~94px
           of the track after the fence's 13px and the dot's 11px; 120px
           left only ~2px of headroom. */
        grid-template-columns: 96px 116px minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) 120px 124px 56px;
    }
}

/* Phone (<640px) — tighten filters, search, summary tiles. */
@media (max-width: 640px) {
    .tx-topbar { padding: 14px 14px 10px; }
    .tx-title { font-size: 22px; }
    .tx-scroll { padding: 12px 14px 22px; gap: 12px; }
    .tx-search { min-width: 0; width: 100%; flex: 1 1 100%; }
    .tx-filter-row1 { gap: 8px; }
    .tx-filter-count { margin-left: 0; flex: 1 1 100%; text-align: right; }
    .orbit-design .od-card.tx-summary {
        grid-template-columns: 1fr 1fr;
        padding: 12px 14px;
        gap: 12px;
    }
    .tx-mrow { padding: 10px 12px; gap: 10px; }
    .tx-table-foot { padding: 12px; gap: 10px; }
    .tx-period-pop { width: min(320px, calc(100vw - 2rem)); }
}

@media (max-width: 380px) {
    .orbit-design .od-card.tx-summary { grid-template-columns: 1fr; }
}
`;
