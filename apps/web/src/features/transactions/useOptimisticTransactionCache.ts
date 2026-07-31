import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpc } from "@/trpc";
import type { RouterOutput } from "@/trpc";

type ListPage = RouterOutput["transaction"]["listBySpace"];
export type ListItem = ListPage["items"][number];
type Totals = RouterOutput["transaction"]["filteredTotals"];

/** Marker field added to a client-synthesized row. Never present on a real
 *  server row, so `!t.__pending` is a safe "is this row real?" check
 *  wherever a row is rendered.
 *
 *  Deliberately NOT reused for an edit in flight — see `__saving` below.
 *  A `__pending` row has no server identity yet, so blocking every
 *  interaction with it is correct; an edited row is a real transaction the
 *  user has been reading all along, and blanking its type badge + blocking
 *  clicks would read as "this is being deleted". */
// `ListItem["type"]` codegens as an array type (kysely-codegen misreads the
// `__type_transaction_type` Postgres enum) even though the runtime value is
// a scalar string — override it here rather than casting at every call site.
export type OptimisticTxRow = Omit<ListItem, "type"> & {
    type: "income" | "expense" | "transfer" | "adjustment";
    __pending: true;
};

/**
 * Marker for a REAL row carrying an optimistic edit that hasn't been
 * acknowledged yet. Rows keep their identity while saving — badge, click
 * target, focus, and every foreground colour intact, marked with a tint
 * and a spinner beside the badge — because unlike `__pending`
 * there is a real transaction behind it, and because nothing guarantees
 * this flag ever clears: a hung or offline request leaves it set until the
 * next successful refetch, and a row that had become unreadable and
 * unopenable would stay that way with no way for the user to know why.
 * Callers should gate only the actions that genuinely conflict (re-editing
 * the same row mid-flight, which would snapshot already-optimistic values
 * as its rollback baseline).
 */
export const SAVING_FLAG = "__saving" as const;

export type TxDelta = { count: number; inTotal: number; outTotal: number };

/** Mirrors the server's own IN/OUT split in filteredTotals.mts: income adds
 *  to inTotal, expense to outTotal, transfer/adjustment contribute nothing
 *  by themselves (a transfer's fee is a separate expense-type row on the
 *  server that this optimistic layer doesn't synthesize — see NewTransactionSheet.tsx). */
export function computeDelta(
    type: "income" | "expense" | "transfer" | "adjustment",
    amount: number
): TxDelta {
    return {
        count: 1,
        inTotal: type === "income" ? amount : 0,
        outTotal: type === "expense" ? amount : 0,
    };
}

/* There is deliberately NO computeUpdateDelta counterpart for the edit
 * path — an edited row does not get an optimistic totals patch. A create
 * only ever ADDS to the set, so `computeDelta` is right whenever the new
 * row matches the active filter and merely early by one refetch when it
 * doesn't. An edit can move a row ACROSS the filter boundary in either
 * direction, and `filteredTotals` is filtered on nine dimensions (type,
 * amountMin/Max, date range, accounts, categories with descendant
 * rollup, envelopes, event, user, search text) — every one of which the
 * edit sheet can change. Bumping the totals by `next - previous` is then
 * not "early", it's wrong: editing one of three 50.00 expenses to 500.00
 * under an `amountMax: 100` filter reads OUT as 600.00 when the truth is
 * 100.00, because the row left the set entirely. Deciding correctly would
 * mean re-implementing all nine server predicates (plus the personal
 * space's separate ownership-scoped IN/OUT split) in the browser and
 * keeping them in lockstep forever. The summary tiles instead move on the
 * trailing invalidate(), in the same breath as the row's balance and
 * ordering — a sub-second lag rather than a confidently wrong number.
 */

/**
 * Cache-patch helpers for optimistic transaction creation AND editing.
 * Unlike usePins.ts's snapshot/restore pattern, every operation here reads the
 * CURRENT cache fresh (via setQueriesData's updater argument) and targets
 * only the row/delta belonging to one mutation (keyed by that mutation's
 * idempotency key) — safe when several "Save & add another" submissions
 * are in flight at once, since undoing one can never clobber another's
 * still-pending optimistic write.
 *
 * `transaction.listBySpace` is consumed both as an infinite query (the
 * Transactions page) AND as a plain query (AccountDetailPage,
 * EventDetailPage), both keyed by a large filter object that varies per
 * page. There's no way to know which exact filter variant — or which query
 * shape — is mounted, so instead of the per-input
 * `utils.transaction.listBySpace.setInfiniteData(input, ...)` (which
 * requires an exact match AND a fixed shape), this uses the raw
 * QueryClient with a bare path-only key from `getQueryKey(procedure)` (no
 * input) — the same "partial match everything under this path" mechanism
 * `useInvalidateAnalytics`'s no-argument `.invalidate()` calls already
 * rely on. Because that broadcast matches every shape under the path, the
 * list-patchers below handle both `InfiniteData<ListPage>` (`.pages`) and
 * plain `ListPage` (`.items` directly) — assuming only the infinite shape
 * previously threw a runtime error (`old.pages.length` on an `undefined`
 * `.pages`) whenever an Account/Event detail page's plain query was warm
 * in cache, which surfaced as the mutation failing before ever reaching
 * the network (the throw inside `onMutate` rejects before the request is
 * sent). The broadcast also reaches cached variants whose filters would
 * actually exclude this transaction (wrong type/date-range/account filter)
 * — an accepted, self-correcting tradeoff since the real `invalidate()` on
 * success replaces the page with server truth moments later.
 *
 * The personal "My money" space (`/s/me`) reads from `personal.transactions`
 * / `personal.transactionFilteredTotals` instead of `transaction.listBySpace`
 * / `filteredTotals` — same response shape, different procedure path — so
 * every operation below patches both path pairs. `setQueriesData` is a
 * no-op when no cached query matches a key, so patching the personal pair
 * unconditionally is safe even outside the personal space.
 */
export function useOptimisticTransactionCache() {
    const queryClient = useQueryClient();
    const listKeys = [
        getQueryKey(trpc.transaction.listBySpace),
        getQueryKey(trpc.personal.transactions),
    ];
    const totalsKeys = [
        getQueryKey(trpc.transaction.filteredTotals),
        getQueryKey(trpc.personal.transactionFilteredTotals),
    ];

    async function cancelBoth() {
        await Promise.all([
            ...listKeys.map((queryKey) => queryClient.cancelQueries({ queryKey })),
            ...totalsKeys.map((queryKey) => queryClient.cancelQueries({ queryKey })),
        ]);
    }

    function patchListPage(old: ListPage, row: OptimisticTxRow, mode: "add" | "remove") {
        if (mode === "add") {
            return { ...old, items: [row as unknown as ListItem, ...old.items] };
        }
        return { ...old, items: old.items.filter((it) => it.id !== row.id) };
    }

    function addPendingRow(row: OptimisticTxRow) {
        for (const queryKey of listKeys) {
            queryClient.setQueriesData(
                { queryKey },
                (old: InfiniteData<ListPage> | ListPage | undefined) => {
                    if (!old) return old;
                    if ("pages" in old) {
                        if (old.pages.length === 0) return old;
                        const pages = old.pages.slice();
                        pages[0] = patchListPage(pages[0], row, "add");
                        return { ...old, pages };
                    }
                    return patchListPage(old, row, "add");
                }
            );
        }
    }

    /** Success-path counterpart to removePendingRow. Flips this mutation's
     *  own pending row into a confirmed row IN PLACE — real server id,
     *  `__pending` stripped — instead of waiting for the follow-up
     *  invalidate() refetch to replace the page. The refetch is still what
     *  reconciles to full server truth (balances, fee rows, ordering), but
     *  it must not be the only thing that clears the "saving" state: it can
     *  fail silently (network blip, dev-server restart mid-request) or be
     *  cancelled by a sibling submission's cancelBoth(), and with
     *  refetchOnWindowFocus disabled nothing would ever retry — stranding a
     *  spinner row forever. Converting under the real id keeps the React
     *  key stable when the server row arrives (no flicker, no duplicate);
     *  if a refetch already replaced the list, the temp id is simply absent
     *  and this is a no-op. Duplicate temp rows (a double-submit that the
     *  server's idempotency cache collapsed into one transaction) confirm
     *  the first and drop the rest. */
    function confirmPendingRow(tempId: string, realId: string) {
        const confirmItems = (items: ListItem[]) => {
            if (!items.some((it) => it.id === tempId)) return items;
            let confirmed = false;
            const out: ListItem[] = [];
            for (const it of items) {
                if (it.id !== tempId) {
                    out.push(it);
                } else if (!confirmed) {
                    confirmed = true;
                    const real: Record<string, unknown> = { ...it, id: realId };
                    delete real.__pending;
                    out.push(real as unknown as ListItem);
                }
            }
            return out;
        };
        for (const queryKey of listKeys) {
            queryClient.setQueriesData(
                { queryKey },
                (old: InfiniteData<ListPage> | ListPage | undefined) => {
                    if (!old) return old;
                    /* Return the SAME reference when this variant never held
                       the temp row — a fresh wrapper object would re-render
                       every observer of every cached filter variant for a
                       no-op. */
                    if ("pages" in old) {
                        if (!old.pages.some((p) => p.items.some((it) => it.id === tempId))) {
                            return old;
                        }
                        return {
                            ...old,
                            pages: old.pages.map((p) => ({ ...p, items: confirmItems(p.items) })),
                        };
                    }
                    const items = confirmItems(old.items);
                    return items === old.items ? old : { ...old, items };
                }
            );
        }
    }

    function removePendingRow(tempId: string) {
        const placeholder = { id: tempId } as OptimisticTxRow;
        for (const queryKey of listKeys) {
            queryClient.setQueriesData(
                { queryKey },
                (old: InfiniteData<ListPage> | ListPage | undefined) => {
                    if (!old) return old;
                    if ("pages" in old) {
                        return {
                            ...old,
                            pages: old.pages.map((p) => patchListPage(p, placeholder, "remove")),
                        };
                    }
                    return patchListPage(old, placeholder, "remove");
                }
            );
        }
    }

    /**
     * Bump the IN/OUT/NET/AVG tiles for a create, scoped to the space the
     * transaction was created in.
     *
     * Two scoping rules, both learned the hard way:
     *
     *  - **Only this space's `filteredTotals`.** The row patchers above
     *    broadcast path-only, which is harmless for them (a row lands in
     *    caches that will drop it on refetch). For totals it is not: a
     *    path-only broadcast added the amount to EVERY space's cached
     *    totals, and `useInvalidateAnalytics` invalidates
     *    `filteredTotals` for one `spaceId` only — so another space's
     *    tiles stayed inflated until its own `staleTime` (30s, with
     *    refetchOnWindowFocus off) expired. Visit space A, create in
     *    space B, go back to A: wrong OUT/NET/AVG, no refetch coming.
     *
     *  - **Never the personal twin.** `personal.transactionFilteredTotals`
     *    does NOT use this income/expense-only split: it counts transfers
     *    and adjustments too, scoped by which side of the row the caller
     *    owns. Feeding it a `computeDelta` result is therefore wrong for
     *    every transfer and adjustment, and right for income/expense only
     *    by accident. `utils.personal.invalidate()` already runs in every
     *    onSuccess, so the cross-space tiles resync from the server rather
     *    than from a formula that doesn't match theirs.
     */
    function applyDelta(delta: TxDelta, spaceId: string) {
        queryClient.setQueriesData(
            {
                queryKey: getQueryKey(trpc.transaction.filteredTotals),
                predicate: (query) => {
                    const input = (
                        query.queryKey[1] as { input?: { spaceId?: string } } | undefined
                    )?.input;
                    return input?.spaceId === spaceId;
                },
            },
            (old: Totals | undefined) => {
                if (!old) return old;
                const inTotal = old.inTotal + delta.inTotal;
                const outTotal = old.outTotal + delta.outTotal;
                return {
                    ...old,
                    inTotal,
                    outTotal,
                    net: inTotal - outTotal,
                    count: old.count + delta.count,
                    /* Server totals always send days >= 1, but mirror its own
                       Math.max guard so a malformed cache entry can't yield
                       Infinity. */
                    avgPerDay: outTotal / Math.max(1, old.days),
                };
            }
        );
    }

    /** Same arithmetic as applyDelta with negated inputs, so the undo path
     *  can never drift from the apply path. */
    function reverseDelta(delta: TxDelta, spaceId: string) {
        applyDelta(
            {
                count: -delta.count,
                inTotal: -delta.inTotal,
                outTotal: -delta.outTotal,
            },
            spaceId
        );
    }

    /** Field-level merge into ONE already-real row, across every cached
     *  list variant that holds it (same broadcast reasoning as the
     *  create-path patchers above). `saving` drives the in-flight marker:
     *  set while the update is out, cleared once it settles either way.
     *  Same-reference short-circuit for variants that don't hold the row so
     *  unrelated observers don't re-render. */
    function writeRow(id: string, patch: Record<string, unknown>, saving: boolean) {
        const patchItems = (items: ListItem[]) => {
            if (!items.some((it) => it.id === id)) return items;
            return items.map((it) => {
                if (it.id !== id) return it;
                const next: Record<string, unknown> = { ...it, ...patch };
                if (saving) next[SAVING_FLAG] = true;
                else delete next[SAVING_FLAG];
                return next as unknown as ListItem;
            });
        };
        for (const queryKey of listKeys) {
            queryClient.setQueriesData(
                { queryKey },
                (old: InfiniteData<ListPage> | ListPage | undefined) => {
                    if (!old) return old;
                    if ("pages" in old) {
                        if (!old.pages.some((p) => p.items.some((it) => it.id === id))) {
                            return old;
                        }
                        return {
                            ...old,
                            pages: old.pages.map((p) => ({ ...p, items: patchItems(p.items) })),
                        };
                    }
                    const items = patchItems(old.items);
                    return items === old.items ? old : { ...old, items };
                }
            );
        }
    }

    /** Optimistic edit: show the submitted values on the existing row and
     *  flag it as saving (`SAVING_FLAG`, not `__pending` — see the type
     *  notes at the top of this file). Only the columns the form actually
     *  submitted belong in `patch` — an `undefined` server input means "no
     *  change", so it must not overwrite the cached value either.
     *
     *  Row-level only, never the totals — see the note above
     *  `useOptimisticTransactionCache` for why an edit can't compute a
     *  correct filtered delta.
     *
     *  A datetime edit DOES move the row: TransactionsPage re-derives its
     *  day groups from `transaction_datetime` on the next render, and
     *  `normalizeDayGroups` merges and re-orders them so the row lands in
     *  the day block its new date claims. What still waits for the refetch
     *  is the row's position WITHIN that day and its running balance.
     *
     *  Known limitation: any unrelated `invalidate()` (another row
     *  settling, a create elsewhere) refetches the list and wipes both this
     *  patch and the saving flag for a still-in-flight edit. The row snaps
     *  back to server values until its own request lands. Self-correcting,
     *  but it means the flag is not a dependable "is this row in flight"
     *  signal to hang further behaviour on. */
    function patchSavingRow(id: string, patch: Record<string, unknown>) {
        writeRow(id, patch, true);
    }

    /** Success path: keep the optimistic values, clear the saving marker —
     *  the follow-up invalidate() reconciles to server truth (balances, fee
     *  rows, ordering) but must never be the only thing that clears it; see
     *  confirmPendingRow's doc for why. */
    function settleRow(id: string) {
        writeRow(id, {}, false);
    }

    /** Failure path: put the pre-edit column values back and clear the
     *  saving marker. Callers should still resync via invalidate() —
     *  `prev` is the row as it looked when the edit sheet opened, which a
     *  refetch in between may have already moved past. */
    function restoreRow(id: string, prev: Record<string, unknown>) {
        writeRow(id, prev, false);
    }

    return {
        cancelBoth,
        addPendingRow,
        confirmPendingRow,
        removePendingRow,
        patchSavingRow,
        settleRow,
        restoreRow,
        applyDelta,
        reverseDelta,
    };
}
