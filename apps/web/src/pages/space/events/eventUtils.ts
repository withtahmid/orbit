/* Pure helpers + shared row shapes for the event detail dashboard. Kept
   out of the .tsx chart module so those files export only components
   (react-refresh stays happy). */

import { format as dfFormat } from "date-fns";
import { formatInAppTz } from "@/lib/formatDate";

const DAY_MS = 86_400_000;

/* Parse a 'YYYY-MM-DD' APP_TZ day string into a browser-local Date built
   from its literal parts, so the wall-clock day never re-shifts by the
   viewer's timezone. */
export function parseAppDay(s: string): Date {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y || 1970, (m || 1) - 1, d || 1);
}

/* The APP_TZ calendar day of an absolute Date, as a 'YYYY-MM-DD' string —
   the same key space the eventDailySpend rows live in. Everything on the
   page derives durations from these day strings (never ms-rounded time
   math), so the "N-day event" label, the Avg/day denominator, and the
   timeline all agree. */
export function appDayStr(d: Date): string {
    return formatInAppTz(d, "yyyy-MM-dd");
}

/* Inclusive calendar-day count between two 'YYYY-MM-DD' strings (a 1-day
   event spanning a single day → 1). */
export function daySpanInclusive(startDay: string, endDay: string): number {
    const n =
        Math.round(
            (parseAppDay(endDay).getTime() - parseAppDay(startDay).getTime()) / DAY_MS
        ) + 1;
    return Math.max(1, n);
}

/* Every 'YYYY-MM-DD' from startDay to endDay inclusive. Capped at ~5.5
   years so a pathological event can't blow up the array. */
export function enumerateDays(startDay: string, endDay: string): string[] {
    const out: string[] = [];
    const cur = parseAppDay(startDay);
    const end = parseAppDay(endDay);
    if (end.getTime() < cur.getTime()) return [startDay];
    let guard = 0;
    while (cur.getTime() <= end.getTime() && guard < 2000) {
        out.push(dfFormat(cur, "yyyy-MM-dd"));
        cur.setDate(cur.getDate() + 1);
        guard++;
    }
    return out;
}

export type DailyRow = {
    date: string;
    expense: number;
    income: number;
    txCount: number;
};

export type BreakdownRow = {
    categoryId: string;
    categoryName: string;
    color: string;
    icon: string;
    total: number;
    txCount: number;
};

export type LocationRow = { location: string; total: number; txCount: number };

/* ---- Category hierarchy roll-up (drillable donut) ---- */

export type CatInput = {
    id: string;
    name: string;
    color: string;
    icon: string;
    parentId: string | null;
};

export type CatNode = {
    id: string;
    name: string;
    color: string;
    icon: string;
    parentId: string | null;
    /** Spend booked directly on this category (not its descendants). */
    direct: number;
    directTx: number;
    /** Spend for this category's whole subtree (direct + all descendants). */
    total: number;
    txTotal: number;
    children: CatNode[];
};

/* Fold the leaf-level event spend (`spend`, one row per category that had
   transactions) into the space's category tree (`cats`), returning the roots
   with subtree totals computed. Categories with no spend anywhere in their
   subtree are pruned. Orphan spend rows (category missing from the tree)
   become synthetic roots so no money is silently dropped. */
export function buildCategoryTree(cats: CatInput[], spend: BreakdownRow[]): CatNode[] {
    const nodes = new Map<string, CatNode>();
    for (const c of cats) {
        nodes.set(c.id, {
            id: c.id,
            name: c.name,
            color: c.color,
            icon: c.icon,
            parentId: c.parentId,
            direct: 0,
            directTx: 0,
            total: 0,
            txTotal: 0,
            children: [],
        });
    }
    for (const s of spend) {
        const n = nodes.get(s.categoryId);
        if (n) {
            n.direct += s.total;
            n.directTx += s.txCount;
        } else {
            nodes.set(s.categoryId, {
                id: s.categoryId,
                name: s.categoryName,
                color: s.color,
                icon: s.icon,
                parentId: null,
                direct: s.total,
                directTx: s.txCount,
                total: 0,
                txTotal: 0,
                children: [],
            });
        }
    }

    const roots: CatNode[] = [];
    for (const n of nodes.values()) {
        if (n.parentId && nodes.has(n.parentId)) {
            nodes.get(n.parentId)!.children.push(n);
        } else {
            roots.push(n);
        }
    }

    /* `seen` guards against a malformed parent cycle / self-parent (the DB
       normally prevents these, but a bad row must not hang the recursion or
       silently swallow money). */
    const seen = new Set<string>();
    const compute = (n: CatNode): void => {
        if (seen.has(n.id)) return;
        seen.add(n.id);
        let t = n.direct;
        let tx = n.directTx;
        for (const ch of n.children) {
            compute(ch);
            t += ch.total;
            tx += ch.txTotal;
        }
        n.total = t;
        n.txTotal = tx;
    };
    roots.forEach(compute);
    /* Any node not reached from a real root hangs off a parent cycle. Surface
       each such component exactly once by rooting its topmost still-unvisited
       ancestor (climb is cycle-safe) — so cyclic spend still shows without
       double-counting a tail child that a cycle member also folds in. */
    for (const n of nodes.values()) {
        if (seen.has(n.id)) continue;
        let top = n;
        const climbing = new Set<string>();
        while (top.parentId) {
            const parent = nodes.get(top.parentId);
            if (!parent || seen.has(parent.id) || climbing.has(top.id)) break;
            climbing.add(top.id);
            top = parent;
        }
        if (!seen.has(top.id)) {
            compute(top);
            roots.push(top);
        }
    }

    return roots.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
}
