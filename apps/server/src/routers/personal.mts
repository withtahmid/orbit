import { personalAccountDistribution } from "../procedures/personal/accountDistribution.mjs";
import { personalOwnedAccounts } from "../procedures/personal/accounts.mjs";
import { personalAnomaliesOutliers } from "../procedures/personal/anomaliesOutliers.mjs";
import { personalAnomaliesPatternBreaks } from "../procedures/personal/anomaliesPatternBreaks.mjs";
import { personalAnomaliesRecurring } from "../procedures/personal/anomaliesRecurring.mjs";
import { personalAnomaliesShapeStats } from "../procedures/personal/anomaliesShapeStats.mjs";
import { personalAnomaliesStreaks } from "../procedures/personal/anomaliesStreaks.mjs";
import { personalBalanceHistory } from "../procedures/personal/balanceHistory.mjs";
import { personalCashFlow } from "../procedures/personal/cashFlow.mjs";
import { personalCategoryBreakdown } from "../procedures/personal/categoryBreakdown.mjs";
import { personalCategoryMonthlyTrend } from "../procedures/personal/categoryMonthlyTrend.mjs";
import { personalCategoryWoW } from "../procedures/personal/categoryWoW.mjs";
import { personalCumulativeSpend } from "../procedures/personal/cumulativeSpend.mjs";
import { personalEnvelopeRecentAverages } from "../procedures/personal/envelopeRecentAverages.mjs";
import { personalEnvelopeUtilization } from "../procedures/personal/envelopeUtilization.mjs";
import { personalIncomeBreakdown } from "../procedures/personal/incomeBreakdown.mjs";
import { personalListCategories } from "../procedures/personal/listCategories.mjs";
import { personalNetWorthHistory } from "../procedures/personal/netWorthHistory.mjs";
import { personalRecurring } from "../procedures/personal/recurring.mjs";
import { personalSpaceBreakdown } from "../procedures/personal/spaceBreakdown.mjs";
import { personalSpendingHeatmap } from "../procedures/personal/spendingHeatmap.mjs";
import { personalSummary } from "../procedures/personal/summary.mjs";
import { personalTodaySummary } from "../procedures/personal/todaySummary.mjs";
import { personalTopCategories } from "../procedures/personal/topCategories.mjs";
import { personalTopCategoriesByBucket } from "../procedures/personal/topCategoriesByBucket.mjs";
import { personalTopMerchants } from "../procedures/personal/topMerchants.mjs";
import { personalTransactionFilteredTotals } from "../procedures/personal/transactionFilteredTotals.mjs";
import { personalTransactions } from "../procedures/personal/transactions.mjs";
import { personalTrendsCategoryMovers } from "../procedures/personal/trendsCategoryMovers.mjs";
import { personalTrendsDailyComparison } from "../procedures/personal/trendsDailyComparison.mjs";
import { personalTrendsYearOverYear } from "../procedures/personal/trendsYearOverYear.mjs";
import { personalYearReport } from "../procedures/personal/yearReport.mjs";
import { router } from "../trpc/index.mjs";

/**
 * Personal (cross-space) router. Every procedure here is anchored on
 * `user_accounts.role = 'owner'` — the caller's personally-owned
 * accounts — unioned across every space they're currently a member of.
 * Analytics names mirror the per-space `analytics.*` router so the
 * existing views can swap their data source by procedure name alone
 * when the virtual-space sentinel (`spaceId === "me"`) is active.
 */
export const personalRouter = router({
    summary: personalSummary,
    cashFlow: personalCashFlow,
    envelopeRecentAverages: personalEnvelopeRecentAverages,
    yearReport: personalYearReport,
    topCategories: personalTopCategories,
    topCategoriesByBucket: personalTopCategoriesByBucket,
    categoryBreakdown: personalCategoryBreakdown,
    categoryMonthlyTrend: personalCategoryMonthlyTrend,
    envelopeUtilization: personalEnvelopeUtilization,
    balanceHistory: personalBalanceHistory,
    spendingHeatmap: personalSpendingHeatmap,
    accountDistribution: personalAccountDistribution,
    transactions: personalTransactions,
    transactionFilteredTotals: personalTransactionFilteredTotals,
    ownedAccounts: personalOwnedAccounts,
    listCategories: personalListCategories,
    spaceBreakdown: personalSpaceBreakdown,
    /* Overview cards (cross-space variants). */
    todaySummary: personalTodaySummary,
    categoryWoW: personalCategoryWoW,
    cumulativeSpend: personalCumulativeSpend,
    incomeBreakdown: personalIncomeBreakdown,
    topMerchants: personalTopMerchants,
    netWorthHistory: personalNetWorthHistory,
    /* Recurring detector — owned-account streams across all member spaces. */
    recurring: personalRecurring,
    /* Trends view. */
    trends: router({
        dailyComparison: personalTrendsDailyComparison,
        yearOverYear: personalTrendsYearOverYear,
        categoryMovers: personalTrendsCategoryMovers,
    }),
    /* Anomalies view. */
    anomalies: router({
        outliers: personalAnomaliesOutliers,
        recurring: personalAnomaliesRecurring,
        patternBreaks: personalAnomaliesPatternBreaks,
        streaks: personalAnomaliesStreaks,
        shapeStats: personalAnomaliesShapeStats,
    }),
});
