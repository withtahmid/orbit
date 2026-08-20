---
name: calc-normalize-silent-wrong-number
description: calc.ts strips ,/space/_ before parsing; hasInvalidGrouping now guards evaluateExpression but completeExpression (blur repair) normalizes FIRST and bypasses the guard, so "1200 340" silently becomes 1200340 on blur.
metadata:
  type: project
---

`apps/web/src/lib/calc.ts` — the inline calculator behind `OrbitAmountCard`,
`OrbitCalcInput`, and the adjustment form's balance input.

**The load-bearing invariant:** `normalizeAmountInput()` unconditionally strips
`[,\s_]`, so two adjacent number literals fuse (`"1200 340"` → `1200340`,
`"1.234,56"` → `1.23`). `hasInvalidGrouping(raw)` is the only thing that makes
that safe — it must run on the **raw** string, before any stripping.

**Every entry point into the parser must pass through that guard.**
`evaluateExpression` does (it calls `hasInvalidGrouping(raw)` on its own
argument). `completeExpression` did **not** as of 2026-08-21: it does
`src = normalizeAmountInput(raw)` and then calls `evaluateExpression(src)` — by
then the separators are gone, the guard sees a clean literal, and the fused
number comes back as a "valid" repair that `useCalcField.onBlur` writes into the
field. Blur is the save gesture (footer Save button steals focus first), so this
is a 1000x wrong amount on the exact click that submits it.

**How to apply:** any new helper in `calc.ts` that pre-normalizes and then
re-enters the parser reintroduces the whole class. Grep for
`normalizeAmountInput` call sites and check each one either (a) passes the
original raw string to `evaluateExpression`, or (b) calls `hasInvalidGrouping`
itself first.

CORRECTED 2026-08-21: `completeExpression` now repairs the RAW folded string,
so the blur fuse is fixed. `VALID_NUMBER_RE` accepts ONLY comma grouping, so
space/underscore are no longer valid separators — `"100 200"` and `"1_000"` are
rejected, not fused. The older "residual by design" note here was wrong.

Verified-correct round-1 fixes, do not re-litigate:
- `roundTo2` via `Number((|n|*100).toPrecision(15))` — 8.165→8.17, 2.675→2.68,
  1.005→1.01, half-away-from-zero for negatives. The old `Number.EPSILON` nudge
  was a no-op for |n| >= 2.
- `isExpressionLike` exempts only a leading `+`/`-`, so `"(4"` reports as an
  expression and the incomplete-hint renders.
- `MAX_MAGNITUDE = 1e12` on the final result.
- Division by a zero operand returns null (no Infinity/NaN leak).

There is still no test file. Repro harness: `tsc calc.ts --target es2020
--module esnext --outDir out` in a scratch dir, then import from `out/calc.js`.

See [[amount-card-draft-emit-contract]].
