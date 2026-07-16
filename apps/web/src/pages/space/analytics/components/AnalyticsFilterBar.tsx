import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Tags, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { trpc } from "@/trpc";
import { cn } from "@/lib/utils";
import type { FilterKey } from "./useAnalyticsFilters";
import { CategoryMultiSelect, type CategoryRow } from "./CategoryMultiSelect";

/** Which filter dimensions to surface. Envelopes/Categories are always
 *  hidden on personal (`/s/me`) regardless of this, since they're
 *  space-scoped. Defaults to all three. */
export type FilterDimensions = {
    envelopes?: boolean;
    accounts?: boolean;
    categories?: boolean;
};

/**
 * Shared analytics filter bar. Three dropdowns on space pages (envelope,
 * account, category) collapse to just **Accounts** on `/s/me` because
 * envelopes and categories are space-scoped — rolling them up across a
 * user's spaces would be misleading.
 *
 * `dimensions` lets a host page hide a filter it doesn't want (e.g.
 * Spending-by-category passes `{ categories: false }` because its drill
 * already navigates the category tree).
 *
 * State lives in URL search params (`env`, `acc`, `cat`) via
 * `useAnalyticsFilters`, so links are shareable.
 */
export function AnalyticsFilterBar({
    spaceId,
    isPersonal,
    envelopeIds,
    accountIds,
    categoryIds,
    onChange,
    onClearAll,
    hasAnyFilter,
    dimensions,
    accountsFootnote = "Money leaving the selected account(s).",
    trailingChips,
    className,
    personalCategories,
}: {
    spaceId: string;
    isPersonal: boolean;
    envelopeIds: string[];
    accountIds: string[];
    categoryIds: string[];
    onChange: (key: FilterKey, values: string[]) => void;
    onClearAll: () => void;
    hasAnyFilter: boolean;
    dimensions?: FilterDimensions;
    /** Footnote under the Accounts dropdown. Defaults to the analytics
     *  outflow phrasing; the Transactions page (which matches money in
     *  and out of the account) passes its own. */
    accountsFootnote?: string;
    /** Extra chips rendered inline after the built-in dropdowns (before
     *  "Clear all"). The Transactions page uses this for its Event / Amount
     *  / No-envelope filters so they sit in the same row. */
    trailingChips?: ReactNode;
    /** Extra class on the bar root — lets a host scope style overrides. */
    className?: string;
    /** Allow the Category filter on the personal (`/s/me`) view, sourced
     *  from the caller's cross-space categories. Off by default because
     *  analytics personal views classify by category via their own drill;
     *  the Transactions page opts in to keep parity with regular spaces. */
    personalCategories?: boolean;
}) {
    const showEnvelopes = dimensions?.envelopes !== false;
    const showAccounts = dimensions?.accounts !== false;
    // Categories can appear on personal only when the host opts in.
    const showCategories =
        dimensions?.categories !== false && (!isPersonal || !!personalCategories);

    const envelopesQ = trpc.envelop.listBySpace.useQuery(
        { spaceId },
        { enabled: !isPersonal && showEnvelopes }
    );
    const categoriesQ = trpc.expenseCategory.listBySpace.useQuery(
        { spaceId },
        { enabled: !isPersonal && showCategories }
    );
    const personalCategoriesQ = trpc.personal.listCategories.useQuery(undefined, {
        enabled: isPersonal && showCategories,
    });
    const accountsSpaceQ = trpc.account.listBySpace.useQuery({ spaceId }, { enabled: !isPersonal });
    const accountsPersonalQ = trpc.personal.ownedAccounts.useQuery(undefined, {
        enabled: isPersonal,
    });

    const envelopes = useMemo(
        () =>
            (envelopesQ.data ?? [])
                .filter((e) => !e.archived)
                .map((e) => ({
                    id: e.id,
                    name: e.name,
                    color: e.color,
                    icon: e.icon,
                })),
        [envelopesQ.data]
    );
    const accounts = useMemo(() => {
        const src = isPersonal ? (accountsPersonalQ.data ?? []) : (accountsSpaceQ.data ?? []);
        return src.map((a) => ({
            id: a.id,
            name: a.name,
            color: a.color,
            icon: a.icon,
        }));
    }, [isPersonal, accountsPersonalQ.data, accountsSpaceQ.data]);

    const categoriesRaw = useMemo(
        () => (isPersonal ? (personalCategoriesQ.data ?? []) : (categoriesQ.data ?? [])),
        [isPersonal, personalCategoriesQ.data, categoriesQ.data]
    );

    return (
        <div className={cn("-mt-1 flex flex-col gap-1.5", className)}>
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Filter
                </span>
                {!isPersonal && showEnvelopes && (
                    <ChipMultiSelect
                        icon={<Tags className="size-3.5" />}
                        label="Envelopes"
                        selected={envelopeIds}
                        items={envelopes}
                        onChange={(v) => onChange("env", v)}
                        searchPlaceholder="Search envelopes…"
                        emptyLabel="No envelopes."
                    />
                )}
                {showAccounts && (
                    <ChipMultiSelect
                        icon={<Wallet className="size-3.5" />}
                        label="Accounts"
                        selected={accountIds}
                        items={accounts}
                        onChange={(v) => onChange("acc", v)}
                        searchPlaceholder="Search accounts…"
                        emptyLabel="No accounts."
                        footnote={accountsFootnote}
                    />
                )}
                {showCategories && (
                    <CategoryMultiSelect
                        selected={categoryIds}
                        categories={categoriesRaw}
                        onChange={(v) => onChange("cat", v)}
                    />
                )}
                {trailingChips}
                {hasAnyFilter && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground sm:h-7 sm:text-[11.5px]"
                        onClick={onClearAll}
                    >
                        <X className="size-3" /> Clear all
                    </Button>
                )}
            </div>
            {hasAnyFilter && (
                <FilterSummaryLine
                    envelopeIds={!isPersonal && showEnvelopes ? envelopeIds : []}
                    accountIds={showAccounts ? accountIds : []}
                    categoryIds={showCategories ? categoryIds : []}
                    envelopes={envelopes}
                    accounts={accounts}
                    categories={categoriesRaw}
                />
            )}
        </div>
    );
}

interface NamedItem {
    id: string;
    name: string;
    color: string;
    icon: string;
}

function ChipMultiSelect({
    icon,
    label,
    selected,
    items,
    onChange,
    searchPlaceholder,
    emptyLabel,
    footnote,
}: {
    icon: React.ReactNode;
    label: string;
    selected: string[];
    items: NamedItem[];
    onChange: (next: string[]) => void;
    searchPlaceholder: string;
    emptyLabel: string;
    footnote?: string;
}) {
    const [query, setQuery] = useState("");
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter((i) => i.name.toLowerCase().includes(q));
    }, [query, items]);
    const selectedSet = useMemo(() => new Set(selected), [selected]);
    const triggerLabel =
        selected.length === 0
            ? `${label} · All`
            : selected.length === 1
              ? (items.find((i) => selectedSet.has(i.id))?.name ?? `${label} · 1`)
              : `${label} · ${selected.length}`;

    const toggle = (id: string) => {
        const next = selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id];
        onChange(next);
    };

    return (
        <DropdownMenu onOpenChange={(o) => !o && setQuery("")}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                        "h-9 gap-1.5 px-2.5 text-sm sm:h-7 sm:text-[12px]",
                        selected.length > 0 && "border-warning/40 bg-warning/5 text-foreground"
                    )}
                >
                    {icon}
                    <span className="max-w-[160px] truncate">{triggerLabel}</span>
                    <ChevronDown className="size-3 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[min(16rem,calc(100vw-1.5rem))]">
                <DropdownMenuLabel className="text-xs">
                    Filter by {label.toLowerCase()}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 pb-1.5">
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={searchPlaceholder}
                        aria-label={searchPlaceholder}
                        className="h-7 text-[16px] sm:text-xs"
                    />
                </div>
                {items.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">{emptyLabel}</p>
                ) : (
                    <>
                        <DropdownMenuItem
                            onSelect={(e) => {
                                e.preventDefault();
                                onChange([]);
                            }}
                            disabled={selected.length === 0}
                            className="text-xs"
                        >
                            Clear selection
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <div className="max-h-[260px] overflow-y-auto">
                            {filtered.length === 0 ? (
                                <p className="px-2 py-2 text-center text-xs text-muted-foreground">
                                    No matches
                                </p>
                            ) : (
                                filtered.map((it) => (
                                    <DropdownMenuCheckboxItem
                                        key={it.id}
                                        checked={selectedSet.has(it.id)}
                                        onCheckedChange={() => toggle(it.id)}
                                        onSelect={(e) => e.preventDefault()}
                                    >
                                        <span className="flex min-w-0 items-center gap-2">
                                            <EntityAvatar
                                                size="sm"
                                                color={it.color}
                                                icon={it.icon}
                                            />
                                            <span className="truncate">{it.name}</span>
                                        </span>
                                    </DropdownMenuCheckboxItem>
                                ))
                            )}
                        </div>
                    </>
                )}
                {footnote && (
                    <>
                        <DropdownMenuSeparator />
                        <p className="px-2 pb-1.5 pt-1 text-[10.5px] text-muted-foreground">
                            {footnote}
                        </p>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** One-line summary under the filter buttons — names the active picks so
 *  the user doesn't have to open the popovers to remember what they set. */
function FilterSummaryLine({
    envelopeIds,
    accountIds,
    categoryIds,
    envelopes,
    accounts,
    categories,
}: {
    envelopeIds: string[];
    accountIds: string[];
    categoryIds: string[];
    envelopes: NamedItem[];
    accounts: NamedItem[];
    categories: CategoryRow[];
}) {
    const parts: string[] = [];
    const nameOf = (ids: string[], items: { id: string; name: string }[], label: string) => {
        if (ids.length === 0) return;
        if (ids.length === 1) {
            const name = items.find((i) => i.id === ids[0])?.name;
            if (name) parts.push(name);
            return;
        }
        if (ids.length <= 2) {
            const names = ids
                .map((id) => items.find((i) => i.id === id)?.name)
                .filter((n): n is string => !!n);
            if (names.length > 0) parts.push(names.join(", "));
            return;
        }
        parts.push(`${ids.length} ${label}`);
    };
    // Callers pass [] for any dimension that isn't shown, so trust the
    // arrays directly rather than re-gating on isPersonal here.
    nameOf(envelopeIds, envelopes, "envelopes");
    nameOf(accountIds, accounts, "accounts");
    nameOf(categoryIds, categories, "categories");
    if (parts.length === 0) return null;
    return <p className="text-[11px] text-muted-foreground">Filtered to {parts.join(" · ")}</p>;
}
