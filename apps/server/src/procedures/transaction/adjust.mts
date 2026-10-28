import { z } from "zod";
import { sql } from "kysely";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveTransactionPermission } from "./utils/resolveTransactionPermission.mjs";
import { resolveTransactionSpaceIntegrity } from "./utils/resolveTransactionSpaceIntegrity.mjs";
import type { Transactions } from "../../db/kysely/types.mjs";
import { TRPCError } from "@trpc/server";
import { attachFilesToTransaction } from "../file/attach.mjs";
import { withIdempotency } from "../../utils/withIdempotency.mjs";

export const adjustAccountBalance = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            accountId: z.string().uuid(),
            newBalance: z.number(),
            datetime: z.coerce.date().optional(),
            description: z.string().optional(),
            location: z.string().optional(),
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
                    operation: "transaction.adjust",
                    key: input.idempotencyKey,
                    fn: async () => {
                        await resolveTransactionPermission({
                            trx,
                            spaceId: input.spaceId,
                            userId: ctx.auth.user.id,
                            destinationAccountId: input.accountId,
                            sourceAccountId: input.accountId,
                            type: "adjustment" as unknown as Transactions["type"],
                        });

                        await resolveTransactionSpaceIntegrity({
                            trx,
                            spaceId: input.spaceId,
                            sourceAccountId: input.accountId,
                            destinationAccountId: input.accountId,
                        });

                        // Compute the delta in Postgres so we preserve the
                        // exact precision of account_balances.balance
                        // (numeric(20,2)) and don't round-trip via JS float.
                        const row = await sql<{
                            delta: string;
                            abs_delta: string;
                            source_account_id: string | null;
                            destination_account_id: string | null;
                        }>`
                            SELECT
                                (${input.newBalance}::numeric - ab.balance)::text AS delta,
                                ABS(${input.newBalance}::numeric - ab.balance)::text AS abs_delta,
                                CASE
                                    WHEN ${input.newBalance}::numeric < ab.balance
                                        THEN ab.account_id::text
                                    ELSE NULL
                                END AS source_account_id,
                                CASE
                                    WHEN ${input.newBalance}::numeric > ab.balance
                                        THEN ab.account_id::text
                                    ELSE NULL
                                END AS destination_account_id
                            FROM account_balances ab
                            WHERE ab.account_id = ${input.accountId}
                        `
                            .execute(trx)
                            .then((r) => r.rows[0]);

                        if (!row) {
                            throw new TRPCError({
                                code: "NOT_FOUND",
                                message: "Account has no balance row",
                            });
                        }

                        if (Number(row.delta) === 0) {
                            throw new TRPCError({
                                code: "BAD_REQUEST",
                                message: "New balance is equal to current balance",
                            });
                        }

                        const transaction = await trx
                            .insertInto("transactions")
                            .values({
                                space_id: input.spaceId,
                                created_by: ctx.auth.user.id,
                                type: "adjustment" as unknown as Transactions["type"],
                                amount: row.abs_delta as unknown as number,
                                source_account_id: row.source_account_id,
                                destination_account_id: row.destination_account_id,
                                description: input.description || null,
                                location: input.location || null,
                                transaction_datetime: input.datetime || new Date(),
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
                message: "Failed to adjust account balance",
            });
        }

        return result;
    });
