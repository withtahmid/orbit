import { Check } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { cn } from "@/lib/utils";

/**
 * One selectable entity inside a filter dropdown — avatar, name, optional
 * trailing badge, and a tick when selected. Shared by every analytics filter
 * menu so the account, envelope and category lists stay identical.
 *
 * Built on `DropdownMenuItem` rather than `DropdownMenuCheckboxItem`: that
 * primitive reserves a fixed `pl-8` gutter for a tick pinned at `left-2`,
 * which with an avatar already in the row produced three ragged columns
 * (tick · avatar · name) and left a wide gap between the tick and everything
 * it referred to. Worse for the category tree, whose depth indent overrode
 * that gutter's padding outright, so at depth 0 the tick landed underneath
 * the avatar.
 *
 * Identity leads, selection trails: the avatars form one clean column that
 * the tree indent can shift freely, and every tick shares a right-hand rail.
 * The tick keeps its space when unchecked so toggling a row doesn't reflow
 * the name beside it.
 */
export function FilterCheckRow({
    checked,
    onToggle,
    color,
    icon,
    /** Left offset in rem, for the category tree's depth indent. */
    indent = 0,
    trailing,
    children,
}: {
    checked: boolean;
    onToggle: () => void;
    color: string;
    icon: string;
    indent?: number;
    trailing?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <DropdownMenuItem
            role="menuitemcheckbox"
            aria-checked={checked}
            /* `onSelect` rather than `onClick` so keyboard activation toggles
               too; `preventDefault` keeps the menu open for the next pick. */
            onSelect={(e) => {
                e.preventDefault();
                onToggle();
            }}
            /* `[&_svg]:size-3.5` undoes DropdownMenuItem's own `[&_svg]:size-4`,
               which the CheckboxItem this replaced did not carry — without it
               every avatar glyph in these menus renders a size larger than the
               same avatar everywhere else in the app.

               Focus is a ring, not a fill: `bg-accent` over an already-tinted
               checked row measures 1.38:1, so keyboard focus landing on a
               selected row was near-invisible. `--ring` on `--accent` is
               7.15:1. */
            className={cn(
                "pr-2 [&_svg]:size-3.5 focus:ring-1 focus:ring-inset focus:ring-ring",
                checked && "bg-accent/70"
            )}
            style={{ paddingLeft: `${0.5 + indent}rem` }}
        >
            <EntityAvatar size="sm" color={color} icon={icon} />
            <span className="min-w-0 flex-1 truncate">{children}</span>
            {trailing}
            <Check
                className={cn(
                    "size-3.5 shrink-0 transition-opacity",
                    checked ? "opacity-100" : "opacity-0"
                )}
                aria-hidden
            />
        </DropdownMenuItem>
    );
}

export default FilterCheckRow;
