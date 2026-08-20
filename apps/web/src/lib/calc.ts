/**
 * Tiny dependency-free arithmetic evaluator for amount inputs.
 *
 * Lets the transaction forms accept `1200+340+85` (or `3*250`) directly in
 * the amount field instead of forcing a trip to a separate calculator app.
 * Deliberately NOT `eval` / `new Function` — this parses a fixed grammar and
 * nothing else, so a pasted string can never execute.
 *
 * Grammar (recursive descent, standard precedence):
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := factor (('*' | '/') factor)*
 *   factor := ('-' | '+') factor | number | '(' expr ')'
 *
 * Anything the grammar doesn't accept — a dangling operator (`120+`), an
 * unbalanced paren, stray letters — yields `value: null` rather than a
 * best-effort partial number. That matters: the amount card emits the
 * evaluated value up to the form, so a partial parse of a half-typed
 * expression would let the user submit an amount they never intended.
 */

export type CalcResult = {
    /** Evaluated total rounded to 2dp, or null when empty/incomplete/invalid. */
    value: number | null;
    /** True when the raw input is more than a single plain number literal. */
    isExpression: boolean;
    /**
     * True when the input is non-empty **after normalization** but does not
     * evaluate. A draft of just separators (`","`) normalizes to empty and so
     * reports `isInvalid: false`; `useCalcField` special-cases that.
     */
    isInvalid: boolean;
};

/**
 * Largest accepted magnitude. Two reasons, both about not silently mangling
 * an amount: above ~9e15 doubles can't hold cents at all, and above 1e21
 * `String(n)` switches to exponential notation ("1e+23"), which re-parses
 * through `Number()` and would sail past every downstream guard. 1e12 is far
 * beyond any real transaction and keeps `n * 100` exact.
 */
const MAX_MAGNITUDE = 1e12;

/**
 * Nesting depth the parser will descend to.
 *
 * This is the real stack guard. `parseFactor` recurses once per `(` and once
 * per leading unary sign, so a pasted `"(".repeat(5000) + "1" + ")".repeat(5000)`
 * — or 20k leading minus signs — blows the call stack with a `RangeError`.
 * `useCalcField` evaluates the draft *during render*, so that throw escapes to
 * the router's errorElement and replaces the page with the error boundary,
 * destroying a half-filled transaction form.
 *
 * Bounding *depth* rather than length is what makes this precise: `parseExpr`
 * and `parseTerm` are iterative, so a flat 300-term receipt sum costs one
 * stack frame no matter how long it is. An earlier blunt 256-CHARACTER cap
 * rejected a perfectly ordinary 48-item receipt (287 chars).
 */
const MAX_NESTING_DEPTH = 64;

/**
 * Longest input the parser will look at, as a backstop against re-parsing a
 * megabyte on every keystroke. Deliberately generous — ~300 summed terms.
 *
 * Do NOT mirror this as `maxLength` on the inputs. A browser truncating an
 * over-long paste is SILENT, and the truncated string still parses: a 287-char
 * 48-item receipt clipped to 256 chars cut `50.15` to `50` and resolved to
 * 2,040.75 against a true 2,298.00 — an 11% error that every downstream signal
 * agreed with. The parser rejecting it is visible ("Can't read this amount"),
 * so the cap must live here and only here.
 */
export const MAX_AMOUNT_INPUT_LENGTH = 2000;

const EMPTY: CalcResult = { value: null, isExpression: false, isInvalid: false };

/**
 * Fold the characters a real keyboard / phone keypad / paste can produce into
 * the ASCII set the parser understands: `× ✕ x X → *`, `÷ → /`,
 * `− – — → -` (U+2212 minus and the dashes). Separators are left alone here
 * so `hasInvalidGrouping` can still see them.
 */
function foldAliases(raw: string): string {
    return raw
        .replace(/[×✕xX]/g, "*")
        .replace(/[÷]/g, "/")
        .replace(/[−–—]/g, "-");
}

/**
 * Fold aliases, then drop thousands separators and whitespace so a pasted
 * "1,250.00" parses as 1250. A comma is only ever a group separator here,
 * never a decimal point — see `VALID_NUMBER_RE` for which groupings count
 * (en-US and South Asian lakh/crore both do).
 *
 * Stripping is only safe because `hasInvalidGrouping` runs first. Don't call
 * this without that guard: without it, two separate numbers fuse into one
 * plausible-looking amount.
 */
export function normalizeAmountInput(raw: string): string {
    return foldAliases(raw).replace(/[,\s_]/g, "");
}

/**
 * A number literal that is either separator-free or comma-grouped.
 *
 * Two comma groupings are accepted, because this app renders ৳ and its users
 * write both: en-US `1,234,567` and South Asian lakh/crore `12,34,567`.
 * Rejecting the latter would tell someone their own locale's number is
 * unreadable, which is a worse false negative than anything the guard catches.
 * Both strip to identical digits, so nothing downstream has to know.
 *
 * Only `,` groups. Space and `_` are stripped by `normalizeAmountInput` but
 * are NOT accepted as grouping, because a space between digits is far more
 * often a missed operator than a separator: `100 200` groups validly by length
 * and fused to 100200, and only its 4-digit lead saved `1200 340`.
 *
 * Still rejected, as required: `1.234,56` (lead isn't 1–3 digits before a
 * comma), `1,5` and `12,34` (no terminal 3-digit group), `1200 340`, `5 5`.
 */
const VALID_NUMBER_RE = /^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d*)?$/;

/**
 * True when any number literal in the input uses `, ` / space / `_` in a way
 * that is NOT valid thousands grouping.
 *
 * This guard is what makes the unconditional separator-stripping in
 * `normalizeAmountInput` safe. Without it `1200 340` (a missed `+`, easy to
 * type) fuses into 1200340 and submits as ৳1,200,340 instead of ৳1,540 — and
 * because no operator survives normalization the `= …` readout never renders
 * to contradict what the field shows. Likewise `1.234,56` would become 1.23.
 *
 * Valid grouping is defined by `VALID_NUMBER_RE` — en-US or lakh/crore comma
 * groups — so `1,250.00`, `1,234,567` and `12,34,567` are accepted while
 * `1200 340`, `100 200`, `1.234,56` and `1,5` are rejected. A literal with no
 * separators at all is always fine.
 */
function hasInvalidGrouping(raw: string): boolean {
    // Operators and parens delimit number literals; anything between them
    // that carries a separator has to be a well-formed grouped number.
    for (const token of foldAliases(raw).split(/[+\-*/()]/)) {
        const t = token.trim();
        if (t === "" || !/[,\s_]/.test(t)) continue;
        if (!VALID_NUMBER_RE.test(t)) return true;
    }
    return false;
}

/** Characters that make an input an "expression" rather than a bare number. */
const OPERATOR_RE = /[+\-*/()]/;

export function isExpressionLike(raw: string): boolean {
    const src = normalizeAmountInput(raw);
    /* A leading unary sign alone doesn't count — "-50" is still a literal.
       Only index 0 and only for +/-: exempting whatever happens to be first
       would also exempt a leading "(", so "(4" would report as a literal and
       the caller would suppress the error hint for exactly the half-typed
       input that most needs it. */
    const body = src[0] === "-" || src[0] === "+" ? src.slice(1) : src;
    return OPERATOR_RE.test(body);
}

export function evaluateExpression(raw: string): CalcResult {
    const src = normalizeAmountInput(raw);
    if (src === "") return EMPTY;

    const isExpression = isExpressionLike(raw);
    const invalid: CalcResult = { value: null, isExpression, isInvalid: true };

    if (src.length > MAX_AMOUNT_INPUT_LENGTH) return invalid;
    if (hasInvalidGrouping(raw)) return invalid;

    let i = 0;
    let depth = 0;

    const peek = () => src[i];

    function parseExpr(): number | null {
        let left = parseTerm();
        if (left === null) return null;
        for (;;) {
            const c = peek();
            if (c !== "+" && c !== "-") return left;
            i++;
            const right = parseTerm();
            if (right === null) return null;
            left = c === "+" ? left + right : left - right;
        }
    }

    function parseTerm(): number | null {
        let left = parseFactor();
        if (left === null) return null;
        for (;;) {
            const c = peek();
            if (c !== "*" && c !== "/") return left;
            i++;
            const right = parseFactor();
            if (right === null) return null;
            // Division by zero would produce Infinity/NaN and silently
            // become a garbage amount — reject it as invalid instead.
            if (c === "/" && right === 0) return null;
            left = c === "*" ? left * right : left / right;
        }
    }

    function parseFactor(): number | null {
        // Depth guard — see MAX_NESTING_DEPTH. Bail before recursing, never after.
        if (depth >= MAX_NESTING_DEPTH) return null;
        depth++;
        const out = parseFactorInner();
        depth--;
        return out;
    }

    function parseFactorInner(): number | null {
        const c = peek();
        if (c === "-" || c === "+") {
            i++;
            const inner = parseFactor();
            if (inner === null) return null;
            return c === "-" ? -inner : inner;
        }
        if (c === "(") {
            i++;
            const inner = parseExpr();
            if (inner === null) return null;
            if (peek() !== ")") return null;
            i++;
            return inner;
        }
        return parseNumber();
    }

    function parseNumber(): number | null {
        const start = i;
        while (i < src.length && src[i] >= "0" && src[i] <= "9") i++;
        if (src[i] === ".") {
            i++;
            while (i < src.length && src[i] >= "0" && src[i] <= "9") i++;
        }
        if (i === start) return null;
        // Accepts a trailing "." ("12." while mid-typing) — Number("12.") is 12.
        const n = Number(src.slice(start, i));
        return Number.isFinite(n) ? n : null;
    }

    const result = parseExpr();
    // Trailing garbage (e.g. "12)" or "12a") means the whole input is invalid,
    // not "the prefix that happened to parse".
    if (result === null || i !== src.length) return invalid;
    if (!Number.isFinite(result)) return invalid;
    if (Math.abs(result) > MAX_MAGNITUDE) return invalid;

    return {
        value: roundTo2(result),
        isExpression,
        isInvalid: false,
    };
}

/**
 * Resolve what the user typed into the number it evaluates to — the `=` key,
 * the blur handler, and the first Enter press all run this.
 *
 * Three rules, each of which was a real defect first:
 *
 *  1. **Resolve whenever resolving changes the value.** `1200+340` becomes
 *     `1540`, `1200+340+` trims its tail and also becomes `1540`, and the
 *     literal `1.005` becomes `1.01` because that is what would be saved.
 *     What is NOT rewritten is a literal that already reads as its own value:
 *     `1200.00` and `1,250.00` come back byte-identical, because the edit
 *     sheet seeds its amount from a pg `numeric` string and rewriting it to
 *     `1200` on the first stray blur marks an untouched row dirty.
 *  2. **Repair the RAW (alias-folded) text, never `normalizeAmountInput`'s
 *     output.** Handing a separator-stripped string to `evaluateExpression`
 *     hides the separators from `hasInvalidGrouping`, so `1200 340` came back
 *     as 1200340 — the exact fuse the guard exists to stop, one event later.
 *  3. **Unbalanced parens are left alone.** Auto-closing changes the
 *     expression's *shape* rather than trimming its tail: `2*(3+` would
 *     resolve to 6 for someone mid-way through typing `2*(3+4)` = 14.
 *
 * Anything that doesn't evaluate comes back unchanged, so genuinely
 * unreadable input keeps showing what was typed and `message` explains it.
 */
export function completeExpression(raw: string): string {
    const folded = foldAliases(raw).trimEnd();

    /* The trimEnd inside the loop is load-bearing: without it
       `1200 + 340 + ` stops at the trailing space and never sheds the `+`. */
    let src = folded;
    while (src.length > 0 && /[+\-*/]$/.test(src)) src = src.slice(0, -1).trimEnd();

    // Rule 3.
    if (countUnclosedParens(src) > 0) return raw;

    const resolved = evaluateExpression(src);
    if (resolved.value === null) return raw;

    /* Rule 1. A plain literal that already reads as its own value is returned
       byte-identical — but one that does NOT (`1.005`, which saves as 1.01) is
       resolved like any expression. The test is "does resolving change
       anything?", not "is this an expression?": the latter left every
       >2dp literal permanently displaying a number different from the one
       being saved, with the `=` key greyed out because nothing looked
       resolvable. */
    if (
        src === folded &&
        !isExpressionLike(raw) &&
        Number(normalizeAmountInput(raw)) === resolved.value
    ) {
        return raw;
    }

    return String(resolved.value);
}

/** Open parens with no matching close. Extra `)` doesn't count as negative. */
export function countUnclosedParens(src: string): number {
    let depth = 0;
    for (const ch of src) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
    }
    return Math.max(0, depth);
}

/**
 * Round to cents, half away from zero.
 *
 * The naive `Math.round(n * 100) / 100` loses a cent whenever the scaled value
 * lands just under a .5 boundary — `8.165 * 100` is 816.4999999999999, so half
 * of 4.27 came out as 2.13. Re-reading the scaled value at 15 significant
 * digits discards that binary artifact (816.4999999999999 -> 816.5).
 *
 * An absolute `Number.EPSILON` nudge does NOT work here: EPSILON is the ulp of
 * 1.0, so for |n| >= 2 one ulp of `n` already exceeds it and `n + EPSILON ===
 * n` — the correction silently becomes a no-op across most of the range money
 * actually occupies.
 *
 * But `toPrecision(15)` is a *relative* snap, so it can't be trusted at every
 * magnitude either: by |n| ~ 1e10 the scaled value has no fractional digits
 * left to spend, and the snap stops discarding a binary artifact and starts
 * discarding a real cent (a genuine `.19485` became `.195`). Hence the
 * absolute guard below — take the snap only when it moves the value by less
 * than a thousandth of a cent. Byte-identical to the unguarded version for all
 * |n| < 1e10; above that it cuts the cent-error rate from ~3.4% to ~0.37%.
 */
export function roundTo2(n: number): number {
    if (!Number.isFinite(n)) return n;
    const cents = Math.abs(n) * 100;
    const snapped = Number(cents.toPrecision(15));
    const scaled = Math.abs(snapped - cents) <= 1e-3 ? snapped : cents;
    return (Math.sign(n) * Math.round(scaled)) / 100;
}
