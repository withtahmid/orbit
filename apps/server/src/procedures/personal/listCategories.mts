import { TRPCError } from "@trpc/server";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveMemberSpaceIds } from "./shared.mjs";

/**
 * Every expense category across the caller's member spaces, flat list
 * with `space_id` and `space_name` on each row (superset of
 * expenseCategory.listBySpace's columns) so the virtual-space
 * TransactionsPage can render its category filter and disambiguate
 * same-named categories from different spaces. Categories are
 * space-scoped — parent_id relationships only make sense within one
 * space — so consumers that build tree views should group by
 * space_id first.
 */
export const personalListCategories = authorizedProcedure.query(async ({ ctx }) => {
    const [error, rows] = await safeAwait(
        (async () => {
            const memberSpaces = await resolveMemberSpaceIds(ctx.services.qb, ctx.auth.user.id);
            if (memberSpaces.length === 0) return [];
            return ctx.services.qb
                .selectFrom("expense_categories")
                .innerJoin("spaces", "spaces.id", "expense_categories.space_id")
                .select([
                    "expense_categories.id",
                    "expense_categories.space_id",
                    "spaces.name as space_name",
                    "expense_categories.parent_id",
                    "expense_categories.name",
                    "expense_categories.color",
                    "expense_categories.icon",
                    "expense_categories.priority",
                    "expense_categories.created_at",
                    "expense_categories.updated_at",
                ])
                .where("expense_categories.space_id", "in", memberSpaces)
                .orderBy("spaces.name", "asc")
                .orderBy("expense_categories.created_at", "asc")
                .execute();
        })()
    );
    if (error) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message || "Failed to list personal categories",
        });
    }
    return rows ?? [];
});
