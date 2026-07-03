import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpc } from "@/trpc";
import type { RouterOutput } from "@/trpc";

type ListPage = RouterOutput["transaction"]["listBySpace"];
export type ListItem = ListPage["items"][number];
type Totals = RouterOutput["transaction"]["filteredTotals"];

/** Marker field added to a client-synthesized row. Never present on a real
 *  server row, so `!t.__pending` is a safe "is this row real?" check
 *  wherever a row is rendered. */
// `ListItem["type"]` codegens as an array type (kysely-codegen misreads the
// `__type_transaction_type` Postgres enum) even though the runtime value is
// a scalar string — override it here rather than casting at every call site.
export type OptimisticTxRow = Omit<ListItem, "type"> & {
    type: "income" | "expense" | "transfer" | "adjustment";
    __pending: true;
};

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

/**
 * Cache-patch helpers for optimistic transaction creation. Unlike
 * usePins.ts's snapshot/restore pattern, every operation here reads the
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
                        if (
                            !old.pages.some((p) => p.items.some((it) => it.id === tempId))
                        ) {
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

    function applyDelta(delta: TxDelta) {
        for (const queryKey of totalsKeys) {
            queryClient.setQueriesData({ queryKey }, (old: Totals | undefined) => {
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
            });
        }
    }

    /** Same arithmetic as applyDelta with negated inputs, so the undo path
     *  can never drift from the apply path. */
    function reverseDelta(delta: TxDelta) {
        applyDelta({
            count: -delta.count,
            inTotal: -delta.inTotal,
            outTotal: -delta.outTotal,
        });
    }

    return {
        cancelBoth,
        addPendingRow,
        confirmPendingRow,
        removePendingRow,
        applyDelta,
        reverseDelta,
    };
}
