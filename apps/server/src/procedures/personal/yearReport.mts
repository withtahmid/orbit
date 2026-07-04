import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveMemberSpaceIds, resolveOwnedAccountIds } from "./shared.mjs";

/**
 * Cross-space annual report. Same shape as analytics.yearReport but
 * scoped to every space the caller is a member of. Each envelope row
 * carries its space name so the UI can disambiguate identically-named
 * envelopes across different spaces.
 */
export const personalYearReport = authorizedProcedure
    .input(
        z.object({
            year: z.number().int().min(2000).max(2100),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) => {
                const memberSpaces = await resolveMemberSpaceIds(
                    trx,
                    ctx.auth.user.id
                );
                if (memberSpaces.length === 0) {
                    return { envelopes: [], year: input.year };
                }

                // Spend rows are restricted to the caller's owned accounts —
                // otherwise the personal year report would attribute every
                // co-member's spend on a shared space to "my" overspend.
                const owned = await resolveOwnedAccountIds(
                    trx,
                    ctx.auth.user.id
                );
                const ownedParam =
                    owned.length === 0
                        ? ["00000000-0000-0000-0000-000000000000"]
                        : owned;

                const yearStart = new Date(Date.UTC(input.year, 0, 1));
                const yearEnd = new Date(Date.UTC(input.year + 1, 0, 1));

                const envelopes = await trx
                    .selectFrom("envelops")
                    .innerJoin("spaces", "spaces.id", "envelops.space_id")
                    .select([
                        "envelops.id",
                        "envelops.name",
                        "envelops.color",
                        "envelops.icon",
                        "envelops.cadence",
                        "envelops.archived",
                        "spaces.name as space_name",
                    ])
                    .where("envelops.space_id", "in", memberSpaces)
                    .where("envelops.cadence", "=", "monthly")
                    .orderBy("spaces.name", "asc")
                    .orderBy("envelops.created_at", "asc")
                    .execute();

                if (envelopes.length === 0) {
                    return { envelopes: [], year: input.year };
                }

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
                    WHERE e.space_id = ANY(${memberSpaces}::uuid[])
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
                    WHERE t.space_id = ANY(${memberSpaces}::uuid[])
                      AND t.type = 'expense'
                      AND t.source_account_id = ANY(${ownedParam}::uuid[])
                      AND e.cadence = 'monthly'
                      AND t.transaction_datetime >= ${yearStart}
                      AND t.transaction_datetime < ${yearEnd}
                    GROUP BY t.envelop_id, EXTRACT(MONTH FROM t.transaction_datetime)
                `
                    .execute(trx)
                    .then((r) => r.rows);

                const cells = new Map<
                    string,
                    Map<number, { planned: number; spent: number }>
                >();
                for (const e of envelopes) cells.set(e.id, new Map());
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
                        const months = Array.from({ length: 12 }, (_, i) => {
                            const cell = cells.get(e.id)?.get(i + 1) ?? {
                                planned: 0,
                                spent: 0,
                            };
                            return {
                                month: i + 1,
                                planned: cell.planned,
                                spent: cell.spent,
                                over: Math.max(0, cell.spent - cell.planned),
                            };
                        });
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
                            spaceName: e.space_name,
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
                message:
                    error.message || "Failed to compute personal year report",
            });
        }
        return result;
    });
