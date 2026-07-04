import { Link, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import {
    Plus,
    Share2,
    ChevronRight,
    Sparkles,
    TrendingDown,
    Lock,
} from "lucide-react";
import { observer } from "mobx-react-lite";
import { trpc } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { useStore } from "@/stores/useStore";
import { CreateAccountDialog } from "@/features/accounts/CreateAccountDialog";
import { AddExistingAccountDialog } from "@/features/accounts/AddExistingAccountDialog";
import { PermissionGate } from "@/components/shared/PermissionGate";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { ROUTES } from "@/router/routes";
import {
    AccountDistributionBar,
    type AccountSlice,
} from "./AccountDistributionBar";

type NormalizedOwner = {
    id: string;
    first_name: string;
    avatar_file_id: string | null;
};

type NormalizedAccount = {
    id: string;
    name: string;
    account_type: "asset" | "liability" | "locked";
    color: string;
    icon: string;
    balance: number;
    myRole: "owner" | "viewer" | null;
    owners: NormalizedOwner[];
    _spaces: null | Array<{ spaceId: string; name: string }>;
    _otherSpacesCount: number;
};

const UNASSIGNED_OWNER_ID = "__unassigned__";

/** Slice id for the rolled-up tail of the distribution bar — not a real account. */
const OTHER_SLICE_ID = "__other__";

/**
 * Where clicking an account (card, bar segment, or chip) goes.
 * Personal-space accounts open inside their first real space when they
 * belong to one; otherwise there's no detail page to open, so stay put.
 */
function hrefForAccount(
    a: NormalizedAccount,
    isPersonal: boolean,
    spaceId: string
): string {
    if (!isPersonal) return ROUTES.spaceAccountDetail(spaceId, a.id);
    if (a._spaces && a._spaces.length > 0)
        return ROUTES.spaceAccountDetail(a._spaces[0].spaceId, a.id);
    return ROUTES.myAccounts;
}

function fmt2(n: number): string {
    return n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

const AccountsPage = observer(function AccountsPage() {
    const { space } = useCurrentSpace();
    const { authStore } = useStore();
    const navigate = useNavigate();
    const isPersonal = space.isPersonal;
    const currentUserId = authStore.user?.id ?? null;

    const accountsSpaceQuery = trpc.account.listBySpace.useQuery(
        { spaceId: space.id },
        { enabled: !isPersonal }
    );
    const accountsUserQuery = trpc.account.listByUser.useQuery(undefined, {
        enabled: isPersonal,
    });
    const membersQuery = trpc.space.memberList.useQuery(
        { spaceId: space.id },
        { enabled: !isPersonal }
    );

    const accountsQuery = isPersonal ? accountsUserQuery : accountsSpaceQuery;
    const accounts: NormalizedAccount[] = useMemo(() => {
        if (isPersonal) {
            const me: NormalizedOwner | null = currentUserId
                ? {
                      id: currentUserId,
                      first_name: authStore.user?.name ?? "You",
                      avatar_file_id: authStore.user?.avatarFileId ?? null,
                  }
                : null;
            return (accountsUserQuery.data ?? [])
                .filter((a) => a.myRole === "owner")
                .map((a) => ({
                    id: a.id,
                    name: a.name,
                    account_type: a.accountType,
                    color: a.color,
                    icon: a.icon,
                    balance: a.balance,
                    myRole: a.myRole,
                    owners: me ? [me] : [],
                    _spaces: a.spaces,
                    _otherSpacesCount: a.otherSpacesCount,
                }));
        }
        return (accountsSpaceQuery.data ?? []).map((a) => ({
            ...a,
            _spaces: null,
            _otherSpacesCount: 0,
        }));
    }, [
        isPersonal,
        currentUserId,
        authStore.user?.name,
        authStore.user?.avatarFileId,
        accountsUserQuery.data,
        accountsSpaceQuery.data,
    ]);

    const totals = useMemo(() => {
        let assets = 0;
        // Signed sum. Liabilities store amount-owed as a positive number;
        // an overpaid liability goes negative (a net credit — effectively
        // an asset), so no abs() here — it must ADD to net worth, matching
        // the per-card sign flip in AccountCard.
        let liabilities = 0;
        let locked = 0;
        let assetCount = 0;
        let liabilityCount = 0;
        let lockedCount = 0;
        for (const a of accounts) {
            const v = Number(a.balance);
            if (a.account_type === "asset") {
                assets += v;
                assetCount++;
            } else if (a.account_type === "locked") {
                locked += v;
                lockedCount++;
            } else if (a.account_type === "liability") {
                liabilities += v;
                liabilityCount++;
            }
        }
        const net = assets + locked - liabilities;
        return {
            assets,
            liabilities,
            locked,
            net,
            assetCount,
            liabilityCount,
            lockedCount,
        };
    }, [accounts]);

    // Distribution bar — where wealth sits. Positive asset + locked
    // balances only: liabilities are debt (a "negative segment" can't be
    // drawn) and overdrawn accounts can't either, so both stay in the
    // stats instead. Past ~8 segments the chips get noisy, so the tail
    // rolls up into "Other".
    const distSlices = useMemo<AccountSlice[]>(() => {
        const positive = accounts
            .filter(
                (a) => a.account_type !== "liability" && Number(a.balance) > 0
            )
            .sort((a, b) => Number(b.balance) - Number(a.balance))
            .map((a) => ({
                id: a.id,
                name: a.name,
                value: Number(a.balance),
                color: a.color,
            }));
        const TOP = 8;
        if (positive.length <= TOP + 1) return positive;
        const top = positive.slice(0, TOP);
        const restTotal = positive.slice(TOP).reduce((s, d) => s + d.value, 0);
        return [
            ...top,
            {
                id: OTHER_SLICE_ID,
                name: `Other · ${positive.length - TOP} accounts`,
                value: restTotal,
                color: "var(--fg-4)",
            },
        ];
    }, [accounts]);

    const holdingsTotal = useMemo(
        () => distSlices.reduce((s, d) => s + d.value, 0),
        [distSlices]
    );

    const groupedByUser = useMemo(() => {
        const byOwner = new Map<
            string,
            { owner: NormalizedOwner | null; accounts: NormalizedAccount[] }
        >();
        for (const a of accounts) {
            const primary = a.owners[0] ?? null;
            const key = primary?.id ?? UNASSIGNED_OWNER_ID;
            const bucket = byOwner.get(key);
            if (bucket) bucket.accounts.push(a);
            else byOwner.set(key, { owner: primary, accounts: [a] });
        }
        const entries = Array.from(byOwner.entries());
        entries.sort((a, b) => {
            const [aKey, aVal] = a;
            const [bKey, bVal] = b;
            if (aKey === currentUserId && bKey !== currentUserId) return -1;
            if (bKey === currentUserId && aKey !== currentUserId) return 1;
            if (aKey === UNASSIGNED_OWNER_ID) return 1;
            if (bKey === UNASSIGNED_OWNER_ID) return -1;
            return (aVal.owner?.first_name ?? "").localeCompare(
                bVal.owner?.first_name ?? ""
            );
        });
        return entries.map(([key, val]) => ({ key, ...val }));
    }, [accounts, currentUserId]);

    const memberCount = membersQuery.data?.length ?? 0;
    const accountCount = accounts.length;
    const owesNothing = totals.liabilityCount === 0;

    return (
        <div className="orbit-design ac-root">
            <style>{AC_STYLES}</style>

            <header className="ac-topbar">
                <div className="ac-topbar-text">
                    <span className="eyebrow">
                        {accountCount} account{accountCount === 1 ? "" : "s"}
                        {!isPersonal && memberCount > 0
                            ? ` · ${memberCount} member${memberCount === 1 ? "" : "s"}`
                            : ""}
                    </span>
                    <h1 className="display ac-title">Accounts</h1>
                    <p className="ac-sub">
                        {isPersonal
                            ? "Every account you personally own, across all your spaces."
                            : "All accounts in this space, grouped by owner."}
                    </p>
                </div>
                <div className="ac-topbar-actions">
                    <PermissionGate roles={["owner", "editor"]}>
                        <AddExistingAccountDialog
                            trigger={
                                <button type="button" className="od-btn">
                                    <Share2 className="size-3.5" /> Add existing
                                </button>
                            }
                        />
                        <PermissionGate roles={["owner"]}>
                            <CreateAccountDialog
                                trigger={
                                    <button
                                        type="button"
                                        className="od-btn od-btn-primary"
                                    >
                                        <Plus className="size-3.5" /> New account
                                    </button>
                                }
                            />
                        </PermissionGate>
                    </PermissionGate>
                </div>
            </header>

            <div className="ac-scroll">
                {/* ---- Summary: ledger header (net worth hero · composition
                     stats) over a full-width distribution bar ---- */}
                {accountsQuery.isLoading ? (
                    <Skeleton height={210} />
                ) : accounts.length > 0 ? (
                    <section className="od-card vignette ac-summary">
                        {/* Ledger header: net worth is the sole hero on the
                            left; the composition (assets / locked / debt)
                            groups to the right as subordinate figures. */}
                        <div className="ac-ledger">
                            <div className="ac-networth">
                                <span className="eyebrow">Net worth</span>
                                <span
                                    className="tabular ac-networth-val"
                                    style={{
                                        color:
                                            totals.net < 0
                                                ? "var(--expense)"
                                                : "var(--fg)",
                                    }}
                                >
                                    {totals.net < 0 ? "−" : ""}
                                    {fmt2(Math.abs(totals.net))}
                                </span>
                                <span className="ac-networth-sub">
                                    {/* Don't name a term the ledger doesn't
                                        show — Locked hides at 0 accounts. */}
                                    {totals.lockedCount > 0
                                        ? "assets + locked − liabilities"
                                        : "assets − liabilities"}
                                </span>
                            </div>
                            <div className="ac-tstats">
                                <TypeStat
                                    label="Assets"
                                    value={totals.assets}
                                    color={
                                        totals.assets < 0
                                            ? "var(--expense)"
                                            : totals.assets > 0
                                              ? "var(--income)"
                                              : "var(--fg-3)"
                                    }
                                    count={totals.assetCount}
                                />
                                {/* A space with no locked accounts skips the
                                    column instead of showing a hollow 0.00. */}
                                {totals.lockedCount > 0 && (
                                    <TypeStat
                                        label="Locked"
                                        value={totals.locked}
                                        color={
                                            totals.locked < 0
                                                ? "var(--expense)"
                                                : totals.locked > 0
                                                  ? "var(--gold)"
                                                  : "var(--fg-3)"
                                        }
                                        count={totals.lockedCount}
                                    />
                                )}
                                <TypeStat
                                    label="Liabilities"
                                    // Debt reduces net worth → shown negative.
                                    // An overpaid liability flips to a credit
                                    // and renders as a plus, in green.
                                    value={-totals.liabilities}
                                    signed
                                    color={
                                        totals.liabilities > 0
                                            ? "var(--expense)"
                                            : totals.liabilities < 0
                                              ? "var(--income)"
                                              : "var(--fg-3)"
                                    }
                                    count={totals.liabilityCount}
                                    emptyNote={
                                        owesNothing ? "no debt" : undefined
                                    }
                                />
                            </div>
                        </div>

                        <div className="ac-sum-bar">
                            <AccountDistributionBar
                                data={distSlices}
                                onSelect={(s) => {
                                    if (s.id === OTHER_SLICE_ID) return;
                                    const account = accounts.find(
                                        (a) => a.id === s.id
                                    );
                                    if (!account) return;
                                    navigate(
                                        hrefForAccount(
                                            account,
                                            isPersonal,
                                            space.id
                                        )
                                    );
                                }}
                            />
                        </div>

                    </section>
                ) : null}

                {/* ---- Accounts, grouped by owner ---- */}
                {accountsQuery.isLoading ? (
                    <div className="ac-grid">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                            <Skeleton key={i} height={132} />
                        ))}
                    </div>
                ) : accounts.length === 0 ? (
                    <div className="od-card ac-empty">
                        <div
                            style={{
                                fontSize: 14,
                                color: "var(--fg-2)",
                                fontWeight: 500,
                            }}
                        >
                            No accounts yet
                        </div>
                        <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>
                            Create your first account to start tracking money.
                        </div>
                        <PermissionGate roles={["owner"]}>
                            <CreateAccountDialog
                                trigger={
                                    <button className="od-btn od-btn-primary">
                                        <Plus className="size-3.5" /> New
                                        account
                                    </button>
                                }
                            />
                        </PermissionGate>
                    </div>
                ) : (
                    groupedByUser.map(({ key, owner, accounts: group }) => {
                        const isMe = key === currentUserId;
                        const ownerLabel =
                            key === UNASSIGNED_OWNER_ID
                                ? "Unassigned"
                                : isMe
                                  ? `${(owner?.first_name ?? "You").toUpperCase()} (YOU)`
                                  : (owner?.first_name ?? "Unknown").toUpperCase();
                        const isUnassigned = key === UNASSIGNED_OWNER_ID;
                        const total = group.reduce(
                            (acc, a) =>
                                acc +
                                (a.account_type === "liability"
                                    ? -Number(a.balance)
                                    : Number(a.balance)),
                            0
                        );
                        return (
                            <div key={key} className="ac-group">
                                {/* In /s/me every account is yours — a
                                    "YOU · N accounts" header just restates
                                    the page subtitle, so skip it. */}
                                {!isPersonal && (
                                <div className="ac-group-head">
                                    <span className="ac-group-name">
                                        {isUnassigned ? (
                                            <span
                                                className="ac-owner-bubble"
                                                style={{
                                                    background:
                                                        "linear-gradient(135deg, var(--ent-1), var(--ent-2))",
                                                }}
                                                aria-hidden
                                            >
                                                ?
                                            </span>
                                        ) : (
                                            <UserAvatar
                                                fileId={owner?.avatar_file_id}
                                                firstName={owner?.first_name}
                                                size="xs"
                                                className="ac-owner-avatar-img"
                                            />
                                        )}
                                        <span className="ac-owner-label">
                                            {ownerLabel}
                                        </span>
                                        <span className="ac-owner-count">
                                            · {group.length} account
                                            {group.length === 1 ? "" : "s"}
                                        </span>
                                    </span>
                                    <span
                                        className="tabular ac-group-total"
                                        style={{
                                            color:
                                                total < 0
                                                    ? "var(--expense)"
                                                    : "var(--fg)",
                                        }}
                                    >
                                        {total < 0 ? "−" : ""}
                                        {fmt2(Math.abs(total))}
                                    </span>
                                </div>
                                )}
                                <div className="ac-grid">
                                    {group.map((a) => (
                                        <AccountCard
                                            key={a.id}
                                            account={a}
                                            href={hrefForAccount(
                                                a,
                                                isPersonal,
                                                space.id
                                            )}
                                            holdingsTotal={holdingsTotal}
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
});

export default AccountsPage;

function TypeStat({
    label,
    value,
    color,
    count,
    signed = false,
    emptyNote,
}: {
    label: string;
    value: number;
    color: string;
    count: number;
    /** Render a leading +/− (used for liabilities shown as their net-worth effect). */
    signed?: boolean;
    emptyNote?: string;
}) {
    const sign = !signed
        ? value < 0
            ? "−"
            : ""
        : value < 0
          ? "−"
          : value > 0
            ? "+"
            : "";
    return (
        <div className="ac-tstat">
            <span className="eyebrow">{label}</span>
            <span className="tabular ac-tstat-val" style={{ color }}>
                {sign}
                {fmt2(Math.abs(value))}
            </span>
            <span className="ac-tstat-sub">
                {emptyNote ?? `${count} account${count === 1 ? "" : "s"}`}
            </span>
        </div>
    );
}

function AccountCard({
    account,
    href,
    holdingsTotal,
}: {
    account: NormalizedAccount;
    href: string;
    /** Sum of all positive asset+locked balances — for the "% of holdings" foot. */
    holdingsTotal: number;
}) {
    const typeChip =
        account.account_type === "liability"
            ? {
                  label: "Liability",
                  color: "var(--expense)",
                  Icon: TrendingDown,
              }
            : account.account_type === "locked"
              ? { label: "Locked", color: "var(--gold)", Icon: Lock }
              : { label: "Asset", color: "var(--income)", Icon: Sparkles };
    const otherOwnersCount = account.owners.length - 1;
    // Liabilities store the amount owed as a positive number (negative net
    // worth), so flip them; assets/locked keep their sign. A negative signed
    // value means money owed or an overdrawn account.
    const signedBalance =
        account.account_type === "liability"
            ? -Number(account.balance)
            : Number(account.balance);
    const showPct =
        account.account_type !== "liability" &&
        Number(account.balance) > 0 &&
        holdingsTotal > 0;
    const pct = showPct ? (Number(account.balance) / holdingsTotal) * 100 : 0;
    return (
        <Link to={href} className="od-card ac-card">
            <span
                className="ac-card-glow"
                aria-hidden
                style={{
                    background: `radial-gradient(120% 70% at 0% 0%, color-mix(in oklab, ${account.color} 10%, transparent), transparent 70%)`,
                }}
            />
            <div className="ac-card-head">
                <span className="ac-card-name">
                    <Avatar icon={account.icon} color={account.color} size={34} />
                    <span className="ac-card-text">
                        <span className="ac-card-title">{account.name}</span>
                        <span
                            className="ac-card-type"
                            style={{ color: typeChip.color }}
                        >
                            <typeChip.Icon className="ac-card-type-icon" />
                            {typeChip.label}
                        </span>
                    </span>
                </span>
                <ChevronRight
                    className="size-3.5 ac-card-chevron"
                    style={{ color: "var(--fg-4)" }}
                />
            </div>
            <div
                className="tabular ac-card-balance"
                style={{
                    color: signedBalance < 0 ? "var(--expense)" : "var(--fg)",
                }}
            >
                {signedBalance < 0 ? "−" : ""}
                {fmt2(Math.abs(signedBalance))}
            </div>
            <div className="ac-card-foot">
                {account._spaces && account._spaces.length > 0 ? (
                    <span className="ac-card-spaces">
                        {account._spaces.slice(0, 3).map((s) => (
                            <span key={s.spaceId} className="ac-space-chip">
                                {s.name}
                            </span>
                        ))}
                        {account._otherSpacesCount > 0 && (
                            <span className="ac-space-chip">
                                +{account._otherSpacesCount}
                            </span>
                        )}
                    </span>
                ) : otherOwnersCount > 0 ? (
                    <span className="ac-card-shared">
                        Shared · {account.owners.length} members
                    </span>
                ) : (
                    <span className="ac-card-shared">Solo</span>
                )}
                {showPct && (
                    <span className="tabular ac-card-pct">
                        {pct < 1 ? "<1" : pct.toFixed(0)}% of holdings
                    </span>
                )}
            </div>
        </Link>
    );
}

function Avatar({
    icon,
    color,
    size = 32,
}: {
    icon: string;
    color: string;
    size?: number;
}) {
    return (
        <span
            style={{
                width: size,
                height: size,
                borderRadius: 9,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: `color-mix(in oklab, ${color} 18%, transparent)`,
                border: `1px solid color-mix(in oklab, ${color} 30%, transparent)`,
                color,
                flexShrink: 0,
            }}
        >
            <DesignIcon name={icon} size={size * 0.5} color={color} />
        </span>
    );
}

const ICON_PATHS: Record<string, string> = {
    home: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
    wallet:
        "M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1h2v8h-2v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm14 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
    pig: "M14 5h-3a6 6 0 0 0-6 6v1a6 6 0 0 0 6 6h6v3l3-2 1-4-2-1v-1a6 6 0 0 0-2-4M9 11h.01",
    bolt: "M13 2 3 14h7l-1 8 10-12h-7z",
    chart: "M3 21V3m18 18H3m4-4 4-6 4 4 6-8",
    book: "M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM4 17a3 3 0 0 1 3-3h11",
    lock: "M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z",
    cart: "M3 4h2l3 12h11l2-8H7M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    coffee:
        "M5 8h12v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zm12 1h2a2 2 0 1 1 0 4h-2zM7 4v2M11 4v2M15 4v2",
    car: "M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13m-14 0v5h2v-2h10v2h2v-5m-14 0h14",
    dot: "M12 12h.01",
};

function DesignIcon({
    name,
    size,
    color,
}: {
    name: string;
    size: number;
    color: string;
}) {
    const d = ICON_PATHS[name] ?? ICON_PATHS.wallet;
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d={d} />
        </svg>
    );
}

function Skeleton({ height = 16 }: { height?: number }) {
    return (
        <div
            style={{
                width: "100%",
                height,
                borderRadius: 12,
                background:
                    "linear-gradient(90deg, var(--bg-elev-1), var(--bg-elev-2), var(--bg-elev-1))",
                backgroundSize: "200% 100%",
                animation: "ov-shimmer 1.6s ease-in-out infinite",
            }}
        />
    );
}

const AC_STYLES = `
.ac-root {
    margin: -1.5rem -1rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
}
@media (min-width: 768px) {
    .ac-root { margin: -2rem; }
}

.ac-topbar {
    padding: 26px 32px 18px;
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    background: var(--bg);
    flex-wrap: wrap;
}
.ac-topbar-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ac-title {
    font-size: 26px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--fg);
    margin: 0;
}
.ac-sub { font-size: 13px; color: var(--fg-3); margin: 0; }
.ac-topbar-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.ac-scroll {
    flex: 1;
    padding: 22px 32px 36px;
    display: flex;
    flex-direction: column;
    gap: 22px;
}

/* ---- Summary card: ledger header (net worth hero · composition stats)
   over a full-width distribution bar ---- */
.orbit-design .od-card.ac-summary {
    padding: 22px 26px;
    display: flex;
    flex-direction: column;
    gap: 20px;
}
.ac-ledger {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px 28px;
    min-width: 0;
    position: relative;
    z-index: 1;
}
.ac-networth {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
}
.ac-networth-val {
    /* Clamp so billions-scale balances shrink instead of blowing the
       header open — tabular digits never wrap. */
    font-size: clamp(30px, 3.4vw, 40px);
    font-weight: 500;
    letter-spacing: -0.04em;
    line-height: 1.02;
    overflow-wrap: anywhere;
}
.ac-networth-sub { font-size: 11.5px; color: var(--fg-4); }

/* Composition stats, grouped and right-aligned beside the hero. Dividers
   are border-left on the tile (not floating spans) so a wrapped tile
   brings its divider along instead of orphaning a hairline. */
.ac-tstats {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: flex-end;
    gap: 14px 0;
    min-width: 0;
}
.ac-tstat {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 0 22px;
    text-align: right;
    align-items: flex-end;
    border-left: 1px solid var(--line-soft);
}
.ac-tstat:first-child { padding-left: 0; border-left: none; }
.ac-tstat:last-child { padding-right: 0; }
.ac-tstat-val {
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.02em;
    white-space: nowrap;
}
.ac-tstat-sub { font-size: 11px; color: var(--fg-4); white-space: nowrap; }

/* Full-width distribution bar band under the ledger header. */
.ac-sum-bar {
    min-width: 0;
    position: relative;
    z-index: 1;
    border-top: 1px solid var(--line-soft);
    padding-top: 20px;
}

.ac-dist { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ac-dist-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
}
.ac-dist-readout {
    font-size: 12px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}
.ac-dist-track {
    display: flex;
    gap: 2px;
    height: 26px;
    border-radius: 7px;
    overflow: hidden;
    background: var(--bg-elev-3);
}
.ac-dist-seg {
    min-width: 3px;
    flex-basis: 0;
    transition: opacity 140ms ease;
}
.ac-dist-chips { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.ac-dist-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0;
    border: none;
    background: none;
    font-family: inherit;
    font-size: 11.5px;
    color: var(--fg-3);
    cursor: pointer;
    transition: color 120ms ease;
    min-width: 0;
}
.ac-dist-chip:hover,
.ac-dist-chip[data-active] { color: var(--fg); }
.ac-dist-chip:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
    border-radius: 4px;
}
.ac-dist-chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 160px;
}
.ac-dist-chip-pct { color: var(--fg-4); font-size: 10.5px; }
.ac-dist-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
}
.ac-dist-empty { font-size: 12.5px; color: var(--fg-3); }

/* Summary responsive. Below the sidebar+tablet squeeze band the ledger
   wraps, and border-left dividers would dangle at wrapped line-starts —
   so swap them for a real column gap once we drop under desktop width. */
@media (max-width: 1024px) {
    .ac-tstats { gap: 14px 24px; }
    .ac-tstat {
        border-left: none;
        padding: 0;
    }
}
@media (max-width: 720px) {
    .ac-ledger {
        align-items: stretch;
        justify-content: flex-start;
    }
    .ac-tstats { justify-content: flex-start; }
    .ac-tstat { text-align: left; align-items: flex-start; }
}
@media (max-width: 620px) {
    .orbit-design .od-card.ac-summary { padding: 18px; gap: 16px; }
    .ac-tstats { gap: 12px 20px; width: 100%; }
}

/* ---- Owner group ---- */
.ac-group { display: flex; flex-direction: column; gap: 12px; }
.ac-group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 4px;
    gap: 12px;
}
.ac-group-name {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}
.ac-owner-bubble {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: white;
    font-size: 10.5px;
    font-weight: 600;
    flex-shrink: 0;
}
.ac-owner-avatar-img { flex-shrink: 0; }
.ac-owner-label {
    font-size: 11px;
    color: var(--fg-3);
    letter-spacing: 0.1em;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ac-owner-count {
    font-size: 11px;
    color: var(--fg-4);
    text-transform: lowercase;
    white-space: nowrap;
}
.ac-group-total {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
}

/* ---- Card grid ---- */
.ac-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px;
}

.orbit-design .od-card.ac-card {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    text-decoration: none;
    color: inherit;
    position: relative;
    overflow: hidden;
    transition: border-color 140ms ease, transform 140ms ease;
}
.orbit-design .od-card.ac-card:hover {
    border-color: var(--line-strong);
    transform: translateY(-1px);
}
.orbit-design .od-card.ac-card:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
}
.ac-card-glow { position: absolute; inset: 0; pointer-events: none; }
.ac-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    position: relative;
}
.ac-card-name {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}
.ac-card-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    line-height: 1.2;
    min-width: 0;
}
.ac-card-title {
    font-size: 13.5px;
    color: var(--fg);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ac-card-type {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}
.ac-card-type-icon { width: 11px; height: 11px; }
.ac-card-chevron { margin-top: 2px; flex-shrink: 0; }
.ac-card-balance {
    font-size: 24px;
    font-weight: 500;
    letter-spacing: -0.04em;
    line-height: 1;
    position: relative;
}
.ac-card-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    position: relative;
    min-height: 22px;
}
.ac-card-spaces {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
}
.ac-space-chip {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    font-size: 11px;
    color: var(--fg-3);
    background: transparent;
    border: 1px solid var(--line-soft);
    white-space: nowrap;
}
.ac-card-shared {
    font-size: 11px;
    color: var(--fg-4);
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.ac-card-pct { font-size: 11px; color: var(--fg-4); white-space: nowrap; }

/* ---- Empty ---- */
.orbit-design .od-card.ac-empty {
    padding: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
}

/* ---- Phone (<640px) ---- */
@media (max-width: 720px) {
    .ac-topbar { padding: 18px 18px 14px; }
    .ac-scroll { padding: 16px 18px 28px; gap: 16px; }
}
@media (max-width: 640px) {
    .ac-topbar { padding: 14px 14px 10px; }
    .ac-title { font-size: 22px; }
    .ac-scroll { padding: 12px 14px 22px; gap: 14px; }
    .orbit-design .od-card.ac-card { padding: 14px; }
    .ac-card-balance { font-size: 20px; }
    .orbit-design .od-card.ac-empty { padding: 24px; }
    .ac-grid { grid-template-columns: 1fr; }
}
`;
