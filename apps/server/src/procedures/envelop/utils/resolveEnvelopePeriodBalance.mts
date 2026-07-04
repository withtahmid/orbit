import { Kysely, sql } from "kysely";
import type { DB } from "../../../db/kysely/types.mjs";
import { resolvePeriodWindow, type Cadence } from "./periodWindow.mjs";

export interface PeriodBalanceRow {
    envelopId: string;
    allocated: number;
    consumed: number;
    remaining: number;
}

interface Opts {
    trx: Kysely<DB>;
    envelopId: string;
    /** Reference instant the period is relative to. Defaults to now. */
    at?: Date;
}

/**
 * Compute an envelope's current-period balance on-read.
 *
 *   - Monthly envelopes **reset** every period: `remaining = allocated −
 *     consumed` for the calendar month containing `at`. No carry-over.
 *   - Rolling/goal envelopes (cadence='none') are a single lifetime pool:
 *     the window is `[epoch, ∞)`, so allocation and spend accumulate forever.
 *
 * Allocations are stored one row per (envelope, month) for monthly and one
 * NULL-period row for rolling/goal, so `allocated` is a direct row read —
 * no SUM over a ledger.
 */
export async function resolveEnvelopePeriodBalance({
    trx,
    envelopId,
    at,
}: Opts): Promise<PeriodBalanceRow> {
    const envelope = await trx
        .selectFrom("envelops")
        .select(["id", "cadence"])
        .where("id", "=", envelopId)
        .executeTakeFirstOrThrow();

    const cadence = envelope.cadence as Cadence;
    const { start, end } = resolvePeriodWindow(cadence, at);

    const row = await sql<{
        allocated: string;
        consumed: string;
    }>`
        SELECT
            COALESCE((
                SELECT a.amount
                FROM envelop_allocations a
                WHERE a.envelop_id = ${envelopId}
                  AND ${allocationPeriodMatch(cadence, start)}
            ), 0)::text AS allocated,
            COALESCE((
                SELECT SUM(t.amount)
                FROM transactions t
                WHERE t.envelop_id = ${envelopId}
                  AND t.type = 'expense'
                  AND t.transaction_datetime >= ${start}
                  AND t.transaction_datetime < ${end}
            ), 0)::text AS consumed
    `
        .execute(trx)
        .then((r) => r.rows[0]);

    const allocated = Number(row?.allocated ?? 0);
    const consumed = Number(row?.consumed ?? 0);

    return {
        envelopId,
        allocated,
        consumed,
        remaining: allocated - consumed,
    };
}

/**
 * Match the single allocation row for the period: the NULL-period lifetime
 * row for cadence='none', else the row whose `period_start` is the month start.
 */
function allocationPeriodMatch(cadence: Cadence, start: Date) {
    if (cadence === "none") {
        return sql`a.period_start IS NULL`;
    }
    // ::timestamptz::date, NOT bare ::date: `start` is an APP_TZ month-start
    // instant (July 1 00:00 +06 = …-06-30T18:00Z) and pg serializes it as
    // text; text→date truncates the literal's date part with NO tz
    // conversion, landing on the previous month's last day — which matches
    // no allocation row (they sit on the 1st), so `allocated` silently read
    // 0. timestamptz→date converts in the session zone (APP_TZ).
    return sql`a.period_start = ${start}::timestamptz::date`;
}
