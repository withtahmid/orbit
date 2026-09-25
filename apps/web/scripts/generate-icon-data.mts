/**
 * Regenerates the icon-picker datasets. Run `pnpm generate-icons` from
 * apps/web (network access required — the sources are fetched from jsDelivr
 * at the pinned versions below; the output is committed):
 *
 *   src/lib/icons/emoji.generated.json
 *       Every RGI emoji from emojibase (CLDR data): glyph, English label,
 *       group, Emoji spec version, search tags (CLDR keywords + GitHub
 *       shortcodes) and whether a single skin-tone modifier applies. Also the
 *       per-version probe emoji the client uses to detect platform support.
 *
 *   src/lib/icons/lucide-tags.generated.json
 *       lucide-static search tags for every key in the curated ENTITY_ICONS
 *       registry. Rerun after adding icons to entityIcons.ts.
 *
 * It also asserts the invariants the runtime relies on: every emoji (and
 * every skin-tone variant we synthesise) passes `isEmojiIcon`, emoji keys are
 * unique, and every registry key sits in exactly one category.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENTITY_ICON_CATEGORIES, ENTITY_ICONS, LEGACY_ICON_ALIASES } from "../src/lib/entityIcons";
import { applySkinTone, emojiKey, isEmojiIcon, type SkinTone } from "../src/lib/emoji";
import { tokenize } from "../src/lib/iconSearch";

const EMOJIBASE_VERSION = "17.0.0";
const LUCIDE_STATIC_VERSION = "1.47.0";
const CDN = "https://cdn.jsdelivr.net/npm";
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/icons");

/** emojibase group id for skin-tone / hair components — not pickable emoji. */
const COMPONENT_GROUP = 2;
/** Probe one representative per spec version from here up; older emoji are assumed universal. */
const FIRST_PROBED_VERSION = 11;

/**
 * Registry keys whose Lucide icon was renamed upstream after we adopted the
 * key (lucide-static tags are keyed by the current name). Keys are persisted,
 * so the registry keeps the old spelling and this map bridges to the tags.
 */
const LUCIDE_TAG_ALIASES: Record<string, string> = {
    home: "house",
    "wallet-2": "wallet-minimal",
    "car-taxi": "car-taxi-front",
    tram: "tram-front",
    library: "library-big",
    "parking-circle": "circle-parking",
    "check-circle-2": "circle-check",
    "circle-help": "circle-question-mark",
    "alert-triangle": "triangle-alert",
    train: "tram-front",
    unlock: "lock-open",
    "trash-2": "trash",
    "building-2": "building-complex",
    "book-marked": "book-bookmark",
    waves: "waves-horizontal",
    "file-signature": "file-pen-line", // FileSignature is an alias of FilePenLine
    fingerprint: "fingerprint-pattern",
    smile: "face-slightly-smiling",
    laugh: "face-grinning",
    meh: "face-neutral",
    frown: "face-slightly-frowning",
    angry: "face-angry",
    annoyed: "face-expressionless",
};

interface EmojibaseEmoji {
    label: string;
    hexcode: string;
    emoji: string;
    version: number;
    tags?: string[];
    order?: number;
    group?: number;
    skins?: EmojibaseEmoji[];
    tone?: number | number[];
}
interface EmojibaseMessages {
    groups: { key: string; order: number; message: string }[];
}
type GithubShortcodes = Record<string, string | string[]>;
type LucideTags = Record<string, string[]>;

async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

async function main() {
    const base = `${CDN}/emojibase-data@${EMOJIBASE_VERSION}/en`;
    const [emojis, messages, github, lucideTags] = await Promise.all([
        fetchJson<EmojibaseEmoji[]>(`${base}/data.json`),
        fetchJson<EmojibaseMessages>(`${base}/messages.json`),
        fetchJson<GithubShortcodes>(`${base}/shortcodes/github.json`),
        fetchJson<LucideTags>(`${CDN}/lucide-static@${LUCIDE_STATIC_VERSION}/tags.json`),
    ]);
    const problems: string[] = [];

    // --- emoji ---------------------------------------------------------------
    const groupDefs = messages.groups
        .filter((g) => g.order !== COMPONENT_GROUP)
        .sort((a, b) => a.order - b.order);
    const groupIndex = new Map(groupDefs.map((g, i) => [g.order, i]));
    const groups = groupDefs.map((g) => titleCase(g.message));

    // Regional-indicator letters carry no group and are not emoji on their own.
    const included = emojis
        .filter(
            (e): e is EmojibaseEmoji & { group: number } =>
                e.group !== undefined && e.group !== COMPONENT_GROUP
        )
        .sort(
            (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
        );

    const seenKeys = new Set<string>();
    let skinCount = 0;
    const tuples = included.map((e) => {
        const labelTokens = new Set(tokenize(e.label));
        const tagTokens = new Set<string>();
        const gh = github[e.hexcode];
        const rawTags = [...(e.tags ?? []), ...(Array.isArray(gh) ? gh : gh ? [gh] : [])];
        for (const raw of rawTags) {
            for (const token of tokenize(raw)) if (!labelTokens.has(token)) tagTokens.add(token);
        }

        let skin: 0 | 1 = 0;
        if (e.skins?.length) {
            skin = 1;
            for (let tone = 1; tone <= 5; tone++) {
                const expected = e.skins.find((s) => s.tone === tone)?.emoji;
                const actual = applySkinTone(e.emoji, tone as SkinTone);
                if (!expected || actual !== expected) {
                    skin = 0; // multi-person sequences need per-person tones — offered neutral only
                    break;
                }
                if (!isEmojiIcon(actual)) {
                    problems.push(`isEmojiIcon rejects skin variant ${actual} of ${e.label}`);
                }
                if (emojiKey(actual) !== emojiKey(e.emoji)) {
                    problems.push(`emojiKey differs for skin variant of ${e.label}`);
                }
            }
            if (skin) skinCount++;
        }
        if (!isEmojiIcon(e.emoji)) {
            problems.push(`isEmojiIcon rejects ${e.emoji} (${e.hexcode} ${e.label})`);
        }
        const key = emojiKey(e.emoji);
        if (seenKeys.has(key)) problems.push(`duplicate emoji key for ${e.hexcode} ${e.label}`);
        seenKeys.add(key);

        const group = groupIndex.get(e.group);
        if (group === undefined) problems.push(`unknown group ${e.group} for ${e.hexcode}`);
        return [e.emoji, e.label, group ?? -1, e.version, [...tagTokens].join(" "), skin] as const;
    });

    const byVersion = new Map<number, EmojibaseEmoji[]>();
    for (const e of included) {
        if (e.version < FIRST_PROBED_VERSION) continue;
        const list = byVersion.get(e.version) ?? [];
        list.push(e);
        byVersion.set(e.version, list);
    }
    const probes = [...byVersion.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([version, list]) => {
            // Prefer a single code point: its failure mode (tofu) is unambiguous.
            // Versions that only added ZWJ sequences rely on the width test.
            const pick = list.find((e) => !e.hexcode.includes("-")) ?? list[0]!;
            return [version, pick.emoji] as const;
        });
    // 🇧🇩 — any country flag works; they are all-or-nothing per platform.
    const flagProbe =
        included.find((e) => e.hexcode === "1F1E7-1F1E9")?.emoji ?? "\u{1F1FA}\u{1F1F3}";

    // --- lucide tags -----------------------------------------------------------
    const lucide: Record<string, string> = {};
    const missingTags: string[] = [];
    for (const key of Object.keys(ENTITY_ICONS)) {
        const tags = lucideTags[key] ?? lucideTags[LUCIDE_TAG_ALIASES[key] ?? ""];
        if (!tags) {
            missingTags.push(key);
            continue;
        }
        lucide[key] = [...new Set(tags.flatMap((t) => tokenize(t)))].join(" ");
    }

    // --- registry invariants ---------------------------------------------------
    const registrySize = Object.keys(ENTITY_ICONS).length;
    const categorised = ENTITY_ICON_CATEGORIES.reduce((n, c) => n + c.names.length, 0);
    if (categorised + Object.keys(LEGACY_ICON_ALIASES).length !== registrySize) {
        problems.push(
            `registry has ${registrySize} keys but categories + legacy aliases cover ${categorised + Object.keys(LEGACY_ICON_ALIASES).length} — a key is in two categories or missing`
        );
    }
    for (const c of ENTITY_ICON_CATEGORIES) {
        if (!ENTITY_ICONS[c.icon]) {
            problems.push(`category "${c.label}" strip icon "${c.icon}" is not a registry key`);
        }
    }

    if (problems.length) {
        console.error(problems.join("\n"));
        process.exit(1);
    }

    // --- write -------------------------------------------------------------------
    await mkdir(OUT_DIR, { recursive: true });
    const emojiJson = [
        "{",
        `"source":${JSON.stringify({ emojibase: EMOJIBASE_VERSION })},`,
        `"groups":${JSON.stringify(groups)},`,
        `"flagProbe":${JSON.stringify(flagProbe)},`,
        `"probes":${JSON.stringify(probes)},`,
        `"emojis":[`,
        tuples.map((t) => JSON.stringify(t)).join(",\n"),
        "]",
        "}",
        "",
    ].join("\n");
    await writeFile(path.join(OUT_DIR, "emoji.generated.json"), emojiJson);
    await writeFile(
        path.join(OUT_DIR, "lucide-tags.generated.json"),
        JSON.stringify(lucide, null, 4) + "\n"
    );

    const perGroup = groups
        .map((g, i) => `${g} ${tuples.filter((t) => t[2] === i).length}`)
        .join(", ");
    console.log(`emoji: ${tuples.length} (${perGroup}); ${skinCount} with skin tones`);
    console.log(`probes: ${probes.map(([v, e]) => `${v} ${e}`).join("  ")}; flags ${flagProbe}`);
    console.log(`lucide: tags for ${Object.keys(lucide).length}/${registrySize} keys`);
    if (missingTags.length) {
        console.warn(
            `  no lucide-static tags for: ${missingTags.join(", ")}\n` +
                `  (renamed upstream? add the current name to LUCIDE_TAG_ALIASES)`
        );
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
