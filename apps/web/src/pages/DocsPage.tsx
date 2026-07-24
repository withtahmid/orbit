import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
    ArrowRight,
    BookOpen,
    Wallet,
    Mail,
    Target,
    FolderTree,
    ArrowLeftRight,
    CalendarDays,
    BarChart3,
    Users,
    Shield,
    Clock,
    Sparkles,
    HelpCircle,
    ChevronRight,
    Paperclip,
    UserCircle,
    LineChart,
    Eye,
} from "lucide-react";
import { DEMO_URL } from "@/config/isDemo";
import { ROUTES } from "@/router/routes";
import { useStore } from "@/stores/useStore";
import { observer } from "mobx-react-lite";
import { OrbitLogo } from "@/components/orbit/OrbitLogo";

/**
 * Public product documentation. Accessible without login so prospective
 * users can read about Orbit before signing up. Uses the editorial-dark
 * `orbit-design` system (Newsreader serif titles, jewel-toned surfaces,
 * od-card / od-btn primitives) so /docs visually matches the landing
 * page and signed-in app instead of feeling like a separate microsite.
 */

interface Section {
    id: string;
    title: string;
    icon: React.ComponentType<{ className?: string }>;
}

const SECTIONS: Section[] = [
    { id: "live-demo", title: "Live demo (read-only)", icon: Eye },
    { id: "overview", title: "What is Orbit?", icon: Sparkles },
    { id: "concepts", title: "Core concepts", icon: BookOpen },
    { id: "getting-started", title: "Getting started", icon: ArrowRight },
    { id: "spaces", title: "Spaces & collaboration", icon: Users },
    { id: "accounts", title: "Accounts", icon: Wallet },
    { id: "envelopes", title: "Envelopes", icon: Mail },
    { id: "categories", title: "Categories", icon: FolderTree },
    { id: "transactions", title: "Transactions", icon: ArrowLeftRight },
    { id: "events", title: "Events", icon: CalendarDays },
    { id: "attachments", title: "Attachments & receipts", icon: Paperclip },
    { id: "allocations", title: "Allocations", icon: Sparkles },
    { id: "drift", title: "Overspend", icon: Shield },
    { id: "analytics", title: "Analytics", icon: BarChart3 },
    { id: "my-money", title: "Your money across spaces", icon: LineChart },
    { id: "permissions", title: "Roles & permissions", icon: Shield },
    { id: "profile", title: "Your profile", icon: UserCircle },
    { id: "timezone", title: "Time & timezone", icon: Clock },
    { id: "faq", title: "FAQ", icon: HelpCircle },
];

const DocsPage = observer(function DocsPage() {
    const { authStore } = useStore();
    const [active, setActive] = useState<string>(SECTIONS[0].id);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible[0]) setActive(visible[0].target.id);
            },
            { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
        );
        for (const s of SECTIONS) {
            const el = document.getElementById(s.id);
            if (el) observer.observe(el);
        }
        return () => observer.disconnect();
    }, []);

    const isAuthed = authStore.isAuthenticated;

    return (
        <div className="orbit-design orbit-docs">
            <style>{DOCS_STYLES}</style>

            <TopBar isAuthed={isAuthed} />

            <div className="od-page">
                <Hero isAuthed={isAuthed} />

                <div className="od-grid">
                    {/* Sticky TOC — sidebar on lg+, inline summary on mobile */}
                    <aside className="od-toc-wrap">
                        <nav className="od-toc">
                            <span className="eyebrow od-toc-eyebrow">On this page</span>
                            {SECTIONS.map((s) => (
                                <a
                                    key={s.id}
                                    href={`#${s.id}`}
                                    className={
                                        "od-toc-link" + (active === s.id ? " is-active" : "")
                                    }
                                >
                                    <s.icon className="size-3.5 shrink-0" />
                                    <span className="truncate">{s.title}</span>
                                </a>
                            ))}
                        </nav>
                    </aside>

                    <main className="od-main">
                        <MobileToc />

                        <div className="od-sections">
                            <LiveDemo />
                            <Overview />
                            <Concepts />
                            <GettingStarted />
                            <Spaces />
                            <Accounts />
                            <Envelopes />
                            <Categories />
                            <Transactions />
                            <Events />
                            <Attachments />
                            <Allocations />
                            <Drift />
                            <Analytics />
                            <MyMoney />
                            <Permissions />
                            <Profile />
                            <Timezone />
                            <Faq />
                        </div>

                        <ClosingCta isAuthed={isAuthed} />
                    </main>
                </div>
            </div>
        </div>
    );
});

export default DocsPage;

/* ---------------------------------------------------------------- */
/*  Layout bits                                                     */
/* ---------------------------------------------------------------- */

function TopBar({ isAuthed }: { isAuthed: boolean }) {
    return (
        <header className="od-topbar">
            <Link to={ROUTES.root} className="od-topbar-logo">
                <OrbitLogo size={22} />
            </Link>
            <nav className="od-topbar-nav">
                <Link to={ROUTES.docs} className="od-topbar-link is-active">
                    Docs
                </Link>
                {isAuthed ? (
                    <Link to={ROUTES.root} className="od-btn od-btn-primary od-btn-sm">
                        Open app
                        <ArrowRight className="size-3.5" />
                    </Link>
                ) : (
                    <>
                        <Link to={ROUTES.login} className="od-btn od-btn-ghost od-btn-sm">
                            Log in
                        </Link>
                        <Link to={ROUTES.signup} className="od-btn od-btn-primary od-btn-sm">
                            Sign up
                            <ArrowRight className="size-3.5" />
                        </Link>
                    </>
                )}
            </nav>
        </header>
    );
}

function Hero({ isAuthed }: { isAuthed: boolean }) {
    return (
        <section className="od-hero">
            <span className="od-hero-eyebrow">
                <Sparkles className="size-3" />
                Product guide
            </span>
            <h1 className="serif od-hero-title">
                Everything you need <br className="hidden sm:block" />
                to know about{" "}
                <em
                    style={{
                        color: "var(--gold)",
                        fontStyle: "italic",
                    }}
                >
                    Orbit
                </em>
                .
            </h1>
            <p className="od-hero-lede">
                Orbit is a collaborative personal-finance app for small groups — families, couples,
                roommates, shared projects. It combines <strong>ledger accounting</strong>,{" "}
                <strong>envelope budgeting</strong>, and <strong>goal-based planning</strong> into a
                single coherent ledger. This guide walks through every feature so you can hit the
                ground running.
            </p>
            <div className="od-hero-cta">
                {isAuthed ? (
                    <Link to={ROUTES.root} className="od-btn od-btn-primary od-btn-lg">
                        Open my spaces
                        <ArrowRight className="size-4" />
                    </Link>
                ) : (
                    <>
                        <Link to={ROUTES.signup} className="od-btn od-btn-primary od-btn-lg">
                            Create an account
                            <ArrowRight className="size-4" />
                        </Link>
                        <Link to={ROUTES.login} className="od-btn od-btn-lg">
                            I already have one
                        </Link>
                    </>
                )}
            </div>
        </section>
    );
}

function MobileToc() {
    return (
        <details className="od-mobile-toc">
            <summary>
                <BookOpen className="size-3.5" />
                <span>Jump to a section</span>
                <ChevronRight className="size-3.5 ml-auto" />
            </summary>
            <div className="od-mobile-toc-grid">
                {SECTIONS.map((s) => (
                    <a key={s.id} href={`#${s.id}`} className="od-mobile-toc-link">
                        <s.icon className="size-3.5 shrink-0" />
                        {s.title}
                    </a>
                ))}
            </div>
        </details>
    );
}

/* ---------------------------------------------------------------- */
/*  Sections                                                        */
/* ---------------------------------------------------------------- */

function SectionHeader({
    id,
    title,
    kicker,
    icon: Icon,
}: {
    id: string;
    title: string;
    kicker?: string;
    icon: React.ComponentType<{ className?: string }>;
}) {
    return (
        <div className="od-section-head">
            {kicker && <span className="eyebrow od-section-kicker">{kicker}</span>}
            <h2 id={id} className="serif od-section-title">
                <span className="od-section-icon" aria-hidden>
                    <Icon className="size-4" />
                </span>
                {title}
            </h2>
        </div>
    );
}

function Paragraph({ children }: { children: ReactNode }) {
    return <p className="od-prose">{children}</p>;
}

function Overview() {
    return (
        <section className="od-section">
            <SectionHeader id="overview" title="What is Orbit?" icon={Sparkles} />
            <Paragraph>
                Orbit tracks where your money <i>is</i> (accounts), what it&apos;s{" "}
                <i>earmarked for</i> (envelopes &amp; goals), and where it <i>went</i>{" "}
                (transactions). You and everyone you collaborate with see the same up-to-the-second
                view of the household finances — no spreadsheets to merge, no &quot;did you pay the
                internet bill?&quot; in the group chat.
            </Paragraph>
            <ScreenshotPlaceholder
                src="/docs/overview.png"
                label="Overview dashboard — net worth, balance trend, allocation donuts, cash flow, spending heatmap, goals"
            />
            <FeatureGrid
                items={[
                    {
                        icon: Wallet,
                        title: "Ledger accounting",
                        body: "Accounts hold real money. Every transaction moves money between accounts or in/out of the household.",
                    },
                    {
                        icon: Mail,
                        title: "Envelope budgeting",
                        body: "Named buckets (Groceries, Rent, Fuel…) hold a logical allocation of your money. Each expense lands in the envelope you pick on entry — pin your usual one for one-tap defaults.",
                    },
                    {
                        icon: Target,
                        title: "Goal envelopes",
                        body: "Rolling envelopes with a target amount + date — house down-payment, vacation, new laptop. Same envelope ledger as a monthly bucket, just with a long-horizon goal attached.",
                    },
                ]}
            />
        </section>
    );
}

function LiveDemo() {
    return (
        <section className="od-section">
            <SectionHeader
                id="live-demo"
                title="Live demo (read-only)"
                kicker="Try before you sign up"
                icon={Eye}
            />
            <Paragraph>
                A fully seeded sandbox runs at{" "}
                <a href={DEMO_URL} className="od-link">
                    orbit-demo.withtahmid.com
                </a>
                . Every screen renders real data — 16 accounts, 30+ envelopes (including a handful
                of goal envelopes), 18 months of transactions, and five collaborating spaces (Family
                Budget, Personal, Roommates, Side Business, Travel Fund) — so you can explore the
                product end-to-end without creating anything of your own.
            </Paragraph>
            <Paragraph>
                The demo is <strong>read-only</strong>: log in, click around, open every screen and
                form — nothing you do gets saved. That&apos;s by design, so the sandbox stays the
                same for every visitor.
            </Paragraph>

            <div className="od-card od-demo-card">
                <div className="od-demo-card-head">
                    <Shield className="size-4" style={{ color: "var(--brand)" }} />
                    <span>Sign-in credentials</span>
                </div>
                <dl className="od-demo-creds">
                    <dt>email</dt>
                    <dd className="mono">alex@orbit.dev</dd>
                    <dt>password</dt>
                    <dd className="mono">password123</dd>
                </dl>
                <p className="od-prose-sm">
                    Alex is the primary demo user and owns all five spaces. To see the app from a
                    collaborator&apos;s perspective, log out and sign in as{" "}
                    <span className="mono od-tag">sam@orbit.dev</span>,{" "}
                    <span className="mono od-tag">jordan@orbit.dev</span>, or{" "}
                    <span className="mono od-tag">taylor@orbit.dev</span> — same password.
                </p>
            </div>

            <div>
                <a href={DEMO_URL} className="od-btn od-btn-primary">
                    Open the demo
                    <ArrowRight className="size-3.5" />
                </a>
            </div>
        </section>
    );
}

function Concepts() {
    return (
        <section className="od-section">
            <SectionHeader
                id="concepts"
                title="Core concepts, at a glance"
                kicker="The mental model"
                icon={BookOpen}
            />
            <Paragraph>
                Orbit&apos;s design priority is <strong>correctness → clarity → performance</strong>
                . Almost every number you see is computed on-read, so edits to a transaction or an
                allocation propagate instantly — no manual reconciliation.
            </Paragraph>
            <div className="od-grid-2">
                <ConceptCard
                    title="Account"
                    body="A place real money lives: bank account, wallet, credit card, locked deposit."
                />
                <ConceptCard
                    title="Space"
                    body="The collaboration boundary. Every space has its own envelopes, categories, events, and members."
                />
                <ConceptCard
                    title="Envelope"
                    body="A named bucket within a space. Monthly envelopes reset on the 1st; rolling envelopes accumulate. Attach a target amount + date and a rolling envelope becomes a goal."
                />
                <ConceptCard
                    title="Category"
                    body="A nestable label on an expense — what the money was for. Fully independent from envelopes: the envelope is picked per transaction (pin one for quick entry)."
                />
                <ConceptCard
                    title="Allocation"
                    body="A signed amount that says 'envelope E has X earmarked this period'. Allocations live on the envelope — they don't pin to a specific account."
                />
                <ConceptCard
                    title="Transaction"
                    body="An income, expense, transfer, or adjustment. Moves real money between accounts."
                />
                <ConceptCard
                    title="Event"
                    body="A named grouping (wedding, trip) that you can attach transactions to for after-the-fact analysis."
                />
            </div>
        </section>
    );
}

function GettingStarted() {
    return (
        <section className="od-section">
            <SectionHeader id="getting-started" title="Getting started" icon={ArrowRight} />
            <ol className="od-steps">
                <StepCard
                    step={1}
                    title="Create an account"
                    body="Head to Sign up, enter your email, and verify it with the 6-digit code we'll send. Pick a password and you're in."
                />
                <StepCard
                    step={2}
                    title="Create your first space"
                    body="A space is where you and your collaborators share finances. Name it (e.g. 'Family Budget') and you'll be the owner."
                />
                <StepCard
                    step={3}
                    title="Add your accounts"
                    body="Wallet, checking, savings, credit card, fixed deposits — add them all. Mark each as asset, liability, or locked."
                />
                <StepCard
                    step={4}
                    title="Create envelopes & categories"
                    body="Pick a cadence (monthly or none) for each envelope. Create expense categories — nestable labels for what money gets spent on."
                />
                <StepCard
                    step={5}
                    title="Record a transaction"
                    body="Log an expense, income, or transfer. Watch balances update and the envelope usage bar fill in live."
                />
                <StepCard
                    step={6}
                    title="Invite collaborators"
                    body="From space settings, invite by email and assign owner, editor, or viewer role."
                />
            </ol>
            <ScreenshotPlaceholder
                src="/docs/signup.png"
                label="Signup flow + first space creation"
            />
        </section>
    );
}

function Spaces() {
    return (
        <section className="od-section">
            <SectionHeader id="spaces" title="Spaces & collaboration" icon={Users} />
            <Paragraph>
                A <strong>space</strong> is a coherent ledger: transactions, envelopes, categories,
                and events all belong to exactly one space. Accounts are different — an account can
                be shared into many spaces (more on this below).
            </Paragraph>
            <Paragraph>
                Each space has members with roles. Owners have full control, editors can record
                transactions and allocate money but can&apos;t change membership, viewers are
                read-only. You can be in as many spaces as you like — use the space picker in the
                header to jump between them.
            </Paragraph>
            <CalloutCard title="Invite by email">
                From <strong>Settings → Members</strong>, an owner or editor enters an email
                address, picks a role, and sends an invite. The recipient gets a link that resolves
                at <span className="mono od-tag">/invite/&lt;token&gt;</span> — they can accept with
                any Orbit account, not just one matching the invited address. Invites expire in 72
                hours; pending ones show up in the same settings tab where any owner/editor can
                revoke them.
            </CalloutCard>
            <CalloutCard title="Leaving a space">
                Any member can self-remove via <strong>Settings → Danger → Leave space</strong>. The
                space and its data stay intact for the remaining members. The one refusal: if
                you&apos;re the sole owner, you have to either transfer ownership to another member
                or delete the space first.
            </CalloutCard>
            <ScreenshotPlaceholder
                src="/docs/space-settings.png"
                label="Space settings — members table, invite by email, pending invites"
            />
        </section>
    );
}

function Accounts() {
    return (
        <section className="od-section">
            <SectionHeader id="accounts" title="Accounts" icon={Wallet} />
            <Paragraph>
                Three types: <strong>asset</strong> (bank, wallet — money you have),{" "}
                <strong>liability</strong> (credit card, loan — money you owe),{" "}
                <strong>locked</strong> (FDs, DPS — money you can&apos;t spend right now but still
                counts toward net worth). Each account has a color, icon, and balance that&apos;s
                maintained automatically by your transactions.
            </Paragraph>
            <CalloutCard title="Cross-space account sharing">
                Got a joint account used by two households? Share it across both spaces. Each space
                sees the same live balance, but transactions and allocations remain per-space. Go to
                the account&apos;s detail page → <strong>Shared with</strong> tab to manage.
            </CalloutCard>
            <CalloutCard title="Account members — an ACL of its own">
                Separate from space membership, each account has its own member list (
                <strong>owner</strong> / <strong>viewer</strong>). Owners can edit the account,
                share it into other spaces, or delete it; viewers can only see it. Manage from the
                account detail → <strong>Members</strong> tab. This is what makes &quot;my personal
                wallet shared into the household space, visible to my partner as a viewer&quot;
                possible.
            </CalloutCard>
            <ScreenshotPlaceholder
                src="/docs/account-detail.png"
                label="Account detail tabs: Allocations · Transactions · Shared with · Members · Settings"
            />
            <Paragraph>
                Each space&apos;s <strong>Accounts</strong> page opens with a ledger header — net
                worth as the hero number, with assets / locked / liabilities totals beside it — over
                a full-width distribution bar showing where your holdings sit; click a segment to
                jump into that account. The top-level{" "}
                <Link to={ROUTES.myAccounts} className="od-link">
                    My Accounts
                </Link>{" "}
                page lists every account you can access across every space you&apos;re in, grouped
                by type, each showing your role and chips linking straight into each space&apos;s
                detail view.
            </Paragraph>
        </section>
    );
}

function Envelopes() {
    return (
        <section className="od-section">
            <SectionHeader id="envelopes" title="Envelopes" icon={Mail} />
            <Paragraph>
                Envelopes are named budget buckets. Pick a cadence — <strong>monthly</strong> resets
                on the 1st of each month, <strong>none</strong> stays open-ended. Allocate money
                into them from your space&apos;s unallocated pool; every expense you record spends
                from the envelope you pick on it, and that envelope&apos;s remaining balance drops.
            </Paragraph>
            <CalloutCard title="Goal envelopes">
                Attach a <strong>target amount</strong> and (optionally) a{" "}
                <strong>target date</strong> to a rolling (cadence: none) envelope, and Orbit treats
                it as a goal. Same envelope ledger — your contributions accrue, your spending draws
                down — plus a goal progress bar on the card, a deadline pill, and a Goals card on
                the Overview. Progress is measured against cumulative positive contributions, so
                completing a goal stays complete even after you spend the money you saved. To create
                one, open the Budgets page, hit <strong>New envelope</strong>, leave cadence on{" "}
                <em>Rolling</em>, and fill in the target fields that appear.
            </CalloutCard>
            <CalloutCard title="Monthly vs rolling">
                <strong>Monthly</strong> envelopes reset their allocation each period — a fresh
                budget every month. <strong>Rolling</strong> (cadence: none) envelopes are a
                lifetime pool: contributions and spending accrue across periods, which is what makes
                goal envelopes work.
            </CalloutCard>
            <Paragraph>
                Categories (not envelopes) carry a <strong>priority tier</strong> — <i>Essential</i>
                , <i>Important</i>, <i>Discretionary</i>, or <i>Luxury</i>. Children without a tier
                inherit from the nearest ancestor, so you typically tag once at the top-level
                category and only override leaves where a sub-category genuinely differs. The
                Analytics → By priority donut rolls this up into a single &quot;what fraction of
                this month was must-spend vs want-spend?&quot; view.
            </Paragraph>
            <div className="od-grid-2">
                <InfoCard
                    title="Essential"
                    body="Non-negotiables: rent, utilities, groceries, commute, debt payments. Can't cut without life disruption."
                />
                <InfoCard
                    title="Important"
                    body="Real needs with some flexibility: health, household supplies, charity, bank fees. You'd adjust these before cutting essentials."
                />
                <InfoCard
                    title="Discretionary"
                    body="Quality-of-life spend: eating out, subscriptions, clothing, gifts, education. First lever when you need to save."
                />
                <InfoCard
                    title="Luxury"
                    body="True indulgences and big one-off upgrades: premium electronics, non-essential furniture, expensive leisure."
                />
            </div>
            <ScreenshotPlaceholder
                src="/docs/budgets.png"
                label="Budgets page — envelope gauges with cadence badges, goal progress, and month summary"
            />
        </section>
    );
}

function Categories() {
    return (
        <section className="od-section">
            <SectionHeader id="categories" title="Categories" icon={FolderTree} />
            <Paragraph>
                Categories are hierarchical labels for expenses, fully independent from envelopes. A
                category describes <i>what</i> you spent on; the envelope — picked per transaction
                (pin your usual one for quick entry) — describes <i>which budget</i> it came out of.
                The two are recorded independently on every transaction.
            </Paragraph>
            <Paragraph>
                The Categories page is a two-pane workbench: a searchable tree on the left, an
                inspector on the right. Rename a category, restyle its color and icon, set its
                priority tier, or move it under a different parent — by drag-and-drop or from the
                inspector. All of it is non-destructive: existing transactions keep both the
                category and the envelope they were saved with, so reorganizing your tree never
                rewrites historical analytics. Deleting is reserved for never-used leaf categories —
                anything with history gets renamed or re-nested instead.
            </Paragraph>
            <ScreenshotPlaceholder
                src="/docs/categories.png"
                label="Categories workbench — searchable tree with drag-and-drop re-parenting and inspector panel"
            />
        </section>
    );
}

function Transactions() {
    return (
        <section className="od-section">
            <SectionHeader id="transactions" title="Transactions" icon={ArrowLeftRight} />
            <Paragraph>Four types — each with its own rules:</Paragraph>
            <div className="od-grid-2">
                <TxTypeCard
                    type="Income"
                    body="Money entering a destination account from outside the system. Salary, refunds, gifts."
                />
                <TxTypeCard
                    type="Expense"
                    body="Money leaving a source account to outside the system. You pick both a category (what it was for) and an envelope (which budget it spends from) — the two are independent, and both are frozen on the transaction."
                />
                <TxTypeCard
                    type="Transfer"
                    body="Money moving between two of your accounts. Net zero to the household, but moves balance between accounts."
                />
                <TxTypeCard
                    type="Adjustment"
                    body="Reconcile a balance discrepancy. Enter the correct new balance and Orbit computes + records the delta, tagged with a reason (bank correction, missed transaction, rounding/FX)."
                />
            </div>
            <Paragraph>
                Click any row to open its full detail sheet. If you recorded the transaction, a
                pencil lets you edit everything — amount, date, accounts, category, envelope, event
                — and delete it; balances and envelope numbers recompute automatically. The one
                exception: a transfer&apos;s fee row is locked on its own — edit the parent transfer
                to change the fee.
            </Paragraph>
            <div className="od-grid-2">
                <InfoCard
                    title="From vs To"
                    body="The 'from' (source) account dropdown only lists accounts you personally own — you can only move your own money out. The 'to' (destination) dropdown lists every account in the space, so you can record income into a shared household pot or transfer money to a roommate's account."
                />
                <InfoCard
                    title="Transfer fees"
                    body="Toggle 'There's a fee on this transfer' to capture wire fees, ATM fees, FX margins, etc. The fee is deducted from the source on top of the amount (destination still receives the plain amount), categorized as a regular expense, and folds into every analytics view — top categories, envelope utilization, cash flow, spending heatmap."
                />
                <InfoCard
                    title="Contributing from outside the space"
                    body="When you transfer money from a personal account (not shared with a space) into that space — e.g. topping up a family pot from your own checking — the space sees it as income for the period, not a mystery balance bump. Internal rebalances (both accounts already in the space) stay neutral. A transfer's fee is the source account's expense, so it only shows up in the space whose accounts actually paid it."
                />
                <InfoCard
                    title="Cash flow follows the accounts"
                    body="Cash flow, period net, balance trend, and the spending heatmap all read from the accounts shared into the space you're viewing. If an account is shared into two spaces, both spaces see every inflow and outflow on that account. An account you didn't share stays private — no info leaks to spaces that can't see it."
                />
                <InfoCard
                    title="Dates in app time"
                    body="The date picker defaults to right now, with Now / Yesterday quick chips, a calendar, and steppable hour/minute controls. Every timestamp is wall-clock in the app timezone, so all members see the same date on the same transaction."
                />
                <InfoCard
                    title="Balance after"
                    body="Every row on the Transactions page shows the account balance after that transaction (transfers show both legs). Filter to a single account and the list becomes a statement — one clean running balance per row, always reflecting the account's full history."
                />
            </div>
            <Paragraph>
                The Transactions page itself is a filterable statement: search by description,
                location, or amount; narrow by period, type, envelope, account, category, event, or
                amount range; and scroll an infinite day-grouped list with in / out / net totals for
                whatever slice you&apos;ve filtered to.
            </Paragraph>
            <CalloutCard title="Pinned defaults">
                Pin the values you reach for most so the new-transaction form opens pre-filled. Your{" "}
                <strong>account</strong> pin is personal — every member keeps their own default
                account in a space. <strong>Envelope</strong> and <strong>event</strong> pins are
                space-wide, so only an owner or editor can set them. Tap the small pin glyph beside
                a field to set or clear a default; clear it anytime.
            </CalloutCard>
            <Paragraph>
                You can attach receipts (images or PDFs) to any transaction. See{" "}
                <a href="#attachments" className="od-link">
                    Attachments &amp; receipts
                </a>{" "}
                below for how the upload flow works and who can see what.
            </Paragraph>
            <ScreenshotPlaceholder
                src="/docs/transactions.png"
                label="Transactions page — search, period and type filters, envelope/account/category chips, balance-after column"
            />
        </section>
    );
}

function Events() {
    return (
        <section className="od-section">
            <SectionHeader id="events" title="Events" icon={CalendarDays} />
            <Paragraph>
                Events are named time-bound groupings — a wedding, a trip, a renovation. Attach any
                transaction to an event and later slice the ledger by it to see the full cost and
                cashflow of the occasion. You can also attach files directly to an event (tickets,
                confirmations, photos) — see{" "}
                <a href="#attachments" className="od-link">
                    Attachments
                </a>
                .
            </Paragraph>
            <CalloutCard title="Lifecycle: active vs closed">
                Every event has a <strong>status</strong>. <strong>Active</strong> events show up in
                the transaction-entry event picker; <strong>closed</strong> events disappear from
                the picker but remain in the events list, analytics, and historical filters. Close
                an event when the trip is over so the picker stays tidy — you can reopen it later if
                a late receipt comes in.
            </CalloutCard>
            <CalloutCard title="Estimated budget">
                Optionally set an <strong>estimated amount</strong> on the event. The events list
                shows a progress bar with how much is left (or how far over you went), and the
                detail page adds a radial budget gauge plus a pace line on the spending timeline —
                so you can answer &quot;how badly did we blow the wedding budget&quot; at a glance.
                Leave it blank for events you&apos;re not tracking against a target.
            </CalloutCard>
            <Paragraph>
                The dedicated <strong>event detail</strong> page rolls the whole occasion up: stat
                tiles (spent, received, net, average per day, busiest day), a drillable category
                donut, a cumulative spending timeline with daily volume bars, top spending
                locations, and a searchable, filterable list of every transaction tagged to the
                event — with a quick close / reopen toggle in the corner. The events list itself
                adds a year timeline, an All / Active / Closed filter, and per-event spend and
                estimate chips.
            </Paragraph>
            <ScreenshotPlaceholder
                src="/docs/events.png"
                label="Events page — year timeline, estimate progress bars, and All / Active / Closed filter"
            />
            <ScreenshotPlaceholder
                src="/docs/event-detail.png"
                label="Event detail — budget gauge, category donut, and cumulative spending timeline"
            />
        </section>
    );
}

function Attachments() {
    return (
        <section className="od-section">
            <SectionHeader
                id="attachments"
                title="Attachments & receipts"
                kicker="Files in Orbit"
                icon={Paperclip}
            />
            <Paragraph>
                Attach images or PDFs to transactions (receipts) and to events (tickets,
                confirmations, photos). Uploads go straight from your browser to secure storage, so
                they don&apos;t slow the app down.
            </Paragraph>
            <div className="od-grid-3">
                <InfoCard
                    title="Transaction receipts"
                    body="Images or PDFs up to 20 MB each. Visible to any member of the transaction's space."
                />
                <InfoCard
                    title="Event attachments"
                    body="Images or PDFs up to 20 MB each. Visible to any member of the event's space."
                />
                <InfoCard
                    title="Profile avatars"
                    body="Images up to 5 MB. Automatically optimized so they stay crisp at any size."
                />
            </div>
            <Paragraph>
                Download links expire after a short window for safety — the app refreshes them every
                time you view an attachment, so sharing a link outside the app won&apos;t leak
                access. Remove an attachment and the file is deleted straight away.
            </Paragraph>
            <ScreenshotPlaceholder
                src="/docs/transaction-sheet.png"
                label="Transaction detail sheet — full details with the attachments area and add-file control"
            />
        </section>
    );
}

function Allocations() {
    return (
        <section className="od-section">
            <SectionHeader
                id="allocations"
                title="Envelopes are intent · accounts are the ledger"
                kicker="What makes Orbit different"
                icon={Sparkles}
            />
            <Paragraph>
                Two orthogonal questions about your money — and Orbit gives each one its own surface
                so you don&apos;t conflate them:
            </Paragraph>
            <div className="od-grid-2">
                <InfoCard
                    title="What is this money FOR?"
                    body="Answered by envelopes. Allocate, plan, and track intent at the space level — not pinned to any specific account."
                />
                <InfoCard
                    title="Where does this money LIVE?"
                    body="Answered by accounts. Balances, statements, and the running ledger of every transaction that hit them."
                />
            </div>
            <Paragraph>
                Allocations live on the envelope, not on an account. Plan{" "}
                <strong>300 for Groceries</strong> at the start of the month — the system
                doesn&apos;t care which checking, wallet, or card the actual purchases hit. As the
                month progresses, expenses you assign to the Groceries envelope drain it; the
                accounts independently reflect where the cash actually moved.
            </Paragraph>
            <Paragraph>
                The <strong>Budget this month</strong> page gives you a single screen to plan every
                monthly envelope at once. Each card shows last month&apos;s spend against its plan
                and your three-month average, with one-tap chips to copy either into this
                month&apos;s amount — plus a live verdict of how much stays free (or how far
                over-budgeted you are) after you save. Past months open in review mode, with an
                unlock step for reconciliation. Envelopes are space-wide budget intent; you never
                have to pin them to a particular account.
            </Paragraph>
            <ScreenshotPlaceholder
                src="/docs/budget-month.png"
                label="Budget this month — per-envelope planning cards with last month, average, and quick-set chips"
            />
        </section>
    );
}

function Drift() {
    return (
        <section className="od-section">
            <SectionHeader id="drift" title="Overspend" icon={Shield} />
            <Paragraph>
                Envelopes are a <strong>planning</strong> tool, not a cash partition. When an
                envelope spends more than it was allocated for the period, nothing blocks you — the
                transaction always records. You have two honest ways to handle the gap.
            </Paragraph>
            <div className="od-grid-2">
                <InfoCard
                    title="Pull from another envelope"
                    body="Move allocation from a less-pressed envelope to cover the gap."
                />
                <InfoCard
                    title="Leave it"
                    body="Do nothing — the overspend shows in analytics and the envelope resets next month. Nothing carries forward."
                />
            </div>
        </section>
    );
}

function Analytics() {
    return (
        <section className="od-section">
            <SectionHeader id="analytics" title="Analytics" icon={BarChart3} />
            <Paragraph>
                Eight dedicated analytics views, each with its own period selector:
            </Paragraph>
            <ul className="od-list">
                <li>
                    <strong>Cash flow</strong> — income vs expense by month, with a savings-rate
                    trend and a per-month top-category breakdown
                </li>
                <li>
                    <strong>Spending trends</strong> — cumulative pace vs last period and your
                    typical shape, projection to period end, daily burn, YoY
                </li>
                <li>
                    <strong>Category spending</strong> — drillable donut with subtree roll-up, tree
                    or flat mode, per-category trend lines
                </li>
                <li>
                    <strong>Envelope utilization</strong> — liquid-fill gauges, on-pace vs
                    trending-over, cumulative and year-to-date trends
                </li>
                <li>
                    <strong>Balance history</strong> — total or per-account balance over time, with
                    day / week / month / year buckets
                </li>
                <li>
                    <strong>Spending calendar</strong> — twelve months of daily intensity with
                    recurring-bill markers, weekday and heaviest-week breakdowns
                </li>
                <li>
                    <strong>Anomalies &amp; signals</strong> — outlier transactions,
                    recurring-charge changes, broken patterns, streaks
                </li>
                <li>
                    <strong>By priority</strong> — must-spend vs want-spend from the essential /
                    important / discretionary / luxury tiers
                </li>
            </ul>
            <Paragraph>
                Most views add a <strong>cash vs operational</strong> toggle (count transfer
                principal, or true income/expense only) and shareable envelope / account / category
                filters, and the charts drill straight through — click a donut slice, a calendar
                day, or a table row to land on exactly those transactions.
            </Paragraph>
            <Paragraph>
                A standalone <strong>Year report</strong> lives outside the analytics index — a
                12-column envelope × month grid showing planned vs spent for every envelope across
                the year, with the overspend total per row.
            </Paragraph>
            <ScreenshotPlaceholder
                src="/docs/analytics.png"
                label="Analytics index with the 8 sub-view cards"
            />
            <ScreenshotPlaceholder
                src="/docs/analytics-heatmap.png"
                label="Spending calendar — twelve months at a glance with intensity shading, recurring-bill dots, and the year-peak ring"
            />
        </section>
    );
}

function MyMoney() {
    return (
        <section className="od-section">
            <SectionHeader id="my-money" title="Your money across spaces" icon={LineChart} />
            <Paragraph>
                A Roommates space, an Office one, a Family one — each is its own ledger, which is
                exactly what you want when you&apos;re collaborating. The downside: your own
                financial picture gets fragmented across three or four spaces.{" "}
                <strong>My money</strong> fixes that by stitching your personal activity back into
                one place — except it&apos;s not a separate page, it&apos;s a{" "}
                <strong>virtual space</strong> that shows up right alongside your real spaces in the
                space switcher.
            </Paragraph>
            <Paragraph>
                The anchor is <strong>accounts you personally own</strong> — the ones where
                you&apos;re listed as owner in the account&apos;s members. Your salary account, your
                wallet, your savings. Open <strong>My money</strong> and you get the same overview,
                accounts, transactions, and analytics views you&apos;d see in any real space — but
                unioned across <i>every</i> space you&apos;re in, filtered to transactions that
                touch your owned accounts. Each row is tagged with the real space it came from, so
                you can drill straight back into the shared ledger when you need to.
            </Paragraph>
            <div className="od-grid-2">
                <InfoCard
                    title="What counts as personal cash flow"
                    body="Income into an owned account is inflow. Expenses paid from an owned account are outflow. A transfer from your own account into a shared household pot counts as an outflow (you funded the shared pot); the other direction is an inflow. Transfers between two accounts you both own net to zero."
                />
                <InfoCard
                    title="What doesn't show up here"
                    body="Money that moves inside a shared space without touching an account you own — like the household paying rent out of a shared pot — stays on that space's dashboard. Splitting shared-space expenses into per-user shares is on the roadmap."
                />
            </div>
            <Paragraph>
                My money is read-only — every change belongs to a specific real space, so to record
                something, jump into a real space via the switcher (or click any row&apos;s space
                chip).
            </Paragraph>
            <ScreenshotPlaceholder
                src="/docs/my-money.png"
                label="My money virtual space — overview, analytics, and transactions unioned across every space you're in"
            />
        </section>
    );
}

function Permissions() {
    return (
        <section className="od-section">
            <SectionHeader id="permissions" title="Roles & permissions" icon={Shield} />
            <div className="od-grid-3">
                <RoleCard
                    role="Owner"
                    tone="income"
                    body="Full control. Invite/remove members, change roles, delete the space, plus everything editors and viewers can do."
                />
                <RoleCard
                    role="Editor"
                    tone="brand"
                    body="Record transactions, allocate, rebalance, create events. Cannot change membership or envelopes/categories."
                />
                <RoleCard
                    role="Viewer"
                    tone="muted"
                    body="Read-only. See everything, change nothing."
                />
            </div>
            <Paragraph>
                Accounts have their own separate ACL (owner / viewer), managed from the account
                detail → <strong>Members</strong> tab. Account owners can share the account into
                spaces, add/remove account members, rename, recolor, and delete; viewers can only
                see it. Because the account ACL is independent of space membership, you can keep a
                private wallet visible to you only, even while sharing it into a household space.
            </Paragraph>
        </section>
    );
}

function Profile() {
    return (
        <section className="od-section">
            <SectionHeader id="profile" title="Your profile" icon={UserCircle} />
            <Paragraph>
                Your profile — name, email, avatar, password — lives in{" "}
                <strong>Settings → Profile</strong> and <strong>Settings → Security</strong>,
                reachable from the user avatar menu in the top-right corner. Uploading a new avatar
                replaces your picture everywhere you appear in Orbit (space member list, transaction
                creator tags, account members).
            </Paragraph>
            <Paragraph>
                <strong>Changing your email</strong> takes effect immediately once you confirm with
                your current password. <strong>Changing your password</strong> while signed in:
                enter current + new, both required. If you&apos;ve forgotten your password, use the{" "}
                <strong>Forgot password</strong> link on the login screen, which sends a 6-digit
                code to your inbox.
            </Paragraph>
            <CalloutCard title="Deleting your account">
                Settings → Security → <strong>Delete my account</strong>. Confirm by typing{" "}
                <span className="mono od-tag">DELETE</span> and your current password — the action
                is irreversible. Your user record, memberships, and personal accounts are erased.
                The one refusal: if you&apos;re the sole owner of any space, transfer ownership or
                delete that space first. Spaces with another owner continue to exist without you.
            </CalloutCard>
            <ScreenshotPlaceholder
                src="/docs/profile.png"
                label="Profile settings — avatar uploader, name/email forms, password card, delete-account flow"
            />
        </section>
    );
}

function Timezone() {
    return (
        <section className="od-section">
            <SectionHeader id="timezone" title="Time & timezone" icon={Clock} />
            <Paragraph>
                Orbit currently shows all dates in <strong>Asia/Dhaka (+06:00)</strong> — so
                &quot;this month&quot;, envelope period boundaries, and displayed transaction times
                are identical for everyone, no matter where they open the app. Per-space timezone
                customization is on the roadmap.
            </Paragraph>
        </section>
    );
}

function Faq() {
    return (
        <section className="od-section">
            <SectionHeader id="faq" title="FAQ" icon={HelpCircle} />
            <div className="od-faq-list">
                <FaqItem
                    q="Is my data private?"
                    a="Yes — each space is isolated. Only members of a space can see its transactions and envelopes. Accounts have a second permission layer on top of space membership."
                />
                <FaqItem
                    q="Can I edit a transaction after recording it?"
                    a="Yes — if you recorded it. Open the row's detail sheet and hit the pencil: amount, date, account, category, envelope, event, and description are all editable, and balances and envelope usage recompute automatically. Transfer-fee rows are edited through their parent transfer."
                />
                <FaqItem
                    q="What happens when I delete an account?"
                    a="Only the account owner can delete. It checks that the account isn't in use (transactions, allocations) in any space — clean those up first, then delete."
                />
                <FaqItem
                    q="Can I use Orbit for just myself?"
                    a="Absolutely. A space of one works exactly the same. You get all the same envelope and goal features without the collaboration overhead."
                />
                <FaqItem
                    q="Does Orbit support multiple currencies?"
                    a="Not yet — amounts are currency-agnostic and treated as one implicit currency per space. Multi-currency is on the roadmap."
                />
                <FaqItem
                    q="How big can a receipt attachment be?"
                    a="Images or PDFs up to 20 MB for each transaction or event attachment; profile avatars up to 5 MB. Uploads go directly from your browser, so the app stays fast even on larger files."
                />
                <FaqItem
                    q="Who can see a receipt I attach to a transaction?"
                    a="Any member of the space the transaction belongs to. Links expire after a short window, so even if someone copies one out of the app it won't keep working."
                />
                <FaqItem
                    q="Where do I report a bug or request a feature?"
                    a="Open an issue on the project's GitHub repo, or email the maintainer directly."
                />
                <FaqItem
                    q="How do I invite someone who doesn't have an Orbit account yet?"
                    a="Same flow — Space settings → Members → Invite by email. They'll get a link that asks them to sign up first, then drops them straight into the space once they confirm their email."
                />
                <FaqItem
                    q="What happens to my data if I leave a space?"
                    a="Your membership is removed; the space and everything in it (transactions you recorded, allocations you made, events you created) stays with the remaining members. Accounts you own are unshared from the space but still yours."
                />
            </div>
        </section>
    );
}

function ClosingCta({ isAuthed }: { isAuthed: boolean }) {
    return (
        <section className="od-card od-closing vignette">
            <div className="od-closing-text">
                <h2 className="serif od-closing-title">
                    {isAuthed ? "Jump back in" : "Ready to try Orbit?"}
                </h2>
                <p className="od-prose">
                    {isAuthed
                        ? "Open your spaces and keep the ledger up to date."
                        : "Create an account, set up your first space, and start tracking in under five minutes."}
                </p>
            </div>
            <div className="od-closing-cta">
                {isAuthed ? (
                    <Link to={ROUTES.root} className="od-btn od-btn-primary od-btn-lg">
                        Open app
                        <ArrowRight className="size-4" />
                    </Link>
                ) : (
                    <>
                        <Link to={ROUTES.login} className="od-btn od-btn-lg">
                            Log in
                        </Link>
                        <Link to={ROUTES.signup} className="od-btn od-btn-primary od-btn-lg">
                            Sign up free
                            <ArrowRight className="size-4" />
                        </Link>
                    </>
                )}
            </div>
        </section>
    );
}

/* ---------------------------------------------------------------- */
/*  Reusable bits                                                   */
/* ---------------------------------------------------------------- */

function ScreenshotPlaceholder({
    label,
    src = "/docs/placeholder.svg",
}: {
    label: string;
    src?: string;
}) {
    return (
        <figure className="od-shot">
            <img src={src} alt={label} loading="lazy" decoding="async" />
            <figcaption>
                <BookOpen className="size-3.5 shrink-0" style={{ color: "var(--brand)" }} />
                <span>{label}</span>
            </figcaption>
        </figure>
    );
}

function FeatureGrid({
    items,
}: {
    items: Array<{
        icon: React.ComponentType<{ className?: string }>;
        title: string;
        body: string;
    }>;
}) {
    return (
        <div className="od-grid-3 od-feature-grid">
            {items.map((it) => (
                <div key={it.title} className="od-card od-feature-card">
                    <span className="od-feature-icon" aria-hidden>
                        <it.icon className="size-4" />
                    </span>
                    <h3 className="od-feature-title">{it.title}</h3>
                    <p className="od-prose-sm">{it.body}</p>
                </div>
            ))}
        </div>
    );
}

function ConceptCard({ title, body }: { title: string; body: string }) {
    return (
        <div className="od-card od-concept-card">
            <p className="od-concept-title">{title}</p>
            <p className="od-prose-sm">{body}</p>
        </div>
    );
}

function StepCard({ step, title, body }: { step: number; title: string; body: string }) {
    return (
        <li className="od-card od-step">
            <span className="od-step-num">{step}</span>
            <div>
                <p className="od-step-title">{title}</p>
                <p className="od-prose-sm">{body}</p>
            </div>
        </li>
    );
}

function CalloutCard({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="od-card od-callout">
            <p className="od-callout-title">{title}</p>
            <p className="od-callout-body">{children}</p>
        </div>
    );
}

function TxTypeCard({ type, body }: { type: string; body: string }) {
    return (
        <div className="od-card od-info-card">
            <p className="od-info-title">{type}</p>
            <p className="od-prose-sm">{body}</p>
        </div>
    );
}

function InfoCard({ title, body }: { title: string; body: string }) {
    return (
        <div className="od-card od-info-card">
            <p className="od-info-title">{title}</p>
            <p className="od-prose-sm">{body}</p>
        </div>
    );
}

function RoleCard({
    role,
    tone,
    body,
}: {
    role: string;
    tone: "income" | "brand" | "muted";
    body: string;
}) {
    const color =
        tone === "income" ? "var(--income)" : tone === "brand" ? "var(--brand)" : "var(--fg-3)";
    return (
        <div className="od-card od-role-card">
            <p className="od-role-title" style={{ color }}>
                {role}
            </p>
            <p className="od-prose-sm">{body}</p>
        </div>
    );
}

function FaqItem({ q, a }: { q: string; a: string }) {
    return (
        <details className="od-card od-faq">
            <summary>
                <ChevronRight className="size-4 shrink-0" />
                <span>{q}</span>
            </summary>
            <p>{a}</p>
        </details>
    );
}

/* ---------------------------------------------------------------- */
/*  Scoped styles                                                   */
/* ---------------------------------------------------------------- */

const DOCS_STYLES = `
.orbit-docs {
    min-height: 100dvh;
    background: var(--bg);
    color: var(--fg);
    --od-px: clamp(20px, 5vw, 64px);
}

/* Top bar */
.orbit-docs .od-topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px var(--od-px);
    background: color-mix(in oklab, var(--bg) 90%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line-soft);
}
.orbit-docs .od-topbar-logo {
    display: inline-flex;
    text-decoration: none;
    color: inherit;
}
.orbit-docs .od-topbar-nav {
    display: flex;
    align-items: center;
    gap: 6px;
}
.orbit-docs .od-topbar-link {
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 13px;
    color: var(--fg-2);
    text-decoration: none;
    transition: color 140ms ease, background 140ms ease;
}
.orbit-docs .od-topbar-link:hover { color: var(--fg); background: var(--bg-elev-2); }
.orbit-docs .od-topbar-link.is-active { color: var(--fg); }

/* Bump topbar CTAs to a 44px tap target on touch viewports — the shared
   .od-btn-sm height (30px) is below the WCAG minimum, but only matters
   here where the topbar is the primary entry point on mobile. */
@media (max-width: 640px) {
    .orbit-docs .od-topbar .od-btn-sm {
        height: 44px;
        padding: 0 14px;
        font-size: 13px;
    }
    .orbit-docs .od-topbar-link {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
    }
}

/* Page container */
.orbit-docs .od-page {
    position: relative;
    max-width: 1280px;
    margin: 0 auto;
    padding: clamp(2rem, 5vh, 4rem) var(--od-px) 6rem;
}
.orbit-docs .od-page::before,
.orbit-docs .od-page::after {
    content: "";
    position: absolute;
    inset: auto;
    pointer-events: none;
    z-index: 0;
    width: 520px;
    height: 520px;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.22;
}
.orbit-docs .od-page::before {
    top: -80px;
    right: -120px;
    background: radial-gradient(closest-side, var(--brand), transparent 70%);
}
.orbit-docs .od-page::after {
    bottom: -120px;
    left: -120px;
    background: radial-gradient(closest-side, var(--gold), transparent 70%);
    opacity: 0.16;
}
.orbit-docs .od-page > * { position: relative; z-index: 1; }

/* Hero */
.orbit-docs .od-hero {
    display: grid;
    gap: 16px;
    padding: 8px 0 32px;
    max-width: 760px;
}
.orbit-docs .od-hero-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid color-mix(in oklab, var(--brand) 35%, var(--line));
    background: var(--brand-soft);
    color: var(--brand);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    width: fit-content;
    text-transform: uppercase;
}
.orbit-docs .od-hero-title {
    font-size: clamp(2.5rem, 5.5vw, 4.25rem);
    line-height: 1.02;
    font-weight: 400;
    letter-spacing: -0.025em;
    color: var(--fg);
}
.orbit-docs .od-hero-lede {
    font-size: clamp(1rem, 1.2vw, 1.125rem);
    line-height: 1.65;
    color: var(--fg-2);
    max-width: 64ch;
}
.orbit-docs .od-hero-lede strong { color: var(--fg); font-weight: 500; }
.orbit-docs .od-hero-cta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 4px;
}

/* Grid: TOC + main */
.orbit-docs .od-grid {
    display: grid;
    gap: clamp(1.5rem, 3vw, 2.5rem);
    grid-template-columns: 1fr;
    margin-top: 24px;
}
@media (min-width: 1024px) {
    .orbit-docs .od-grid {
        grid-template-columns: 220px minmax(0, 1fr);
    }
}

/* TOC */
.orbit-docs .od-toc-wrap { display: none; }
@media (min-width: 1024px) {
    .orbit-docs .od-toc-wrap { display: block; }
}
.orbit-docs .od-toc {
    position: sticky;
    top: 88px;
    display: grid;
    gap: 2px;
}
.orbit-docs .od-toc-eyebrow {
    margin-bottom: 8px;
    color: var(--fg-4);
}
.orbit-docs .od-toc-link {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 8px;
    font-size: 12.5px;
    color: var(--fg-3);
    text-decoration: none;
    transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
    border-left: 1px solid transparent;
}
.orbit-docs .od-toc-link:hover { color: var(--fg); }
.orbit-docs .od-toc-link.is-active {
    color: var(--fg);
    background: var(--bg-elev-1);
    border-left-color: var(--brand);
}

/* Mobile TOC */
.orbit-docs .od-mobile-toc {
    margin-bottom: 24px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-elev-1);
    padding: 12px 14px;
}
@media (min-width: 1024px) {
    .orbit-docs .od-mobile-toc { display: none; }
}
.orbit-docs .od-mobile-toc summary {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    list-style: none;
}
.orbit-docs .od-mobile-toc summary::-webkit-details-marker { display: none; }
.orbit-docs .od-mobile-toc[open] summary svg:last-child { transform: rotate(90deg); }
.orbit-docs .od-mobile-toc summary svg:last-child { transition: transform 160ms; }
.orbit-docs .od-mobile-toc-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2px;
    margin-top: 12px;
}
@media (min-width: 480px) {
    .orbit-docs .od-mobile-toc-grid { grid-template-columns: 1fr 1fr; }
}
.orbit-docs .od-mobile-toc-link {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 12.5px;
    color: var(--fg-3);
    text-decoration: none;
}
.orbit-docs .od-mobile-toc-link:hover { color: var(--fg); background: var(--bg-elev-2); }

/* Main column + sections */
.orbit-docs .od-main { min-width: 0; }
.orbit-docs .od-sections {
    display: grid;
    gap: clamp(2.5rem, 5vw, 4rem);
}
.orbit-docs .od-section {
    display: grid;
    gap: 14px;
}
.orbit-docs .od-section-head {
    display: grid;
    gap: 6px;
    margin-bottom: 2px;
}
.orbit-docs .od-section-kicker { color: var(--brand); }
.orbit-docs .od-section-title {
    scroll-margin-top: 96px;
    font-size: clamp(1.5rem, 2.5vw, 2rem);
    font-weight: 500;
    letter-spacing: -0.015em;
    color: var(--fg);
    display: flex;
    align-items: center;
    gap: 12px;
}
.orbit-docs .od-section-icon {
    display: inline-flex;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: var(--brand-soft);
    color: var(--brand);
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

/* Prose */
.orbit-docs .od-prose {
    font-size: 14.5px;
    line-height: 1.7;
    color: var(--fg-2);
}
.orbit-docs .od-prose strong { color: var(--fg); font-weight: 500; }
.orbit-docs .od-prose i { color: var(--fg); }
.orbit-docs .od-prose-sm {
    font-size: 13px;
    line-height: 1.6;
    color: var(--fg-3);
}
.orbit-docs .od-prose-sm strong { color: var(--fg-2); font-weight: 500; }
.orbit-docs .od-link {
    color: var(--brand);
    text-decoration: none;
    border-bottom: 1px solid color-mix(in oklab, var(--brand) 40%, transparent);
    transition: border-color 140ms ease;
}
.orbit-docs .od-link:hover { border-bottom-color: var(--brand); }

/* List */
.orbit-docs .od-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px 24px;
    padding: 0;
    margin: 0;
    list-style: none;
    font-size: 13.5px;
    color: var(--fg-2);
}
@media (min-width: 640px) {
    .orbit-docs .od-list { grid-template-columns: 1fr 1fr; }
}
.orbit-docs .od-list li {
    position: relative;
    padding-left: 16px;
    line-height: 1.55;
}
.orbit-docs .od-list li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 9px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--brand);
    opacity: 0.7;
}
.orbit-docs .od-list strong { color: var(--fg); font-weight: 500; }

/* Card grids */
.orbit-docs .od-grid-2 { display: grid; gap: 10px; grid-template-columns: 1fr; }
.orbit-docs .od-grid-3 { display: grid; gap: 10px; grid-template-columns: 1fr; }
@media (min-width: 640px) {
    .orbit-docs .od-grid-2 { grid-template-columns: 1fr 1fr; }
    .orbit-docs .od-grid-3 { grid-template-columns: 1fr 1fr; }
}
@media (min-width: 900px) {
    .orbit-docs .od-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
}

/* Concept / Info / TxType cards (same shape) */
.orbit-docs .od-concept-card,
.orbit-docs .od-info-card,
.orbit-docs .od-role-card {
    padding: 14px 16px;
    display: grid;
    gap: 6px;
    transition: border-color 140ms ease, transform 140ms ease;
}
.orbit-docs .od-concept-card:hover,
.orbit-docs .od-info-card:hover,
.orbit-docs .od-role-card:hover {
    border-color: var(--line-strong);
}
.orbit-docs .od-concept-title,
.orbit-docs .od-info-title {
    font-weight: 600;
    color: var(--fg);
    font-size: 13.5px;
}
.orbit-docs .od-role-title {
    font-weight: 600;
    font-size: 14px;
}

/* Feature grid */
.orbit-docs .od-feature-grid { margin-top: 4px; }
.orbit-docs .od-feature-card {
    padding: 18px;
    display: grid;
    gap: 10px;
}
.orbit-docs .od-feature-icon {
    display: inline-flex;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--brand-soft);
    color: var(--brand);
    align-items: center;
    justify-content: center;
}
.orbit-docs .od-feature-title {
    font-weight: 600;
    color: var(--fg);
    font-size: 14px;
}

/* Steps */
.orbit-docs .od-steps {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 10px;
}
.orbit-docs .od-step {
    padding: 14px 16px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
}
.orbit-docs .od-step-num {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--brand-soft);
    color: var(--brand);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
    font-family: "Newsreader", Georgia, serif;
}
.orbit-docs .od-step-title {
    font-weight: 600;
    color: var(--fg);
    font-size: 14px;
    margin-bottom: 4px;
}

/* Callout card — brand-tinted */
.orbit-docs .od-callout {
    padding: 16px 18px;
    border-color: color-mix(in oklab, var(--brand) 30%, var(--line));
    background:
        linear-gradient(180deg, var(--brand-soft) 0%, transparent 80%),
        var(--bg-elev-1);
}
.orbit-docs .od-callout-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--brand);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.orbit-docs .od-callout-body {
    font-size: 14px;
    line-height: 1.65;
    color: var(--fg-2);
}
.orbit-docs .od-callout-body strong { color: var(--fg); font-weight: 500; }

/* Inline tag (mono code-ish) */
.orbit-docs .od-tag {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--bg-elev-3);
    color: var(--fg);
    font-size: 12px;
    border: 1px solid var(--line-soft);
}

/* Demo card */
.orbit-docs .od-demo-card {
    padding: 18px 20px;
    border-color: color-mix(in oklab, var(--brand) 30%, var(--line));
    display: grid;
    gap: 12px;
}
.orbit-docs .od-demo-card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
}
.orbit-docs .od-demo-creds {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 24px;
    font-size: 13px;
    margin: 0;
}
.orbit-docs .od-demo-creds dt { color: var(--fg-3); }
.orbit-docs .od-demo-creds dd { color: var(--fg); margin: 0; user-select: all; }

/* Screenshot */
.orbit-docs .od-shot {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid var(--line);
    background: var(--bg-elev-2);
    margin: 0;
}
.orbit-docs .od-shot img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.orbit-docs .od-shot figcaption {
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: color-mix(in oklab, var(--bg) 80%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-top: 1px solid var(--line-soft);
    font-size: 11.5px;
    color: var(--fg-3);
}

/* FAQ */
.orbit-docs .od-faq-list { display: grid; gap: 8px; }
.orbit-docs .od-faq {
    padding: 14px 16px;
    transition: border-color 140ms ease;
}
.orbit-docs .od-faq:hover { border-color: var(--line-strong); }
.orbit-docs .od-faq summary {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    color: var(--fg);
    list-style: none;
}
.orbit-docs .od-faq summary::-webkit-details-marker { display: none; }
.orbit-docs .od-faq summary svg { color: var(--fg-3); transition: transform 160ms; }
.orbit-docs .od-faq[open] summary svg { transform: rotate(90deg); color: var(--brand); }
.orbit-docs .od-faq p {
    margin-top: 10px;
    padding-left: 26px;
    font-size: 13.5px;
    line-height: 1.65;
    color: var(--fg-2);
}

/* Closing CTA */
.orbit-docs .od-closing {
    margin-top: 64px;
    padding: clamp(24px, 4vw, 40px);
    display: grid;
    gap: 20px;
    border-color: color-mix(in oklab, var(--brand) 30%, var(--line));
    background:
        linear-gradient(135deg, var(--brand-soft) 0%, transparent 60%),
        var(--bg-elev-1);
}
@media (min-width: 768px) {
    .orbit-docs .od-closing {
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 32px;
    }
}
.orbit-docs .od-closing-text { display: grid; gap: 8px; }
.orbit-docs .od-closing-title {
    font-size: clamp(1.5rem, 2.5vw, 2rem);
    font-weight: 500;
    color: var(--fg);
    letter-spacing: -0.015em;
}
.orbit-docs .od-closing-cta {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
}
`;
