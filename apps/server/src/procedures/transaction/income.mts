import { z } from "zod";
import type { Transactions } from "../../db/kysely/types.mjs";
import { TRPCError } from "@trpc/server";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveTransactionPermission } from "./utils/resolveTransactionPermission.mjs";
import { resolveTransactionSpaceIntegrity } from "./utils/resolveTransactionSpaceIntegrity.mjs";
import { resolveEventBelongsToSpace } from "../event/utils/resolveEventBelongsToSpace.mjs";
import { attachFilesToTransaction } from "../file/attach.mjs";
import { withIdempotency } from "../../utils/withIdempotency.mjs";

export const createIncomeTransaction = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            amount: z.number().positive(),
            datetime: z.coerce.date().optional(),
            description: z.string().optional(),
            location: z.string().optional(),
            accountId: z.string().uuid(),
            eventId: z.string().uuid().optional(),
            attachmentFileIds: z.array(z.string().uuid()).max(10).optional(),
            idempotencyKey: z.string().uuid().optional(),
        })
    )
    .mutation(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) =>
                withIdempotency({
                    trx,
                    userId: ctx.auth.user.id,
                    operation: "transaction.income",
                    key: input.idempotencyKey,
                    fn: async () => {
                        await resolveTransactionPermission({
                            trx,
                            spaceId: input.spaceId,
                            userId: ctx.auth.user.id,
                            destinationAccountId: input.accountId,
                            sourceAccountId: null,
                            type: "income" as unknown as Transactions["type"],
                        });

                        await resolveTransactionSpaceIntegrity({
                            trx,
                            spaceId: input.spaceId,
                            sourceAccountId: null,
                            destinationAccountId: input.accountId,
                        });

                        if (input.eventId) {
                            await resolveEventBelongsToSpace({
                                trx,
                                eventId: input.eventId,
                                spaceId: input.spaceId,
                                requireActive: true,
                            });
                        }

                        const transaction = await trx
                            .insertInto("transactions")
                            .values({
                                space_id: input.spaceId,
                                created_by: ctx.auth.user.id,
                                type: "income" as unknown as Transactions["type"],
                                amount: input.amount,
                                source_account_id: null,
                                destination_account_id: input.accountId,
                                description: input.description || null,
                                location: input.location || null,
                                transaction_datetime: input.datetime || new Date(),
                                event_id: input.eventId ?? null,
                            })
                            .returning(["id"])
                            .executeTakeFirstOrThrow();

                        await attachFilesToTransaction({
                            trx,
                            transactionId: transaction.id,
                            fileIds: input.attachmentFileIds ?? [],
                            userId: ctx.auth.user.id,
                        });

                        return transaction;
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
                message: "Failed to create income transaction",
            });
        }

        return result;
    });
