---
name: icon-registry-emoji-invariants
description: Verified invariants + recurring failure classes for the entityIcons/emoji/iconSearch/IconPicker stack (feat/more-icons, re-verified round 4 on 2026-09-23)
metadata:
  type: project
---

`icon` is `varchar(48)` (`z.string().min(1).max(48)`, **no whitelist on the server** — all 8 create/update procedures) holding EITHER a curated Lucide key OR a raw emoji. In `types.mts` all four entity tables have `icon: Generated<string>` — **NOT NULL with a default**, so `node.icon || "folder"`-style defensiveness is dead code and `icons.md`'s "the nullable column is legacy tolerance" is stale.

**Verified (rounds 3–4, 2026-09-23 — re-verify only if the registry/generator/search changes):**
- Registry = 609 pickable + 2 legacy = 611. 0 keys in two categories; 0 duplicate keys inside a single category literal (the generator's `categorised + legacy === registrySize` check **cannot** catch that — `Object.keys` dedupes both sides; grep the source text instead).
- **0 visually identical icon pairs among the 609** — proven by `renderToStaticMarkup` on every icon and deduping the SVG body. Only `house`≡`home` and `tram`≡`train` share a component, both legacy/unpickable.
- All 14 category strip icons + all 9 emoji-group strip icons resolve; `sticker` (the group fallback) resolves. Tags cover all 609.
- `ENTITY_ICONS` has a **null prototype**; `canonicalIconName` uses `hasOwnProperty.call`. `ENTITY_ICON_NAMES` was removed in round 3 — 0 references remain repo-wide (incl. the generator and `contexts/`).
- `emoji.generated.json`: 1914 entries, 9 groups, 0 `emojiKey` collisions; longest sequence 14 UTF-16 units.
- `withinOneEdit` is **exhaustively equivalent to Damerau–Levenshtein ≤ 1**.
- **Roving-tabindex invariant holds** for the grid cells (~100 simulated configs → exactly one `tabIndex=0`).
- `focusOnOpen(selector)` is safe: Radix FocusScope dispatches `AUTOFOCUS_ON_MOUNT` **on** the content node, so `event.currentTarget` is the popover content; `useCallbackRef` stabilises the handler.
- `portal={false}` popover inside an `overflow-y-auto` inner wrapper is fine (fixed popper, containing block = the transformed `DialogContent`).
- Round-4 sweep of round-3's fixes: `tsc -b`, `eslint`, `vite build` all clean; `searchIcons` results are duplicate-free, deterministic, and `limit`-respecting (`slice(0,n)` of the unlimited run is identical) on every query tried.

**Fixed in round 3 — was a recorded failure class, now verified good:**
- `@container` self-styling: `.op-icon-shell` (height + `container-type: size`) now wraps `.op-icon-picker` (`height:100%`), so the `max-height: 340px/260px` tiers reach the panel. `overflow:hidden`/radius/border stay on the panel; `.orbit-design` moved to the shell and tokens still inherit. `container-type: size` adds no paint containment, so nothing new clips.
- Strip double-Tab-stop: `stripFocusKey` state + `stripTabStop = sections.some(...) ? stripFocusKey : currentSection` guards a stale key; reset on tab/search change.
- Two "Skin tone" radiogroups: Recent no longer renders `SkinToneDots` (`s.key !== "recent"`).
- `nativeEvent.isComposing` guard on the search box's Enter.
- Emoji-fetch failure now surfaces in all three views (empty search, results-with-icon-hits note, browse tab) and the Emoji tab count shows `—`; `retry` clears `failed` and `loadEmojiDataset` nulls `emojiPending` on rejection so a re-fetch really happens.
- **"Full-match pool deletes the right answer" is fixed** (`EXACT_MATCH = 2.5` now gates it, so a label *prefix* no longer qualifies): `"car loan"` 1→31 results, `"bus rent"` 1→10, `"tax fare"` 1→6.

**Recurring failure classes to check on any icon-picker change:**
- **A 3-letter prefix accident still LEADS the list** even though it no longer empties it: `strong` (the primary sort key, `>= STRONG_MATCH 1.5`) counts the label-prefix tier (2.0), so an item that prefix-matches one term and exactly matches the other outranks items that nail one term: `"car loan"` → `credit-card` before `car`/`hand-coins`; `"bus rent"` → `building-2`; `"tax fare"` → `car-taxi`. `iconSearch.ts`'s `EXACT_MATCH` comment and `icons.md` claim this case is prevented — it is not. Sweep short-word × money-word pairs after touching tiers or SYNONYMS.
- **The typo tier is a flat constant, so it inverts the curated primary.** `best = TYPO_SCORE (1.2)` regardless of whether the near-miss hit a primary synonym, an `other` synonym or the label; `byRank` then tie-breaks on `labelTokens.length`, then catalog order. Measured: `grocerries`→apple (vs `groceries`→shopping-cart), `sallary`→💼 (vs 💰), `resturant`→🍔 (vs 🍽️), `travle`→🏨 (vs ✈️), `entertianment`→🎟️ (vs 🎬). Any change to `fuzzyMatch`/`byRank` should be re-measured with the typo/correct pair.
- **Prototype-chain lookup.** Any NEW string→component/config map built as a plain object literal (`EMOJI_GROUP_ICONS`, `LUCIDE_TAG_ALIASES`, `DEFAULT_ICON_BY_TYPE`) is still prototype-poisonable; only `ENTITY_ICONS` was hardened.
- **Imperative `el.tabIndex = 0/-1` hand-off vs React** — still used for the grid *cells* (`onBodyKeyDown`); safe only because the grids are `memo`'d on stable props. Any new prop that changes per render re-renders a grid and can restore a second `tabIndex=0`.
- **`content-visibility: auto` without `contain-intrinsic-size` ⇒ 0-height section.** `GroupSection` sets the hint; the search-results sections are separate JSX (they omit `is-emoji`, so no `content-visibility` — fine).
- **Memo defeat via inline `onChange`.** `LucideGrid`/`EmojiGrid` depend on `pick`, `activeStyle`, `names`/`entries` being referentially stable.
- **`apps/web/scripts/` is outside both tsconfig projects and the eslint config** and is **untracked as a whole directory** — throwaway `__*.mts` review probes left there get committed alongside `generate-icon-data.mts`.

Verification recipe (no browser): throwaway probes under `apps/web/scripts/__*.mts` run with
`./node_modules/.bin/tsx --tsconfig tsconfig.app.json scripts/__probe.mts` — this resolves `@/*` and imports `entityIcons.ts` (and therefore lucide-react + EmojiGlyph) fine under Node, and `react-dom/server` is available for the SVG-dedupe alias check. `?url` imports in `lib/icons/load.ts` will NOT resolve under tsx; read the JSON with `fs` and call `parseEmojiDataset` directly. Delete the probes afterwards.
