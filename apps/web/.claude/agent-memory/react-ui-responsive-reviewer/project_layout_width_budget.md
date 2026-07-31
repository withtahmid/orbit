---
name: layout-width-budget
description: Content-width budget per breakpoint inside SpaceLayout's .sl-main — 768px is NARROWER than 640px, the trap that breaks every rigid sm:flex-row
metadata:
  type: project
---

`src/layouts/SpaceLayout.tsx` defines `.sl-aside` (232px, `display:none` until `min-width:768px`) and `.sl-main` (`padding: 1.5rem 1rem`, → `2rem` at `min-width:768px`). Net content width available to any page under `/s/:spaceId/*`:

| viewport | sidebar | main padding | content |
|---|---|---|---|
| 375 | 0 | 32 | **343** |
| 640 | 0 | 32 | **608** |
| 767 | 0 | 32 | 735 |
| **768** | 232 | 64 | **472** |
| 1024 | 232 | 64 | 728 |
| 1440 | 232 | 64 | 1144 |

**Why:** the sidebar and the padding bump both land at 768px, so content width *drops by 263px* crossing that breakpoint. Tailwind's `sm:` (640px) row layouts get their widest test at 767px and their narrowest at 768px — the opposite of the mental model "bigger viewport = more room". This has now bitten TrendsView's period bar (a `sm:flex-row` whose rigid children need 620px, fine at 680–767 and ≥916, overflowing 768–915).

**How to apply:**
- Any `sm:flex-row` / `md:grid-cols-*` row whose children are `shrink-0` / `flex-none` / `whitespace-nowrap` must fit **472px**, not 640px. Compute its min-content sum before approving a fixed width.
- The fix is almost always `sm:flex-wrap` (plus `gap-y-*`), not a smaller font — wrapping degrades, rigid rows cause page-level horizontal scroll (`.sl-main` sets no `overflow-x`).
- Card interiors subtract another 2 (Card border) + 48 (`CardContent p-6`): 375→**293px**, 768→**422px**, 1024 in a `lg:grid-cols-[1.4fr_1fr]` left column→**~366px**.
