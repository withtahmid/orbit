import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";

/* Per-day expense/income totals for a single event, grouped by the
   APP_TZ (Asia/Dhaka) calendar day of `transaction_datetime`. Powers the
   spend-timeline (cumulative area + daily bars) and the day-of-week strip
   on the event detail page. Rows are only emitted for days that actually
   had activity — the client fills the visual window from the event's
   start/end range, so an event with no gaps still renders a continuous
   line and a bar per active day.

   Distinct from analytics.cumulativeSpend, which is period + space-account
   scoped; this is scoped by `event_id` and needs no account filtering
   because an event's transactions are already the unit of interest. */
export const eventDailySpend = authorizedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) => {
                const event = await trx
                    .selectFrom("events")
                    .select(["id", "space_id"])
                    .where("events.id", "=", input.eventId)
                    .executeTakeFirst();

                if (!event) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Event not found",
                    });
                }

                await resolveSpaceMembership({
                    trx,
                    spaceId: event.space_id,
                    userId: ctx.auth.user.id,
                    roles: ["owner", "editor", "viewer"] as unknown as SpaceMembers["role"][],
                });

                const res = await sql<{
                    day: string;
                    expense: string;
                    income: string;
                    tx_count: string;
                }>`
                    SELECT
                        to_char(date_trunc('day', t.transaction_datetime), 'YYYY-MM-DD') AS day,
                        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0)::text AS expense,
                        COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount ELSE 0 END), 0)::text AS income,
                        COUNT(t.id)::text AS tx_count
                    FROM transactions t
                    WHERE t.event_id = ${input.eventId}
                      AND t.type IN ('expense', 'income')
                    GROUP BY 1
                    ORDER BY 1 ASC
                `.execute(trx);

                return res.rows.map((r) => ({
                    /* 'YYYY-MM-DD' APP_TZ calendar day — the client parses it
                       as a wall-clock date, never re-shifting by tz. */
                    date: r.day,
                    expense: Number(r.expense),
                    income: Number(r.income),
                    txCount: Number(r.tx_count),
                }));
            })
        );

        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute event daily spend",
            });
        }
        return result;
    });
