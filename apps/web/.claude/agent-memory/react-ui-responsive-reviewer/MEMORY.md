# React UI Responsive Reviewer — Memory Index

- [simplify-budgeting removal](project_simplify_budgeting_removal.md) — branch ripped out borrow/reckoning/carry/matrix/account-tab; rounds 2 & 3 UI fixes verified clean
- [Analytics UI conventions](project_analytics_ui_conventions.md) — h-9 sm:h-7 touch pattern, PageHeader non-wrapping actions gotcha, ranked-list grid + min-w-0 truncation traps
- [Heatmap UI conventions](project_heatmap_ui_conventions.md) — shared spendHeatmapColor.ts (AMBER ramp, percentile buckets) drives both HeatmapView + Overview DailyHeatmap; consistency/a11y/tz notes
- [Budgets UI conventions](project_budgets_ui_conventions.md) — fg-4 fails AA contrast, dangling flex-divider trap in summary strip, dist-bar last-child radius, sub-44px touch targets
- [Categories UI conventions](project_categories_ui_conventions.md) — multicol masonry (cards jump on expand, 1-col stretch <1450px); OrbitField-label-wraps-buttons resets Priority; dirty-discard on scrim/Esc; no focus trap; round-1 stacking/a11y fixes verified
- [Accounts UI conventions](project_accounts_ui_conventions.md) — round-5 ledger-over-bar (.ac-strip/facts GONE); dividers now unreachable-to-dangle; single-tap segments; bar/chip <44px (cards=fallback)
- [Event Detail UI conventions](project_event_detail_ui_conventions.md) — round-3: single ComposedChart + fg-4/focus/reduced-motion FIXED; remaining=2-tile stat stretch, un-stacked vol bars dodge, "No description" fg-4
- [Transactions table UI conventions](project_transactions_table_ui_conventions.md) — dual desktop-grid/mobile-flex lists; balance-cell empty fallback asymmetry ("—" desktop vs blank mobile); optimistic pending→confirmed key remount + empty balance until refetch
- [DateRangePicker conventions](project_daterangepicker_conventions.md) — pending/collapse fix works from custom entry; but Radix autofocuses From input → first calendar click blurs+re-commits stale preset value → first click SWALLOWED when opened from a named preset
