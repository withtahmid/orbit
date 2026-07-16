---
name: overview-donut-labels
description: OverviewPage donut center labels/values assume sorted data but sources are created_at-ordered; DesignIcon silently falls back to layers glyph for unknown names
metadata:
  type: project
---

Two recurring OverviewPage.tsx display-correctness traps (found 2026-07-16, BOTH
FIXED and re-verified 2026-07-16):

1. **"Top envelope" center value is not the top.** [FIXED] `topCatsDonut` now ends
   with `.sort((a,b) => b.value - a.value)` so `[0]` is the biggest spender,
   matching the "Top envelope" center label. `analytics.envelopeUtilization` still
   returns rows `ORDER BY e.created_at ASC`, so the client-side sort is the fix.
   **How to apply (still live lesson):** any Overview headline that says
   "top"/"biggest"/"peak" and indexes `[0]` of a query result — verify the
   underlying proc's ORDER BY. Most analytics procs order by `created_at`, not by
   amount. Sort client-side or fix the label.

2. **`DesignIcon` swallows unknown icon names.** [FIXED] `sparkle` and `repeat` are
   now present in `ICON_PATHS` (hand-authored `d` strings, verified syntactically
   valid). The silent-fallback mechanism (`ICON_PATHS[name] ?? ICON_PATHS.layers`)
   still exists.
   **How to apply (still live lesson):** when reviewing DesignIcon usage,
   cross-check every `name=` string against the `ICON_PATHS` literal — the fallback
   hides typos with no crash and no tsc error.
