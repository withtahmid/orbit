---
name: transaction-write-permission-model
description: 2026-10-28 transaction write rules (space owner/editor gate, money-out=owned, money-in=owned-or-in-space, no creator bypass) and the /s/me edit regression it caused
metadata:
  type: project
---
Implemented on branch permissions/change-2026-10-28: every txn write needs current owner/editor of the recording space; no creator bypass; source/adjust = owned; destination = owned OR shared into recording space; update re-checks only changed legs; fee needs source in space.

**Why:** user asked only "transfer TO any account in the same space"; the space-role gate + creator-bypass removal were scope added by the earlier design rec.

**How to apply:** watch for the /s/me fallout — the virtual space is forced `myRole: viewer`, so any `useCanEdit()` gate hides row edit on /s/me; per-row edit there must use the row's real `space_id` role. Account-ACL `viewer` rows no longer confer any transaction right. See [[account-balance-sign-convention]].

**Round 3 (2026-10-28):** update gained "metadata shared, money owned" + an income/adjustment anchor gate with a creator exception. The creator exception is dead for adjustments (re-auth still requires owning the adjustment account), so copy saying "or whoever recorded it" is only true for income. "No creator bypass" = space-role check only.
