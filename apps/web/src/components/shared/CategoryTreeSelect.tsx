import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, ChevronRight, FolderTree } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { EntityAvatar } from "@/components/shared/EntityAvatar";

export interface CategoryLike {
    id: string;
    name: string;
    parent_id: string | null;
    color: string;
    icon: string;
}

interface Node extends CategoryLike {
    children: Node[];
    depth: number;
}

function buildTree(cats: CategoryLike[]): Node[] {
    const map = new Map<string, Node>();
    cats.forEach((c) => map.set(c.id, { ...c, children: [], depth: 0 }));
    const roots: Node[] = [];
    map.forEach((n) => {
        if (n.parent_id && map.has(n.parent_id)) {
            map.get(n.parent_id)!.children.push(n);
        } else {
            roots.push(n);
        }
    });
    // Alphabetical siblings — matches the /categories page ordering so the
    // same tree reads identically everywhere (server order is created_at).
    const byName = (a: Node, b: Node) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    const assignDepth = (n: Node, depth: number) => {
        n.depth = depth;
        n.children.sort(byName);
        n.children.forEach((c) => assignDepth(c, depth + 1));
    };
    roots.sort(byName);
    roots.forEach((r) => assignDepth(r, 0));
    return roots;
}

function flatten(nodes: Node[], collapsed: Set<string>, acc: Node[] = []): Node[] {
    for (const n of nodes) {
        acc.push(n);
        if (!collapsed.has(n.id)) flatten(n.children, collapsed, acc);
    }
    return acc;
}

/**
 * Single-select hierarchical category picker for ASSIGNMENT — the
 * transaction sheets and the /categories parent picker. Selecting a row
 * means literally that category, so a user must be able to land on the
 * exact node; that's why searching reveals a matched group's children
 * (see the search memo below). Category *filtering* is a different
 * component with different semantics — `CategoryMultiSelect`, where
 * picking a parent includes its descendants server-side.
 *
 * Always pass the FULL category list — pre-filtering it removes parents
 * and silently promotes their children to top level, mangling the tree.
 */
export function CategoryTreeSelect({
    categories,
    value,
    onChange,
    placeholder = "Any category",
    className,
    allowAll = true,
}: {
    categories: CategoryLike[];
    value: string | null;
    onChange: (id: string | null) => void;
    placeholder?: string;
    className?: string;
    allowAll?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const tree = useMemo(() => buildTree(categories), [categories]);
    const flat = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);

    /**
     * Search result set. A hit pulls in BOTH directions:
     *  - its ancestors, so every hit keeps a readable path instead of
     *    floating at the left margin, and
     *  - its whole subtree, because people search the group they remember
     *    and then pick from inside it — typing "groceries" has to reveal
     *    "Rice", "Cooking oil", … which the user can't be expected to
     *    recall by name.
     * `matched` is returned alongside so direct hits can be distinguished
     * from the context rows pulled in around them.
     */
    const { rows, matched } = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return { rows: flat, matched: new Set<string>() };

        const byId = new Map(categories.map((c) => [c.id, c]));
        // Same orphan stance as buildTree: a parent_id pointing at a row
        // that isn't in this list is treated as top-level, never as a link.
        const childrenOf = new Map<string, string[]>();
        for (const c of categories) {
            if (!c.parent_id || !byId.has(c.parent_id)) continue;
            const siblings = childrenOf.get(c.parent_id);
            if (siblings) siblings.push(c.id);
            else childrenOf.set(c.parent_id, [c.id]);
        }

        /* Which hits pull in their SUBTREE. Any substring hit shows the row
           itself — "cer" still finds "Groceries" — but only a hit at the
           start of the name (or of a word inside it) reads as "the user
           typed this group's name and wants what's inside it". Without that
           floor, one common letter matched nearly every category, expanded
           every subtree, and — with the collapse chevrons suppressed during
           search — produced a fully-expanded tree LONGER than the
           unsearched view with no way to fold it back. */
        const seedsSubtree = (name: string) => {
            /* Needs at least two characters. One letter matches most names
               directly, so seeding on it re-created the very problem this
               gate exists for: a fully expanded tree with the collapse
               chevrons suppressed. (The word split also treats apostrophes
               as boundaries, so "Kid's toys" would otherwise let "s" seed
               a subtree.) */
            if (q.length < 2) return false;
            const lower = name.toLowerCase();
            if (lower.startsWith(q)) return true;
            return lower.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(q));
        };

        const matchedIds: string[] = [];
        const subtreeSeeds: string[] = [];
        for (const c of categories) {
            if (!c.name.toLowerCase().includes(q)) continue;
            matchedIds.push(c.id);
            if (seedsSubtree(c.name)) subtreeSeeds.push(c.id);
        }
        const visible = new Set<string>(matchedIds);

        for (const id of matchedIds) {
            let cur = byId.get(id);
            /* Visited-guard on every category walk in this app — the server
               blocks creating a parent_id cycle, but corrupt data must
               degrade, not hang the picker. */
            const seen = new Set<string>([id]);
            while (cur?.parent_id && byId.has(cur.parent_id) && !seen.has(cur.parent_id)) {
                seen.add(cur.parent_id);
                visible.add(cur.parent_id);
                cur = byId.get(cur.parent_id);
            }
        }

        const stack = [...subtreeSeeds];
        const walked = new Set<string>();
        while (stack.length) {
            const id = stack.pop()!;
            if (walked.has(id)) continue;
            walked.add(id);
            for (const childId of childrenOf.get(id) ?? []) {
                visible.add(childId);
                stack.push(childId);
            }
        }

        /* Flatten with nothing collapsed: results are always fully
           expanded, so a hit deep in a folded branch is still reachable. */
        return {
            rows: flatten(tree, new Set()).filter((n) => visible.has(n.id)),
            matched: new Set(matchedIds),
        };
    }, [query, flat, tree, categories]);

    const isSearching = query.trim().length > 0;

    const selected = categories.find((c) => c.id === value);

    /* Reset the scroll on every query change. Result sets now vary a lot in
       length per keystroke, and a retained scrollTop gets clamped to the
       shorter list — landing the user at the BOTTOM of their new results
       with the top matches off-screen, which reads as "no matches" on a
       phone where only a few rows are visible. */
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        listRef.current?.scrollTo({ top: 0 });
    }, [query]);

    /* Single close path: drop the query so the next open starts from the
       full tree — a filter left over from an earlier pick reads as "these
       are all my categories". Routed through one helper because Radix only
       reports outside-click/Esc via onOpenChange; the row selections below
       close imperatively. Matches CategoryMultiSelect's reset-on-close. */
    const close = () => {
        setOpen(false);
        setQuery("");
    };

    return (
        <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn("w-full justify-between", className)}
                >
                    <span className="flex min-w-0 items-center gap-2">
                        {selected ? (
                            <>
                                <EntityAvatar
                                    size="sm"
                                    color={selected.color}
                                    icon={selected.icon}
                                />
                                <span className="truncate">{selected.name}</span>
                            </>
                        ) : (
                            <>
                                <FolderTree className="size-4 text-muted-foreground" />
                                <span className="truncate text-muted-foreground">
                                    {placeholder}
                                </span>
                            </>
                        )}
                    </span>
                    <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                portal={false}
                className="flex w-[--radix-popover-trigger-width] min-w-[min(18rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] flex-col p-0"
                align="start"
                style={{
                    maxHeight: "min(var(--radix-popover-content-available-height, 24rem), 24rem)",
                }}
            >
                <div className="shrink-0 border-b border-border p-2">
                    <Input
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search categories…"
                        className="h-8"
                    />
                </div>
                {/* Result count for screen readers: the list length now swings
                    widely per keystroke (a group hit reveals its whole subtree),
                    which is silent to AT without this. */}
                <p className="sr-only" aria-live="polite">
                    {isSearching
                        ? `${matched.size} ${matched.size === 1 ? "category" : "categories"} match, ${rows.length} shown`
                        : ""}
                </p>
                <div
                    ref={listRef}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
                >
                    {/* Hidden while searching: "Any category" is not a search
                        result, and it otherwise sits above the "no match" line
                        as if it were one. close() clears the query, so the row
                        is always reachable again. */}
                    {allowAll && !isSearching && (
                        <button
                            type="button"
                            onClick={() => {
                                onChange(null);
                                close();
                            }}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                                value === null && "bg-accent"
                            )}
                        >
                            <span className="size-3.5" />
                            <span className="text-muted-foreground">{placeholder}</span>
                        </button>
                    )}
                    {rows.length === 0 && (
                        <p className="break-words px-2 py-4 text-center text-xs text-muted-foreground">
                            {isSearching
                                ? `No category matches “${query.trim()}”`
                                : "No categories"}
                        </p>
                    )}
                    {rows.map((n) => {
                        /* While searching, results are force-expanded, so the
                           collapse toggle would be a control that visibly does
                           nothing — render the same spacer leaf rows use and
                           let the query itself narrow the list. */
                        const hasChildren = n.children.length > 0 && !isSearching;
                        const isCollapsed = collapsed.has(n.id);
                        const active = value === n.id;
                        return (
                            <div
                                key={n.id}
                                className={cn(
                                    "flex items-center gap-1 rounded-md hover:bg-accent",
                                    active && "bg-accent"
                                )}
                                style={{ paddingLeft: `${n.depth * 12}px` }}
                            >
                                {hasChildren ? (
                                    <button
                                        type="button"
                                        aria-expanded={!isCollapsed}
                                        aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${n.name}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setCollapsed((s) => {
                                                const next = new Set(s);
                                                if (next.has(n.id)) next.delete(n.id);
                                                else next.add(n.id);
                                                return next;
                                            });
                                        }}
                                        /* w-7 + self-stretch: a 20px square
                                           sat 4px from the select button, and a
                                           miss there silently REASSIGNS the
                                           transaction's category. shrink-0
                                           keeps it pixel-aligned with the
                                           spacer under horizontal pressure. */
                                        className="flex w-7 shrink-0 self-stretch items-center justify-center text-muted-foreground"
                                    >
                                        <ChevronRight
                                            className={cn(
                                                "size-3.5 transition-transform",
                                                !isCollapsed && "rotate-90"
                                            )}
                                        />
                                    </button>
                                ) : (
                                    <span className="w-7 shrink-0" />
                                )}
                                <button
                                    type="button"
                                    onClick={() => {
                                        onChange(n.id);
                                        close();
                                    }}
                                    /* min-w-0 is load-bearing: `flex-1` sets
                                       flex-basis but leaves min-width:auto, so
                                       the item floors at the nowrap text's
                                       min-content width and `truncate` below
                                       never takes effect — long names overflowed
                                       and gave the scroll container a horizontal
                                       scrollbar. */
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-sm"
                                >
                                    <EntityAvatar size="sm" color={n.color} icon={n.icon} />
                                    {/* Direct hits carry the weight; the ancestors
                                        and sub-categories pulled in around them stay
                                        regular — both are still selectable, so
                                        muting them would misread as disabled. */}
                                    {/* <strong> for direct hits — visually stronger
                                        than font-medium, which barely registered as
                                        the one signal separating a hit from the
                                        context rows now surrounding it. Note this
                                        does NOT reach screen readers: bold isn't
                                        announced in browse mode and formatting is
                                        stripped from a button's accessible name.
                                        The aria-live count above is what carries
                                        the result state for AT. */}
                                    {matched.has(n.id) ? (
                                        <strong className="truncate font-semibold">{n.name}</strong>
                                    ) : (
                                        <span className="truncate">{n.name}</span>
                                    )}
                                    {active && <Check className="ml-auto size-4" />}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
