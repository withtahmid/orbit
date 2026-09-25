import { useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColorPicker } from "@/components/shared/ColorPicker";
import { IconPicker } from "@/components/shared/IconPicker";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { canonicalIconName, getIcon } from "@/lib/entityIcons";
import { isEmojiIcon } from "@/lib/emoji";
import { focusOnOpen } from "@/lib/autofocus";

/**
 * Compact color + icon picker pair used in every entity's create/edit
 * dialog. Both pickers live behind small popover triggers so they don't
 * dominate narrow forms. The popover content uses the editorial-dark
 * pickers; the inline preview row uses orbit tokens with sensible
 * fallbacks so it works inside both shadcn dialogs and OrbitModalShells.
 * The icon popover closes on select; the color one stays open for comparing.
 */
export function EntityStyleFields({
    color,
    setColor,
    icon,
    setIcon,
    name,
    defaultIcon,
}: {
    color: string;
    setColor: (c: string) => void;
    icon: string;
    setIcon: (i: string) => void;
    name?: string;
    /** The icon the form opened with; the picker offers "Revert" to it while the icon differs. */
    defaultIcon?: string;
}) {
    const IconCmp = getIcon(icon);
    const iconLabel = isEmojiIcon(icon) ? icon : canonicalIconName(icon).replace(/-/g, " ");
    const [iconOpen, setIconOpen] = useState(false);
    const pickIcon = useCallback(
        (next: string) => {
            setIcon(next);
            setIconOpen(false);
        },
        [setIcon]
    );
    return (
        <div className="esf-row">
            <style>{ESF_STYLES}</style>
            <EntityAvatar color={color} icon={icon} size="lg" />
            <div className="esf-text">
                <p className="esf-name">{name?.trim() || "Preview"}</p>
                <p className="esf-sub">Pick a color and icon</p>
            </div>
            <div className="esf-controls">
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="esf-trigger"
                            aria-label="Choose color"
                            title="Color"
                        >
                            <span
                                className="esf-swatch"
                                style={{ backgroundColor: color }}
                                aria-hidden
                            />
                            <ChevronDown className="size-3 esf-chev" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        portal={false}
                        align="end"
                        collisionPadding={8}
                        aria-label="Color picker"
                        className="orbit-design w-[min(20rem,calc(100vw-1.5rem))] p-2 bg-transparent border-0 shadow-none"
                    >
                        <ColorPicker value={color} onChange={setColor} />
                    </PopoverContent>
                </Popover>
                <Popover open={iconOpen} onOpenChange={setIconOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="esf-trigger"
                            aria-label={`Choose icon (current: ${iconLabel})`}
                            title={`Icon: ${iconLabel}`}
                        >
                            <IconCmp className="size-4" />
                            <ChevronDown className="size-3 esf-chev" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        portal={false}
                        align="end"
                        collisionPadding={8}
                        onOpenAutoFocus={focusOnOpen(".op-icon-search-input")}
                        aria-label="Icon picker"
                        className="orbit-design w-[min(24rem,calc(100vw-1.5rem))] p-0 bg-transparent border-0 shadow-none"
                    >
                        <IconPicker
                            value={icon}
                            onChange={pickIcon}
                            color={color}
                            defaultValue={defaultIcon}
                        />
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
}

const ESF_STYLES = `
.esf-row {
    display: flex;
    flex-wrap: wrap; /* ≤~400px: the two triggers drop under the avatar + text instead of crushing it */
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 12px;
    border: 1px solid var(--line, hsl(var(--border)));
    background: var(--bg-elev-2, hsl(var(--muted) / 0.3));
}
.esf-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 8rem;
}
.esf-name {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--fg, hsl(var(--foreground)));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0;
}
.esf-sub {
    font-size: 11.5px;
    color: var(--fg-3, hsl(var(--muted-foreground)));
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.esf-controls {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    margin-left: auto;
}
/* same box as .op-picker-trigger so the two hosts read as one control */
.esf-trigger {
    height: 38px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: 10px;
    background: var(--bg-elev-1, hsl(var(--background)));
    border: 1px solid var(--line, hsl(var(--border)));
    color: var(--fg, hsl(var(--foreground)));
    cursor: pointer;
    font-family: inherit;
    transition: background 120ms ease, border-color 120ms ease;
}
.esf-trigger:hover {
    background: var(--bg-elev-2, hsl(var(--accent)));
    border-color: var(--line-strong, hsl(var(--border)));
}
.esf-swatch {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 1px solid var(--line, hsl(var(--border)));
}
.esf-chev { color: var(--fg-4, hsl(var(--muted-foreground))); opacity: 0.7; }
`;
