---
name: heatmap-clamp-tz-frame-mix
description: HeatmapView heaviest-week drill-down clamp mixes an app-tz instant (periodStart) into native-getter key derivation — one-day-early `from` for sub-UTC+6 users
metadata:
  type: project
---

HeatmapView.tsx "Heaviest weeks" drill-down: `clampedStart = w.start < periodStart ? periodStart : w.start`, then `fromKey = ymd(clampedStart.getFullYear/Month/Date())` (NATIVE getters).

Bug: `w.start` is browser-local midnight of a Dhaka day-number (built via `new Date(y,m,d)` from Dhaka-formatted byDay keys), so native getters round-trip it correctly. But `periodStart` is an app-tz-unprojected ABSOLUTE instant (Dhaka midnight). Reading it with native getters does NOT round-trip for users whose offset < +6: Dhaka Aug 1 midnight = Jul 31 18:00Z, which native-reads as "Jul 31" in any tz west of +6 → `fromKey` becomes the day BEFORE the window start, so the drill-down pulls one out-of-window day the week's displayed total never counted.

**Why:** the rest of `feat/heatmap-enhanch` carefully fixed exactly this tz-drift class (peakDateLabel, week labels read native fields off native-constructed Dates). The clamp reintroduced it by substituting a differently-framed value into a native-getter path.

**How to apply:** any time a value from `@/lib/dates` (app-tz absolute) is fed into `.getFullYear()/.getMonth()/.getDate()` for key/label derivation, it's a drift bug for non-Dhaka users. Fix = normalize to browser-local-midnight frame first, e.g. `new Date(getAppTzYear(periodStart), getAppTzMonth(periodStart), getAppTzDate(periodStart))`, consistent with how w.start is built. Latent for the actual user (Bangladesh, UTC+6) — only bites offset < +6.
