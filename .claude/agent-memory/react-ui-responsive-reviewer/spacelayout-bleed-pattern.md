---
name: SpaceLayout full-bleed pattern
description: How space pages bleed past SpaceLayout padding, and the focus-containment gap of custom slide-overs
type: project
---

Space pages (under `/s/:spaceId/*`, e.g. CategoriesPage, OverviewPage) render inside `src/layouts/SpaceLayout.tsx` → `.sl-main`, which pads content: **`1.5rem 1rem` below 768px, `2rem` at ≥768px** (media query bumps it). Full-bleed pages cancel this with negative margins on their root.

**Rule:** a page root's negative margin MUST equal `.sl-main` padding at every breakpoint or you get horizontal/vertical overflow. CategoriesPage does this correctly: `.ct-root { margin: -1.5rem -1rem }` (<768) and `margin: -2rem` (≥768). The mobile header is **53px** tall (`.sl-mobile-header`, hidden ≥768), so mobile full-height pages use `calc(100dvh - 53px)`, desktop uses `100dvh`.

**Focus-containment gotcha:** `.sl-aside` (desktop sidebar) is `display:none` <768px, `display:flex` ≥768px, and lives OUTSIDE the page component. A page-local `inert` (as CategoriesPage puts on its topbar/tree-pane) does NOT cover the sidebar. So a custom in-page modal/slide-over that lacks a real focus trap can leak Tab focus into the sidebar nav (768–1079px) or the mobile hamburger (<768px) sitting behind its scrim. Radix Dialog-based modals (ConfirmDialog → shadcn AlertDialog, overlay+content at z-50) trap focus correctly and stack above page slide-overs (which sit at z-40).

**How to apply:** when reviewing any space page, verify root negative margins match `.sl-main` padding at both breakpoints, and that any hand-rolled overlay either traps focus or `inert`s the layout chrome — not just its own subtree.
