import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";

/* Top spending locations (merchants / places) for a single event, ranked
   by expense total. Powers the "Where it went" section on the event
   detail page. Blank / null locations are excluded — an unlabeled
   transaction is not a place. */
export const eventTopLocations = authorizedProcedure
    .input(
        z.object({
            eventId: z.string().uuid(),
            limit: z.number().int().min(1).max(20).default(8),
        })
    )
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
                    location: string;
                    total: string;
                    tx_count: string;
                }>`
                    SELECT
                        MIN(btrim(t.location))     AS location,
                        SUM(t.amount)::text        AS total,
                        COUNT(t.id)::text          AS tx_count
                    FROM transactions t
                    WHERE t.event_id = ${input.eventId}
                      AND t.type     = 'expense'
                      AND t.location IS NOT NULL
                      AND btrim(t.location) <> ''
                    GROUP BY lower(btrim(t.location))
                    ORDER BY SUM(t.amount) DESC
                    LIMIT ${input.limit}
                `.execute(trx);

                return res.rows.map((r) => ({
                    location: r.location,
                    total: Number(r.total),
                    txCount: Number(r.tx_count),
                }));
            })
        );

        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute event top locations",
            });
        }
        return result;
    });
