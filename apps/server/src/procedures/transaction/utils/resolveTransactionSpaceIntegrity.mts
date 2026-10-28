import { TRPCError } from "@trpc/server";
import type { Kysely } from "kysely";
import type { DB } from "../../../db/kysely/types.mjs";

/**
 * Enforce that `space_id` on a transaction is a meaningful tag: the
 * chosen space must share at least one of the transaction's accounts,
 * otherwise the row is orphaned — it would live on a space that has
 * no visibility into either leg. Under the account-flow analytics
 * model (see spec §12), `space_id` becomes a categorization /
 * organizational hint rather than a scope boundary, so this invariant
 * keeps the tag honest without constraining legitimate cross-space
 * contributions (where one leg is shared into the recording space and
 * the other isn't).
 */
export const resolveTransactionSpaceIntegrity = async ({
    trx,
    spaceId,
    sourceAccountId,
    destinationAccountId,
    reason,
}: {
    trx: Kysely<DB>;
    spaceId: string;
    sourceAccountId: string | null;
    destinationAccountId: string | null;
    /** Optional override for the error message (e.g. the fee-row case). */
    reason?: string;
}) => {
    const accountIds = [sourceAccountId, destinationAccountId].filter((id): id is string => !!id);
    if (accountIds.length === 0) {
        return;
    }

    const match = await trx
        .selectFrom("space_accounts")
        .select("account_id")
        .where("space_id", "=", spaceId)
        .where("account_id", "in", accountIds)
        .limit(1)
        .executeTakeFirst();

    if (!match) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message:
                reason ??
                "The chosen space has no relationship to either account — pick a space one of these accounts is shared into",
        });
    }
};
