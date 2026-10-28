import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";
import type { SpaceMembers } from "../../db/kysely/types.mjs";

export const deleteTransaction = authorizedProcedure
    .input(z.object({ transactionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
        const [error] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) => {
                const tx = await trx
                    .selectFrom("transactions")
                    .select(["id", "space_id", "created_by"])
                    .where("id", "=", input.transactionId)
                    .executeTakeFirst();

                if (!tx) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Transaction not found",
                    });
                }

                // Any current owner/editor of the row's space may delete it.
                // No creator bypass (see update.mts): leaving or being
                // demoted in a space ends write access to old rows too.
                await resolveSpaceMembership({
                    trx,
                    spaceId: tx.space_id,
                    userId: ctx.auth.user.id,
                    roles: ["owner", "editor"] as unknown as SpaceMembers["role"][],
                });

                await trx
                    .deleteFrom("transactions")
                    .where("id", "=", input.transactionId)
                    .execute();
            })
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to delete transaction",
            });
        }
        return { message: "Transaction deleted" };
    });
