---
name: recharts-v3-zindex
description: recharts v3 has a real z-index system (DefaultZIndexes) — JSX order does NOT control paint order; Line/ReferenceLine always paint above Bar
metadata:
  type: project
---

recharts is pinned at **3.8.1** (`apps/web`). Unlike recharts v2, v3 has an explicit z-index system in `node_modules/recharts/es6/zIndex/DefaultZIndexes.js`. Elements paint by zIndex, NOT by JSX/child order.

Key constants: `grid:-100`, `barBackground:-50`, `area:100`, `bar:300`, `line:400`, `axis:500`, `scatter/ReferenceDot:600`, `activeBar:1000`, `label:2000`. `ReferenceLine` defaults to `zIndex:DefaultZIndexes.line` (400).

**Why:** Consequence — a `<ReferenceLine>` (400) placed BEFORE `<Bar>` (300) in JSX still paints ABOVE the bars. The old v2 mental model ("put grid/lines earlier so opaque data paints over them") is invalid in v3. Found in HeatmapView.tsx "Spend by ___" chart where a comment claims "Placed BEFORE `<Bar>` so opaque bars paint over them … grid behind data" — factually wrong; lines render over bars.

**How to apply:** When reviewing any recharts chart in this repo, don't trust JSX-order comments for layering. To force a custom element behind bars, pass an explicit `zIndex` prop lower than 300 (ReferenceLine/Line/etc. accept `zIndex`). CartesianGrid (`-100`) is already correctly behind everything.
