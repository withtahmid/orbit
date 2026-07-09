---
name: event-detail-dashboard
description: Event Detail page redesign (/s/:id/events/:eventId) — layout, metrics, what got fixed, and the redundancy/consistency traps that remain
metadata:
  type: project
---

`EventDetailPage.tsx` was rebuilt (2026-07, feat/enevt/details branch) from a flat list into a visualization dashboard: hero band (identity + single colour-coded state pill + card-less metrics band led by Spent) → budget radial gauge + drillable category donut row → full-width spend-timeline (cumulative area + pace line + daily-volume bars) → "Where it went" top locations → filterable tx feed → attachments. Charts live in `eventCharts.tsx`, primitives in `eventUI.tsx`, pure helpers/row types in `eventUtils.ts`. New server twins: `analytics.eventDailySpend` + `analytics.eventTopLocations` (both event-scoped, membership-checked via resolveSpaceMembership). No personal twin needed — events belong to real spaces, `/s/me` owns none; same as eventTotals/eventCategoryBreakdown.

**Why:** shift from ledger to insight surface for a single event.

**FIXED on this branch (2026-07-09 review) — do NOT re-flag as open:**
- Timeline now date-fills a continuous per-calendar-day series (`enumerateDays`); pace line is honest (reaches estimate exactly on final event day, flat before/after). The old "categorical active-days-only, distorted pace" complaint is resolved.
- Income/Net tiles gated on `incomeTotal > 0` — no more "Income: None" / "Net mirrors -Spent" dead weight.
- tx search placeholder now says "description or location" (matches server ILIKE).
- Viewer copy-leaks gated: Budget-empty and tx-empty states use PermissionGate with read-only fallbacks.

**REMAINING open issues (2026-07-09), priority order:**
- **P1 short-event tile redundancy:** 1-day event → Spent = Avg/day = Busiest day (same number 3×); 2-day → Busiest day trivial. Fix: gate Avg/day on totalDays>=2, Busiest day on >=3 active spend-days. See [[feedback_thin_nonredundant_summaries]].
- **P2 density for small events:** section-level hide-when-empty is good (keep it); gap is the always-on KPI band + volume-bar strip/pace over 2-3 points. Fold P1's active-days threshold into suppressing the volume strip too.
- **P3 terminology drift vs EventsPage:** list says "Final received" for closed, detail says "Received" (Spent already agrees). Also the detail's rich state pill ("Happening now · N left", "Just wrapped") beats the list's bare Active/Closed chip — backport the pill to EventsPage as a shared component.
- **P4 flash of zeros:** hero paints on event.getById before separate eventTotals query lands → Spent/Transactions/gauge flash 0. Include totalsQuery.isLoading in the top skeleton gate.
- **P5 minor:** Avg/day denom counts only in-window days but totals include out-of-window txns → overstates rate; label + denom at least agree.
