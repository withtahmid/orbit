import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";

export const deleteExpenseCategory = authorizedProcedure
    .input(
        z.object({
            categoryId: z.string().uuid(),
        })
    )
    .output(
        z.object({
            message: z.string(),
        })
    )
    .mutation(async ({ ctx, input }) => {
        const [error] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) => {
                // forUpdate serializes with changeParent's endpoint locks:
                // otherwise a concurrent "move X under this" landing between
                // our guard SELECTs and the DELETE surfaces as a raw FK 500
                // instead of the friendly message below.
                const current = await trx
                    .selectFrom("expense_categories")
                    .select(["id", "space_id"])
                    .where("expense_categories.id", "=", input.categoryId)
                    .forUpdate()
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

                // Friendly guards for what the FKs would reject anyway —
                // a raw constraint violation surfaces as an opaque 500.
                const child = await trx
                    .selectFrom("expense_categories")
                    .select("id")
                    .where("parent_id", "=", input.categoryId)
                    .limit(1)
                    .executeTakeFirst();
                if (child) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "This category has subcategories. Move or delete them first.",
                    });
                }

                const referencing = await trx
                    .selectFrom("transactions")
                    .select("id")
                    .where("expense_category_id", "=", input.categoryId)
                    .limit(1)
                    .executeTakeFirst();
                if (referencing) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message:
                            "Transactions reference this category, so it can't be deleted. Rename or re-nest it instead.",
                    });
                }

                await trx
                    .deleteFrom("expense_categories")
                    .where("expense_categories.id", "=", input.categoryId)
                    .execute();
            })
        );

        if (error) {
            if (error instanceof TRPCError) {
                throw error;
            }
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to delete expense category",
            });
        }

        return {
            message: "Expense category deleted successfully",
        };
    });
