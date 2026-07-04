import { Link } from "react-router-dom";
import {
    TrendingUp,
    PieChart as PieIcon,
    Layers as LayersIcon,
    Flame,
    Network,
    Activity,
    AlertTriangle,
    Star,
    Folder,
    ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { ROUTES } from "@/router/routes";

interface Entry {
    view: string;
    title: string;
    description: string;
    icon: LucideIcon;
    color: string;
    /**
     * `true` for views that don't have a working backend yet — clicking
     * them goes to the same route, where the view's own page can render
     * a "coming soon" notice. We surface a "Soon" pill on the tile so
     * users know it's a stub.
     */
    soon?: boolean;
}

const ENTRIES: Entry[] = [
    {
        view: "cash-flow",
        title: "Cash flow",
        description:
            "Monthly income vs expense over time. Spot under/over-earning months.",
        icon: TrendingUp,
        color: "var(--ent-1)",
    },
    {
        view: "trends",
        title: "Spending trends",
        description:
            "How fast money is leaving — month-to-date pace, year-over-year, and a forecast.",
        icon: Activity,
        color: "var(--gold)",
    },
    {
        view: "categories",
        title: "Category spending",
        description:
            "Where your expenses go, rolled up to top-level categories with drill-down.",
        icon: Folder,
        color: "var(--ent-3)",
    },
    {
        view: "envelopes",
        title: "Envelope utilization",
        description: "How much of each envelope you've consumed this period.",
        icon: LayersIcon,
        color: "var(--ent-2)",
    },
    {
        view: "allocations",
        title: "Allocation map",
        description:
            "Where each envelope's budget is committed — your space-wide spending intent.",
        icon: Network,
        color: "var(--ent-4)",
    },
    {
        view: "balance",
        title: "Balance history",
        description: "Total spendable balance over time.",
        icon: PieIcon,
        color: "var(--ent-8)",
    },
    {
        view: "heatmap",
        title: "Spending calendar",
        description:
            "A zoomed-out twelve-month calendar — every day visible with intensity, peaks, and recurring markers.",
        icon: Flame,
        color: "var(--ent-5)",
    },
    {
        view: "anomalies",
        title: "Anomalies & signals",
        description:
            "Outliers, recurring-charge changes, broken patterns, and streaks — surfaced automatically.",
        icon: AlertTriangle,
        color: "var(--expense)",
    },
    {
        view: "priority",
        title: "By priority",
        description:
            "Essential / important / discretionary / luxury — how much of this period was must-spend vs want-spend.",
        icon: Star,
        color: "var(--ent-6)",
    },
];

export default function AnalyticsPage() {
    const { space } = useCurrentSpace();

    return (
        <div className="orbit-design an-root">
            <style>{AN_STYLES}</style>

            <header className="an-topbar">
                <div className="an-topbar-text">
                    <span className="eyebrow">{ENTRIES.length} views</span>
                    <h1 className="display an-title">Analytics</h1>
                    <p className="an-sub">
                        Pick an analysis to dive into. Each view has its own period
                        selector.
                    </p>
                </div>
            </header>

            <div className="an-scroll">
                <div className="an-grid">
                    {ENTRIES.map((e) => (
                        <Link
                            key={e.view}
                            to={ROUTES.spaceAnalyticsDetail(space.id, e.view)}
                            className="od-card an-card"
                        >
                            <span
                                className="an-card-glow"
                                aria-hidden
                                style={{
                                    background: `radial-gradient(120% 60% at 0% 0%, color-mix(in oklab, ${e.color} 12%, transparent), transparent 70%)`,
                                }}
                            />
                            <div className="an-card-head">
                                <span
                                    className="an-card-icon"
                                    style={{
                                        background: `color-mix(in oklab, ${e.color} 18%, transparent)`,
                                        border: `1px solid color-mix(in oklab, ${e.color} 30%, transparent)`,
                                        color: e.color,
                                    }}
                                >
                                    <e.icon className="size-4" />
                                </span>
                                {e.soon ? (
                                    <span className="an-card-soon">Soon</span>
                                ) : (
                                    <ArrowRight
                                        className="size-3.5"
                                        style={{ color: "var(--fg-4)" }}
                                    />
                                )}
                            </div>
                            <div className="an-card-body">
                                <h3 className="display an-card-title">{e.title}</h3>
                                <p className="an-card-desc">{e.description}</p>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}

const AN_STYLES = `
.an-root {
    margin: -1.5rem -1rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
}
@media (min-width: 768px) {
    .an-root { margin: -2rem; }
}

.an-topbar {
    padding: 26px 32px 18px;
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    background: var(--bg);
    flex-wrap: wrap;
}
.an-topbar-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.an-title {
    font-size: 26px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--fg);
    margin: 0;
}
.an-sub { font-size: 13px; color: var(--fg-3); margin: 0; }
@media (max-width: 720px) {
    .an-topbar { padding: 18px 18px 14px; }
}

.an-scroll {
    flex: 1;
    padding: 22px 32px 36px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
@media (max-width: 720px) {
    .an-scroll { padding: 16px 18px 28px; }
}

.an-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
}
@media (max-width: 1100px) {
    .an-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
    .an-grid { grid-template-columns: 1fr; }
}

.orbit-design .od-card.an-card {
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    position: relative;
    overflow: hidden;
    cursor: pointer;
    text-decoration: none;
    color: inherit;
    transition: border-color 140ms ease, transform 140ms ease;
}
.orbit-design .od-card.an-card:hover {
    border-color: var(--line-strong);
    transform: translateY(-1px);
}
.an-card-glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
}
.an-card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    position: relative;
}
.an-card-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
}
.an-card-soon {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--gold);
    border: 1px solid color-mix(in oklab, var(--gold) 30%, transparent);
    background: color-mix(in oklab, var(--gold) 10%, transparent);
}
.an-card-body { position: relative; }
.an-card-title {
    font-size: 16px;
    font-weight: 500;
    color: var(--fg);
    margin: 0;
    letter-spacing: -0.01em;
}
.an-card-desc {
    font-size: 12.5px;
    color: var(--fg-3);
    margin: 6px 0 0;
    line-height: 1.5;
}

/* Phone (<640px) */
@media (max-width: 640px) {
    .an-topbar { padding: 14px 14px 10px; }
    .an-title { font-size: 22px; }
    .an-scroll { padding: 12px 14px 22px; gap: 12px; }
    .orbit-design .od-card.an-card { padding: 14px; gap: 10px; }
    .an-card-title { font-size: 14.5px; }
}
`;
