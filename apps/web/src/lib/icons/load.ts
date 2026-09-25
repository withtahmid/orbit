import emojiDataUrl from "./emoji.generated.json?url";
import lucideTagsUrl from "./lucide-tags.generated.json?url";
import { parseEmojiDataset, type EmojiDataset } from "@/lib/emoji";

/**
 * Lazy loaders for the generated icon data. The files are fetched as static
 * assets rather than `import()`ed: a failed module fetch is cached by the ES
 * module map for the life of the page (so a "Retry" could never succeed),
 * whereas a failed `fetch()` is simply retried, and the 120 KB emoji list
 * never has to be parsed as JavaScript. Results are cached per session.
 */

let emojiCache: EmojiDataset | null = null;
let emojiPending: Promise<EmojiDataset> | null = null;

/** The dataset if it has already been loaded this session (no fetch). */
export function peekEmojiDataset(): EmojiDataset | null {
    return emojiCache;
}

export function loadEmojiDataset(): Promise<EmojiDataset> {
    if (emojiCache) return Promise.resolve(emojiCache);
    if (!emojiPending) {
        emojiPending = fetchJson(emojiDataUrl)
            .then((json) => (emojiCache = parseEmojiDataset(json)))
            .catch((err: unknown) => {
                emojiPending = null;
                throw err;
            });
    }
    return emojiPending;
}

export type LucideTags = Readonly<Record<string, string>>;

let tagsCache: LucideTags | null = null;
let tagsPending: Promise<LucideTags> | null = null;

export function peekLucideTags(): LucideTags | null {
    return tagsCache;
}

/** Search tags for the curated Lucide keys; search works by name until they arrive. */
export function loadLucideTags(): Promise<LucideTags> {
    if (tagsCache) return Promise.resolve(tagsCache);
    if (!tagsPending) {
        tagsPending = fetchJson(lucideTagsUrl)
            .then((json) => {
                if (!json || typeof json !== "object" || Array.isArray(json)) {
                    throw new Error("lucide-tags.generated.json has an unexpected shape");
                }
                return (tagsCache = json as LucideTags);
            })
            .catch((err: unknown) => {
                tagsPending = null;
                throw err;
            });
    }
    return tagsPending;
}

async function fetchJson(url: string): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return res.json();
}
