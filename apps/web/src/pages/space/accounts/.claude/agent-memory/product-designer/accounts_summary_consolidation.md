---
name: accounts-summary-consolidation
description: /accounts summary redesign (feat/accounts, 2026-07-04) — folded analytics AccountsView in; two-tier net-worth+distribution card; two-totals dissonance pattern
metadata:
  type: project
---

On branch `feat/accounts` (2026-07-04) the analytics "Account distribution" view (`views/AccountsView.tsx`, route `analytics/accounts`, ENTRIES entry) was DELETED and folded into the `/accounts` page summary. IA consolidation: account distribution now lives on the accounts page itself, not analytics.

Final summary shape (`AccountsPage.tsx` + `AccountDistributionBar.tsx`):
- Two-tier `.ac-summary` card: (1) ledger header — Net worth as sole hero left, composition TypeStats (Assets / [Locked, hidden at 0] / Liabilities-as-signed-net-effect, "no debt" note) right-aligned subordinate; (2) hairline, then full-width distribution bar with idle readout "{largest} leads · X% of {total}", hover swaps, chips, click navigates.
- Earlier "glance facts" tiles (largest holding, account count) were removed as duplication — largest is in bar readout, count is in topbar eyebrow, per-account share is on cards ("% of holdings"). Removal was correct; nothing essential lost.

**Verdict: SHIP.** No blockers.

Key product finding — **two unreconciled totals** (pattern worth watching):
- Hero = net worth = assets + locked − liabilities.
- Bar base (`holdingsTotal`) = sum of positive asset+locked balances only (excludes liabilities, excludes negative/overdrawn). All bar/chip/card percentages are relative to this gross base.
- When liabilities or overdrawn accounts exist, hero ≠ bar total, and the two big numbers sit in one card with no stated relationship. In the common no-debt case they're equal (no dissonance).
- Recommended (non-blocking) tightening: readout says "…of {total}" (bare) while cards say "% of holdings" — anchor the base word by making the readout "…of {total} holdings" so the gross base is named and distinguished from net worth.

Currency: `fmt2` (page) and `formatMoney` (`@/lib/money`) are functionally identical — grouped en-US, 2 decimals, NO currency symbol. App-wide numbers are symbol-free; no mismatch between hero and bar.

Gap for later (not missing-essential): no net-worth trend/delta (vs last month / sparkline). Trend lives in analytics "Balance history", which still exists. Single most valuable future add to the hero.

/s/me: coherent. Personal mode uses `account.listByUser` filtered to `myRole==='owner'` (data-layer twin already exists), skips owner-group headers, shows space chips on cards. No server-twin gap since this is not an analytics tRPC procedure.
