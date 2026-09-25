---
name: icon-picker-review-2026-09-23
description: Four review rounds on the ~610-Lucide + full-emoji IconPicker (branch feat/more-icons) — what is settled and must not be reopened, the one ranking mechanism that caused the same defect in four different disguises, and what shipped unfixed.
metadata:
  type: project
---

Reviewed the icon-picker expansion (curated Lucide 216 → ~610 keys in 14 categories + ~1.9k Unicode emoji, tag search with a budgeting-synonym table) four times; signed off at round 4. IA verdict unchanged across all four: two tabs + scroll-spy strip + per-tab Recent + tone dots is the right shape; nothing redundant.

**The load-bearing defect class is search *semantics*, not vocabulary.** It reappeared in a new disguise every round, and rounds 2–4 were all the *same* mechanism:

- R1: every term had to match → "Emergency fund" / "School fees" returned nothing. Fixed by the partial fallback.
- R2: the fallback ranked by `matched` then `score`, so a generic money word tied with the topical word → "School fees" → `landmark`. Fixed by `GENERIC_TERMS` ×0.4 + a full-match gate.
- R3: the ×0.4 lost to **short prefix accidents** ("AC bill" → activity; "Car loan" → only credit-card). Fixed by a ≥3-char guard on prefix tiers + an exact-level full-match gate + a partial tail.
- R4: **the ×0.4 weight is applied to `score` but not to `strong`/`exact`, and `strong` is the primary sort key.** So any generic term with a tag-exact (≥1.5) hit promotes the wrong icon above the topical answer. Repro "Car payment" → `wallet-cards, credit-card, car`. Shipped unfixed; the two-token fix is `best * weight >= STRONG_MATCH` plus `GENERIC_WEIGHT = 0.5` (A/B'd over 215 names × 2 tabs: 25 top-3 lists change, ~20 improve — `receipt`/🧾 takes the #3 slot on every "X bill/fee" name instead of junk).

**Generalisable rule** (worth carrying to any ranked list in Orbit): when a relevance weight exists, apply it to *every* quantity the sort touches, not just the headline score. A down-weight that only reaches the tie-breaker is not a down-weight.

**Verdicts settled — do not reopen:**
- `defaultValue` = *the icon the form opened with* (saved icon when editing, type default when creating). All six hosts verified at R3 and again at R4; the four DB column defaults (migration 022) match.
- The button is **Revert**, not Reset; it calls the `onChange` prop, so it does not enter Recent *and* it closes the popover (both hosts' handlers close).
- Two host shapes are correct, not an inconsistency: `IconPickerButton` for tight Style rows; `EntityStyleFields` preview row for roomy settings forms.
- Close-on-select in both popover hosts (ColorPicker deliberately stays open — comparing swatches is a different job).
- "No icon" stays unreachable; skin tones only in "People & Body"; no labelled active chip in the strip.
- The one-edit typo tier is safe — across ~300 probed names it never put a wrong item first. Its visible cost is harmless #3s (🩰 "ballet shoes" for "Wallet").

**Rules that keep being needed when editing `SYNONYMS`:**
1. A *primary* synonym scores 3.5 and silently demotes a literal Lucide key whose own label is that word.
2. Never put a junk-drawer icon on a topical line. `landmark` still sits on 6 lines (hajj, mosque, tax, bank, account, pension) — the last remaining magnet, currently harmless.
3. Re-test with two- and three-word real entity names and possessives, not single words. A throwaway probe under `apps/web/scripts/` run with `./node_modules/.bin/tsx --tsconfig tsconfig.app.json` is the way; delete it after.

**Shipped with these known residuals (all vocabulary, none architectural):**
- "Current bill" → 🏦 landmark. In Dhaka "current bill" means the electricity bill; "current" is on the account line for "current account". Dropping the term `current` from that line is safe (the line still matches via `account`) and hands the query to `plug`/`receipt`.
- "Air ticket" never shows `plane` in Icons (the travel line has "flight", not "air"/"airfare"). "Shoes"/"Sandals" have no line, so 🩰 ballet shoes leads "Shoes". "Overtime" and place names ("Dhaka to Sylhet") return nothing.
- Compound-noun collisions on the emoji side: "Water bill" → 💧, 🐃 (water buffalo); "Flat rent" → 🥿 (flat shoe). Cosmetic, #2–#3 only.

**English-only empty state** (recommended at R4, previously deferred): a Bangla / `৳` / `$` / `%` query tokenizes to nothing and shows "Nothing matches …", which reads as *the catalog has no such icon* — false, and it stops a Bangladeshi user from retrying in English. Copy settled: "Search works in English — try “rent” or “groceries”." Condition: `searching && !isEmojiIcon(q) && tokenize(q).length === 0`, checked *before* the "Loading emoji…" branch (no dataset will ever make a Bangla query match).

Related: [[semantic_color_tokens_are_load_bearing]], [[shared_component_vs_page_native_boundary]].
