import type { SVGProps } from "react";
import { EMOJI_FONT_STACK } from "@/lib/emoji";

/**
 * Renders an emoji inside a 24×24 SVG viewBox so it sizes exactly like a
 * Lucide icon: `className="size-4"` and friends just work, and it drops into
 * every existing `<Icon className=… />` site untouched. SVG text scales with
 * the viewBox, which a plain <span> cannot do from a width/height class.
 * `size` mirrors Lucide's prop; `fill` only matters when the platform has no
 * colour-emoji font. Decorative by default (like every entity icon site
 * today) — pass `aria-label` or `role` to make it announced.
 */
export function EmojiGlyph({
    emoji,
    size = 24,
    ...props
}: { emoji: string; size?: number | string } & SVGProps<SVGSVGElement>) {
    const labelled = props["aria-label"] != null || props["aria-labelledby"] != null;
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="currentColor"
            focusable="false"
            aria-hidden={labelled ? undefined : true}
            role={labelled ? "img" : undefined}
            {...props}
        >
            {/* 19/24: colour-emoji fonts sit ~1.2em tall and the outer <svg> clips overflow. */}
            <text
                x="12"
                y="12"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="19"
                fontFamily={EMOJI_FONT_STACK}
            >
                {emoji}
            </text>
        </svg>
    );
}
