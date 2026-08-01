import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
    Check,
    FolderTree,
    Layers,
    Plus,
    Trash2,
    ChevronRight,
    ChevronDown,
    ChevronsDownUp,
    ChevronsUpDown,
    CornerDownRight,
    Folder,
    GripVertical,
    Search,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import { ROUTES } from "@/router/routes";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ColorPickerButton } from "@/components/shared/ColorPicker";
import { IconPickerButton } from "@/components/shared/IconPicker";
import { CategoryTreeSelect } from "@/components/shared/CategoryTreeSelect";
import { OrbitField } from "@/components/orbit/OrbitModalShell";
import { OrbitFormStyles, OrbitInput } from "@/components/orbit/OrbitForm";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { trpc } from "@/trpc";
import { useInvalidateAnalytics } from "@/lib/invalidate";
import { useCurrentSpace, useIsOwner } from "@/hooks/useCurrentSpace";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import { DEFAULT_COLOR } from "@/lib/entityStyle";
import { APP_TIMEZONE } from "@/lib/dates";

/* ============================================================
   Types & tree helpers
   ============================================================ */

type Priority = "essential" | "important" | "discretionary" | "luxury";

/** `letter` is the row badge glyph — priority must never be color-only. */
const PRIORITIES: Record<Priority, { label: string; letter: string; color: string }> = {
    essential: { label: "Essential", letter: "E", color: "var(--income)" },
    important: { label: "Important", letter: "I", color: "var(--ent-2)" },
    discretionary: { label: "Discretionary", letter: "D", color: "var(--gold)" },
    luxury: { label: "Luxury", letter: "L", color: "var(--expense)" },
};

const PRIORITY_KEYS = Object.keys(PRIORITIES) as Priority[];

/** Tree-pane filter value: a tier, or "none" for "no effective priority". */
type PriorityFilter = Priority | "none";

const VIEW_MODE_KEY = "orbit.categories.viewMode";

interface CategoryUsage {
    id: string;
    space_id: string;
    name: string;
    parent_id: string | null;
    color: string;
    icon: string;
    priority: Priority | null;
    tx_count: number;
    last_used: Date | string | null;
}

interface CategoryNode extends CategoryUsage {
    children: CategoryNode[];
}

/** A row in the flattened, currently-visible tree. */
interface VisibleRow {
    node: CategoryNode;
    depth: number;
    effectivePriority: Priority | null;
    priorityInherited: boolean;
    descendants: number;
    /** Children of this node that are also rows in the same section. */
    hasChildRows: boolean;
    /** Priority mode only: ancestors that live in a different tier, so a
        subtree lifted into this card still shows where it came from. */
    pathLabel?: string;
}

/** A masonry card: one top-level category and its visible descendants. */
interface TreeGroup {
    key: string;
    rows: VisibleRow[];
    /** Sort weight. Deliberately NOT `rows.length` in tree mode: expanding a
        node would change it and the card would jump out from under the
        pointer mid-click. Whole-subtree size is expansion-independent. */
    size: number;
}

/** A full-width band of cards. Tree mode has exactly one (unlabelled);
    priority mode stacks one per tier, so no card column ever runs long. */
interface TreeSection {
    key: string;
    groups: TreeGroup[];
    /** Set in priority mode; drives the band header. */
    tier?: PriorityFilter;
    /** Categories in this band — same as the sum of its cards' rows. */
    count: number;
}

type ViewMode = "tree" | "priority";

function buildTree(flat: CategoryUsage[]): {
    roots: CategoryNode[];
    byId: Map<string, CategoryNode>;
} {
    const byId = new Map<string, CategoryNode>();
    flat.forEach((c) => byId.set(c.id, { ...c, children: [] }));
    const roots: CategoryNode[] = [];
    byId.forEach((node) => {
        if (node.parent_id && byId.has(node.parent_id)) {
            byId.get(node.parent_id)!.children.push(node);
        } else {
            roots.push(node);
        }
    });
    const byName = (a: CategoryNode, b: CategoryNode) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    const sortRec = (nodes: CategoryNode[]) => {
        nodes.sort(byName);
        nodes.forEach((n) => sortRec(n.children));
    };
    sortRec(roots);
    return { roots, byId };
}

/* Walkers that start from an arbitrary node carry visited-guards so that
   corrupt data degrades gracefully instead of hanging the tab. The ones that
   descend from `roots` (the render walkers, `effectivePriorities`) don't need
   one: a parent_id cycle is unreachable from any root, so those nodes are
   never visited. Start a new walk from a non-root and that stops being true. */

function countDescendants(n: CategoryNode): number {
    const seen = new Set<string>([n.id]);
    let total = 0;
    const stack = [...n.children];
    while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur.id)) continue;
        seen.add(cur.id);
        total++;
        stack.push(...cur.children);
    }
    return total;
}

/** id of node + every descendant — used to forbid cyclic reparenting. */
function subtreeIds(n: CategoryNode): Set<string> {
    const out = new Set<string>();
    const stack = [n];
    while (stack.length) {
        const cur = stack.pop()!;
        if (out.has(cur.id)) continue;
        out.add(cur.id);
        stack.push(...cur.children);
    }
    return out;
}

function ancestorIds(id: string, byId: Map<string, CategoryNode>): string[] {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    let cur = byId.get(id);
    // byId.has mirrors buildTree's orphan stance: a parent_id pointing at a
    // missing node means "treat as top-level", never emit a phantom ancestor.
    while (cur && cur.parent_id && !seen.has(cur.parent_id) && byId.has(cur.parent_id)) {
        seen.add(cur.parent_id);
        out.push(cur.parent_id);
        cur = byId.get(cur.parent_id);
    }
    return out;
}

/** Biggest cards first, so masonry columns pack evenly instead of leaving a
    tall tree stranded next to a stack of one-liners. Name breaks ties. */
function byCardSize(a: TreeGroup, b: TreeGroup): number {
    return (
        b.size - a.size ||
        a.rows[0].node.name.localeCompare(b.rows[0].node.name, undefined, {
            sensitivity: "base",
        })
    );
}

/** Nearest ancestor priority walking up from `parentId` (exclusive of self). */
function resolveInherited(
    parentId: string | null,
    byId: Map<string, CategoryNode>
): Priority | null {
    const seen = new Set<string>();
    let cur = parentId ? byId.get(parentId) : null;
    while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.priority) return cur.priority;
        cur = cur.parent_id ? byId.get(cur.parent_id) : null;
    }
    return null;
}

function formatLastUsed(v: Date | string | null): string | null {
    if (!v) return null;
    const d = typeof v === "string" ? new Date(v) : v;
    if (Number.isNaN(d.getTime())) return null;
    // Wall-clock dates in this app are APP_TZ, not the browser's zone.
    return d.toLocaleDateString("en-US", {
        timeZone: APP_TIMEZONE,
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

/* ============================================================
   Page
   ============================================================ */

export default function CategoriesPage() {
    const { space } = useCurrentSpace();
    // Categories are a space-local concept; the virtual "My money" space
    // has no nav entry for them, but the URL is still typeable.
    if (space.isPersonal) return <Navigate to={ROUTES.space(space.id)} replace />;
    return <CategoriesWorkbench />;
}

function CategoriesWorkbench() {
    const { space } = useCurrentSpace();
    const isOwner = useIsOwner();
    const invalidate = useInvalidateAnalytics();

    const categoriesQuery = trpc.expenseCategory.listBySpaceWithUsage.useQuery({
        spaceId: space.id,
    });

    const categories = useMemo(
        () => (categoriesQuery.data ?? []) as CategoryUsage[],
        [categoriesQuery.data]
    );

    const { roots, byId } = useMemo(() => buildTree(categories), [categories]);

    /* ---- selection & create mode ---- */
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
    /* When set, the right-hand panel shows the create form instead of the
       inspector. Cancel returns to whatever was selected. `seq` remounts the
       form on every open — clicking "+" always means "start fresh here",
       even if the previous form's parent field was edited. */
    const [creating, setCreating] = useState<{ parentId: string | null; seq: number } | null>(null);
    const createSeq = useRef(0);
    const panelOpen = !!selected || !!creating;

    /* Unsaved inspector edits must not be silently destroyed: navigation
       that would unmount a dirty inspector is parked in pendingAction and
       confirmed first. (The create form intentionally discards freely.) */
    const [inspectorDirty, setInspectorDirty] = useState(false);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
    const guardDirty = (action: () => void) => {
        // The inspector is only mounted (and thus only dirty-able) when a
        // node is selected and the create form isn't covering it.
        if (inspectorDirty && selected && !creating) setPendingAction(() => action);
        else action();
    };
    const openCreate = (parentId: string | null) =>
        guardDirty(() => setCreating({ parentId, seq: ++createSeq.current }));

    /* Below 1080px the inspector becomes a scrim-backed slide-over — a
       modal. Track that so we can give it dialog semantics + Escape. */
    const [isOverlay, setIsOverlay] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia("(max-width: 1079px)");
        const update = () => setIsOverlay(mq.matches);
        update();
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        if (!panelOpen || !isOverlay) return;
        const onKey = (e: KeyboardEvent) => {
            // Radix layers (popovers, dialogs) preventDefault their own
            // Escape — only dismiss the slide-over when nothing else did.
            if (e.key !== "Escape" || e.defaultPrevented) return;
            if (creating) {
                setCreating(null);
                return;
            }
            if (inspectorDirty && selected) {
                setPendingAction(() => () => setSelectedId(null));
                return;
            }
            setSelectedId(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [panelOpen, isOverlay, creating, inspectorDirty, selected]);
    useEffect(() => {
        // Selected node was deleted (or the space changed) — drop selection.
        if (selectedId && !categoriesQuery.isLoading && !byId.has(selectedId)) {
            setSelectedId(null);
        }
    }, [selectedId, byId, categoriesQuery.isLoading]);

    /* ---- expansion ---- */
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const expandedInitialized = useRef(false);
    useEffect(() => {
        if (expandedInitialized.current || roots.length === 0) return;
        expandedInitialized.current = true;
        // Start with top-level groups open, deeper levels folded — keeps
        // large trees short on first load without hiding the structure.
        setExpanded(new Set(roots.map((r) => r.id)));
    }, [roots]);

    const toggleExpand = (id: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const expandAll = () =>
        setExpanded(
            new Set(categories.filter((c) => byId.get(c.id)!.children.length > 0).map((c) => c.id))
        );
    const collapseAll = () => setExpanded(new Set());

    const selectNode = (id: string) => {
        const apply = () => {
            setSelectedId(id);
            setCreating(null); // picking a node leaves create mode
            // Reveal it — expand every ancestor.
            setExpanded((prev) => {
                const next = new Set(prev);
                ancestorIds(id, byId).forEach((a) => next.add(a));
                return next;
            });
        };
        // Re-clicking the selected node keeps in-progress edits.
        if (id === selectedId && !creating) return;
        guardDirty(apply);
    };

    /* ---- effective priority for every category ----
       Resolved top-down once so the footer counts and the priority filter
       agree with the badge each row renders. */
    const effectivePriorities = useMemo(() => {
        const m = new Map<string, Priority | null>();
        const walk = (nodes: CategoryNode[], inherited: Priority | null) => {
            for (const n of nodes) {
                const eff = n.priority ?? inherited;
                m.set(n.id, eff);
                walk(n.children, eff);
            }
        };
        // Nodes unreachable from roots (a parent_id cycle) never render, so
        // leaving them out of the map — counted as unset — is harmless.
        walk(roots, null);
        return m;
    }, [roots]);

    /* ---- view mode ---- */
    // Remembered across visits: which grouping you work in is a lasting
    // preference, not a per-visit decision.
    const [viewMode, setViewMode] = useState<ViewMode>(() =>
        localStorage.getItem(VIEW_MODE_KEY) === "priority" ? "priority" : "tree"
    );
    const changeViewMode = (m: ViewMode) => {
        setViewMode(m);
        localStorage.setItem(VIEW_MODE_KEY, m);
    };

    /* ---- search + priority filter ---- */
    const [search, setSearch] = useState("");
    const query = search.trim().toLowerCase();
    const [priorityFilter, setPriorityFilter] = useState<PriorityFilter | null>(null);
    const filterActive = !!query || !!priorityFilter;
    /* Rows are force-open (and the chevron inert) whenever the visible set is
       computed rather than chosen: while filtering, and in priority mode. */
    const chevronLocked = filterActive || viewMode === "priority";

    /** `matchIds` = strict hits. `visibleIds` = hits + ancestors, so the
        tree view can still show the path down to a match. */
    const { visibleIds, matchIds, matchCount } = useMemo(() => {
        if (!filterActive) return { visibleIds: null, matchIds: null, matchCount: 0 };
        const visible = new Set<string>();
        const matched = new Set<string>();
        for (const c of categories) {
            if (query && !c.name.toLowerCase().includes(query)) continue;
            if (priorityFilter) {
                const eff = effectivePriorities.get(c.id) ?? "none";
                if (eff !== priorityFilter) continue;
            }
            matched.add(c.id);
            visible.add(c.id);
            ancestorIds(c.id, byId).forEach((a) => visible.add(a));
        }
        return { visibleIds: visible, matchIds: matched, matchCount: matched.size };
    }, [filterActive, query, priorityFilter, categories, byId, effectivePriorities]);

    /* Each chip promises "this many if you click me", so the counts follow the
       text search but ignore the tier filter — otherwise the chip you're on
       would read its own count and the other four would read 0. */
    const priorityCounts = useMemo(() => {
        const counts = { none: 0 } as Record<PriorityFilter, number>;
        for (const p of PRIORITY_KEYS) counts[p] = 0;
        for (const c of categories) {
            if (query && !c.name.toLowerCase().includes(query)) continue;
            counts[effectivePriorities.get(c.id) ?? "none"]++;
        }
        return counts;
    }, [categories, effectivePriorities, query]);

    const clearFilters = () => {
        setSearch("");
        setPriorityFilter(null);
    };

    /** Human description of the active filter, for the empty state. */
    const filterLabel = [
        query ? `“${search.trim()}”` : null,
        priorityFilter
            ? priorityFilter === "none"
                ? "no priority"
                : PRIORITIES[priorityFilter].label
            : null,
    ]
        .filter(Boolean)
        .join(" · ");

    /* ---- flatten to visible rows, grouped into cards ----
       Within a band, each top-level category becomes a masonry card so the
       pane spreads across the full width instead of one long skinny column
       (nesting tops out at 3-4 levels, so cards stay compact).
       Priority mode adds a band per tier, stacked vertically: a category
       only ever appears in its effective tier's band, so every row still
       has exactly one home and no single column runs long. */
    const sections = useMemo(() => {
        const out: TreeSection[] = [];

        if (viewMode === "tree") {
            const walk = (
                acc: VisibleRow[],
                nodes: CategoryNode[],
                depth: number,
                inherited: Priority | null
            ) => {
                for (const n of nodes) {
                    if (visibleIds && !visibleIds.has(n.id)) continue;
                    const effective = n.priority ?? inherited;
                    const row: VisibleRow = {
                        node: n,
                        depth,
                        effectivePriority: effective,
                        priorityInherited: !n.priority && !!inherited,
                        descendants: countDescendants(n),
                        // Must mean "children that are rows here", not "children
                        // in the data" — a filter can strip every child, and a
                        // chevron over nothing claims aria-expanded on an empty
                        // branch. Collapsed-and-unfiltered still counts, so the
                        // chevron survives to reopen the node.
                        hasChildRows: visibleIds
                            ? n.children.some((c) => visibleIds.has(c.id))
                            : n.children.length > 0,
                    };
                    acc.push(row);
                    const open = visibleIds ? true : expanded.has(n.id);
                    const before = acc.length;
                    if (open && n.children.length > 0) {
                        walk(acc, n.children, depth + 1, effective);
                    }
                    // Filtering force-opens rows, so the rows beneath are the
                    // whole truth; unfiltered a collapsed node keeps its
                    // subtree size, which is what makes the chip worth reading.
                    if (visibleIds) row.descendants = acc.length - before;
                }
            };
            const groups: TreeGroup[] = [];
            let count = 0;
            for (const root of roots) {
                const acc: VisibleRow[] = [];
                walk(acc, [root], 0, null);
                if (acc.length > 0) {
                    groups.push({
                        key: root.id,
                        rows: acc,
                        size: countDescendants(root) + 1,
                    });
                    count += acc.length;
                }
            }
            groups.sort(byCardSize);
            if (groups.length > 0) out.push({ key: "all", groups, count });
            return out;
        }

        /* Priority mode. Rows are always force-open: a tier band is already
           a filtered view, and a chevron that hides nothing reads as broken.
           Each depth-0 member starts a new card within the band. */
        const walkTier = (
            groups: TreeGroup[],
            nodes: CategoryNode[],
            tier: PriorityFilter,
            depth: number,
            /** Ancestors skipped since the last row in this card. */
            skipped: string[]
        ) => {
            for (const n of nodes) {
                const eff = effectivePriorities.get(n.id) ?? "none";
                const isMember = eff === tier && (!matchIds || matchIds.has(n.id));
                if (!isMember) {
                    // Belongs to another tier — keep descending at the same
                    // depth, collecting the name so a member further down can
                    // show which parent it actually hangs off.
                    walkTier(groups, n.children, tier, depth, [...skipped, n.name]);
                    continue;
                }
                // NOTE: the row below must be pushed unconditionally right
                // after this — `byCardSize` reads `rows[0]`.
                if (depth === 0) groups.push({ key: n.id, rows: [], size: 0 });
                const acc = groups[groups.length - 1].rows;
                const row: VisibleRow = {
                    node: n,
                    depth,
                    effectivePriority: tier === "none" ? null : tier,
                    priorityInherited: !n.priority,
                    // Counted within the card, not the whole tree — a chip
                    // saying 4 while 2 rows sit under it would just mislead.
                    descendants: 0,
                    hasChildRows: false,
                    pathLabel: skipped.length > 0 ? skipped.join(" › ") : undefined,
                };
                acc.push(row);
                const before = acc.length;
                walkTier(groups, n.children, tier, depth + 1, []);
                row.descendants = acc.length - before;
                row.hasChildRows = row.descendants > 0;
            }
        };
        for (const tier of [...PRIORITY_KEYS, "none" as const]) {
            const groups: TreeGroup[] = [];
            walkTier(groups, roots, tier, 0, []);
            // Band rows don't depend on `expanded`, so row count is a stable
            // sort key here.
            groups.forEach((g) => (g.size = g.rows.length));
            groups.sort(byCardSize);
            const count = groups.reduce((sum, g) => sum + g.rows.length, 0);
            if (count > 0) out.push({ key: `tier-${tier}`, tier, groups, count });
        }
        return out;
    }, [viewMode, roots, expanded, visibleIds, matchIds, effectivePriorities]);

    /* Flat DFS order across all cards — keyboard nav + selection walk. */
    const rows = useMemo(
        () => sections.flatMap((s) => s.groups.flatMap((g) => g.rows)),
        [sections]
    );
    /* Search can filter the selected node out of the DOM — never point
       aria-activedescendant at an id that isn't rendered. */
    const selectedIsRendered = useMemo(
        () => !!selectedId && rows.some((r) => r.node.id === selectedId),
        [rows, selectedId]
    );

    /* ---- drag & drop reparenting ---- */
    const [dragId, setDragId] = useState<string | null>(null);
    const [dropId, setDropId] = useState<string | null>(null); // node id or "__root__"
    const forbiddenDrops = useRef<Set<string>>(new Set());

    const changeParent = trpc.expenseCategory.changeParent.useMutation({
        onSuccess: async (_, vars) => {
            const moved = byId.get(vars.categoryId);
            const target = vars.parentId ? byId.get(vars.parentId) : null;
            toast.success(
                target
                    ? `Moved "${moved?.name ?? "category"}" under "${target.name}"`
                    : `Moved "${moved?.name ?? "category"}" to top level`
            );
            await invalidate(space.id);
        },
        onError: (e) => toast.error(e.message),
    });

    const dragNode = dragId ? byId.get(dragId) : null;

    const handleDragStart = (e: React.DragEvent, node: CategoryNode) => {
        // A drag started against a stale tree (while a move is still
        // committing) could sneak past the descendant check — block it.
        if (!isOwner || changeParent.isPending) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", node.id);
        forbiddenDrops.current = subtreeIds(node);
        setDragId(node.id);
    };

    const canDropOn = (targetId: string) => {
        if (!dragId || !dragNode) return false;
        if (targetId === "__root__") return dragNode.parent_id !== null;
        return !forbiddenDrops.current.has(targetId) && targetId !== dragNode.parent_id;
    };

    /* NOTE: no spring-load (hover-to-expand) here on purpose — expanding
       mid-drag reflows the masonry columns and can move the drop target
       out from under the cursor. Expand before dragging instead. */
    const handleDragOver = (e: React.DragEvent, target: CategoryNode) => {
        if (!canDropOn(target.id)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dropId !== target.id) setDropId(target.id);
    };

    const handleDrop = (e: React.DragEvent, targetId: string | null) => {
        e.preventDefault();
        const id = dragId;
        setDragId(null);
        setDropId(null);
        if (!id || changeParent.isPending) return;
        if (targetId !== null && !canDropOn(targetId)) return;
        if (targetId === null && byId.get(id)?.parent_id === null) return;
        changeParent.mutate({ categoryId: id, parentId: targetId });
    };

    const handleDragEnd = () => {
        setDragId(null);
        setDropId(null);
    };

    /* ---- overlay focus management ---- */
    const inspectorRef = useRef<HTMLElement>(null);
    const overlayOpen = isOverlay && panelOpen;
    /* The scrim covers the viewport but SpaceLayout's sidebar / mobile
       header live outside this page's DOM, so the JSX-level inert on our
       own topbar + tree pane can't reach them — without this, Tab escapes
       the "modal" into nav controls dimmed behind the scrim. */
    useEffect(() => {
        if (!overlayOpen) return;
        const chrome = document.querySelectorAll<HTMLElement>(".sl-aside, .sl-mobile-header");
        chrome.forEach((el) => el.setAttribute("inert", ""));
        return () => chrome.forEach((el) => el.removeAttribute("inert"));
    }, [overlayOpen]);
    /* Focus WRAP for the dialog: with the background inert, the only leak
       left is tabbing off the panel's last control into browser chrome.
       Only intervene while focus is actually inside the panel, so Radix
       portals (selects, pickers) keep their own Tab behavior. */
    useEffect(() => {
        if (!overlayOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;
            const panel = inspectorRef.current;
            if (!panel || !panel.contains(document.activeElement)) return;
            const focusables = Array.from(
                panel.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
                )
            );
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [overlayOpen]);
    const overlayWasOpen = useRef(false);
    useEffect(() => {
        if (overlayOpen) {
            overlayWasOpen.current = true;
            // Move focus into the panel once the slide-in has started —
            // unless something inside already claimed it (the create
            // form's autofocused Name field).
            const t = setTimeout(() => {
                const panel = inspectorRef.current;
                if (!panel || panel.contains(document.activeElement)) return;
                panel.querySelector<HTMLElement>(".ct-insp-close")?.focus();
            }, 50);
            return () => clearTimeout(t);
        }
        if (overlayWasOpen.current) {
            overlayWasOpen.current = false;
            treeRef.current?.focus();
        }
    }, [overlayOpen]);

    /* ---- keyboard navigation ---- */
    const treeRef = useRef<HTMLDivElement>(null);
    const handleTreeKeyDown = (e: React.KeyboardEvent) => {
        if (rows.length === 0) return;
        const idx = rows.findIndex((r) => r.node.id === selectedId);
        const go = (i: number) => {
            const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
            if (row) selectNode(row.node.id);
        };
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                go(idx < 0 ? 0 : idx + 1);
                break;
            case "ArrowUp":
                e.preventDefault();
                go(idx < 0 ? 0 : idx - 1);
                break;
            case "ArrowRight": {
                if (idx < 0) return;
                e.preventDefault();
                const { node: n, hasChildRows } = rows[idx];
                /* Rows are force-open whenever the chevron is locked (filtering
                   or priority mode) — mutating `expanded` there would silently
                   rewrite tree-mode state and make the first keypress a no-op.
                   `hasChildRows`, not `children.length`: in a tier band a node
                   whose children sit in other tiers renders as a leaf. */
                if (!chevronLocked && hasChildRows && !expanded.has(n.id)) {
                    toggleExpand(n.id);
                } else if (hasChildRows) {
                    go(idx + 1);
                }
                break;
            }
            case "ArrowLeft": {
                if (idx < 0) return;
                e.preventDefault();
                const { node: n, hasChildRows } = rows[idx];
                if (!chevronLocked && hasChildRows && expanded.has(n.id)) {
                    toggleExpand(n.id);
                } else if (n.parent_id && rows.some((r) => r.node.id === n.parent_id)) {
                    // Tier bands carry no ancestor context rows, so the parent
                    // is often not on screen; jumping to it would drop the
                    // cursor and send the next ArrowDown back to row 0.
                    selectNode(n.parent_id);
                }
                break;
            }
            case "Home":
                e.preventDefault();
                go(0);
                break;
            case "End":
                e.preventDefault();
                go(rows.length - 1);
                break;
        }
    };

    const totalCount = categories.length;
    const isLoading = categoriesQuery.isLoading;

    return (
        <div className="orbit-design ct-root">
            <style>{CT_STYLES}</style>

            {/* ============ Top bar ============ */}
            {/* inert: while the slide-over is modal, the background must not
                take focus or clicks — aria-modal alone doesn't enforce it. */}
            <header className="ct-topbar" inert={overlayOpen || undefined}>
                <div className="ct-topbar-inner">
                    <div className="ct-topbar-text">
                        <span className="eyebrow">
                            {roots.length} top-level · {totalCount} total
                        </span>
                        <h1 className="display ct-title">Categories</h1>
                    </div>
                    {isOwner && (
                        <button
                            type="button"
                            className="od-btn od-btn-primary"
                            onClick={() => openCreate(null)}
                        >
                            <Plus className="size-3.5" /> New category
                        </button>
                    )}
                </div>
            </header>

            {/* ============ Body: tree + inspector ============ */}
            <div className="ct-body">
                {/* -------- Tree pane -------- */}
                <section
                    className="od-card ct-tree-pane"
                    aria-label="Category tree"
                    inert={overlayOpen || undefined}
                >
                    <div className="ct-tree-toolbar">
                        {/* Grouping toggle sits first and never unmounts, so it
                            keeps one fixed home. Anything to its right may come
                            and go without moving it under the pointer. */}
                        <div className="ct-mode" role="group" aria-label="Group categories by">
                            <button
                                type="button"
                                className={`ct-mode-btn ${viewMode === "tree" ? "is-active" : ""}`}
                                aria-pressed={viewMode === "tree"}
                                onClick={() => changeViewMode("tree")}
                                title="Group by top-level category"
                                /* The label is hidden on narrow screens. */
                                aria-label="Group by top-level category"
                            >
                                <FolderTree className="size-3.5" />
                                <span className="ct-mode-label">Tree</span>
                            </button>
                            <button
                                type="button"
                                className={`ct-mode-btn ${viewMode === "priority" ? "is-active" : ""}`}
                                aria-pressed={viewMode === "priority"}
                                onClick={() => changeViewMode("priority")}
                                title="Group by priority tier"
                                aria-label="Group by priority tier"
                            >
                                <Layers className="size-3.5" />
                                <span className="ct-mode-label">Priority</span>
                            </button>
                        </div>
                        <div className="ct-search">
                            <Search className="size-3.5 ct-search-icon" />
                            <input
                                className="ct-search-input"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Find a category…"
                                aria-label="Search categories"
                            />
                            {search && (
                                <button
                                    type="button"
                                    className="ct-search-clear"
                                    onClick={() => setSearch("")}
                                    aria-label="Clear search"
                                >
                                    <X className="size-3" />
                                </button>
                            )}
                        </div>
                        {/* Priority bands are force-open, so expand / collapse
                            has nothing to act on — kept mounted but disabled so
                            the toolbar geometry doesn't change with the mode. */}
                        <button
                            type="button"
                            className="ct-tool-btn ct-tool-bulk"
                            onClick={expandAll}
                            disabled={viewMode === "priority"}
                            title={
                                viewMode === "priority"
                                    ? "Expand all — tree view only"
                                    : "Expand all"
                            }
                            aria-label="Expand all"
                        >
                            <ChevronsUpDown className="size-3.5" />
                        </button>
                        <button
                            type="button"
                            className="ct-tool-btn ct-tool-bulk"
                            onClick={collapseAll}
                            disabled={viewMode === "priority"}
                            title={
                                viewMode === "priority"
                                    ? "Collapse all — tree view only"
                                    : "Collapse all"
                            }
                            aria-label="Collapse all"
                        >
                            <ChevronsDownUp className="size-3.5" />
                        </button>
                    </div>

                    {filterActive && (
                        /* Stays mounted at 0 so the live region still announces,
                           but visually the body empty state covers that case. */
                        <div
                            className={`ct-search-meta ${matchCount === 0 ? "sr-only" : ""}`}
                            role="status"
                        >
                            {matchCount === 0
                                ? "No matches"
                                : `${matchCount} match${matchCount === 1 ? "" : "es"} · ${filterLabel}`}
                        </div>
                    )}

                    {/* Root drop zone — appears while dragging a nested node */}
                    {dragId && dragNode?.parent_id && (
                        <div
                            className={`ct-rootdrop ${dropId === "__root__" ? "is-over" : ""}`}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                setDropId("__root__");
                            }}
                            onDragLeave={() => setDropId((d) => (d === "__root__" ? null : d))}
                            onDrop={(e) => handleDrop(e, null)}
                        >
                            <CornerDownRight className="size-3.5" />
                            Drop here to make top-level
                        </div>
                    )}

                    <div
                        ref={treeRef}
                        className="ct-tree-scroll"
                        role="tree"
                        aria-label="Categories"
                        aria-activedescendant={
                            selectedIsRendered ? `ct-item-${selectedId}` : undefined
                        }
                        tabIndex={0}
                        onKeyDown={handleTreeKeyDown}
                    >
                        {isLoading ? (
                            <TreeSkeleton />
                        ) : totalCount === 0 ? (
                            <div className="ct-empty">
                                <FolderTree className="size-6" />
                                <p className="ct-empty-title">No categories yet</p>
                                <p className="ct-empty-sub">
                                    Categories label your expenses and nest as deep as you need.
                                </p>
                                {isOwner && (
                                    <button
                                        type="button"
                                        className="od-btn od-btn-sm"
                                        onClick={() => openCreate(null)}
                                    >
                                        <Plus className="size-3" /> Create the first one
                                    </button>
                                )}
                            </div>
                        ) : rows.length === 0 ? (
                            <div className="ct-empty">
                                <Search className="size-5" />
                                <p className="ct-empty-title">
                                    {/* No filter + no rows only happens on corrupt data
                                        (every category inside a parent_id cycle). */}
                                    {filterActive
                                        ? `Nothing matches ${filterLabel}`
                                        : "Nothing to show"}
                                </p>
                                {filterActive && (
                                    <button
                                        type="button"
                                        className="od-btn od-btn-sm"
                                        onClick={clearFilters}
                                    >
                                        Clear filters
                                    </button>
                                )}
                            </div>
                        ) : (
                            sections.map((s) => (
                                <div
                                    key={s.key}
                                    className={`ct-band ${s.tier ? "is-tier" : ""}`}
                                    style={
                                        s.tier && s.tier !== "none"
                                            ? ({
                                                  "--tier": PRIORITIES[s.tier].color,
                                              } as React.CSSProperties)
                                            : undefined
                                    }
                                    role="none"
                                >
                                    {s.tier && (
                                        /* aria-hidden: role="tree" only wants treeitems as
                                           children, and every row already announces its own
                                           tier through the badge. */
                                        <div className="ct-band-head" aria-hidden="true">
                                            <PriorityBadge tier={s.tier} decorative />
                                            <span className="ct-band-name">
                                                {s.tier === "none"
                                                    ? "No priority"
                                                    : PRIORITIES[s.tier].label}
                                            </span>
                                            <span className="ct-count-chip tabular">{s.count}</span>
                                        </div>
                                    )}
                                    <div className="ct-groups">
                                        {s.groups.map((g) => (
                                            <div key={g.key} className="ct-group" role="none">
                                                {g.rows.map((r) => (
                                                    <TreeRow
                                                        key={r.node.id}
                                                        row={r}
                                                        query={query}
                                                        isOwner={isOwner}
                                                        isSelected={r.node.id === selectedId}
                                                        isExpanded={
                                                            chevronLocked
                                                                ? true
                                                                : expanded.has(r.node.id)
                                                        }
                                                        chevronLocked={chevronLocked}
                                                        isDragging={r.node.id === dragId}
                                                        isDropTarget={r.node.id === dropId}
                                                        dropAllowed={canDropOn(r.node.id)}
                                                        onSelect={() => selectNode(r.node.id)}
                                                        onToggle={() => toggleExpand(r.node.id)}
                                                        onAddChild={() => openCreate(r.node.id)}
                                                        onDragStart={(e) =>
                                                            handleDragStart(e, r.node)
                                                        }
                                                        onDragOver={(e) =>
                                                            handleDragOver(e, r.node)
                                                        }
                                                        onDragLeave={() =>
                                                            setDropId((d) =>
                                                                d === r.node.id ? null : d
                                                            )
                                                        }
                                                        onDrop={(e) => handleDrop(e, r.node.id)}
                                                        onDragEnd={handleDragEnd}
                                                    />
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Legend doubles as a tier filter — the counts are the
                        "how many sit in each tier" answer at a glance. */}
                    <footer className="ct-tree-foot">
                        {([...PRIORITY_KEYS, "none"] as PriorityFilter[]).map((p) => {
                            const on = priorityFilter === p;
                            const label = p === "none" ? "No priority" : PRIORITIES[p].label;
                            return (
                                <button
                                    key={p}
                                    type="button"
                                    className={`ct-legend-chip ${on ? "is-active" : ""}`}
                                    aria-pressed={on}
                                    onClick={() => setPriorityFilter(on ? null : p)}
                                    title={
                                        on
                                            ? `Show all tiers again`
                                            : `Show only ${label}${p === "none" ? "" : " categories"}`
                                    }
                                    style={
                                        p !== "none"
                                            ? ({
                                                  "--tier": PRIORITIES[p].color,
                                              } as React.CSSProperties)
                                            : undefined
                                    }
                                >
                                    <PriorityBadge tier={p} decorative />
                                    {label}
                                    <span className="ct-legend-count tabular">
                                        {priorityCounts[p]}
                                    </span>
                                </button>
                            );
                        })}
                        <span className="ct-legend-item ct-legend-muted">dashed = inherited</span>
                        {isOwner && <span className="ct-legend-hint">Drag rows to re-nest</span>}
                    </footer>
                </section>

                {/* -------- Detail panel / slide-over -------- */}
                <div
                    className={`ct-scrim ${panelOpen ? "is-open" : ""}`}
                    onClick={() =>
                        guardDirty(() => {
                            setCreating(null);
                            setSelectedId(null);
                        })
                    }
                    aria-hidden="true"
                />
                <aside
                    ref={inspectorRef}
                    className={`od-card ct-inspector ${panelOpen ? "is-open" : ""}`}
                    role={overlayOpen ? "dialog" : undefined}
                    aria-modal={overlayOpen ? true : undefined}
                    aria-label={creating ? "New category" : "Category details"}
                >
                    {creating ? (
                        <CreatePanel
                            key={`${creating.parentId ?? "__top__"}-${creating.seq}`}
                            parentId={creating.parentId}
                            byId={byId}
                            allCategories={categories}
                            onCancel={() => setCreating(null)}
                            onCreated={(id, parentId) => {
                                setCreating(null);
                                // Query cache was refreshed before this fires,
                                // so the node exists in byId — select + reveal.
                                setSelectedId(id);
                                if (parentId) {
                                    setExpanded((prev) => {
                                        const next = new Set(prev);
                                        next.add(parentId);
                                        ancestorIds(parentId, byId).forEach((a) => next.add(a));
                                        return next;
                                    });
                                }
                            }}
                        />
                    ) : selected ? (
                        <Inspector
                            key={selected.id}
                            node={selected}
                            byId={byId}
                            allCategories={categories}
                            isOwner={isOwner}
                            onSelect={selectNode}
                            onAddChild={() => openCreate(selected.id)}
                            onClose={() => guardDirty(() => setSelectedId(null))}
                            onDirtyChange={setInspectorDirty}
                        />
                    ) : (
                        <div className="ct-empty ct-inspector-empty">
                            <Folder className="size-6" />
                            <p className="ct-empty-title">Select a category</p>
                            <p className="ct-empty-sub">
                                {isOwner
                                    ? "Pick one to rename it, restyle it, change its priority or parent — or create a new one."
                                    : "Pick one from the tree to see its priority, parent, and usage."}
                            </p>
                            {isOwner && (
                                <button
                                    type="button"
                                    className="od-btn od-btn-sm"
                                    onClick={() => openCreate(null)}
                                >
                                    <Plus className="size-3" /> New category
                                </button>
                            )}
                            <div className="ct-tips">
                                <span className="eyebrow">Tips</span>
                                {isOwner && (
                                    <span className="ct-tip">
                                        <GripVertical className="size-3" />
                                        Drag any row onto another to nest it
                                    </span>
                                )}
                                {isOwner && (
                                    <span className="ct-tip">
                                        <Plus className="size-3" />
                                        Hover a row and hit “+” for a quick subcategory
                                    </span>
                                )}
                                <span className="ct-tip">
                                    <ChevronsUpDown className="size-3" />
                                    Arrow keys walk the tree once it has focus
                                </span>
                                <span className="ct-tip">
                                    <Search className="size-3" />
                                    Search shows matches with their full path
                                </span>
                            </div>
                        </div>
                    )}
                </aside>
            </div>

            {/* Discard-confirmation for unsaved inspector edits */}
            <ConfirmDialog
                open={pendingAction !== null}
                onOpenChange={(v) => {
                    if (!v) setPendingAction(null);
                }}
                title="Discard unsaved changes?"
                description={
                    selected
                        ? `You have unsaved edits on “${selected.name}”. They'll be lost.`
                        : "You have unsaved edits. They'll be lost."
                }
                confirmLabel="Discard"
                destructive
                onConfirm={() => {
                    setInspectorDirty(false);
                    const act = pendingAction;
                    setPendingAction(null);
                    act?.();
                }}
            />
        </div>
    );
}

/* ============================================================
   Priority badge — the letter carries the meaning so the tier is
   never signalled by colour alone.
   ============================================================ */

function PriorityBadge({
    tier,
    inherited = false,
    decorative = false,
}: {
    tier: PriorityFilter;
    inherited?: boolean;
    /** Inside a chip/header that already names the tier in text. */
    decorative?: boolean;
}) {
    const unset = tier === "none";
    const label = unset ? "No priority" : PRIORITIES[tier].label;
    return (
        <span
            className={`ct-pri-badge ${inherited ? "is-inherited" : ""} ${unset ? "is-unset" : ""}`}
            style={
                unset ? undefined : ({ "--tier": PRIORITIES[tier].color } as React.CSSProperties)
            }
            role={decorative ? undefined : "img"}
            aria-hidden={decorative || undefined}
            aria-label={decorative ? undefined : `${label}${inherited ? ", inherited" : ""}`}
            title={
                decorative ? undefined : `${label}${inherited ? " · inherited from parent" : ""}`
            }
        >
            {unset ? "–" : PRIORITIES[tier].letter}
        </span>
    );
}

/* ============================================================
   Tree row
   ============================================================ */

function TreeRow({
    row,
    query,
    isOwner,
    isSelected,
    isExpanded,
    chevronLocked,
    isDragging,
    isDropTarget,
    dropAllowed,
    onSelect,
    onToggle,
    onAddChild,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
}: {
    row: VisibleRow;
    query: string;
    isOwner: boolean;
    isSelected: boolean;
    isExpanded: boolean;
    chevronLocked: boolean;
    isDragging: boolean;
    isDropTarget: boolean;
    dropAllowed: boolean;
    onSelect: () => void;
    onToggle: () => void;
    onAddChild: () => void;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
}) {
    const { node, depth, effectivePriority, priorityInherited, descendants, hasChildRows } = row;
    const hasKids = hasChildRows;
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isSelected) ref.current?.scrollIntoView({ block: "nearest" });
    }, [isSelected]);

    return (
        <div
            ref={ref}
            id={`ct-item-${node.id}`}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={isSelected}
            aria-expanded={hasKids ? isExpanded : undefined}
            tabIndex={-1}
            className={[
                "ct-row",
                depth === 0 ? "is-root" : "",
                isSelected ? "is-selected" : "",
                isDragging ? "is-dragging" : "",
                isDropTarget && dropAllowed ? "is-drop" : "",
            ].join(" ")}
            draggable={isOwner}
            onClick={onSelect}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
        >
            {/* indent guides */}
            {Array.from({ length: depth }).map((_, i) => (
                <span key={i} className="ct-guide" />
            ))}

            {hasKids ? (
                <button
                    type="button"
                    className="ct-chevron"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggle();
                    }}
                    disabled={chevronLocked}
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                    {isExpanded ? (
                        <ChevronDown className="size-3.5" />
                    ) : (
                        <ChevronRight className="size-3.5" />
                    )}
                </button>
            ) : (
                <span className="ct-chevron ct-chevron-leaf" aria-hidden="true">
                    <span className="ct-leaf-dot" style={{ background: node.color }} />
                </span>
            )}

            <EntityAvatar size="sm" color={node.color} icon={node.icon} />

            {/* Flex, not one nowrap run: the ellipsis always eats the tail, so
                a single run would truncate the category name and leave the
                breadcrumb intact. The path absorbs the shrink instead. */}
            <span
                className="ct-row-name"
                title={row.pathLabel ? `${row.pathLabel} › ${node.name}` : node.name}
            >
                {row.pathLabel && (
                    <>
                        <span className="ct-row-path">{row.pathLabel}</span>
                        <span className="ct-row-sep" aria-hidden="true">
                            ›
                        </span>
                    </>
                )}
                <span className="ct-row-leaf">
                    <Highlight text={node.name} query={query} />
                </span>
            </span>

            {hasKids && (
                <span
                    className="ct-count-chip tabular"
                    title={`${descendants} nested categor${descendants === 1 ? "y" : "ies"}`}
                >
                    {descendants}
                </span>
            )}

            {/* Solid badge = tier set on this category, dashed = inherited.
                Kept inside tier cards too: the header names the tier, only
                the badge says whether this row is where it was set. */}
            {effectivePriority && (
                <PriorityBadge tier={effectivePriority} inherited={priorityInherited} />
            )}

            <span className="ct-row-spacer" />

            {isOwner && (
                <span className="ct-row-actions">
                    <button
                        type="button"
                        className="ct-row-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onAddChild();
                        }}
                        title={`Add subcategory to ${node.name}`}
                        aria-label={`Add subcategory to ${node.name}`}
                    >
                        <Plus className="size-3.5" />
                    </button>
                    <span className="ct-row-grip" aria-hidden="true">
                        <GripVertical className="size-3.5" />
                    </span>
                </span>
            )}
        </div>
    );
}

function Highlight({ text, query }: { text: string; query: string }) {
    if (!query) return <>{text}</>;
    const idx = text.toLowerCase().indexOf(query);
    if (idx < 0) return <>{text}</>;
    return (
        <>
            {text.slice(0, idx)}
            <mark className="ct-mark">{text.slice(idx, idx + query.length)}</mark>
            {text.slice(idx + query.length)}
        </>
    );
}

function TreeSkeleton() {
    // Mirrors the loaded masonry footprint so the layout doesn't pop from
    // one skinny column to a grid when data arrives.
    const cards = [
        [0, 1, 1, 2],
        [0, 1],
        [0, 1, 1, 1, 2],
        [0, 1, 1],
    ];
    return (
        <div className="ct-groups ct-skeleton" aria-hidden="true">
            {cards.map((depths, c) => (
                <div key={c} className="ct-group">
                    {depths.map((d, i) => (
                        <div key={i} className="ct-skel-row" style={{ marginLeft: d * 22 }}>
                            <span className="ct-skel-dot" />
                            <span
                                className="ct-skel-bar"
                                style={{ width: `${46 + (((c * 7 + i) * 17) % 38)}%` }}
                            />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

/* ============================================================
   Inspector — edit-in-place details for the selected category
   ============================================================ */

function Inspector({
    node,
    byId,
    allCategories,
    isOwner,
    onSelect,
    onAddChild,
    onClose,
    onDirtyChange,
}: {
    node: CategoryNode;
    byId: Map<string, CategoryNode>;
    allCategories: CategoryUsage[];
    isOwner: boolean;
    onSelect: (id: string) => void;
    onAddChild: () => void;
    onClose: () => void;
    onDirtyChange: (dirty: boolean) => void;
}) {
    const { space } = useCurrentSpace();
    const invalidate = useInvalidateAnalytics();

    const [name, setName] = useState(node.name);
    const [color, setColor] = useState(node.color);
    const [icon, setIcon] = useState(node.icon);
    const [priority, setPriority] = useState<Priority | "">(node.priority ?? "");
    const [parentId, setParentId] = useState<string | null>(node.parent_id);
    const [deleteOpen, setDeleteOpen] = useState(false);

    const dirty =
        name.trim() !== node.name ||
        color !== node.color ||
        icon !== node.icon ||
        (priority || null) !== node.priority ||
        parentId !== node.parent_id;

    // The page guards navigation that would silently destroy unsaved edits;
    // report dirtiness up (and clear the flag on unmount).
    useEffect(() => {
        onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

    // External changes (e.g. drag-drop moved this node) land while the form
    // is pristine — follow them. Never clobber in-progress edits.
    const dirtyRef = useRef(dirty);
    dirtyRef.current = dirty;
    useEffect(() => {
        if (dirtyRef.current) return;
        setName(node.name);
        setColor(node.color);
        setIcon(node.icon);
        setPriority(node.priority ?? "");
        setParentId(node.parent_id);
    }, [node]);
    // Parent is drag-owned: dragging this very node in the tree changes
    // node.parent_id underneath us and would otherwise read as a "dirty"
    // form edit (whose Save would revert the move). External parent moves
    // always win over an unsaved parent-field edit.
    const lastNodeParent = useRef(node.parent_id);
    useEffect(() => {
        if (node.parent_id !== lastNodeParent.current) {
            lastNodeParent.current = node.parent_id;
            setParentId(node.parent_id);
        }
    }, [node.parent_id]);

    const update = trpc.expenseCategory.update.useMutation();
    const changeParent = trpc.expenseCategory.changeParent.useMutation();
    const del = trpc.expenseCategory.delete.useMutation({
        onSuccess: async () => {
            toast.success("Category deleted");
            await invalidate(space.id);
        },
        onError: (e) => toast.error(e.message),
    });

    const saving = update.isPending || changeParent.isPending;

    const save = async () => {
        if (!name.trim() || saving) return;
        try {
            const fieldPatch: Record<string, unknown> = {};
            if (name.trim() !== node.name) fieldPatch.name = name.trim();
            if (color !== node.color) fieldPatch.color = color;
            if (icon !== node.icon) fieldPatch.icon = icon;
            if ((priority || null) !== node.priority)
                fieldPatch.priority = priority === "" ? null : priority;

            if (Object.keys(fieldPatch).length > 0) {
                await update.mutateAsync({ categoryId: node.id, ...fieldPatch });
            }
            if (parentId !== node.parent_id) {
                await changeParent.mutateAsync({ categoryId: node.id, parentId });
            }
            toast.success("Category saved");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
        } finally {
            // The field update may have committed even if the parent change
            // failed — always refresh so the tree never shows stale data.
            await invalidate(space.id);
        }
    };

    const discard = () => {
        setName(node.name);
        setColor(node.color);
        setIcon(node.icon);
        setPriority(node.priority ?? "");
        setParentId(node.parent_id);
    };

    /* parent candidates: everything outside this node's subtree */
    const forbidden = useMemo(() => subtreeIds(node), [node]);
    const parentCandidates = useMemo(
        () => allCategories.filter((c) => !forbidden.has(c.id)),
        [allCategories, forbidden]
    );

    const breadcrumb = useMemo(
        () =>
            ancestorIds(node.id, byId)
                .reverse()
                .map((id) => byId.get(id)!),
        [node.id, byId]
    );

    /* Follows the *draft* parent, so re-parenting updates the inheritance
       hint before you save. */
    const inheritedPriority = useMemo(() => resolveInherited(parentId, byId), [parentId, byId]);
    /* Saved state, for what this node's children actually inherit today. */
    const childInherits = node.priority ?? resolveInherited(node.parent_id, byId);

    const lastUsed = formatLastUsed(node.last_used);
    const hasKids = node.children.length > 0;

    return (
        <div className="ct-insp">
            <OrbitFormStyles />

            {/* Header */}
            <div className="ct-insp-head">
                <EntityAvatar size="lg" color={color} icon={icon} />
                <div className="ct-insp-head-text">
                    {breadcrumb.length > 0 && (
                        <span className="ct-insp-crumbs">
                            {breadcrumb.map((a) => (
                                <button
                                    key={a.id}
                                    type="button"
                                    className="ct-insp-crumb"
                                    onClick={() => onSelect(a.id)}
                                >
                                    {a.name}
                                    <ChevronRight className="size-2.5" />
                                </button>
                            ))}
                        </span>
                    )}
                    <span className="ct-insp-name">{name.trim() || node.name}</span>
                    <span className="ct-insp-usage tabular">
                        {node.tx_count > 0
                            ? `${node.tx_count.toLocaleString("en-US")} transaction${node.tx_count === 1 ? "" : "s"}${lastUsed ? ` · last used ${lastUsed}` : ""}`
                            : "Never used"}
                    </span>
                </div>
                <button
                    type="button"
                    className="ct-tool-btn ct-insp-close"
                    onClick={onClose}
                    aria-label="Close details"
                >
                    <X className="size-3.5" />
                </button>
            </div>

            {!isOwner ? (
                /* Read-only view for editors/viewers */
                <div className="ct-insp-body">
                    <ReadOnlyRow label="Priority">
                        {node.priority ? (
                            <PriorityChipStatic priority={node.priority} />
                        ) : inheritedPriority ? (
                            <PriorityChipStatic priority={inheritedPriority} inherited />
                        ) : (
                            <span className="ct-dim">None</span>
                        )}
                    </ReadOnlyRow>
                    <ReadOnlyRow label="Parent">
                        {node.parent_id ? (
                            (byId.get(node.parent_id)?.name ?? "—")
                        ) : (
                            <span className="ct-dim">Top level</span>
                        )}
                    </ReadOnlyRow>
                    <ChildrenSection node={node} inherits={childInherits} onSelect={onSelect} />
                </div>
            ) : (
                <>
                    <div className="ct-insp-body">
                        <OrbitField label="Name" required>
                            <OrbitInput
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                maxLength={255}
                                required
                                placeholder="Category name"
                            />
                        </OrbitField>

                        {/* noWrapperLabel renders a div, not a label — a <label> around a
    button group forwards label-text clicks to the first button. */}
                        <OrbitField label="Style" noWrapperLabel>
                            <div className="ct-insp-style-row">
                                <ColorPickerButton value={color} onChange={setColor} />
                                <IconPickerButton value={icon} onChange={setIcon} color={color} />
                            </div>
                        </OrbitField>

                        <OrbitField
                            label="Priority"
                            noWrapperLabel
                            hint="Descendants inherit unless they override"
                        >
                            <PrioritySelect
                                value={priority}
                                onChange={setPriority}
                                inherited={inheritedPriority}
                            />
                        </OrbitField>

                        <OrbitField
                            label="Parent"
                            hint="You can also drag rows in the tree to re-nest"
                            noWrapperLabel
                        >
                            <CategoryTreeSelect
                                categories={parentCandidates}
                                value={parentId}
                                onChange={(v) => setParentId(v)}
                                placeholder="(top level — no parent)"
                                allowAll
                            />
                        </OrbitField>

                        <ChildrenSection
                            node={node}
                            inherits={childInherits}
                            onSelect={onSelect}
                            onAddChild={onAddChild}
                        />

                        {/* Danger zone */}
                        <div className="ct-danger">
                            <div className="ct-danger-text">
                                <span className="ct-danger-title">Delete category</span>
                                <span className="ct-danger-sub">
                                    {hasKids
                                        ? `Move or delete its ${node.children.length} subcategor${node.children.length === 1 ? "y" : "ies"} first.`
                                        : node.tx_count > 0
                                          ? `Blocked — ${node.tx_count.toLocaleString("en-US")} transaction${node.tx_count === 1 ? "" : "s"} reference it. Rename or re-nest it instead.`
                                          : "Never used — safe to delete."}
                                </span>
                            </div>
                            <button
                                type="button"
                                className="ct-danger-btn"
                                disabled={hasKids || node.tx_count > 0 || del.isPending}
                                onClick={() => setDeleteOpen(true)}
                            >
                                <Trash2 className="size-3.5" />
                                Delete
                            </button>
                        </div>
                    </div>

                    {/* Sticky save bar */}
                    {dirty && (
                        <div className="ct-savebar">
                            <span className="ct-savebar-label">Unsaved changes</span>
                            <button
                                type="button"
                                className="od-btn od-btn-sm"
                                onClick={discard}
                                disabled={saving}
                            >
                                Discard
                            </button>
                            <button
                                type="button"
                                className="od-btn od-btn-sm od-btn-primary"
                                onClick={save}
                                disabled={!name.trim() || saving}
                            >
                                {saving ? "Saving…" : "Save"}
                            </button>
                        </div>
                    )}

                    <ConfirmDialog
                        open={deleteOpen}
                        onOpenChange={setDeleteOpen}
                        title={`Delete "${node.name}"?`}
                        description="This category has never been used. This can't be undone."
                        confirmLabel="Delete"
                        destructive
                        onConfirm={() => del.mutate({ categoryId: node.id })}
                    />
                </>
            )}
        </div>
    );
}

function ReadOnlyRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="ct-ro-row">
            <span className="ct-ro-label">{label}</span>
            <span className="ct-ro-value">{children}</span>
        </div>
    );
}

function PriorityChipStatic({
    priority,
    inherited = false,
}: {
    priority: Priority;
    inherited?: boolean;
}) {
    const m = PRIORITIES[priority];
    return (
        <span
            className="ct-pri-chip"
            style={{
                color: m.color,
                borderColor: `color-mix(in oklab, ${m.color} ${inherited ? 18 : 32}%, transparent)`,
                background: `color-mix(in oklab, ${m.color} ${inherited ? 6 : 10}%, transparent)`,
                opacity: inherited ? 0.8 : 1,
            }}
        >
            <PriorityBadge tier={priority} inherited={inherited} decorative />
            {m.label}
            {inherited && <span className="ct-dim"> · inherited</span>}
        </span>
    );
}

/* ============================================================
   Priority picker — real radios, so arrow keys, labels and screen
   readers all come for free.
   ============================================================ */

function PrioritySelect({
    value,
    onChange,
    inherited,
}: {
    value: Priority | "";
    onChange: (v: Priority | "") => void;
    inherited: Priority | null;
}) {
    // Radios only group by name, so each mounted picker needs its own.
    const groupName = useId();
    return (
        /* Native radios sharing a name are exposed as a set with no name of
           their own — OrbitField's noWrapperLabel renders a div, not a label,
           so the group needs its own. */
        <div className="ct-pri-select" role="radiogroup" aria-label="Priority">
            {(["", ...PRIORITY_KEYS] as (Priority | "")[]).map((key) => {
                const meta = key === "" ? null : PRIORITIES[key];
                const active = value === key;
                return (
                    <label
                        key={key || "none"}
                        className={`ct-pri-opt ${active ? "is-active" : ""}`}
                        style={meta ? ({ "--tier": meta.color } as React.CSSProperties) : undefined}
                    >
                        <input
                            className="ct-pri-radio"
                            type="radio"
                            name={groupName}
                            checked={active}
                            onChange={() => onChange(key)}
                        />
                        <PriorityBadge tier={key === "" ? "none" : key} decorative />
                        <span className="ct-pri-opt-label">{meta ? meta.label : "None"}</span>
                        {/* Only the None row carries a second line, and only to
                            spell out what "unset" resolves to here. */}
                        {!meta && inherited && (
                            <span className="ct-pri-opt-desc">
                                inherits {PRIORITIES[inherited].label}
                            </span>
                        )}
                        <Check className="size-3.5 ct-pri-check" aria-hidden="true" />
                    </label>
                );
            })}
        </div>
    );
}

function ChildrenSection({
    node,
    inherits,
    onSelect,
    onAddChild,
}: {
    node: CategoryNode;
    /** Effective priority a child gets when it sets none of its own. */
    inherits: Priority | null;
    onSelect: (id: string) => void;
    onAddChild?: () => void;
}) {
    return (
        <div className="ct-children">
            <div className="ct-children-head">
                <span className="eyebrow">
                    Subcategories{node.children.length > 0 ? ` · ${node.children.length}` : ""}
                </span>
                {onAddChild && (
                    <button type="button" className="ct-children-add" onClick={onAddChild}>
                        <Plus className="size-3" /> Add
                    </button>
                )}
            </div>
            {node.children.length === 0 ? (
                <p className="ct-children-empty">None — this is a leaf category.</p>
            ) : (
                <div className="ct-children-list">
                    {node.children.map((c) => {
                        const eff = c.priority ?? inherits;
                        return (
                            <button
                                key={c.id}
                                type="button"
                                className="ct-child-row"
                                onClick={() => onSelect(c.id)}
                            >
                                <EntityAvatar size="sm" color={c.color} icon={c.icon} />
                                <span className="ct-child-name">{c.name}</span>
                                {c.children.length > 0 && (
                                    <span className="ct-count-chip tabular">
                                        {countDescendants(c)}
                                    </span>
                                )}
                                {eff && <PriorityBadge tier={eff} inherited={!c.priority} />}
                                <ChevronRight className="size-3 ct-child-arrow" />
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ============================================================
   Create panel — lives in the same right-hand pane as the inspector
   ============================================================ */

function CreatePanel({
    parentId: initialParentId,
    byId,
    allCategories,
    onCancel,
    onCreated,
}: {
    parentId: string | null;
    byId: Map<string, CategoryNode>;
    allCategories: CategoryUsage[];
    onCancel: () => void;
    onCreated: (id: string, parentId: string | null) => void;
}) {
    const { space } = useCurrentSpace();
    const [name, setName] = useState("");
    const [parentId, setParentId] = useState<string | null>(initialParentId);
    const [color, setColor] = useState<string>(DEFAULT_COLOR);
    const [icon, setIcon] = useState("folder");
    const [priority, setPriority] = useState<Priority | "">("");
    const invalidate = useInvalidateAnalytics();
    const idem = useIdempotencyKey();

    const create = trpc.expenseCategory.create.useMutation({
        onSuccess: async (created) => {
            toast.success("Category created");
            idem.rotate();
            await invalidate(space.id);
            if (created?.id) onCreated(created.id, created.parent_id ?? null);
        },
        onError: (e) => toast.error(e.message),
    });

    const parentCategory = parentId ? (byId.get(parentId) ?? null) : null;

    const breadcrumb = useMemo(() => {
        if (!parentId) return [];
        const chain = ancestorIds(parentId, byId)
            .reverse()
            .map((id) => byId.get(id)!);
        const parent = byId.get(parentId);
        return parent ? [...chain, parent] : chain;
    }, [parentId, byId]);

    const inheritedPriority = useMemo(() => resolveInherited(parentId, byId), [parentId, byId]);

    const submit = () => {
        if (create.isPending || !name.trim()) return;
        create.mutate({
            spaceId: space.id,
            name: name.trim(),
            parentId: parentId ?? undefined,
            color,
            icon,
            priority: priority === "" ? undefined : priority,
            idempotencyKey: idem.key,
        });
    };

    return (
        <div className="ct-insp">
            <OrbitFormStyles />

            {/* Header — live preview of the category being built */}
            <div className="ct-insp-head">
                <EntityAvatar size="lg" color={color} icon={icon} />
                <div className="ct-insp-head-text">
                    {breadcrumb.length > 0 && (
                        <span className="ct-insp-crumbs" aria-label="Will be nested under">
                            {breadcrumb.map((a) => (
                                <span key={a.id} className="ct-insp-crumb as-static">
                                    {a.name}
                                    <ChevronRight className="size-2.5" />
                                </span>
                            ))}
                        </span>
                    )}
                    <span className="ct-insp-name">{name.trim() || "New category"}</span>
                    <span className="ct-insp-usage">
                        {parentCategory
                            ? `Subcategory of ${parentCategory.name}`
                            : "Top-level category"}
                    </span>
                </div>
                <button
                    type="button"
                    className="ct-tool-btn ct-insp-close"
                    onClick={onCancel}
                    aria-label="Cancel and close"
                >
                    <X className="size-3.5" />
                </button>
            </div>

            <div className="ct-insp-body">
                <OrbitField label="Name" required>
                    <OrbitInput
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Groceries, Restaurants…"
                        required
                        maxLength={255}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === "Enter") submit();
                        }}
                    />
                </OrbitField>

                {/* Field order mirrors the edit inspector (Name / Style /
                    Priority / Parent) so muscle memory transfers. */}
                <OrbitField label="Style" noWrapperLabel>
                    <div className="ct-insp-style-row">
                        <ColorPickerButton value={color} onChange={setColor} />
                        <IconPickerButton value={icon} onChange={setIcon} color={color} />
                    </div>
                </OrbitField>

                <OrbitField label="Priority" noWrapperLabel hint="Optional">
                    <PrioritySelect
                        value={priority}
                        onChange={setPriority}
                        inherited={inheritedPriority}
                    />
                </OrbitField>

                <OrbitField label="Parent" hint="Optional" noWrapperLabel>
                    <CategoryTreeSelect
                        categories={allCategories}
                        value={parentId}
                        onChange={(v) => setParentId(v)}
                        placeholder="(none — top level)"
                        allowAll
                    />
                </OrbitField>
            </div>

            {/* Footer — always visible while creating */}
            <div className="ct-savebar">
                <span className="ct-savebar-label">New category</span>
                <button
                    type="button"
                    className="od-btn od-btn-sm"
                    onClick={onCancel}
                    disabled={create.isPending}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    className="od-btn od-btn-sm od-btn-primary"
                    disabled={!name.trim() || create.isPending}
                    onClick={submit}
                >
                    <Plus className="size-3" />
                    {create.isPending ? "Creating…" : "Create"}
                </button>
            </div>
        </div>
    );
}

/* ============================================================
   Styles
   ============================================================ */

const CT_STYLES = `
.ct-root {
    margin: -1.5rem -1rem;
    height: calc(100dvh - 53px); /* mobile header above */
    display: flex;
    flex-direction: column;
    background: var(--bg);
    overflow: hidden;
}
@media (min-width: 768px) {
    .ct-root { margin: -2rem; height: 100dvh; }
}

/* ---------- top bar ---------- */
.ct-topbar {
    flex-shrink: 0;
    padding: 18px 24px 14px;
    border-bottom: 1px solid var(--line-soft);
}
.ct-topbar-inner {
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
}
.ct-topbar-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ct-topbar .od-btn { white-space: nowrap; flex-shrink: 0; }
.ct-title {
    font-size: 24px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--fg);
    margin: 0;
}
@media (max-width: 640px) {
    .ct-topbar { padding: 12px 14px 10px; }
    .ct-title { font-size: 20px; }
}

/* ---------- body ---------- */
.ct-body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 14px;
    padding: 14px 24px 18px;
    width: 100%;
}
@media (max-width: 640px) {
    .ct-body { padding: 10px 12px 12px; }
}

/* ---------- tree pane ---------- */
.orbit-design .od-card.ct-tree-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
}

.ct-tree-toolbar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line-soft);
    background: var(--bg-elev-2);
}
.ct-search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px;
    border-radius: 9px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    transition: border-color 120ms, box-shadow 120ms;
}
.ct-search:focus-within {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-soft);
}
.ct-search-icon { color: var(--fg-4); flex-shrink: 0; }
.ct-search-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 0;
    outline: none;
    color: var(--fg);
    font-size: 13px;
    font-family: inherit;
}
.ct-search-input::placeholder { color: var(--fg-3); }
/* 16px on small screens — anything smaller makes iOS Safari zoom on focus. */
@media (max-width: 640px) {
    .ct-search { height: 40px; }
    .ct-search-input { font-size: 16px; }
}
.ct-search-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 0;
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
    flex-shrink: 0;
}
.ct-search-clear:hover { background: var(--bg-elev-3); color: var(--fg); }

.ct-tool-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: var(--bg-elev-1);
    color: var(--fg-3);
    cursor: pointer;
    flex-shrink: 0;
    transition: all 140ms ease;
}
.ct-tool-btn:hover:not(:disabled) { background: var(--bg-elev-2); color: var(--fg); border-color: var(--line-strong); }
.ct-tool-btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.ct-tool-btn:disabled { opacity: 0.4; cursor: default; }

/* ---------- grouping toggle (tree / priority) ---------- */
.ct-mode {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 34px;
    padding: 2px;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: var(--bg-elev-1);
}
.ct-mode-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 100%;
    padding: 0 9px;
    border-radius: 7px;
    border: 0;
    background: transparent;
    color: var(--fg-3);
    font-size: 11.5px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: background 140ms ease, color 140ms ease;
}
.ct-mode-btn:hover { color: var(--fg-2); }
/* elev-3 on the elev-1 track is only 1.16:1, and --shadow-1 is a dark shadow
   on a dark surface — the ring is what actually marks the active mode. */
.ct-mode-btn.is-active {
    background: var(--bg-elev-3);
    color: var(--fg);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--brand) 55%, transparent);
}
.ct-mode-btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
/* Icon-only below ~520px: the search field needs the width more than the
   labels do, and each button keeps its title + aria-pressed. */
@media (max-width: 520px) {
    .ct-mode-label { display: none; }
    .ct-mode-btn { padding: 0 10px; }
    /* Every row's chevron does this one node at a time; the search field
       needs the width more than the bulk buttons do. */
    .ct-tool-bulk { display: none; }
}
@media (hover: none) {
    .ct-mode { height: 44px; }
    .ct-mode-btn { min-width: 44px; justify-content: center; }
}

.ct-search-meta {
    flex-shrink: 0;
    padding: 6px 14px;
    font-size: 11px;
    color: var(--fg-3);
    border-bottom: 1px solid var(--line-soft);
    background: var(--bg-elev-1);
}

.ct-rootdrop {
    flex-shrink: 0;
    margin: 8px 10px 0;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1.5px dashed var(--line-strong);
    color: var(--fg-3);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 140ms ease;
}
.ct-rootdrop.is-over {
    border-color: var(--brand);
    background: var(--brand-soft);
    color: var(--fg);
}

.ct-tree-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    padding: 12px 12px 16px;
}
.ct-tree-scroll:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; border-radius: 8px; }

/* ---------- masonry group grid ----------
   Top-level categories flow into as many ~330px columns as fit, so wide
   screens show the whole taxonomy side-by-side instead of one long list. */
.ct-groups {
    /* "At most 3 columns, each at least 260px": 260px flips to 2 columns
       on ordinary 1280-1440 laptops (a lone full-width column strands the
       row actions far from the name), while the 3 cap keeps rows from
       getting confetti-narrow on big monitors. */
    columns: 3 260px;
    column-gap: 12px;
}
.ct-group {
    break-inside: avoid;
    -webkit-column-break-inside: avoid;
    display: flow-root;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: color-mix(in oklab, var(--bg-elev-2) 70%, transparent);
    padding: 5px;
    margin-bottom: 12px;
}

/* ---------- priority grouping ----------
   Tiers stack as full-width bands, each running the same masonry inside,
   so cards stay short and wide instead of forming four tall columns. */
.ct-band + .ct-band { margin-top: 4px; }
.ct-band.is-tier {
    padding-top: 2px;
}
.ct-band-head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 8px;
    padding: 7px 10px;
    border-radius: 9px;
    border: 1px solid color-mix(in oklab, var(--tier, var(--fg-4)) 22%, var(--line));
    border-left: 3px solid color-mix(in oklab, var(--tier, var(--fg-4)) 65%, transparent);
    background: color-mix(in oklab, var(--tier, var(--fg-4)) 8%, var(--bg-elev-2));
}
.ct-band-name {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--fg);
}

/* Lifted subtree: its parent sits in another tier, so the path comes along. */
.ct-row.is-root {
    font-weight: 500;
    color: var(--fg);
    font-size: 13.5px;
}

/* ---------- rows ---------- */
.ct-row {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 38px;
    padding: 3px 8px 3px 4px;
    border-radius: 9px;
    cursor: pointer;
    color: var(--fg-2);
    font-size: 13px;
    border: 1px solid transparent;
    user-select: none;
    -webkit-user-select: none;
}
.ct-row:hover { background: var(--bg-elev-3); color: var(--fg); }
.ct-row.is-selected {
    background: var(--brand-soft);
    border-color: color-mix(in oklab, var(--brand) 35%, transparent);
    color: var(--fg);
}
.ct-row.is-dragging { opacity: 0.4; }
.ct-row.is-drop {
    background: var(--brand-soft);
    border-color: var(--brand);
    box-shadow: 0 0 0 1px var(--brand) inset;
}
.ct-row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }

.ct-guide {
    align-self: stretch;
    flex-shrink: 0;
    width: 14px;
    margin-left: 8px;
    border-left: 1px solid var(--line-soft);
    pointer-events: none;
}
/* Narrow screens: tighter indent so deep nests keep a readable name. */
@media (max-width: 640px) {
    .ct-guide { width: 9px; margin-left: 4px; }
}

.ct-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 0;
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
    flex-shrink: 0;
}
/* Stronger than the row's elev-3 hover so the chevron still reads as its
   own click target inside an already-hovered row. */
.ct-chevron:hover:not(:disabled):not(.ct-chevron-leaf) {
    background: color-mix(in oklab, var(--fg-3) 28%, transparent);
    color: var(--fg);
}
.ct-chevron:disabled { opacity: 0.4; cursor: default; }
.ct-chevron:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.ct-chevron-leaf { cursor: inherit; }
.ct-leaf-dot { width: 4px; height: 4px; border-radius: 99px; opacity: 0.6; }

.ct-row-name {
    min-width: 0;
    display: flex;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
}
/* flex 0 20 auto: soak up ~all the shrink, so the breadcrumb ellipses long
   before the category name does. */
.ct-row-path {
    flex: 0 20 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg-3);
}
/* Own span so the path's ellipsis can't swallow the separator. */
.ct-row-sep { flex: none; padding: 0 4px; color: var(--fg-4); }
.ct-row-leaf { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ct-mark {
    background: color-mix(in oklab, var(--gold) 30%, transparent);
    color: var(--fg);
    border-radius: 3px;
    padding: 0 1px;
}
.ct-count-chip {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    height: 17px;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 10px;
    color: var(--fg-3);
    border: 1px solid var(--line);
    background: var(--bg-elev-2);
}
.ct-row-spacer { flex: 1; }

/* Priority badge — letter + colour, so the tier survives greyscale and
   colour-blind vision. Solid = set here, dashed = inherited. */
.ct-pri-badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 3px;
    border-radius: 5px;
    /* On a tree row the letter is the whole tier signal for sighted users,
       and title tooltips never fire on touch — don't shrink it further. */
    font-size: 10.5px;
    font-weight: 700;
    line-height: 1;
    color: var(--tier);
    background: color-mix(in oklab, var(--tier) 16%, transparent);
    border: 1px solid color-mix(in oklab, var(--tier) 70%, transparent);
}
/* Inherited is the majority state, so it can't be the illegible one. A dashed
   border loses ~half its ink, hence the *higher* alpha than the solid case;
   the fill is what still reads as "set here". */
.ct-pri-badge.is-inherited {
    background: transparent;
    border-style: dashed;
    border-color: color-mix(in oklab, var(--tier) 80%, transparent);
    color: color-mix(in oklab, var(--tier) 80%, var(--fg-3));
    font-weight: 600;
}
.ct-pri-badge.is-unset {
    color: var(--fg-3);
    background: transparent;
    border: 1px dashed var(--line-strong);
}

.ct-row-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 120ms ease;
}
.ct-row:hover .ct-row-actions,
.ct-row.is-selected .ct-row-actions,
.ct-row:focus-within .ct-row-actions { opacity: 1; }
.ct-row-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: 0;
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
}
.ct-row-btn:hover { background: var(--bg-elev-3); color: var(--fg); }
.ct-row-btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; opacity: 1; }
.ct-row-grip {
    display: inline-flex;
    align-items: center;
    color: var(--fg-4);
    cursor: grab;
}

/* Touch devices: hover-revealed actions don't exist — keep them visible,
   and grow the most-tapped controls toward the 44px target. */
@media (hover: none) {
    .ct-row-actions { opacity: 1; }
    .ct-row-grip { display: none; }
    .ct-row { min-height: 44px; }
    .ct-row-btn { width: 40px; height: 40px; }
    .ct-chevron { width: 40px; height: 40px; }
    .ct-tool-btn { width: 40px; height: 40px; }
    .ct-insp-close.ct-tool-btn { width: 40px; height: 40px; }
    .ct-savebar .od-btn-sm { height: 40px; }
    .ct-child-row { min-height: 44px; }
    .ct-children-add { min-height: 36px; padding: 0 10px; }
    .ct-search-clear { width: 32px; height: 32px; }
    .ct-danger-btn { height: 40px; }
    .ct-insp-crumb { padding: 6px 4px; }
    /* iOS zooms on focusing any input under 16px — the width-based 640px
       rule misses landscape phones and tablets, so fix it by input type. */
    .ct-search-input { font-size: 16px; }
    /* Toolbar row: search / mode toggle / bulk buttons all share one height
       so the row reads as a single band, and all clear 44px. */
    .ct-search { height: 44px; }
    .ct-tree-toolbar .ct-tool-btn { width: 44px; height: 44px; }
}

/* ---------- tree footer / legend ---------- */
.ct-tree-foot {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 6px 10px;
    border-top: 1px solid var(--line-soft);
    background: var(--bg-elev-2);
}
/* Phones keep wrapping rather than scrolling: five chips overflow ~190px at
   375px, and a scroll container with no scrollbar hides two filters with no
   hint they exist. The drag hint goes instead — HTML5 drag doesn't fire on
   touch at all, while "dashed = inherited" is the only place the badge
   grammar is explained (title tooltips don't fire on touch either). */
@media (max-width: 640px) {
    .ct-legend-chip { flex-shrink: 0; }
}
.ct-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    color: var(--fg-3);
}
/* --fg-4 tops out at 2.9:1 against every surface in this palette — fine for
   decoration, never for text that carries meaning. */
.ct-legend-muted { color: var(--fg-3); }

/* Legend chips double as tier filters — count first, colour second. */
.ct-legend-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 7px 0 5px;
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--fg-3);
    font-size: 10.5px;
    font-family: inherit;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.ct-legend-chip:hover { background: var(--bg-elev-3); color: var(--fg-2); }
/* Background tints top out near 1.3:1 in this palette, so the pressed state
   has to live in the border. --fg-2 fallback keeps the "No priority" chip —
   the one most likely to be used — from disappearing when active. */
.ct-legend-chip.is-active {
    color: var(--fg);
    border-color: color-mix(in oklab, var(--tier, var(--fg-2)) 75%, transparent);
    background: color-mix(in oklab, var(--tier, var(--fg-2)) 18%, transparent);
}
.ct-legend-chip:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
/* These are filters now, not swatches — grow the hit area on touch without
   growing the footer. */
@media (hover: none) {
    .ct-legend-chip { position: relative; }
    .ct-legend-chip::after { content: ""; position: absolute; inset: -10px 0; }
}
.ct-legend-count {
    color: var(--fg-3);
    font-size: 10.5px;
}
.ct-legend-chip.is-active .ct-legend-count { color: var(--fg-2); }
.ct-legend-hint {
    margin-left: auto;
    font-size: 10.5px;
    color: var(--fg-3);
}
@media (max-width: 640px) {
    .ct-legend-hint { display: none; }
}

/* ---------- empty / skeleton ---------- */
.ct-empty {
    padding: 44px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
    color: var(--fg-4);
}
.ct-empty-title { font-size: 13.5px; color: var(--fg-2); font-weight: 500; margin: 0; }
.ct-empty-sub { font-size: 12px; color: var(--fg-3); max-width: 300px; margin: 0; }
.ct-empty .od-btn { margin-top: 6px; }
.ct-tips {
    margin-top: 26px;
    padding: 14px 16px;
    border: 1px dashed var(--line);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 9px;
    text-align: left;
    max-width: 300px;
}
.ct-tip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: var(--fg-3);
}
.ct-tip svg { color: var(--fg-4); flex-shrink: 0; }

/* No display:flex on .ct-skeleton — a flex container ignores 'columns',
   which would collapse the skeleton to one column and pop on data load. */
.ct-skel-row { display: flex; align-items: center; gap: 10px; height: 34px; margin: 3px 4px; }
.ct-skel-dot, .ct-skel-bar {
    background: var(--bg-elev-2);
    border-radius: 6px;
    animation: ct-pulse 1.4s ease-in-out infinite;
}
.ct-skel-dot { width: 26px; height: 26px; flex-shrink: 0; }
.ct-skel-bar { height: 12px; }
@keyframes ct-pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) {
    .ct-skel-dot, .ct-skel-bar { animation: none; }
}

/* ---------- inspector ---------- */
.orbit-design .od-card.ct-inspector {
    width: 400px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
}
.ct-scrim { display: none; }

@media (max-width: 1079px) {
    /* Stay BELOW Radix portals (z-50): the create dialog opened from the
       inspector must stack above this slide-over. */
    .orbit-design .od-card.ct-inspector {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(400px, calc(100vw - 24px));
        z-index: 40;
        border-radius: 16px 0 0 16px;
        transform: translateX(105%);
        transition: transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1);
        box-shadow: var(--shadow-3);
    }
    .orbit-design .od-card.ct-inspector.is-open { transform: none; }
    .ct-scrim {
        display: block;
        position: fixed;
        inset: 0;
        z-index: 39;
        background: rgb(0 0 0 / 0.55);
        opacity: 0;
        pointer-events: none;
        transition: opacity 240ms ease;
    }
    .ct-scrim.is-open { opacity: 1; pointer-events: auto; }
    .ct-inspector-empty { display: none; }
    /* Fixed full-height panel: keep the header out of the status bar and
       the action bar above the home indicator on notched phones. */
    .ct-insp-head { padding-top: max(16px, env(safe-area-inset-top)); }
    .ct-savebar { padding-bottom: max(10px, env(safe-area-inset-bottom)); }
}
@media (prefers-reduced-motion: reduce) {
    .orbit-design .od-card.ct-inspector { transition: none; }
    .ct-scrim { transition: none; }
}

.ct-insp {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}
.ct-insp-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 16px 14px;
    border-bottom: 1px solid var(--line-soft);
    background: var(--bg-elev-2);
}
.ct-insp-head-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ct-insp-crumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px;
}
.ct-insp-crumb {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 0;
    background: transparent;
    padding: 1px 2px;
    border-radius: 4px;
    font-size: 11px;
    color: var(--fg-3);
    cursor: pointer;
    font-family: inherit;
    /* One monster ancestor name must not blow out the 296px overlay panel. */
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ct-insp-crumb:hover { color: var(--fg-2); background: var(--bg-elev-3); }
.ct-insp-crumb:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.ct-insp-crumb.as-static { cursor: default; }
.ct-insp-crumb.as-static:hover { color: var(--fg-3); background: transparent; }
.ct-insp-name {
    font-size: 16px;
    font-weight: 500;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ct-insp-usage { font-size: 11px; color: var(--fg-3); }
.ct-insp-close { width: 28px; height: 28px; border-radius: 8px; }

.ct-insp-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.ct-insp-style-row { display: flex; flex-wrap: wrap; gap: 8px; }

/* OrbitField's .oms-field classes are styled by OrbitModalShell, which
   isn't mounted here — provide the same rules for the panel. */
.ct-insp .oms-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.ct-insp .oms-field-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
}
.ct-insp .oms-field-label {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--fg-2);
    letter-spacing: 0.02em;
}
.ct-insp .oms-field-required {
    color: var(--brand);
    margin-left: 4px;
}
.ct-insp .oms-field-hint {
    font-size: 11px;
    color: var(--fg-3);
    text-align: right;
}

/* priority picker — one row per tier */
.ct-pri-select { display: flex; flex-direction: column; gap: 4px; }
.ct-pri-opt {
    position: relative; /* keeps the visually-hidden radio inside the row */
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 34px;
    padding: 4px 10px;
    border-radius: 10px;
    border: 1px solid var(--line-soft);
    background: var(--bg-elev-1);
    cursor: pointer;
    transition: border-color 140ms ease, background 140ms ease;
}
.ct-pri-opt:hover { border-color: var(--line-strong); background: var(--bg-elev-2); }
.ct-pri-opt.is-active {
    border-color: color-mix(in oklab, var(--tier, var(--brand)) 45%, transparent);
    background: color-mix(in oklab, var(--tier, var(--brand)) 10%, transparent);
}
/* The radio stays focusable (and keyboard-navigable) but invisible — the
   whole row is the label, so the ring belongs on the row. */
.ct-pri-radio {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    margin: 0;
    pointer-events: none;
}
.ct-pri-opt:has(.ct-pri-radio:focus-visible) {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
}
.ct-pri-opt-label {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--fg-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ct-pri-opt.is-active .ct-pri-opt-label { color: var(--fg); }
.ct-pri-opt-desc {
    font-size: 11.5px;
    color: var(--fg-3);
    white-space: nowrap;
}
.ct-pri-check { flex-shrink: 0; color: var(--tier, var(--brand)); opacity: 0; }
.ct-pri-opt.is-active .ct-pri-check { opacity: 1; }
@media (hover: none) {
    .ct-pri-opt { min-height: 44px; }
}

.ct-pri-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 9px;
    border-radius: 999px;
    border: 1px solid;
    font-size: 11px;
    font-weight: 500;
}

/* read-only rows */
.ct-ro-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--bg-elev-2);
    border: 1px solid var(--line-soft);
}
.ct-ro-label { font-size: 12px; color: var(--fg-3); }
.ct-ro-value { font-size: 12.5px; color: var(--fg); display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.ct-dim { color: var(--fg-3); }

/* children */
.ct-children {
    border: 1px solid var(--line-soft);
    border-radius: 12px;
    background: var(--bg-elev-2);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.ct-children-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ct-children-add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0;
    background: transparent;
    color: var(--brand);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 6px;
    font-family: inherit;
}
.ct-children-add:hover { background: var(--brand-soft); }
.ct-children-add:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.ct-children-empty { font-size: 11.5px; color: var(--fg-3); margin: 0; }
.ct-children-list { display: flex; flex-direction: column; gap: 2px; }
.ct-child-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border-radius: 8px;
    border: 0;
    background: transparent;
    color: var(--fg-2);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    min-height: 34px;
}
.ct-child-row:hover { background: var(--bg-elev-3); color: var(--fg); }
.ct-child-row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
.ct-child-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct-child-arrow { color: var(--fg-4); flex-shrink: 0; }

/* danger zone */
.ct-danger {
    margin-top: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border-radius: 12px;
    border: 1px solid color-mix(in oklab, var(--danger) 25%, transparent);
    background: color-mix(in oklab, var(--danger) 5%, transparent);
}
.ct-danger-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ct-danger-title { font-size: 12.5px; font-weight: 500; color: var(--fg); }
.ct-danger-sub { font-size: 11px; color: var(--fg-3); }
.ct-danger-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: 9px;
    border: 1px solid color-mix(in oklab, var(--danger) 40%, transparent);
    background: transparent;
    color: var(--danger);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    font-family: inherit;
    transition: all 140ms ease;
}
.ct-danger-btn:hover:not(:disabled) { background: color-mix(in oklab, var(--danger) 12%, transparent); }
.ct-danger-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ct-danger-btn:focus-visible { outline: 2px solid var(--danger); outline-offset: 2px; }

/* save bar */
.ct-savebar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--line);
    background: var(--bg-elev-2);
    animation: orbit-rise 200ms ease both;
}
@media (prefers-reduced-motion: reduce) {
    .ct-savebar { animation: none; }
}
.ct-savebar-label {
    flex: 1;
    font-size: 11.5px;
    color: var(--gold);
}

`;
