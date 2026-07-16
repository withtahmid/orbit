---
name: burnup-bar-strip-shared-axis
description: Canonical decision — daily-volume bars co-plotted under a cumulative burn-up line share ONE y-axis, no compressed secondary axis.
metadata:
  type: feedback
---

The three burn-up charts (Event Details `SpendTimelineChart` in `events/eventCharts.tsx`, Envelope/goal "Spending pace" `EnvelopeSpendChart.tsx`, Trends "Cumulative spend race" `CumulativeRaceChart` in `analytics/views/TrendsView.tsx`) each draw a per-bucket daily-spend bar strip beneath a cumulative running-total line. The bars share the SAME y-axis/scale as the cumulative line. Do NOT reintroduce a separate compressed axis for the bars.

**Why:** An earlier version rode the bars on their own capped scale (full-height bar reached only ~28% of the plot), so bar tops didn't correspond to the dollar gridline labels — users reported the bars "lie about the axis." Sharing the axis is the honest fix. A dual/secondary axis would reintroduce exactly the read-against-the-wrong-gridline problem it just solved, plus owe a second axis label on a strip meant to stay slim.

**How to apply:** When touching these charts or adding a new burn-up+volume chart: keep bars and line on one axis. Because bars are a per-bucket flow measured against a cumulative-total ceiling, even-spread bars render at ~1/N of the axis (N = bucket count); that's honest, not a bug. Concentrated-spend surfaces (events, goals) are where the strip earns its keep — big days pop. All three SVGs use `preserveAspectRatio="none"` + `height="100%"` (Recharts maps domain across full plot), so raising container height DOES raise absolute bar pixels proportionally — the height bumps (event 340 / trends 460 / envelope 520) genuinely aid bar legibility, not just line stretch. Legend must keep distinguishing the per-bucket bar ("Spent this day") from the cumulative line since they share a scale but mean different things (flow vs stock).
