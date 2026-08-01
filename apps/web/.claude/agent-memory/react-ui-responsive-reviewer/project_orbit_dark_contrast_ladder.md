---
name: orbit-dark-contrast-ladder
description: Measured WCAG ratios for every .orbit-design token pair (dark-only) — which fg tokens pass 4.5:1 on which surface, and why background tints can never carry a UI state in this palette
metadata:
  type: project
---

`apps/web/src/styles/orbit-design.css` is **dark-only**, all tokens in `oklch()`. Computing contrast by eye is impossible; the numbers below were produced by an oklch→sRGB→WCAG script (oklab `color-mix` with `transparent` = premultiplied alpha, i.e. `color-mix(in oklab, X 16%, transparent)` is just X at α=0.16).

**Surface ladder (hex, sRGB):** `--bg` #0a0d0c · `--bg-elev-1` #0d100f · `--bg-elev-2` #131716 · `--bg-elev-3` #1b211f. `.ct-group`-style `color-mix(bg-elev-2 70%, transparent)` over elev-1 = #111514.

**Foreground on surfaces (ratio):**

| | elev-1 | elev-2 | elev-3 | card #111514 |
|---|---|---|---|---|
| `--fg-2` | 10.25 | 9.70 | 8.80 | 9.87 |
| `--fg-3` | 5.27 | 4.98 | 4.52 | 5.07 |
| `--fg-4` | **2.93** | **2.78** | **2.52** | **2.83** |

→ **`--fg-4` fails 4.5:1 on every surface in the system.** It is legal only for decorative glyphs (chevrons, grips, separators) that repeat information available elsewhere. `--fg-3` is the floor for real text. This regresses repeatedly — check every new `color: var(--fg-4)` on a text node.

**Background tints cannot signal state here.** Adjacent surface steps are 1.06–1.20:1 (elev-2 on elev-1 = 1.06, elev-3 on elev-1 = 1.16) and hairlines are 1.14 (`--line` on elev-1) / 1.47–1.54 (`--line-strong`). A `color-mix(… 12%, transparent)` tint over elev-2 lands at 1.17–1.27:1; even 30% only reaches 1.63. **A selected/active/pressed state must be carried by a border at ≥55–70% mix, a text-colour jump (fg-3→fg = 5.0→13.1), or an explicit glyph (check/dot) — never by the fill alone.** `--shadow-1` is a *dark* drop shadow and adds nothing on dark surfaces.

**Border mix % needed for 3:1 (non-text contrast) over the #111514 card / elev-2:**
`--gold` 55% · `--income` 60% · `--ent-2` 62% · `--expense` (worst, chroma-heavy red) 70%. `--brand` at 55% over elev-3 = 3.57:1 vs an elev-1 track. Rule of thumb: **65% is the safe floor for any tier-coloured 1px border, 80% if it must read as a dash pattern on a ≤18px box.**

**Tier colours as text on their own 16% fill** (badge pattern) all pass comfortably: `--gold` 7.4–8.0, `--income` 6.2–6.7, `--ent-2` 6.0–6.5, `--expense` 5.0–5.4 (4.52 on elev-3 hover — the worst case in the palette, still passing). `color-mix(in oklab, <tier> 70%, var(--fg-4))` (the "inherited/dimmed" idiom) also passes: 4.53–7.63, again `--expense` worst.

Script lives nowhere permanent — rebuild it in the scratchpad when needed (~60 lines: oklch→oklab→linear sRGB→gamma→relative luminance). See [[tooling-measurement-harness]] for pixel measurement.
