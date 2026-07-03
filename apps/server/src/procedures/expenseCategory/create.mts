import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";
import { withIdempotency } from "../../utils/withIdempotency.mjs";

const HEX = /^#[0-9a-fA-F]{6}$/;

export const createExpenseCategory = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            name: z.string().min(1).max(255),
            parentId: z.string().uuid().nullable().optional(),
            color: z.string().regex(HEX).optional(),
            icon: z.string().min(1).max(48).optional(),
            priority: z.enum(["essential", "important", "discretionary", "luxury"]).optional(),
            idempotencyKey: z.string().uuid().optional(),
        })
    )
    .mutation(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) =>
                withIdempotency({
                    trx,
                    userId: ctx.auth.user.id,
                    operation: "expenseCategory.create",
                    key: input.idempotencyKey,
                    fn: async () => {
                        await resolveSpaceMembership({
                            trx,
                            spaceId: input.spaceId,
                            userId: ctx.auth.user.id,
                            roles: ["owner"] as unknown as SpaceMembers["role"][],
                        });

                        if (input.parentId) {
                            const parent = await trx
                                .selectFrom("expense_categories")
                                .select(["id", "space_id"])
                                .where("expense_categories.id", "=", input.parentId)
                                .executeTakeFirst();

                            if (!parent || parent.space_id !== input.spaceId) {
                                throw new TRPCError({
                                    code: "BAD_REQUEST",
                                    message: "Invalid parent category for this space",
                                });
                            }
                        }

                        return trx
                            .insertInto("expense_categories")
                            .values({
                                space_id: input.spaceId,
                                name: input.name,
                                parent_id: input.parentId ?? null,
                                color: input.color,
                                icon: input.icon,
                                priority: input.priority ?? null,
                            })
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
                    },
                })
            )
        );

        if (error) {
            if (error instanceof TRPCError) {
                throw error;
            }
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to create expense category",
            });
        }

        return result;
    });
