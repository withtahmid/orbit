---
name: anomaly-statement-balance-prominence
description: RESOLVED — single-account running balance now full-prominence in statement mode, muted multi-account; parity with AccountDetailPage
metadata:
  type: project
---

RESOLVED (fix/optimistic-transaction branch, round-3 review). TransactionsPage
now sets running-balance prominence conditional on `isStatementMode`
(exactly one account selected, `f.accountIds.length === 1`):

- **Statement mode:** `variant="neutral"`, 13/500 desktop, 12/500 mobile —
  headline treatment, parity with AccountDetailPage's per-row balance.
- **Multi-account/default mode:** `variant="muted"`, 12/400 desktop, 11/400
  mobile — context, fenced off from Amount by the `.tx-cell-balance` left
  hairline so it can't be mistaken for the transaction amount.

The `tx-statement-note` caption ("Each row shows [account]'s balance after
that transaction") appears/disappears in lockstep with the mode, so the
restyle when a user toggles the account filter on/off is explained, not
arbitrary. Applies in personal `/s/me` too (accounts from
`personal.ownedAccounts`).

**How to apply:** This is now the canonical pattern for "running balance as
context vs. as headline." Don't reintroduce a single flat prominence. If a
future single-account balance surface appears, mirror this
neutral-in-statement / muted-in-multi split. Residual watch-item: multi-account
MOBILE balance at 11px/400 muted is near the legibility floor on editorial-dark
— acceptable as intentional de-emphasis, but flag if it shrinks further.
