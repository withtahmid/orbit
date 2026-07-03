import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";

const HEX = /^#[0-9a-fA-F]{6}$/;

export const updateExpenseCategory = authorizedProcedure
    .input(
        z
            .object({
                categoryId: z.string().uuid(),
                name: z.string().min(1).max(255).optional(),
                color: z.string().regex(HEX).optional(),
                icon: z.string().min(1).max(48).optional(),
                priority: z
                    .enum(["essential", "important", "discretionary", "luxury"])
                    .nullable()
                    .optional(),
            })
            .refine(
                (d) =>
                    d.name !== undefined ||
                    d.color !== undefined ||
                    d.icon !== undefined ||
                    d.priority !== undefined,
                { message: "At least one field must be provided" }
            )
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

                return trx
                    .updateTable("expense_categories")
                    .set({
                        name: input.name,
                        color: input.color,
                        icon: input.icon,
                        priority: input.priority,
                        updated_at: new Date(),
                    })
                    .where("expense_categories.id", "=", input.categoryId)
                    .returning([
                        "id",
                        "space_id",
                        "parent_id",
                        "name",
                        "color",
                        "icon",
                        "priority",
                        "created_at",
                        "updated_at",
                    ])
                    .executeTakeFirstOrThrow();
            })
        );

        if (error) {
            if (error instanceof TRPCError) {
                throw error;
            }
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to update expense category",
            });
        }

        return result;
    });
