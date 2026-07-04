---
name: accounts-networth-sign
description: Account balance sign convention on the Accounts page and the net-worth Math.abs pitfall
metadata:
  type: project
---

Account `balance` from `account.listBySpace` / `account.listByUser` arrives as `Number(balance)` — the raw accumulated transaction effect (trigger in migration 018 applies `signed_amount = amount * direction` regardless of account_type; no per-type sign logic).

Convention (per `AccountCard` in `AccountsPage.tsx`): liabilities store amount owed as a **positive** number; asset/locked keep their sign and can go negative (overdrawn). AccountCard flips liability sign per-account: `signedBalance = type === "liability" ? -balance : balance`.

**Correct net worth** = Σasset + Σlocked − Σliability(raw signed sum). This matches the deleted `analytics/views/AccountsView.tsx` (`netWorth = totalAssets - liabSum`, no abs) and AccountCard's per-account sign flip.

**Status (verified 2026-07-04, branch feat/accounts):** the `totals` memo now uses `net = assets + locked - liabilities` (signed sum, NO abs) at `AccountsPage.tsx:154`. The former `Math.abs(liabilities)` bug is FIXED. Overpaid liability (balance −200) now correctly ADDS 200 to net, matching AccountCard's `signedBalance = liability ? -balance : balance` and the owner-group-head reducer (same flip). Sum of all owner-group-head totals == net worth. Liabilities TypeStat is fed `value={-totals.liabilities}` with `signed` (−/red owing, +/green credit, ""/fg-3 at zero) — the `-0` case renders "0.00" cleanly.

**Why the pitfall existed:** `Math.abs(Σliability)` == `Σliability` only when the sum is non-negative. If a liability is overpaid (negative balance = net credit), abs(sum) flips the sign and mis-subtracts.

**How to apply:** flag any `Math.abs` applied to an aggregate liability/balance sum. Prefer summing signed balances (abs per-account if you must, never abs-of-sum). Distribution-bar denominator note: `holdingsTotal` (AccountsPage) = Σ distSlices values = the bar's internal `total` (AccountDistributionBar filters `value>0`, all distSlices are already positive) = each card's `% of holdings` denominator — ONE denominator across all three. distSlices is sorted desc with "Other" appended last, so `normalized[0]` is always the largest REAL account (never the Other rollup). Rollup boundary: `length <= TOP+1` (=9) returns all; ≥10 rolls tail into "Other · N accounts" (N≥2, never singular). fmt2 (AccountsPage) and formatMoney (lib/money) are en-US/2dp identical; fmt2 lacks the null/non-finite guard but only ever receives `Math.abs(finite)`.
