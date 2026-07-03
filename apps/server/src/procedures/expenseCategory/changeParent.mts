import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";

export const changeExpenseCategoryParent = authorizedProcedure
    .input(
        z.object({
            categoryId: z.string().uuid(),
            parentId: z.string().uuid().nullable(),
        })
    )
    .output(
        z.object({
            id: z.string().uuid(),
            space_id: z.string().uuid(),
            parent_id: z.string().uuid().nullable(),
            name: z.string(),
            created_at: z.date(),
            updated_at: z.date().nullable(),
        })
    )
    .mutation(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) => {
                const current = await trx
                    .selectFrom("expense_categories")
                    .select(["id", "space_id"])
                    .where("expense_categories.id", "=", input.categoryId)
                    .executeTakeFirst();

                if (!current) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Expense category not found",
                    });
                }

                await resolveSpaceMembership({
                    trx,
                    spaceId: current.space_id,
                    userId: ctx.auth.user.id,
                    roles: ["owner"] as unknown as SpaceMembers["role"][],
                });

                if (input.parentId) {
                    if (input.parentId === input.categoryId) {
                        throw new TRPCError({
                            code: "BAD_REQUEST",
                            message: "A category cannot be its own parent",
                        });
                    }

                    const parent = await trx
                        .selectFrom("expense_categories")
                        .select(["id", "space_id"])
                        .where("expense_categories.id", "=", input.parentId)
                        .executeTakeFirst();

                    if (!parent || parent.space_id !== current.space_id) {
                        throw new TRPCError({
                            code: "BAD_REQUEST",
                            message: "Invalid parent category for this space",
                        });
                    }

                    // Lock both endpoints (deterministic order → no
                    // deadlock) so two reciprocal moves serialize: without
                    // this, concurrent "A under B" + "B under A" each pass
                    // the cycle check against pre-commit state.
                    const locked = await sql<{ id: string }>`
                        SELECT id FROM expense_categories
                        WHERE id IN (${input.categoryId}, ${input.parentId})
                        ORDER BY id
                        FOR UPDATE
                    `.execute(trx);

                    // Re-verify under lock: a concurrent delete may have
                    // removed either row while we waited — fail friendly
                    // instead of via the FK on UPDATE. Lowercased on both
                    // sides: Postgres returns canonical-lowercase uuids but
                    // zod's .uuid() admits uppercase input unnormalized.
                    const lockedIds = new Set(locked.rows.map((r) => r.id.toLowerCase()));
                    if (!lockedIds.has(input.parentId.toLowerCase())) {
                        throw new TRPCError({
                            code: "BAD_REQUEST",
                            message: "Parent category no longer exists",
                        });
                    }
                    if (!lockedIds.has(input.categoryId.toLowerCase())) {
                        throw new TRPCError({
                            code: "NOT_FOUND",
                            message: "Expense category not found",
                        });
                    }

                    // Reject descendants: nothing in the DB stops
                    // `parent_id` UPDATEs from forming a cycle, and a cycle
                    // makes the whole subtree unreachable. Walk up from the
                    // proposed parent; hitting the category means the parent
                    // lives inside its own subtree. Depth-capped so a
                    // pre-existing corrupt cycle can't loop forever.
                    const cycle = await sql<{ id: string }>`
                        WITH RECURSIVE chain AS (
                            SELECT id, parent_id, 1 AS depth
                            FROM expense_categories
                            WHERE id = ${input.parentId}
                            UNION ALL
                            SELECT ec.id, ec.parent_id, chain.depth + 1
                            FROM expense_categories ec
                            JOIN chain ON ec.id = chain.parent_id
                            WHERE chain.depth < 100
                        )
                        SELECT id FROM chain
                        WHERE id = ${input.categoryId}
                        LIMIT 1
                    `.execute(trx);

                    if (cycle.rows.length > 0) {
                        throw new TRPCError({
                            code: "BAD_REQUEST",
                            message: "Cannot move a category under one of its own subcategories",
                        });
                    }
                }

                return trx
                    .updateTable("expense_categories")
                    .set({
                        parent_id: input.parentId,
                        updated_at: new Date(),
                    })
                    .where("expense_categories.id", "=", input.categoryId)
                    .returning(["id", "space_id", "parent_id", "name", "created_at", "updated_at"])
                    .executeTakeFirstOrThrow();
            })
        );

        if (error) {
            if (error instanceof TRPCError) {
                throw error;
            }
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to change category parent",
            });
        }

        return result;
    });
