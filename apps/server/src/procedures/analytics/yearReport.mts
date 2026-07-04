import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";

/**
 * Per-envelope per-month plan + actual spend for an entire calendar year.
 *
 * Powers the annual "honesty" view — the answer to "how well did I budget
 * last year?" that no other surface can give. For each envelope (limited
 * to monthly cadence — rolling envelopes don't fit a per-month grid),
 * returns 12 cells of `{planned, spent, over}`. The frontend renders
 * the matrix as a heatmap-style table with overspend cells highlighted.
 *
 * Archived envelopes are still included if they had any activity in the
 * year — historical accuracy matters for retrospection. They render
 * with a small "archived" pill so the user knows.
 */
export const yearReport = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            year: z.number().int().min(2000).max(2100),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) => {
                await resolveSpaceMembership({
                    trx,
                    spaceId: input.spaceId,
                    userId: ctx.auth.user.id,
                    roles: [
                        "owner",
                        "editor",
                        "viewer",
                    ] as unknown as SpaceMembers["role"][],
                });

                const yearStart = new Date(Date.UTC(input.year, 0, 1));
                const yearEnd = new Date(Date.UTC(input.year + 1, 0, 1));

                // First pull the envelopes themselves so we keep stable
                // ordering and surface even ones with zero activity.
                const envelopes = await trx
                    .selectFrom("envelops")
                    .select([
                        "id",
                        "name",
                        "color",
                        "icon",
                        "cadence",
                        "archived",
                    ])
                    .where("space_id", "=", input.spaceId)
                    .where("cadence", "=", "monthly")
                    .orderBy("created_at", "asc")
                    .execute();

                if (envelopes.length === 0) {
                    return { envelopes: [], year: input.year };
                }

                // Per-month plan (allocations whose effective period_start
                // falls in that month). One row per envelope per month.
                const planRows = await sql<{
                    envelop_id: string;
                    month_idx: string;
                    allocated: string;
                }>`
                    SELECT
                        a.envelop_id::text AS envelop_id,
                        EXTRACT(MONTH FROM
                            COALESCE(
                                a.period_start,
                                DATE_TRUNC('month', a.created_at)::date
                            )
                        )::text AS month_idx,
                        SUM(a.amount)::text AS allocated
                    FROM envelop_allocations a
                    JOIN envelops e ON e.id = a.envelop_id
                    WHERE e.space_id = ${input.spaceId}
                      AND e.cadence = 'monthly'
                      AND COALESCE(
                            a.period_start,
                            DATE_TRUNC('month', a.created_at)::date
                          ) >= ${yearStart}::timestamptz::date
                      AND COALESCE(
                            a.period_start,
                            DATE_TRUNC('month', a.created_at)::date
                          ) < ${yearEnd}::timestamptz::date
                    GROUP BY a.envelop_id, month_idx
                `
                    .execute(trx)
                    .then((r) => r.rows);

                // Per-month actual spend. Fees are first-class type='expense'
                // rows with their own envelop_id, so they're included in
                // this single aggregation alongside regular expenses.
                const spendRows = await sql<{
                    envelop_id: string;
                    month_idx: string;
                    consumed: string;
                }>`
                    SELECT
                        t.envelop_id::text AS envelop_id,
                        EXTRACT(MONTH FROM t.transaction_datetime)::text AS month_idx,
                        SUM(t.amount)::text AS consumed
                    FROM transactions t
                    JOIN envelops e ON e.id = t.envelop_id
                    WHERE t.space_id = ${input.spaceId}
                      AND t.type = 'expense'
                      AND e.cadence = 'monthly'
                      AND t.transaction_datetime >= ${yearStart}
                      AND t.transaction_datetime < ${yearEnd}
                    GROUP BY t.envelop_id, EXTRACT(MONTH FROM t.transaction_datetime)
                `
                    .execute(trx)
                    .then((r) => r.rows);

                // Build a (envelopId, month 1..12) → {planned, spent} map.
                const cells = new Map<
                    string,
                    Map<number, { planned: number; spent: number }>
                >();
                for (const e of envelopes) {
                    cells.set(e.id, new Map());
                }
                for (const r of planRows) {
                    const m = cells.get(r.envelop_id);
                    if (!m) continue;
                    const month = Number(r.month_idx);
                    const cur = m.get(month) ?? { planned: 0, spent: 0 };
                    cur.planned = Number(r.allocated);
                    m.set(month, cur);
                }
                for (const r of spendRows) {
                    const m = cells.get(r.envelop_id);
                    if (!m) continue;
                    const month = Number(r.month_idx);
                    const cur = m.get(month) ?? { planned: 0, spent: 0 };
                    cur.spent = Number(r.consumed);
                    m.set(month, cur);
                }

                return {
                    year: input.year,
                    envelopes: envelopes.map((e) => {
                        const months = Array.from(
                            { length: 12 },
                            (_, i) => {
                                const cell = cells
                                    .get(e.id)
                                    ?.get(i + 1) ?? {
                                    planned: 0,
                                    spent: 0,
                                };
                                return {
                                    month: i + 1,
                                    planned: cell.planned,
                                    spent: cell.spent,
                                    over: Math.max(
                                        0,
                                        cell.spent - cell.planned
                                    ),
                                };
                            }
                        );
                        const totalPlanned = months.reduce(
                            (s, c) => s + c.planned,
                            0
                        );
                        const totalSpent = months.reduce(
                            (s, c) => s + c.spent,
                            0
                        );
                        return {
                            envelopId: e.id,
                            name: e.name,
                            color: e.color,
                            icon: e.icon,
                            archived: e.archived,
                            months,
                            totalPlanned,
                            totalSpent,
                            totalOver: Math.max(
                                0,
                                totalSpent - totalPlanned
                            ),
                        };
                    }),
                };
            })
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute year report",
            });
        }
        return result;
    });
