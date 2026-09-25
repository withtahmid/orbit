---
name: icon-picker-search-ranking
description: Orbit icon-picker search scorer — four audit rounds; the gate fix is confirmed, the surviving issues are the flattened short-prefix guard and the primary-bonus vocabulary losers, plus how to re-audit it offline with tsx.
metadata:
  type: project
---

`apps/web/src/lib/iconSearch.ts` audited four times on branch `feat/more-icons`
(rounds 2, 3 and 4 all 2026-09-23). An independent re-derivation of the documented
tiers in `contexts/modules/web/icons.md` — written as a pure max with no early
returns — matched `searchIcons()` **exactly**: 5,418 searches in round 2, 9,686 in
round 3, **13,546 in round 4** (6,773 unique queries × 2 indexes). The tier table,
0.6 stem discount, whole-label +2, primary +2, GENERIC ×0.4, typo tier, stop-word
filter and the strong/score/labelLen/order sort are all faithful. The early
`return`s in `termScore` are provably max-equivalent (each tier's ceiling is below
the value that short-circuits it). **Don't re-derive the scorer a fifth time.**

**How to re-audit offline (no browser).** Throwaway `.mts` under `apps/web/scripts/`,
read `src/lib/icons/*.generated.json` with `node:fs` (the `?url` loaders in
`icons/load.ts` don't run under tsx), build indexes with `parseEmojiDataset` +
`buildLucideSearchIndex`/`buildEmojiSearchIndex`, then
`cd apps/web && ./node_modules/.bin/tsx --tsconfig tsconfig.app.json scripts/<f>.mts`.
~25 s for 10k searches over both indexes. Picker calls it with `limit = RESULT_LIMIT + 1 = 481`.

**CLOSED in round 4 — the gate collapse (rounds 2+3 Finding 1).** The fix landed as
`EXACT_MATCH = 2.5` gating `anyExactFull` while `STRONG_MATCH = 1.5` keeps driving
the sort (round 3 had proposed `GATE_MATCH = 2`; 2.5 is strictly better). Measured
on the same 1,517 two-term queries × 2: gated 140 → 41, and **0 gated queries hide
any item scoring ≥3.0**. All 41 single-result queries are *non-gated* and
legitimate (the whole index scored exactly one item). **Key fact worth keeping:
top-1 is identical for gate ∈ {1.5, 2.0, 2.5}** — the gate only controls how much
of the partial pool survives, never the head, because a full-strong item already
outranks every partial via `strong desc`. So the win is recall: "credit bill" LUC
n 7→74, "car money" 26→75, "house water" 18→27.

**CLOSED in round 4 — typo-tier doc drift.** Trigger is now `best === 0` (was
`best < TYPO_SCORE`). Over 8,850 searches only 11 rankings differ, 1 top-1, 2 top-3
(`EMO "round"`, `LUC "eight"` — both noise). 20/20 realistic misspellings still
resolve to the intended icon in the top 5.

**OPEN 1 (MEDIUM) — the short-prefix guard flattens three tiers into one.**
`prefixOk = term.length >= 3` sends label-prefix, primary-synonym-prefix and
other-synonym-prefix all to **1.2** for 1–2-letter terms, so those queries rank by
catalog order (Money category first) instead of by tier. Regressions vs pre-guard:
LUC `pa` [paintbrush,package,palette] → [banknote,handshake,zap]; `dr`
[droplets,droplet,drill] → [target,goal,droplets] ("dream"); `sm`
[smartphone,smile,…] → [smartphone,cigarette,…]; `go` [goal,target,…] →
[target,goal,…]; `ac` third slot activity → landmark ("account").
**Fix, measured safe:** grade instead of flatten — label prefix **1.4**, primary
prefix **1.3**, other prefix 1.2 (all still < STRONG_MATCH 1.5). Over 8,096
searches: 55 rankings differ, 13 top-1, **every one a 1–2-char query and every one
an improvement** ("p"→percent not wallet, "d"→droplets not vault, "st"→store not
bitcoin). Every documented requirement survives: "ac"→air-vent, "ac bill"→
air-vent/fan/receipt, "ac room"→air-vent first, "tv"→tv, "id card"→id-card.

**OPEN 2 (MEDIUM) — the primary +2 bonus beats whole-label +2, always.**
3.5+2 > 3.0+2, so a primary-synonym exact now always outranks an item whose whole
label is the query. icons.md line 34's parenthetical "single-token exact labels
still win via the whole-label bonus" is **false** — 10 measured cases. Eight are
fine or wanted (cricket→🏏 is the doc's own goal; power→zap, phone→smartphone,
cinema→🎬, wedding→💍, family→👨‍👩‍👧, mechanic→🔧, university→graduation-cap).
Two are real losses: **EMO "metro" → 🚆 hiding 🚇 (label literally "metro")** —
Dhaka Metro Rail is a live category name here — and EMO "child" → 👶 hiding 🧒.
Vocabulary fix per icons.md's own rule: split `metro` off `"train rail railway
metro"` into its own line, and consider splitting `child` off the baby line.

**OPEN 3 (LOW) — 3 of 8,096 gated searches put the tail above the last full match.**
The full/tail partition happens before `byRank`, so a weak full match precedes the
whole tail. LUC "bank fund": `landmark` 3.50/s1 sits below `banknote-arrow-down`
2.40/s1; LUC/EMO "bill charge" likewise (two `strong === 0` full matches above a
strong tail item). Never at position 1. Leave it — re-sorting the concatenation
would let partials interleave, which is what the gate exists to prevent.

**OPEN 4 (LOW, informational) — flags lead 241 of 676 two-letter emoji queries.**
Country flags carry their ISO code as a *tag*, and tag-exact is 1.5 (strong) while
label prefixes are guarded to 1.2. **Do not guard the tag-exact tier for short
terms:** EMO "tv" resolves only through 📺's tag `tv` (its label is "television"),
so the guard would break the doc's own requirement. Realistic queries
(ac/tv/gp/pc/id/bd) are unaffected because a curated synonym or label beats 1.5.

**Secondary: synonym magnets (unchanged).** `landmark` carries 27 distinct synonym
tokens across 8 lines, `hand-coins` 26, 🏦 24. Needs icons.md's "keep generic icons
off topical lines" applied to `landmark`/`hand-coins`; no threshold fixes it.

**Also known.** GENERIC words "monthly", "total", "payment", "expense" match **zero**
Lucide items, so "<topic> monthly" degenerates to a single-topic search (all 41
legitimate single-result queries come from this). Doc-vs-code drift from round 3
still open: "a guessed singular never outranks what was typed" is false — the +2
whole-label bonus is granted on stem-only matches (tickets→🎫, stars→⭐); every
measured case is what the user wanted, so reword the doc, don't discount the bonus.

**Verified clean, rounds 3–4 — don't re-check.**
- Tail semantics: 0 duplicate ids, 0 `limit` violations across limit ∈ {1,2,3,6,24,
  40,481}, 0 tail items with `strong === 0`, the `PARTIAL_TAIL = 24` cap never hit
  in the two-term census.
- STOP_WORDS: 7/7 equivalence pairs exact on both indexes ("eating out"≡"eating",
  "makeup and salon"≡"makeup salon", "out of pocket"≡"pocket", "a car loan"≡"car
  loan"). "out" alone still searches (n 13/17); "a b" now returns results via the
  empty-filter fallback (round 3's "returns nothing" note is stale); "of the" → 25.
- `withinOneEdit`: 0 mismatches vs full Damerau–Levenshtein over 810,000 pairs.
- Typo collateral: fuzzy hits always sit below every genuine hit (1.2, never strong).
- Possessives: `['’]s\b` skips "o'shea" and "boys'"; "cox's bazar trip" → cox|bazar|trip.
- `contain-intrinsic-size` estimate: worst |error| 0.50 px.
- Counts (round 4): registry 611 = 609 categories + 2 legacy aliases; LUC index 609
  = tag-file keys 609; 0 key in two categories; Money 47, Home & Bills 67, Food &
  Drink 51, Shopping 29, Transport 49, Health 32, Work & Study 57, Entertainment 57,
  Nature & Pets 46, People 28, Tech 52, Places 13, Objects 37, Symbols 44 = 609.
  `podcast`/`history` still tagless (upstream). Emoji 1,914 entries / 9 groups /
  EMO index 1,914. `ENTITY_ICON_NAMES`: 0 code references repo-wide.
- Canvas probe: `VISIBLE_ALPHA = 64 > CHANNEL_TOLERANCE = 60` closes the round-2 hole.

See also [[currency_display]] for the wider `feat/more-icons` branch context.
