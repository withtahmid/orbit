---
name: ov-shimmer-keyframe-scoping
description: Skeleton shimmer keyframe `ov-shimmer` is defined only inside OverviewPage's inline <style>, not global CSS — so every page's Skeleton loses its animation unless Overview is mounted.
metadata:
  type: project
---

The `Skeleton` primitives across the app (`eventUI.tsx`, `BudgetDetailPage`, `AccountsPage`, `OverviewPage`, `BudgetsPage`) all set `animation: "ov-shimmer 1.6s ..."`, but `@keyframes ov-shimmer` is **only** declared inside OverviewPage.tsx's page-level inline `<style>` (approx line 3255). It is NOT in `styles/orbit-design.css` or any global stylesheet.

**Why:** React removes a component's injected `<style>` when it unmounts. So on any direct/hard load of a non-Overview route (e.g. `/s/:id/events/:eventId`), or after navigating away from Overview, the keyframe is absent and every skeleton renders as a **static** gradient — the shimmer never plays.

**How to apply:** When reviewing loading/skeleton states on any page that uses the shared `Skeleton`, treat the shimmer as effectively broken. The fix is to hoist `@keyframes ov-shimmer` into `styles/orbit-design.css` (global) rather than each page's inline block. Flag pages that add their own Skeleton without carrying the keyframe. Relates to [[orbit-design-scoping]].
