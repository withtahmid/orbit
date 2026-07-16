import { accountBalanceHistory } from "../procedures/analytics/accountBalanceHistory.mjs";
import { accountDistribution } from "../procedures/analytics/accountDistribution.mjs";
import { anomaliesOutliers } from "../procedures/analytics/anomaliesOutliers.mjs";
import { anomaliesPatternBreaks } from "../procedures/analytics/anomaliesPatternBreaks.mjs";
import { anomaliesRecurring } from "../procedures/analytics/anomaliesRecurring.mjs";
import { anomaliesShapeStats } from "../procedures/analytics/anomaliesShapeStats.mjs";
import { anomaliesStreaks } from "../procedures/analytics/anomaliesStreaks.mjs";
import { balanceHistory } from "../procedures/analytics/balanceHistory.mjs";
import { cashFlow } from "../procedures/analytics/cashFlow.mjs";
import { categoryBreakdown } from "../procedures/analytics/categoryBreakdown.mjs";
import { categoryMonthlyTrend } from "../procedures/analytics/categoryMonthlyTrend.mjs";
import { categoryWoW } from "../procedures/analytics/categoryWoW.mjs";
import { cumulativeSpend } from "../procedures/analytics/cumulativeSpend.mjs";
import { envelopeMonthlyAllocations } from "../procedures/analytics/envelopeMonthlyAllocations.mjs";
import { envelopeRecentAverages } from "../procedures/analytics/envelopeRecentAverages.mjs";
import { envelopeUtilization } from "../procedures/analytics/envelopeUtilization.mjs";
import { eventCategoryBreakdown } from "../procedures/analytics/eventCategoryBreakdown.mjs";
import { eventDailySpend } from "../procedures/analytics/eventDailySpend.mjs";
import { eventTopLocations } from "../procedures/analytics/eventTopLocations.mjs";
import { eventTotals } from "../procedures/analytics/eventTotals.mjs";
import { incomeBreakdown } from "../procedures/analytics/incomeBreakdown.mjs";
import { netWorthHistory } from "../procedures/analytics/netWorthHistory.mjs";
import { priorityBreakdown } from "../procedures/analytics/priorityBreakdown.mjs";
import { recurring } from "../procedures/analytics/recurring.mjs";
import { spaceSummary } from "../procedures/analytics/spaceSummary.mjs";
import { spendingHeatmap } from "../procedures/analytics/spendingHeatmap.mjs";
import { yearReport } from "../procedures/analytics/yearReport.mjs";
import { todaySummary } from "../procedures/analytics/todaySummary.mjs";
import { topCategories } from "../procedures/analytics/topCategories.mjs";
import { topCategoriesByBucket } from "../procedures/analytics/topCategoriesByBucket.mjs";
import { topMerchants } from "../procedures/analytics/topMerchants.mjs";
import { trendsCategoryMovers } from "../procedures/analytics/trendsCategoryMovers.mjs";
import { trendsDailyComparison } from "../procedures/analytics/trendsDailyComparison.mjs";
import { trendsYearOverYear } from "../procedures/analytics/trendsYearOverYear.mjs";
import { router } from "../trpc/index.mjs";

export const analyticsRouter = router({
    spaceSummary,
    envelopeRecentAverages,
    yearReport,
    cashFlow,
    categoryBreakdown,
    categoryMonthlyTrend,
    envelopeUtilization,
    envelopeMonthlyAllocations,
    eventTotals,
    eventCategoryBreakdown,
    eventDailySpend,
    eventTopLocations,
    priorityBreakdown,
    topCategories,
    topCategoriesByBucket,
    accountDistribution,
    accountBalanceHistory,
    balanceHistory,
    spendingHeatmap,
    /* Overview cards. */
    todaySummary,
    categoryWoW,
    cumulativeSpend,
    incomeBreakdown,
    topMerchants,
    netWorthHistory,
    /* Recurring detector — feeds BillsCard, SubscriptionsGrid, anomalies. */
    recurring,
    /* Trends view (daily comparison, YoY, category movers). */
    trends: router({
        dailyComparison: trendsDailyComparison,
        yearOverYear: trendsYearOverYear,
        categoryMovers: trendsCategoryMovers,
    }),
    /* Anomalies view. */
    anomalies: router({
        outliers: anomaliesOutliers,
        recurring: anomaliesRecurring,
        patternBreaks: anomaliesPatternBreaks,
        streaks: anomaliesStreaks,
        shapeStats: anomaliesShapeStats,
    }),
});
