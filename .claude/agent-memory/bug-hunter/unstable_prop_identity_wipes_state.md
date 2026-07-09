---
name: unstable-prop-identity-wipes-state
description: Inline `.map`/`?? []` props feed child useMemo → new identity every render → a child effect keyed on that memo wipes local UI state on any unrelated refetch
metadata:
  type: project
---

Pattern seen in EventDetailPage.tsx → CategoryCard → CategoryDonutChart (feat/enevt/details).

A parent passes a freshly-built array prop every render (e.g. `categories={(q.data ?? []).map(...)}`).
The child memoizes off it (`roots = useMemo(() => buildCategoryTree(categories, ...), [categories])`),
so `roots` gets a new reference every parent render. A downstream `useMemo` (`slices`) then also
churns, and a `useEffect(() => { setHover(null); setPinned(null); }, [slices])` fires on EVERY render —
not only when data actually changed. Result: pinned/hover selection is wiped by ANY of the page's
sibling queries refetching (window-focus refetch is default-on), contradicting the "pin persists" design.

**Why:** memo/effect deps compare by identity; inline `.map`/`?? []` in JSX defeats it.
**How to apply:** when a child clears local state in an effect keyed on a derived memo, check that the
UPSTREAM prop identity is stable (memoize the `.map` in the parent, or key the clear-effect on a stable
signature like `pathIds` + a data hash, not the array ref). Applies to any `.tsx` where an effect resets
UI state on a computed-array dep.
