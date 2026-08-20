---
name: amount-expression-evaluator
description: lib/calc.ts amount arithmetic — round-4 re-proof after completeExpression became a RESOLVER; P1-P5 clean over 8.6M inputs. One open item: roundTo2's toPrecision(15) rescue is only sound below |value| 1e10, but MAX_MAGNITUDE allows 1e12.
metadata:
  type: project
---

`apps/web/src/lib/calc.ts` (branch `feat/calculator-and-date-pin`) makes money fields
expression fields: `useCalcField` keeps a local `draft` (what was typed) and emits
`String(evaluateExpression(draft).value)` upward, so every call site still sees a plain
numeric string.

**Why:** users were leaving the form to add up a receipt. The design decision that
matters for auditing: `type="number" min="0" step="0.01"` was removed from the input, so
the ONLY thing between a bad parse and the server is each form's JS guard
(`!(Number(amount) > 0)`, `!(feeNum > 0)`, `delta == null`). Re-check they survive any refactor.

**How to apply — round-4 results (2026-08-21). Re-proven after the contract change;
do not re-derive:**

- `completeExpression` no longer merely repairs a dangling tail, it RESOLVES: it returns
  `String(evaluateExpression(trimmedSrc).value)`, or `raw` unchanged when the input is a
  plain literal / has unclosed parens / does not evaluate. Re-proven against an
  independent shunting-yard + exact-BigInt-rational oracle over **8.6M inputs** (exhaustive
  13-char alphabet to length 6 = 5.2M, 510k random rich strings to length 1000, 1.9M
  structured money expressions + mutations, 900k realistic corpus): 0 failures on all of
  P1 fuse-never-resolves, P2 literal-never-rewritten, P3 always-resolves-when-valid,
  P4 idempotence, P5 output-re-evaluates-to-itself.
- **Idempotence (P4) is structural, not incidental** — and `useCalcField.onKeyDown`'s
  second-Enter-submits path depends on it. Every non-`raw` return is `String(k/100)`,
  which matches `/^-?\d+(\.\d+)?$/`; such a string is never expression-like and has no
  dangling tail, so rule 1 returns it untouched. Verified on **825,860 distinct reachable
  outputs**: 0 non-fixed-points. `String()` can never go exponential here because
  MAX_MAGNITUDE caps at 1e12 and roundTo2 floors at 0.01. Longest possible output is
  `-999999999999.99` = 16 chars, far under the 256 cap, so resolve can never emit
  something the next evaluate rejects for length.
- `MAX_AMOUNT_INPUT_LENGTH = 256` is enforced on the **normalized** string, which is also
  what the recursive-descent parser walks — so the depth bound is exact and cannot be
  bypassed by padding with commas/underscores/NBSP (`/\s/` strips NBSP too), which only
  ever shrink the normalized length. Max reachable recursion is 127 parens / 255 unary
  signs. `maxLength={MAX_AMOUNT_INPUT_LENGTH}` is on all three amount inputs
  (OrbitForm x2, NewTransactionSheet adjustment). `completeExpression`'s trailing-operator
  trim loop has no length guard of its own but costs only 22ms on 400k operators.
- `VALID_NUMBER_RE` comma-only + `hasInvalidGrouping`: still 0 fuse-leaks, 0 over-rejections.

**OPEN (round 4) — `roundTo2` is only cent-exact below |value| ≈ 1e10.**
`Number((|n|*100).toPrecision(15))` snaps anything within ~5e-15 *relative* of a half-cent
boundary. That relative band becomes a large *absolute* band at high magnitude: at
|n|=1e11 the scaled value is 1e13, where 15 significant digits leave only one fractional
digit, so a genuine `.19485` is snapped to `.195` and rounds a cent too far. Measured
fudge-caused cent-error rate against exact rational arithmetic: 0.007% at 1e0-1e7,
0.03% at 1e8-1e9, **0.26% at 1e10, 2.9-3.4% at 1e11-1e12**. The docstring's claim that
the trick works "at every magnitude" is false above 1e10. Round 3 only proved to 1e7,
which is why this was missed.
Fix that is byte-identical below 1e10 (verified on 6.1M values incl. every 3-dp value in
[0,50), all specials, ±0) and cuts the 1e11 rate from 3.4% to 0.37%: bound the snap to
1e-3 cents instead of trusting 15 significant digits —
`const a=Math.abs(n)*100, s=Number(a.toPrecision(15)); const scaled=Math.abs(s-a)<=1e-3?s:a;`
Do NOT swap to a plain shortest-decimal round (`String(n)` + digit slice): it fixes 1e11
but triples the error rate at money magnitudes because it loses the drift rescue.

End-only rounding (rather than per-operation) is CORRECT here. Do not "fix" it.
`useCalcField` caret math was proven in round 3 and is unchanged.
