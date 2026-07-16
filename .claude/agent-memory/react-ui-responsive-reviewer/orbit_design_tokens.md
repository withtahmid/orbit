---
name: orbit-design-tokens
description: orbit-design.css is dark-only; fg-token contrast ratios vs bg surfaces for WCAG checks
type: reference
---

`apps/web/src/styles/orbit-design.css` defines the `.orbit-design` surface. It is **dark-only** — there is no light theme, no `prefers-color-scheme`, no `data-theme`. Do not ask for/flag light-theme handling on orbit-design pages.

Key tokens (oklch L): bg 14.5%, bg-elev-1 17%, bg-elev-2 20%; fg 96%, fg-2 80%, fg-3 62%, fg-4 48%; brand oklch(72% .14 165), brand-soft = brand @12%.

Approx WCAG contrast ratios (treating oklch L ≈ CIE L*):
- fg-3 on bg ≈ 5.2 (passes AA 4.5). fg-3 on bg-elev-1 ≈ 4.85 (passes). fg-3 on bg-elev-2 ≈ 4.43 (JUST under 4.5 — matters for hover/active legend rows and tooltips).
- fg-4 on bg ≈ 3.2 — FAILS AA for normal text; only OK for icons/decorative graphics (3:1) or large text. fg-4 on bg-elev-2 ≈ 2.7 (fails).

**Recurring issue:** meaningful caption text keeps getting shipped at `--fg-4` (empty-state helper lines, chart axis labels, file sizes, tooltip sub-values). It should be `--fg-3`. Decorative icons at fg-4 are fine.

Focus rings on orbit-design: 2-layer `box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--brand)` (4px total). `.od-card` has NO overflow:hidden so rings aren't clipped; `.ev-hero`/`.ev-stat` DO set overflow:hidden but their focusable children sit inside ≥16px padding so the 4px ring survives.

**Cross-scope charts are safe, but only because the whole app is dark-only.** `index.css` defines shadcn tokens under a single `:root, .dark { … }` block (no separate light values), so `--muted-foreground`/`--popover`/`--border`/`--card` are dark values everywhere. orbit-design does NOT redefine those shadcn names. Shared charts that use Tailwind `text-muted-foreground` / `bg-popover` / `var(--border)` (`Donut`, `DrillableDonut`, `MultiSeriesLineChart`) therefore render legibly whether inside `.orbit-design` (OverviewPage DonutCard) or in a shadcn Card. This is a *latent* trap: if a real light theme is ever added, those charts inside orbit-design's hardcoded near-black surface would flip to light-mode grays. Flag only as future risk, not a live bug.

Envelope/category `color` fields are hex (`#22c55e`, from server/seed + palette in `entityStyle.ts`), NOT `var(--ent-*)` tokens — so they resolve identically in any scope. Chart slice/avatar colors do not break outside orbit-design.
