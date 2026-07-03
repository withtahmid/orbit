import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";

export const listExpenseCategoriesBySpace = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            (async () => {
                await resolveSpaceMembership({
                    trx: ctx.services.qb,
                    spaceId: input.spaceId,
                    userId: ctx.auth.user.id,
                    roles: ["owner", "editor", "viewer"] as unknown as SpaceMembers["role"][],
                });

                return ctx.services.qb
                    .selectFrom("expense_categories")
                    .select([
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
                    .where("expense_categories.space_id", "=", input.spaceId)
                    .orderBy("expense_categories.created_at", "asc")
                    .execute();
            })()
        );

        if (error) {
            if (error instanceof TRPCError) {
                throw error;
            }
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to fetch expense categories",
            });
        }

        return result ?? [];
    });
