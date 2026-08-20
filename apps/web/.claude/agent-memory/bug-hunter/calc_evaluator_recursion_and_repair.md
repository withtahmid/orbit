---
name: calc-evaluator-recursion-and-repair
description: lib/calc.ts invariants — completeExpression must repair the RAW folded string; the MAX_AMOUNT_INPUT_LENGTH guard is neutralised whenever an input's maxLength equals it; all three calc inputs must stay type="text".
metadata:
  type: project
---

`apps/web/src/lib/calc.ts` + `lib/useCalcField.ts` (inline amount calculator).
Three consumers: `OrbitAmountCard`, `OrbitCalcInput` (both `components/orbit/OrbitForm.tsx`)
and `AdjustmentForm`'s balance input (`NewTransactionSheet.tsx`, `allowNegative: true`).

**Invariants that have each broken at least once:**

1. **`completeExpression` must repair `foldAliases(raw).trimEnd()`, never
   `normalizeAmountInput(raw)`.** Normalizing first hides `,`/space/`_` from
   `hasInvalidGrouping`, so `1200 340` (a missed `+`) fuses to `1200340`.
   Shipped once as a silent 1000x error. Also: return `raw` untouched when
   nothing was dangling (else the edit sheet's `1200.00` seed is rewritten and
   marks an untouched row dirty) and when parens are unbalanced.

2. **`parseFactor` recurses per `(` and per unary sign; `MAX_AMOUNT_INPUT_LENGTH`
   (256) in `evaluateExpression` is the only thing bounding it.** Verified: the
   length check runs before any parser call, so 40k nested parens return
   `isInvalid` in ~1ms with no `RangeError`. `completeExpression`'s trim loop is
   fine too (V8 sliced strings; 200k trailing `+` = 8ms). **So the parser is
   self-protecting and the inputs do NOT need `maxLength`.**

3. **Never set an input's `maxLength` equal to (or below)
   `MAX_AMOUNT_INPUT_LENGTH`.** Browsers truncate *paste* to `maxLength`
   silently, so the parser's "too long → Can't read this amount" rejection can
   never fire and a 48-item pasted receipt is stored mid-term
   (`...+4.70+50` from `50.15`), parses cleanly, and submits ~11% low with a
   confident `= 2,040.75` readout. Same silent-wrong-number class as the
   `1200 340` fuse. Keep `maxLength` well above the parser cap, or drop it.

4. **All three inputs must stay `type="text"`.** `insert()`, `backspace()` and
   `resolve()` call `setSelectionRange`, which throws `InvalidStateError` on
   `type="number"`/`email`/`date`. Reverting any one of them breaks the strip.

**Verified correct 2026-08-21 — do not re-litigate:**
- `completeExpression` is **idempotent for every input** (proved: output is
  either `raw` or `String(k/100)`, and `MAX_MAGNITUDE=1e12` / min-nonzero 0.01
  rule out exponential notation, so the output is never expression-like).
  400k-case fuzz found zero counterexamples. The "second Enter submits" claim in
  `useCalcField.onKeyDown` therefore holds — no field can trap the user.
- Fuse guard (`1200 340`), shape guard (`2*(3+`), edit-sheet no-dirty guard
  (`1200.00`, `1,250.00`) all hold.
- Space and `_` are NOT accepted as thousands grouping — `100 200` and `1_000`
  are rejected. (An older memory claiming `100 200` still fuses is wrong.)
- `emit()` and `setDraft()` always move together in `commit()`, and every
  consumer's `onChange` is an identity setter, so the resync effect can never
  clobber a resolved draft.

Repro harness: `node_modules/.bin/tsc calc.ts --target es2020 --module esnext
--outDir out`, rename to `.mjs`, import. There is still no test file.

See [[amount_card_draft_emit_contract]].
