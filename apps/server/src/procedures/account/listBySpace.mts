import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";
import type { SpaceMembers, UserAccounts } from "../../db/kysely/types.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { TRPCError } from "@trpc/server";

/**
 * All accounts shared into this space. Access is gated by space membership
 * alone — once an account is shared into a space, every space member can
 * see it, and every space owner/editor may pay INTO it (income or transfer
 * destination). Money may only LEAVE it if the caller is an account owner
 * (`resolveTransactionPermission`). Account-level ACL (`user_accounts`)
 * also governs edits to the account row itself (name, sharing, delete).
 *
 * `myRole` is the caller's role in `user_accounts` (if any), surfaced so
 * the UI can gate account-level mutations and the "from" dropdowns. It is
 * `null` when the caller has no `user_accounts` row — which is legal: they
 * can still see the account and send money to it in this space, but cannot
 * spend from, rename, share or delete it.
 */
export const listAccountsBySpace = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
        })
    )
    .query(async ({ ctx, input }) => {
        await resolveSpaceMembership({
            trx: ctx.services.qb,
            spaceId: input.spaceId,
            userId: ctx.auth.user.id,
            roles: ["owner", "editor", "viewer"] as unknown as SpaceMembers["role"][],
        });

        const [error, accounts] = await safeAwait(
            ctx.services.qb
                .selectFrom("accounts")
                .innerJoin("space_accounts", "space_accounts.account_id", "accounts.id")
                .leftJoin("user_accounts", (join) =>
                    join
                        .onRef("user_accounts.account_id", "=", "accounts.id")
                        .on("user_accounts.user_id", "=", ctx.auth.user.id)
                )
                .innerJoin("account_balances", "account_balances.account_id", "accounts.id")
                .where("space_accounts.space_id", "=", input.spaceId)
                .select([
                    "accounts.id",
                    "accounts.name",
                    "accounts.account_type",
                    "accounts.color",
                    "accounts.icon",
                    "account_balances.balance",
                    "user_accounts.role as my_role",
                ])
                .execute()
        );
        if (error) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to fetch accounts for space",
            });
        }
        const accountIds = (accounts ?? []).map((a) => a.id);
        const ownersByAccount = new Map<
            string,
            Array<{ id: string; first_name: string; avatar_file_id: string | null }>
        >();
        if (accountIds.length > 0) {
            const ownerRows = await ctx.services.qb
                .selectFrom("user_accounts as ua")
                .innerJoin("users as u", "u.id", "ua.user_id")
                .where("ua.account_id", "in", accountIds)
                .where("ua.role", "=", "owner" as unknown as UserAccounts["role"])
                .select(["ua.account_id", "u.id", "u.first_name", "u.avatar_file_id"])
                .execute();
            for (const row of ownerRows) {
                const list = ownersByAccount.get(row.account_id) ?? [];
                list.push({
                    id: row.id,
                    first_name: row.first_name,
                    avatar_file_id: row.avatar_file_id,
                });
                ownersByAccount.set(row.account_id, list);
            }
        }
        return (accounts ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            account_type: a.account_type as unknown as "asset" | "liability" | "locked",
            color: a.color,
            icon: a.icon,
            balance: Number(a.balance ?? 0),
            myRole: (a.my_role ?? null) as "owner" | "viewer" | null,
            owners: ownersByAccount.get(a.id) ?? [],
        }));
    });
