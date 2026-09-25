import {
    memo,
    useCallback,
    useDeferredValue,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type FocusEvent,
    type KeyboardEvent,
    type MouseEvent,
    type RefObject,
} from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PICKER_TRIGGER_STYLES } from "@/components/shared/ColorPicker";
import { cn } from "@/lib/utils";
import { focusOnOpen } from "@/lib/autofocus";
import {
    ENTITY_ICONS,
    ENTITY_ICON_CATEGORIES,
    canonicalIconName,
    getIcon,
} from "@/lib/entityIcons";
import {
    EMOJI_FONT_STACK,
    SKIN_TONE_LABELS,
    SKIN_TONE_SWATCHES,
    applySkinTone,
    detectEmojiSupport,
    emojiKey,
    filterSupportedEmoji,
    getSkinTone,
    isEmojiIcon,
    type EmojiDataset,
    type EmojiEntry,
    type EmojiSupport,
    type SkinTone,
} from "@/lib/emoji";
import {
    loadEmojiDataset,
    loadLucideTags,
    peekEmojiDataset,
    peekLucideTags,
    type LucideTags,
} from "@/lib/icons/load";
import {
    buildEmojiSearchIndex,
    buildLucideSearchIndex,
    searchIcons,
    tokenize,
    type IconSearchItem,
} from "@/lib/iconSearch";

/**
 * Editorial-dark icon picker: a header naming the current (or hovered) icon,
 * one search box over two sets — the curated Lucide catalog ("Icons") and the
 * full Unicode emoji list ("Emoji") — with a scroll-tracking category strip
 * per tab, recent picks, skin tones, and roving-tabindex keyboard navigation.
 * The emoji dataset and Lucide search tags are fetched on first open and the
 * emoji are filtered to what this device can render (see `lib/emoji.ts`).
 * Selecting a cell tints it with the entity colour, like the ColorPicker; the
 * popover hosts close on select.
 */

type Tab = "icons" | "emoji";

const RECENT_KEY = "orbit:icon-picker:recent";
const TONE_KEY = "orbit:icon-picker:skin-tone";
const RECENT_MAX = 24;
/** One row at the desktop width — Recent is a glance, not a browse. */
const RECENT_SHOWN = 8;
/** Per kind. Anything broader than this is a one-letter query, not a search. */
const RESULT_LIMIT = 480;
/* Grid geometry mirrored from the CSS below, for the content-visibility size hint. */
const GRID_MIN_CELL = 40;
const GRID_GAP = 4;
/** Sticky group header (27px) plus the section's 4px header→grid gap. */
const GROUP_HEADER_HEIGHT = 31;

const LUCIDE_COUNT = ENTITY_ICON_CATEGORIES.reduce((n, c) => n + c.names.length, 0);

/** Registry key used in the strip for each Unicode emoji group. */
const EMOJI_GROUP_ICONS: Record<string, string> = {
    "Smileys & Emotion": "smile",
    "People & Body": "hand",
    "Animals & Nature": "paw-print",
    "Food & Drink": "utensils",
    "Travel & Places": "plane",
    Activities: "trophy",
    Objects: "lightbulb",
    Symbols: "hash",
    Flags: "flag",
};

interface EmojiGroup {
    key: string;
    label: string;
    icon: string;
    entries: EmojiEntry[];
    keys: Set<string>;
    hasSkin: boolean;
}

interface EmojiView {
    support: EmojiSupport;
    entries: EmojiEntry[];
    byKey: Map<string, EmojiEntry>;
    groups: EmojiGroup[];
    index: IconSearchItem[];
}

/* Support-filtered entries, group buckets and search index — once per session. */
const emojiViewCache = new WeakMap<EmojiDataset, EmojiView>();
function getEmojiView(dataset: EmojiDataset): EmojiView {
    let view = emojiViewCache.get(dataset);
    if (!view) {
        const support = detectEmojiSupport(dataset);
        const entries = filterSupportedEmoji(dataset.entries, support);
        const groups: EmojiGroup[] = dataset.groups.map((label, i) => ({
            key: `emoji:${i}`,
            label,
            icon: EMOJI_GROUP_ICONS[label] ?? "sticker",
            entries: [],
            keys: new Set(),
            hasSkin: false,
        }));
        for (const e of entries) {
            const g = groups[e.group];
            if (!g) continue;
            g.entries.push(e);
            g.keys.add(e.key);
            if (e.skin) g.hasSkin = true;
        }
        view = {
            support,
            entries,
            byKey: new Map(entries.map((e) => [e.key, e])),
            groups: groups.filter((g) => g.entries.length > 0),
            index: buildEmojiSearchIndex(entries, dataset.groups),
        };
        emojiViewCache.set(dataset, view);
    }
    return view;
}

/* localStorage is a convenience here; every read/write tolerates it being unavailable. */
function readRecent(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
        return Array.isArray(parsed)
            ? parsed.filter((x): x is string => typeof x === "string")
            : [];
    } catch {
        return [];
    }
}
function pushRecent(id: string) {
    try {
        const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
        /* ignore */
    }
}
function readTone(): SkinTone | null {
    try {
        const raw = localStorage.getItem(TONE_KEY);
        if (raw === null) return null;
        const n = Number(raw);
        return Number.isInteger(n) && n >= 0 && n <= 5 ? (n as SkinTone) : null;
    } catch {
        return null;
    }
}
function writeTone(tone: SkinTone) {
    try {
        localStorage.setItem(TONE_KEY, String(tone));
    } catch {
        /* ignore */
    }
}

function useIconData() {
    const [dataset, setDataset] = useState<EmojiDataset | null>(peekEmojiDataset);
    const [tags, setTags] = useState<LucideTags | null>(peekLucideTags);
    const [failed, setFailed] = useState(false);
    const loadEmoji = useCallback(() => {
        setFailed(false);
        loadEmojiDataset().then(setDataset, () => setFailed(true));
    }, []);
    useEffect(() => {
        if (!dataset) loadEmoji();
    }, [dataset, loadEmoji]);
    useEffect(() => {
        // Search works by name until the tags land; a failure here is silent.
        if (!tags) loadLucideTags().then(setTags, () => undefined);
    }, [tags]);
    return { dataset, tags, failed, retry: loadEmoji };
}

/** Real column count / row pitch of the auto-fill grid, from the body's width. */
function useGridMetrics(bodyRef: RefObject<HTMLDivElement | null>) {
    const [metrics, setMetrics] = useState({ cols: 8, row: GRID_MIN_CELL + GRID_GAP + 1 });
    useLayoutEffect(() => {
        const body = bodyRef.current;
        if (!body) return;
        const measure = () => {
            const width = body.clientWidth - 4; // horizontal padding
            if (width <= 0) return;
            const cols = Math.max(1, Math.floor((width + GRID_GAP) / (GRID_MIN_CELL + GRID_GAP)));
            const row = (width - (cols - 1) * GRID_GAP) / cols + GRID_GAP;
            setMetrics((m) => (m.cols === cols && Math.abs(m.row - row) < 0.5 ? m : { cols, row }));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(body);
        return () => observer.disconnect();
    }, [bodyRef]);
    return metrics;
}

type PickerSection = { key: string; label: string; icon: string } & (
    | { kind: "lucide"; names: readonly string[] }
    | {
          kind: "emoji";
          entries: readonly EmojiEntry[];
          keys: ReadonlySet<string>;
          hasSkin: boolean;
      }
);

const humanize = (name: string) => name.replace(/-/g, " ");
const formatCount = (n: number, more: boolean) => (more ? `${n}+` : String(n));
const glyphFor = (entry: EmojiEntry, tone: SkinTone) =>
    entry.skin && tone ? applySkinTone(entry.emoji, tone) : entry.emoji;

const cellsOf = (grid: Element | null | undefined) =>
    grid ? Array.from(grid.querySelectorAll<HTMLElement>(".op-icon-cell")) : [];
function siblingGrid(body: HTMLElement, grid: Element, direction: 1 | -1): Element | null {
    const grids = Array.from(body.querySelectorAll(".op-icon-grid"));
    return grids[grids.indexOf(grid) + direction] ?? null;
}
function cellInColumn(grid: Element | null, column: number, cols: number, lastRow: boolean) {
    const cells = cellsOf(grid);
    if (cells.length === 0) return undefined;
    const rowStart = lastRow ? Math.floor((cells.length - 1) / cols) * cols : 0;
    return cells[Math.min(rowStart + column, cells.length - 1)];
}

export interface IconPickerProps {
    value: string;
    onChange: (name: string) => void;
    /** Optional color that tints the selected cell */
    color?: string;
    className?: string;
    /** The icon the form opened with; while `value` differs the header offers "Revert" to it. */
    defaultValue?: string;
}

export function IconPicker({ value, onChange, color, className, defaultValue }: IconPickerProps) {
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const q = deferredQuery.trim();
    const searching = q.length > 0;
    const [tab, setTab] = useState<Tab>(() => (isEmojiIcon(value) ? "emoji" : "icons"));
    const [tone, setTone] = useState<SkinTone>(
        () => (isEmojiIcon(value) && getSkinTone(value)) || readTone() || 0
    );
    // Snapshot per mount: a pick must not reorder the Recent row under the cursor.
    const [recent] = useState<string[]>(readRecent);
    const [activeSection, setActiveSection] = useState<string | null>(null);
    const [hovered, setHovered] = useState<{ id: string; label: string } | null>(null);
    const [stripMore, setStripMore] = useState(false);
    // Which strip button is the Tab stop while a keyboard user walks the strip.
    // Held in state (not a DOM hand-off) so a later re-render can't leave two stops.
    const [stripFocusKey, setStripFocusKey] = useState<string | null>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const stripRef = useRef<HTMLDivElement>(null);
    const scrollRaf = useRef(0);

    const { dataset, tags, failed, retry } = useIconData();
    const emojiView = useMemo(() => (dataset ? getEmojiView(dataset) : null), [dataset]);
    const lucideIndex = useMemo(() => buildLucideSearchIndex(tags ?? {}), [tags]);
    const metrics = useGridMetrics(bodyRef);

    const tint = color ?? "var(--brand)";
    const activeStyle = useMemo<CSSProperties>(
        () => ({
            background: `color-mix(in oklab, ${tint} 18%, transparent)`,
            borderColor: `color-mix(in oklab, ${tint} 35%, transparent)`,
            color: tint,
        }),
        [tint]
    );
    const stripActiveStyle = useMemo<CSSProperties>(
        () => ({ color: tint, background: `color-mix(in oklab, ${tint} 16%, transparent)` }),
        [tint]
    );

    const activeLucide = canonicalIconName(value);
    const activeEmoji = isEmojiIcon(value) ? emojiKey(value) : "";
    const currentLabel = isEmojiIcon(value)
        ? (emojiView?.byKey.get(activeEmoji)?.label ?? "Emoji")
        : ENTITY_ICONS[value]
          ? humanize(activeLucide)
          : "Unknown icon";
    // The header previews whatever the pointer/focus is on, else the current value.
    const HeadIcon = getIcon(hovered?.id ?? value);
    const headLabel = hovered?.label ?? currentLabel;
    const canRevert = !!defaultValue && defaultValue !== value;
    const revertLabel = defaultValue
        ? isEmojiIcon(defaultValue)
            ? defaultValue
            : humanize(canonicalIconName(defaultValue))
        : "";

    const pick = useCallback(
        (id: string) => {
            pushRecent(id);
            onChange(id);
        },
        [onChange]
    );
    const changeTone = useCallback((t: SkinTone) => {
        setTone(t);
        writeTone(t);
    }, []);

    const sections = useMemo<PickerSection[]>(() => {
        if (tab === "icons") {
            const recentNames = [
                ...new Set(
                    recent
                        .filter((id) => !isEmojiIcon(id) && ENTITY_ICONS[id])
                        .map(canonicalIconName)
                ),
            ].slice(0, RECENT_SHOWN);
            return [
                ...(recentNames.length
                    ? [
                          {
                              key: "recent",
                              label: "Recent",
                              icon: "clock",
                              kind: "lucide" as const,
                              names: recentNames,
                          },
                      ]
                    : []),
                ...ENTITY_ICON_CATEGORIES.map((c) => ({
                    key: `lucide:${c.label}`,
                    label: c.label,
                    icon: c.icon,
                    kind: "lucide" as const,
                    names: c.names,
                })),
            ];
        }
        if (!emojiView) return [];
        // Recent emoji, deduped by base and dropped if this device can't show them.
        const recentEntries: EmojiEntry[] = [];
        const recentKeys = new Set<string>();
        for (const id of recent) {
            if (recentEntries.length >= RECENT_SHOWN) break;
            if (!isEmojiIcon(id)) continue;
            const entry = emojiView.byKey.get(emojiKey(id));
            if (entry && !recentKeys.has(entry.key)) {
                recentKeys.add(entry.key);
                recentEntries.push(entry);
            }
        }
        return [
            ...(recentEntries.length
                ? [
                      {
                          key: "recent",
                          label: "Recent",
                          icon: "clock",
                          kind: "emoji" as const,
                          entries: recentEntries,
                          keys: recentKeys,
                          hasSkin: recentEntries.some((e) => e.skin),
                      },
                  ]
                : []),
            ...emojiView.groups.map((g) => ({
                key: g.key,
                label: g.label,
                icon: g.icon,
                kind: "emoji" as const,
                entries: g.entries,
                keys: g.keys,
                hasSkin: g.hasSkin,
            })),
        ];
    }, [tab, recent, emojiView]);

    const results = useMemo(() => {
        if (!searching) return null;
        // A pasted emoji finds itself (the tokenizer would drop it) and keeps its tone.
        if (isEmojiIcon(q)) {
            const hit = emojiView?.byKey.get(emojiKey(q));
            return {
                icons: [] as string[],
                iconsMore: false,
                emoji: hit ? [hit] : [],
                emojiMore: false,
                pasted: hit ? q : null,
                tone: getSkinTone(q),
            };
        }
        const icons = searchIcons(lucideIndex, q, RESULT_LIMIT + 1).map((i) => i.id);
        const emoji = emojiView
            ? searchIcons(emojiView.index, q, RESULT_LIMIT + 1).flatMap((i) =>
                  i.entry ? [i.entry] : []
              )
            : [];
        return {
            icons: icons.slice(0, RESULT_LIMIT),
            iconsMore: icons.length > RESULT_LIMIT,
            emoji: emoji.slice(0, RESULT_LIMIT),
            emojiMore: emoji.length > RESULT_LIMIT,
            pasted: null,
            tone: 0 as SkinTone,
        };
    }, [searching, q, emojiView, lucideIndex]);

    // A query with no Latin tokens (Bangla, "৳", "%") can never match — say so
    // instead of claiming the catalog has nothing.
    const noTokens = searching && !isEmojiIcon(q) && tokenize(q).length === 0;

    /* Exactly one cell in the body carries tabIndex 0: the current value's cell in the
       first section that shows it (Recent and its category both can), else the first cell. */
    const activeInResults = results
        ? results.icons.includes(activeLucide) || results.emoji.some((e) => e.key === activeEmoji)
        : false;
    const rovingSectionKey = results
        ? null
        : (sections.find((s) =>
              s.kind === "lucide" ? s.names.includes(activeLucide) : s.keys.has(activeEmoji)
          )?.key ??
          sections[0]?.key ??
          null);

    /* Back to the top whenever the list changes shape (tab switch, search on/off) — before paint. */
    useLayoutEffect(() => {
        if (bodyRef.current) bodyRef.current.scrollTop = 0;
        setActiveSection(null);
        setHovered(null);
        setStripFocusKey(null);
    }, [tab, searching]);

    useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);

    const currentSection = activeSection ?? sections[0]?.key ?? null;
    const stripTabStop = sections.some((s) => s.key === stripFocusKey)
        ? stripFocusKey
        : currentSection;

    const onBodyScroll = () => {
        if (scrollRaf.current || searching) return;
        scrollRaf.current = requestAnimationFrame(() => {
            scrollRaf.current = 0;
            const body = bodyRef.current;
            if (!body) return;
            const top = body.scrollTop + 12;
            let current: string | null = null;
            for (const el of body.querySelectorAll<HTMLElement>("[data-section]")) {
                if (el.offsetTop > top) break;
                current = el.dataset.section ?? null;
            }
            setActiveSection(current);
        });
    };

    const scrollToSection = (key: string) => {
        const body = bodyRef.current;
        const el = body?.querySelector<HTMLElement>(`[data-section="${CSS.escape(key)}"]`);
        if (!body || !el) return;
        body.scrollTop = el.offsetTop;
        // Skipped (content-visibility) sections above settle their real height
        // on the next frame; re-aim once so the header lands where it should.
        requestAnimationFrame(() => {
            body.scrollTop = el.offsetTop;
        });
        setActiveSection(key);
    };

    /* Keep the active strip button in view when the strip overflows. */
    useEffect(() => {
        const strip = stripRef.current;
        if (!strip || !currentSection) return;
        const btn = strip.querySelector<HTMLElement>(
            `[data-section-btn="${CSS.escape(currentSection)}"]`
        );
        if (!btn) return;
        const left = btn.offsetLeft;
        const right = left + btn.offsetWidth;
        if (left < strip.scrollLeft) strip.scrollLeft = left - 4;
        else if (right > strip.scrollLeft + strip.clientWidth) {
            strip.scrollLeft = right - strip.clientWidth + 4;
        }
    }, [currentSection]);

    /* Fade the strip's right edge only while there is more to scroll to. */
    const measureStrip = useCallback(() => {
        const strip = stripRef.current;
        setStripMore(!!strip && strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
    }, []);
    useLayoutEffect(() => {
        measureStrip();
        const strip = stripRef.current;
        if (!strip) return;
        const observer = new ResizeObserver(measureStrip);
        observer.observe(strip);
        return () => observer.disconnect();
    }, [measureStrip, sections, searching]);

    /* The strip is one Tab stop; Left/Right move along it without jumping the body. */
    const onStripKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const strip = stripRef.current;
        const btn = (e.target as HTMLElement).closest<HTMLElement>(".op-icon-strip-btn");
        if (!strip || !btn) return;
        const buttons = Array.from(strip.querySelectorAll<HTMLElement>(".op-icon-strip-btn"));
        const i = buttons.indexOf(btn);
        let j: number;
        switch (e.key) {
            case "ArrowRight":
                j = i + 1;
                break;
            case "ArrowLeft":
                j = i - 1;
                break;
            case "Home":
                j = 0;
                break;
            case "End":
                j = buttons.length - 1;
                break;
            default:
                return;
        }
        const next = buttons[j];
        if (!next) return;
        e.preventDefault();
        setStripFocusKey(next.dataset.sectionBtn ?? null);
        next.focus({ preventScroll: true });
        const left = next.offsetLeft;
        const right = left + next.offsetWidth;
        if (left < strip.scrollLeft) strip.scrollLeft = left - 4;
        else if (right > strip.scrollLeft + strip.clientWidth) {
            strip.scrollLeft = right - strip.clientWidth + 4;
        }
    };

    const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            const body = bodyRef.current;
            const target =
                body?.querySelector<HTMLElement>('.op-icon-cell[tabindex="0"]') ??
                body?.querySelector<HTMLElement>(".op-icon-cell");
            if (target) {
                e.preventDefault();
                target.focus({ preventScroll: true });
                target.scrollIntoView({ block: "nearest" });
            }
        } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            // Never let Enter submit the dialog's form from inside the picker
            // (an IME's commit-Enter is left alone).
            e.preventDefault();
            if (!results) return;
            if (results.icons[0]) pick(results.icons[0]);
            else if (results.emoji[0]) {
                pick(glyphFor(results.emoji[0], results.pasted ? results.tone : tone));
            }
        }
    };

    /* Arrow keys move between cells, across group boundaries; Home/End jump within a group. */
    const onBodyKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const body = bodyRef.current;
        const cell = (e.target as HTMLElement).closest<HTMLElement>(".op-icon-cell");
        const grid = cell?.parentElement;
        if (!body || !cell || !grid) return;
        const cells = cellsOf(grid);
        const i = cells.indexOf(cell);
        const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
        let next: HTMLElement | undefined;
        switch (e.key) {
            case "ArrowRight":
                next = cells[i + 1] ?? cellsOf(siblingGrid(body, grid, 1))[0];
                break;
            case "ArrowLeft":
                next = cells[i - 1] ?? cellsOf(siblingGrid(body, grid, -1)).at(-1);
                break;
            case "ArrowDown":
                next =
                    cells[i + cols] ??
                    cellInColumn(siblingGrid(body, grid, 1), i % cols, cols, false);
                break;
            case "ArrowUp":
                next =
                    cells[i - cols] ??
                    cellInColumn(siblingGrid(body, grid, -1), i % cols, cols, true);
                break;
            case "Home":
                next = cells[0];
                break;
            case "End":
                next = cells.at(-1);
                break;
            default:
                return;
        }
        if (!next) return;
        e.preventDefault();
        // Roving tabindex hand-off; the grids are memoised so this survives re-renders.
        cell.tabIndex = -1;
        next.tabIndex = 0;
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: "nearest" });
    };

    /* Header preview follows the pointer/focus; gutters and headers keep the last cell. */
    const hoverFromEvent = (e: MouseEvent<HTMLDivElement> | FocusEvent<HTMLDivElement>) => {
        const cell = (e.target as HTMLElement).closest<HTMLElement>(".op-icon-cell");
        const id = cell?.dataset.iconId;
        const label = cell?.getAttribute("aria-label");
        if (!id || !label) return;
        setHovered((prev) => (prev && prev.id === id ? prev : { id, label }));
    };
    const onBodyBlur = (e: FocusEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(null);
    };

    const showStrip = !searching && (tab === "emoji" || sections.length > 0);

    // The shell is an invisible sizing box; `className` lands here (position/margin
    // utilities), while the visible surface, radius and clipping belong to the panel.
    return (
        <div className={cn("orbit-design op-icon-shell", className)}>
            <style>{ICON_PICKER_STYLES}</style>
            <div className="op-icon-picker">
                <div className="op-icon-head">
                    <span
                        className="op-icon-head-chip"
                        style={{
                            background: `color-mix(in oklab, ${tint} 22%, transparent)`,
                            color: tint,
                        }}
                        aria-hidden
                    >
                        <HeadIcon className="size-4" />
                    </span>
                    <span className="op-icon-head-name">{headLabel}</span>
                    {canRevert && (
                        <button
                            type="button"
                            className="op-icon-head-revert"
                            aria-label={`Revert to ${revertLabel}`}
                            title={`Revert to ${revertLabel}`}
                            // Not a pick: reverting shouldn't file the old icon under Recent.
                            onClick={() => onChange(defaultValue)}
                        >
                            Revert
                        </button>
                    )}
                </div>

                <div className="op-icon-search">
                    <Search
                        className="op-icon-search-glass size-3.5"
                        aria-hidden
                        style={{ color: "var(--fg-4)" }}
                    />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onSearchKeyDown}
                        placeholder="Search icons & emoji…"
                        className="op-icon-search-input"
                        aria-label="Search icons and emoji"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => setQuery("")}
                            className="op-icon-search-clear"
                            aria-label="Clear search"
                        >
                            <X className="size-3" />
                        </button>
                    )}
                </div>
                <p className="sr-only" role="status">
                    {results
                        ? `${formatCount(results.icons.length, results.iconsMore)} icons, ${formatCount(results.emoji.length, results.emojiMore)} emoji`
                        : ""}
                </p>

                {!searching && (
                    <div className="op-icon-tabs" role="group" aria-label="Icon set">
                        <button
                            type="button"
                            aria-pressed={tab === "icons"}
                            className={cn("op-icon-tab", tab === "icons" && "is-active")}
                            onClick={() => setTab("icons")}
                        >
                            Icons
                            <span className="op-icon-tab-count">{LUCIDE_COUNT}</span>
                        </button>
                        <button
                            type="button"
                            aria-pressed={tab === "emoji"}
                            className={cn("op-icon-tab", tab === "emoji" && "is-active")}
                            onClick={() => setTab("emoji")}
                        >
                            Emoji
                            <span className="op-icon-tab-count">
                                {emojiView
                                    ? emojiView.entries.length.toLocaleString()
                                    : failed
                                      ? "—"
                                      : "…"}
                            </span>
                        </button>
                    </div>
                )}

                {showStrip && (
                    <div
                        ref={stripRef}
                        className={cn("op-icon-strip", stripMore && "has-more")}
                        role="group"
                        aria-label="Jump to category"
                        onScroll={measureStrip}
                        onKeyDown={onStripKeyDown}
                    >
                        {sections.map((s) => {
                            const Icon = getIcon(s.icon);
                            const isActive = s.key === currentSection;
                            return (
                                <button
                                    key={s.key}
                                    type="button"
                                    data-section-btn={s.key}
                                    className={cn("op-icon-strip-btn", isActive && "is-active")}
                                    style={isActive ? stripActiveStyle : undefined}
                                    title={s.label}
                                    aria-label={`Jump to ${s.label}`}
                                    aria-current={isActive || undefined}
                                    tabIndex={s.key === stripTabStop ? 0 : -1}
                                    onClick={() => scrollToSection(s.key)}
                                >
                                    <Icon className="size-3.5" />
                                </button>
                            );
                        })}
                    </div>
                )}

                <div
                    ref={bodyRef}
                    className="op-icon-body"
                    onScroll={onBodyScroll}
                    onKeyDown={onBodyKeyDown}
                    onMouseOver={hoverFromEvent}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={hoverFromEvent}
                    onBlur={onBodyBlur}
                >
                    {results ? (
                        results.icons.length === 0 && results.emoji.length === 0 ? (
                            <p className="op-icon-empty">
                                {noTokens ? (
                                    <>
                                        Search works in English &mdash; try &ldquo;rent&rdquo; or
                                        &ldquo;groceries&rdquo;.
                                    </>
                                ) : !emojiView && !failed ? (
                                    "Loading emoji…"
                                ) : (
                                    <>
                                        Nothing matches &ldquo;{q}&rdquo;
                                        {failed && (
                                            <>
                                                {" "}
                                                &middot; emoji didn&rsquo;t load.
                                                <button
                                                    type="button"
                                                    className="op-icon-retry"
                                                    onClick={retry}
                                                >
                                                    Retry
                                                </button>
                                            </>
                                        )}
                                    </>
                                )}
                            </p>
                        ) : (
                            <>
                                {results.icons.length > 0 && (
                                    <section className="op-icon-group" data-section="results:icons">
                                        <div className="op-icon-group-head">
                                            <span className="op-icon-group-title">
                                                Icons
                                                <span className="op-icon-group-count">
                                                    {formatCount(
                                                        results.icons.length,
                                                        results.iconsMore
                                                    )}
                                                </span>
                                            </span>
                                        </div>
                                        <LucideGrid
                                            label="Matching icons"
                                            names={results.icons}
                                            active={activeLucide}
                                            roving={
                                                results.icons.includes(activeLucide)
                                                    ? activeLucide
                                                    : activeInResults
                                                      ? null
                                                      : (results.icons[0] ?? null)
                                            }
                                            activeStyle={activeStyle}
                                            onPick={pick}
                                        />
                                    </section>
                                )}
                                {results.emoji.length > 0 && (
                                    <section className="op-icon-group" data-section="results:emoji">
                                        <div className="op-icon-group-head">
                                            <span className="op-icon-group-title">
                                                Emoji
                                                <span className="op-icon-group-count">
                                                    {formatCount(
                                                        results.emoji.length,
                                                        results.emojiMore
                                                    )}
                                                </span>
                                            </span>
                                            {results.emoji.some((e) => e.skin) && (
                                                <SkinToneDots tone={tone} onChange={changeTone} />
                                            )}
                                        </div>
                                        <EmojiGrid
                                            label="Matching emoji"
                                            entries={results.emoji}
                                            tone={results.pasted ? results.tone : tone}
                                            active={activeEmoji}
                                            roving={
                                                results.emoji.some((e) => e.key === activeEmoji)
                                                    ? activeEmoji
                                                    : activeInResults || results.icons.length > 0
                                                      ? null
                                                      : (results.emoji[0]?.key ?? null)
                                            }
                                            activeStyle={activeStyle}
                                            onPick={pick}
                                        />
                                    </section>
                                )}
                                {!emojiView && (
                                    <p className="op-icon-note">
                                        {failed ? (
                                            <>
                                                Emoji didn&rsquo;t load.
                                                <button
                                                    type="button"
                                                    className="op-icon-retry"
                                                    onClick={retry}
                                                >
                                                    Retry
                                                </button>
                                            </>
                                        ) : (
                                            "Loading emoji…"
                                        )}
                                    </p>
                                )}
                            </>
                        )
                    ) : (
                        <>
                            {tab === "emoji" && !emojiView && (
                                <p className="op-icon-empty">
                                    {failed ? (
                                        <>
                                            Couldn&rsquo;t load emoji.
                                            <button
                                                type="button"
                                                className="op-icon-retry"
                                                onClick={retry}
                                            >
                                                Retry
                                            </button>
                                        </>
                                    ) : (
                                        "Loading emoji…"
                                    )}
                                </p>
                            )}
                            {sections.map((s) => (
                                <GroupSection
                                    key={s.key}
                                    section={s}
                                    tone={tone}
                                    onTone={changeTone}
                                    activeLucide={activeLucide}
                                    activeEmoji={activeEmoji}
                                    ownsTabStop={s.key === rovingSectionKey}
                                    metrics={metrics}
                                    activeStyle={activeStyle}
                                    onPick={pick}
                                />
                            ))}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function GroupSection({
    section: s,
    tone,
    onTone,
    activeLucide,
    activeEmoji,
    ownsTabStop,
    metrics,
    activeStyle,
    onPick,
}: {
    section: PickerSection;
    tone: SkinTone;
    onTone: (t: SkinTone) => void;
    activeLucide: string;
    activeEmoji: string;
    /** This section holds the body's single Tab stop: the current value's cell if it has it, else its first cell. */
    ownsTabStop: boolean;
    metrics: { cols: number; row: number };
    activeStyle: CSSProperties;
    onPick: (id: string) => void;
}) {
    const isEmoji = s.kind === "emoji";
    const count = s.kind === "lucide" ? s.names.length : s.entries.length;
    // Emoji groups are skipped by the renderer while off-screen; the hint keeps
    // the scrollbar honest until they have been laid out once.
    const rows = Math.ceil(count / metrics.cols);
    const showDots = s.kind === "emoji" && s.hasSkin && s.key !== "recent";
    const header = GROUP_HEADER_HEIGHT + (showDots ? 9 : 0); // tone dots make the header taller
    const estimate = rows * metrics.row - GRID_GAP + header;
    return (
        <section
            data-section={s.key}
            className={cn("op-icon-group", isEmoji && "is-emoji")}
            style={isEmoji ? { containIntrinsicSize: `auto ${Math.round(estimate)}px` } : undefined}
        >
            <div className="op-icon-group-head">
                <span className="op-icon-group-title">{s.label}</span>
                {/* One tone control per view — Recent renders in the chosen tone but doesn't repeat the dots. */}
                {showDots && <SkinToneDots tone={tone} onChange={onTone} />}
            </div>
            {s.kind === "lucide" ? (
                <LucideGrid
                    label={s.label}
                    names={s.names}
                    active={s.names.includes(activeLucide) ? activeLucide : null}
                    roving={
                        !ownsTabStop
                            ? null
                            : s.names.includes(activeLucide)
                              ? activeLucide
                              : (s.names[0] ?? null)
                    }
                    activeStyle={activeStyle}
                    onPick={onPick}
                />
            ) : (
                <EmojiGrid
                    label={s.label}
                    entries={s.entries}
                    tone={s.hasSkin ? tone : 0}
                    active={s.keys.has(activeEmoji) ? activeEmoji : null}
                    roving={
                        !ownsTabStop
                            ? null
                            : s.keys.has(activeEmoji)
                              ? activeEmoji
                              : (s.entries[0]?.key ?? null)
                    }
                    activeStyle={activeStyle}
                    onPick={onPick}
                />
            )}
        </section>
    );
}

/* Grids are memoised: `active`/`roving` only reach the group that contains the
   selection (or the first group), so picking an icon re-renders two groups
   instead of ~2,500 cells. Exactly one cell in the whole body carries
   tabIndex 0 — Tab enters the grid once, arrows move inside it. */

const LucideGrid = memo(function LucideGrid({
    label,
    names,
    active,
    roving,
    activeStyle,
    onPick,
}: {
    label: string;
    names: readonly string[];
    active: string | null;
    roving: string | null;
    activeStyle: CSSProperties;
    onPick: (id: string) => void;
}) {
    return (
        <div className="op-icon-grid" role="radiogroup" aria-label={label}>
            {names.map((name) => {
                const Icon = ENTITY_ICONS[name];
                if (!Icon) return null;
                const isActive = name === active;
                const text = humanize(name);
                return (
                    <button
                        key={name}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        aria-label={text}
                        title={text}
                        tabIndex={name === roving ? 0 : -1}
                        data-icon-id={name}
                        onClick={() => onPick(name)}
                        className={cn("op-icon-cell", isActive && "is-active")}
                        style={isActive ? activeStyle : undefined}
                    >
                        <Icon className="size-4" />
                    </button>
                );
            })}
        </div>
    );
});

const EmojiGrid = memo(function EmojiGrid({
    label,
    entries,
    tone,
    active,
    roving,
    activeStyle,
    onPick,
}: {
    label: string;
    entries: readonly EmojiEntry[];
    tone: SkinTone;
    active: string | null;
    roving: string | null;
    activeStyle: CSSProperties;
    onPick: (id: string) => void;
}) {
    return (
        <div className="op-icon-grid" role="radiogroup" aria-label={label}>
            {entries.map((e) => {
                const glyph = glyphFor(e, tone);
                const isActive = e.key === active;
                return (
                    <button
                        key={e.key}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        aria-label={e.label}
                        title={e.label}
                        tabIndex={e.key === roving ? 0 : -1}
                        data-icon-id={glyph}
                        onClick={() => onPick(glyph)}
                        className={cn("op-icon-cell op-icon-cell-emoji", isActive && "is-active")}
                        style={isActive ? activeStyle : undefined}
                    >
                        {glyph}
                    </button>
                );
            })}
        </div>
    );
});

function SkinToneDots({ tone, onChange }: { tone: SkinTone; onChange: (t: SkinTone) => void }) {
    // One Tab stop; arrows change the tone like a native radio group.
    const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
        const n = SKIN_TONE_SWATCHES.length;
        let next: number;
        switch (e.key) {
            case "ArrowRight":
            case "ArrowDown":
                next = (tone + 1) % n;
                break;
            case "ArrowLeft":
            case "ArrowUp":
                next = (tone + n - 1) % n;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = n - 1;
                break;
            default:
                return;
        }
        e.preventDefault();
        onChange(next as SkinTone);
        (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
    };
    return (
        <span
            className="op-tone-dots"
            role="radiogroup"
            aria-label="Skin tone"
            onKeyDown={onKeyDown}
        >
            {SKIN_TONE_SWATCHES.map((swatch, i) => (
                <button
                    key={swatch}
                    type="button"
                    role="radio"
                    aria-checked={tone === i}
                    aria-label={`${SKIN_TONE_LABELS[i]} skin tone`}
                    title={SKIN_TONE_LABELS[i]}
                    tabIndex={tone === i ? 0 : -1}
                    className={cn("op-tone-dot", tone === i && "is-active")}
                    style={{ "--tone": swatch } as CSSProperties}
                    onClick={() => onChange(i as SkinTone)}
                />
            ))}
        </span>
    );
}

/**
 * Compact popover-trigger: the current icon + chevron. Opens the IconPicker
 * in a popover that closes on select. Use this in dialogs where the inline
 * picker would dominate the form. `portal={false}` keeps the popover inside
 * the dialog's focus trap and scroll lock.
 */
export function IconPickerButton({
    value,
    onChange,
    color,
    className,
    defaultValue,
}: {
    value: string;
    onChange: (name: string) => void;
    color?: string;
    className?: string;
    defaultValue?: string;
}) {
    const [open, setOpen] = useState(false);
    const Icon = getIcon(value);
    const tone = color ?? "var(--fg-2)";
    const label = isEmojiIcon(value) ? value : humanize(canonicalIconName(value));
    const handleChange = useCallback(
        (next: string) => {
            onChange(next);
            setOpen(false);
        },
        [onChange]
    );
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn("op-picker-trigger", className)}
                    aria-label={`Choose icon (current: ${label})`}
                    title={`Icon: ${label}`}
                >
                    <style>{PICKER_TRIGGER_STYLES}</style>
                    <span className="op-picker-trigger-icon" style={{ color: tone }} aria-hidden>
                        <Icon className="size-4" />
                    </span>
                    <ChevronDown className="size-3 op-picker-trigger-chev" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                portal={false}
                align="start"
                collisionPadding={8}
                onOpenAutoFocus={focusOnOpen(".op-icon-search-input")}
                aria-label="Icon picker"
                className="orbit-design w-[min(24rem,calc(100vw-1.5rem))] p-0 bg-transparent border-0 shadow-none"
            >
                <IconPicker
                    value={value}
                    onChange={handleChange}
                    color={color}
                    defaultValue={defaultValue}
                />
            </PopoverContent>
        </Popover>
    );
}

const ICON_PICKER_STYLES = `
/* The shell owns the height and is the size container; a container query can
   only style descendants, so the panel itself must be one level down.
   Fixed height so switching tabs or typing doesn't resize the popover; Radix
   exposes the room left in the viewport for the chosen side. */
.op-icon-shell {
    height: min(32rem, var(--radix-popover-content-available-height, 32rem));
    background: transparent; /* .orbit-design paints --bg; the rounded panel owns the surface */
    container-type: size;
    container-name: iconpicker;
}
.op-icon-picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    padding: 10px;
    border-radius: 12px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg);
    overflow: hidden;
    font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
}
/* Short popovers (landscape phones, a trigger mid-viewport): drop the optional
   chrome so the grid keeps room instead of being clipped. */
@container iconpicker (max-height: 340px) {
    .op-icon-picker { gap: 6px; padding: 8px; }
    .op-icon-head { min-height: 24px; }
    .op-icon-head-chip { width: 24px; height: 24px; border-radius: 7px; }
    .op-icon-head-revert { min-height: 24px; padding: 3px 8px; }
    .op-icon-strip { display: none; }
    .op-icon-body { gap: 6px; min-height: 4rem; }
    .op-icon-group-head { padding: 3px 4px; }
}
/* Very short: the preview is a convenience (cells carry title + aria-label); Revert stays. */
@container iconpicker (max-height: 260px) {
    .op-icon-head-chip, .op-icon-head-name { display: none; }
    .op-icon-head { min-height: 0; justify-content: flex-end; }
    .op-icon-head:not(:has(.op-icon-head-revert)) { display: none; }
    .op-icon-tab { height: 22px; }
    .op-icon-body { min-height: 2.5rem; }
}
.op-icon-head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    min-height: 30px;
    padding: 0 2px;
}
.op-icon-head-chip {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
}
/* display:block is what lets ::first-letter capitalise the name — keep them together */
.op-icon-head-name {
    display: block;
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.op-icon-head-name::first-letter { text-transform: uppercase; }
.op-icon-head-revert {
    border: 0;
    background: transparent;
    color: var(--fg-3);
    font: inherit;
    font-size: 11.5px;
    min-height: 28px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
}
.op-icon-head-revert:hover { color: var(--fg); background: var(--bg-elev-2); }
.op-icon-head-revert:focus-visible,
.op-icon-tab:focus-visible,
.op-icon-search-clear:focus-visible,
.op-icon-retry:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
}
/* the strip is a scroll container, so an outset ring would be clipped */
.op-icon-strip-btn:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: -2px;
}
.op-icon-search {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    height: 36px;
    padding: 0 12px;
    border-radius: 10px;
    background: var(--bg-elev-2);
    border: 1px solid var(--line);
    transition: border-color 120ms ease, box-shadow 120ms ease;
}
.op-icon-search:focus-within {
    border-color: color-mix(in oklab, var(--brand) 55%, var(--line));
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 22%, transparent);
}
.op-icon-search-glass {
    margin-right: 8px;
    flex-shrink: 0;
}
.op-icon-search-input {
    flex: 1;
    background: transparent;
    border: 0;
    outline: none;
    color: var(--fg);
    font-size: 16px; /* below 16px iOS Safari zooms the page on focus */
    font-family: inherit;
    min-width: 0;
}
@media (pointer: fine) {
    .op-icon-search-input { font-size: 13px; }
}
.op-icon-search-input::placeholder { color: var(--fg-3); }
.op-icon-search-clear {
    margin-left: 4px;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: transparent;
    border: 0;
    color: var(--fg-3);
    cursor: pointer;
    display: grid;
    place-items: center;
}
.op-icon-search-clear:hover { color: var(--fg); background: var(--bg-elev-3); }

.op-icon-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px;
    padding: 3px;
    flex-shrink: 0;
    border-radius: 10px;
    background: var(--bg-elev-2);
    border: 1px solid var(--line);
}
.op-icon-tab {
    height: 28px;
    border-radius: 7px;
    border: 0;
    background: transparent;
    color: var(--fg-3);
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background 140ms ease, color 140ms ease;
}
.op-icon-tab:hover { color: var(--fg); }
.op-icon-tab.is-active {
    background: var(--bg-elev-3);
    color: var(--fg);
    box-shadow: var(--shadow-1);
}
.op-icon-tab-count {
    font-size: 10.5px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
}
.op-icon-tab.is-active .op-icon-tab-count { color: var(--fg-2); }

.op-icon-strip {
    position: relative;
    display: flex;
    gap: 2px;
    flex-shrink: 0;
    min-height: 26px;
    padding: 0 2px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
}
.op-icon-strip::-webkit-scrollbar { display: none; }
.op-icon-strip.has-more {
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
}
.op-icon-strip-btn {
    flex: 0 0 auto;
    width: 30px;
    height: 26px;
    border-radius: 7px;
    border: 0;
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background 140ms ease, color 140ms ease;
}
.op-icon-strip-btn:hover { color: var(--fg); background: var(--bg-elev-2); }
.op-icon-strip-btn.is-active {
    color: var(--brand);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--fg) 40%, transparent);
}

.op-icon-body {
    position: relative;
    flex: 1;
    min-height: 6rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px 2px 4px;
}
.op-icon-empty {
    padding: 32px 0;
    text-align: center;
    color: var(--fg-3);
    font-size: 12.5px;
}
.op-icon-note {
    padding: 8px 4px;
    text-align: center;
    color: var(--fg-3);
    font-size: 11.5px;
}
.op-icon-retry {
    margin-left: 6px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--brand);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
}
.op-icon-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
/* Off-screen emoji groups skip layout and paint; the inline size hint stands in. */
.op-icon-group.is-emoji { content-visibility: auto; }
.op-icon-group-head {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-elev-1);
    padding: 6px 4px;
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
}
.op-icon-group-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.op-icon-group-count {
    margin-left: 6px;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
}
.op-icon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(${GRID_MIN_CELL}px, 1fr));
    gap: ${GRID_GAP}px;
}
.op-icon-cell {
    aspect-ratio: 1;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
    display: grid;
    place-items: center;
    padding: 0;
    /* keep a focused cell clear of the sticky group header */
    scroll-margin-top: 32px;
    scroll-margin-bottom: 4px;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.op-icon-cell:hover {
    background: var(--bg-elev-2);
    color: var(--fg);
}
.op-icon-cell:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: -2px;
}
/* tint-independent ring (3.5:1 on the panel) so a near-black entity colour still shows the selection */
.op-icon-cell.is-active {
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--fg) 40%, transparent);
}
.op-icon-cell-emoji {
    font-family: ${EMOJI_FONT_STACK};
    font-size: 20px;
    line-height: 1;
    color: var(--fg);
}
.op-tone-dots {
    display: inline-flex;
    gap: 2px;
    margin-left: auto;
}
/* 24px hit area around a 14px swatch */
.op-tone-dot {
    width: 24px;
    height: 24px;
    border: 0;
    background: none;
    padding: 0;
    display: grid;
    place-items: center;
    cursor: pointer;
    border-radius: 50%;
}
.op-tone-dot::after {
    content: "";
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--tone);
    border: 1px solid color-mix(in oklab, var(--fg) 40%, transparent);
}
.op-tone-dot.is-active::after {
    box-shadow: 0 0 0 2px var(--bg-elev-1), 0 0 0 3.5px var(--fg-2);
}
.op-tone-dot:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 0;
}
`;
