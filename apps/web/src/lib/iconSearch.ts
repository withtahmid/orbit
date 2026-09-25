import { ENTITY_ICON_CATEGORIES } from "@/lib/entityIcons";
import { emojiKey, isEmojiIcon, type EmojiEntry } from "@/lib/emoji";

/**
 * Ranked token search over both icon kinds for the picker. Every query term
 * should match; when nothing exactly answers every term — "Emergency fund",
 * "School fees" — items matching some terms are returned instead. A term
 * matches a token of the label (best), of the curated budgeting synonyms, of
 * the tags (CLDR keywords / lucide-static tags / GitHub shortcodes) or of the
 * category name (weakest). Query terms also try naive singulars and, when
 * nothing else matches, one-edit typos.
 */

export type IconKind = "lucide" | "emoji";

export interface IconSearchItem {
    kind: IconKind;
    /** Persisted value: Lucide key or emoji string. */
    id: string;
    label: string;
    /** Set for emoji items. */
    entry?: EmojiEntry;
    labelTokens: string[];
    /** Curated budgeting vocabulary; `primary` outranks exact label hits, `other` sits between exact and prefix. */
    synonyms: SynonymTokens;
    tagTokens: string[];
    /** Category / Unicode-group name — the weakest tier, never a real match on its own ("bills" would otherwise hit 65 icons). */
    categoryTokens: string[];
    /** Catalog position — the tie-breaker so results keep a familiar order. */
    order: number;
}

/** Lowercase, strip diacritics, split on anything that is not a letter or digit. */
export function tokenize(text: string): string[] {
    const seen = new Set<string>();
    for (const token of text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/\p{M}+/gu, "")
        .split(/[^a-z0-9]+/)) {
        if (token) seen.add(token);
    }
    return [...seen];
}

/**
 * Budgeting vocabulary → icons. The names people actually give categories
 * ("Salary", "Groceries", "Utilities", "EMI") rarely appear in Lucide or CLDR
 * keywords, so each term is attached to a few good matches. Keys are
 * space-separated terms; targets are registry keys or emoji (matched by
 * `emojiKey`, so presentation selectors don't matter). The first target of
 * each kind is the term's *primary* icon and outranks even exact label hits
 * (so "car" gives 🚗 "automobile" before "railway car"); the rest rank between
 * an exact and a prefix label hit. Unknown targets are ignored.
 *
 * A line's primary is fixed for all its terms — split a line when one term
 * wants a different icon. Keep generic icons (`sparkles`, `landmark`,
 * `hand-coins`) off topical lines: a target that sits on many lines becomes a
 * false "answers every term" magnet for two-word names.
 */
const SYNONYMS: Record<string, string[]> = {
    "salary paycheck payday wage wages income earnings": [
        "banknote",
        "briefcase",
        "💰",
        "💵",
        "💼",
    ],
    "bonus tip tips": ["gift", "💰", "🎁"],
    "rent landlord": ["house", "key", "building-2", "🏠", "🔑", "🏢"],
    mortgage: ["house", "key", "🏠", "🏦"],
    "flat apartment": ["building-2", "house", "🏢", "🏠"],
    household: ["house", "sofa", "🏠", "🛋️"],
    furniture: ["sofa", "armchair", "🛋️", "🪑"],
    appliances: ["washing-machine", "refrigerator", "microwave", "🧺", "🔌"],
    "utility utilities": ["zap", "droplets", "plug", "💡", "🚰", "🔌"],
    "electricity electric power": ["zap", "plug-zap", "⚡", "💡"],
    "desco dpdc nesco bidyut reb palli": ["zap", "⚡"],
    "ac airconditioner conditioner cooling cooler": ["air-vent", "fan", "❄️", "🌬️"],
    water: ["droplets", "glass-water", "💧", "🚰"],
    wasa: ["droplets", "🚰"],
    "gas lpg": ["flame", "fuel", "🔥", "⛽"],
    titas: ["flame", "🔥"],
    "internet wifi wi fi broadband data": ["wifi", "router", "📶", "🌐"],
    "mobile phone airtime recharge topup sim": ["smartphone", "phone", "📱", "📲"],
    "gp grameenphone robi airtel banglalink teletalk": ["smartphone", "📱", "📶"],
    "subscription subscriptions recurring membership": ["repeat", "calendar-sync", "🔁", "📅"],
    "streaming netflix youtube hoichoi chorki toffee": ["tv-minimal-play", "film", "📺", "🎬"],
    spotify: ["music", "headphones", "🎧", "🎵"],
    "food meal meals eat eating": ["utensils", "hand-platter", "🍽️", "🍔"],
    "rice chal biryani khichuri": ["wheat", "🍚", "🍛"],
    "bread ruti paratha bakery": ["croissant", "🍞", "🥖"],
    "grocery groceries supermarket bazar bazaar market chaldal": [
        "shopping-cart",
        "shopping-basket",
        "apple",
        "🛒",
        "🧺",
        "🥬",
    ],
    "daraz ecommerce online": ["shopping-cart", "package", "🛒", "📦"],
    "courier parcel delivery foodpanda": ["package", "truck", "📦", "🛵"],
    "restaurant dining lunch dinner breakfast": [
        "utensils",
        "chef-hat",
        "hand-platter",
        "🍽️",
        "🍔",
        "🥡",
    ],
    "takeout takeaway": ["hand-platter", "utensils", "🥡", "🍽️"],
    "tiffin canteen lunchbox": ["hand-platter", "utensils", "🥡", "🍽️"],
    "coffee cafe": ["coffee", "cup-soda", "☕", "🧋"],
    "tea chai": ["coffee", "🍵", "🧋"],
    "snack snacks": ["cookie", "candy", "popcorn", "🍪", "🍫", "🍿"],
    "transport transportation commute fare uber pathao ride": [
        "bus",
        "car-taxi",
        "car",
        "🚌",
        "🚕",
        "🛺",
    ],
    "taxi cab": ["car-taxi", "🚕"],
    "car cars automobile": ["car", "car-front", "🚗", "🚙"],
    "driver chauffeur": ["car-front", "user-round", "🚗"],
    "train rail railway": ["tram", "train-front", "🚆", "🚇"],
    "metro subway underground": ["train-front", "tram", "🚇", "🚆"],
    rickshaw: ["bike", "🛺"],
    "cng autorickshaw tuktuk": ["car-taxi", "bike", "🛺"],
    "fuel petrol diesel octane": ["fuel", "⛽"],
    "parking toll": ["parking-circle", "parking-meter", "road", "🅿️", "🛣️"],
    "servicing mechanic garage": ["wrench", "car", "🔧", "🚗"],
    "health doctor medical checkup": ["stethoscope", "heart-pulse", "hospital", "🩺", "❤️‍🩹", "🏥"],
    "hospital clinic": ["hospital", "stethoscope", "🏥", "🩺"],
    "medicine pharmacy drugs": ["pill", "pill-bottle", "💊", "🩹"],
    "dentist dental tooth teeth": ["briefcase-medical", "🦷"],
    "lab pathology diagnostic": ["test-tube", "microscope", "🧪", "🔬"],
    insurance: ["shield-check", "umbrella", "🛡️", "☂️"],
    "gym fitness workout": ["dumbbell", "biceps-flexed", "🏋️", "💪"],
    "sports sport": ["volleyball", "dumbbell", "⚽", "🏀"],
    "cricket khela": ["volleyball", "🏏", "🦗"],
    "football soccer": ["volleyball", "⚽", "🥅"],
    "education tuition college university course coaching": [
        "graduation-cap",
        "school",
        "book-open",
        "🎓",
        "🏫",
        "📚",
    ],
    school: ["school", "graduation-cap", "🏫", "🎓"],
    "playgroup admission": ["school", "backpack", "🏫", "🎒"],
    "quran madrasa hifz islamic religious": ["book-open", "📖", "🕌"],
    "kids kid children child daycare nursery": ["baby", "blocks", "🧒", "👶", "🧸"],
    "baby infant newborn": ["baby", "👶", "🍼"],
    "diaper diapers nappy": ["baby", "👶", "🧷"],
    "family parents": ["users", "house-heart", "👨‍👩‍👧", "🏡"],
    "pet pets vet": ["paw-print", "dog", "cat", "🐾", "🐶", "🐱"],
    "clothes clothing fashion apparel outfit": ["shirt", "sport-shoe", "handbag", "👕", "👗", "👟"],
    "tailor sewing stitching": ["shirt", "🪡", "🧵"],
    "beauty salon haircut": ["scissors", "💇", "💄"],
    barber: ["scissors", "💈", "💇"],
    "cosmetics makeup skincare lipstick": ["spray-can", "💄", "🧴"],
    "toiletries grooming hygiene": ["soap-dispenser-droplet", "spray-can", "🧴", "🧼"],
    "entertainment fun movies cinema": ["film", "ticket", "🎬", "🎟️"],
    "games gaming videogames": ["gamepad-2", "joystick", "🎮", "🕹️"],
    "hobby hobbies craft": ["palette", "guitar", "puzzle", "🎨", "🎸", "🧩"],
    "books reading stationery stationary": ["book", "book-open", "pencil", "📚", "📖", "✏️"],
    "travel trip holiday vacation flight tour": ["plane", "luggage", "hotel", "✈️", "🧳", "🏨"],
    "passport visa immigration": ["id-card", "plane", "🛂", "🛫"],
    "hajj umrah pilgrimage": ["landmark", "plane", "🕋", "🕌"],
    "mosque masjid": ["landmark", "🕌"],
    "gift gifts present": ["gift", "🎁"],
    birthday: ["cake", "party-popper", "🎂", "🎉"],
    "wedding anniversary": ["gem", "heart", "💍", "💒"],
    "mehendi holud haldi": ["gem", "💐", "💍"],
    "charity donation zakat sadaqah tithe": ["hand-heart", "hand-helping", "🤲", "💝"],
    "eid ramadan iftar sehri suhoor": ["party-popper", "🕌", "🎉"],
    "qurbani korbani sacrifice": ["beef", "drumstick", "🐄", "🐐"],
    puja: ["flame", "sparkles", "🪔", "🎉"],
    "boishakh baishakh noboborsho": ["party-popper", "sun", "🎊", "🐟"],
    "festival celebration": ["party-popper", "🎉", "✨"],
    "savings saving emergency piggy rainy": ["piggy-bank", "vault", "🐷", "🏦", "🪙"],
    "fund funds": ["piggy-bank", "vault", "🐷", "🎯"],
    "dps fdr sanchayapatra sanchay deposit": ["piggy-bank", "vault", "🏦", "🪙"],
    "pension retirement retired gratuity provident pf gpf": ["piggy-bank", "landmark", "🏦", "🪙"],
    "budget budgets envelope envelopes": ["mail", "wallet", "chart-pie", "✉️", "💰"],
    "investment investing stocks shares dividend crypto": [
        "trending-up",
        "chart-candlestick",
        "bitcoin",
        "📈",
        "💹",
        "🪙",
    ],
    "interest profit yield return": ["percent", "trending-up", "📈", "💹"],
    "loan loans debt emi installment instalment kisti": [
        "hand-coins",
        "credit-card",
        "🏦",
        "💳",
        "🧾",
    ],
    "lend lent borrow owe owed dues payable": ["handshake", "hand-coins", "🤝", "💸"],
    "tax taxes vat": ["landmark", "scale", "receipt-text", "🧾", "🏛️"],
    "bill bills invoice fee fees charge charges": [
        "receipt",
        "receipt-text",
        "file-text",
        "🧾",
        "📄",
    ],
    cash: ["banknote", "wallet", "💵", "👛"],
    "wallet purse": ["wallet", "👛", "💵"],
    "atm withdrawal": ["banknote", "🏧", "💵"],
    "bank banking": ["landmark", "credit-card", "🏦", "💳"],
    "account chequing checking": ["landmark", "credit-card", "🏦", "💳"],
    "bkash nagad upay": ["smartphone-nfc", "smartphone", "📲", "💳"],
    "transfer remittance": ["arrow-right-left", "send", "💸", "🔁"],
    "exchange forex": ["currency", "arrow-right-left", "💱", "💸"],
    "refund cashback reimbursement": ["hand-coins", "badge-percent", "💸"],
    "maintenance repair renovation plumber electrician": [
        "wrench",
        "hammer",
        "paint-roller",
        "🔧",
        "🔨",
        "🪛",
    ],
    "cleaning maid housekeeper househelp bua": [
        "brush-cleaning",
        "soap-dispenser-droplet",
        "🧹",
        "🧼",
    ],
    laundry: ["washing-machine", "🧺", "🧼"],
    "electronics gadgets tech computer": ["laptop", "smartphone", "headphones", "💻", "📱", "🎧"],
    "software apps saas hosting domain": ["app-window", "cloud-upload", "code", "🖥️", "☁️", "🧑‍💻"],
    "work business freelance client upwork fiverr hustle gig sidehustle": [
        "briefcase",
        "briefcase-business",
        "building-2",
        "💼",
        "🏢",
        "🧑‍💻",
    ],
    office: ["building-2", "briefcase", "🏢", "💼"],
    "alcohol drinks bar": ["wine", "beer", "martini", "🍷", "🍺", "🍸"],
    "smoking tobacco": ["cigarette", "🚬"],
    "misc miscellaneous other personal": ["box", "sparkles", "user", "📦", "✨", "🙂"],
    "goal goals wishlist dream": ["goal", "target", "star", "🎯", "⭐", "🏆"],
};

/**
 * Money-generic words: in a multi-term name they say what KIND of entity it
 * is, not what it is about, so they must not outrank the topical term
 * ("School fees" → school, not landmark). Applied only when the query also
 * has a non-generic term; a bare "Subscription" still finds `repeat`.
 */
const GENERIC_TERMS = new Set([
    "fund",
    "funds",
    "bill",
    "bills",
    "fee",
    "fees",
    "payment",
    "payments",
    "cost",
    "costs",
    "expense",
    "expenses",
    "charge",
    "charges",
    "due",
    "dues",
    "budget",
    "budgets",
    "money",
    "monthly",
    "yearly",
    "annual",
    "total",
    "misc",
    "new",
    "subscription",
    "subscriptions",
    "membership",
]);
const GENERIC_WEIGHT = 0.5;
/** Filler that carries no topic ("Eating out", "Makeup and salon") — dropped when other terms remain. */
const STOP_WORDS = new Set([
    "and",
    "or",
    "the",
    "a",
    "an",
    "of",
    "for",
    "to",
    "in",
    "on",
    "at",
    "with",
    "my",
    "our",
    "out",
]);

interface SynonymTokens {
    primary: string[];
    other: string[];
}

/** Target (registry key or emoji key) → synonym tokens, split by primary/other. */
const SYNONYM_TOKENS: ReadonlyMap<string, SynonymTokens> = (() => {
    const map = new Map<string, SynonymTokens>();
    for (const [terms, targets] of Object.entries(SYNONYMS)) {
        const tokens = tokenize(terms);
        const primaryLucide = targets.find((t) => !isEmojiIcon(t));
        const primaryEmoji = targets.find((t) => isEmojiIcon(t));
        for (const target of targets) {
            const key = isEmojiIcon(target) ? emojiKey(target) : target;
            const entry = map.get(key) ?? { primary: [], other: [] };
            const isPrimary = target === primaryLucide || target === primaryEmoji;
            (isPrimary ? entry.primary : entry.other).push(...tokens);
            map.set(key, entry);
        }
    }
    return map;
})();

const NO_SYNONYMS: SynonymTokens = { primary: [], other: [] };

const unique = (tokens: string[]) => [...new Set(tokens)];

export function buildLucideSearchIndex(tags: Readonly<Record<string, string>>): IconSearchItem[] {
    const items: IconSearchItem[] = [];
    for (const category of ENTITY_ICON_CATEGORIES) {
        const categoryTokens = tokenize(category.label);
        for (const name of category.names) {
            const labelTokens = tokenize(name);
            const tagTokens = tokenize(tags[name] ?? "").filter((t) => !labelTokens.includes(t));
            items.push({
                kind: "lucide",
                id: name,
                label: name.replace(/-/g, " "),
                labelTokens,
                synonyms: SYNONYM_TOKENS.get(name) ?? NO_SYNONYMS,
                tagTokens: unique(tagTokens),
                categoryTokens,
                order: items.length,
            });
        }
    }
    return items;
}

export function buildEmojiSearchIndex(
    entries: readonly EmojiEntry[],
    groups: readonly string[]
): IconSearchItem[] {
    const groupTokens = groups.map((g) => tokenize(g));
    return entries.map((entry, order) => {
        const labelTokens = tokenize(entry.label);
        return {
            kind: "emoji",
            id: entry.emoji,
            label: entry.label,
            entry,
            labelTokens,
            synonyms: SYNONYM_TOKENS.get(entry.key) ?? NO_SYNONYMS,
            tagTokens: unique(tokenize(entry.tags)),
            categoryTokens: groupTokens[entry.group] ?? [],
            order,
        };
    });
}

/**
 * A guessed singular scores this fraction of a real hit, so "news" still ranks
 * 📰 (prefix of "newspaper") above the exact "new moon" that the stem "new"
 * would otherwise win with; it still wins when it is the whole label
 * ("tickets" → 🎫 ticket).
 */
const STEM_DISCOUNT = 0.6;
/**
 * A term is genuinely matched from this score up (tag exact / synonym prefix
 * or better). Weaker hits — a tag prefix, a category name — only order
 * results.
 */
const STRONG_MATCH = 1.5;
/**
 * Only exact-level hits (label / synonym exact) on every term make a
 * multi-term query count as fully answered. A prefix is not enough: "car" is
 * a prefix of "card", and letting `credit-card` fully answer "car loan" would
 * hide every car and every loan icon (it may still rank first there — the
 * real answers follow it).
 */
const EXACT_MATCH = 2.5;
/** Score of a primary-synonym exact hit — the top tier. */
const PRIMARY_EXACT = 3.5;
/**
 * One-edit typos ("grocerries", "sallary") — tried only when a term matched
 * nothing at all, never a strong match. Tiered by where the near-miss landed
 * so a line's primary icon wins its own typo (shopping-cart, not apple).
 */
const TYPO_PRIMARY = 1.2;
const TYPO_LABEL = 1.1;
const TYPO_OTHER = 1.0;
const TYPO_MIN_LENGTH = 5;
/** Partial matches shown after a query's full matches. */
const PARTIAL_TAIL = 24;

interface Scored {
    item: IconSearchItem;
    score: number;
    full: boolean;
    strong: number;
}

const byRank = (a: Scored, b: Scored) =>
    b.strong - a.strong ||
    b.score - a.score ||
    a.item.labelTokens.length - b.item.labelTokens.length ||
    a.item.order - b.item.order;

export function searchIcons(
    index: readonly IconSearchItem[],
    query: string,
    limit: number
): IconSearchItem[] {
    // "Cox's Bazar" → cox bazar: a possessive is not a term, and in a
    // multi-word query a lone character ("s" prefixes half the catalog) or a
    // filler word is noise.
    let tokens = mergeSingleLetters(tokenize(query.replace(/['’]s\b/gi, "")));
    if (tokens.length > 1) {
        const kept = tokens.filter((t) => t.length > 1 && !STOP_WORDS.has(t));
        if (kept.length > 0) tokens = kept;
        else if (tokens.every((t) => STOP_WORDS.has(t))) return []; // "of the" is not a query
    }
    if (tokens.length === 0) return [];
    const hasTopic = tokens.some((t) => !GENERIC_TERMS.has(t));
    const terms = tokens.map((term) => ({
        term,
        stems: stems(term),
        weight: tokens.length > 1 && hasTopic && GENERIC_TERMS.has(term) ? GENERIC_WEIGHT : 1,
        fuzzy: term.length >= TYPO_MIN_LENGTH,
    }));

    const scored: Scored[] = [];
    let anyExactFull = false;
    for (const item of index) {
        let score = 0;
        let matched = 0;
        let strong = 0;
        let exact = 0;
        let primary = 0;
        for (const { term, stems: singulars, weight, fuzzy } of terms) {
            let best = termScore(item, term);
            for (const stem of singulars) {
                best = Math.max(best, termScore(item, stem) * STEM_DISCOUNT);
            }
            if (best === 0 && fuzzy) best = fuzzyScore(item, term);
            if (best > 0) {
                matched++;
                score += best * weight;
                // A down-weighted generic term ("payment") mustn't count as a full-strength
                // hit, or a "payment"-tagged card outranks the car in "Car payment".
                if (best * weight >= STRONG_MATCH) strong++;
                if (best >= EXACT_MATCH) exact++;
                if (best >= PRIMARY_EXACT) primary++;
            }
        }
        if (matched === 0) continue;
        const full = matched === terms.length;
        if (full) {
            if (exact === terms.length) anyExactFull = true;
            // Whole-label match ("pizza" for pizza, not pizza slice) floats to the
            // top — and so does the curated primary icon, or 🦗 "cricket" would
            // outrank 🏏 "cricket game" on the label alone.
            const wholeLabel =
                item.labelTokens.length === terms.length &&
                terms.every(
                    ({ term, stems: singulars }) =>
                        item.labelTokens.includes(term) ||
                        singulars.some((stem) => item.labelTokens.includes(stem))
                );
            if (wholeLabel || primary === terms.length) score += 2;
        }
        scored.push({ item, score, full, strong });
    }
    // Without an exact answer to every term, partial matches stand in — "Travel
    // fund" shows travel icons rather than nothing — ordered by how many terms
    // they really hit, then by strength.
    if (!anyExactFull)
        return scored
            .sort(byRank)
            .slice(0, limit)
            .map((s) => s.item);
    // Otherwise full matches lead ("credit card" stays crisp) and a short tail of
    // the strongest partials follows, so a coincidence like "key" answering "key
    // rent" can never hide the obvious icon.
    const full = scored.filter((s) => s.full).sort(byRank);
    const tail = scored
        .filter((s) => !s.full && s.strong > 0)
        .sort(byRank)
        .slice(0, PARTIAL_TAIL);
    return [...full, ...tail].slice(0, limit).map((s) => s.item);
}

/** Naive singular forms of a query term, so "groceries" finds grocery and "taxes" tax. */
function stems(term: string): string[] {
    if (term.length <= 3 || term.endsWith("ss")) return [];
    if (term.endsWith("ies")) return [term.slice(0, -3) + "y", term.slice(0, -1)]; // berries → berry, cookies → cookie
    if (term.endsWith("es")) {
        const out = [term.slice(0, -1)]; // shoes → shoe
        if (/(s|x|z|ch|sh)es$/.test(term)) out.push(term.slice(0, -2)); // taxes → tax, dishes → dish
        return out;
    }
    if (term.endsWith("s")) return [term.slice(0, -1)];
    return [];
}

/*
 * Tiers: primary-synonym exact 3.5 · label exact 3 · synonym exact 2.5 ·
 * label prefix 2 · primary-synonym prefix 1.75 · synonym prefix / tag exact 1.5 ·
 * tag prefix 1 · label substring (≥4 chars) 0.75 · category exact 0.5 / prefix
 * 0.35. A one- or two-letter term only counts as a weak hint when it merely
 * prefixes a token ("ac" → activity). Tags get no substring rule — CLDR
 * keyword lists are long and arbitrary ("rice" would hit "p-rice").
 */
function termScore(item: IconSearchItem, term: string): number {
    const prefixOk = term.length >= 3;
    let best = 0;
    for (const token of item.synonyms.primary) {
        if (token === term) return PRIMARY_EXACT;
        if (token.startsWith(term)) best = Math.max(best, prefixOk ? 1.75 : 1.3);
    }
    for (const token of item.labelTokens) {
        if (token === term) return 3;
        if (token.startsWith(term)) best = Math.max(best, prefixOk ? 2 : 1.4);
        else if (term.length >= 4 && token.includes(term)) best = Math.max(best, 0.75);
    }
    for (const token of item.synonyms.other) {
        if (token === term) return 2.5;
        if (token.startsWith(term)) best = Math.max(best, prefixOk ? 1.5 : 1.2);
    }
    if (best >= 1.5) return best;
    for (const token of item.tagTokens) {
        if (token === term) return 1.5;
        if (token.startsWith(term)) best = Math.max(best, 1);
    }
    if (best > 0) return best;
    for (const token of item.categoryTokens) {
        if (token === term) return 0.5;
        if (token.startsWith(term)) best = Math.max(best, 0.35);
    }
    return best;
}

/** Labels and synonyms only — tag lists are too long and arbitrary to fuzz. */
function fuzzyScore(item: IconSearchItem, term: string): number {
    const near = (token: string) => token.length >= 4 && withinOneEdit(token, term);
    if (item.synonyms.primary.some(near)) return TYPO_PRIMARY;
    if (item.labelTokens.some(near)) return TYPO_LABEL;
    if (item.synonyms.other.some(near)) return TYPO_OTHER;
    return 0;
}

/** "A/C" tokenizes to a, c — rejoin runs of single letters so they search as "ac". */
function mergeSingleLetters(tokens: string[]): string[] {
    const out: string[] = [];
    let run = "";
    for (const t of tokens) {
        if (t.length === 1 && t >= "a" && t <= "z") {
            run += t;
            continue;
        }
        if (run) out.push(run);
        run = "";
        out.push(t);
    }
    if (run) out.push(run);
    return out;
}

/** Damerau–Levenshtein distance ≤ 1: one insertion, deletion, substitution or adjacent swap. */
function withinOneEdit(a: string, b: string): boolean {
    if (a === b) return true;
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0;
    while (i < la && i < lb && a[i] === b[i]) i++;
    if (la === lb) {
        if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
        return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // swap
    }
    return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i); // insert / delete
}
