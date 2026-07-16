import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
    ArrowLeft,
    CalendarDays,
    FileText,
    MapPin,
    Receipt,
    Search,
    TrendingUp,
    X,
} from "lucide-react";
import { format as dfFormat } from "date-fns";
import { PermissionGate } from "@/components/shared/PermissionGate";
import { trpc } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatInAppTz } from "@/lib/formatDate";
import { ROUTES } from "@/router/routes";
import { CreateOrEditEventDialog } from "./CreateOrEditEventDialog";
import { DeleteEventDialog } from "./DeleteEventDialog";
import { EventStatusButton } from "./EventStatusButton";
import { EntityAvatar, Money, Skeleton } from "./eventUI";
import { CategoryDonutChart, RadialBudgetGauge, SpendTimelineChart } from "./eventCharts";
import {
    appDayStr,
    buildCategoryTree,
    daySpanInclusive,
    parseAppDay,
    type BreakdownRow,
    type CatInput,
    type DailyRow,
    type LocationRow,
} from "./eventUtils";
import { eventCalendarState, type EventStatus, type EventTotal } from "./types";

const DAY_MS = 86_400_000;

/* Calendar days from an event's start day through `now` (APP_TZ), inclusive,
   clamped to the event's own span. 0 while the event is still upcoming. */
function elapsedDays(event: EventTotal, now: Date): number {
    const startDay = appDayStr(event.startTime);
    const nowDay = appDayStr(now);
    if (nowDay < startDay) return 0;
    const endDay = appDayStr(event.endTime);
    const capDay = nowDay < endDay ? nowDay : endDay;
    return daySpanInclusive(startDay, capDay);
}

export default function EventDetailPage() {
    const { eventId = "" } = useParams<{ eventId: string }>();
    const { space } = useCurrentSpace();

    const eventQuery = trpc.event.getById.useQuery({ eventId }, { enabled: !!eventId });
    /* Use analytics.eventTotals (narrowed to this event) so the "Spent"
       number on the detail page matches the card on the list. */
    const totalsQuery = trpc.analytics.eventTotals.useQuery(
        { spaceId: space.id, eventId },
        { enabled: !!eventId }
    );
    const eventTotalsRow = totalsQuery.data?.[0];
    const breakdownQuery = trpc.analytics.eventCategoryBreakdown.useQuery(
        { eventId },
        { enabled: !!eventId }
    );
    /* Full category tree (id/parent/name/color/icon) so the breakdown donut
       can roll leaf spend up into drillable roots. */
    const categoriesQuery = trpc.expenseCategory.listBySpace.useQuery(
        { spaceId: space.id },
        { enabled: !!eventId }
    );
    const dailyQuery = trpc.analytics.eventDailySpend.useQuery({ eventId }, { enabled: !!eventId });
    const locationsQuery = trpc.analytics.eventTopLocations.useQuery(
        { eventId, limit: 8 },
        { enabled: !!eventId }
    );
    const filesQuery = trpc.file.listForEvent.useQuery({ eventId }, { enabled: !!eventId });

    const event = useMemo<EventTotal | null>(() => {
        if (!eventQuery.data) return null;
        const d = eventQuery.data;
        return {
            eventId: d.id,
            name: d.name,
            color: d.color,
            icon: d.icon,
            startTime: new Date(d.start_time),
            endTime: new Date(d.end_time),
            description: d.description,
            estimatedAmount: d.estimated_amount === null ? null : Number(d.estimated_amount),
            status: d.status as EventStatus,
            closedAt: d.closed_at ? new Date(d.closed_at) : null,
            expenseTotal: eventTotalsRow?.expenseTotal ?? 0,
            incomeTotal: eventTotalsRow?.incomeTotal ?? 0,
            txCount: eventTotalsRow?.txCount ?? 0,
        };
    }, [eventQuery.data, eventTotalsRow]);

    const dailyData = (dailyQuery.data ?? []) as DailyRow[];
    /* Memoized so its identity is stable across unrelated refetches — an
       inline .map() would churn every render and reset the donut's drill /
       pinned state via the category card's clear-effect. */
    const categories = useMemo<CatInput[]>(
        () =>
            (categoriesQuery.data ?? []).map((c) => ({
                id: c.id,
                name: c.name,
                color: c.color,
                icon: c.icon,
                parentId: c.parent_id,
            })),
        [categoriesQuery.data]
    );
    /* Whether the category card will render anything — drives the Budget row
       layout (paired 2-col vs. Budget solo full-width). */
    const showCategory =
        breakdownQuery.isLoading ||
        categoriesQuery.isLoading ||
        (breakdownQuery.data?.length ?? 0) > 0;

    return (
        <div
            className="orbit-design ev-root"
            style={event ? { ["--ev-accent" as never]: event.color } : undefined}
        >
            <style>{ED_STYLES}</style>

            <header className="ev-detail-topbar">
                <Link to={ROUTES.spaceEvents(space.id)} className="ev-back">
                    <ArrowLeft className="size-3.5" /> Events
                </Link>
            </header>

            <div className="ev-detail-scroll">
                {eventQuery.isLoading || totalsQuery.isLoading || !event ? (
                    <>
                        <Skeleton height={210} />
                        <Skeleton height={300} />
                        <Skeleton height={280} />
                    </>
                ) : eventQuery.isError ? (
                    <div className="od-card ev-detail-empty">
                        <CalendarDays className="size-6" style={{ color: "var(--fg-4)" }} />
                        <div style={{ fontSize: 14, color: "var(--fg-2)", fontWeight: 500 }}>
                            Event not found
                        </div>
                        <Link to={ROUTES.spaceEvents(space.id)} className="od-btn od-btn-sm">
                            <ArrowLeft className="size-3" /> Back to events
                        </Link>
                    </div>
                ) : (
                    <>
                        <HeroBand event={event} daily={dailyData} />

                        <div
                            className={`ev-grid-budget${
                                showCategory ? "" : " ev-grid-budget--solo"
                            }`}
                        >
                            <BudgetCard event={event} />
                            {showCategory && (
                                <CategoryCard
                                    breakdown={breakdownQuery.data as BreakdownRow[] | undefined}
                                    categories={categories}
                                    isLoading={
                                        breakdownQuery.isLoading || categoriesQuery.isLoading
                                    }
                                />
                            )}
                        </div>

                        <TimelineCard
                            event={event}
                            daily={dailyData}
                            isLoading={dailyQuery.isLoading}
                        />

                        <WhereCard
                            locations={locationsQuery.data ?? []}
                            isLoading={locationsQuery.isLoading}
                        />

                        <TransactionsCard
                            spaceId={space.id}
                            eventId={eventId}
                            color={event.color}
                            eventClosed={event.status === "closed"}
                            categoryOptions={
                                (breakdownQuery.data as BreakdownRow[] | undefined) ?? []
                            }
                        />

                        {(filesQuery.data?.length ?? 0) > 0 && (
                            <AttachmentsCard files={filesQuery.data ?? []} />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ *
 *  Hero band
 * ------------------------------------------------------------------ */

function HeroBand({ event, daily }: { event: EventTotal; daily: DailyRow[] }) {
    const closed = event.status === "closed";
    const now = new Date();
    const calState = eventCalendarState(event.startTime, event.endTime, now);

    const startDay = appDayStr(event.startTime);
    const endDay = appDayStr(event.endTime);
    const nowDay = appDayStr(now);
    const totalDays = daySpanInclusive(startDay, endDay);
    const daysLeft = Math.max(
        0,
        Math.round((parseAppDay(endDay).getTime() - parseAppDay(nowDay).getTime()) / DAY_MS)
    );

    /* A single state pill folds lifecycle + calendar-state + timing into one
       colour-coded phrase. */
    const state = closed
        ? {
              label: event.closedAt
                  ? `Closed · ${formatInAppTz(event.closedAt, "MMM d")}`
                  : "Closed",
              color: "var(--fg-3)",
          }
        : calState === "Upcoming"
          ? {
                label: `Upcoming · starts ${formatInAppTz(event.startTime, "MMM d")}`,
                color: "var(--transfer)",
            }
          : calState === "Active"
            ? {
                  label:
                      daysLeft > 0
                          ? `Happening now · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`
                          : "Happening now · last day",
                  color: "var(--income)",
              }
            : calState === "Recent"
              ? { label: "Just wrapped", color: "var(--gold)" }
              : { label: `Ended · ${formatInAppTz(event.endTime, "MMM d")}`, color: "var(--fg-3)" };

    return (
        <div className="od-card ev-hero vignette">
            <div className="ev-hero-head">
                <div className="ev-hero-id">
                    <EntityAvatar icon={event.icon} colorVar={event.color} size={56} />
                    <div className="ev-hero-idtext">
                        <div className="ev-eyebrow-row">
                            <span className="eyebrow">Event</span>
                            <span className="ev-state" style={{ ["--chip" as never]: state.color }}>
                                <span className="ev-state-dot" aria-hidden />
                                {state.label}
                            </span>
                        </div>
                        <h1 className="display ev-hero-title">{event.name}</h1>
                        <div className="ev-hero-meta">
                            <CalendarDays className="size-3.5" style={{ color: "var(--fg-4)" }} />
                            <span>
                                {formatInAppTz(event.startTime, "MMM d")} –{" "}
                                {formatInAppTz(event.endTime, "MMM d, yyyy")}
                            </span>
                            <span className="ev-meta-sep" aria-hidden>
                                ·
                            </span>
                            <span>{totalDays}-day event</span>
                        </div>
                        {event.description && <p className="ev-hero-desc">{event.description}</p>}
                    </div>
                </div>

                <PermissionGate roles={["owner", "editor"]}>
                    <div className="ev-hero-actions">
                        <CreateOrEditEventDialog
                            event={event}
                            trigger={
                                <button type="button" className="od-btn od-btn-sm">
                                    Edit
                                </button>
                            }
                        />
                        <EventStatusButton
                            eventId={event.eventId}
                            status={event.status}
                            variant="labeled"
                        />
                        <DeleteEventDialog
                            eventId={event.eventId}
                            linkedTransactionCount={event.txCount}
                            trigger={
                                <button
                                    type="button"
                                    className="od-btn od-btn-sm"
                                    style={{ color: "var(--expense)" }}
                                >
                                    Delete
                                </button>
                            }
                        />
                    </div>
                </PermissionGate>
            </div>

            <div className="ev-hero-metrics">
                <StatTiles event={event} daily={daily} />
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ *
 *  Stat tiles (bento)
 * ------------------------------------------------------------------ */

function StatTiles({ event, daily }: { event: EventTotal; daily: DailyRow[] }) {
    const closed = event.status === "closed";
    const now = new Date();
    const calState = eventCalendarState(event.startTime, event.endTime, now);
    const upcoming = calState === "Upcoming";
    const hasIncome = event.incomeTotal > 0;

    /* Denominator counts calendar days — the full span for closed events,
       days-elapsed-so-far for running ones. Upcoming events haven't
       accrued a day yet, so avg/day is not shown (dividing pre-booked
       spend by 1 day would wildly overstate the rate). */
    const totalDays = daySpanInclusive(appDayStr(event.startTime), appDayStr(event.endTime));
    const denom = closed ? totalDays : Math.max(1, elapsedDays(event, now));
    const avgPerDay = event.expenseTotal / denom;

    const peak = useMemo(() => {
        let best: DailyRow | null = null;
        for (const r of daily) if (!best || r.expense > best.expense) best = r;
        return best && best.expense > 0 ? best : null;
    }, [daily]);

    const net = event.incomeTotal - event.expenseTotal;

    /* Card-less metrics band: Spent leads (large), the rest follow — each a
       label + value + sub. No per-metric card chrome; a small accent dot
       carries the semantic colour. */
    const stats: Array<{
        key: string;
        label: string;
        accent: string;
        value: ReactNode;
        sub?: string;
        lead?: boolean;
    }> = [];
    stats.push({
        key: "spent",
        label: closed ? "Final spend" : "Spent",
        accent: "var(--expense)",
        lead: true,
        value: (
            <Money
                amount={event.expenseTotal}
                size={30}
                weight={500}
                variant={event.expenseTotal ? "expense" : "muted"}
            />
        ),
        sub: closed ? "final" : "so far",
    });
    if (hasIncome) {
        stats.push({
            key: "received",
            label: "Received",
            accent: "var(--income)",
            value: <Money amount={event.incomeTotal} size={20} weight={500} variant="income" />,
            sub: "income",
        });
        stats.push({
            key: "net",
            label: "Net",
            accent: net < 0 ? "var(--expense)" : "var(--income)",
            value: (
                <Money
                    amount={net}
                    size={20}
                    weight={500}
                    variant={net < 0 ? "expense" : net > 0 ? "income" : "muted"}
                    signed={net !== 0}
                />
            ),
            sub: net < 0 ? "out of pocket" : net > 0 ? "surplus" : "even",
        });
    }
    if (event.estimatedAmount !== null && event.estimatedAmount > 0)
        stats.push({
            key: "estimate",
            label: "Estimate",
            accent: "var(--gold)",
            value: <Money amount={event.estimatedAmount} size={20} weight={500} />,
            sub: "budget",
        });
    stats.push({
        key: "txns",
        label: "Transactions",
        accent: "var(--transfer)",
        value: (
            <span className="tabular" style={{ fontSize: 20, fontWeight: 500 }}>
                {event.txCount}
            </span>
        ),
        sub: "linked",
    });
    if (!upcoming)
        stats.push({
            key: "avg",
            label: "Avg / day",
            accent: "var(--brand)",
            value: <Money amount={avgPerDay} size={20} weight={500} />,
            sub: `over ${denom} ${denom === 1 ? "day" : "days"}`,
        });
    if (peak)
        stats.push({
            key: "busiest",
            label: "Busiest day",
            accent: "var(--warn)",
            value: <Money amount={peak.expense} size={20} weight={500} variant="expense" />,
            sub: dfFormat(parseAppDay(peak.date), "EEE, MMM d"),
        });

    return (
        <div className="ev-kpis">
            {stats.map((s) => (
                <div key={s.key} className={`ev-kpi${s.lead ? " ev-kpi--lead" : ""}`}>
                    <span className="ev-kpi-label">
                        <span className="ev-kpi-dot" style={{ background: s.accent }} aria-hidden />
                        {s.label}
                    </span>
                    <div className="ev-kpi-value">{s.value}</div>
                    {s.sub && <span className="ev-kpi-sub">{s.sub}</span>}
                </div>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ *
 *  Budget gauge card
 * ------------------------------------------------------------------ */

function BudgetCard({ event }: { event: EventTotal }) {
    const hasEstimate = event.estimatedAmount !== null && event.estimatedAmount > 0;
    const closed = event.status === "closed";

    return (
        <div className="od-card ev-detail-section ev-budget-card">
            <div className="ev-sect-head">
                <div className="ev-sect-text">
                    <h2 className="display ev-sect-title">{closed ? "Final budget" : "Budget"}</h2>
                    <span className="ev-sect-sub">
                        {hasEstimate
                            ? closed
                                ? "Spent vs. estimate"
                                : "Spend against the estimate"
                            : "No estimate set"}
                    </span>
                </div>
            </div>

            {hasEstimate ? (
                <div className="ev-budget-body">
                    <RadialBudgetGauge
                        spent={event.expenseTotal}
                        estimate={event.estimatedAmount as number}
                        size={176}
                    />
                </div>
            ) : (
                <div className="ev-budget-empty">
                    <PermissionGate
                        roles={["owner", "editor"]}
                        fallback={
                            <span style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.5 }}>
                                No estimate has been set for this event.
                            </span>
                        }
                    >
                        <span style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.5 }}>
                            Set an estimate to track spend against a budget and unlock the pacing
                            line on the timeline.
                        </span>
                        <CreateOrEditEventDialog
                            event={event}
                            trigger={
                                <button type="button" className="od-btn od-btn-sm">
                                    Set estimate
                                </button>
                            }
                        />
                    </PermissionGate>
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ *
 *  Timeline card
 * ------------------------------------------------------------------ */

function TimelineCard({
    event,
    daily,
    isLoading,
}: {
    event: EventTotal;
    daily: DailyRow[];
    isLoading: boolean;
}) {
    return (
        <div className="od-card ev-detail-section">
            <div className="ev-sect-head">
                <div className="ev-sect-text">
                    <h2 className="display ev-sect-title">Spending over time</h2>
                    <span className="ev-sect-sub">
                        Cumulative burn{event.estimatedAmount ? " vs. pace" : ""} · daily volume
                    </span>
                </div>
                <TrendingUp className="size-4" style={{ color: "var(--fg-4)" }} />
            </div>
            {isLoading ? (
                <Skeleton height={366} />
            ) : daily.length === 0 ? (
                <div className="ev-mini-empty">No dated spending yet.</div>
            ) : (
                <SpendTimelineChart
                    data={daily}
                    estimate={event.estimatedAmount}
                    startTime={event.startTime}
                    endTime={event.endTime}
                    color={event.color}
                />
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ *
 *  Category composition card
 * ------------------------------------------------------------------ */

function CategoryCard({
    breakdown,
    categories,
    isLoading,
}: {
    breakdown: BreakdownRow[] | undefined;
    categories: CatInput[];
    isLoading: boolean;
}) {
    const roots = useMemo(
        () => buildCategoryTree(categories, breakdown ?? []),
        [categories, breakdown]
    );
    const count = breakdown?.length ?? 0;

    if (isLoading) return <Skeleton height={300} />;
    if (roots.length === 0) return null;

    return (
        <div className="od-card ev-detail-section">
            <div className="ev-sect-head">
                <div className="ev-sect-text">
                    <h2 className="display ev-sect-title">Spending by category</h2>
                    <span className="ev-sect-sub">
                        {count} {count === 1 ? "category" : "categories"} · click a slice to drill
                        in
                    </span>
                </div>
            </div>
            <CategoryDonutChart roots={roots} />
        </div>
    );
}

/* ------------------------------------------------------------------ *
 *  Where it went — top locations + day-of-week
 * ------------------------------------------------------------------ */

function WhereCard({ locations, isLoading }: { locations: LocationRow[]; isLoading: boolean }) {
    if (isLoading) return <Skeleton height={160} />;
    if (locations.length === 0) return null;

    const maxLoc = locations.reduce((m, r) => Math.max(m, r.total), 0);

    return (
        <div className="od-card ev-detail-section">
            <div className="ev-sect-head">
                <div className="ev-sect-text">
                    <h2 className="display ev-sect-title">Where it went</h2>
                    <span className="ev-sect-sub">Top spending locations</span>
                </div>
            </div>
            <div className="ev-where-locations">
                {locations.map((l) => {
                    const w = maxLoc > 0 ? (l.total / maxLoc) * 100 : 0;
                    return (
                        <div key={l.location} className="ev-loc-row">
                            <span className="ev-loc-name">
                                <MapPin
                                    className="size-3"
                                    style={{ color: "var(--fg-4)", flexShrink: 0 }}
                                />
                                {l.location}
                            </span>
                            <span className="ev-loc-bar">
                                <span
                                    className="ev-loc-fill"
                                    style={{ width: `${Math.max(w, 3)}%` }}
                                />
                            </span>
                            <span className="ev-loc-amt">
                                <Money amount={l.total} size={12.5} weight={500} />
                                <span className="ev-loc-count">
                                    {l.txCount} {l.txCount === 1 ? "tx" : "txs"}
                                </span>
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ *
 *  Transactions feed
 * ------------------------------------------------------------------ */

type TxType = "income" | "expense" | "transfer" | "adjustment";

const TX_TYPE_CHIPS: Array<{ value: TxType | null; label: string }> = [
    { value: null, label: "All" },
    { value: "expense", label: "Expense" },
    { value: "income", label: "Income" },
    { value: "transfer", label: "Transfer" },
    { value: "adjustment", label: "Adjustment" },
];

function TransactionsCard({
    spaceId,
    eventId,
    color,
    eventClosed,
    categoryOptions,
}: {
    spaceId: string;
    eventId: string;
    color: string;
    eventClosed: boolean;
    categoryOptions: BreakdownRow[];
}) {
    const [type, setType] = useState<TxType | null>(null);
    const [categoryId, setCategoryId] = useState<string>("");
    const [searchRaw, setSearchRaw] = useState("");
    /* Trim + cap before debouncing so a whitespace-only or over-long query
       never hits the server (the procedure's zod `.min(1).max(255)` would
       400 and blank the list). */
    const searchTerm = searchRaw.trim().slice(0, 255);
    const search = useDebouncedValue(searchTerm, 300);

    const listQuery = trpc.transaction.listBySpace.useInfiniteQuery(
        {
            spaceId,
            eventId,
            type,
            expenseCategoryId: categoryId || null,
            search: search || null,
            limit: 50,
        },
        {
            enabled: !!eventId,
            getNextPageParam: (last) => last.nextCursor,
        }
    );

    const transactions = useMemo(
        () => listQuery.data?.pages.flatMap((p) => p.items) ?? [],
        [listQuery.data]
    );
    const isLoading = listQuery.isLoading;
    const isFetching = listQuery.isFetching;
    const hasNextPage = listQuery.hasNextPage ?? false;
    const isFetchingNextPage = listQuery.isFetchingNextPage ?? false;

    /* Key off the immediate input (not the debounced value) so the Clear
       button and count label respond instantly rather than lagging 300ms. */
    const hasFilters = type !== null || categoryId !== "" || searchTerm !== "";
    const clearFilters = () => {
        setType(null);
        setCategoryId("");
        setSearchRaw("");
    };

    return (
        <div className="od-card ev-detail-section">
            <div className="ev-sect-head">
                <div className="ev-sect-text">
                    <h2 className="display ev-sect-title">Transactions</h2>
                    <span className="ev-sect-sub">
                        {isLoading
                            ? "Loading…"
                            : `${transactions.length}${hasNextPage ? "+" : ""} ${
                                  hasFilters ? "matching" : "linked"
                              }${isFetching && !isFetchingNextPage ? " · updating…" : ""}`}
                    </span>
                </div>
                {hasFilters && (
                    <button
                        type="button"
                        className="od-btn od-btn-ghost od-btn-sm"
                        onClick={clearFilters}
                    >
                        <X className="size-3" /> Clear
                    </button>
                )}
            </div>

            <div className="ev-tx-filters">
                <label className="ev-tx-search">
                    <Search className="size-3.5" style={{ color: "var(--fg-4)", flexShrink: 0 }} />
                    <input
                        className="ev-tx-search-input"
                        aria-label="Search transactions"
                        placeholder="Search description or location…"
                        value={searchRaw}
                        onChange={(e) => setSearchRaw(e.target.value)}
                    />
                    {searchRaw && (
                        <button
                            type="button"
                            className="ev-tx-search-clear"
                            onClick={() => setSearchRaw("")}
                            aria-label="Clear search"
                        >
                            <X className="size-3" />
                        </button>
                    )}
                </label>
                {categoryOptions.length > 0 && (
                    <select
                        className="ev-tx-select"
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                        aria-label="Filter by category"
                    >
                        <option value="">All categories</option>
                        {categoryOptions.map((c) => (
                            <option key={c.categoryId} value={c.categoryId}>
                                {c.categoryName}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            <div className="ev-tx-chips" role="group" aria-label="Filter by type">
                {TX_TYPE_CHIPS.map((c) => (
                    <button
                        key={c.label}
                        type="button"
                        aria-pressed={type === c.value}
                        className={`ev-tx-chip${type === c.value ? " is-active" : ""}`}
                        onClick={() => setType(c.value)}
                    >
                        {c.label}
                    </button>
                ))}
            </div>

            {isLoading ? (
                <Skeleton height={120} />
            ) : transactions.length === 0 ? (
                <div className="ev-detail-tx-empty">
                    <Receipt className="size-6" style={{ color: "var(--fg-4)" }} />
                    <div style={{ fontSize: 13.5, color: "var(--fg-2)" }}>
                        {hasFilters ? "No matching transactions." : "No transactions linked."}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                        {hasFilters ? (
                            "Try clearing or widening the filters."
                        ) : (
                            <PermissionGate
                                roles={["owner", "editor"]}
                                fallback="No transactions linked to this event yet."
                            >
                                {eventClosed
                                    ? "This event is closed — reopen it to link new transactions."
                                    : "Add transactions to this event from the New Transaction form."}
                            </PermissionGate>
                        )}
                    </div>
                </div>
            ) : (
                <>
                    <div className="ev-detail-tx-list">
                        {transactions.map((t) => {
                            const type = String(t.type);
                            const num = Number(t.amount);
                            const signed = type === "expense" ? -num : num;
                            const variant =
                                type === "income"
                                    ? "income"
                                    : type === "expense"
                                      ? "expense"
                                      : "muted";
                            return (
                                <div key={t.id} className="ev-detail-tx-row">
                                    <span className="ev-detail-tx-date">
                                        <span
                                            className="ev-detail-tx-marker"
                                            style={{ background: color }}
                                            aria-hidden
                                        />
                                        <span>
                                            {formatInAppTz(
                                                new Date(t.transaction_datetime),
                                                "MMM d"
                                            )}
                                        </span>
                                    </span>
                                    <span className="ev-detail-tx-desc">
                                        <span className="ev-detail-tx-desc-line">
                                            {t.description?.trim() || (
                                                <span style={{ color: "var(--fg-3)" }}>
                                                    No description
                                                </span>
                                            )}
                                        </span>
                                        <span className="ev-detail-tx-type">
                                            {type}
                                            {t.location ? ` · ${t.location}` : ""}
                                        </span>
                                    </span>
                                    <span className="ev-detail-tx-amt">
                                        <Money
                                            amount={signed}
                                            variant={variant}
                                            signed={type === "income"}
                                            size={13.5}
                                            weight={500}
                                        />
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    {hasNextPage && (
                        <div className="ev-detail-load-more">
                            <button
                                type="button"
                                className="od-btn od-btn-sm"
                                onClick={() => listQuery.fetchNextPage()}
                                disabled={isFetchingNextPage}
                            >
                                {isFetchingNextPage ? "Loading…" : "Load more"}
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ *
 *  Attachments
 * ------------------------------------------------------------------ */

type AttachmentRow = {
    id: string;
    originalName: string;
    sizeBytes: number;
};

function AttachmentsCard({ files }: { files: AttachmentRow[] }) {
    return (
        <div className="od-card ev-detail-section">
            <div className="ev-sect-head">
                <div className="ev-sect-text">
                    <h2 className="display ev-sect-title">Attachments</h2>
                    <span className="ev-sect-sub">{files.length} file(s)</span>
                </div>
            </div>
            <div className="ev-detail-files">
                {files.map((f) => (
                    <span key={f.id} className="ev-detail-file">
                        <FileText className="size-3.5" style={{ color: "var(--fg-3)" }} />
                        <span className="ev-detail-file-name">{f.originalName}</span>
                        <span className="ev-detail-file-size">{formatBytes(f.sizeBytes)}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ED_STYLES = `
.ev-root {
    margin: -1.5rem -1rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
}
@media (min-width: 768px) {
    .ev-root { margin: -2rem; }
}

.ev-detail-topbar {
    padding: 20px 32px 12px;
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: center;
    background: var(--bg);
}
@media (max-width: 720px) { .ev-detail-topbar { padding: 14px 18px 10px; } }
.ev-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-3);
    font-size: 12.5px;
    text-decoration: none;
    padding: 4px 8px;
    border-radius: 6px;
}
.ev-back:hover { color: var(--fg); background: var(--bg-elev-2); }

.ev-detail-scroll {
    flex: 1;
    padding: 18px 32px 40px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
}
@media (max-width: 720px) { .ev-detail-scroll { padding: 14px 18px 28px; } }

/* ---- Hero ---- */
.orbit-design .od-card.ev-hero {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    overflow: hidden;
    background:
        radial-gradient(120% 140% at 100% 0%, color-mix(in oklab, var(--ev-accent, var(--brand)) 12%, transparent), transparent 60%),
        var(--bg-elev-1);
}
/* Head: identity (left) + actions (right). */
.ev-hero-head {
    display: flex;
    gap: 16px 20px;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    position: relative;
    z-index: 1;
}
.ev-hero-id {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    min-width: 0;
    flex: 1 1 340px;
}
.ev-hero-idtext { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.ev-eyebrow-row { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ev-state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    color: var(--chip, var(--fg-2));
    background: color-mix(in oklab, var(--chip, var(--fg-3)) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--chip, var(--fg-3)) 26%, transparent);
}
.ev-state-dot {
    width: 6px; height: 6px; border-radius: 999px; background: var(--chip);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--chip) 24%, transparent);
}
.ev-hero-title {
    font-size: 27px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--fg);
    margin: 1px 0 0;
    line-height: 1.12;
}
.ev-hero-meta {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    margin-top: 3px;
    font-size: 12.5px;
    color: var(--fg-3);
}
.ev-meta-sep { color: var(--fg-4); }
.ev-hero-desc {
    font-size: 13px;
    line-height: 1.6;
    color: var(--fg-2);
    margin-top: 8px;
    max-width: 68ch;
    white-space: pre-wrap;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.ev-hero-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
/* Comfortable targets for these state-changing / destructive controls. */
.orbit-design .ev-hero-actions .od-btn { height: 36px; }

/* Metrics band — a divider, then a card-less row led by Spent, split by thin
   rules so it reads as one band, not nested cards. */
.ev-hero-metrics {
    border-top: 1px solid var(--line-soft);
    padding-top: 16px;
    position: relative;
    z-index: 1;
}
/* Single non-wrapping divider row on desktop — items shrink to fit rather
   than wrapping, so there's never an orphan leading rule at a wrap point.
   Below 1024px it becomes a clean 2-col grid (no rules). */
.ev-kpis {
    display: flex;
    flex-wrap: nowrap;
    align-items: stretch;
}
.ev-kpi {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 0 22px;
    min-width: 0;
    flex: 1 1 0;
    border-left: 1px solid var(--line-soft);
}
.ev-kpi:first-child { border-left: 0; padding-left: 0; }
.ev-kpi--lead { flex-grow: 1.6; }
.ev-kpi-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.11em;
    font-weight: 500;
    color: var(--fg-3);
}
.ev-kpi-dot { width: 6px; height: 6px; border-radius: 2px; flex-shrink: 0; }
.ev-kpi-value { line-height: 1.05; }
.ev-kpi-sub { font-size: 11px; color: var(--fg-3); }
@media (max-width: 1024px) {
    /* Grid below desktop; drop the rules and use spacing instead so a narrow
       row never has to cram or wrap the divider layout. */
    .ev-kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 18px; }
    .ev-kpi { padding: 0; border-left: 0; min-width: 0; }
    .ev-kpi:first-child { padding-left: 0; }
    .ev-kpi--lead { grid-column: 1 / -1; }
}
@media (max-width: 400px) {
    .ev-kpis { grid-template-columns: 1fr; }
}


/* ---- Budget + category row ---- */
.ev-grid-budget {
    display: grid;
    grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
    gap: 14px;
    /* Match heights; the gauge card centers its content vertically so it
       doesn't float at the top of the taller category card. */
    align-items: stretch;
}
.ev-grid-budget--solo { grid-template-columns: 1fr; }
@media (max-width: 860px) { .ev-grid-budget { grid-template-columns: 1fr; } }

.orbit-design .od-card.ev-detail-section {
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.ev-sect-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}
.ev-sect-text { display: flex; flex-direction: column; gap: 2px; }
.ev-sect-title { font-size: 15.5px; font-weight: 500; letter-spacing: -0.01em; color: var(--fg); margin: 0; }
.ev-sect-sub { font-size: 12px; color: var(--fg-3); }

/* Stretch (not center) so the header aligns left like every sibling section;
   the gauge is centered by .ev-budget-body instead. */
.ev-budget-card { align-items: stretch; }
.ev-budget-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    width: 100%;
    /* Grow into the stretched card height so the gauge sits centered rather
       than pinned under the header. */
    flex: 1;
    padding: 8px 0;
}
.ev-budget-empty {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
    padding: 8px 0 4px;
}

/* ---- Radial gauge ---- */
.ev-gauge { position: relative; margin: 0 auto; }
.ev-gauge svg { display: block; }
.ev-gauge-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    text-align: center;
    pointer-events: none;
}
.ev-gauge-pct { font-size: 32px; font-weight: 500; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
.ev-gauge-pct-sign { font-size: 15px; margin-left: 1px; }
.ev-gauge-sub { font-size: 12.5px; color: var(--fg-3); margin-top: 4px; display: inline-flex; gap: 4px; align-items: baseline; }

/* ---- Chart shared bits ---- */
.ev-chart-legend { display: flex; flex-wrap: wrap; gap: 14px; padding-top: 6px; }
.ev-chart-legend-key { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--fg-3); }
.ev-tt {
    background: var(--bg-elev-2);
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    padding: 9px 11px;
    box-shadow: var(--shadow-2);
    min-width: 168px;
}
.ev-tt-title { font-size: 12px; font-weight: 500; color: var(--fg); margin-bottom: 6px; }
.ev-tt-row { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; font-size: 11.5px; color: var(--fg-2); padding: 1px 0; }
.ev-tt-row span:first-child { color: var(--fg-3); }
.ev-tt-muted span { color: var(--fg-3) !important; }
.ev-mini-empty { font-size: 12.5px; color: var(--fg-3); padding: 30px 0; text-align: center; }

/* ---- Donut ---- */
.ev-donut-block { display: flex; flex-direction: column; gap: 14px; }
.ev-donut-crumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; }
.ev-crumb-seg { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }
.ev-crumb {
    border: 0; background: transparent; font-family: inherit; font-size: 12px;
    color: var(--fg-3); padding: 3px 6px; border-radius: 6px; cursor: pointer;
    max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ev-crumb:hover:not(:disabled) { color: var(--fg); background: var(--bg-elev-2); }
.ev-crumb:disabled { color: var(--fg); cursor: default; font-weight: 500; }
.ev-crumb:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--brand); }
.ev-crumb-chev { color: var(--fg-4); flex-shrink: 0; }
.ev-donut-legend-row.is-drillable .ev-crumb-chev { color: var(--fg-3); margin-left: 2px; }
.ev-donut-wrap {
    display: grid;
    grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
    gap: 18px 24px;
    /* Top-align so a tall (many-category) legend doesn't vertically centre
       the fixed-height donut and leave a dead band above/below it. */
    align-items: start;
}
@media (max-width: 620px) { .ev-donut-wrap { grid-template-columns: 1fr; } }
.ev-donut-chart { position: relative; width: 100%; max-width: 260px; height: 240px; margin: 0 auto; }
.ev-donut-center {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2px; text-align: center; pointer-events: none; padding: 0 12%;
}
.ev-donut-center .eyebrow {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ev-donut-center-val { line-height: 1; }
.ev-donut-center-pct { font-size: 11.5px; color: var(--fg-3); }
.ev-donut-legend {
    display: grid;
    /* Fill the width but cap at ~3 columns (max-width blocks a 4th track)
       so wide screens don't fan out to 5–6 skinny columns. */
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 4px 32px;
    align-content: start;
    min-width: 0;
    max-width: 820px;
}
@media (max-width: 1100px) {
    .ev-donut-legend { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 4px 24px; max-width: 560px; }
}
.ev-donut-legend-row {
    display: flex; align-items: center; gap: 9px; width: 100%;
    padding: 7px 8px; border-radius: 8px; background: transparent;
    border: 0; cursor: pointer; text-align: left; transition: background 120ms;
    font-family: inherit;
}
.ev-donut-legend-row:hover, .ev-donut-legend-row.is-active { background: var(--bg-elev-2); }
.ev-dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
.ev-donut-legend-name {
    flex: 1; min-width: 0; font-size: 12.5px; color: var(--fg-2);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ev-donut-legend-vals { display: inline-flex; align-items: baseline; gap: 8px; flex-shrink: 0; }
.ev-donut-legend-pct { font-size: 11px; color: var(--fg-3); font-variant-numeric: tabular-nums; min-width: 30px; text-align: right; }

/* ---- Where it went (top locations) ---- */
.ev-where-locations { display: flex; flex-direction: column; gap: 8px; }
.ev-loc-row { display: grid; grid-template-columns: minmax(90px, 1.3fr) minmax(0, 2fr) auto; align-items: center; gap: 12px; }
.ev-loc-name {
    display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--fg-2);
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ev-loc-bar { position: relative; height: 8px; border-radius: 999px; background: color-mix(in oklab, var(--line) 60%, transparent); overflow: hidden; }
.ev-loc-fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: color-mix(in oklab, var(--ev-accent, var(--brand)) 62%, transparent); transition: width 250ms ease; }
.ev-loc-amt { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
.ev-loc-count { font-size: 11px; color: var(--fg-3); }

/* ---- Transaction filters ---- */
.ev-tx-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.ev-tx-search {
    display: inline-flex; align-items: center; gap: 8px; flex: 1 1 240px; min-width: 0;
    height: 34px; padding: 0 10px; border-radius: 9px;
    background: var(--bg-elev-1); border: 1px solid var(--line);
    transition: border-color 120ms, box-shadow 120ms;
}
.ev-tx-search:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.ev-tx-search-input {
    flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; outline: none;
    color: var(--fg); font-size: 13px; font-family: inherit;
}
.ev-tx-search-input::placeholder { color: var(--fg-4); }
.ev-tx-search-clear {
    display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
    width: 18px; height: 18px; border-radius: 5px; border: 0; background: transparent;
    color: var(--fg-4); cursor: pointer;
}
.ev-tx-search-clear:hover { color: var(--fg-2); background: var(--bg-elev-2); }
.ev-tx-select {
    height: 34px; padding: 0 28px 0 10px; border-radius: 9px;
    background: var(--bg-elev-1); border: 1px solid var(--line);
    color: var(--fg-2); font-size: 12.5px; font-family: inherit; cursor: pointer;
    max-width: 200px; outline: none;
    appearance: none;
    background-image: linear-gradient(45deg, transparent 50%, var(--fg-4) 50%), linear-gradient(135deg, var(--fg-4) 50%, transparent 50%);
    background-position: right 12px center, right 7px center;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
}
.ev-tx-select:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.ev-tx-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.ev-tx-chip {
    height: 28px; padding: 0 12px; border-radius: 999px;
    background: var(--bg-elev-1); border: 1px solid var(--line);
    color: var(--fg-3); font-size: 12px; font-weight: 500; font-family: inherit; cursor: pointer;
    transition: all 120ms ease;
}
.ev-tx-chip:hover { color: var(--fg); border-color: var(--line-strong); }
.ev-tx-chip.is-active {
    background: var(--brand-soft); border-color: color-mix(in oklab, var(--brand) 40%, transparent);
    color: var(--brand);
}

/* ---- Focus-visible rings (keyboard/switch users) ---- */
.ev-back:focus-visible,
.ev-tx-chip:focus-visible,
.ev-tx-search-clear:focus-visible,
.ev-donut-legend-row:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--brand);
}
.ev-tx-select:focus-visible { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }

/* ---- Reduced motion ---- */
@media (prefers-reduced-motion: reduce) {
    .ev-loc-fill { transition: none !important; }
    .ev-gauge svg path { transition: none !important; }
}

/* ---- Transactions ---- */
.ev-detail-tx-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 30px 12px; text-align: center; }
.ev-detail-tx-list { display: flex; flex-direction: column; }
.ev-detail-tx-row { display: grid; grid-template-columns: 90px 1fr auto; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid var(--line-soft); }
.ev-detail-tx-row:last-child { border-bottom: 0; }
.ev-detail-tx-date { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--fg-3); }
.ev-detail-tx-marker { width: 6px; height: 6px; border-radius: 999px; flex-shrink: 0; }
.ev-detail-tx-desc { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.ev-detail-tx-desc-line { font-size: 13px; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev-detail-tx-type { font-size: 11.5px; color: var(--fg-3); text-transform: capitalize; }
.ev-detail-tx-amt { text-align: right; }
.ev-detail-load-more { display: flex; justify-content: center; padding-top: 10px; }

/* ---- Attachments ---- */
.ev-detail-files { display: flex; flex-wrap: wrap; gap: 6px; }
.ev-detail-file { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg-elev-1); font-size: 12px; color: var(--fg-2); }
.ev-detail-file-name { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev-detail-file-size { color: var(--fg-3); font-size: 11px; }

.orbit-design .od-card.ev-detail-empty { padding: 40px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }

/* ---- Phone ---- */
@media (max-width: 640px) {
    .ev-detail-topbar { padding: 12px 14px 8px; }
    .ev-detail-scroll { padding: 12px 14px 22px; gap: 12px; }
    .orbit-design .od-card.ev-hero { padding: 16px; gap: 16px; }
    .ev-hero-id { flex: 1 1 100%; }
    .ev-hero-actions { width: 100%; }
    .ev-hero-title { font-size: 21px; }
    .orbit-design .od-card.ev-detail-section { padding: 16px; gap: 12px; }
    .ev-detail-tx-row { grid-template-columns: 1fr auto; gap: 8px; padding: 10px 2px; }
    .ev-detail-tx-date { grid-column: 1 / -1; }
    .ev-detail-file-name { max-width: 140px; }
    .orbit-design .od-card.ev-detail-empty { padding: 24px; }
    /* Comfortable touch targets + 16px inputs (avoids iOS focus-zoom). */
    .ev-back { padding: 8px 10px; }
    .ev-tx-chip { height: 36px; padding: 0 14px; }
    .ev-tx-search, .ev-tx-select { height: 42px; }
    .ev-tx-search-input, .ev-tx-select { font-size: 16px; }
    .ev-tx-search-clear { width: 30px; height: 30px; }
    .ev-donut-legend-row { padding: 10px 8px; }
    .ev-crumb { padding: 9px 8px; }
    .orbit-design .ev-hero-actions .od-btn { height: 40px; }
}
`;
