---
name: vignette-layering
description: The .vignette design-system primitive paints a gradient ::before that requires children to be lifted above it
type: reference
---

`.orbit-design .vignette` (src/styles/orbit-design.css ~L188) sets `position: relative; isolation: isolate` and a `::before` overlay with `inset:0; pointer-events:none; z-index:0` (a two-radial brand/gold gradient).

Because the `::before` is a *positioned* element with explicit `z-index:0`, it paints ABOVE any non-positioned normal-flow content of the card. So every direct content block inside a `.vignette` card must set `position: relative; z-index: 1` or it renders behind the gradient wash (text looks muddy/tinted).

How to apply: when reviewing any card that has the `vignette` class, verify each content wrapper carries `position:relative; z-index:1`. In AccountsPage `.ac-summary`, both `.ac-ledger` and `.ac-sum-bar` do this correctly. Other consumers: AuthShell `.oa-editorial`, DocsPage `.od-closing`.
