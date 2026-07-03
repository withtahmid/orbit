import { useState } from "react";
import { NavLink, Link, Outlet, useNavigate } from "react-router-dom";
import { observer } from "mobx-react-lite";
import {
    LayoutDashboard,
    Wallet,
    ArrowLeftRight,
    Mail,
    FolderTree,
    CalendarDays,
    BarChart3,
    Settings,
    Menu,
    LogOut,
    User,
    BookOpen,
    LineChart,
    Sparkles,
    ChevronDown,
    ChevronsUpDown,
    Plus,
    Check,
    type LucideIcon,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OrbitLogo } from "@/components/orbit/OrbitLogo";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { CommandPalette } from "@/components/orbit/CommandPalette";
import { CreateSpaceDialog } from "@/features/spaces/CreateSpaceDialog";
import { trpc } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { useStore } from "@/stores/useStore";
import { ROUTES } from "@/router/routes";
import { PERSONAL_SPACE_ID, PERSONAL_SPACE_NAME } from "@/lib/personalSpace";

type NavItem = { label: string; icon: LucideIcon; path: string };

const FULL_NAV: NavItem[] = [
    { label: "Overview", icon: LayoutDashboard, path: "" },
    { label: "Accounts", icon: Wallet, path: "accounts" },
    { label: "Transactions", icon: ArrowLeftRight, path: "transactions" },
    { label: "Budgets", icon: Mail, path: "budgets" },
    { label: "Categories", icon: FolderTree, path: "categories" },
    { label: "Events", icon: CalendarDays, path: "events" },
    { label: "Analytics", icon: BarChart3, path: "analytics" },
    { label: "Settings", icon: Settings, path: "settings" },
];

// Virtual "My money" space: strip mutation-oriented tabs that are
// space-local concepts (budgets, categories, events, settings).
const PERSONAL_NAV: NavItem[] = FULL_NAV.filter((n) =>
    ["", "accounts", "transactions", "analytics"].includes(n.path)
);

export const SpaceLayout = observer(function SpaceLayout() {
    const { space } = useCurrentSpace();
    const basePath = ROUTES.space(space.id);
    const [mobileOpen, setMobileOpen] = useState(false);
    const nav = space.isPersonal ? PERSONAL_NAV : FULL_NAV;

    return (
        <div className="orbit-design sl-shell">
            <style>{SL_STYLES}</style>

            {/* Desktop sidebar — always visible at md+ */}
            <aside className="sl-aside">
                <Sidebar
                    basePath={basePath}
                    nav={nav}
                    spaceName={space.name}
                    isPersonal={space.isPersonal}
                    onNavigate={() => {}}
                />
            </aside>

            {/* Main content column */}
            <div className="sl-main-col">
                {/* Mobile-only header with menu trigger */}
                <header className="sl-mobile-header">
                    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                        <SheetTrigger asChild>
                            <button
                                type="button"
                                className="sl-mobile-menu"
                                aria-label="Open navigation"
                            >
                                <Menu className="size-4" />
                            </button>
                        </SheetTrigger>
                        <SheetContent
                            side="left"
                            className="orbit-design w-[260px] border-0 p-0"
                            style={{ background: "var(--sidebar)" }}
                        >
                            <SheetHeader className="sr-only">
                                <SheetTitle>Navigation</SheetTitle>
                            </SheetHeader>
                            <Sidebar
                                basePath={basePath}
                                nav={nav}
                                spaceName={space.name}
                                isPersonal={space.isPersonal}
                                onNavigate={() => setMobileOpen(false)}
                            />
                        </SheetContent>
                    </Sheet>
                    <span className="sl-mobile-name">{space.name}</span>
                </header>

                <main className="sl-main">
                    <Outlet />
                </main>
            </div>

            {/* Global ⌘K command palette — listens for the keyboard shortcut
                anywhere on the page and renders an overlay when open. */}
            <CommandPalette />
        </div>
    );
});

function Sidebar({
    basePath,
    nav,
    spaceName,
    isPersonal,
    onNavigate,
}: {
    basePath: string;
    nav: NavItem[];
    spaceName: string;
    isPersonal: boolean;
    onNavigate: () => void;
}) {
    return (
        <div className="sl-sidebar">
            {/* Logo block */}
            <div className="sl-logo">
                <Link to={ROUTES.root} style={{ textDecoration: "none" }}>
                    <OrbitLogo size={22} />
                </Link>
            </div>

            {/* Space switcher — top-of-sidebar so scope is the first thing seen */}
            <SpaceSwitcherButton
                spaceName={spaceName}
                isPersonal={isPersonal}
                onNavigate={onNavigate}
            />

            {/* Main nav */}
            <nav className="sl-nav">
                {nav.map((item) => {
                    const to = item.path ? `${basePath}/${item.path}` : basePath;
                    return (
                        <NavLink
                            key={item.label}
                            to={to}
                            end={item.path === ""}
                            onClick={onNavigate}
                            className={({ isActive }) =>
                                `sl-nav-item ${isActive ? "is-active" : ""}`
                            }
                        >
                            {({ isActive }) => (
                                <>
                                    {isActive && <span className="sl-nav-bar" />}
                                    <item.icon
                                        className="sl-nav-icon"
                                        style={{
                                            color: isActive
                                                ? "var(--brand)"
                                                : "var(--fg-3)",
                                        }}
                                    />
                                    {item.label}
                                </>
                            )}
                        </NavLink>
                    );
                })}
            </nav>

            {/* Global app-level links — these live OUTSIDE any space scope,
                hence above user chip. */}
            <div className="sl-global">
                <GlobalLink to={ROUTES.docs} icon={BookOpen} label="Docs" />
            </div>

            {/* User */}
            <UserChip onNavigate={onNavigate} />
        </div>
    );
}

function GlobalLink({
    to,
    icon: Icon,
    label,
    badge,
}: {
    to: string;
    icon: LucideIcon;
    label: string;
    badge?: boolean;
}) {
    return (
        <Link to={to} className="sl-global-link">
            <Icon className="size-3.5" />
            {label}
            {badge && <span className="sl-global-badge" />}
        </Link>
    );
}

function SpaceSwitcherButton({
    spaceName,
    isPersonal,
    onNavigate,
}: {
    spaceName: string;
    isPersonal: boolean;
    onNavigate: () => void;
}) {
    const { space } = useCurrentSpace();
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    const spacesQuery = trpc.space.list.useQuery();
    const initial = spaceName[0]?.toUpperCase() ?? "S";

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button type="button" className="sl-switcher">
                    <span className="sl-switcher-left">
                        {isPersonal ? (
                            <span
                                className="sl-switcher-avatar"
                                style={{
                                    background:
                                        "color-mix(in oklab, var(--gold) 22%, transparent)",
                                    border: "1px solid color-mix(in oklab, var(--gold) 35%, transparent)",
                                    color: "var(--gold)",
                                }}
                            >
                                <Sparkles className="size-3.5" />
                            </span>
                        ) : (
                            <span
                                className="sl-switcher-avatar"
                                style={{
                                    background:
                                        "color-mix(in oklab, var(--ent-1) 22%, transparent)",
                                    border: "1px solid color-mix(in oklab, var(--ent-1) 30%, transparent)",
                                    color: "var(--fg)",
                                    fontWeight: 600,
                                    fontSize: 12,
                                }}
                            >
                                {initial}
                            </span>
                        )}
                        <span className="sl-switcher-text">
                            <span className="sl-switcher-name">{spaceName}</span>
                            <span className="sl-switcher-label">
                                {isPersonal ? "personal" : "shared"}
                            </span>
                        </span>
                    </span>
                    <ChevronsUpDown className="size-3.5" style={{ color: "var(--fg-3)" }} />
                </button>
            </PopoverTrigger>
            <PopoverContent className="orbit-design w-64 p-0" align="start">
                <Command>
                    <CommandInput placeholder="Search spaces…" />
                    <CommandList>
                        <CommandEmpty>No spaces found.</CommandEmpty>
                        <CommandGroup heading="Personal">
                            <CommandItem
                                key={PERSONAL_SPACE_ID}
                                value={PERSONAL_SPACE_NAME}
                                onSelect={() => {
                                    navigate(ROUTES.space(PERSONAL_SPACE_ID));
                                    setOpen(false);
                                    onNavigate();
                                }}
                            >
                                <LineChart className="mr-2 size-3.5 opacity-80" />
                                <span className="truncate font-medium">
                                    {PERSONAL_SPACE_NAME}
                                </span>
                                <Check
                                    className={`ml-auto size-4 ${space.id === PERSONAL_SPACE_ID ? "opacity-100" : "opacity-0"}`}
                                />
                            </CommandItem>
                        </CommandGroup>
                        <CommandSeparator />
                        <CommandGroup heading="Your spaces">
                            {(spacesQuery.data ?? []).map((s) => (
                                <CommandItem
                                    key={s.id}
                                    value={s.name}
                                    onSelect={() => {
                                        navigate(ROUTES.space(s.id));
                                        setOpen(false);
                                        onNavigate();
                                    }}
                                >
                                    <Sparkles className="mr-2 size-3.5 opacity-60" />
                                    <span className="truncate">{s.name}</span>
                                    <Check
                                        className={`ml-auto size-4 ${s.id === space.id ? "opacity-100" : "opacity-0"}`}
                                    />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                        <CommandSeparator />
                        <CommandGroup>
                            <CreateSpaceDialog
                                trigger={
                                    <CommandItem onSelect={() => {}}>
                                        <Plus className="mr-2 size-3.5" />
                                        Create new space
                                    </CommandItem>
                                }
                            />
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function UserChip({ onNavigate }: { onNavigate: () => void }) {
    const { authStore } = useStore();
    const navigate = useNavigate();
    const user = authStore.user;
    // Split the single display-name field into first/last for UserAvatar's
    // initials fallback — same convention used by AppShellLayout.
    const [firstName, ...rest] = (user?.name ?? "").split(" ");
    const lastName = rest.join(" ");

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button type="button" className="sl-user">
                    <UserAvatar
                        fileId={user?.avatarFileId}
                        firstName={firstName}
                        lastName={lastName}
                        size="sm"
                        className="sl-user-avatar-img"
                    />
                    <span className="sl-user-text">
                        <span className="sl-user-name">{user?.name ?? "Guest"}</span>
                        <span className="sl-user-email">{user?.email ?? ""}</span>
                    </span>
                    <ChevronDown className="size-3.5" style={{ color: "var(--fg-4)" }} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem
                    onSelect={() => {
                        navigate(ROUTES.profile);
                        onNavigate();
                    }}
                >
                    <User className="size-4" />
                    Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={() => {
                        navigate(ROUTES.security);
                        onNavigate();
                    }}
                >
                    <Settings className="size-4" />
                    Security
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={() => {
                        navigate(ROUTES.space("me"));
                        onNavigate();
                    }}
                >
                    <LineChart className="size-4" />
                    My money
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={() => {
                        navigate(ROUTES.myAccounts);
                        onNavigate();
                    }}
                >
                    <Wallet className="size-4" />
                    My accounts
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={() => {
                        navigate(ROUTES.spaces);
                        onNavigate();
                    }}
                >
                    <ArrowLeftRight className="size-4" />
                    Switch space
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={() => {
                        navigate(ROUTES.docs);
                        onNavigate();
                    }}
                >
                    <BookOpen className="size-4" />
                    Help & docs
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                        authStore.clearAuth();
                        navigate(ROUTES.login, { replace: true });
                    }}
                >
                    <LogOut className="size-4" />
                    Log out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

const SL_STYLES = `
:root {
    /* Rendered height of .sl-mobile-header below (10+10 padding + 32px
       menu button + 1px border). Pages that stick content beneath it
       (e.g. the transactions day headers) consume this var — keep it in
       sync with any change to that header's padding/content. */
    --sl-mobile-header-h: 53px;
}
.sl-shell {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
}

/* Desktop sidebar — fixed 232px column, anchored full height. */
.sl-aside {
    width: 232px;
    flex-shrink: 0;
    background: var(--sidebar);
    border-right: 1px solid var(--line);
    position: sticky;
    top: 0;
    height: 100vh;
    overflow: hidden;
    display: none;
}
@media (min-width: 768px) {
    .sl-aside { display: flex; }
}

.sl-main-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

.sl-mobile-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--line-soft);
    background: var(--bg);
    position: sticky;
    top: 0;
    z-index: 5;
    backdrop-filter: saturate(150%) blur(8px);
}
@media (min-width: 768px) {
    .sl-mobile-header { display: none; }
}
.sl-mobile-menu {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: transparent;
    border: 1px solid var(--line);
    color: var(--fg);
    cursor: pointer;
    transition: background 140ms ease, border-color 140ms ease;
}
.sl-mobile-menu:hover { background: var(--bg-elev-2); border-color: var(--line-strong); }
.sl-mobile-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    /* Single line, always: a long space name wrapping to two lines would
       grow the header past --sl-mobile-header-h (53px), and sticky
       content offset by that var (transactions day headers) would clip
       behind it. Ellipsis instead of wrap. */
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.sl-main {
    flex: 1;
    min-width: 0;
    /* Default outer padding for legacy (shadcn) pages. The redesigned
       OverviewPage cancels this with a negative margin so its topbar can
       be edge-to-edge. */
    padding: 1.5rem 1rem;
}
@media (min-width: 768px) {
    .sl-main { padding: 2rem; }
}

/* Sidebar internal — used by both desktop aside and mobile sheet */
.sl-sidebar {
    width: 100%;
    height: 100%;
    background: var(--sidebar);
    display: flex;
    flex-direction: column;
}

.sl-logo {
    padding: 16px 16px 14px;
    border-bottom: 1px solid var(--line-soft);
}

/* Space switcher button */
.sl-switcher {
    margin: 12px 12px 4px;
    height: 46px;
    padding: 0 12px;
    border-radius: 10px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    cursor: pointer;
    font-family: inherit;
    transition: background 140ms ease, border-color 140ms ease;
}
.sl-switcher:hover {
    background: var(--bg-elev-2);
    border-color: var(--line-strong);
}
.sl-switcher-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}
.sl-switcher-avatar {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
}
.sl-switcher-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.1;
    min-width: 0;
}
.sl-switcher-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 140px;
}
.sl-switcher-label {
    font-size: 10.5px;
    color: var(--fg-4);
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

/* Main nav */
.sl-nav {
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    overflow-y: auto;
}
.sl-nav-item {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 8px 12px;
    border-radius: 8px;
    background: transparent;
    color: var(--fg-3);
    font-size: 13px;
    font-weight: 400;
    text-decoration: none;
    position: relative;
    transition: background 140ms ease, color 140ms ease;
}
.sl-nav-item:hover {
    background: var(--bg-elev-1);
    color: var(--fg-2);
}
.sl-nav-item.is-active {
    background: var(--bg-elev-2);
    color: var(--fg);
    font-weight: 500;
}
.sl-nav-bar {
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 2px;
    background: var(--brand);
    border-radius: 2px;
}
.sl-nav-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
}

/* Global links (Docs / Help / What's new) — pinned above user chip */
.sl-global {
    padding: 8px 8px 6px;
    border-top: 1px solid var(--line-soft);
}
.sl-global-link {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 7px 12px;
    border-radius: 8px;
    color: var(--fg-3);
    font-size: 12.5px;
    font-weight: 400;
    text-decoration: none;
    position: relative;
    transition: background 140ms ease, color 140ms ease;
}
.sl-global-link:hover { background: var(--bg-elev-1); color: var(--fg-2); }
.sl-global-badge {
    margin-left: auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-soft);
}

/* User chip */
.sl-user {
    margin: 0;
    padding: 12px;
    border: 0;
    border-top: 1px solid var(--line-soft);
    background: transparent;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    cursor: pointer;
    font-family: inherit;
    color: var(--fg);
    transition: background 140ms ease;
    text-align: left;
}
.sl-user:hover { background: var(--bg-elev-1); }
.sl-user-avatar-img { flex-shrink: 0; }
.sl-user-text {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
    flex: 1;
    min-width: 0;
}
.sl-user-name {
    font-size: 12.5px;
    color: var(--fg);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sl-user-email {
    font-size: 10.5px;
    color: var(--fg-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
`;
