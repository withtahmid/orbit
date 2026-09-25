/**
 * Radix popovers auto-focus their first tabbable on open. Two problems with
 * that here: on touch devices it pops the keyboard over half the panel
 * before anything was typed, and "first tabbable" is whatever the DOM order
 * says (a header button), not the search box a keyboard user wants.
 */

function isCoarsePointer(): boolean {
    return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/**
 * `onOpenAutoFocus` handler: skip auto-focus on touch devices (focus stays
 * on the trigger), otherwise focus the first element matching `selector`
 * inside the popover content.
 */
export function focusOnOpen(selector: string) {
    return (event: Event) => {
        event.preventDefault();
        if (isCoarsePointer()) return;
        (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLElement>(selector)
            ?.focus({ preventScroll: true });
    };
}
