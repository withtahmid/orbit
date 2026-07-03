import { useMemo, useState } from "react";
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
 * Single-select hierarchical category picker. When a parent is selected,
 * callers are expected to treat the filter as "include all descendants" —
 * that's the server's job via `includeDescendants` flag on the procedure.
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

    const filtered = useMemo(() => {
        if (!query.trim()) return flat;
        const q = query.toLowerCase();
        // When searching: show matching nodes + their ancestors, flattened.
        const matchSet = new Set<string>();
        categories.forEach((c) => {
            if (c.name.toLowerCase().includes(q)) matchSet.add(c.id);
        });
        // include ancestors of matches
        const byId = new Map(categories.map((c) => [c.id, c]));
        const all = new Set<string>(matchSet);
        matchSet.forEach((id) => {
            let cur = byId.get(id);
            while (cur && cur.parent_id) {
                all.add(cur.parent_id);
                cur = byId.get(cur.parent_id);
            }
        });
        const visible = flatten(tree, new Set());
        return visible.filter((n) => all.has(n.id));
    }, [query, flat, tree, categories]);

    const selected = categories.find((c) => c.id === value);

    return (
        <Popover open={open} onOpenChange={setOpen}>
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
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                    {allowAll && (
                        <button
                            type="button"
                            onClick={() => {
                                onChange(null);
                                setOpen(false);
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
                    {filtered.length === 0 && (
                        <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                            No categories
                        </p>
                    )}
                    {filtered.map((n) => {
                        const hasChildren = n.children.length > 0;
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
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setCollapsed((s) => {
                                                const next = new Set(s);
                                                if (next.has(n.id)) next.delete(n.id);
                                                else next.add(n.id);
                                                return next;
                                            });
                                        }}
                                        className="flex size-5 items-center justify-center text-muted-foreground"
                                    >
                                        <ChevronRight
                                            className={cn(
                                                "size-3.5 transition-transform",
                                                !isCollapsed && "rotate-90"
                                            )}
                                        />
                                    </button>
                                ) : (
                                    <span className="size-5" />
                                )}
                                <button
                                    type="button"
                                    onClick={() => {
                                        onChange(n.id);
                                        setOpen(false);
                                    }}
                                    className="flex flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-sm"
                                >
                                    <EntityAvatar size="sm" color={n.color} icon={n.icon} />
                                    <span className="truncate">{n.name}</span>
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
