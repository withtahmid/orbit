import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";

type Tier = "essential" | "important" | "discretionary" | "luxury" | "unclassified";

const TIER_ORDER: Tier[] = ["essential", "important", "discretionary", "luxury", "unclassified"];

const TIER_LABEL: Record<Tier, string> = {
    essential: "Essential",
    important: "Important",
    discretionary: "Discretionary",
    luxury: "Luxury",
    unclassified: "Unclassified",
};

const TIER_COLOR: Record<Tier, string> = {
    essential: "#dc2626",
    important: "#f59e0b",
    discretionary: "#3b82f6",
    luxury: "#a855f7",
    unclassified: "#64748b",
};

export const priorityBreakdown = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            periodStart: z.coerce.date(),
            periodEnd: z.coerce.date(),
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

                // Priority lives on the category. Children with NULL
                // priority inherit from the nearest ancestor that has
                // one; a root with NULL is "unclassified." The
                // `resolved` CTE walks each category up the parent
                // chain using a recursive self-join and picks the
                // first non-NULL priority it finds.
                //
                // Scope matches cashFlow's account-flow rule (§12):
                // only expenses whose source is in the space's
                // scope_accounts count. Transfer fees are now first-
                // class expense rows (parent_transfer_id IS NOT NULL),
                // so they fall under the same expense rule automatically.
                const query = sql<{
                    priority: string | null;
                    envelop_id: string | null;
                    envelop_name: string | null;
                    envelop_color: string | null;
                    envelop_icon: string | null;
                    total: string;
                }>`
                    WITH RECURSIVE scope_accounts AS (
                        SELECT sa.account_id
                        FROM space_accounts sa
                        WHERE sa.space_id = ${input.spaceId}
                    ),
                    ancestry AS (
                        -- depth 0: each category is its own starting point.
                        SELECT id, parent_id, priority,
                               id AS origin
                        FROM expense_categories
                        WHERE space_id = ${input.spaceId}
                        UNION ALL
                        -- Walk up through any NULL-priority ancestors.
                        SELECT parent.id, parent.parent_id, parent.priority,
                               a.origin
                        FROM ancestry a
                        JOIN expense_categories parent ON parent.id = a.parent_id
                        WHERE a.priority IS NULL
                    ),
                    resolved AS (
                        SELECT origin AS id,
                               (ARRAY_AGG(priority)
                                FILTER (WHERE priority IS NOT NULL))[1]
                               AS effective_priority
                        FROM ancestry
                        GROUP BY origin
                    ),
                    entries AS (
                        -- Envelope attribution comes from the transaction's
                        -- own envelop_id (source of truth since migration
                        -- 041); categories carry no envelope link anymore.
                        SELECT t.expense_category_id AS ec_id,
                               t.envelop_id,
                               t.amount AS amount
                        FROM transactions t
                        WHERE t.type = 'expense'
                          AND t.source_account_id IN (SELECT account_id FROM scope_accounts)
                          AND t.transaction_datetime >= ${input.periodStart}
                          AND t.transaction_datetime < ${input.periodEnd}
                    )
                    SELECT
                        r.effective_priority AS priority,
                        env.id::text AS envelop_id,
                        env.name AS envelop_name,
                        env.color AS envelop_color,
                        env.icon AS envelop_icon,
                        COALESCE(SUM(e.amount), 0)::text AS total
                    FROM entries e
                    LEFT JOIN resolved r ON r.id = e.ec_id
                    LEFT JOIN envelops env ON env.id = e.envelop_id
                    GROUP BY r.effective_priority, env.id, env.name, env.color, env.icon
                `;
                const res = await query.execute(trx);

                const totals = new Map<Tier, number>(TIER_ORDER.map((t) => [t, 0]));
                const envelopesByTier = new Map<
                    Tier,
                    Map<
                        string,
                        {
                            id: string;
                            name: string;
                            color: string;
                            icon: string;
                            total: number;
                        }
                    >
                >(TIER_ORDER.map((t) => [t, new Map()]));
                for (const row of res.rows) {
                    const key: Tier =
                        row.priority && TIER_ORDER.includes(row.priority as Tier)
                            ? (row.priority as Tier)
                            : "unclassified";
                    const total = Number(row.total);
                    totals.set(key, (totals.get(key) ?? 0) + total);
                    if (row.envelop_id && row.envelop_name) {
                        const map = envelopesByTier.get(key)!;
                        const existing = map.get(row.envelop_id);
                        if (existing) {
                            existing.total += total;
                        } else {
                            map.set(row.envelop_id, {
                                id: row.envelop_id,
                                name: row.envelop_name,
                                color: row.envelop_color ?? "#64748b",
                                icon: row.envelop_icon ?? "folder",
                                total,
                            });
                        }
                    }
                }

                return TIER_ORDER.map((tier) => ({
                    priority: tier,
                    label: TIER_LABEL[tier],
                    color: TIER_COLOR[tier],
                    total: totals.get(tier) ?? 0,
                    envelopes: Array.from((envelopesByTier.get(tier) ?? new Map()).values()).sort(
                        (a, b) => b.total - a.total
                    ),
                }));
            })
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute priority breakdown",
            });
        }
        return result;
    });
