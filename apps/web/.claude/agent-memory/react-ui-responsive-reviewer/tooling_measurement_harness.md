---
name: tooling-measurement-harness
description: A headless Chromium IS available — how to build a real pixel-measurement harness for this app instead of estimating text widths and flex math by hand, including the two gotchas (hover media emulation, scrollbar gutter)
metadata:
  type: reference
---

**Chromium is installed and drivable.** Binary: `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` (the `playwright` npm package is NOT installed — drive CDP directly). Node 24 has a global `WebSocket`, so a ~40-line CDP client is enough: `Target.createTarget` → `Target.attachToTarget {flatten:true}` → `Page.enable`/`Runtime.enable` → `Emulation.setDeviceMetricsOverride` per width → `Runtime.evaluate {returnByValue:true, awaitPromise:true}` → `Page.captureScreenshot {clip:{...,scale}}`. `google-chrome` is also on PATH.

**Why:** every prior round of this review estimated `Inter` advance widths by hand to guess whether a label wraps. That was both wrong (the app's font is **Geist**, not Inter — `.orbit-design` sets `font-family:"Geist"; font-size:14px; line-height:1.5; letter-spacing:-0.005em`) and unnecessary. Measured numbers turn "this might wrap" into "the key track is 24.03px, 0.03px over the WCAG floor".

**How to apply — recipe that works:**
1. Most of this app's CSS is NOT in the Vite bundle. It lives in template literals injected as runtime `<style>`: `SL_STYLES` (SpaceLayout), `ORBIT_FORM_STYLES` (OrbitForm), `OMS_STYLES` (OrbitModalShell), `NT_STYLES` + `PIN_CONTROL_STYLES` (NewTransactionSheet/PinControl), `TDP_STYLES` (TransactionDatePicker). `grep -n 'STYLES = \`\|^\`;'` to find the ranges, `sed -n 'a,bp'` them, and concatenate onto `src/styles/orbit-design.css`. Verify with `grep -c '\${'` — 0 means no interpolation to resolve. **Re-extract after every edit**; line ranges move.
2. Reproduce the DOM by hand (transcribe class strings verbatim). Hand-transcription is far cheaper than booting the app with auth + a real DB.
3. Load fonts from the same Google Fonts `<link>` as `index.html` with `&display=block`, and `await document.fonts.ready` before measuring.
4. **`Emulation.setEmulatedMedia` features `hover`/`pointer` DO NOT WORK** (Chrome stays on whatever the device metrics imply, and `mobile:true` without a viewport meta re-lays-out at 980px). Instead preprocess the CSS twice: `sed 's/(hover: none)/(min-width: 999999px)/g; s/(hover: hover)/(min-width: 0px)/g'` for the pointer variant and the inverse for touch. Then always use `mobile:false`.
5. **Include the scrollbar gutter.** `index.css` declares `::-webkit-scrollbar{width:10px}`, which opts Chromium out of overlay scrollbars, so real scrolling containers (`.ods-body`, `.sl-main`) are 10px narrower than headless-default measurements. Force it: add that rule to the harness plus `overflow-y: scroll` on the scroller, and assert `offsetWidth - clientWidth === 10`.
6. To resolve `oklch()` / `color-mix()` tokens to sRGB for contrast math, **rasterise through a 1×1 canvas** (`ctx.fillStyle = getComputedStyle(probe).color; getImageData`) — `getComputedStyle` returns the `oklch()` string unconverted, so any regex on it silently yields garbage. Paint the backdrop first when the colour has alpha.
7. Probe `document.documentElement.scrollWidth` vs `clientWidth` for page-level overflow, and `child.right - container.right` for per-element overflow (that is how the `.of-amount-key-eq` margin bug was caught). **Also screenshot and look at it** — `{clip:{x,y,width,height,scale:3}}` gives a readable crop.

**Corollary worth remembering:** `AnalyticsDetailLayout`'s root is `grid gap-5 sm:gap-6`, and a default grid column is `minmax(auto,1fr)` — its **min** track size is the item's min-content. So an over-wide card inside it does not clip or shrink; it *widens the grid track* and pushes `document.scrollWidth` past the viewport.
