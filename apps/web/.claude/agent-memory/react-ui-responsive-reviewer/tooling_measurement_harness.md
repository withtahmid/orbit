---
name: tooling-measurement-harness
description: A headless Chromium IS available — how to build a real pixel-measurement harness for this app instead of estimating text widths and flex math by hand
metadata:
  type: reference
---

**Chromium is installed and drivable.** Binary: `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` (the `playwright` npm package is NOT installed — drive CDP directly). Node 24 has a global `WebSocket`, so a ~60-line CDP client is enough: `Target.createTarget` → `Target.attachToTarget {flatten:true}` → `Page.enable`/`Runtime.enable` → `Emulation.setDeviceMetricsOverride` per width → `Runtime.evaluate {returnByValue:true}` → `Page.captureScreenshot {captureBeyondViewport:true}`. `google-chrome` is also on PATH.

**Why:** every prior round of this review estimated `Inter` advance widths by hand to guess whether a label wraps. That was both wrong (the app's font is **Geist**, not Inter — `.orbit-design` sets `font-family:"Geist"; font-size:14px; line-height:1.5; letter-spacing:-0.005em`, and `SpaceLayout`'s root carries `.orbit-design`, so every page under `/s/*` is Geist/14/1.5) and unnecessary. Measured numbers turn "this might wrap" into "the header is 65.58px of un-shrinkable min-content and the page scrolls 180px at 768".

**How to apply — recipe that works:**
1. `npx vite build --outDir <scratch>/wbuild` in `apps/web` (~3s, no `tsc`) to get the real CSS bundle. If you need Tailwind classes the app doesn't use yet (to test a *proposed* fix), instead run `npx @tailwindcss/cli@4.2.2 -i in.css -o out.css` where `in.css` is `@import "<abs>/src/index.css"; @source "<abs>/harness.html";` — the `--content` flag is a no-op in v4, `@source` is the working mechanism.
2. **`.sl-main` / `.sl-aside` are NOT in the CSS bundle** — they live in the `SL_STYLES` template literal in `src/layouts/SpaceLayout.tsx` (currently lines 457–737) and are injected as a runtime `<style>`. `sed -n '458,736p'` them into the harness or every width measurement is wrong.
3. Reproduce the DOM by hand (transcribe class strings verbatim) inside `.orbit-design.sl-shell > aside.sl-aside + .sl-main-col > main.sl-main > <the page's layout root>`. Hand-transcription is fine and much cheaper than booting the app with auth + a real DB.
4. Load fonts from the same Google Fonts `<link>` as `index.html` (network works) with `&display=block`, and sleep ~2.5s before the first measurement or you measure fallback metrics.
5. Probe `document.documentElement.scrollWidth` vs `clientWidth` for page-level horizontal overflow, plus `getBoundingClientRect()` on every column in both a header row and a data row to prove alignment. **Also screenshot and actually look at it** — a metric like `new Set([a.y,b.y,c.y]).size` miscounts flex lines because `items-center` offsets boxes of different heights by ~1px.

**Corollary worth remembering:** `AnalyticsDetailLayout`'s root is `grid gap-5 sm:gap-6`, and a default grid column is `minmax(auto,1fr)` — its **min** track size is the item's min-content. So an over-wide card inside it does not clip or shrink; it *widens the grid track* and pushes `document.scrollWidth` past the viewport. Rigid content in any analytics card therefore becomes page-level horizontal scroll, never an internal overflow.
