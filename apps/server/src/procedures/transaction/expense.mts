import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import type { Transactions } from "../../db/kysely/types.mjs";
import { resolveTransactionPermission } from "./utils/resolveTransactionPermission.mjs";
import { resolveTransactionSpaceIntegrity } from "./utils/resolveTransactionSpaceIntegrity.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { TRPCError } from "@trpc/server";
import { resolveExpenseCategoryBelongsToSpace } from "../expenseCategory/utils/resolveExpenseCategoryBelongsToSpace.mjs";
import { resolveEnvelopActive } from "../envelop/utils/resolveEnvelopActive.mjs";
import { withIdempotency } from "../../utils/withIdempotency.mjs";
import { resolveEventBelongsToSpace } from "../event/utils/resolveEventBelongsToSpace.mjs";
import { attachFilesToTransaction } from "../file/attach.mjs";

export const createExpenseTransaction = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            amount: z.number().positive(),
            datetime: z.coerce.date().optional(),
            description: z.string().optional(),
            location: z.string().optional(),
            sourceAccountId: z.string().uuid(),
            expense_category_id: z.string().uuid(),
            envelopId: z.string().uuid(),
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
                    operation: "transaction.expense",
                    key: input.idempotencyKey,
                    fn: async () => {
                        await resolveTransactionPermission({
                            trx,
                            spaceId: input.spaceId,
                            userId: ctx.auth.user.id,
                            destinationAccountId: null,
                            sourceAccountId: input.sourceAccountId,
                            type: "expense" as unknown as Transactions["type"],
                        });
                        await resolveTransactionSpaceIntegrity({
                            trx,
                            spaceId: input.spaceId,
                            sourceAccountId: input.sourceAccountId,
                            destinationAccountId: null,
                        });
                        await resolveExpenseCategoryBelongsToSpace({
                            trx,
                            expenseCategoryId: input.expense_category_id,
                            spaceId: input.spaceId,
                        });
                        await resolveEnvelopActive({
                            trx,
                            envelopId: input.envelopId,
                            spaceId: input.spaceId,
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
                                type: "expense" as unknown as Transactions["type"],
                                amount: input.amount,
                                source_account_id: input.sourceAccountId,
                                destination_account_id: null,
                                expense_category_id: input.expense_category_id,
                                envelop_id: input.envelopId,
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
                message: "Failed to create expense transaction",
            });
        }

        return result;
    });
