import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";
import { resolveTransactionPermission } from "./utils/resolveTransactionPermission.mjs";
import { resolveTransactionSpaceIntegrity } from "./utils/resolveTransactionSpaceIntegrity.mjs";
import { resolveEventBelongsToSpace } from "../event/utils/resolveEventBelongsToSpace.mjs";
import { resolveExpenseCategoryBelongsToSpace } from "../expenseCategory/utils/resolveExpenseCategoryBelongsToSpace.mjs";
import { resolveEnvelopActive } from "../envelop/utils/resolveEnvelopActive.mjs";
import type { SpaceMembers, Transactions } from "../../db/kysely/types.mjs";
import { attachFilesToTransaction } from "../file/attach.mjs";

export const updateTransaction = authorizedProcedure
    .input(
        z.object({
            transactionId: z.string().uuid(),
            amount: z.number().positive().optional(),
            datetime: z.coerce.date().optional(),
            description: z.string().nullable().optional(),
            location: z.string().nullable().optional(),
            sourceAccountId: z.string().uuid().nullable().optional(),
            destinationAccountId: z.string().uuid().nullable().optional(),
            expenseCategoryId: z.string().uuid().nullable().optional(),
            envelopId: z.string().uuid().optional(),
            eventId: z.string().uuid().nullable().optional(),
            addAttachmentFileIds: z.array(z.string().uuid()).max(10).optional(),
            // Fee fields only valid on transfers. The fee lives as a
            // paired type='expense' row pointing at the parent transfer
            // via `parent_transfer_id`. All three fee fields move
            // together: set all to create / update the linked row, or
            // pass `feeAmount: null` (with the others) to delete it.
            feeAmount: z.number().positive().nullable().optional(),
            feeExpenseCategoryId: z.string().uuid().nullable().optional(),
            feeEnvelopId: z.string().uuid().nullable().optional(),
        })
    )
    .mutation(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) => {
                const existing = await trx
                    .selectFrom("transactions")
                    .selectAll()
                    .where("id", "=", input.transactionId)
                    .executeTakeFirst();
                if (!existing) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Transaction not found",
                    });
                }

                const isCreator = existing.created_by === ctx.auth.user.id;
                if (!isCreator) {
                    await resolveSpaceMembership({
                        trx,
                        spaceId: existing.space_id,
                        userId: ctx.auth.user.id,
                        roles: ["owner", "editor"] as unknown as SpaceMembers["role"][],
                    });
                }

                const merged = {
                    amount: input.amount ?? Number(existing.amount),
                    datetime: input.datetime ?? existing.transaction_datetime,
                    description:
                        input.description === undefined ? existing.description : input.description,
                    location: input.location === undefined ? existing.location : input.location,
                    sourceAccountId:
                        input.sourceAccountId === undefined
                            ? existing.source_account_id
                            : input.sourceAccountId,
                    destinationAccountId:
                        input.destinationAccountId === undefined
                            ? existing.destination_account_id
                            : input.destinationAccountId,
                    expenseCategoryId:
                        input.expenseCategoryId === undefined
                            ? existing.expense_category_id
                            : input.expenseCategoryId,
                    envelopId:
                        input.envelopId === undefined ? existing.envelop_id : input.envelopId,
                    eventId: input.eventId === undefined ? existing.event_id : input.eventId,
                };

                const isTransfer = (existing.type as unknown as string) === "transfer";

                // Fee shape validation: if any fee field is touched, the
                // resulting state must be "all three set" or "all three
                // cleared". Mid-states are rejected up-front for a cleaner
                // error than discovering it during the linked-row update.
                const feeTouched =
                    input.feeAmount !== undefined ||
                    input.feeExpenseCategoryId !== undefined ||
                    input.feeEnvelopId !== undefined;
                if (feeTouched && !isTransfer) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "Fees are only valid on transfer transactions",
                    });
                }
                let linkedFee: {
                    id: string;
                    amount: number;
                    expense_category_id: string | null;
                    envelop_id: string | null;
                } | null = null;
                if (isTransfer) {
                    const row = await trx
                        .selectFrom("transactions")
                        .select(["id", "amount", "expense_category_id", "envelop_id"])
                        .where("parent_transfer_id", "=", input.transactionId)
                        .where("type", "=", "expense" as unknown as Transactions["type"])
                        .executeTakeFirst();
                    if (row) {
                        linkedFee = {
                            id: row.id,
                            amount: Number(row.amount),
                            expense_category_id: row.expense_category_id,
                            envelop_id: row.envelop_id,
                        };
                    }
                }

                let desiredFee: {
                    amount: number;
                    expenseCategoryId: string;
                    envelopId: string;
                } | null = null;
                let clearFee = false;
                if (feeTouched) {
                    const triple = [
                        input.feeAmount,
                        input.feeExpenseCategoryId,
                        input.feeEnvelopId,
                    ];
                    const allNull = triple.every((v) => v === null);
                    const allSet = triple.every((v) => v !== null && v !== undefined);
                    if (!allNull && !allSet) {
                        throw new TRPCError({
                            code: "BAD_REQUEST",
                            message:
                                "Fee amount, category, and envelope must all be set or all cleared",
                        });
                    }
                    if (allNull) {
                        clearFee = true;
                    } else {
                        desiredFee = {
                            amount: input.feeAmount as number,
                            expenseCategoryId: input.feeExpenseCategoryId as string,
                            envelopId: input.feeEnvelopId as string,
                        };
                    }
                }

                if (desiredFee) {
                    await resolveExpenseCategoryBelongsToSpace({
                        trx,
                        expenseCategoryId: desiredFee.expenseCategoryId,
                        spaceId: existing.space_id,
                    });
                    await resolveEnvelopActive({
                        trx,
                        envelopId: desiredFee.envelopId,
                        spaceId: existing.space_id,
                    });
                }

                await resolveTransactionPermission({
                    trx,
                    userId: ctx.auth.user.id,
                    sourceAccountId: merged.sourceAccountId,
                    destinationAccountId: merged.destinationAccountId,
                    type: existing.type as unknown as Transactions["type"],
                });

                await resolveTransactionSpaceIntegrity({
                    trx,
                    spaceId: existing.space_id,
                    sourceAccountId: merged.sourceAccountId,
                    destinationAccountId: merged.destinationAccountId,
                });

                if (merged.expenseCategoryId) {
                    await resolveExpenseCategoryBelongsToSpace({
                        trx,
                        expenseCategoryId: merged.expenseCategoryId,
                        spaceId: existing.space_id,
                    });
                }

                if (input.envelopId !== undefined && input.envelopId !== existing.envelop_id) {
                    await resolveEnvelopActive({
                        trx,
                        envelopId: input.envelopId,
                        spaceId: existing.space_id,
                    });
                }

                if (merged.eventId) {
                    await resolveEventBelongsToSpace({
                        trx,
                        eventId: merged.eventId,
                        spaceId: existing.space_id,
                    });
                }

                await trx
                    .updateTable("transactions")
                    .set({
                        amount: merged.amount,
                        transaction_datetime: merged.datetime,
                        description: merged.description,
                        location: merged.location,
                        source_account_id: merged.sourceAccountId,
                        destination_account_id: merged.destinationAccountId,
                        expense_category_id: merged.expenseCategoryId,
                        envelop_id: merged.envelopId,
                        event_id: merged.eventId,
                    })
                    .where("id", "=", input.transactionId)
                    .execute();

                // Manage the linked fee expense for transfer edits.
                // Three branches: clear → delete; set + had one → update
                // in place (keep id, attachments, etc.); set + no
                // existing → insert.
                if (isTransfer && feeTouched) {
                    if (clearFee && linkedFee) {
                        await trx
                            .deleteFrom("transactions")
                            .where("id", "=", linkedFee.id)
                            .execute();
                    } else if (desiredFee && linkedFee) {
                        await trx
                            .updateTable("transactions")
                            .set({
                                amount: desiredFee.amount,
                                expense_category_id: desiredFee.expenseCategoryId,
                                envelop_id: desiredFee.envelopId,
                            })
                            .where("id", "=", linkedFee.id)
                            .execute();
                    } else if (desiredFee && !linkedFee) {
                        await trx
                            .insertInto("transactions")
                            .values({
                                space_id: existing.space_id,
                                created_by: ctx.auth.user.id,
                                type: "expense" as unknown as Transactions["type"],
                                amount: desiredFee.amount,
                                source_account_id: merged.sourceAccountId,
                                destination_account_id: null,
                                expense_category_id: desiredFee.expenseCategoryId,
                                envelop_id: desiredFee.envelopId,
                                description: merged.description
                                    ? `Fee — ${merged.description}`
                                    : "Transfer fee",
                                location: merged.location,
                                transaction_datetime: merged.datetime,
                                event_id: merged.eventId,
                                parent_transfer_id: input.transactionId,
                            })
                            .execute();
                    }
                }

                /**
                 * Keep a surviving fee row aligned with its parent. Source
                 * account, date, event and location are properties of the
                 * TRANSFER, not of the fee — the insert branch above seeds
                 * the fee from exactly these four columns, so they must
                 * keep tracking the parent afterwards.
                 *
                 * This deliberately runs on every transfer edit, not only
                 * when the fee fields are touched. Without it, moving a
                 * transfer to another account (or another date, or off an
                 * event) left the fee debiting the OLD account on the OLD
                 * date: one logical operation silently split across two
                 * accounts, and — since a fee is a type='expense' row — a
                 * fee stranded in the wrong month or event skewed those
                 * envelope/event/category rollups with no visible cause.
                 *
                 * Permission-safe: a transfer's source has already been
                 * validated as owner-held and unlocked, which is exactly
                 * what an expense row's source requires.
                 *
                 * The rule is STRUCTURAL columns follow the parent;
                 * user-authored free text does not. `source_account_id`,
                 * `transaction_datetime` and `event_id` decide which account
                 * is debited and which period/event rollup the fee lands in,
                 * so they must stay in lockstep. `description` and
                 * `location` are prose the fee row exposes for direct
                 * editing (see `isFeeExpense` in EditTransactionSheet), so
                 * re-copying them on every parent edit would silently
                 * clobber what the user typed there. The insert above seeds
                 * both once and then leaves them alone.
                 */
                if (isTransfer && linkedFee && !clearFee) {
                    await trx
                        .updateTable("transactions")
                        .set({
                            source_account_id: merged.sourceAccountId,
                            transaction_datetime: merged.datetime,
                            event_id: merged.eventId,
                        })
                        .where("id", "=", linkedFee.id)
                        .execute();
                }

                await attachFilesToTransaction({
                    trx,
                    transactionId: input.transactionId,
                    fileIds: input.addAttachmentFileIds ?? [],
                    userId: ctx.auth.user.id,
                });

                return { id: input.transactionId };
            })
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to update transaction",
            });
        }
        return result;
    });
