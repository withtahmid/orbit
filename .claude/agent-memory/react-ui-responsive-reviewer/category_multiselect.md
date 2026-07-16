---
name: category-multiselect
description: CategoryMultiSelect dropdown — embedded search Input lacks onKeyDown stopPropagation (Radix menu typeahead hijack); "+N" badge is SR-ambiguous.
metadata:
  type: project
---

`apps/web/src/pages/space/analytics/components/CategoryMultiSelect.tsx` — Radix `DropdownMenu` (`@radix-ui/react-dropdown-menu ^2.1.16`) with a search `<Input>` embedded in the content (line ~129) and hierarchical `DropdownMenuCheckboxItem` rows.

Two issues seen:
- Search Input has no `onKeyDown={(e) => e.stopPropagation()}`. Radix Menu content runs single-char typeahead that isn't suppressed for focused inputs, so typing in the search box can steal focus to a matching menu item after the first keystroke — keyboard search becomes unreliable. Standard fix is stopPropagation on the Input. VERIFY with a 30s keyboard test before asserting hard; exact behavior varies by Radix minor.
- The parent-row "+N" descendant badge (line ~180) is a bare `<span>+{n}</span>` with only a `title`. Screen readers announce "plus 5" with no meaning. Add `aria-label`/sr-only ("includes N sub-categories") — `title` is not reliably announced.

Trigger button is `h-9 ... sm:h-7` (36px mobile / 28px desktop). Shares `w-[min(18rem,calc(100vw-1.5rem))]` content width — safe on mobile.
