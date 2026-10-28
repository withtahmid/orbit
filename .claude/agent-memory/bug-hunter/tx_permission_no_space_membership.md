---
name: tx-permission-no-space-membership
description: Transaction write permission model (2026-10-28 rewrite) — space owner/editor + money-out-owner; update reauthorizes BOTH legs on any money change (round-2 verified)
metadata:
  type: project
---

2026-10-28 rewrite (branch permissions/change-2026-10-28): `resolveTransactionPermission` takes `spaceId`, always calls resolveSpaceMembership(owner/editor); money-out legs need user_accounts owner; money-in legs need owned-by-caller OR space_accounts(dest, spaceId). No creator bypass in update/delete.

Round-1 holes (editor resizing/redirecting teammate money) FIXED in round 2: update.mts `reauthorize = sourceChanged||destinationChanged||amountChanged||desiredFee!==null` → both legs re-checked; income money changes need old-dest owner OR created_by.

Remaining non-owner balance changes via update are all "delete-like" (credit-reducing / debit-undoing): clearFee, moving a teammate's expense/transfer onto an owned source, income creator retarget. None increases a debit out of a non-owned account.

Open: account.removeMember doesn't enforce "at least one owner"; space leave/removeMember don't clean space_accounts.

**How to apply:** for any new tx update field, ask whether it moves money; if so it must join `reauthorize`. Related: [[resolve-space-membership]], [[transfer-fee-row-follows-parent]].

Round 3 (2026-10-28): adjustment creator-bypass in update.mts anchored gate is dead — resolveTransactionPermission still requireOwner's the adjustment account on reauthorize, so client `moneyLocked` (creator => unlocked) mismatches. cents() uses JS Math.round(x*100) but numeric(12,2) rounds half-away (12.345 -> 1234 vs PG 12.35): 1-cent-per-call bypass of reauth. Client moneyLocked is false until account.listBySpace loads, and the submit always echoes amount/accounts.
