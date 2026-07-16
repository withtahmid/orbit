import { useMemo, useRef, useState, type ComponentType } from "react";
import { ChevronDown, FolderTree } from "lucide-react";
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
import { cn } from "@/lib/utils";

export interface CategoryRow {
    id: string;
    name: string;
    color: string;
    icon: string;
    parent_id: string | null;
    /** Present only on the personal cross-space list — used to disambiguate
     *  same-named categories from different spaces. */
    space_name?: string | null;
}

interface CategoryNode extends CategoryRow {
    depth: number;
    descendantCount: number;
}

/** Multi-select dropdown that surfaces the hierarchy: each parent row
 *  carries a "+N sub" badge so users see at a glance that selecting it
 *  includes descendants. Shared between `AnalyticsFilterBar` (filters
 *  underlying transactions), any chart that wants to let a user hand-pick
 *  specific categories (e.g. the Categories trend chart), and — via the
 *  label/copy overrides below — flat (non-hierarchical) entity lists like
 *  EnvelopesView's envelope-narrowing pickers, where every row's
 *  `parent_id` is simply `null`. */
export function CategoryMultiSelect({
    selected,
    categories,
    onChange,
    label = "Categories",
    icon: Icon = FolderTree,
    menuLabel = "Filter by category",
    searchPlaceholder = "Search categories…",
    footerHint = "Selecting a category includes all sub-categories.",
}: {
    selected: string[];
    categories: CategoryRow[];
    onChange: (next: string[]) => void;
    /** Trigger button label prefix, e.g. "Categories" → "Categories · 3". */
    label?: string;
    icon?: ComponentType<{ className?: string }>;
    menuLabel?: string;
    searchPlaceholder?: string;
    /** Footer hint below the list. Pass `null` to omit — appropriate for
     *  flat (non-hierarchical) entity lists where it wouldn't apply. */
    footerHint?: string | null;
}) {
    const [query, setQuery] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);
    const selectedSet = useMemo(() => new Set(selected), [selected]);

    // Names that appear more than once (personal cross-space list) get a
    // space suffix so the two rows aren't indistinguishable.
    const dupNames = useMemo(() => {
        const counts = new Map<string, number>();
        for (const c of categories) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
        return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
    }, [categories]);

    const flattened = useMemo<CategoryNode[]>(() => {
        const byParent = new Map<string | null, CategoryRow[]>();
        for (const c of categories) {
            const arr = byParent.get(c.parent_id) ?? [];
            arr.push(c);
            byParent.set(c.parent_id, arr);
        }
        for (const arr of byParent.values()) {
            arr.sort((a, b) => a.name.localeCompare(b.name));
        }
        const descCount = new Map<string, number>();
        // `path` guards against a parent_id cycle — the server enforces
        // this everywhere it recurses the category tree (`changeParent`
        // blocks creating one; the recursive CTEs in `categoryBreakdown`/
        // `categoryMonthlyTrend` carry the same guard as defense-in-depth),
        // but this client-side walk had no equivalent — a corrupt cycle in
        // stale/pre-existing data would otherwise recurse forever and
        // white-screen the dropdown.
        const countDescendants = (id: string, path: Set<string> = new Set()): number => {
            if (path.has(id)) return 0;
            const direct = byParent.get(id) ?? [];
            const nextPath = new Set(path).add(id);
            let n = direct.length;
            for (const child of direct) n += countDescendants(child.id, nextPath);
            descCount.set(id, n);
            return n;
        };
        for (const c of categories) {
            if (!descCount.has(c.id)) countDescendants(c.id);
        }
        const out: CategoryNode[] = [];
        const walk = (parentId: string | null, depth: number, path: Set<string> = new Set()) => {
            const arr = byParent.get(parentId) ?? [];
            for (const c of arr) {
                if (path.has(c.id)) continue;
                out.push({ ...c, depth, descendantCount: descCount.get(c.id) ?? 0 });
                walk(c.id, depth + 1, new Set(path).add(c.id));
            }
        };
        walk(null, 0);
        return out;
    }, [categories]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return flattened;
        return flattened.filter((n) => n.name.toLowerCase().includes(q));
    }, [query, flattened]);

    const triggerLabel =
        selected.length === 0
            ? `${label} · All`
            : selected.length === 1
              ? (categories.find((c) => selectedSet.has(c.id))?.name ?? `${label} · 1`)
              : `${label} · ${selected.length}`;

    const toggle = (id: string) => {
        const next = selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id];
        onChange(next);
    };

    return (
        <DropdownMenu
            onOpenChange={(o) => {
                if (!o) {
                    setQuery("");
                    return;
                }
                // Radix's roving-focus menu skips the plain `<div>` the
                // search input lives in (it's not a menu item), so arrow
                // keys alone can never reach it, and this primitive has no
                // public `onOpenAutoFocus` escape hatch (it's intentionally
                // private here, unlike Dialog/Popover) to redirect its own
                // auto-focus-first-item behavior. Nudging focus to the
                // input right after open — after Radix's own focus-scope
                // effect has run — lets a keyboard user start typing
                // immediately instead of the field being unreachable.
                requestAnimationFrame(() => searchRef.current?.focus());
            }}
        >
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                        "h-9 gap-1.5 px-2.5 text-sm sm:h-7 sm:text-[12px]",
                        selected.length > 0 && "border-warning/40 bg-warning/5 text-foreground"
                    )}
                >
                    <Icon className="size-3.5" />
                    <span className="max-w-[180px] truncate">{triggerLabel}</span>
                    <ChevronDown className="size-3 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[min(18rem,calc(100vw-1.5rem))]">
                <DropdownMenuLabel className="text-xs">{menuLabel}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 pb-1.5">
                    <Input
                        ref={searchRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key !== "Escape") e.stopPropagation();
                        }}
                        placeholder={searchPlaceholder}
                        aria-label={searchPlaceholder.replace("…", "")}
                        className="h-7 text-[16px] sm:text-xs"
                    />
                </div>
                {categories.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">No categories.</p>
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
                        <div className="max-h-[300px] overflow-y-auto">
                            {filtered.length === 0 ? (
                                <p className="px-2 py-2 text-center text-xs text-muted-foreground">
                                    No matches
                                </p>
                            ) : (
                                filtered.map((n) => (
                                    <DropdownMenuCheckboxItem
                                        key={n.id}
                                        checked={selectedSet.has(n.id)}
                                        onCheckedChange={() => toggle(n.id)}
                                        onSelect={(e) => e.preventDefault()}
                                        style={{
                                            paddingLeft: `${0.5 + n.depth * 0.75}rem`,
                                        }}
                                    >
                                        <span className="flex min-w-0 flex-1 items-center gap-2">
                                            <EntityAvatar size="sm" color={n.color} icon={n.icon} />
                                            <span className="truncate">
                                                {n.name}
                                                {dupNames.has(n.name) && n.space_name && (
                                                    <span className="text-muted-foreground">
                                                        {" · "}
                                                        {n.space_name}
                                                    </span>
                                                )}
                                            </span>
                                            {n.descendantCount > 0 && (
                                                <span
                                                    className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                                                    title={`Includes ${n.descendantCount} sub-categor${
                                                        n.descendantCount === 1 ? "y" : "ies"
                                                    }`}
                                                    aria-label={`includes ${n.descendantCount} sub-categor${
                                                        n.descendantCount === 1 ? "y" : "ies"
                                                    }`}
                                                >
                                                    +{n.descendantCount}
                                                </span>
                                            )}
                                        </span>
                                    </DropdownMenuCheckboxItem>
                                ))
                            )}
                        </div>
                    </>
                )}
                {footerHint && (
                    <>
                        <DropdownMenuSeparator />
                        <p className="px-2 pb-1.5 pt-1 text-[10.5px] text-muted-foreground">
                            {footerHint}
                        </p>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default CategoryMultiSelect;
