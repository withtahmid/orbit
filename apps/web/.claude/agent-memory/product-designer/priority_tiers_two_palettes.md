---
name: priority-tiers-two-palettes
description: Category priority tiers are coloured by two unrelated palettes (CategoriesPage semantic tokens vs server hardcoded hex) that invert each other's valence; plus the Must/Want framing and the unclassified stance.
metadata:
  type: project
---

The four category priority tiers (`essential`/`important`/`discretionary`/`luxury`,
`+ unclassified` on read) are the app's only "must-spend vs want-spend" axis, and
as of 2026-08-01 **two independent colour definitions exist and they disagree on
every tier**:

- `apps/web/src/pages/space/categories/CategoriesPage.tsx` `PRIORITIES`:
  essential=`--income` (green), important=`--ent-2` (cyan), discretionary=`--gold`
  (amber), luxury=`--expense` (red). Reads as a safe→alarm ramp.
- `apps/server/src/procedures/analytics/priorityBreakdown.mts` `TIER_COLOR`:
  essential=`#dc2626` (RED), important=`#f59e0b`, discretionary=`#3b82f6` (blue),
  luxury=`#a855f7` (purple), unclassified=`#64748b`. Hardcoded hex, ships in the
  payload, rendered verbatim by `PriorityView.tsx` (donut slices, tier bars,
  envelope-by-tier dots).

**Why it matters:** Essential is green where you tag it and red where you read it.
Also both palettes borrow meaning they shouldn't — `--expense` red on Luxury
moralises spend, which contradicts the budgeting stance ("overspend is shown,
never blocked or nagged", `procedures/analytics/CLAUDE.md`). See
[[semantic-color-tokens-are-load-bearing]].

**How to apply:** tier label + letter + colour is a cross-page invariant, so it
belongs in ONE web module (recommended `apps/web/src/lib/priority.ts`, five keys
incl. `unclassified`), consumed by both surfaces; the server should stop dictating
colour. Prefer the non-semantic `--ent-1..4` hue sweep + `--fg-4` over
`--income`/`--expense`. Per [[shared-component-vs-page-native-boundary]].

**Framing facts to stay coherent with:**
- The downstream rollup is 2+2: `PriorityView` KPIs are "Must-spend"
  (Essential+Important) vs "Want-spend" (Discretionary+Luxury), plus
  "Categorized total — % of expenses are tagged". So untiered spend is framed as
  *residue to minimise*, i.e. there IS a coverage goal.
- Owner asked (2026-08-01) to **remove the per-tier taglines** "Must-spend /
  Should-spend / Want-spend / Splurge" from the Categories picker. Don't
  reintroduce per-tier glosses; the tiers are label+letter only there.
- Tier definitions for users live in DocsPage's **Envelopes** section
  (`function Envelopes()`, four `InfoCard`s), not its Categories section — wrong
  home for a category feature, and `PriorityView.TIER_DESCRIPTION` contradicts it
  (docs put groceries under Essential, PriorityView under Important).
- Three names for the unset state: "None" (picker), "No priority" (band/legend),
  "Unclassified" (analytics + spec). Same class as
  [[free-pool-term-fragmentation]].
