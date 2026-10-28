import { TRPCError } from "@trpc/server";
import { Kysely } from "kysely";
import type { DB, SpaceMembers, Transactions, UserAccounts } from "../../../db/kysely/types.mjs";
import { resolveAccountPermission } from "../../account/utils/resolveAccountPermission.mjs";
import { resolveSpaceMembership } from "../../space/utils/resolveSpaceMembership.mjs";

type TransactionType = Transactions["type"];

const OWNER_ROLE = ["owner"] as unknown as UserAccounts["role"][];
const WRITER_ROLES = ["owner", "editor"] as unknown as SpaceMembers["role"][];

/**
 * Permission model for every transaction write (spec §11.3):
 *
 * 1. The caller must be an `owner` or `editor` of the space the row is
 *    recorded in (`spaceId`). Space viewers are read-only, and a user
 *    whose account is still shared into a space they have left gets no
 *    write access through that account alone.
 * 2. Money may only LEAVE an account the caller owns (`user_accounts.role
 *    = 'owner'`) — expense source, transfer source, adjustment account.
 *    Locked accounts can never be an expense/transfer source.
 * 3. Money may LAND in an account the caller owns OR any account shared
 *    into the recording space — income destination, transfer destination.
 *    No `user_accounts` row on the destination is needed: a member can
 *    fund a shared pot or pay a roommate's account directly.
 *
 * `check` lets `update` skip the account checks for edits that move no
 * money (description, category, envelope, event, date, location) — the
 * original write already authorized the legs, and re-running the owner
 * rule as a different editor would block fixing someone else's typo.
 * Any edit that changes amount, accounts or fee re-checks BOTH legs.
 * The shape validation (which legs must be set) always runs.
 */
export const resolveTransactionPermission = async ({
    trx,
    spaceId,
    sourceAccountId,
    destinationAccountId,
    userId,
    type,
    check = { source: true, destination: true },
}: {
    trx: Kysely<DB>;
    spaceId: string;
    sourceAccountId: string | null;
    destinationAccountId: string | null;
    userId: string;
    type: TransactionType;
    check?: { source: boolean; destination: boolean };
}) => {
    await resolveSpaceMembership({ trx, spaceId, userId, roles: WRITER_ROLES });

    const kind = type as unknown as string;

    if (kind === "adjustment") {
        if (!sourceAccountId && !destinationAccountId) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                    "Either source or destination account is required for adjustment transactions",
            });
        }
        if (sourceAccountId && destinationAccountId && sourceAccountId !== destinationAccountId) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "An adjustment can only touch a single account",
            });
        }
        if (sourceAccountId && check.source) {
            await requireOwner({ trx, accountId: sourceAccountId, userId });
        }
        if (destinationAccountId && destinationAccountId !== sourceAccountId && check.destination) {
            await requireOwner({ trx, accountId: destinationAccountId, userId });
        }
        return;
    }

    if (kind === "income") {
        if (!destinationAccountId || sourceAccountId) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Income transactions have a destination account and no source",
            });
        }
        if (check.destination) {
            await requireOwnedOrInSpace({ trx, accountId: destinationAccountId, userId, spaceId });
        }
        return;
    }

    if (kind === "expense") {
        if (!sourceAccountId || destinationAccountId) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Expense transactions have a source account and no destination",
            });
        }
        if (check.source) {
            await requireOwner({ trx, accountId: sourceAccountId, userId });
            await rejectIfLocked({ trx, accountId: sourceAccountId });
        }
        return;
    }

    if (kind === "transfer") {
        if (!sourceAccountId || !destinationAccountId) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Source and destination accounts are required for transfer transactions",
            });
        }
        if (sourceAccountId === destinationAccountId) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Source and destination accounts must be different",
            });
        }
        if (check.source) {
            await requireOwner({ trx, accountId: sourceAccountId, userId });
            await rejectIfLocked({ trx, accountId: sourceAccountId });
        }
        if (check.destination) {
            await requireOwnedOrInSpace({ trx, accountId: destinationAccountId, userId, spaceId });
        }
        return;
    }

    throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Unsupported transaction type",
    });
};

const requireOwner = ({
    trx,
    accountId,
    userId,
}: {
    trx: Kysely<DB>;
    accountId: string;
    userId: string;
}) => resolveAccountPermission({ trx, accountId, userId, roles: OWNER_ROLE });

/**
 * Destination rule: the account is either owned by the caller (so even
 * a cross-space destination outside the recording space is fine — it's
 * their own money arriving), or it is shared into the recording space,
 * which every owner/editor of that space may pay into.
 */
const requireOwnedOrInSpace = async ({
    trx,
    accountId,
    userId,
    spaceId,
}: {
    trx: Kysely<DB>;
    accountId: string;
    userId: string;
    spaceId: string;
}) => {
    const account = await trx
        .selectFrom("accounts")
        .select("id")
        .where("id", "=", accountId)
        .executeTakeFirst();
    if (!account) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
    }

    const asOwner = await trx
        .selectFrom("user_accounts")
        .select("user_id")
        .where("account_id", "=", accountId)
        .where("user_id", "=", userId)
        .where("role", "=", "owner" as unknown as UserAccounts["role"])
        .executeTakeFirst();
    if (asOwner) return;

    const inSpace = await trx
        .selectFrom("space_accounts")
        .select("account_id")
        .where("account_id", "=", accountId)
        .where("space_id", "=", spaceId)
        .executeTakeFirst();
    if (inSpace) return;

    throw new TRPCError({
        code: "FORBIDDEN",
        message: "The destination account must be yours or shared into this space",
    });
};

const rejectIfLocked = async ({ trx, accountId }: { trx: Kysely<DB>; accountId: string }) => {
    const acct = await trx
        .selectFrom("accounts")
        .select("account_type")
        .where("id", "=", accountId)
        .executeTakeFirst();
    if (!acct) return;
    if ((acct.account_type as unknown as string) === "locked") {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot spend or transfer out of a locked account",
        });
    }
};
