import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
    completeExpression,
    countUnclosedParens,
    evaluateExpression,
    normalizeAmountInput,
    type CalcResult,
} from "./calc";

/**
 * Symbols offered by the inline operator strip.
 *
 * Four, not six: `(` and `)` were dropped deliberately. Receipt-summing is
 * `1200+340+85` and `3*250` — parentheses cost a third of the strip for a case
 * that essentially doesn't occur during money entry, and they're the main way
 * a tap-only user reaches an unbalanced-paren dead end. The parser still
 * accepts them, so pasted text with parens works fine.
 */
export const CALC_KEYS = ["+", "−", "×", "÷"] as const;

export const CALC_KEY_LABELS: Record<(typeof CALC_KEYS)[number], string> = {
    "+": "Plus",
    "−": "Minus",
    "×": "Times",
    "÷": "Divided by",
};

export type CalcFieldMessage = {
    /** Rendered in the visible (aria-hidden) feedback line. */
    text: string;
    /** Announced instead of `text` when the two need to differ. */
    announce?: string;
    tone: "info" | "warn";
} | null;

/**
 * Turns a money text input into an inline calculator.
 *
 * Two states are kept deliberately separate:
 *
 *   - `draft` — exactly what the user typed, expression and all. Local.
 *   - `value` / `onChange` — the *evaluated* amount as a plain numeric string.
 *     That's what the parent form stores and submits, so every existing
 *     `Number(amount)` call site keeps working untouched.
 *
 * While an expression is incomplete or unreadable the emitted value is `""`,
 * never a best-effort partial: `1200+340+` must not submit as 1540. The
 * caller's own "enter an amount" guard then blocks the save, and `message`
 * carries the reason so the user isn't told a visibly-filled field is empty.
 * `onBlur` repairs the common dangling-operator case first, so that dead end
 * is rarely reached at all.
 */
export function useCalcField(
    value: string,
    onChange: (v: string) => void,
    /**
     * Allow a negative result. Off for amounts (no caller accepts one, and a
     * silently-rejected `-50` reads as an empty field); on for a reconciled
     * account balance, which can legitimately be an overdraft.
     */
    options?: { allowNegative?: boolean }
) {
    const allowNegative = options?.allowNegative ?? false;
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [draft, setDraft] = useState(value);
    /* The last string we pushed up. Tells "the parent reset or hydrated the
       value" apart from "the parent is echoing back what we just sent" — only
       the former should clobber the user's in-progress expression. Without it,
       typing "12.50" would round-trip through the parent as "12.5" and yank
       the caret back a character. */
    const emittedRef = useRef(value);
    /* What a resolve replaced, e.g. "1200+340" after `=` turned the field into
       "1540". Kept so the feedback line can read `from 1200+340` instead of
       going blank: without it the whole perceptual event of pressing `=` (or
       the first Enter) is the readout DISAPPEARING, and the components of the
       sum are gone with no undo — a controlled React input doesn't restore
       reliably with ctrl-Z. Cleared by the next real edit. */
    const tapeRef = useRef<string | null>(null);

    useEffect(() => {
        if (value !== emittedRef.current) {
            setDraft(value);
            emittedRef.current = value;
            tapeRef.current = null;
        }
    }, [value]);

    const emit = (calc: CalcResult) => {
        const usable =
            calc.value !== null && (allowNegative || calc.value > 0) ? String(calc.value) : "";
        emittedRef.current = usable;
        onChange(usable);
    };

    const commit = (next: string, keepTape = false) => {
        if (!keepTape) tapeRef.current = null;
        setDraft(next);
        emit(evaluateExpression(next));
    };

    /* Insert at the caret rather than blindly at the end, so editing the
       middle of a longer expression isn't a retype-the-whole-thing job. The
       focus() call is synchronous: on mobile the input may not be focused yet
       (the strip can be tapped first), and deferring focus past the gesture
       task means iOS refuses to raise the keyboard. */
    const insert = (symbol: string) => {
        const el = inputRef.current;
        const [start, end] = caretRange(el, draft);
        commit(draft.slice(0, start) + symbol + draft.slice(end));
        el?.focus();
        const caret = start + symbol.length;
        requestAnimationFrame(() => el?.setSelectionRange(caret, caret));
    };

    const backspace = () => {
        const el = inputRef.current;
        const [start, end] = caretRange(el, draft);
        // A selection deletes itself; a collapsed caret eats the char before it.
        const from = start === end ? Math.max(0, start - 1) : start;
        commit(draft.slice(0, from) + draft.slice(end));
        el?.focus();
        requestAnimationFrame(() => el?.setSelectionRange(from, from));
    };

    /* Enter submits the form without moving focus, so `onBlur` never runs on
       the keyboard path — the very path the receipt-summing user takes.
       First Enter resolves and STOPS; the second submits.
       Resolving and submitting in one keystroke would render the confirmation
       for a single frame and then save: `1200×340+` (a plausible typo for
       `1200+340`) trims to 408,000 and posts it, while on the pointer path the
       same input shows `= 408,000.00` first and the mistake is catchable.
       Once resolved, `completeExpression` is idempotent, so the next Enter
       returns early and falls through to native submission. */
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        /* Cmd/Ctrl+Enter is a submit reflex, not an edit — let it through to
           the form rather than spending the first press on a resolve. */
        if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey) return;
        if (e.nativeEvent.isComposing) return;
        if (completeExpression(draft) === draft) return;
        e.preventDefault();
        resolve();
    };

    /* Collapse the expression into its result, the way pressing `=` on a
       calculator does. Shared by the `=` key, blur, and the first Enter. */
    const resolve = () => {
        if (draft === "") return;
        const next = completeExpression(draft);
        const el = inputRef.current;
        /* Focus only when something actually changed: tapping the dimmed `=`
           on a plain literal should not pull focus into the field and raise
           the soft keyboard on mobile. */
        if (next === draft) return;
        tapeRef.current = draft;
        commit(next, true);
        el?.focus();
        requestAnimationFrame(() => el?.setSelectionRange(next.length, next.length));
    };

    const onBlur = () => {
        if (draft === "") return;
        const next = completeExpression(draft);
        if (next !== draft) {
            tapeRef.current = draft;
            commit(next, true);
        }
    };

    const calc = evaluateExpression(draft);
    /* Exact by construction, rather than `calc.isExpression`: that lit the
       accent `=` key for `2*(3+`, `1,5+2` and `12a+3`, none of which resolve —
       a live-looking button that does nothing. Same call `onKeyDown` makes. */
    const canResolve = draft !== "" && completeExpression(draft) !== draft;

    const message: CalcFieldMessage = (() => {
        if (draft.trim() === "") return null;
        const src = normalizeAmountInput(draft);
        /* A draft of just separators ("," / "_") normalizes to empty, so the
           evaluator reports EMPTY rather than invalid — the field would show a
           character, no message, and then a "valid amount" toast on save. */
        if (src === "") return { text: "Can't read this amount", tone: "warn" };
        if (calc.isInvalid) {
            const dangling = /[+\-*/(]$/.test(src) || countUnclosedParens(src) > 0;
            return {
                text: dangling ? "Incomplete expression" : "Can't read this amount",
                tone: "warn",
            };
        }
        if (calc.value === null) return null;
        if (!allowNegative && calc.value <= 0) {
            return { text: "Must be more than zero", tone: "warn" };
        }
        /* Show the resolved total whenever it isn't already what the field
           reads. Covers expressions AND the silent-rounding case: a typed
           `1.005` submits as 1.01, and without this the field would show one
           number while another was saved. */
        const numericDraft = Number(src);
        const diverges = Number.isNaN(numericDraft) || numericDraft !== calc.value;
        if (!diverges) {
            /* Resolved: the field IS the number now, so there is nothing to
               reconcile — show what it replaced instead of going blank. */
            if (tapeRef.current && tapeRef.current !== draft) {
                return {
                    text: `from ${tapeRef.current.trim()}`,
                    /* The visible line can lead with "from …" because the
                       resolved number is right there in the field. A screen
                       reader has no such context, so the announcement leads
                       with the total — otherwise pressing Enter reads back the
                       INPUTS and never says what the field now holds. */
                    announce: `${calc.value.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                    })}, from ${tapeRef.current.trim()}`,
                    tone: "info",
                };
            }
            return null;
        }
        return {
            text: `= ${calc.value.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })}`,
            tone: "info",
        };
    })();

    /* Screen-reader announcement, debounced and held in an always-mounted
       region by the caller. Announcing on every keystroke would queue
       "= 1,203.00", "= 1,234.00", "= 1,540.00" while the user is still typing
       `1200+340`; `polite` queues rather than replaces, so the reader would
       lag several values behind. */
    const [announcement, setAnnouncement] = useState("");
    const messageText = message?.announce ?? message?.text ?? "";
    useEffect(() => {
        const t = setTimeout(() => setAnnouncement(messageText.replace(/^= /, "equals ")), 700);
        return () => clearTimeout(t);
    }, [messageText]);

    return {
        inputRef,
        draft,
        calc,
        message,
        announcement,
        commit,
        insert,
        backspace,
        onBlur,
        onKeyDown,
        resolve,
        canResolve,
    };
}

/**
 * Caret span to edit, given the input may never have been focused.
 *
 * `selectionStart` on a never-focused text input is `0`, not `null`, so the
 * `?? draft.length` idiom silently targets position 0 — and the key strip is
 * explicitly designed to be tappable before the input has focus. Tapping `+`
 * on an unfocused field holding "500" would otherwise produce "+500", and the
 * next digits land inside it ("+50500"), which parses cleanly and submits.
 */
function caretRange(el: HTMLInputElement | null, draft: string): [number, number] {
    if (!el || el !== document.activeElement) return [draft.length, draft.length];
    return [el.selectionStart ?? draft.length, el.selectionEnd ?? draft.length];
}
