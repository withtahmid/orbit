import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveMemberSpaceIds, resolveOwnedAccountIds } from "./shared.mjs";

/**
 * Cross-space personal summary — same shape as analytics.spaceSummary
 * (balance / spendable / locked / envelope / unallocated /
 * period income & expense) so the existing OverviewPage and all its
 * downstream UI can render unchanged when the virtual space is active.
 *
 * Semantics are anchored to the caller's personally-owned accounts
 * (user_accounts.role='owner') unioned across every space they're a
 * member of. Balance and cash-flow figures are owned-account only.
 * Envelope figures split by purpose: `envelopeConsumed` is the
 * caller's own spend ("my slice"), while `envelopeRemaining` (held,
 * which feeds `unallocated`) is space-wide — held is the cash an
 * envelope ties up across the whole space, so it must match
 * analytics.spaceSummary per space (summed over member spaces) or the
 * pool drifts. Goal envelopes (cadence='none' with target) ride the
 * same rules; their balance contributes to envelopeRemaining like any
 * other rolling envelope.
 *
 * Cash-flow semantics (mirrors personal.cashFlow):
 *   - income/adjustment to an owned account        → personal inflow
 *   - expense/adjustment from an owned account     → personal outflow
 *   - transfer owned → non-owned                   → personal outflow
 *   - transfer non-owned → owned                   → personal inflow
 *   - transfer owned → owned (internal rebalance)  → excluded
 */
export const personalSummary = authorizedProcedure
    .input(
        z.object({
            periodStart: z.coerce.date(),
            periodEnd: z.coerce.date(),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            (async () => {
                const owned = await resolveOwnedAccountIds(
                    ctx.services.qb,
                    ctx.auth.user.id
                );
                const memberSpaces = await resolveMemberSpaceIds(
                    ctx.services.qb,
                    ctx.auth.user.id
                );

                if (owned.length === 0 || memberSpaces.length === 0) {
                    return {
                        totalBalance: 0,
                        spendableBalance: 0,
                        lockedBalance: 0,
                        envelopeAllocated: 0,
                        envelopeConsumed: 0,
                        envelopeRemaining: 0,
                        unallocated: 0,
                        isOverAllocated: false,
                        periodIncome: 0,
                        periodExpense: 0,
                        periodNet: 0,
                        operationalIncome: 0,
                        operationalExpense: 0,
                        operationalNet: 0,
                        ownedAccountsCount: owned.length,
                        memberSpacesCount: memberSpaces.length,
                    };
                }

                const balanceRow = await sql<{
                    total_balance: string;
                    spendable_balance: string;
                    locked_balance: string;
                }>`
                    SELECT
                        COALESCE(SUM(
                            CASE a.account_type
                                WHEN 'liability' THEN -ab.balance
                                ELSE ab.balance
                            END
                        ), 0)::text AS total_balance,
                        COALESCE(SUM(
                            CASE a.account_type
                                WHEN 'liability' THEN -ab.balance
                                WHEN 'locked' THEN 0
                                ELSE ab.balance
                            END
                        ), 0)::text AS spendable_balance,
                        COALESCE(SUM(
                            CASE a.account_type
                                WHEN 'locked' THEN ab.balance
                                ELSE 0
                            END
                        ), 0)::text AS locked_balance
                    FROM account_balances ab
                    JOIN accounts a ON a.id = ab.account_id
                    WHERE ab.account_id = ANY(${owned})
                `
                    .execute(ctx.services.qb)
                    .then((r) => r.rows[0]);

                // Envelope aggregates. Allocation is space-wide (no per-
                // account dimension), so p_allocated is the envelope's full
                // current-period allocation. Two consumption figures are
                // computed for DIFFERENT purposes — conflating them was a bug:
                //
                //   * p_consumed_owned — the caller's OWN spend (source is an
                //     owned account). Surfaced as the "Envelope spend" stat in
                //     the personal Overview; it should read as *my* spending.
                //
                //   * p_consumed_all — SPACE-WIDE spend on the envelope,
                //     regardless of who spent it. HELD is a space-wide cash
                //     concept (the envelope ties up the space's cash, not one
                //     member's), so held must use this:
                //         held = GREATEST(0, allocated − space-wide consumed)
                //     which makes each envelope's held identical to
                //     analytics.spaceSummary's, and the sum the true held
                //     across every space the caller belongs to. The previous
                //     code used owned-only consumed in the held formula while
                //     allocation stayed space-wide — an apples-to-oranges mix
                //     that OVERSTATED held (a co-member's spend wasn't
                //     subtracted) and so understated the personal unbudgeted
                //     pool in any shared space. Clamped at 0: overspent cash
                //     already left the accounts and never inflates the pool.
                //
                // Monthly envelopes reset each period; rolling/goal use the
                // lifetime pool. No carry-over.
                const envelopeRow = await sql<{
                    allocated: string;
                    consumed: string;
                    remaining: string;
                }>`
                    WITH period AS (
                        SELECT
                            e.id AS envelop_id,
                            e.cadence,
                            CASE e.cadence
                                WHEN 'none' THEN DATE '1970-01-01'
                                WHEN 'monthly' THEN ${input.periodStart}::timestamptz::date
                            END AS p_start,
                            CASE e.cadence
                                WHEN 'none' THEN DATE '9999-12-31'
                                WHEN 'monthly' THEN ${input.periodEnd}::timestamptz::date
                            END AS p_end,
                            -- Raw-instant twins for the transaction filters:
                            -- the date-typed bounds above serve the date-column
                            -- allocation match; against timestamptz
                            -- transaction_datetime they'd round the window to
                            -- APP_TZ midnights (lossless only for midnight-
                            -- aligned callers). Mirrors analytics.spaceSummary.
                            CASE e.cadence
                                WHEN 'none' THEN TIMESTAMPTZ '1970-01-01 00:00:00+00'
                                WHEN 'monthly' THEN ${input.periodStart}::timestamptz
                            END AS p_start_ts,
                            CASE e.cadence
                                WHEN 'none' THEN TIMESTAMPTZ '9999-12-31 00:00:00+00'
                                WHEN 'monthly' THEN ${input.periodEnd}::timestamptz
                            END AS p_end_ts
                        FROM envelops e
                        WHERE e.space_id = ANY(${memberSpaces})
                    ),
                    per_env AS (
                        SELECT
                            p.envelop_id,
                            COALESCE((
                                SELECT SUM(a.amount)
                                FROM envelop_allocations a
                                WHERE a.envelop_id = p.envelop_id
                                  AND (
                                      (p.cadence = 'none' AND a.period_start IS NULL)
                                      OR (
                                          p.cadence <> 'none'
                                          AND a.period_start >= p.p_start
                                          AND a.period_start < p.p_end
                                      )
                                  )
                            ), 0) AS p_allocated,
                            -- My own spend (owned-account expenses) — the
                            -- "Envelope spend" stat. NOT used for held.
                            COALESCE((
                                SELECT SUM(t.amount)
                                FROM transactions t
                                WHERE t.envelop_id = p.envelop_id
                                  AND t.type = 'expense'
                                  AND t.source_account_id = ANY(${owned})
                                  AND t.transaction_datetime >= p.p_start_ts
                                  AND t.transaction_datetime < p.p_end_ts
                            ), 0) AS p_consumed_owned,
                            -- Space-wide spend on the envelope (any account) —
                            -- drives held, matching analytics.spaceSummary.
                            COALESCE((
                                SELECT SUM(t.amount)
                                FROM transactions t
                                WHERE t.envelop_id = p.envelop_id
                                  AND t.type = 'expense'
                                  AND t.transaction_datetime >= p.p_start_ts
                                  AND t.transaction_datetime < p.p_end_ts
                            ), 0) AS p_consumed_all
                        FROM period p
                    )
                    SELECT
                        COALESCE(SUM(p_allocated), 0)::text AS allocated,
                        COALESCE(SUM(p_consumed_owned), 0)::text AS consumed,
                        COALESCE(SUM(GREATEST(0, p_allocated - p_consumed_all)), 0)::text AS remaining
                    FROM per_env
                `
                    .execute(ctx.services.qb)
                    .then((r) => r.rows[0]);

                /* Personal flow — two views computed in one pass:
                 *
                 * `cash_*` — CASH FLOW. Owned↔owned transfers excluded
                 *   (internal rebalance, net zero). Owned↔non-owned
                 *   transfer principal counts directionally as
                 *   inflow/outflow. Fees count as outflow whenever the
                 *   source is owned.
                 *
                 * `operational_*` — TRUE INCOME / EXPENSE. Excludes ALL
                 *   transfer principal regardless of direction. Keeps
                 *   only `type='income'` deposits, `type='expense'`
                 *   debits, `type='adjustment'`, and transfer fees.
                 */
                const flowRow = await sql<{
                    cash_income: string;
                    cash_expense: string;
                    operational_income: string;
                    operational_expense: string;
                }>`
                    SELECT
                        COALESCE(SUM(CASE
                            WHEN type = 'income' AND destination_account_id = ANY(${owned}) THEN amount
                            WHEN type = 'transfer'
                                AND destination_account_id = ANY(${owned})
                                AND source_account_id <> ALL(${owned}) THEN amount
                            WHEN type = 'adjustment' AND destination_account_id = ANY(${owned}) THEN amount
                            ELSE 0
                        END), 0)::text AS cash_income,
                        COALESCE(SUM(
                            CASE
                                WHEN type = 'expense' AND source_account_id = ANY(${owned}) THEN amount
                                WHEN type = 'transfer'
                                    AND source_account_id = ANY(${owned})
                                    AND destination_account_id <> ALL(${owned}) THEN amount
                                WHEN type = 'adjustment' AND source_account_id = ANY(${owned}) THEN amount
                                ELSE 0
                            END
                        ), 0)::text AS cash_expense,
                        COALESCE(SUM(CASE
                            WHEN type = 'income' AND destination_account_id = ANY(${owned}) THEN amount
                            WHEN type = 'adjustment' AND destination_account_id = ANY(${owned}) THEN amount
                            ELSE 0
                        END), 0)::text AS operational_income,
                        COALESCE(SUM(
                            CASE
                                WHEN type = 'expense' AND source_account_id = ANY(${owned}) THEN amount
                                WHEN type = 'adjustment' AND source_account_id = ANY(${owned}) THEN amount
                                ELSE 0
                            END
                        ), 0)::text AS operational_expense
                    FROM transactions
                    WHERE space_id = ANY(${memberSpaces})
                      AND transaction_datetime >= ${input.periodStart}
                      AND transaction_datetime < ${input.periodEnd}
                      AND (
                          source_account_id = ANY(${owned})
                          OR destination_account_id = ANY(${owned})
                      )
                `
                    .execute(ctx.services.qb)
                    .then((r) => r.rows[0]);

                const totalBalance = Number(balanceRow?.total_balance ?? 0);
                const spendableBalance = Number(balanceRow?.spendable_balance ?? 0);
                const lockedBalance = Number(balanceRow?.locked_balance ?? 0);
                const envelopeAllocated = Number(envelopeRow?.allocated ?? 0);
                const envelopeConsumed = Number(envelopeRow?.consumed ?? 0);
                const envelopeRemaining = Number(envelopeRow?.remaining ?? 0);
                const cashIncome = Number(flowRow?.cash_income ?? 0);
                const cashExpense = Number(flowRow?.cash_expense ?? 0);
                const operationalIncome = Number(
                    flowRow?.operational_income ?? 0
                );
                const operationalExpense = Number(
                    flowRow?.operational_expense ?? 0
                );

                const unallocated = spendableBalance - envelopeRemaining;

                return {
                    totalBalance,
                    spendableBalance,
                    lockedBalance,
                    envelopeAllocated,
                    envelopeConsumed,
                    envelopeRemaining,
                    unallocated,
                    // Sub-cent epsilon: two PG-rounded numeric(20,2) sums can
                    // leave a −0.00x residue when spendable exactly equals held;
                    // without the guard the UI flips to "Over-budgeted by 0.00".
                    isOverAllocated: unallocated < -0.005,
                    /* `period*` = cash flow. `operational*` = excludes
                       all transfer principal. See SQL block above. */
                    periodIncome: cashIncome,
                    periodExpense: cashExpense,
                    periodNet: cashIncome - cashExpense,
                    operationalIncome,
                    operationalExpense,
                    operationalNet: operationalIncome - operationalExpense,
                    ownedAccountsCount: owned.length,
                    memberSpacesCount: memberSpaces.length,
                };
            })()
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute personal summary",
            });
        }
        return result;
    });
