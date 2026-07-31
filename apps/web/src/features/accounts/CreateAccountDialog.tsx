import { useState } from "react";
import { Plus, Edit3, Link2, Lock, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OrbitModalShell, OrbitField } from "@/components/orbit/OrbitModalShell";
import { OrbitFormStyles, OrbitInfoPill, OrbitInput } from "@/components/orbit/OrbitForm";
import { ColorPickerButton } from "@/components/shared/ColorPicker";
import { IconPickerButton } from "@/components/shared/IconPicker";
import { trpc } from "@/trpc";
import { useCurrentSpaceId } from "@/hooks/useCurrentSpace";
import { DEFAULT_COLOR } from "@/lib/entityStyle";

type AccountType = "asset" | "liability" | "locked";

const TYPE_TILES: Array<{
    id: AccountType;
    label: string;
    sub: string;
    icon: string;
    color: string;
}> = [
    {
        id: "asset",
        label: "Asset",
        sub: "Cash, checking, savings",
        icon: "wallet",
        color: "#10b981",
    },
    {
        id: "liability",
        label: "Liability",
        sub: "Credit cards, loans",
        icon: "credit-card",
        color: "#f43f5e",
    },
    {
        id: "locked",
        label: "Locked",
        sub: "FD / DPS — cannot spend",
        icon: "piggy-bank",
        color: "#eab308",
    },
];

const DEFAULT_ICON_BY_TYPE: Record<AccountType, string> = {
    asset: "wallet",
    liability: "credit-card",
    locked: "piggy-bank",
};

type Method = "manual" | "plaid";

export function CreateAccountDialog({ trigger }: { trigger?: React.ReactNode } = {}) {
    const spaceId = useCurrentSpaceId();
    const [open, setOpen] = useState(false);
    const [method, setMethod] = useState<Method>("manual");
    const [name, setName] = useState("");
    const [accountType, setAccountType] = useState<AccountType>("asset");
    const [color, setColor] = useState<string>(DEFAULT_COLOR);
    const [icon, setIcon] = useState(DEFAULT_ICON_BY_TYPE.asset);
    const [iconTouched, setIconTouched] = useState(false);
    const utils = trpc.useUtils();

    const create = trpc.account.create.useMutation({
        onSuccess: async () => {
            toast.success("Account created");
            await utils.account.listBySpace.invalidate({ spaceId });
            setName("");
            setAccountType("asset");
            setIcon(DEFAULT_ICON_BY_TYPE.asset);
            setIconTouched(false);
            setColor(DEFAULT_COLOR);
            setOpen(false);
        },
        onError: (e) => toast.error(e.message),
    });

    const submit = () => {
        if (!name.trim()) return;
        create.mutate({
            space_id: spaceId,
            name: name.trim(),
            account_type: accountType,
            color,
            icon,
        });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger ?? (
                    <Button variant="gradient">
                        <Plus />
                        New account
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="orbit-shell-host">
                <DialogTitle className="sr-only">Add an account</DialogTitle>
                <OrbitModalShell
                    width={620}
                    eyebrow="Accounts"
                    title="Add an account"
                    subtitle="Connect via Plaid (auto-sync) or add manually. You can change this later."
                    leadIcon={<Wallet className="size-4" />}
                    leadColor="var(--ent-1)"
                    onClose={() => setOpen(false)}
                    footer={
                        <>
                            <button
                                type="button"
                                className="orbit-btn"
                                onClick={() => setOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="orbit-btn orbit-btn-primary"
                                disabled={method === "plaid" || !name.trim() || create.isPending}
                                onClick={submit}
                            >
                                <Plus className="size-3.5" />
                                {create.isPending ? "Creating…" : "Create account"}
                            </button>
                        </>
                    }
                >
                    <OrbitFormStyles />
                    <style>{ACC_STYLES}</style>

                    {/* Method tabs */}
                    <div className="acc-mod-method">
                        <button
                            type="button"
                            className={`acc-mod-method-btn ${method === "plaid" ? "is-active" : ""} is-soon`}
                            onClick={() => setMethod("plaid")}
                            disabled
                            title="Plaid integration is on the roadmap"
                        >
                            <span className="acc-mod-method-head">
                                <Link2 className="size-3.5" />
                                Connect via Plaid
                                <span className="acc-mod-soon">Soon</span>
                            </span>
                            <span className="acc-mod-method-sub">
                                Auto-sync transactions and balances
                            </span>
                        </button>
                        <button
                            type="button"
                            className={`acc-mod-method-btn ${method === "manual" ? "is-active" : ""}`}
                            onClick={() => setMethod("manual")}
                        >
                            <span className="acc-mod-method-head">
                                <Edit3 className="size-3.5" />
                                Add manually
                            </span>
                            <span className="acc-mod-method-sub">
                                Track balance, log transactions yourself
                            </span>
                        </button>
                    </div>

                    {/* Account type tile grid */}
                    {/* noWrapperLabel: a <label> forwards clicks anywhere in the
                        row to its first labelable descendant — here the first tile
                        <button> — so clicking the "Account type" text or any grid
                        gutter silently reassigned the type AND reset the icon. */}
                    <OrbitField label="Account type" noWrapperLabel>
                        <div className="acc-mod-type-grid" role="group" aria-label="Account type">
                            {TYPE_TILES.map((t) => {
                                const Icon = ICON_LOOKUP[t.icon] ?? Wallet;
                                const active = accountType === t.id;
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        className={`acc-mod-type-tile ${active ? "is-active" : ""}`}
                                        onClick={() => {
                                            setAccountType(t.id);
                                            if (!iconTouched) {
                                                setIcon(DEFAULT_ICON_BY_TYPE[t.id]);
                                            }
                                        }}
                                    >
                                        <span
                                            className="acc-mod-type-icon"
                                            style={{
                                                background: `color-mix(in oklab, ${t.color} 18%, transparent)`,
                                                border: `1px solid color-mix(in oklab, ${t.color} 30%, transparent)`,
                                                color: t.color,
                                            }}
                                            aria-hidden
                                        >
                                            <Icon className="size-4" />
                                        </span>
                                        <span className="acc-mod-type-text">
                                            <span className="acc-mod-type-label">{t.label}</span>
                                            <span className="acc-mod-type-sub">{t.sub}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </OrbitField>

                    <OrbitField label="Name" required>
                        <OrbitInput
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Cash, Checking, Credit card…"
                            autoFocus
                            required
                            maxLength={255}
                        />
                    </OrbitField>

                    {/* Same as CategoriesPage's Style field: the colour/icon
                        pickers are buttons, so without this, clicking "Style"
                        opened the colour popover — and because both pickers are
                        portal={false}, clicking the OPEN panel's own padding
                        forwarded back to the trigger and closed it again. */}
                    <OrbitField label="Style" noWrapperLabel>
                        <div className="acc-mod-style-row">
                            <ColorPickerButton value={color} onChange={setColor} />
                            <IconPickerButton
                                value={icon}
                                onChange={(i) => {
                                    setIcon(i);
                                    setIconTouched(true);
                                }}
                                color={color}
                            />
                        </div>
                    </OrbitField>

                    <OrbitInfoPill tone="brand">
                        <Lock
                            className="size-3"
                            style={{ display: "inline-block", marginRight: 4, marginBottom: -2 }}
                        />
                        Read-only access · 256-bit encryption · credentials never stored on Orbit
                        servers.
                    </OrbitInfoPill>
                </OrbitModalShell>
            </DialogContent>
        </Dialog>
    );
}

/* Lazy-look-up so we don't have to enumerate every Lucide icon name. */
import { Wallet as WalletIcon, CreditCard, PiggyBank } from "lucide-react";
const ICON_LOOKUP: Record<string, typeof WalletIcon> = {
    wallet: WalletIcon,
    "credit-card": CreditCard,
    "piggy-bank": PiggyBank,
};

const ACC_STYLES = `
.acc-mod-method {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
}
@media (max-width: 540px) {
    .acc-mod-method { grid-template-columns: 1fr; }
}
.acc-mod-method-btn {
    height: 76px;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
    justify-content: center;
    cursor: pointer;
    font-family: inherit;
    color: var(--fg);
    text-align: left;
    transition: background 120ms ease, border-color 120ms ease;
}
.acc-mod-method-btn:hover:not(.is-active):not(:disabled) {
    border-color: var(--line-strong);
}
.acc-mod-method-btn.is-active {
    background: var(--brand-soft);
    border-color: var(--brand);
}
.acc-mod-method-btn:disabled.is-soon {
    cursor: not-allowed;
    opacity: 0.65;
}
.acc-mod-method-head {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--fg);
}
.acc-mod-method-sub {
    font-size: 11.5px;
    color: var(--fg-3);
}
.acc-mod-soon {
    font-size: 9.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: var(--bg-elev-3);
    color: var(--fg-3);
    border-radius: 4px;
    padding: 2px 6px;
    margin-left: 4px;
}

.acc-mod-type-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
}
@media (max-width: 540px) {
    .acc-mod-type-grid { grid-template-columns: 1fr; }
}
.acc-mod-type-tile {
    height: 64px;
    padding: 0 12px;
    border-radius: 10px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-family: inherit;
    color: var(--fg);
    text-align: left;
    transition: background 120ms ease, border-color 120ms ease;
}
.acc-mod-type-tile:hover:not(.is-active) { border-color: var(--line-strong); }
.acc-mod-type-tile.is-active {
    background: var(--bg-elev-2);
    border-color: var(--line-strong);
    box-shadow: 0 0 0 2px var(--brand-soft) inset;
}
.acc-mod-type-icon {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
}
.acc-mod-type-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.acc-mod-type-label { font-size: 13px; font-weight: 500; color: var(--fg); }
.acc-mod-type-sub { font-size: 10.5px; color: var(--fg-4); }

.acc-mod-style-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
`;
