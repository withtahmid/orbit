import { z } from "zod";
import type { Transactions } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveTransactionPermission } from "./utils/resolveTransactionPermission.mjs";
import { resolveTransactionSpaceIntegrity } from "./utils/resolveTransactionSpaceIntegrity.mjs";
import { TRPCError } from "@trpc/server";
import { resolveEventBelongsToSpace } from "../event/utils/resolveEventBelongsToSpace.mjs";
import { resolveExpenseCategoryBelongsToSpace } from "../expenseCategory/utils/resolveExpenseCategoryBelongsToSpace.mjs";
import { resolveEnvelopActive } from "../envelop/utils/resolveEnvelopActive.mjs";
import { attachFilesToTransaction } from "../file/attach.mjs";
import { withIdempotency } from "../../utils/withIdempotency.mjs";

// Either all three fee fields are provided, or none. Mirrors the
// shape clients must send and keeps the type union below tight.
const FEE_FIELDS = ["feeAmount", "feeExpenseCategoryId", "feeEnvelopId"] as const;

export const createTransferTransaction = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            amount: z.number().positive(),
            datetime: z.coerce.date().optional(),
            description: z.string().optional(),
            location: z.string().optional(),
            sourceAccountId: z.string().uuid(),
            destinationAccountId: z.string().uuid(),
            eventId: z.string().uuid().optional(),
            attachmentFileIds: z.array(z.string().uuid()).max(10).optional(),
            // Optional fee: if any of the three are set, all three must
            // be set. The fee is persisted as its own paired expense
            // row (type='expense', parent_transfer_id = this transfer)
            // — first-class spend rather than a special inline column.
            feeAmount: z.number().positive().optional(),
            feeExpenseCategoryId: z.string().uuid().optional(),
            feeEnvelopId: z.string().uuid().optional(),
            idempotencyKey: z.string().uuid().optional(),
        })
    )
    .mutation(async ({ ctx, input }) => {
        const feeSet = FEE_FIELDS.map((k) => input[k] !== undefined);
        if (feeSet.some(Boolean) && !feeSet.every(Boolean)) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Fee amount, fee category, and fee envelope must all be provided together",
            });
        }
        const hasFee = feeSet.every(Boolean);

        const [error, result] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) =>
                withIdempotency({
                    trx,
                    userId: ctx.auth.user.id,
                    operation: "transaction.transfer",
                    key: input.idempotencyKey,
                    fn: async () => {
                        await resolveTransactionPermission({
                            trx,
                            spaceId: input.spaceId,
                            userId: ctx.auth.user.id,
                            destinationAccountId: input.destinationAccountId,
                            sourceAccountId: input.sourceAccountId,
                            type: "transfer" as unknown as Transactions["type"],
                        });

                        await resolveTransactionSpaceIntegrity({
                            trx,
                            spaceId: input.spaceId,
                            sourceAccountId: input.sourceAccountId,
                            destinationAccountId: input.destinationAccountId,
                        });

                        if (input.eventId) {
                            await resolveEventBelongsToSpace({
                                trx,
                                eventId: input.eventId,
                                spaceId: input.spaceId,
                                requireActive: true,
                            });
                        }

                        if (hasFee) {
                            // The fee is its own expense row whose only
                            // account is the source, so it must pass the
                            // same integrity rule on its own — otherwise a
                            // cross-space contribution would leave an
                            // orphaned expense in a space that can't see
                            // the account it debits.
                            await resolveTransactionSpaceIntegrity({
                                trx,
                                spaceId: input.spaceId,
                                sourceAccountId: input.sourceAccountId,
                                destinationAccountId: null,
                                reason: "A transfer fee is paid from the source account, so the source must be shared into this space",
                            });
                            await resolveExpenseCategoryBelongsToSpace({
                                trx,
                                expenseCategoryId: input.feeExpenseCategoryId!,
                                spaceId: input.spaceId,
                            });
                            await resolveEnvelopActive({
                                trx,
                                envelopId: input.feeEnvelopId!,
                                spaceId: input.spaceId,
                            });
                        }

                        const datetime = input.datetime || new Date();
                        const desc = input.description || null;

                        const transaction = await trx
                            .insertInto("transactions")
                            .values({
                                space_id: input.spaceId,
                                created_by: ctx.auth.user.id,
                                type: "transfer" as unknown as Transactions["type"],
                                amount: input.amount,
                                source_account_id: input.sourceAccountId,
                                destination_account_id: input.destinationAccountId,
                                description: desc,
                                location: input.location || null,
                                transaction_datetime: datetime,
                                event_id: input.eventId ?? null,
                            })
                            .returning(["id"])
                            .executeTakeFirstOrThrow();

                        if (hasFee) {
                            await trx
                                .insertInto("transactions")
                                .values({
                                    space_id: input.spaceId,
                                    created_by: ctx.auth.user.id,
                                    type: "expense" as unknown as Transactions["type"],
                                    amount: input.feeAmount!,
                                    source_account_id: input.sourceAccountId,
                                    destination_account_id: null,
                                    expense_category_id: input.feeExpenseCategoryId!,
                                    envelop_id: input.feeEnvelopId!,
                                    description: desc ? `Fee — ${desc}` : "Transfer fee",
                                    location: input.location || null,
                                    transaction_datetime: datetime,
                                    event_id: input.eventId ?? null,
                                    parent_transfer_id: transaction.id,
                                })
                                .execute();
                        }

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
                message: "Failed to create transfer transaction",
            });
        }

        return result;
    });
