import { ListTree, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";

const BTN =
    "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition-colors sm:px-2.5 sm:py-1";
const ON = "bg-accent text-foreground";
const OFF = "text-muted-foreground hover:text-foreground";

/**
 * Tree ⇄ Flat segmented toggle. Tree keeps one level of hierarchy — each row
 * carries its own subtree; Flat drops the roll-up and lists every category
 * with direct spend at any depth.
 *
 * Shared by Spending-by-category, Spending-trends' Biggest movers and the
 * envelope detail page, so the same choice is offered in the same words and
 * the same control. All three show it unconditionally — the shape is the
 * reader's choice and is never inferred from how the list is filtered. The
 * labels stay generic and the tooltips are overridable because Tree is
 * navigable on Categories and inert on the other two.
 */
export function ViewModeToggle({
    flat,
    onChange,
    treeTitle = "Drill into the category tree one level at a time",
    flatTitle = "Show every category with direct spend at once",
}: {
    flat: boolean;
    onChange: (flat: boolean) => void;
    treeTitle?: string;
    flatTitle?: string;
}) {
    return (
        <div
            role="group"
            aria-label="Roll-up"
            className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
        >
            <button
                type="button"
                onClick={() => onChange(false)}
                aria-pressed={!flat}
                title={treeTitle}
                className={cn(BTN, !flat ? ON : OFF)}
            >
                <ListTree className="size-3.5" />
                Tree
            </button>
            <button
                type="button"
                onClick={() => onChange(true)}
                aria-pressed={flat}
                title={flatTitle}
                className={cn(BTN, flat ? ON : OFF)}
            >
                <Rows3 className="size-3.5" />
                Flat
            </button>
        </div>
    );
}

export default ViewModeToggle;
