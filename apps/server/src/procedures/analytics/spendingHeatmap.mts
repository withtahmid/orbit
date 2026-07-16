import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";
import {
    categoryFilterWhere,
    envelopeFilterWhere,
    scopeAccountsFilter,
    selectedCategoriesCTEClause,
    trendsFilterInputShape,
} from "./utils/trendsFilters.mjs";

export const spendingHeatmap = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            periodStart: z.coerce.date(),
            periodEnd: z.coerce.date(),
            /**
             * `cash` (default, matches cashFlow.mts's own schema default)
             * — cross-space outbound transfer principal counts as spend.
             *
             * `operational` — transfer principal excluded; only true
             * `type='expense'` debits count. A transfer to your own
             * savings account isn't spending, so it shouldn't paint a
             * calendar day as a heavy one. The Spending calendar page
             * requests this explicitly as its own default (like Spending
             * Trends does), the same way this schema default is never
             * actually reached by that UI.
             */
            mode: z.enum(["cash", "operational"]).default("cash"),
            ...trendsFilterInputShape,
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) => {
                await resolveSpaceMembership({
                    trx,
                    spaceId: input.spaceId,
                    userId: ctx.auth.user.id,
                    roles: ["owner", "editor", "viewer"] as unknown as SpaceMembers["role"][],
                });

                // Daily spending always includes expenses whose source is
                // in scope. In `cash` mode it also includes cross-space
                // outbound transfers (source in, dest out) as principal —
                // mirroring cashFlow.mts / spaceSummary.mts so a day's
                // heatmap cell and that day's cash-flow expense bar agree.
                // In `operational` mode the transfer branch contributes 0
                // (see `xferFactor` below): moving money to your own
                // savings account isn't spending.
                /* Filter fragments — empty when inactive. A category
                   filter naturally drops the transfer branch (transfers
                   carry no `expense_category_id`); likewise an envelope
                   filter drops it (transfer *principal* rows are inserted
                   with no `envelop_id` — only the separate fee row, a
                   `type='expense'`, carries one). Both match the Trends
                   "only tagged transactions" semantics. Both branches
                   alias `transactions t` so the
                   envelope/category fragments splice in. */
                const catCTE = selectedCategoriesCTEClause(input.categoryIds, [
                    input.spaceId,
                ]);
                const catWhere = categoryFilterWhere(input.categoryIds);
                const envWhere = envelopeFilterWhere(input.envelopeIds);
                const acctScope = scopeAccountsFilter(input.accountIds);
                /* Transfer-principal branch is always emitted; its
                   contribution is multiplied by a 0/1 factor derived from
                   the Zod-validated `mode` enum — the same convention
                   cashFlow.mts uses. */
                const xferFactor = input.mode === "cash" ? 1 : 0;

                const query = sql<{ day: Date; total: string }>`
                    WITH RECURSIVE ${catCTE}
                    scope_accounts AS (
                        SELECT sa.account_id
                        FROM space_accounts sa
                        WHERE sa.space_id = ${input.spaceId}
                        ${acctScope}
                    )
                    SELECT day, SUM(amount)::text AS total FROM (
                        SELECT date_trunc('day', t.transaction_datetime) AS day, t.amount
                        FROM transactions t
                        WHERE t.type = 'expense'
                          AND t.source_account_id IN (SELECT account_id FROM scope_accounts)
                          AND t.transaction_datetime >= ${input.periodStart}
                          AND t.transaction_datetime < ${input.periodEnd}
                          ${envWhere}
                          ${catWhere}
                        UNION ALL
                        SELECT date_trunc('day', t.transaction_datetime) AS day, t.amount * ${xferFactor} AS amount
                        FROM transactions t
                        WHERE t.type = 'transfer'
                          AND t.source_account_id IN (SELECT account_id FROM scope_accounts)
                          AND t.destination_account_id NOT IN (SELECT account_id FROM scope_accounts)
                          AND t.transaction_datetime >= ${input.periodStart}
                          AND t.transaction_datetime < ${input.periodEnd}
                          ${envWhere}
                          ${catWhere}
                    ) entries
                    GROUP BY day
                    ORDER BY day ASC
                `;
                const res = await query.execute(trx);
                return res.rows.map((r) => ({
                    day: new Date(r.day),
                    total: Number(r.total),
                }));
            })
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute spending heatmap",
            });
        }
        return result;
    });
