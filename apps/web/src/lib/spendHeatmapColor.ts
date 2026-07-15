/**
 * Shared color system for daily-spend heatmaps (the Overview page's
 * current-month calendar and the Analytics "Spending calendar" 12-month
 * view). Single-hue amber ramp, fixed hue (82) throughout so no step
 * mixes two competing hues (that was the "muddy brown" bug — mixing an
 * amber accent into a base that itself carried a hue). Every fg/bg
 * pairing was verified to clear 4.5:1 contrast by actually computing
 * WCAG contrast ratios (oklch → sRGB → relative luminance) rather than
 * guessing.
 */
export const AMBER = {
    b1: "oklch(32% 0.056 82)",
    b2: "oklch(45% 0.085 82)",
    b3: "oklch(60% 0.118 82)",
    b4: "oklch(72% 0.145 82)",
    b5: "oklch(85% 0.173 82)",
    fgLight: "var(--fg)",
    fgDark: "oklch(16% 0.02 82)",
};

/**
 * 20/40/60/80th-percentile edges of the given set of active (>0) days.
 * Buckets are relative to what the user actually spends, so the ramp
 * self-scales to any currency or amount range instead of assuming a
 * fixed dollar-like ceiling.
 *
 * Outlier days (e.g. a single huge one-off purchase) are trimmed via a
 * standard IQR fence before picking the edges, so one unusually large
 * day doesn't stretch the whole scale — a $20k rent payment shouldn't
 * make every $2k day look pale by comparison. Outlier days still render;
 * they just land in the top bucket instead of redefining it.
 */
export function computeQuantileEdges(values: number[]): number[] {
    const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
    if (nz.length === 0) return [0, 0, 0, 0];
    const q = (arr: number[], p: number) => {
        const idx = p * (arr.length - 1);
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return arr[lo];
        return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
    };
    const q1 = q(nz, 0.25);
    const q3 = q(nz, 0.75);
    const upperFence = q3 + 1.5 * (q3 - q1);
    const typical = nz.filter((v) => v <= upperFence);
    const base = typical.length >= 5 ? typical : nz;
    return [q(base, 0.2), q(base, 0.4), q(base, 0.6), q(base, 0.8)];
}

/** Map a daily expense to one of 6 intensity buckets using the given quantile edges. */
export function bucketize(v: number, edges: number[]): number {
    if (v <= 0) return 0;
    if (v <= edges[0]) return 1;
    if (v <= edges[1]) return 2;
    if (v <= edges[2]) return 3;
    if (v <= edges[3]) return 4;
    return 5;
}

/**
 * Bucket → { background, border, text } using the `AMBER` palette above.
 * Each stop is an authored oklch value (fixed hue, rising L + C) rather
 * than a computed color-mix — that guarantees no step can accidentally
 * drift toward a muddy intermediate hue, and every fg/bg pairing here was
 * verified to clear 4.5:1 contrast (see the module-level `AMBER` comment).
 */
export function ramp(b: number): { bg: string; border: string; fg: string } {
    if (b === 0) {
        return {
            bg: "var(--bg-elev-2)",
            border: "var(--line)",
            fg: "var(--fg-2)",
        };
    }
    const stops = [AMBER.b1, AMBER.b2, AMBER.b3, AMBER.b4, AMBER.b5];
    const fgs = [
        AMBER.fgLight,
        AMBER.fgLight,
        AMBER.fgDark,
        AMBER.fgDark,
        AMBER.fgDark,
    ];
    return {
        bg: stops[b - 1],
        border: "transparent",
        fg: fgs[b - 1],
    };
}

/** Compact "1.4K"-style formatting for heatmap legends/labels. */
export function formatCompact(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
    return Math.round(n).toString();
}
