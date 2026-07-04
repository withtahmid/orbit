---
name: account-distribution-relocation
description: Account distribution donut moved from analytics catalog onto the /accounts page hero; what the accounts page now owns vs what analytics dropped
metadata:
  type: project
---

The "Account distribution" analytics view (route `analytics/accounts`, tile, and `AccountsView.tsx`) was removed from the analytics catalog and its donut relocated onto the `/accounts` page hero (left = net worth + assets/locked/liabilities stats; right = distribution donut over positive-balance asset+locked accounts, top 8 + Other). Account cards below, grouped by owner, act as the legend.

**Why:** Account distribution is a point-in-time snapshot, not period-filterable like the other nine analytics views (DocsPage advertises analytics as "all period-filterable"). It belonged on /accounts. This is a coherence win, not scope creep.

**How to apply:**
- Analytics catalog now has NINE views, not ten. If reviewing docs/copy that says "Ten dedicated analytics views" or lists an "Accounts" analytics view, that is stale (DocsPage.tsx ~line 826 + Accounts bullet).
- Server procedures `analytics.accountDistribution` + `personal.accountDistribution` twin still exist and still feed OverviewPage's mini-donut — deleting them would break Overview. Only the web *view* was removed.
- The /accounts page derives donut + hero totals + cards from ONE `accounts` array (in `/s/me` it's `account.listByUser` filtered to `myRole==="owner"`). Keep it single-source; the old view drifted by mixing the personal twin with listByUser.
- Capability the move dropped: role-based grouping (separate Asset/Liability/Locked cards) and persistent per-account %-of-total rows (now hover-only on the donut). Hero stats preserve the net-worth math; the loss is acceptable, but the per-card type chip now carries the debt-vs-savings concept alone.

**Round-2 redesign (feat/accounts, reviewed 2026-07-04):** summary card is now 3-col — left = "Net worth" headline (with sublabel "assets + locked − liabilities") + three StatRows (Assets/Locked/Liabilities, dot+count+colored value; Liabilities shown SIGNED as net-worth effect, minus-in-red); center = donut, center label "Holdings"; right = "Where it sits" legend (top-8 + Other, value + %, rows link). Per-account %-parity restored via legend + card foot "% of holdings". Docs fixed (DocsPage "Nine views" + grouped-by-owner; analytics.md note). Round-1 stale-docs finding is now RESOLVED.

**Durable design watch-items on this card:**
- Two prominent totals diverge: "Net worth" (after debt) vs donut-center "Holdings" (gross positive asset+locked). Whenever liabilities>0 they differ with no stated tie — the top coherence tension. In the all-positive case Holdings == Assets+Locked StatRows exactly (mild redundancy); with an overdrawn asset the donut drops the negative while the Assets StatRow nets it in, so donut center silently disagrees with the rows that appear to define it.
- No color bridge: StatRow dots are semantic type colors (income/gold/expense); donut+legend dots are per-account brand colors — same `.ac-legend-dot` element, two meanings.
- Bug: Assets/Locked StatRow valueColor is hardcoded green/gold regardless of sign; a net-negative (all-overdrawn) Assets/Locked total renders as a green/gold "−N". Only the Liabilities row switches color by sign.
- Personal /s/me: owner-grouping is always a single "NAME (YOU)" group, doubling the "these are all yours" message already in the subheader. Candidate to suppress the group header in personal.
