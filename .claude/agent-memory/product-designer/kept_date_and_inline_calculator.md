---
name: kept-date-and-inline-calculator
description: Round-2 verdicts on the transaction-entry kept-date ("Keep") mode and the inline arithmetic calculator in money fields — what settled, and the residuals.
metadata:
  type: project
---

Two features shipped together on `feat/calculator-and-date-pin`: a browser-local **kept date** for transaction entry and an **inline arithmetic evaluator** in money fields.

**Settled, do not reopen:**
- The kept date is NOT a pin. Vocabulary is deliberately split: `PinControl variant="keep"` = CalendarClock + "Keep"/"Keeping"; the server Account/Envelope/Event pins keep Pin + "Pin"/"Pinned". Pins are durable *defaults*; a kept date is a *mode* that expires with the sitting.
- The kept-date banner is informational + Stop only; it must never rewrite the date of a form the user is already filling in.
- `localStorage` over `sessionStorage` (deviates from the original ask): session scope drops the kept day on refresh / PWA cold start / iOS tab eviction, mid-sitting, indistinguishable from "nothing kept". The idle window is the expiry lever, not tab scope.
- Only the calendar DAY is kept, never the time. Each new form stamps `(time-of-day when kept) + (real seconds elapsed)`, clamped 23:59:59, so a batch stays monotonic across midnight.
- The operator strip stays visible on fine pointers. It is the ONLY discoverability surface for the arithmetic capability — there is no placeholder or help text saying the field takes `1200+340`.
- Parens dropped from the strip (parser still accepts them for pasted text).

**Why seconds are load-bearing:** `transaction.list` orders `transaction_datetime DESC, id DESC` and `id` is a random uuid, so identical stamps render a batch in arbitrary order. Anything that zeroes seconds re-shuffles a batch.

**Round-2 residuals: all eight closed** (banner moved into the four forms and takes `currentDay`; `toInputDateTimeSeconds` + `draftSeconds` threading; adjustment field reordered; idle window 6h -> 3h; always-mounted banner slot; "Enter a valid amount" + Enter-key repair; `clearDatePin()` in `AuthStore.clearAuth`).

**Settled additions:**
- Blur resolves ONLY genuinely broken input (dangling trailing operator). Well-formed text is never rewritten — `1,250.00` stays as typed, and the edit sheet's `1200.00` seed does not get normalized to `1200` and mark an untouched row dirty. The `= ...` readout carries the resolved total instead.
- `completeExpression` refuses to auto-close unbalanced parens: closing changes the expression's *shape* (`2*(3+` -> 6 for someone typing `2*(3+4)` = 14). Correct call; the strip offers no parens so this only fires on pasted text.
- Space and `_` rejected as thousands separators (comma only), because `100 200` fused to 100200. Correct — a space between digits is a missed operator far more often than a separator.

**Round-3 residuals: all four closed** (lakh/crore alternation in `VALID_NUMBER_RE`; `.nt-kept-slot:empty` replaced by an always-mounted `.of-sr-only` live span in `KeptDateBanner`; fee toast -> "Enter a valid fee"; `OrbitCalcInput` docblock now separates the shadcn-dialog reason from the BudgetsPage drop-in).

**Round-4 settled (the resolve gap the user found):**
- `completeExpression` now RESOLVES expressions and still never rewrites plain literals; a `=` key joined the strip (`+ - x / <- =`); Enter resolves, second Enter submits. All three are correct calls.
- The rule "expressions resolve, literals never do" has ONE hole: a >2dp literal (`1.005`) diverges from what is saved (1.01) forever and `=` is dimmed for it. Right predicate for BOTH "does `=` do anything" and "should this resolve" is `completeExpression(draft) !== draft` — not `calc.isExpression`, which lights `=` for inputs it cannot fix (`2*(3+`, `1,5+2`, `12a+3`).
- `=` resolving makes the `= total` readout vanish and destroys the expression with no undo. Recommended replacement: after a resolve, hold the source expression and show `from 1200 + 340` in the same always-mounted line until the draft is edited. That is also the positive signal that Enter-press-1 did something.

**Recurring pattern:** money-field validation toasts. Four were reworded for "field visibly holds unreadable text"; the adjustment's `"Enter the actual balance"` (`AdjustmentForm`, `delta == null`) is the fifth calculator-enabled field and was missed, and `contexts/modules/web/transactions.md` enshrines the count as "all four". Count the calculator call sites, not the toasts.

**Why:** the whole feature exists to remove re-picking the same past date when back-filling a day's transactions after midnight or a couple of days late.

**How to apply:** when touching transaction entry, treat the above "settled" list as decided; check any new money field against the coverage boundary, and check any new date write path for seconds preservation. Related: [[transaction_entry_pins_spec]].
