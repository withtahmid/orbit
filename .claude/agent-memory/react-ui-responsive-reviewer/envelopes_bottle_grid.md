---
name: envelopes-bottle-grid
description: Analytics EnvelopesView bottle-gauge grid — absolute badge overlaps envelope name on 2-col mobile; sizing/columns otherwise fine.
metadata:
  type: project
---

`EnvelopeBottleGrid` in `apps/web/src/pages/space/analytics/views/EnvelopesView.tsx` (~line 653): grid `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`, each cell an `od-card` `Link` with an `EnvelopeGlass` (height=110 → SVG ~61×110px, safely centered — no overflow at any width).

Known trap: the "Over"/"Trending" status pill is `absolute right-2 top-2`, painted over the name row (`flex w-full items-center`, `EntityAvatar size="sm"` = size-7/28px + name `min-w-0 flex-1 truncate`). Badge is now `text-[10px]` (bumped from 9px).

PARTIAL FIX landed: the name row gets `pr-11` (44px) when a badge is present. That clears the ~48px "Over" footprint (badge width + `right-2` 8px offset) → "Over" is fine. It does NOT clear "Trending": that badge is ~60-68px wide, so with the 8px offset it occupies the rightmost ~68-76px while the name only reserves 44px → the truncated name tail still underlaps the "Trending" pill by ~24-30px on 2-col mobile (~141px inner card). Amber 15%-tint bg means both texts collide = mush. Robust fix: render the badge INLINE (flex sibling, `shrink-0`, at the end of the name row) so truncation clips the name automatically at any label length, instead of `absolute` + a hand-tuned `pr-` reserve sized only for the shorter label.

**Why:** badge is `position:absolute` so it doesn't reserve flow space; a fixed `pr` reserve only fits the shortest label.
**How to apply:** flag whenever an absolutely-positioned corner badge sits in the same vertical band as flowing text in a narrow card, especially when the badge has multiple labels of differing widths.
