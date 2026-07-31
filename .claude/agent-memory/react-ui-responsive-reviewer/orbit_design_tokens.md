---
name: orbit-design-tokens
description: orbit-design.css is dark-only; fg-token contrast ratios vs bg surfaces for WCAG checks
type: reference
---

`apps/web/src/styles/orbit-design.css` defines the `.orbit-design` surface. It is **dark-only** — there is no light theme, no `prefers-color-scheme`, no `data-theme`. Do not ask for/flag light-theme handling on orbit-design pages.

Key tokens (oklch L): bg 14.5%, bg-elev-1 17%, bg-elev-2 20%; fg 96%, fg-2 80%, fg-3 62%, fg-4 48%; brand oklch(72% .14 165), brand-soft = brand @12%.

Measured WCAG contrast ratios (oklch→sRGB→relative luminance; sRGB values
bg `#080b0a`, e1 `#0d100f`, e2 `#131716`, fg `#eef3f2`, fg-2 `#babfbe`, fg-3 `#818886`, fg-4 `#595f5e`):
- fg-3: 5.40 on bg, **5.27 on bg-elev-1, 4.98 on bg-elev-2** — passes AA on all three, hover included.
- fg-2: 10.25 on bg-elev-1, 9.70 on bg-elev-2. fg: ~13+ everywhere.
- fg-4: 3.00 on bg, **2.93 on bg-elev-1, 2.78 on bg-elev-2** — FAILS AA for normal text; icons/decorative only, and it misses even 3:1 on elevated surfaces.

**`opacity` on a row/card silently voids these numbers.** Group opacity composites text AND
background against the parent, so contrast drops steeply: at `opacity: 0.72` over bg-elev-1,
fg-3 → **3.28** (fails), fg-2 → 5.75 (ok), fg → 9.05 (ok), fg-4 → 2.08. At `0.55`: fg-3 → 2.40,
fg-2 → 3.82, fg → 5.68. So a dimmed-but-still-interactive state (in-flight save, "syncing") may
not use `opacity` on anything carrying fg-3/fg-4 text — WCAG's inactive-control exemption only
covers genuinely disabled UI. Hover feedback also nearly vanishes: bg-elev-2 vs bg-elev-1 is only
1.06:1 at full opacity and 1.04:1 at 0.72. A `var(--brand)` focus ring survives (8.20 → 4.72).

**Recurring issue:** meaningful caption text keeps getting shipped at `--fg-4` (empty-state helper lines, chart axis labels, file sizes, tooltip sub-values). It should be `--fg-3`. Decorative icons at fg-4 are fine.

Focus rings on orbit-design: 2-layer `box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--brand)` (4px total). `.od-card` has NO overflow:hidden so rings aren't clipped; `.ev-hero`/`.ev-stat` DO set overflow:hidden but their focusable children sit inside ≥16px padding so the 4px ring survives.

**Cross-scope charts are safe, but only because the whole app is dark-only.** `index.css` defines shadcn tokens under a single `:root, .dark { … }` block (no separate light values), so `--muted-foreground`/`--popover`/`--border`/`--card` are dark values everywhere. orbit-design does NOT redefine those shadcn names. Shared charts that use Tailwind `text-muted-foreground` / `bg-popover` / `var(--border)` (`Donut`, `DrillableDonut`, `MultiSeriesLineChart`) therefore render legibly whether inside `.orbit-design` (OverviewPage DonutCard) or in a shadcn Card. This is a *latent* trap: if a real light theme is ever added, those charts inside orbit-design's hardcoded near-black surface would flip to light-mode grays. Flag only as future risk, not a live bug.

Envelope/category `color` fields are hex (`#22c55e`, from server/seed + palette in `entityStyle.ts`), NOT `var(--ent-*)` tokens — so they resolve identically in any scope. Chart slice/avatar colors do not break outside orbit-design.
