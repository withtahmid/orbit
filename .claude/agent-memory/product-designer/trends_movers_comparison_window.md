---
name: trends-movers-comparison-window
description: SETTLED (round 6, 2026-08-01) — the movers card compares the WHOLE prior period against the current period so far; the elapsed-truncated alternative was tried and rejected. Records why cross-view number consistency outranks comparison symmetry.
metadata:
  type: project
---

**Decision: whole prior period vs current period so far.** Both twins
(`trendsCategoryMovers`) default the comparison window to
`[prevStart, periodStart)`. `prevStart` is passed calendar-aligned by every
caller; the proc's own default (subtract the current window's length) lands off
calendar boundaries and must not be relied on.

**The rejected alternative — do not re-propose.** Truncating the prior window
to the same elapsed span (`prevEnd`) looked more rigorous and lost on two
counts:

1. **It made two views disagree about the same month.** July's own view said
   Tour & Travel 20,741; August's view of July said 1,850 (July 1 alone). A
   money app whose numbers change depending on which page you opened them from
   has no recoverable trust. This is the decisive argument and it generalises:
   *any* number attributed to a named period must be identical wherever that
   period is named.
2. It left a counted-by-neither gap — `spending` spanned `[prevStart,
   periodEnd)` while the two arms counted `[prevStart, prevEnd)` and
   `[periodStart, periodEnd)` — which padded the list with phantom `0 → 0`
   rows on day 1. The `.filter(cur !== 0 || prv !== 0)` guard in both twins is
   the residue of that; harmless now, keep it.

**The accepted cost, stated in copy:** early in a period most rows read as
falls, and on day 1 the sort by `|deltaAmount|` degenerates into "top
categories last period" rendered as a wall of green (a fall takes `--income`).
The owner explicitly chose to show the real numbers — *"show actual big numbers
down to zero. that would be real."* — and **deleted a "too early to compare"
blackout**. Do not reintroduce a blackout, a gate, or a hidden state. If this
is ever softened, soften the *hue saturation* early in a period, never the
numbers.

`from 0` / `to 0` replace `New` / `Stopped` while the period is live, because
those two words are claims about the category that a partial window can't
support.

**Loaded gun:** the server still accepts an optional `prevEnd`, and no caller
passes it. Delete it — a future caller passing it silently restores the
rejected semantics.

Related: [[trends_movers_bar_normalised]], [[trends_movers_rollup_ladder]],
[[trends_view_period_history_shipped]].
