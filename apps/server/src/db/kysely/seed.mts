/**
 * Local-dev database seeder — "huge demo" edition.
 *
 * Wipes every product table and populates a rich, realistic dataset so
 * a fresh stack has something substantial to show: multi-year history,
 * many users collaborating across several spaces, dozens of accounts
 * and goals, deeply nested categories, and ~thousands of transactions
 * with realistic vendor names, seasonal patterns, transfer fees, and
 * event-linked clusters.
 *
 *   pnpm --filter backend seed
 *
 * Safety rails:
 * - Refuses to run when `NODE_ENV=production`.
 * - Does NOT touch files / attachments / exported_reports tables — those
 *   point at R2 objects that don't exist locally, and the only things
 *   that need them (avatars) fall back gracefully to initials.
 *
 * Data universe (locale-neutral; amounts are currency-agnostic):
 * - 8 users — primary + partner + 6 collaborators across spaces
 * - 5 spaces (Family Budget, Personal, Roommates, Side Business, Travel)
 * - 16 accounts across asset / liability / locked
 * - 30+ envelopes (monthly reset + rolling lifetime-pool cadences)
 * - 4 goals (house, emergency, vacation, laptop) seeded as cadence='none' envelopes with targets
 * - 120+ expense categories, most two levels deep
 * - 24 events — trips, weddings, conferences, renovations, celebrations;
 *   past events marked closed with closed_at; some have estimated_amount
 * - 3 pending space invites so the invite-by-email flow has visible data
 * - 2 transaction-entry pins on the family space (Account: Joint
 *   Checking for Alex; Envelope: Groceries shared) so the new-transaction
 *   form shows the "pinned" affordance out of the box
 * - ~18 months of history ending today
 * - ~8,000+ transactions, with realistic monthly bills, weekly grocery
 *   runs, daily coffee, freelance income, bonuses, tax refunds, foreign
 *   transaction fees, credit card payoffs, salary progression, seasonal
 *   holiday spikes and event-tagged clusters
 * - ~500+ envelope allocations, with intentional drift, rebalances,
 *   and account-pinned allocations to surface the 2D matrix idea
 *
 * Primary user credentials are printed at the end.
 */

import bcrypt from "bcrypt";
import crypto from "crypto";
import { sql } from "kysely";
import createPGPool from "../index.mjs";
import { createQueryBuilder } from "./index.mjs";
import type {
    Accounts,
    SpaceMembers,
    SpacePin,
    Transactions,
    UserAccounts,
    UserSpacePin,
} from "./types.mjs";
import { ENV } from "../../env.mjs";
import { logger } from "../../utils/logger.mjs";

const PRIMARY_PASSWORD = "password123";
const BCRYPT_ROUNDS = 4; // fast; seed only

// ---------------------------------------------------------------------
// Deterministic PRNG — Mulberry32 seeded from a constant so the same
// seed script run twice produces identical data.
// ---------------------------------------------------------------------

const createRng = (seed: number) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
const rng = createRng(0xc0ffee);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const range = (lo: number, hi: number): number => Math.round(lo + rng() * (hi - lo));
const rangeF = (lo: number, hi: number): number => Math.round((lo + rng() * (hi - lo)) * 100) / 100;
const maybe = (p: number): boolean => rng() < p;

// ---------------------------------------------------------------------
// Date helpers. Window is 18 months ending today so annual patterns
// (bonuses, tax refunds, holiday spending) show up more than once.
// ---------------------------------------------------------------------

const NOW = new Date();
const MS_DAY = 86_400_000;
const HISTORY_MONTHS = 18;

const startOfMonthUTC = (d: Date): Date =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
const addMonths = (d: Date, n: number): Date =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * MS_DAY);
const atHour = (d: Date, h: number, m = 0): Date => {
    const out = new Date(d);
    out.setHours(h, m, 0, 0);
    return out;
};

const periodStarts: Date[] = (() => {
    const anchor = startOfMonthUTC(NOW);
    const out: Date[] = [];
    for (let i = HISTORY_MONTHS - 1; i >= 0; i--) out.push(addMonths(anchor, -i));
    return out;
})();

// Month-of-year seasonal multiplier for discretionary spend. Dec spikes
// (holidays), summer (Jun/Jul/Aug) modestly elevated (travel / eating
// out), Jan–Feb slightly subdued (post-holiday). Applied softly so the
// shape is visible in charts without being caricatured.
const seasonalMult = (d: Date): number => {
    const m = d.getUTCMonth(); // 0=Jan
    const table = [0.88, 0.92, 1.0, 1.02, 1.04, 1.08, 1.12, 1.1, 1.02, 1.04, 1.08, 1.28];
    return table[m] ?? 1;
};

// ---------------------------------------------------------------------
// Static catalog
// ---------------------------------------------------------------------

const USERS = [
    { key: "primary", email: "alex@orbit.dev", first_name: "Alex", last_name: "Morgan" },
    { key: "partner", email: "sam@orbit.dev", first_name: "Sam", last_name: "Rivera" },
    { key: "friend", email: "jordan@orbit.dev", first_name: "Jordan", last_name: "Lee" },
    { key: "roommate", email: "taylor@orbit.dev", first_name: "Taylor", last_name: "Chen" },
    { key: "roommate2", email: "morgan@orbit.dev", first_name: "Morgan", last_name: "Patel" },
    { key: "biz", email: "riley@orbit.dev", first_name: "Riley", last_name: "Kim" },
    { key: "sibling", email: "casey@orbit.dev", first_name: "Casey", last_name: "Nguyen" },
    { key: "travel", email: "robin@orbit.dev", first_name: "Robin", last_name: "Hayes" },
] as const;

type UserKey = (typeof USERS)[number]["key"];

const SPACES = [
    {
        key: "family",
        name: "Family Budget",
        owner: "primary" as UserKey,
        members: [
            { user: "partner" as UserKey, role: "editor" as const },
            { user: "sibling" as UserKey, role: "viewer" as const },
            { user: "friend" as UserKey, role: "viewer" as const },
        ],
    },
    {
        key: "personal",
        name: "Personal",
        owner: "primary" as UserKey,
        members: [] as { user: UserKey; role: "editor" | "viewer" | "owner" }[],
    },
    {
        key: "roommates",
        name: "Roommates",
        owner: "primary" as UserKey,
        members: [
            { user: "roommate" as UserKey, role: "editor" as const },
            { user: "roommate2" as UserKey, role: "editor" as const },
        ],
    },
    {
        key: "side",
        name: "Side Business",
        owner: "primary" as UserKey,
        members: [{ user: "biz" as UserKey, role: "editor" as const }],
    },
    {
        key: "travel",
        name: "Travel Fund",
        owner: "primary" as UserKey,
        members: [
            { user: "partner" as UserKey, role: "editor" as const },
            { user: "travel" as UserKey, role: "editor" as const },
        ],
    },
] as const;

type SpaceKey = (typeof SPACES)[number]["key"];

const ACCOUNTS = [
    // Liquid assets
    {
        key: "cash",
        name: "Cash Wallet",
        type: "asset" as const,
        color: "#22c55e",
        icon: "wallet",
        owner: "primary" as UserKey,
        viewers: [] as UserKey[],
        spaces: ["family", "personal", "roommates"] as SpaceKey[],
    },
    {
        key: "checking",
        name: "Checking",
        type: "asset" as const,
        color: "#0ea5e9",
        icon: "landmark",
        owner: "primary" as UserKey,
        viewers: ["partner"] as UserKey[],
        spaces: ["family", "personal"] as SpaceKey[],
    },
    {
        key: "savings",
        name: "High-Yield Savings",
        type: "asset" as const,
        color: "#10b981",
        icon: "piggy-bank",
        owner: "primary" as UserKey,
        viewers: ["partner"] as UserKey[],
        spaces: ["family"] as SpaceKey[],
    },
    {
        key: "joint",
        name: "Joint Checking",
        type: "asset" as const,
        color: "#f59e0b",
        icon: "users",
        owner: "primary" as UserKey,
        viewers: ["partner"] as UserKey[],
        spaces: ["family"] as SpaceKey[],
    },
    {
        key: "mobile",
        name: "Mobile Money",
        type: "asset" as const,
        color: "#f43f5e",
        icon: "smartphone",
        owner: "primary" as UserKey,
        viewers: [] as UserKey[],
        spaces: ["personal"] as SpaceKey[],
    },
    {
        key: "shared",
        name: "Shared House",
        type: "asset" as const,
        color: "#a855f7",
        icon: "users",
        owner: "primary" as UserKey,
        viewers: ["roommate", "roommate2"] as UserKey[],
        spaces: ["roommates"] as SpaceKey[],
    },
    {
        key: "biz",
        name: "Business Checking",
        type: "asset" as const,
        color: "#0891b2",
        icon: "briefcase",
        owner: "primary" as UserKey,
        viewers: ["biz"] as UserKey[],
        spaces: ["side"] as SpaceKey[],
    },
    {
        key: "travel_acc",
        name: "Travel Account",
        type: "asset" as const,
        color: "#14b8a6",
        icon: "plane",
        owner: "primary" as UserKey,
        viewers: ["partner", "travel"] as UserKey[],
        spaces: ["travel"] as SpaceKey[],
    },
    {
        key: "brokerage",
        name: "Brokerage",
        type: "asset" as const,
        color: "#6366f1",
        icon: "trending-up",
        owner: "primary" as UserKey,
        viewers: ["partner"] as UserKey[],
        spaces: ["personal"] as SpaceKey[],
    },
    {
        key: "crypto",
        name: "Crypto Wallet",
        type: "asset" as const,
        color: "#eab308",
        icon: "coins",
        owner: "primary" as UserKey,
        viewers: [] as UserKey[],
        spaces: ["personal"] as SpaceKey[],
    },
    // Liabilities
    {
        key: "credit",
        name: "Credit Card",
        type: "liability" as const,
        color: "#ef4444",
        icon: "credit-card",
        owner: "primary" as UserKey,
        viewers: ["partner"] as UserKey[],
        spaces: ["family", "personal"] as SpaceKey[],
    },
    {
        key: "rewards_cc",
        name: "Rewards Credit Card",
        type: "liability" as const,
        color: "#dc2626",
        icon: "credit-card",
        owner: "primary" as UserKey,
        viewers: ["partner"] as UserKey[],
        spaces: ["family", "travel"] as SpaceKey[],
    },
    {
        key: "student",
        name: "Student Loan",
        type: "liability" as const,
        color: "#be123c",
        icon: "graduation-cap",
        owner: "primary" as UserKey,
        viewers: [] as UserKey[],
        spaces: ["personal"] as SpaceKey[],
    },
    {
        key: "car_loan",
        name: "Car Loan",
        type: "liability" as const,
        color: "#9f1239",
        icon: "car",
        owner: "primary" as UserKey,
        viewers: ["partner"] as UserKey[],
        spaces: ["family"] as SpaceKey[],
    },
    // Locked / long-term
    {
        key: "term",
        name: "Term Deposit",
        type: "locked" as const,
        color: "#6366f1",
        icon: "lock",
        owner: "primary" as UserKey,
        viewers: ["partner"] as UserKey[],
        spaces: ["family"] as SpaceKey[],
    },
    {
        key: "retirement",
        name: "Retirement Account",
        type: "locked" as const,
        color: "#14b8a6",
        icon: "shield",
        owner: "primary" as UserKey,
        viewers: [] as UserKey[],
        spaces: ["personal"] as SpaceKey[],
    },
] as const;

type AccountKey = (typeof ACCOUNTS)[number]["key"];

type Priority = "essential" | "important" | "discretionary" | "luxury";

// Envelopes carry a cadence (monthly resets each period / 'none' is a
// lifetime pool). Priority lives on categories (migration 031) — an
// envelope's tier is implicit from its children.
const ENVELOPES = [
    // Family
    {
        key: "fam_groceries",
        space: "family" as SpaceKey,
        name: "Groceries",
        cadence: "monthly" as const,
        color: "#22c55e",
        icon: "shopping-cart",
    },
    {
        key: "fam_rent",
        space: "family" as SpaceKey,
        name: "Rent",
        cadence: "monthly" as const,
        color: "#ef4444",
        icon: "home",
    },
    {
        key: "fam_utilities",
        space: "family" as SpaceKey,
        name: "Utilities",
        cadence: "monthly" as const,
        color: "#0ea5e9",
        icon: "zap",
    },
    {
        key: "fam_transport",
        space: "family" as SpaceKey,
        name: "Transportation",
        cadence: "monthly" as const,
        color: "#f59e0b",
        icon: "car",
    },
    {
        key: "fam_eatout",
        space: "family" as SpaceKey,
        name: "Eating Out",
        cadence: "monthly" as const,
        color: "#f43f5e",
        icon: "utensils",
    },
    {
        key: "fam_entertainment",
        space: "family" as SpaceKey,
        name: "Entertainment",
        cadence: "monthly" as const,
        color: "#a855f7",
        icon: "film",
    },
    {
        key: "fam_healthcare",
        space: "family" as SpaceKey,
        name: "Healthcare",
        cadence: "monthly" as const,
        color: "#10b981",
        icon: "heart-pulse",
    },
    {
        key: "fam_gifts",
        space: "family" as SpaceKey,
        name: "Gifts & Occasions",
        cadence: "none" as const,
        color: "#eab308",
        icon: "gift",
    },
    {
        key: "fam_kids",
        space: "family" as SpaceKey,
        name: "Kids & Education",
        cadence: "monthly" as const,
        color: "#f472b6",
        icon: "baby",
    },
    {
        key: "fam_home",
        space: "family" as SpaceKey,
        name: "Home Maintenance",
        cadence: "monthly" as const,
        color: "#92400e",
        icon: "hammer",
    },
    {
        key: "fam_pets",
        space: "family" as SpaceKey,
        name: "Pets",
        cadence: "monthly" as const,
        color: "#fb923c",
        icon: "paw-print",
    },
    {
        key: "fam_clothing",
        space: "family" as SpaceKey,
        name: "Clothing",
        cadence: "monthly" as const,
        color: "#ec4899",
        icon: "shirt",
    },

    // Personal
    {
        key: "per_subs",
        space: "personal" as SpaceKey,
        name: "Subscriptions",
        cadence: "monthly" as const,
        color: "#6366f1",
        icon: "rss",
    },
    {
        key: "per_selfcare",
        space: "personal" as SpaceKey,
        name: "Self Care",
        cadence: "monthly" as const,
        color: "#14b8a6",
        icon: "sparkles",
    },
    {
        key: "per_hobbies",
        space: "personal" as SpaceKey,
        name: "Hobbies",
        cadence: "monthly" as const,
        color: "#f97316",
        icon: "camera",
    },
    {
        key: "per_reading",
        space: "personal" as SpaceKey,
        name: "Books & Learning",
        cadence: "none" as const,
        color: "#0891b2",
        icon: "book-open",
    },
    {
        key: "per_coffee",
        space: "personal" as SpaceKey,
        name: "Coffee",
        cadence: "monthly" as const,
        color: "#92400e",
        icon: "coffee",
    },
    {
        key: "per_fitness",
        space: "personal" as SpaceKey,
        name: "Fitness",
        cadence: "monthly" as const,
        color: "#dc2626",
        icon: "dumbbell",
    },
    {
        key: "per_tech",
        space: "personal" as SpaceKey,
        name: "Tech & Gadgets",
        cadence: "monthly" as const,
        color: "#6366f1",
        icon: "laptop",
    },

    // Roommates
    {
        key: "room_groceries",
        space: "roommates" as SpaceKey,
        name: "Shared Groceries",
        cadence: "monthly" as const,
        color: "#22c55e",
        icon: "shopping-basket",
    },
    {
        key: "room_utilities",
        space: "roommates" as SpaceKey,
        name: "Utilities",
        cadence: "monthly" as const,
        color: "#0ea5e9",
        icon: "plug",
    },
    {
        key: "room_cleaning",
        space: "roommates" as SpaceKey,
        name: "Cleaning",
        cadence: "monthly" as const,
        color: "#a855f7",
        icon: "spray-can",
    },
    {
        key: "room_supplies",
        space: "roommates" as SpaceKey,
        name: "Household Supplies",
        cadence: "none" as const,
        color: "#64748b",
        icon: "box",
    },
    {
        key: "room_enter",
        space: "roommates" as SpaceKey,
        name: "House Fun",
        cadence: "monthly" as const,
        color: "#f43f5e",
        icon: "party-popper",
    },

    // Side Business
    {
        key: "biz_saas",
        space: "side" as SpaceKey,
        name: "Software & SaaS",
        cadence: "monthly" as const,
        color: "#0891b2",
        icon: "server",
    },
    {
        key: "biz_office",
        space: "side" as SpaceKey,
        name: "Office & Supplies",
        cadence: "monthly" as const,
        color: "#64748b",
        icon: "package",
    },
    {
        key: "biz_marketing",
        space: "side" as SpaceKey,
        name: "Marketing",
        cadence: "monthly" as const,
        color: "#ef4444",
        icon: "megaphone",
    },
    {
        key: "biz_travel",
        space: "side" as SpaceKey,
        name: "Business Travel",
        cadence: "none" as const,
        color: "#f59e0b",
        icon: "plane-takeoff",
    },
    {
        key: "biz_pros",
        space: "side" as SpaceKey,
        name: "Professional Services",
        cadence: "monthly" as const,
        color: "#a855f7",
        icon: "scale",
    },

    // Travel
    {
        key: "tr_flights",
        space: "travel" as SpaceKey,
        name: "Flights",
        cadence: "none" as const,
        color: "#6366f1",
        icon: "plane",
    },
    {
        key: "tr_lodging",
        space: "travel" as SpaceKey,
        name: "Accommodation",
        cadence: "none" as const,
        color: "#8b5cf6",
        icon: "bed",
    },
    {
        key: "tr_dining",
        space: "travel" as SpaceKey,
        name: "Dining Abroad",
        cadence: "none" as const,
        color: "#f43f5e",
        icon: "utensils",
    },
    {
        key: "tr_activity",
        space: "travel" as SpaceKey,
        name: "Activities",
        cadence: "none" as const,
        color: "#22c55e",
        icon: "mountain",
    },
    {
        key: "tr_transit",
        space: "travel" as SpaceKey,
        name: "Transit Abroad",
        cadence: "none" as const,
        color: "#0ea5e9",
        icon: "train",
    },

    // Goals — rolling envelopes with a target. Same envelope ledger as
    // every other row; the UI treats them as goal cards because they
    // carry a `target_amount`.
    {
        key: "goal_house",
        space: "family" as SpaceKey,
        name: "House Down Payment",
        cadence: "none" as const,
        color: "#6366f1",
        icon: "home",
        target: 80000,
        target_months_out: 30,
        description: "20% down for a 3-bedroom; target horizon ~2.5 years.",
    },
    {
        key: "goal_emergency",
        space: "family" as SpaceKey,
        name: "Emergency Fund",
        cadence: "none" as const,
        color: "#14b8a6",
        icon: "shield-alert",
        target: 24000,
        target_months_out: null,
        description: "6 months of essential expenses, kept liquid.",
    },
    {
        key: "goal_vacation",
        space: "family" as SpaceKey,
        name: "Annual Vacation",
        cadence: "none" as const,
        color: "#f59e0b",
        icon: "plane",
        target: 7500,
        target_months_out: 6,
        description: "10-day international trip for the whole family.",
    },
    {
        key: "goal_laptop",
        space: "personal" as SpaceKey,
        name: "New Laptop",
        cadence: "none" as const,
        color: "#0ea5e9",
        icon: "laptop",
        target: 3000,
        target_months_out: 3,
        description: "Upgrading from a 5-year-old machine.",
    },
] as const;

// Priority tier per envelope. Categories created under these envelopes
// inherit via the NULL-walks-up-to-parent rule; tagging at the envelope's
// root category is the simplest way to seed a coherent default. The
// seed assigns this tier to each envelope's auto-created "root" category
// so leaf categories inherit it without explicit per-leaf overrides.
const ENVELOPE_PRIORITY: Record<string, Priority> = {
    fam_groceries: "essential",
    fam_rent: "essential",
    fam_utilities: "essential",
    fam_transport: "essential",
    fam_eatout: "discretionary",
    fam_entertainment: "discretionary",
    fam_healthcare: "important",
    fam_gifts: "discretionary",
    fam_kids: "essential",
    fam_home: "important",
    fam_pets: "important",
    fam_clothing: "discretionary",
    per_subs: "discretionary",
    per_selfcare: "important",
    per_hobbies: "discretionary",
    per_reading: "discretionary",
    per_coffee: "discretionary",
    per_fitness: "important",
    per_tech: "luxury",
    room_groceries: "essential",
    room_utilities: "essential",
    room_cleaning: "important",
    room_supplies: "important",
    room_enter: "discretionary",
    biz_saas: "essential",
    biz_office: "important",
    biz_marketing: "important",
    biz_travel: "discretionary",
    biz_pros: "important",
    tr_flights: "essential",
    tr_lodging: "essential",
    tr_dining: "discretionary",
    tr_activity: "discretionary",
    tr_transit: "essential",
};

type EnvelopeKey = (typeof ENVELOPES)[number]["key"];

// Categories
type CategorySeed = {
    key: string;
    space: SpaceKey;
    name: string;
    envelope: EnvelopeKey;
    parent?: string;
    color: string;
    icon: string;
};

const CATEGORIES: CategorySeed[] = [
    // --- Family: Food / Groceries
    {
        key: "c_food",
        space: "family",
        name: "Food",
        envelope: "fam_groceries",
        color: "#22c55e",
        icon: "shopping-cart",
    },
    {
        key: "c_food_veg",
        space: "family",
        name: "Produce",
        envelope: "fam_groceries",
        parent: "c_food",
        color: "#16a34a",
        icon: "leaf",
    },
    {
        key: "c_food_meat",
        space: "family",
        name: "Meat & Fish",
        envelope: "fam_groceries",
        parent: "c_food",
        color: "#dc2626",
        icon: "fish",
    },
    {
        key: "c_food_dairy",
        space: "family",
        name: "Dairy & Bakery",
        envelope: "fam_groceries",
        parent: "c_food",
        color: "#f59e0b",
        icon: "milk",
    },
    {
        key: "c_food_staples",
        space: "family",
        name: "Pantry Staples",
        envelope: "fam_groceries",
        parent: "c_food",
        color: "#92400e",
        icon: "wheat",
    },
    {
        key: "c_food_snacks",
        space: "family",
        name: "Snacks & Drinks",
        envelope: "fam_groceries",
        parent: "c_food",
        color: "#eab308",
        icon: "cookie",
    },
    {
        key: "c_food_frozen",
        space: "family",
        name: "Frozen Foods",
        envelope: "fam_groceries",
        parent: "c_food",
        color: "#06b6d4",
        icon: "snowflake",
    },

    // Family: Eating Out
    {
        key: "c_rest",
        space: "family",
        name: "Restaurants",
        envelope: "fam_eatout",
        color: "#f43f5e",
        icon: "utensils",
    },
    {
        key: "c_rest_fine",
        space: "family",
        name: "Fine Dining",
        envelope: "fam_eatout",
        parent: "c_rest",
        color: "#be123c",
        icon: "wine",
    },
    {
        key: "c_rest_casual",
        space: "family",
        name: "Casual Dining",
        envelope: "fam_eatout",
        parent: "c_rest",
        color: "#e11d48",
        icon: "pizza",
    },
    {
        key: "c_rest_quick",
        space: "family",
        name: "Quick Bites",
        envelope: "fam_eatout",
        parent: "c_rest",
        color: "#f97316",
        icon: "sandwich",
    },
    {
        key: "c_rest_delivery",
        space: "family",
        name: "Delivery",
        envelope: "fam_eatout",
        parent: "c_rest",
        color: "#ea580c",
        icon: "bike",
    },
    {
        key: "c_rest_bar",
        space: "family",
        name: "Bars & Pubs",
        envelope: "fam_eatout",
        parent: "c_rest",
        color: "#9333ea",
        icon: "beer",
    },

    // Family: Housing / Rent
    {
        key: "c_housing",
        space: "family",
        name: "Housing",
        envelope: "fam_rent",
        color: "#ef4444",
        icon: "home",
    },
    {
        key: "c_housing_rent",
        space: "family",
        name: "Rent",
        envelope: "fam_rent",
        parent: "c_housing",
        color: "#dc2626",
        icon: "key",
    },
    {
        key: "c_housing_ins",
        space: "family",
        name: "Renters Insurance",
        envelope: "fam_rent",
        parent: "c_housing",
        color: "#b91c1c",
        icon: "shield",
    },

    // Family: Utilities
    {
        key: "c_util",
        space: "family",
        name: "Utilities",
        envelope: "fam_utilities",
        color: "#0ea5e9",
        icon: "zap",
    },
    {
        key: "c_util_elec",
        space: "family",
        name: "Electricity",
        envelope: "fam_utilities",
        parent: "c_util",
        color: "#eab308",
        icon: "zap",
    },
    {
        key: "c_util_water",
        space: "family",
        name: "Water",
        envelope: "fam_utilities",
        parent: "c_util",
        color: "#06b6d4",
        icon: "droplet",
    },
    {
        key: "c_util_gas",
        space: "family",
        name: "Gas",
        envelope: "fam_utilities",
        parent: "c_util",
        color: "#f97316",
        icon: "flame",
    },
    {
        key: "c_util_net",
        space: "family",
        name: "Internet",
        envelope: "fam_utilities",
        parent: "c_util",
        color: "#6366f1",
        icon: "wifi",
    },
    {
        key: "c_util_mob",
        space: "family",
        name: "Mobile",
        envelope: "fam_utilities",
        parent: "c_util",
        color: "#a855f7",
        icon: "smartphone",
    },
    {
        key: "c_util_trash",
        space: "family",
        name: "Trash & Recycling",
        envelope: "fam_utilities",
        parent: "c_util",
        color: "#64748b",
        icon: "trash-2",
    },
    {
        key: "c_bank_fees",
        space: "family",
        name: "Bank & ATM Fees",
        envelope: "fam_utilities",
        parent: "c_util",
        color: "#94a3b8",
        icon: "banknote",
    },

    // Family: Transport
    {
        key: "c_trans",
        space: "family",
        name: "Transport",
        envelope: "fam_transport",
        color: "#f59e0b",
        icon: "car",
    },
    {
        key: "c_trans_ride",
        space: "family",
        name: "Rideshare",
        envelope: "fam_transport",
        parent: "c_trans",
        color: "#111827",
        icon: "car",
    },
    {
        key: "c_trans_taxi",
        space: "family",
        name: "Taxi",
        envelope: "fam_transport",
        parent: "c_trans",
        color: "#16a34a",
        icon: "car-front",
    },
    {
        key: "c_trans_fuel",
        space: "family",
        name: "Fuel",
        envelope: "fam_transport",
        parent: "c_trans",
        color: "#dc2626",
        icon: "fuel",
    },
    {
        key: "c_trans_transit",
        space: "family",
        name: "Public Transit",
        envelope: "fam_transport",
        parent: "c_trans",
        color: "#0891b2",
        icon: "bus",
    },
    {
        key: "c_trans_parking",
        space: "family",
        name: "Parking & Tolls",
        envelope: "fam_transport",
        parent: "c_trans",
        color: "#6b7280",
        icon: "parking-square",
    },
    {
        key: "c_trans_service",
        space: "family",
        name: "Car Service",
        envelope: "fam_transport",
        parent: "c_trans",
        color: "#b45309",
        icon: "wrench",
    },

    // Family: Entertainment
    {
        key: "c_ent",
        space: "family",
        name: "Entertainment",
        envelope: "fam_entertainment",
        color: "#a855f7",
        icon: "film",
    },
    {
        key: "c_ent_movies",
        space: "family",
        name: "Movies",
        envelope: "fam_entertainment",
        parent: "c_ent",
        color: "#8b5cf6",
        icon: "clapperboard",
    },
    {
        key: "c_ent_stream",
        space: "family",
        name: "Streaming",
        envelope: "fam_entertainment",
        parent: "c_ent",
        color: "#ec4899",
        icon: "tv",
    },
    {
        key: "c_ent_games",
        space: "family",
        name: "Games",
        envelope: "fam_entertainment",
        parent: "c_ent",
        color: "#6366f1",
        icon: "gamepad-2",
    },
    {
        key: "c_ent_live",
        space: "family",
        name: "Concerts & Events",
        envelope: "fam_entertainment",
        parent: "c_ent",
        color: "#d946ef",
        icon: "music",
    },
    {
        key: "c_ent_museum",
        space: "family",
        name: "Museums & Culture",
        envelope: "fam_entertainment",
        parent: "c_ent",
        color: "#7c3aed",
        icon: "landmark",
    },

    // Family: Healthcare
    {
        key: "c_health",
        space: "family",
        name: "Health",
        envelope: "fam_healthcare",
        color: "#10b981",
        icon: "heart-pulse",
    },
    {
        key: "c_health_ph",
        space: "family",
        name: "Pharmacy",
        envelope: "fam_healthcare",
        parent: "c_health",
        color: "#059669",
        icon: "pill",
    },
    {
        key: "c_health_dr",
        space: "family",
        name: "Doctor",
        envelope: "fam_healthcare",
        parent: "c_health",
        color: "#0891b2",
        icon: "stethoscope",
    },
    {
        key: "c_health_lab",
        space: "family",
        name: "Lab & Tests",
        envelope: "fam_healthcare",
        parent: "c_health",
        color: "#6366f1",
        icon: "test-tube",
    },
    {
        key: "c_health_dent",
        space: "family",
        name: "Dental",
        envelope: "fam_healthcare",
        parent: "c_health",
        color: "#14b8a6",
        icon: "smile",
    },
    {
        key: "c_health_eye",
        space: "family",
        name: "Vision",
        envelope: "fam_healthcare",
        parent: "c_health",
        color: "#3b82f6",
        icon: "eye",
    },
    {
        key: "c_health_ther",
        space: "family",
        name: "Therapy",
        envelope: "fam_healthcare",
        parent: "c_health",
        color: "#a78bfa",
        icon: "heart",
    },

    // Family: Gifts
    {
        key: "c_gifts",
        space: "family",
        name: "Gifts",
        envelope: "fam_gifts",
        color: "#eab308",
        icon: "gift",
    },
    {
        key: "c_gifts_bday",
        space: "family",
        name: "Birthdays",
        envelope: "fam_gifts",
        parent: "c_gifts",
        color: "#f59e0b",
        icon: "cake",
    },
    {
        key: "c_gifts_wed",
        space: "family",
        name: "Weddings",
        envelope: "fam_gifts",
        parent: "c_gifts",
        color: "#f43f5e",
        icon: "heart",
    },
    {
        key: "c_gifts_hol",
        space: "family",
        name: "Holidays",
        envelope: "fam_gifts",
        parent: "c_gifts",
        color: "#22c55e",
        icon: "sparkles",
    },
    {
        key: "c_gifts_baby",
        space: "family",
        name: "Baby Shower",
        envelope: "fam_gifts",
        parent: "c_gifts",
        color: "#f472b6",
        icon: "baby",
    },
    {
        key: "c_gifts_charity",
        space: "family",
        name: "Charity",
        envelope: "fam_gifts",
        parent: "c_gifts",
        color: "#10b981",
        icon: "heart-handshake",
    },

    // Family: Kids & Education
    {
        key: "c_kids",
        space: "family",
        name: "Kids & Education",
        envelope: "fam_kids",
        color: "#f472b6",
        icon: "baby",
    },
    {
        key: "c_kids_school",
        space: "family",
        name: "School",
        envelope: "fam_kids",
        parent: "c_kids",
        color: "#ec4899",
        icon: "backpack",
    },
    {
        key: "c_kids_act",
        space: "family",
        name: "Activities",
        envelope: "fam_kids",
        parent: "c_kids",
        color: "#8b5cf6",
        icon: "trophy",
    },
    {
        key: "c_kids_toys",
        space: "family",
        name: "Toys & Games",
        envelope: "fam_kids",
        parent: "c_kids",
        color: "#f59e0b",
        icon: "puzzle",
    },
    {
        key: "c_kids_care",
        space: "family",
        name: "Childcare",
        envelope: "fam_kids",
        parent: "c_kids",
        color: "#14b8a6",
        icon: "heart-handshake",
    },

    // Family: Home Maintenance
    {
        key: "c_home",
        space: "family",
        name: "Home Maintenance",
        envelope: "fam_home",
        color: "#92400e",
        icon: "hammer",
    },
    {
        key: "c_home_repair",
        space: "family",
        name: "Repairs",
        envelope: "fam_home",
        parent: "c_home",
        color: "#b45309",
        icon: "wrench",
    },
    {
        key: "c_home_garden",
        space: "family",
        name: "Garden & Plants",
        envelope: "fam_home",
        parent: "c_home",
        color: "#22c55e",
        icon: "sprout",
    },
    {
        key: "c_home_decor",
        space: "family",
        name: "Decor",
        envelope: "fam_home",
        parent: "c_home",
        color: "#a855f7",
        icon: "paintbrush",
    },
    {
        key: "c_home_appl",
        space: "family",
        name: "Appliances",
        envelope: "fam_home",
        parent: "c_home",
        color: "#0ea5e9",
        icon: "refrigerator",
    },

    // Family: Pets
    {
        key: "c_pet",
        space: "family",
        name: "Pets",
        envelope: "fam_pets",
        color: "#fb923c",
        icon: "paw-print",
    },
    {
        key: "c_pet_food",
        space: "family",
        name: "Pet Food",
        envelope: "fam_pets",
        parent: "c_pet",
        color: "#c2410c",
        icon: "bone",
    },
    {
        key: "c_pet_vet",
        space: "family",
        name: "Vet",
        envelope: "fam_pets",
        parent: "c_pet",
        color: "#dc2626",
        icon: "heart-pulse",
    },
    {
        key: "c_pet_sup",
        space: "family",
        name: "Supplies",
        envelope: "fam_pets",
        parent: "c_pet",
        color: "#f59e0b",
        icon: "box",
    },
    {
        key: "c_pet_groom",
        space: "family",
        name: "Grooming",
        envelope: "fam_pets",
        parent: "c_pet",
        color: "#ec4899",
        icon: "scissors",
    },

    // Family: Clothing
    {
        key: "c_cloth",
        space: "family",
        name: "Clothing",
        envelope: "fam_clothing",
        color: "#ec4899",
        icon: "shirt",
    },
    {
        key: "c_cloth_work",
        space: "family",
        name: "Workwear",
        envelope: "fam_clothing",
        parent: "c_cloth",
        color: "#475569",
        icon: "shirt",
    },
    {
        key: "c_cloth_cas",
        space: "family",
        name: "Casual",
        envelope: "fam_clothing",
        parent: "c_cloth",
        color: "#f472b6",
        icon: "shopping-bag",
    },
    {
        key: "c_cloth_shoe",
        space: "family",
        name: "Shoes",
        envelope: "fam_clothing",
        parent: "c_cloth",
        color: "#7c3aed",
        icon: "footprints",
    },
    {
        key: "c_cloth_acc",
        space: "family",
        name: "Accessories",
        envelope: "fam_clothing",
        parent: "c_cloth",
        color: "#d946ef",
        icon: "watch",
    },

    // Personal: Subscriptions
    {
        key: "c_subs",
        space: "personal",
        name: "Subscriptions",
        envelope: "per_subs",
        color: "#6366f1",
        icon: "rss",
    },
    {
        key: "c_subs_video",
        space: "personal",
        name: "Video",
        envelope: "per_subs",
        parent: "c_subs",
        color: "#ef4444",
        icon: "tv",
    },
    {
        key: "c_subs_music",
        space: "personal",
        name: "Music",
        envelope: "per_subs",
        parent: "c_subs",
        color: "#10b981",
        icon: "music",
    },
    {
        key: "c_subs_cloud",
        space: "personal",
        name: "Cloud Storage",
        envelope: "per_subs",
        parent: "c_subs",
        color: "#0ea5e9",
        icon: "cloud",
    },
    {
        key: "c_subs_dev",
        space: "personal",
        name: "Dev & Infra",
        envelope: "per_subs",
        parent: "c_subs",
        color: "#a855f7",
        icon: "server",
    },
    {
        key: "c_subs_news",
        space: "personal",
        name: "News & Magazines",
        envelope: "per_subs",
        parent: "c_subs",
        color: "#f59e0b",
        icon: "newspaper",
    },
    {
        key: "c_subs_ai",
        space: "personal",
        name: "AI Tools",
        envelope: "per_subs",
        parent: "c_subs",
        color: "#8b5cf6",
        icon: "brain",
    },

    // Personal: Self Care
    {
        key: "c_self",
        space: "personal",
        name: "Self Care",
        envelope: "per_selfcare",
        color: "#14b8a6",
        icon: "sparkles",
    },
    {
        key: "c_self_hair",
        space: "personal",
        name: "Haircut",
        envelope: "per_selfcare",
        parent: "c_self",
        color: "#f59e0b",
        icon: "scissors",
    },
    {
        key: "c_self_skin",
        space: "personal",
        name: "Skincare",
        envelope: "per_selfcare",
        parent: "c_self",
        color: "#ec4899",
        icon: "flask-conical",
    },
    {
        key: "c_self_spa",
        space: "personal",
        name: "Spa & Massage",
        envelope: "per_selfcare",
        parent: "c_self",
        color: "#a78bfa",
        icon: "flower",
    },

    // Personal: Fitness
    {
        key: "c_fit",
        space: "personal",
        name: "Fitness",
        envelope: "per_fitness",
        color: "#dc2626",
        icon: "dumbbell",
    },
    {
        key: "c_fit_gym",
        space: "personal",
        name: "Gym",
        envelope: "per_fitness",
        parent: "c_fit",
        color: "#991b1b",
        icon: "dumbbell",
    },
    {
        key: "c_fit_class",
        space: "personal",
        name: "Classes",
        envelope: "per_fitness",
        parent: "c_fit",
        color: "#f43f5e",
        icon: "activity",
    },
    {
        key: "c_fit_gear",
        space: "personal",
        name: "Gear",
        envelope: "per_fitness",
        parent: "c_fit",
        color: "#fb7185",
        icon: "shirt",
    },

    // Personal: Hobbies
    {
        key: "c_hob",
        space: "personal",
        name: "Hobbies",
        envelope: "per_hobbies",
        color: "#f97316",
        icon: "camera",
    },
    {
        key: "c_hob_photo",
        space: "personal",
        name: "Photography",
        envelope: "per_hobbies",
        parent: "c_hob",
        color: "#0ea5e9",
        icon: "camera",
    },
    {
        key: "c_hob_tools",
        space: "personal",
        name: "Dev Tools",
        envelope: "per_hobbies",
        parent: "c_hob",
        color: "#6366f1",
        icon: "wrench",
    },
    {
        key: "c_hob_music",
        space: "personal",
        name: "Music & Audio",
        envelope: "per_hobbies",
        parent: "c_hob",
        color: "#a855f7",
        icon: "music",
    },
    {
        key: "c_hob_craft",
        space: "personal",
        name: "Crafts",
        envelope: "per_hobbies",
        parent: "c_hob",
        color: "#ef4444",
        icon: "paintbrush",
    },
    {
        key: "c_hob_board",
        space: "personal",
        name: "Board Games",
        envelope: "per_hobbies",
        parent: "c_hob",
        color: "#0891b2",
        icon: "dice-5",
    },

    // Personal: Books / Coffee / Tech
    {
        key: "c_read",
        space: "personal",
        name: "Books & Courses",
        envelope: "per_reading",
        color: "#0891b2",
        icon: "book-open",
    },
    {
        key: "c_coffee",
        space: "personal",
        name: "Coffee",
        envelope: "per_coffee",
        color: "#92400e",
        icon: "coffee",
    },
    {
        key: "c_tech",
        space: "personal",
        name: "Tech & Gadgets",
        envelope: "per_tech",
        color: "#6366f1",
        icon: "laptop",
    },
    {
        key: "c_tech_acc",
        space: "personal",
        name: "Accessories",
        envelope: "per_tech",
        parent: "c_tech",
        color: "#4f46e5",
        icon: "mouse-pointer",
    },
    {
        key: "c_tech_dev",
        space: "personal",
        name: "Devices",
        envelope: "per_tech",
        parent: "c_tech",
        color: "#3730a3",
        icon: "smartphone",
    },
    {
        key: "c_crypto_fees",
        space: "personal",
        name: "Crypto Fees",
        envelope: "per_tech",
        color: "#ca8a04",
        icon: "coins",
    },

    // Roommates
    {
        key: "c_rm_gro",
        space: "roommates",
        name: "Groceries",
        envelope: "room_groceries",
        color: "#22c55e",
        icon: "shopping-basket",
    },
    {
        key: "c_rm_gro_prod",
        space: "roommates",
        name: "Produce",
        envelope: "room_groceries",
        parent: "c_rm_gro",
        color: "#16a34a",
        icon: "leaf",
    },
    {
        key: "c_rm_gro_sta",
        space: "roommates",
        name: "Pantry",
        envelope: "room_groceries",
        parent: "c_rm_gro",
        color: "#92400e",
        icon: "wheat",
    },
    {
        key: "c_rm_gro_drink",
        space: "roommates",
        name: "Drinks",
        envelope: "room_groceries",
        parent: "c_rm_gro",
        color: "#0891b2",
        icon: "glass-water",
    },

    {
        key: "c_rm_util",
        space: "roommates",
        name: "Utilities",
        envelope: "room_utilities",
        color: "#0ea5e9",
        icon: "plug",
    },
    {
        key: "c_rm_util_wifi",
        space: "roommates",
        name: "Internet",
        envelope: "room_utilities",
        parent: "c_rm_util",
        color: "#6366f1",
        icon: "wifi",
    },
    {
        key: "c_rm_util_elec",
        space: "roommates",
        name: "Electricity",
        envelope: "room_utilities",
        parent: "c_rm_util",
        color: "#eab308",
        icon: "zap",
    },
    {
        key: "c_rm_util_water",
        space: "roommates",
        name: "Water",
        envelope: "room_utilities",
        parent: "c_rm_util",
        color: "#06b6d4",
        icon: "droplet",
    },

    {
        key: "c_rm_clean",
        space: "roommates",
        name: "Cleaning",
        envelope: "room_cleaning",
        color: "#a855f7",
        icon: "spray-can",
    },
    {
        key: "c_rm_clean_det",
        space: "roommates",
        name: "Supplies",
        envelope: "room_cleaning",
        parent: "c_rm_clean",
        color: "#8b5cf6",
        icon: "droplet",
    },
    {
        key: "c_rm_clean_srv",
        space: "roommates",
        name: "Cleaning Service",
        envelope: "room_cleaning",
        parent: "c_rm_clean",
        color: "#ec4899",
        icon: "broom",
    },

    {
        key: "c_rm_sup",
        space: "roommates",
        name: "Misc Supplies",
        envelope: "room_supplies",
        color: "#64748b",
        icon: "box",
    },
    {
        key: "c_rm_enter",
        space: "roommates",
        name: "House Fun",
        envelope: "room_enter",
        color: "#f43f5e",
        icon: "party-popper",
    },
    {
        key: "c_rm_enter_bar",
        space: "roommates",
        name: "Drinks Night",
        envelope: "room_enter",
        parent: "c_rm_enter",
        color: "#d946ef",
        icon: "beer",
    },
    {
        key: "c_rm_enter_gm",
        space: "roommates",
        name: "Game Nights",
        envelope: "room_enter",
        parent: "c_rm_enter",
        color: "#a855f7",
        icon: "gamepad-2",
    },

    // Side Business
    {
        key: "c_bsaas",
        space: "side",
        name: "Software & SaaS",
        envelope: "biz_saas",
        color: "#0891b2",
        icon: "server",
    },
    {
        key: "c_bsaas_host",
        space: "side",
        name: "Hosting",
        envelope: "biz_saas",
        parent: "c_bsaas",
        color: "#0c4a6e",
        icon: "cloud",
    },
    {
        key: "c_bsaas_dom",
        space: "side",
        name: "Domains",
        envelope: "biz_saas",
        parent: "c_bsaas",
        color: "#0369a1",
        icon: "globe",
    },
    {
        key: "c_bsaas_tool",
        space: "side",
        name: "Developer Tools",
        envelope: "biz_saas",
        parent: "c_bsaas",
        color: "#0284c7",
        icon: "wrench",
    },
    {
        key: "c_bsaas_api",
        space: "side",
        name: "Third-Party APIs",
        envelope: "biz_saas",
        parent: "c_bsaas",
        color: "#3b82f6",
        icon: "plug",
    },

    {
        key: "c_bofc",
        space: "side",
        name: "Office & Supplies",
        envelope: "biz_office",
        color: "#64748b",
        icon: "package",
    },
    {
        key: "c_bofc_sup",
        space: "side",
        name: "Supplies",
        envelope: "biz_office",
        parent: "c_bofc",
        color: "#475569",
        icon: "pencil",
    },
    {
        key: "c_bofc_equip",
        space: "side",
        name: "Equipment",
        envelope: "biz_office",
        parent: "c_bofc",
        color: "#334155",
        icon: "laptop",
    },

    {
        key: "c_bmkt",
        space: "side",
        name: "Marketing",
        envelope: "biz_marketing",
        color: "#ef4444",
        icon: "megaphone",
    },
    {
        key: "c_bmkt_ads",
        space: "side",
        name: "Paid Ads",
        envelope: "biz_marketing",
        parent: "c_bmkt",
        color: "#b91c1c",
        icon: "target",
    },
    {
        key: "c_bmkt_brand",
        space: "side",
        name: "Branding",
        envelope: "biz_marketing",
        parent: "c_bmkt",
        color: "#f59e0b",
        icon: "palette",
    },

    {
        key: "c_btrv",
        space: "side",
        name: "Business Travel",
        envelope: "biz_travel",
        color: "#f59e0b",
        icon: "plane-takeoff",
    },
    {
        key: "c_btrv_flt",
        space: "side",
        name: "Flights",
        envelope: "biz_travel",
        parent: "c_btrv",
        color: "#f97316",
        icon: "plane",
    },
    {
        key: "c_btrv_hotel",
        space: "side",
        name: "Lodging",
        envelope: "biz_travel",
        parent: "c_btrv",
        color: "#d97706",
        icon: "bed",
    },
    {
        key: "c_btrv_meals",
        space: "side",
        name: "Meals",
        envelope: "biz_travel",
        parent: "c_btrv",
        color: "#b45309",
        icon: "utensils",
    },

    {
        key: "c_bpro",
        space: "side",
        name: "Professional Services",
        envelope: "biz_pros",
        color: "#a855f7",
        icon: "scale",
    },
    {
        key: "c_bpro_acct",
        space: "side",
        name: "Accounting",
        envelope: "biz_pros",
        parent: "c_bpro",
        color: "#9333ea",
        icon: "calculator",
    },
    {
        key: "c_bpro_legal",
        space: "side",
        name: "Legal",
        envelope: "biz_pros",
        parent: "c_bpro",
        color: "#7e22ce",
        icon: "gavel",
    },
    {
        key: "c_bpro_ctr",
        space: "side",
        name: "Contractors",
        envelope: "biz_pros",
        parent: "c_bpro",
        color: "#6b21a8",
        icon: "user-round",
    },

    // Travel
    {
        key: "c_tr_flt",
        space: "travel",
        name: "Flights",
        envelope: "tr_flights",
        color: "#6366f1",
        icon: "plane",
    },
    {
        key: "c_tr_flt_econ",
        space: "travel",
        name: "Economy",
        envelope: "tr_flights",
        parent: "c_tr_flt",
        color: "#4f46e5",
        icon: "plane",
    },
    {
        key: "c_tr_flt_biz",
        space: "travel",
        name: "Business Class",
        envelope: "tr_flights",
        parent: "c_tr_flt",
        color: "#3730a3",
        icon: "plane",
    },
    {
        key: "c_tr_flt_bag",
        space: "travel",
        name: "Baggage Fees",
        envelope: "tr_flights",
        parent: "c_tr_flt",
        color: "#312e81",
        icon: "luggage",
    },

    {
        key: "c_tr_lodge",
        space: "travel",
        name: "Lodging",
        envelope: "tr_lodging",
        color: "#8b5cf6",
        icon: "bed",
    },
    {
        key: "c_tr_lodge_htl",
        space: "travel",
        name: "Hotels",
        envelope: "tr_lodging",
        parent: "c_tr_lodge",
        color: "#7c3aed",
        icon: "bed",
    },
    {
        key: "c_tr_lodge_bnb",
        space: "travel",
        name: "Short-term Rental",
        envelope: "tr_lodging",
        parent: "c_tr_lodge",
        color: "#6d28d9",
        icon: "home",
    },
    {
        key: "c_tr_lodge_hst",
        space: "travel",
        name: "Hostels",
        envelope: "tr_lodging",
        parent: "c_tr_lodge",
        color: "#5b21b6",
        icon: "users",
    },

    {
        key: "c_tr_din",
        space: "travel",
        name: "Dining Abroad",
        envelope: "tr_dining",
        color: "#f43f5e",
        icon: "utensils",
    },
    {
        key: "c_tr_din_rest",
        space: "travel",
        name: "Restaurants",
        envelope: "tr_dining",
        parent: "c_tr_din",
        color: "#e11d48",
        icon: "wine",
    },
    {
        key: "c_tr_din_street",
        space: "travel",
        name: "Street Food",
        envelope: "tr_dining",
        parent: "c_tr_din",
        color: "#be123c",
        icon: "utensils",
    },
    {
        key: "c_tr_din_cafe",
        space: "travel",
        name: "Cafés & Coffee",
        envelope: "tr_dining",
        parent: "c_tr_din",
        color: "#9f1239",
        icon: "coffee",
    },

    {
        key: "c_tr_act",
        space: "travel",
        name: "Activities",
        envelope: "tr_activity",
        color: "#22c55e",
        icon: "mountain",
    },
    {
        key: "c_tr_act_tour",
        space: "travel",
        name: "Tours",
        envelope: "tr_activity",
        parent: "c_tr_act",
        color: "#16a34a",
        icon: "map",
    },
    {
        key: "c_tr_act_adv",
        space: "travel",
        name: "Adventure",
        envelope: "tr_activity",
        parent: "c_tr_act",
        color: "#15803d",
        icon: "mountain",
    },
    {
        key: "c_tr_act_ent",
        space: "travel",
        name: "Entertainment",
        envelope: "tr_activity",
        parent: "c_tr_act",
        color: "#166534",
        icon: "ticket",
    },

    {
        key: "c_tr_trn",
        space: "travel",
        name: "Transit Abroad",
        envelope: "tr_transit",
        color: "#0ea5e9",
        icon: "train",
    },
    {
        key: "c_tr_trn_local",
        space: "travel",
        name: "Local Transit",
        envelope: "tr_transit",
        parent: "c_tr_trn",
        color: "#0284c7",
        icon: "bus",
    },
    {
        key: "c_tr_trn_rental",
        space: "travel",
        name: "Car Rental",
        envelope: "tr_transit",
        parent: "c_tr_trn",
        color: "#0369a1",
        icon: "car",
    },
    {
        key: "c_tr_trn_rail",
        space: "travel",
        name: "Rail",
        envelope: "tr_transit",
        parent: "c_tr_trn",
        color: "#075985",
        icon: "train",
    },
];

// Events — generic, with dates spread across the 18-month window.
const EVENTS = [
    {
        key: "e_wedding",
        space: "family" as SpaceKey,
        name: "Sibling's Wedding",
        start: daysAgo(510),
        end: daysAgo(507),
        color: "#f43f5e",
        icon: "heart",
        description: "Multi-day wedding celebration for Casey.",
    },
    {
        key: "e_housewarm",
        space: "roommates" as SpaceKey,
        name: "Housewarming",
        start: daysAgo(490),
        end: daysAgo(489),
        color: "#a855f7",
        icon: "party-popper",
        description: "Moved into the new place — invited everyone over.",
    },
    {
        key: "e_ski",
        space: "family" as SpaceKey,
        name: "Ski Weekend",
        start: daysAgo(450),
        end: daysAgo(447),
        color: "#0ea5e9",
        icon: "snowflake",
        description: "Long weekend in the mountains.",
    },
    {
        key: "e_paint",
        space: "family" as SpaceKey,
        name: "Home Repainting",
        start: daysAgo(410),
        end: daysAgo(400),
        color: "#f59e0b",
        icon: "paintbrush",
        description: "Full interior repaint before moving things around.",
    },
    {
        key: "e_conf_spring",
        space: "personal" as SpaceKey,
        name: "Spring Tech Conf",
        start: daysAgo(380),
        end: daysAgo(378),
        color: "#6366f1",
        icon: "presentation",
        description: "Annual tech conference with workshops.",
    },
    {
        key: "e_mom_bday",
        space: "family" as SpaceKey,
        name: "Mom's 60th",
        start: daysAgo(350),
        end: daysAgo(349),
        color: "#eab308",
        icon: "cake",
        description: "Milestone birthday — family gathering.",
    },
    {
        key: "e_anniv1",
        space: "family" as SpaceKey,
        name: "Anniversary Getaway",
        start: daysAgo(330),
        end: daysAgo(328),
        color: "#ec4899",
        icon: "heart",
        description: "Two-night boutique hotel.",
    },
    {
        key: "e_biz_trip1",
        space: "side" as SpaceKey,
        name: "Client Kickoff Trip",
        start: daysAgo(300),
        end: daysAgo(297),
        color: "#0891b2",
        icon: "briefcase",
        description: "Onsite kickoff with a new client.",
    },
    {
        key: "e_summer_trip",
        space: "travel" as SpaceKey,
        name: "Europe Summer Trip",
        start: daysAgo(270),
        end: daysAgo(256),
        color: "#14b8a6",
        icon: "globe",
        description: "Two-week summer trip across three cities.",
    },
    {
        key: "e_beach",
        space: "family" as SpaceKey,
        name: "Beach Weekend",
        start: daysAgo(230),
        end: daysAgo(227),
        color: "#06b6d4",
        icon: "waves",
        description: "Long weekend beach trip.",
    },
    {
        key: "e_launch",
        space: "side" as SpaceKey,
        name: "Product Launch",
        start: daysAgo(210),
        end: daysAgo(205),
        color: "#ef4444",
        icon: "rocket",
        description: "Launch week — ad spend spike and team meals.",
    },
    {
        key: "e_diwali",
        space: "family" as SpaceKey,
        name: "Holiday Festival",
        start: daysAgo(190),
        end: daysAgo(186),
        color: "#f97316",
        icon: "sparkles",
        description: "Multi-day cultural celebration with family.",
    },
    {
        key: "e_baby_shower",
        space: "family" as SpaceKey,
        name: "Baby Shower",
        start: atHour(daysAgo(170), 14),
        end: atHour(daysAgo(170), 20),
        color: "#f472b6",
        icon: "baby",
        description: "Celebrating the newest addition.",
    },
    {
        key: "e_camping",
        space: "family" as SpaceKey,
        name: "Camping Trip",
        start: daysAgo(150),
        end: daysAgo(147),
        color: "#16a34a",
        icon: "tent",
        description: "Weekend away from screens.",
    },
    {
        key: "e_conf_fall",
        space: "personal" as SpaceKey,
        name: "Fall Tech Conf",
        start: daysAgo(130),
        end: daysAgo(128),
        color: "#8b5cf6",
        icon: "presentation",
        description: "Three-day conference with workshops.",
    },
    {
        key: "e_thanksgiving",
        space: "family" as SpaceKey,
        name: "Harvest Dinner",
        start: daysAgo(110),
        end: daysAgo(109),
        color: "#b45309",
        icon: "utensils",
        description: "Big family meal — hosted at home.",
    },
    {
        key: "e_xmas",
        space: "family" as SpaceKey,
        name: "Winter Holidays",
        start: daysAgo(95),
        end: daysAgo(85),
        color: "#dc2626",
        icon: "gift",
        description: "End-of-year holidays — travel + gifts + big meals.",
    },
    {
        key: "e_nye",
        space: "family" as SpaceKey,
        name: "New Year's Eve",
        start: daysAgo(83),
        end: daysAgo(82),
        color: "#eab308",
        icon: "sparkles",
        description: "Party night at home with friends.",
    },
    {
        key: "e_biz_trip2",
        space: "side" as SpaceKey,
        name: "Investor Meetings",
        start: daysAgo(70),
        end: daysAgo(67),
        color: "#6366f1",
        icon: "briefcase",
        description: "Pitch trip to meet investors.",
    },
    {
        key: "e_spring_break",
        space: "family" as SpaceKey,
        name: "Spring Break Trip",
        start: daysAgo(55),
        end: daysAgo(51),
        color: "#22c55e",
        icon: "sun",
        description: "Short warm-weather break with the kids.",
    },
    {
        key: "e_wed_friend",
        space: "family" as SpaceKey,
        name: "Friend's Wedding",
        start: daysAgo(38),
        end: daysAgo(36),
        color: "#f43f5e",
        icon: "heart",
        description: "Destination wedding.",
    },
    {
        key: "e_renov",
        space: "family" as SpaceKey,
        name: "Kitchen Remodel",
        start: daysAgo(30),
        end: daysAgo(15),
        color: "#92400e",
        icon: "hammer",
        description: "Two-week kitchen renovation.",
    },
    {
        key: "e_roomparty",
        space: "roommates" as SpaceKey,
        name: "Roommate Birthday",
        start: atHour(daysAgo(18), 18),
        end: atHour(daysAgo(18), 23),
        color: "#d946ef",
        icon: "cake",
        description: "Hosted Taylor's birthday dinner at the house.",
    },
    {
        key: "e_upcoming_trip",
        space: "travel" as SpaceKey,
        name: "Planned Getaway",
        start: addMonths(startOfMonthUTC(NOW), 2),
        end: new Date(addMonths(startOfMonthUTC(NOW), 2).getTime() + 4 * MS_DAY),
        color: "#0ea5e9",
        icon: "plane",
        description: "Upcoming short trip — bookings already made.",
    },
] as const;

type EventKey = (typeof EVENTS)[number]["key"];

// Realistic vendor name pools, kept generic (invented brands) so the
// data doesn't lean on any real-world business.
const VENDORS = {
    grocery: [
        "Freshline Market",
        "Corner Grocer",
        "Green Fields Co-op",
        "Sunnyside Produce",
        "Everyday Market",
        "Urban Harvest",
        "Neighborhood Grocer",
        "Daily Basket",
        "Pantry & Peel",
    ],
    coffee: [
        "Daily Grind",
        "Bean Haven",
        "Roast Lab",
        "Morning Brew",
        "Corner Cafe",
        "Ember Coffee",
        "North Roasters",
        "Stonewater Cafe",
        "The Kettle",
    ],
    restaurant_fine: [
        "Harbor Bistro",
        "Olive Terrace",
        "Kaito House",
        "Azure Table",
        "Gilded Fork",
        "La Fiamma",
    ],
    restaurant_casual: [
        "Pine & Plate",
        "Sunset Grill",
        "Highland Kitchen",
        "Noodle District",
        "Taco Row",
        "Bread & Pepper",
        "Hearth Diner",
        "The Green Door",
    ],
    restaurant_quick: [
        "Bento Express",
        "Wrap Shack",
        "Quick Bowl",
        "Corner Deli",
        "Sandwich Lab",
        "Brown Bag",
    ],
    delivery: ["QuickBite Delivery", "Orbit Eats", "FoodFlash", "Direct Dish", "Swift Meals"],
    rideshare: ["QuickRide", "CityGo", "HailNow", "FastPool"],
    transit: ["Metro Card", "Transit Pass", "CityRail"],
    fuel: ["Circuit Fuel", "HighwayGo Gas", "PetroLink", "Northern Fuel", "EcoPump"],
    pharmacy: ["Wellspring Pharmacy", "CareDrug", "Downtown Pharmacy", "HealthPlus"],
    doctor: [
        "City Clinic",
        "General Hospital",
        "Downtown Medical",
        "Northshore Family Health",
        "Bayside GP",
    ],
    dental: ["Smile Dental", "Bright Smile Co.", "Sunrise Dentistry"],
    gym: ["Pulse Fitness", "Urban Gym", "Ironworks Fitness", "Studio Flex"],
    hair: ["ShearCraft", "The Barber Room", "Strands Salon", "Trim & Fade"],
    electronics: ["Circuit Direct", "TechNest", "Pixel Works", "BoltByte"],
    home_store: ["Hearth Home", "Build & Bloom", "Four Walls", "Corner Hardware"],
    garden: ["Green Thumb Nursery", "Wilds Garden Co.", "Potted"],
    pet: ["Paws & Whiskers", "Whistle Pets", "Bark Square"],
    clothing: ["Common Thread", "North Loop", "Branch & Ink", "Ember Apparel", "Modish"],
    toys: ["Playmark", "Little Owls", "Giggle Toys"],
    streaming_video: ["Flixhouse", "ScreenPass", "CineCloud"],
    streaming_music: ["Tunewave", "Echolane"],
    cloud_storage: ["Vaultcloud", "Nimbus Drive"],
    ai_tools: ["Corebrain AI", "Lexion", "Draftly"],
    news: ["The Ledger Daily", "Civic Post", "Monocle Briefs"],
    dev_tools: ["CodeKit Pro", "RepoForge", "Buildpath", "DeployDeck"],
    hosting: ["Nimbus Hosting", "Cloudspan", "Stackline"],
    domain: ["NameVault", "Regina Domains"],
    saas: ["Slate Studio", "Quorum HQ", "Rallyboard", "Tabline CRM"],
    bookshop: ["Owl & Ink Books", "Folded Pages", "Chapter House", "Sparrow Bookshop"],
    movies: ["Galaxy Cinema", "Film House", "Vista Theaters"],
    concert: ["Orbit Arena", "Harbor Hall", "Bright Stage"],
    museum: ["City Museum", "Design Center", "Modern Gallery"],
    photo: ["Shutter Supply", "Lens Lab", "Focal Shop"],
    board_game: ["Meeple & Co", "Dice & Draft"],
    craft: ["The Stitch Market", "Makers Row"],
    spa: ["Quiet Spa", "Still Waters", "Rosemary Retreat"],
    hotel: ["Baybreeze Hotel", "Laurel Inn", "Canvas Suites", "Polaris Hotel"],
    airline: ["Orbit Airways", "Meridian Air", "Skylark Airlines"],
    car_rental: ["Compass Cars", "GoDrive"],
    attractions: ["Skyline Tours", "Wildspring Adventures", "Citywalk Tours"],
    taxi_abroad: ["Local Taxi", "City Cab"],
    laundry: ["Suds & Spin Laundromat"],
    daycare: ["Little Acorns Daycare", "Sunbeam Preschool"],
    school: ["Riverton Elementary", "Green Valley Academy"],
    legal: ["Holland & Reeve", "Westlake Legal"],
    accounting: ["Fulcrum Accounting", "Northmark CPA"],
    ads: ["AdGrid", "Reachly", "Spectro Ads"],
    branding: ["Clayworks Studio", "Forma Design"],
    contractor: ["Moonlit Dev Studio", "Sierra Contractor", "Bristol Builders"],
    mechanic: ["Cog & Wrench Auto", "Neighborhood Mechanic"],
    vet: ["Willow Veterinary Clinic", "Four Paws Vet"],
} as const;

// Amount + descriptions per category.
const TX_POOL: Record<
    string,
    { amt: [number, number]; desc: string[]; vendors?: readonly string[] }
> = {
    c_food_veg: {
        amt: [10, 65],
        desc: [
            "Weekly produce run",
            "Vegetables and greens",
            "Farmers market",
            "Salad greens + fruit",
        ],
        vendors: VENDORS.grocery,
    },
    c_food_meat: {
        amt: [22, 95],
        desc: ["Meat and fish", "Weekend protein", "Butcher shop", "Seafood market"],
        vendors: VENDORS.grocery,
    },
    c_food_dairy: {
        amt: [9, 38],
        desc: ["Milk and yogurt", "Bakery run", "Dairy top-up", "Cheese and butter"],
        vendors: VENDORS.grocery,
    },
    c_food_staples: {
        amt: [18, 82],
        desc: ["Rice and grains", "Cooking oil and spices", "Pantry restock", "Bulk essentials"],
        vendors: VENDORS.grocery,
    },
    c_food_snacks: {
        amt: [6, 28],
        desc: ["Snack run", "Chips and chocolate", "Tea and biscuits", "After-school snacks"],
        vendors: VENDORS.grocery,
    },
    c_food_frozen: {
        amt: [12, 48],
        desc: ["Frozen meals", "Ice cream", "Frozen berries", "Quick-prep frozen"],
        vendors: VENDORS.grocery,
    },

    c_rest_fine: {
        amt: [70, 260],
        desc: ["Anniversary dinner", "Sunday brunch", "Special occasion meal", "Tasting menu"],
        vendors: VENDORS.restaurant_fine,
    },
    c_rest_casual: {
        amt: [20, 78],
        desc: ["Casual lunch out", "Pizza dinner", "Family dinner out", "Burger joint"],
        vendors: VENDORS.restaurant_casual,
    },
    c_rest_quick: {
        amt: [6, 22],
        desc: ["Quick lunch", "Food truck", "Sandwich shop", "Bagel and coffee"],
        vendors: VENDORS.restaurant_quick,
    },
    c_rest_delivery: {
        amt: [14, 68],
        desc: ["Dinner delivery", "Takeout", "Weeknight delivery", "Lunch delivery"],
        vendors: VENDORS.delivery,
    },
    c_rest_bar: {
        amt: [18, 72],
        desc: ["Drinks after work", "Friday night out", "Cocktails with friends", "Pub quiz round"],
        vendors: VENDORS.restaurant_casual,
    },

    c_housing_rent: { amt: [1500, 1500], desc: ["Monthly rent"] },
    c_housing_ins: { amt: [22, 40], desc: ["Renters insurance — monthly"] },

    c_util_elec: { amt: [40, 160], desc: ["Electricity bill"] },
    c_util_water: { amt: [20, 55], desc: ["Water bill"] },
    c_util_gas: { amt: [28, 75], desc: ["Gas bill"] },
    c_util_net: { amt: [55, 70], desc: ["Internet service"] },
    c_util_mob: { amt: [24, 55], desc: ["Mobile plan"] },
    c_util_trash: { amt: [12, 28], desc: ["Trash & recycling"] },

    c_trans_ride: {
        amt: [7, 32],
        desc: ["Rideshare — commute", "Rideshare home", "Late-night ride", "Rideshare to dinner"],
        vendors: VENDORS.rideshare,
    },
    c_trans_taxi: {
        amt: [5, 22],
        desc: ["Taxi across town", "Short cab ride"],
        vendors: VENDORS.rideshare,
    },
    c_trans_fuel: {
        amt: [35, 95],
        desc: ["Fuel top-up", "Gas station fill-up"],
        vendors: VENDORS.fuel,
    },
    c_trans_transit: {
        amt: [2, 14],
        desc: ["Transit pass", "Single fare", "Weekly pass"],
        vendors: VENDORS.transit,
    },
    c_trans_parking: { amt: [3, 25], desc: ["Street parking", "Lot parking", "Toll charge"] },
    c_trans_service: {
        amt: [65, 420],
        desc: ["Oil change", "Tire rotation", "Brake service", "Annual inspection"],
        vendors: VENDORS.mechanic,
    },

    c_ent_movies: {
        amt: [18, 55],
        desc: ["Movie night", "Opening weekend", "IMAX showing"],
        vendors: VENDORS.movies,
    },
    c_ent_stream: {
        amt: [8, 22],
        desc: ["Streaming subscription", "Premium tier"],
        vendors: VENDORS.streaming_video,
    },
    c_ent_games: { amt: [20, 85], desc: ["Game purchase", "DLC", "In-app purchase"] },
    c_ent_live: {
        amt: [35, 180],
        desc: ["Concert tickets", "Live show", "Comedy club"],
        vendors: VENDORS.concert,
    },
    c_ent_museum: {
        amt: [14, 40],
        desc: ["Museum tickets", "Exhibition entry"],
        vendors: VENDORS.museum,
    },

    c_health_ph: {
        amt: [10, 55],
        desc: ["Pharmacy — antibiotics", "Vitamins restock", "OTC medicine"],
        vendors: VENDORS.pharmacy,
    },
    c_health_dr: {
        amt: [45, 220],
        desc: ["GP visit", "Dermatologist", "Follow-up visit"],
        vendors: VENDORS.doctor,
    },
    c_health_lab: {
        amt: [65, 280],
        desc: ["Annual bloodwork", "Ultrasound", "Lab panel"],
        vendors: VENDORS.doctor,
    },
    c_health_dent: {
        amt: [80, 450],
        desc: ["Dental cleaning", "Filling", "Annual checkup"],
        vendors: VENDORS.dental,
    },
    c_health_eye: { amt: [60, 320], desc: ["Eye exam", "New glasses", "Contact lenses"] },
    c_health_ther: { amt: [90, 180], desc: ["Therapy session", "Couples therapy"] },

    c_gifts_bday: { amt: [30, 140], desc: ["Birthday gift", "Cake and card", "Birthday present"] },
    c_gifts_wed: { amt: [60, 280], desc: ["Wedding gift", "Congratulatory present"] },
    c_gifts_hol: { amt: [20, 140], desc: ["Holiday gift", "Seasonal present", "Secret santa"] },
    c_gifts_baby: { amt: [30, 120], desc: ["Baby shower gift", "Nursery supplies as gift"] },
    c_gifts_charity: { amt: [25, 200], desc: ["Charitable donation", "Fundraiser contribution"] },

    c_kids_school: {
        amt: [20, 180],
        desc: ["School supplies", "Field trip fee", "Lunch card top-up", "Book fee"],
        vendors: VENDORS.school,
    },
    c_kids_act: {
        amt: [40, 250],
        desc: ["Soccer practice fee", "Music lesson", "Swim lessons", "Art class"],
    },
    c_kids_toys: {
        amt: [15, 90],
        desc: ["Birthday toy", "Puzzle", "Craft set", "Building blocks"],
        vendors: VENDORS.toys,
    },
    c_kids_care: {
        amt: [250, 1200],
        desc: ["Daycare tuition", "Babysitter"],
        vendors: VENDORS.daycare,
    },

    c_home_repair: {
        amt: [40, 620],
        desc: ["Handyman visit", "Plumbing fix", "Window seal repair"],
    },
    c_home_garden: {
        amt: [15, 120],
        desc: ["Plants for patio", "Potting soil", "Gardening tools"],
        vendors: VENDORS.garden,
    },
    c_home_decor: {
        amt: [25, 280],
        desc: ["Wall art", "Throw pillows", "Rug", "Curtains"],
        vendors: VENDORS.home_store,
    },
    c_home_appl: {
        amt: [80, 900],
        desc: ["Small appliance", "Replacement blender", "Vacuum cleaner"],
        vendors: VENDORS.home_store,
    },

    c_pet_food: {
        amt: [20, 85],
        desc: ["Pet food — monthly", "Treats", "Special diet kibble"],
        vendors: VENDORS.pet,
    },
    c_pet_vet: {
        amt: [60, 380],
        desc: ["Vet checkup", "Vaccination", "Dental cleaning"],
        vendors: VENDORS.vet,
    },
    c_pet_sup: {
        amt: [12, 80],
        desc: ["Leash and collar", "Toys", "Bed / crate"],
        vendors: VENDORS.pet,
    },
    c_pet_groom: { amt: [25, 90], desc: ["Grooming session", "Nail trim"] },

    c_cloth_work: {
        amt: [45, 220],
        desc: ["Work blazer", "Office shirts", "Tailored trousers"],
        vendors: VENDORS.clothing,
    },
    c_cloth_cas: {
        amt: [18, 110],
        desc: ["Weekend tee", "Jeans", "Sweater", "Activewear"],
        vendors: VENDORS.clothing,
    },
    c_cloth_shoe: {
        amt: [40, 180],
        desc: ["New sneakers", "Work shoes", "Boots"],
        vendors: VENDORS.clothing,
    },
    c_cloth_acc: {
        amt: [15, 150],
        desc: ["Belt", "Watch strap", "Scarf", "Sunglasses"],
        vendors: VENDORS.clothing,
    },

    c_subs_video: { amt: [16, 24], desc: ["Video streaming"], vendors: VENDORS.streaming_video },
    c_subs_music: { amt: [10, 16], desc: ["Music streaming"], vendors: VENDORS.streaming_music },
    c_subs_cloud: { amt: [3, 12], desc: ["Cloud storage plan"], vendors: VENDORS.cloud_storage },
    c_subs_dev: {
        amt: [5, 45],
        desc: ["SaaS subscription", "Domain renewal", "Cloud hosting"],
        vendors: VENDORS.dev_tools,
    },
    c_subs_news: {
        amt: [6, 22],
        desc: ["News subscription", "Digital magazine"],
        vendors: VENDORS.news,
    },
    c_subs_ai: {
        amt: [20, 40],
        desc: ["AI assistant plan", "AI coding subscription"],
        vendors: VENDORS.ai_tools,
    },

    c_self_hair: {
        amt: [22, 70],
        desc: ["Haircut", "Beard trim", "Color + cut"],
        vendors: VENDORS.hair,
    },
    c_self_skin: { amt: [18, 85], desc: ["Skincare", "Sunscreen and moisturizer"] },
    c_self_spa: {
        amt: [60, 220],
        desc: ["Deep tissue massage", "Facial", "Spa day"],
        vendors: VENDORS.spa,
    },

    c_fit_gym: { amt: [40, 90], desc: ["Gym monthly", "Trainer session"], vendors: VENDORS.gym },
    c_fit_class: { amt: [15, 45], desc: ["Yoga class", "Cycling class", "Pilates drop-in"] },
    c_fit_gear: { amt: [20, 140], desc: ["Running shoes", "Workout gear", "Resistance bands"] },

    c_hob_photo: {
        amt: [25, 220],
        desc: ["Camera accessory", "Photo gear", "Print order"],
        vendors: VENDORS.photo,
    },
    c_hob_tools: {
        amt: [10, 90],
        desc: ["Software license", "Dev tool subscription"],
        vendors: VENDORS.dev_tools,
    },
    c_hob_music: { amt: [12, 150], desc: ["Guitar strings", "Studio time", "Audio plugin"] },
    c_hob_craft: {
        amt: [15, 90],
        desc: ["Yarn order", "Craft supplies", "Watercolor paper"],
        vendors: VENDORS.craft,
    },
    c_hob_board: {
        amt: [20, 110],
        desc: ["Board game purchase", "Expansion pack", "Game night supplies"],
        vendors: VENDORS.board_game,
    },

    c_read: {
        amt: [12, 85],
        desc: ["Book order", "Online course", "Kindle purchase", "Bookshop haul"],
        vendors: VENDORS.bookshop,
    },

    c_coffee: {
        amt: [3, 12],
        desc: ["Coffee shop", "Morning americano", "Latte to go", "Cappuccino"],
        vendors: VENDORS.coffee,
    },

    c_tech_acc: {
        amt: [15, 180],
        desc: ["USB-C hub", "Mechanical keyboard", "Cables & adapters", "External SSD"],
        vendors: VENDORS.electronics,
    },
    c_tech_dev: {
        amt: [120, 1400],
        desc: ["Phone accessory", "Tablet", "Headphones", "Replacement charger"],
        vendors: VENDORS.electronics,
    },

    c_rm_gro_prod: {
        amt: [12, 50],
        desc: ["Weekly produce", "Groceries for the house"],
        vendors: VENDORS.grocery,
    },
    c_rm_gro_sta: {
        amt: [15, 70],
        desc: ["Pantry restock", "Cooking staples"],
        vendors: VENDORS.grocery,
    },
    c_rm_gro_drink: {
        amt: [8, 42],
        desc: ["Drinks run", "Sparkling water crates", "Beer for the house"],
        vendors: VENDORS.grocery,
    },

    c_rm_util_wifi: { amt: [55, 70], desc: ["Internet — split"] },
    c_rm_util_elec: { amt: [28, 110], desc: ["Electricity — split"] },
    c_rm_util_water: { amt: [15, 40], desc: ["Water — split"] },

    c_rm_clean_det: { amt: [10, 35], desc: ["Detergent and cleaners"] },
    c_rm_clean_srv: { amt: [30, 55], desc: ["Weekly cleaning service"] },

    c_rm_sup: {
        amt: [8, 55],
        desc: ["Toilet paper + bin bags", "Bulb replacement", "Kitchen utensils"],
    },

    c_rm_enter_bar: { amt: [20, 85], desc: ["House drinks night", "Beer for movie night"] },
    c_rm_enter_gm: {
        amt: [25, 110],
        desc: ["Board game purchase", "Snacks for game night"],
        vendors: VENDORS.board_game,
    },

    c_bsaas_host: {
        amt: [18, 90],
        desc: ["Cloud hosting", "Server costs"],
        vendors: VENDORS.hosting,
    },
    c_bsaas_dom: { amt: [10, 60], desc: ["Domain renewal", "TLS cert"], vendors: VENDORS.domain },
    c_bsaas_tool: {
        amt: [10, 120],
        desc: ["Dev tool subscription", "Monitoring service", "Code hosting"],
        vendors: VENDORS.dev_tools,
    },
    c_bsaas_api: {
        amt: [20, 220],
        desc: ["Third-party API usage", "Email provider", "Payment processing"],
        vendors: VENDORS.saas,
    },

    c_bofc_sup: { amt: [8, 120], desc: ["Office supplies", "Printer ink", "Notebook restock"] },
    c_bofc_equip: {
        amt: [80, 1600],
        desc: ["Monitor", "Laptop stand", "Desk chair", "Webcam"],
        vendors: VENDORS.electronics,
    },

    c_bmkt_ads: {
        amt: [60, 900],
        desc: ["Paid ads — search", "Social ads — campaign", "Retargeting spend"],
        vendors: VENDORS.ads,
    },
    c_bmkt_brand: {
        amt: [80, 900],
        desc: ["Logo revision", "Landing page redesign", "Brand asset order"],
        vendors: VENDORS.branding,
    },

    c_btrv_flt: {
        amt: [180, 820],
        desc: ["Flight — client meeting", "Flight — conference"],
        vendors: VENDORS.airline,
    },
    c_btrv_hotel: {
        amt: [90, 320],
        desc: ["Hotel night", "Airport hotel"],
        vendors: VENDORS.hotel,
    },
    c_btrv_meals: {
        amt: [25, 120],
        desc: ["Client dinner", "Solo dinner on trip", "Lunch between meetings"],
        vendors: VENDORS.restaurant_casual,
    },

    c_bpro_acct: {
        amt: [150, 900],
        desc: ["Monthly bookkeeping", "Quarterly tax prep"],
        vendors: VENDORS.accounting,
    },
    c_bpro_legal: {
        amt: [200, 1800],
        desc: ["Contract review", "Terms of service update"],
        vendors: VENDORS.legal,
    },
    c_bpro_ctr: {
        amt: [400, 3200],
        desc: ["Contractor — frontend", "Contractor — design", "Contractor — devops"],
        vendors: VENDORS.contractor,
    },

    c_tr_flt_econ: {
        amt: [180, 780],
        desc: ["Economy flight", "Regional flight"],
        vendors: VENDORS.airline,
    },
    c_tr_flt_biz: {
        amt: [600, 2400],
        desc: ["Business class upgrade", "Long-haul business"],
        vendors: VENDORS.airline,
    },
    c_tr_flt_bag: {
        amt: [25, 90],
        desc: ["Checked bag fee", "Extra bag fee"],
        vendors: VENDORS.airline,
    },
    c_tr_lodge_htl: {
        amt: [120, 480],
        desc: ["Hotel night", "Weekend hotel rate"],
        vendors: VENDORS.hotel,
    },
    c_tr_lodge_bnb: { amt: [80, 280], desc: ["Short-term rental night", "Weekend rental"] },
    c_tr_lodge_hst: { amt: [28, 80], desc: ["Hostel dorm", "Private room at hostel"] },
    c_tr_din_rest: {
        amt: [30, 140],
        desc: ["Dinner on trip", "Restaurant abroad"],
        vendors: VENDORS.restaurant_casual,
    },
    c_tr_din_street: { amt: [4, 18], desc: ["Street food", "Night market snack"] },
    c_tr_din_cafe: { amt: [4, 18], desc: ["Café stop", "Espresso bar"], vendors: VENDORS.coffee },
    c_tr_act_tour: {
        amt: [25, 160],
        desc: ["Walking tour", "Food tour", "Guided city tour"],
        vendors: VENDORS.attractions,
    },
    c_tr_act_adv: {
        amt: [55, 320],
        desc: ["Scuba dive", "Hiking tour", "Bike tour"],
        vendors: VENDORS.attractions,
    },
    c_tr_act_ent: { amt: [20, 160], desc: ["Museum entry", "Local show", "Concert abroad"] },
    c_tr_trn_local: { amt: [2, 18], desc: ["Subway card", "Bus ticket"], vendors: VENDORS.transit },
    c_tr_trn_rental: {
        amt: [55, 280],
        desc: ["Car rental — day", "Car rental — week"],
        vendors: VENDORS.car_rental,
    },
    c_tr_trn_rail: { amt: [40, 220], desc: ["Train ticket", "High-speed rail"] },
};

// Per-envelope default monthly allocation in currency-neutral units.
const MONTHLY_ALLOCATION: Partial<Record<EnvelopeKey, number>> = {
    fam_groceries: 700,
    fam_rent: 1550,
    fam_utilities: 320,
    fam_transport: 320,
    fam_eatout: 420,
    fam_entertainment: 220,
    fam_healthcare: 200,
    fam_gifts: 140,
    fam_kids: 600,
    fam_home: 220,
    fam_pets: 140,
    fam_clothing: 180,
    per_subs: 120,
    per_selfcare: 200,
    per_hobbies: 260,
    per_reading: 90,
    per_coffee: 140,
    per_fitness: 120,
    per_tech: 180,
    room_groceries: 380,
    room_utilities: 180,
    room_cleaning: 140,
    room_supplies: 90,
    room_enter: 120,
    biz_saas: 300,
    biz_office: 180,
    biz_marketing: 450,
    biz_travel: 350,
    biz_pros: 450,
    tr_flights: 400,
    tr_lodging: 400,
    tr_dining: 250,
    tr_activity: 200,
    tr_transit: 150,
};

const GENERIC_LOCATIONS = [
    "Downtown",
    "Midtown",
    "Uptown",
    "Old Town",
    "Riverside",
    "Westside",
    "East End",
    "Suburbs",
    "Harbor District",
    "North Quarter",
    "South Loop",
    "Arts District",
    "Industrial Park",
    "University Area",
] as const;

const FOREIGN_LOCATIONS = [
    "Paris",
    "Lisbon",
    "Barcelona",
    "Rome",
    "Tokyo",
    "Kyoto",
    "Bangkok",
    "Singapore",
    "Amsterdam",
    "Berlin",
    "Mexico City",
    "Buenos Aires",
    "Seoul",
    "Istanbul",
    "Vienna",
] as const;

// Helper to compose a natural description — vendor + short detail.
const descOf = (cat: string): string => {
    const pool = TX_POOL[cat];
    if (!pool) return "Expense";
    const base = pick(pool.desc);
    if (pool.vendors && pool.vendors.length > 0 && maybe(0.7)) {
        return `${pick(pool.vendors)} — ${base.toLowerCase()}`;
    }
    return base;
};

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

export async function seedDatabase() {
    if (process.env.NODE_ENV === "production") {
        throw new Error("Refusing to seed with NODE_ENV=production.");
    }

    logger.info(`Seeding against ${ENV.DATABASE_URL.replace(/:[^:@]*@/, ":***@")}`);

    const pool = createPGPool();
    const db = createQueryBuilder(pool);

    try {
        await wipe(db);
        const users = await seedUsers(db);
        const spaces = await seedSpaces(db, users);
        const accounts = await seedAccounts(db, users, spaces);
        const envelopes = await seedEnvelopes(db, spaces);
        const { byKey: categories, envelopByCategoryId } = await seedCategories(
            db,
            spaces,
            envelopes
        );
        const events = await seedEvents(db, spaces);
        await seedEnvelopeAllocations(db, users, envelopes);
        await seedGoalAllocations(db, users, envelopes);
        const txCount = await seedTransactions(
            db,
            users,
            spaces,
            accounts,
            categories,
            envelopByCategoryId,
            events
        );
        const inviteCount = await seedSpaceInvites(db, users, spaces);
        const pinCount = await seedPins(db, users, spaces, accounts, envelopes);

        logger.info("Seed complete ✅");
        console.log("");
        console.log("─────────────────────────────────────────────────────────");
        console.log(" Seed summary");
        console.log("─────────────────────────────────────────────────────────");
        console.log(`  users:         ${Object.keys(users).length}`);
        console.log(`  spaces:        ${Object.keys(spaces).length}`);
        console.log(`  accounts:      ${Object.keys(accounts).length}`);
        console.log(`  envelopes:     ${Object.keys(envelopes).length}`);
        console.log(`  categories:    ${Object.keys(categories).length}`);
        console.log(`  events:        ${Object.keys(events).length}`);
        console.log(`  invites:       ${inviteCount} pending`);
        console.log(`  pins:          ${pinCount} (account + envelope, family space)`);
        console.log(`  transactions:  ${txCount}`);
        console.log("");
        console.log(" Log in with:");
        console.log(`  email:    alex@orbit.dev`);
        console.log(`  password: ${PRIMARY_PASSWORD}`);
        console.log("─────────────────────────────────────────────────────────");
        console.log("");
    } finally {
        await db.destroy();
        await pool.end().catch(() => {});
    }
}

// ---------------------------------------------------------------------
// Wipe — TRUNCATE with CASCADE and RESTART IDENTITY.
// ---------------------------------------------------------------------

async function wipe(db: ReturnType<typeof createQueryBuilder>) {
    logger.info("Wiping product tables…");
    const tables = [
        "transaction_attachments",
        "event_attachments",
        "exported_reports",
        "files",
        "envelop_allocations",
        "transactions",
        "expense_categories",
        "events",
        "envelops",
        "account_balances",
        "space_accounts",
        "user_accounts",
        "accounts",
        "space_invites",
        "space_members",
        "spaces",
        "idempotency_keys",
        "email_verification_codes",
        "tmp_users",
        "users",
    ];
    await sql.raw(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`).execute(db);
}

// ---------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------

async function seedUsers(db: ReturnType<typeof createQueryBuilder>) {
    logger.info("Users…");
    const password_hash = await bcrypt.hash(PRIMARY_PASSWORD, BCRYPT_ROUNDS);
    const rows = await db
        .insertInto("users")
        .values(
            USERS.map((u) => ({
                email: u.email,
                first_name: u.first_name,
                last_name: u.last_name,
                password_hash,
            }))
        )
        .returning(["id", "email"])
        .execute();
    const byKey: Record<UserKey, string> = {} as Record<UserKey, string>;
    for (const u of USERS) {
        const row = rows.find((r) => r.email === u.email);
        if (!row) throw new Error(`Failed to insert user ${u.email}`);
        byKey[u.key] = row.id;
    }
    return byKey;
}

// ---------------------------------------------------------------------
// Spaces + members
// ---------------------------------------------------------------------

async function seedSpaces(
    db: ReturnType<typeof createQueryBuilder>,
    users: Record<UserKey, string>
) {
    logger.info("Spaces + members…");
    const byKey: Record<SpaceKey, string> = {} as Record<SpaceKey, string>;
    for (const s of SPACES) {
        const row = await db
            .insertInto("spaces")
            .values({
                name: s.name,
                created_by: users[s.owner],
                updated_by: users[s.owner],
            })
            .returning("id")
            .executeTakeFirstOrThrow();
        byKey[s.key] = row.id;

        const memberRows = [
            {
                space_id: row.id,
                user_id: users[s.owner],
                role: "owner" as unknown as SpaceMembers["role"],
            },
            ...s.members.map((m) => ({
                space_id: row.id,
                user_id: users[m.user],
                role: m.role as unknown as SpaceMembers["role"],
            })),
        ];
        await db.insertInto("space_members").values(memberRows).execute();
    }
    return byKey;
}

// ---------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------

async function seedAccounts(
    db: ReturnType<typeof createQueryBuilder>,
    users: Record<UserKey, string>,
    spaces: Record<SpaceKey, string>
) {
    logger.info("Accounts…");
    const byKey: Record<AccountKey, string> = {} as Record<AccountKey, string>;
    for (const a of ACCOUNTS) {
        const row = await db
            .insertInto("accounts")
            .values({
                name: a.name,
                account_type: a.type as unknown as Accounts["account_type"],
                color: a.color,
                icon: a.icon,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
        byKey[a.key] = row.id;

        const userAccountRows: {
            account_id: string;
            user_id: string;
            role: UserAccounts["role"];
        }[] = [
            {
                account_id: row.id,
                user_id: users[a.owner],
                role: "owner" as unknown as UserAccounts["role"],
            },
            ...a.viewers.map((v) => ({
                account_id: row.id,
                user_id: users[v],
                role: "viewer" as unknown as UserAccounts["role"],
            })),
        ];
        await db.insertInto("user_accounts").values(userAccountRows).execute();

        await db
            .insertInto("space_accounts")
            .values(
                a.spaces.map((s) => ({
                    account_id: row.id,
                    space_id: spaces[s],
                }))
            )
            .execute();

        await db
            .insertInto("account_balances")
            .values({ account_id: row.id, balance: 0 })
            .execute();
    }
    return byKey;
}

// ---------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------

async function seedEnvelopes(
    db: ReturnType<typeof createQueryBuilder>,
    spaces: Record<SpaceKey, string>
) {
    logger.info("Envelopes…");
    const byKey: Record<EnvelopeKey, string> = {} as Record<EnvelopeKey, string>;
    for (const e of ENVELOPES) {
        const hasTarget = "target" in e && e.target != null;
        const targetDate =
            "target_months_out" in e && e.target_months_out != null
                ? addMonths(startOfMonthUTC(NOW), e.target_months_out)
                : null;
        const row = await db
            .insertInto("envelops")
            .values({
                space_id: spaces[e.space],
                name: e.name,
                color: e.color,
                icon: e.icon,
                description: "description" in e ? e.description : null,
                cadence: e.cadence,
                target_amount: hasTarget ? String(e.target) : null,
                target_date: targetDate,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
        byKey[e.key] = row.id;
    }
    return byKey;
}

// ---------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------

async function seedCategories(
    db: ReturnType<typeof createQueryBuilder>,
    spaces: Record<SpaceKey, string>,
    envelopes: Record<EnvelopeKey, string>
) {
    logger.info("Expense categories…");
    const byKey: Record<string, string> = {};
    const envelopByCategoryId: Record<string, string> = {};
    // Root categories get the envelope's priority tier. Children leave
    // priority NULL so the recursive-inheritance rule in
    // analytics.priorityBreakdown rolls them up via their parent chain.
    for (const c of CATEGORIES.filter((x) => !x.parent)) {
        const row = await db
            .insertInto("expense_categories")
            .values({
                space_id: spaces[c.space],
                name: c.name,
                color: c.color,
                icon: c.icon,
                parent_id: null,
                priority: ENVELOPE_PRIORITY[c.envelope] ?? null,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
        byKey[c.key] = row.id;
        envelopByCategoryId[row.id] = envelopes[c.envelope];
    }
    for (const c of CATEGORIES.filter((x) => x.parent)) {
        const row = await db
            .insertInto("expense_categories")
            .values({
                space_id: spaces[c.space],
                name: c.name,
                color: c.color,
                icon: c.icon,
                parent_id: byKey[c.parent!],
            })
            .returning("id")
            .executeTakeFirstOrThrow();
        byKey[c.key] = row.id;
        envelopByCategoryId[row.id] = envelopes[c.envelope];
    }
    return { byKey, envelopByCategoryId };
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------

async function seedEvents(
    db: ReturnType<typeof createQueryBuilder>,
    spaces: Record<SpaceKey, string>
) {
    logger.info("Events…");
    const byKey: Record<EventKey, string> = {} as Record<EventKey, string>;
    // Hand-picked estimated budgets for the bigger event clusters so the
    // "over/under estimate" UI has populated rows. Anything not listed
    // stays without an estimate (null).
    const ESTIMATES: Partial<Record<EventKey, number>> = {
        e_wedding: 2500,
        e_ski: 1600,
        e_paint: 2200,
        e_conf_spring: 1800,
        e_anniv1: 1200,
        e_biz_trip1: 1800,
        e_summer_trip: 6500,
        e_launch: 4500,
        e_diwali: 1200,
        e_renov: 12000,
        e_xmas: 3500,
        e_spring_break: 2200,
        e_wed_friend: 1400,
        e_upcoming_trip: 2800,
    };
    for (const e of EVENTS) {
        // An event is "closed" when its end time is fully in the past;
        // ongoing or future events stay 'active'. closed_at mirrors end
        // so the "Closed Mar 14" subtitles render correctly.
        const isPast = e.end.getTime() < NOW.getTime();
        const row = await db
            .insertInto("events")
            .values({
                space_id: spaces[e.space],
                name: e.name,
                start_time: e.start,
                end_time: e.end,
                color: e.color,
                icon: e.icon,
                description: e.description,
                status: isPast ? "closed" : "active",
                closed_at: isPast ? e.end : null,
                estimated_amount: ESTIMATES[e.key] ?? null,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
        byKey[e.key] = row.id;
    }
    return byKey;
}

// ---------------------------------------------------------------------
// Space invites — a handful of pending invitations to non-existent
// emails, so the "Pending invites" UI on Space Settings has visible
// rows. Tokens are real 64-char hex strings so the /invite/:token
// route resolves locally during demos. Expiry is 72 hours from seed
// time, matching the production INVITE_TTL_HOURS.
// ---------------------------------------------------------------------

const PENDING_INVITES = [
    {
        space: "family" as SpaceKey,
        email: "neighbor@orbit.dev",
        role: "viewer" as const,
        invitedBy: "primary" as UserKey,
    },
    {
        space: "roommates" as SpaceKey,
        email: "new.roommate@orbit.dev",
        role: "editor" as const,
        invitedBy: "roommate" as UserKey,
    },
    {
        space: "travel" as SpaceKey,
        email: "trip.buddy@orbit.dev",
        role: "editor" as const,
        invitedBy: "primary" as UserKey,
    },
];

async function seedSpaceInvites(
    db: ReturnType<typeof createQueryBuilder>,
    users: Record<UserKey, string>,
    spaces: Record<SpaceKey, string>
) {
    logger.info("Space invites…");
    const expiresAt = new Date(NOW.getTime() + 72 * 60 * 60 * 1000);
    const rows = PENDING_INVITES.map((i) => ({
        space_id: spaces[i.space],
        email: i.email,
        role: i.role as unknown as SpaceMembers["role"],
        token: crypto.randomBytes(32).toString("hex"),
        invited_by: users[i.invitedBy],
        expires_at: expiresAt,
    }));
    await db.insertInto("space_invites").values(rows).execute();
    return rows.length;
}

// ---------------------------------------------------------------------
// Transaction-entry pins (migration 043). One per-user Account pin for
// Alex in the family space, and one space-wide Envelope pin so the new
// transaction form has visible "pinned" state on first open.
// ---------------------------------------------------------------------

async function seedPins(
    db: ReturnType<typeof createQueryBuilder>,
    users: Record<UserKey, string>,
    spaces: Record<SpaceKey, string>,
    accounts: Record<AccountKey, string>,
    envelopes: Record<EnvelopeKey, string>
) {
    logger.info("Pins…");
    // Alex's personal account pin in the family space — Joint Checking
    // is the account most family expenses run through.
    await db
        .insertInto("user_space_pin")
        .values({
            user_id: users.primary,
            space_id: spaces.family,
            field: "account" as unknown as UserSpacePin["field"],
            account_id: accounts.joint,
        })
        .execute();
    // Space-wide envelope pin for the family space — Groceries is the
    // most-used envelope, good default so the new-expense form has the
    // pin glyph lit out of the box.
    await db
        .insertInto("space_pin")
        .values({
            space_id: spaces.family,
            field: "envelop" as unknown as SpacePin["field"],
            envelop_id: envelopes.fam_groceries,
            event_id: null,
            set_by_user_id: users.primary,
        })
        .execute();
    return 2;
}

// ---------------------------------------------------------------------
// Envelope allocations — one per (envelope, period) for monthly, with a
// few account-pinned allocations sprinkled in to exercise the 2D matrix.
// ---------------------------------------------------------------------

async function seedEnvelopeAllocations(
    db: ReturnType<typeof createQueryBuilder>,
    users: Record<UserKey, string>,
    envelopes: Record<EnvelopeKey, string>
) {
    logger.info("Envelope allocations…");
    const createdBy = users.primary;
    // One row per (envelope, period): monthly → one row per month;
    // rolling/goal → one lifetime row with period_start=null.
    const rows: {
        envelop_id: string;
        amount: number;
        period_start: Date | null;
        created_by: string;
        created_at: Date;
    }[] = [];

    for (const e of ENVELOPES) {
        // Goal envelopes (rolling + has `target`) are seeded separately by
        // `seedGoalAllocations`. Skipping them here prevents the demo from
        // double-counting their balance and inflating `pctSaved`.
        if ("target" in e && e.target != null) continue;
        const base = MONTHLY_ALLOCATION[e.key] ?? 80;
        if (e.cadence === "none") {
            // Single lifetime pool row for rolling envelopes — a few months'
            // worth so they look funded.
            rows.push({
                envelop_id: envelopes[e.key],
                amount: base * 3,
                period_start: null,
                created_by: createdBy,
                created_at: atHour(periodStarts[1], 9, 0),
            });
        } else {
            for (const ps of periodStarts) {
                // Base monthly allocation; nudge some months with small drift.
                const drift = maybe(0.2) ? Math.round(base * (rng() * 0.2 - 0.1)) : 0;
                rows.push({
                    envelop_id: envelopes[e.key],
                    amount: base + drift,
                    period_start: ps,
                    created_by: createdBy,
                    created_at: atHour(ps, 9, 0),
                });
            }
        }
    }

    // Batch insert (chunked to respect parameter limits).
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
        await db
            .insertInto("envelop_allocations")
            .values(rows.slice(i, i + CHUNK))
            .execute();
    }
}

async function seedGoalAllocations(
    db: ReturnType<typeof createQueryBuilder>,
    users: Record<UserKey, string>,
    envelopes: Record<EnvelopeKey, string>
) {
    logger.info("Goal allocations…");
    const createdBy = users.primary;
    // Goals are rolling envelopes (cadence='none') → one lifetime row per
    // goal with period_start=null, holding the summed contributions.
    const rows: {
        envelop_id: string;
        amount: number;
        created_by: string;
        created_at: Date;
        period_start: Date | null;
    }[] = [];

    // Monthly contribution rate per goal envelope, summed across the
    // history window into a single lifetime allocation.
    const contributions: Partial<Record<EnvelopeKey, { amount: number }>> = {
        goal_house: { amount: 900 },
        goal_emergency: { amount: 500 },
        goal_vacation: { amount: 320 },
        // Laptop target is $3000 with target_months_out=3. Kept at
        // $120/mo so the seeded goal shows progress rather than 100%.
        goal_laptop: { amount: 120 },
    };

    for (const e of ENVELOPES) {
        const c = contributions[e.key];
        if (!c) continue;
        const total = c.amount * periodStarts.length;
        rows.push({
            envelop_id: envelopes[e.key],
            amount: total,
            created_by: createdBy,
            created_at: atHour(new Date(periodStarts[0].getTime() + 2 * MS_DAY), 11, 0),
            period_start: null,
        });
    }

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
        await db
            .insertInto("envelop_allocations")
            .values(rows.slice(i, i + CHUNK))
            .execute();
    }
}

// ---------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------

type TxRow = {
    id?: string;
    space_id: string;
    created_by: string;
    type: Transactions["type"];
    amount: number;
    source_account_id: string | null;
    destination_account_id: string | null;
    expense_category_id: string | null;
    envelop_id: string | null;
    event_id: string | null;
    description: string | null;
    location: string | null;
    transaction_datetime: Date;
    parent_transfer_id: string | null;
};

type FeeSpec = { amount: number; expenseCategoryId: string };

async function seedTransactions(
    db: ReturnType<typeof createQueryBuilder>,
    users: Record<UserKey, string>,
    spaces: Record<SpaceKey, string>,
    accounts: Record<AccountKey, string>,
    categories: Record<string, string>,
    envelopByCategoryId: Record<string, string>,
    events: Record<EventKey, string>
): Promise<number> {
    logger.info("Transactions…");
    const TX: TxRow[] = [];

    const primary = users.primary;
    const partner = users.partner;
    const roommate = users.roommate;
    const roommate2 = users.roommate2;
    const biz = users.biz;
    const travelU = users.travel;

    const fam = spaces.family;
    const per = spaces.personal;
    const room = spaces.roommates;
    const side = spaces.side;
    const travel = spaces.travel;

    const expenseType = "expense" as unknown as Transactions["type"];
    const incomeType = "income" as unknown as Transactions["type"];
    const transferType = "transfer" as unknown as Transactions["type"];
    const adjType = "adjustment" as unknown as Transactions["type"];

    // A small push helper.
    //
    // For expense rows: auto-derives `envelop_id` from the chosen
    // category's seeded default envelope so the CHECK constraint is
    // satisfied without each call spelling it out.
    //
    // For transfer rows with `fee`: also pushes a paired type='expense'
    // row pointing back at the transfer via `parent_transfer_id`. We
    // generate the transfer's id upfront (instead of letting the DB
    // default) so the linked expense can reference it before either is
    // inserted. After this migration fees are first-class expense rows,
    // not inline columns on the transfer.
    const push = (
        row: Omit<TxRow, "envelop_id" | "parent_transfer_id"> &
            Partial<Pick<TxRow, "envelop_id" | "parent_transfer_id">> & {
                fee?: FeeSpec;
            }
    ) => {
        const { fee, ...rest } = row;
        const envelopId =
            rest.envelop_id !== undefined
                ? rest.envelop_id
                : rest.type === ("expense" as unknown as Transactions["type"]) &&
                    rest.expense_category_id
                  ? (envelopByCategoryId[rest.expense_category_id] ?? null)
                  : null;

        if (fee && rest.type !== ("transfer" as unknown as Transactions["type"])) {
            throw new Error("seed: fee can only be attached to a transfer row");
        }
        const transferId = fee && !rest.id ? crypto.randomUUID() : (rest.id ?? undefined);

        TX.push({
            ...rest,
            id: transferId,
            envelop_id: envelopId,
            parent_transfer_id: rest.parent_transfer_id ?? null,
        });

        if (fee) {
            TX.push({
                id: crypto.randomUUID(),
                space_id: rest.space_id,
                created_by: rest.created_by,
                type: "expense" as unknown as Transactions["type"],
                amount: fee.amount,
                source_account_id: rest.source_account_id,
                destination_account_id: null,
                expense_category_id: fee.expenseCategoryId,
                envelop_id: envelopByCategoryId[fee.expenseCategoryId] ?? null,
                event_id: rest.event_id,
                description: rest.description ? `Fee — ${rest.description}` : "Transfer fee",
                location: rest.location,
                transaction_datetime: rest.transaction_datetime,
                parent_transfer_id: transferId!,
            });
        }
    };

    // --- 1. Opening deposits.
    const opening: Partial<Record<AccountKey, number>> = {
        cash: 1200,
        checking: 7500,
        savings: 24000,
        joint: 9800,
        mobile: 800,
        shared: 5200,
        biz: 14000,
        travel_acc: 3500,
        brokerage: 42000,
        crypto: 6800,
        term: 18000,
        retirement: 62000,
    };
    const oldest = periodStarts[0];
    for (const a of ACCOUNTS) {
        const amount = opening[a.key];
        if (!amount || a.type === "liability") continue;
        push({
            space_id: spaces[a.spaces[0]],
            created_by: primary,
            type: incomeType,
            amount,
            source_account_id: null,
            destination_account_id: accounts[a.key],
            expense_category_id: null,
            event_id: null,
            description: "Opening balance",
            location: null,
            transaction_datetime: atHour(new Date(oldest.getTime() - 5 * MS_DAY), 8),
        });
    }

    // --- 2. Salaries with progression (raise halfway through the window).
    // Alex's salary: 5500 early → 5800 at month 9 → 6200 at month 15.
    // Sam's salary: 4200 early → 4500 at month 6 → 4800 at month 12.
    periodStarts.forEach((ps, i) => {
        const alexSalary = i < 9 ? 5500 : i < 15 ? 5800 : 6200;
        const samSalary = i < 6 ? 4200 : i < 12 ? 4500 : 4800;
        push({
            space_id: fam,
            created_by: primary,
            type: incomeType,
            amount: alexSalary,
            source_account_id: null,
            destination_account_id: accounts.checking,
            expense_category_id: null,
            event_id: null,
            description: "Salary — Alex",
            location: "Payroll",
            transaction_datetime: atHour(new Date(ps.getTime() + 0 * MS_DAY), 9, 15),
        });
        push({
            space_id: fam,
            created_by: partner,
            type: incomeType,
            amount: samSalary,
            source_account_id: null,
            destination_account_id: accounts.joint,
            expense_category_id: null,
            event_id: null,
            description: "Salary — Sam",
            location: "Payroll",
            transaction_datetime: atHour(new Date(ps.getTime() + 1 * MS_DAY), 10, 0),
        });
    });

    // --- 3. Annual year-end bonus (two of them, 12 months apart).
    [periodStarts[2], periodStarts[14]].forEach((ps) => {
        if (!ps) return;
        push({
            space_id: fam,
            created_by: primary,
            type: incomeType,
            amount: range(3500, 6500),
            source_account_id: null,
            destination_account_id: accounts.checking,
            expense_category_id: null,
            event_id: null,
            description: "Year-end bonus — Alex",
            location: "Payroll",
            transaction_datetime: atHour(new Date(ps.getTime() + 10 * MS_DAY), 10, 0),
        });
        push({
            space_id: fam,
            created_by: partner,
            type: incomeType,
            amount: range(2500, 4500),
            source_account_id: null,
            destination_account_id: accounts.joint,
            expense_category_id: null,
            event_id: null,
            description: "Year-end bonus — Sam",
            location: "Payroll",
            transaction_datetime: atHour(new Date(ps.getTime() + 11 * MS_DAY), 10, 30),
        });
    });

    // --- 4. Tax refund once a year (two of them).
    [periodStarts[3], periodStarts[15]].forEach((ps) => {
        if (!ps) return;
        push({
            space_id: fam,
            created_by: primary,
            type: incomeType,
            amount: range(1600, 3100),
            source_account_id: null,
            destination_account_id: accounts.checking,
            expense_category_id: null,
            event_id: null,
            description: "Tax refund",
            location: "Tax Authority",
            transaction_datetime: atHour(new Date(ps.getTime() + 6 * MS_DAY), 14, 0),
        });
    });

    // --- 5. Quarterly brokerage dividends.
    for (let q = 0; q < Math.floor(HISTORY_MONTHS / 3); q++) {
        const ps = periodStarts[q * 3 + 1];
        if (!ps) continue;
        push({
            space_id: per,
            created_by: primary,
            type: incomeType,
            amount: range(180, 620),
            source_account_id: null,
            destination_account_id: accounts.brokerage,
            expense_category_id: null,
            event_id: null,
            description: "Quarterly dividends",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 7 * MS_DAY), 9, 30),
        });
    }

    // --- 6. Freelance / personal side income.
    for (let i = 0; i < 14; i++) {
        const d = daysAgo(range(10, HISTORY_MONTHS * 30 - 5));
        push({
            space_id: per,
            created_by: primary,
            type: incomeType,
            amount: range(500, 2800),
            source_account_id: null,
            destination_account_id: accounts.checking,
            expense_category_id: null,
            event_id: null,
            description: pick([
                "Freelance — client retainer",
                "Contract work",
                "Consulting hours",
                "Side project payout",
                "Speaking fee",
                "Technical writing",
            ]),
            location: null,
            transaction_datetime: atHour(d, 11 + Math.floor(rng() * 6)),
        });
    }

    // --- 7. Side-business income (client invoices).
    const bizClients = [
        "Acme Robotics",
        "Northwind Co.",
        "Pineapple Labs",
        "Fernwood & Co.",
        "Kestrel Bank",
    ];
    for (let i = 0; i < 22; i++) {
        const d = daysAgo(range(20, HISTORY_MONTHS * 30 - 10));
        push({
            space_id: side,
            created_by: pick([primary, biz]),
            type: incomeType,
            amount: range(1200, 8800),
            source_account_id: null,
            destination_account_id: accounts.biz,
            expense_category_id: null,
            event_id: null,
            description: `Client invoice — ${pick(bizClients)}`,
            location: null,
            transaction_datetime: atHour(d, range(10, 17)),
        });
    }

    // --- 8. Rent — monthly, on the 2nd.
    for (const ps of periodStarts) {
        push({
            space_id: fam,
            created_by: primary,
            type: expenseType,
            amount: 1500,
            source_account_id: accounts.checking,
            destination_account_id: null,
            expense_category_id: categories.c_housing_rent,
            event_id: null,
            description: "Monthly rent",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 1 * MS_DAY), 14),
        });
        push({
            space_id: fam,
            created_by: primary,
            type: expenseType,
            amount: range(22, 40),
            source_account_id: accounts.checking,
            destination_account_id: null,
            expense_category_id: categories.c_housing_ins,
            event_id: null,
            description: "Renters insurance",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 4 * MS_DAY), 12),
        });
    }

    // --- 9. Utilities — family + roommates.
    const utilBills: { cat: string; space: string; source: AccountKey; creator: string }[] = [
        { cat: "c_util_elec", space: fam, source: "checking", creator: primary },
        { cat: "c_util_water", space: fam, source: "checking", creator: primary },
        { cat: "c_util_gas", space: fam, source: "checking", creator: primary },
        { cat: "c_util_net", space: fam, source: "checking", creator: primary },
        { cat: "c_util_mob", space: fam, source: "checking", creator: primary },
        { cat: "c_util_trash", space: fam, source: "checking", creator: primary },
        { cat: "c_rm_util_wifi", space: room, source: "shared", creator: roommate },
        { cat: "c_rm_util_elec", space: room, source: "shared", creator: roommate2 },
        { cat: "c_rm_util_water", space: room, source: "shared", creator: roommate },
    ];
    for (const ps of periodStarts) {
        for (const b of utilBills) {
            const pool = TX_POOL[b.cat];
            const when = new Date(ps.getTime() + range(3, 11) * MS_DAY);
            push({
                space_id: b.space,
                created_by: b.creator,
                type: expenseType,
                amount: range(pool.amt[0], pool.amt[1]),
                source_account_id: accounts[b.source],
                destination_account_id: null,
                expense_category_id: categories[b.cat],
                event_id: null,
                description: pick(pool.desc),
                location: null,
                transaction_datetime: atHour(when, range(10, 18)),
            });
        }
    }

    // --- 10. Personal subscriptions — monthly.
    const subs: { cat: string; creator?: string }[] = [
        { cat: "c_subs_video" },
        { cat: "c_subs_music" },
        { cat: "c_subs_cloud" },
        { cat: "c_subs_news" },
        { cat: "c_subs_ai" },
    ];
    for (const ps of periodStarts) {
        for (const s of subs) {
            const pool = TX_POOL[s.cat];
            push({
                space_id: per,
                created_by: primary,
                type: expenseType,
                amount: range(pool.amt[0], pool.amt[1]),
                source_account_id: accounts.credit,
                destination_account_id: null,
                expense_category_id: categories[s.cat],
                event_id: null,
                description: descOf(s.cat),
                location: null,
                transaction_datetime: atHour(new Date(ps.getTime() + 4 * MS_DAY), 9),
            });
        }
        if (maybe(0.7)) {
            const pool = TX_POOL.c_subs_dev;
            push({
                space_id: per,
                created_by: primary,
                type: expenseType,
                amount: range(pool.amt[0], pool.amt[1]),
                source_account_id: accounts.credit,
                destination_account_id: null,
                expense_category_id: categories.c_subs_dev,
                event_id: null,
                description: descOf("c_subs_dev"),
                location: null,
                transaction_datetime: atHour(new Date(ps.getTime() + 5 * MS_DAY), 10),
            });
        }
    }

    // --- 11. Side-business recurring spend.
    for (const ps of periodStarts) {
        const bizRecurring: { cat: string; source: AccountKey }[] = [
            { cat: "c_bsaas_host", source: "biz" },
            { cat: "c_bsaas_tool", source: "biz" },
            { cat: "c_bsaas_api", source: "biz" },
            { cat: "c_bofc_sup", source: "biz" },
        ];
        for (const b of bizRecurring) {
            const pool = TX_POOL[b.cat];
            push({
                space_id: side,
                created_by: pick([primary, biz]),
                type: expenseType,
                amount: range(pool.amt[0], pool.amt[1]),
                source_account_id: accounts[b.source],
                destination_account_id: null,
                expense_category_id: categories[b.cat],
                event_id: null,
                description: descOf(b.cat),
                location: null,
                transaction_datetime: atHour(
                    new Date(ps.getTime() + range(3, 12) * MS_DAY),
                    range(10, 17)
                ),
            });
        }
        if (maybe(0.6)) {
            const pool = TX_POOL.c_bsaas_dom;
            push({
                space_id: side,
                created_by: primary,
                type: expenseType,
                amount: range(pool.amt[0], pool.amt[1]),
                source_account_id: accounts.biz,
                destination_account_id: null,
                expense_category_id: categories.c_bsaas_dom,
                event_id: null,
                description: descOf("c_bsaas_dom"),
                location: null,
                transaction_datetime: atHour(new Date(ps.getTime() + range(5, 25) * MS_DAY), 11),
            });
        }
        // Quarterly accounting.
        if (periodStarts.indexOf(ps) % 3 === 0) {
            const pool = TX_POOL.c_bpro_acct;
            push({
                space_id: side,
                created_by: primary,
                type: expenseType,
                amount: range(pool.amt[0], pool.amt[1]),
                source_account_id: accounts.biz,
                destination_account_id: null,
                expense_category_id: categories.c_bpro_acct,
                event_id: null,
                description: descOf("c_bpro_acct"),
                location: null,
                transaction_datetime: atHour(new Date(ps.getTime() + 20 * MS_DAY), 15),
            });
        }
    }

    // --- 12. Student loan + car loan payments — monthly.
    for (const ps of periodStarts) {
        push({
            space_id: per,
            created_by: primary,
            type: transferType,
            amount: 340,
            source_account_id: accounts.checking,
            destination_account_id: accounts.student,
            expense_category_id: null,
            event_id: null,
            description: "Student loan payment",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 15 * MS_DAY), 10),
        });
        push({
            space_id: fam,
            created_by: primary,
            type: transferType,
            amount: 420,
            source_account_id: accounts.checking,
            destination_account_id: accounts.car_loan,
            expense_category_id: null,
            event_id: null,
            description: "Car loan payment",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 20 * MS_DAY), 11),
        });
    }

    // --- 13. High-frequency everyday expenses.
    const weeklyCats: {
        cat: string;
        space: string;
        source: AccountKey[];
        perWeek: number;
        creators: string[];
        seasonal?: boolean;
    }[] = [
        // Family: groceries
        {
            cat: "c_food_veg",
            space: fam,
            source: ["cash", "checking"],
            perWeek: 2.2,
            creators: [primary, partner],
        },
        {
            cat: "c_food_meat",
            space: fam,
            source: ["cash", "checking"],
            perWeek: 1.2,
            creators: [primary, partner],
        },
        {
            cat: "c_food_dairy",
            space: fam,
            source: ["cash"],
            perWeek: 2.0,
            creators: [primary, partner],
        },
        {
            cat: "c_food_staples",
            space: fam,
            source: ["checking", "credit"],
            perWeek: 1.0,
            creators: [primary],
        },
        {
            cat: "c_food_snacks",
            space: fam,
            source: ["cash", "credit"],
            perWeek: 1.5,
            creators: [primary, partner],
        },
        { cat: "c_food_frozen", space: fam, source: ["credit"], perWeek: 0.6, creators: [primary] },

        // Family: eating out
        {
            cat: "c_rest_fine",
            space: fam,
            source: ["credit", "rewards_cc"],
            perWeek: 0.3,
            creators: [primary, partner],
            seasonal: true,
        },
        {
            cat: "c_rest_casual",
            space: fam,
            source: ["credit", "cash", "rewards_cc"],
            perWeek: 1.4,
            creators: [primary, partner],
            seasonal: true,
        },
        { cat: "c_rest_quick", space: fam, source: ["cash"], perWeek: 1.8, creators: [primary] },
        {
            cat: "c_rest_delivery",
            space: fam,
            source: ["credit", "rewards_cc"],
            perWeek: 1.2,
            creators: [primary, partner],
        },
        {
            cat: "c_rest_bar",
            space: fam,
            source: ["credit", "rewards_cc"],
            perWeek: 0.6,
            creators: [primary, partner],
        },

        // Family: transport
        {
            cat: "c_trans_ride",
            space: fam,
            source: ["checking", "cash"],
            perWeek: 3.2,
            creators: [primary, partner],
        },
        { cat: "c_trans_taxi", space: fam, source: ["cash"], perWeek: 1.8, creators: [primary] },
        {
            cat: "c_trans_transit",
            space: fam,
            source: ["cash"],
            perWeek: 1.0,
            creators: [primary, partner],
        },
        {
            cat: "c_trans_fuel",
            space: fam,
            source: ["credit"],
            perWeek: 0.9,
            creators: [primary, partner],
        },
        {
            cat: "c_trans_parking",
            space: fam,
            source: ["credit", "cash"],
            perWeek: 0.8,
            creators: [primary, partner],
        },

        // Family: entertainment
        {
            cat: "c_ent_movies",
            space: fam,
            source: ["credit"],
            perWeek: 0.5,
            creators: [primary, partner],
            seasonal: true,
        },
        { cat: "c_ent_games", space: fam, source: ["credit"], perWeek: 0.4, creators: [primary] },
        {
            cat: "c_ent_live",
            space: fam,
            source: ["credit", "rewards_cc"],
            perWeek: 0.15,
            creators: [primary, partner],
            seasonal: true,
        },
        {
            cat: "c_ent_museum",
            space: fam,
            source: ["credit"],
            perWeek: 0.1,
            creators: [primary, partner],
        },

        // Family: health + pets + kids + clothing + home
        {
            cat: "c_health_ph",
            space: fam,
            source: ["cash", "credit"],
            perWeek: 0.5,
            creators: [primary, partner],
        },
        { cat: "c_pet_food", space: fam, source: ["credit"], perWeek: 0.5, creators: [primary] },
        { cat: "c_pet_sup", space: fam, source: ["credit"], perWeek: 0.3, creators: [primary] },
        {
            cat: "c_kids_toys",
            space: fam,
            source: ["credit"],
            perWeek: 0.4,
            creators: [partner, primary],
        },
        {
            cat: "c_cloth_cas",
            space: fam,
            source: ["credit", "rewards_cc"],
            perWeek: 0.6,
            creators: [primary, partner],
            seasonal: true,
        },
        {
            cat: "c_home_decor",
            space: fam,
            source: ["credit"],
            perWeek: 0.3,
            creators: [primary, partner],
        },
        { cat: "c_home_garden", space: fam, source: ["cash"], perWeek: 0.3, creators: [partner] },

        // Personal
        {
            cat: "c_coffee",
            space: per,
            source: ["mobile", "cash"],
            perWeek: 4.2,
            creators: [primary],
        },
        { cat: "c_fit_gym", space: per, source: ["checking"], perWeek: 0.3, creators: [primary] },
        { cat: "c_fit_class", space: per, source: ["credit"], perWeek: 0.5, creators: [primary] },
        { cat: "c_hob_photo", space: per, source: ["credit"], perWeek: 0.4, creators: [primary] },
        { cat: "c_hob_tools", space: per, source: ["credit"], perWeek: 0.3, creators: [primary] },
        { cat: "c_hob_board", space: per, source: ["credit"], perWeek: 0.2, creators: [primary] },
        { cat: "c_read", space: per, source: ["credit"], perWeek: 0.5, creators: [primary] },
        { cat: "c_self_skin", space: per, source: ["credit"], perWeek: 0.3, creators: [primary] },
        { cat: "c_tech_acc", space: per, source: ["credit"], perWeek: 0.3, creators: [primary] },

        // Roommates
        {
            cat: "c_rm_gro_prod",
            space: room,
            source: ["shared", "cash"],
            perWeek: 1.6,
            creators: [primary, roommate, roommate2],
        },
        {
            cat: "c_rm_gro_sta",
            space: room,
            source: ["shared"],
            perWeek: 1.1,
            creators: [primary, roommate, roommate2],
        },
        {
            cat: "c_rm_gro_drink",
            space: room,
            source: ["shared"],
            perWeek: 0.9,
            creators: [roommate, roommate2],
        },
        {
            cat: "c_rm_clean_det",
            space: room,
            source: ["shared"],
            perWeek: 0.4,
            creators: [roommate2],
        },
        {
            cat: "c_rm_clean_srv",
            space: room,
            source: ["shared"],
            perWeek: 0.8,
            creators: [primary],
        },
        {
            cat: "c_rm_sup",
            space: room,
            source: ["shared"],
            perWeek: 0.6,
            creators: [primary, roommate, roommate2],
        },
        {
            cat: "c_rm_enter_bar",
            space: room,
            source: ["shared"],
            perWeek: 0.3,
            creators: [roommate, roommate2],
        },
    ];

    const oldestMs = periodStarts[0].getTime();
    const nowMs = NOW.getTime();
    const totalWeeks = (nowMs - oldestMs) / (7 * MS_DAY);
    for (const rule of weeklyCats) {
        const totalEvents = Math.round(rule.perWeek * totalWeeks);
        const pool = TX_POOL[rule.cat];
        for (let i = 0; i < totalEvents; i++) {
            const when = new Date(oldestMs + rng() * (nowMs - oldestMs - 3 * MS_DAY));
            const baseAmt = range(pool.amt[0], pool.amt[1]);
            const amt = rule.seasonal ? Math.round(baseAmt * seasonalMult(when)) : baseAmt;
            push({
                space_id: rule.space,
                created_by: pick(rule.creators),
                type: expenseType,
                amount: amt,
                source_account_id: accounts[pick(rule.source)],
                destination_account_id: null,
                expense_category_id: categories[rule.cat],
                event_id: null,
                description: descOf(rule.cat),
                location: maybe(0.35) ? pick(GENERIC_LOCATIONS) : null,
                transaction_datetime: atHour(when, range(7, 22), range(0, 59)),
            });
        }
    }

    // --- 14. Low-frequency healthcare visits (doctor / lab / dental / eye / therapy).
    const healthcareCats = [
        "c_health_dr",
        "c_health_lab",
        "c_health_dent",
        "c_health_eye",
        "c_health_ther",
    ];
    for (let i = 0; i < 26; i++) {
        const cat = pick(healthcareCats);
        const pool = TX_POOL[cat];
        const when = daysAgo(range(5, HISTORY_MONTHS * 30 - 5));
        push({
            space_id: fam,
            created_by: pick([primary, partner]),
            type: expenseType,
            amount: range(pool.amt[0], pool.amt[1]),
            source_account_id: accounts[pick(["credit", "checking"] as AccountKey[])],
            destination_account_id: null,
            expense_category_id: categories[cat],
            event_id: null,
            description: descOf(cat),
            location: pick(VENDORS.doctor),
            transaction_datetime: atHour(when, range(9, 18)),
        });
    }

    // --- 15. Pet vet visits + grooming — less frequent.
    for (let i = 0; i < 10; i++) {
        const cat = pick(["c_pet_vet", "c_pet_groom"]);
        const pool = TX_POOL[cat];
        const when = daysAgo(range(10, HISTORY_MONTHS * 30 - 10));
        push({
            space_id: fam,
            created_by: pick([primary, partner]),
            type: expenseType,
            amount: range(pool.amt[0], pool.amt[1]),
            source_account_id: accounts.credit,
            destination_account_id: null,
            expense_category_id: categories[cat],
            event_id: null,
            description: descOf(cat),
            location: pick(VENDORS.vet),
            transaction_datetime: atHour(when, range(10, 17)),
        });
    }

    // --- 16. Car service (oil change / tires / brakes) — few per year.
    for (let i = 0; i < 5; i++) {
        const pool = TX_POOL.c_trans_service;
        const when = daysAgo(range(20, HISTORY_MONTHS * 30 - 20));
        push({
            space_id: fam,
            created_by: pick([primary, partner]),
            type: expenseType,
            amount: range(pool.amt[0], pool.amt[1]),
            source_account_id: accounts.credit,
            destination_account_id: null,
            expense_category_id: categories.c_trans_service,
            event_id: null,
            description: descOf("c_trans_service"),
            location: pick(VENDORS.mechanic),
            transaction_datetime: atHour(when, range(9, 17)),
        });
    }

    // --- 17. Home repairs + appliances — sporadic.
    for (let i = 0; i < 12; i++) {
        const cat = pick(["c_home_repair", "c_home_appl"]);
        const pool = TX_POOL[cat];
        const when = daysAgo(range(10, HISTORY_MONTHS * 30 - 10));
        push({
            space_id: fam,
            created_by: pick([primary, partner]),
            type: expenseType,
            amount: range(pool.amt[0], pool.amt[1]),
            source_account_id: accounts[pick(["credit", "checking"] as AccountKey[])],
            destination_account_id: null,
            expense_category_id: categories[cat],
            event_id: null,
            description: descOf(cat),
            location: null,
            transaction_datetime: atHour(when, range(10, 18)),
        });
    }

    // --- 18. Kids — school fees, classes, childcare.
    for (const ps of periodStarts) {
        // Childcare — monthly fixed-ish.
        push({
            space_id: fam,
            created_by: partner,
            type: expenseType,
            amount: range(650, 1100),
            source_account_id: accounts.joint,
            destination_account_id: null,
            expense_category_id: categories.c_kids_care,
            event_id: null,
            description: descOf("c_kids_care"),
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 5 * MS_DAY), 9, 0),
        });
        if (maybe(0.8)) {
            const pool = TX_POOL.c_kids_act;
            push({
                space_id: fam,
                created_by: partner,
                type: expenseType,
                amount: range(pool.amt[0], pool.amt[1]),
                source_account_id: accounts.joint,
                destination_account_id: null,
                expense_category_id: categories.c_kids_act,
                event_id: null,
                description: descOf("c_kids_act"),
                location: null,
                transaction_datetime: atHour(
                    new Date(ps.getTime() + range(6, 20) * MS_DAY),
                    range(9, 16)
                ),
            });
        }
        if (maybe(0.6)) {
            const pool = TX_POOL.c_kids_school;
            push({
                space_id: fam,
                created_by: primary,
                type: expenseType,
                amount: range(pool.amt[0], pool.amt[1]),
                source_account_id: accounts.credit,
                destination_account_id: null,
                expense_category_id: categories.c_kids_school,
                event_id: null,
                description: descOf("c_kids_school"),
                location: null,
                transaction_datetime: atHour(
                    new Date(ps.getTime() + range(3, 25) * MS_DAY),
                    range(9, 16)
                ),
            });
        }
    }

    // --- 19. Gifts — tied to events where appropriate.
    for (let i = 0; i < 22; i++) {
        const subcat = pick([
            "c_gifts_bday",
            "c_gifts_wed",
            "c_gifts_hol",
            "c_gifts_baby",
            "c_gifts_charity",
        ]);
        const pool = TX_POOL[subcat];
        const when = daysAgo(range(5, HISTORY_MONTHS * 30 - 5));
        let eventId: string | null = null;
        if (subcat === "c_gifts_wed" && maybe(0.6))
            eventId = pick([events.e_wedding, events.e_wed_friend]);
        if (subcat === "c_gifts_hol" && maybe(0.7))
            eventId = pick([events.e_diwali, events.e_xmas, events.e_thanksgiving]);
        if (subcat === "c_gifts_baby" && maybe(0.8)) eventId = events.e_baby_shower;
        if (subcat === "c_gifts_bday" && maybe(0.5))
            eventId = pick([events.e_mom_bday, events.e_roomparty]);
        push({
            space_id: fam,
            created_by: pick([primary, partner]),
            type: expenseType,
            amount: range(pool.amt[0], pool.amt[1]),
            source_account_id:
                accounts[pick(["cash", "credit", "checking", "rewards_cc"] as AccountKey[])],
            destination_account_id: null,
            expense_category_id: categories[subcat],
            event_id: eventId,
            description: descOf(subcat),
            location: null,
            transaction_datetime: atHour(when, range(11, 20)),
        });
    }

    // --- 20. Event-tagged clusters.
    const eventSpendPlans: {
        event: EventKey;
        space: string;
        cats: string[];
        count: number;
        source: AccountKey[];
        creators: string[];
    }[] = [
        {
            event: "e_wedding",
            space: fam,
            cats: ["c_gifts_wed", "c_rest_fine", "c_trans_ride", "c_cloth_work"],
            count: 12,
            source: ["credit", "checking"],
            creators: [primary, partner],
        },
        {
            event: "e_housewarm",
            space: room,
            cats: ["c_rm_gro_prod", "c_rm_sup", "c_rm_enter_bar"],
            count: 7,
            source: ["shared"],
            creators: [primary, roommate, roommate2],
        },
        {
            event: "e_ski",
            space: fam,
            cats: ["c_trans_fuel", "c_rest_casual", "c_rest_quick", "c_ent_live"],
            count: 9,
            source: ["credit", "rewards_cc"],
            creators: [primary, partner],
        },
        {
            event: "e_paint",
            space: fam,
            cats: ["c_home_decor", "c_home_repair", "c_rest_delivery"],
            count: 8,
            source: ["credit"],
            creators: [primary],
        },
        {
            event: "e_conf_spring",
            space: per,
            cats: ["c_coffee", "c_read", "c_hob_tools", "c_rest_casual"],
            count: 10,
            source: ["mobile", "credit"],
            creators: [primary],
        },
        {
            event: "e_mom_bday",
            space: fam,
            cats: ["c_gifts_bday", "c_rest_fine", "c_trans_ride"],
            count: 7,
            source: ["credit", "cash"],
            creators: [primary, partner],
        },
        {
            event: "e_anniv1",
            space: fam,
            cats: ["c_rest_fine", "c_ent_live", "c_gifts_bday"],
            count: 5,
            source: ["rewards_cc"],
            creators: [primary],
        },
        {
            event: "e_biz_trip1",
            space: side,
            cats: ["c_btrv_flt", "c_btrv_hotel", "c_btrv_meals", "c_bsaas_tool"],
            count: 10,
            source: ["biz"],
            creators: [primary, biz],
        },
        {
            event: "e_summer_trip",
            space: travel,
            cats: [
                "c_tr_flt_econ",
                "c_tr_lodge_htl",
                "c_tr_din_rest",
                "c_tr_din_street",
                "c_tr_din_cafe",
                "c_tr_act_tour",
                "c_tr_act_adv",
                "c_tr_trn_local",
                "c_tr_trn_rail",
                "c_tr_flt_bag",
            ],
            count: 40,
            source: ["travel_acc", "rewards_cc"],
            creators: [primary, partner, travelU],
        },
        {
            event: "e_beach",
            space: fam,
            cats: ["c_rest_casual", "c_rest_delivery", "c_trans_ride", "c_food_meat", "c_ent_live"],
            count: 14,
            source: ["credit", "cash"],
            creators: [primary, partner],
        },
        {
            event: "e_launch",
            space: side,
            cats: ["c_bmkt_ads", "c_bmkt_brand", "c_bsaas_tool", "c_btrv_meals"],
            count: 12,
            source: ["biz"],
            creators: [primary, biz],
        },
        {
            event: "e_diwali",
            space: fam,
            cats: ["c_gifts_hol", "c_food_staples", "c_rest_casual", "c_cloth_cas"],
            count: 12,
            source: ["cash", "credit", "checking"],
            creators: [primary, partner],
        },
        {
            event: "e_baby_shower",
            space: fam,
            cats: ["c_gifts_baby", "c_rest_casual", "c_home_decor"],
            count: 6,
            source: ["credit"],
            creators: [partner],
        },
        {
            event: "e_camping",
            space: fam,
            cats: ["c_trans_fuel", "c_rest_quick", "c_food_staples", "c_home_garden"],
            count: 8,
            source: ["cash", "credit"],
            creators: [primary, partner],
        },
        {
            event: "e_conf_fall",
            space: per,
            cats: ["c_coffee", "c_read", "c_hob_tools", "c_rest_casual"],
            count: 9,
            source: ["mobile", "credit"],
            creators: [primary],
        },
        {
            event: "e_thanksgiving",
            space: fam,
            cats: ["c_food_meat", "c_food_veg", "c_food_staples", "c_food_dairy"],
            count: 10,
            source: ["credit", "cash"],
            creators: [primary, partner],
        },
        {
            event: "e_xmas",
            space: fam,
            cats: [
                "c_gifts_hol",
                "c_food_meat",
                "c_rest_fine",
                "c_ent_movies",
                "c_trans_fuel",
                "c_cloth_cas",
            ],
            count: 22,
            source: ["credit", "rewards_cc", "cash"],
            creators: [primary, partner],
        },
        {
            event: "e_nye",
            space: fam,
            cats: ["c_rest_bar", "c_food_snacks", "c_ent_live"],
            count: 6,
            source: ["credit"],
            creators: [primary, partner],
        },
        {
            event: "e_biz_trip2",
            space: side,
            cats: ["c_btrv_flt", "c_btrv_hotel", "c_btrv_meals"],
            count: 8,
            source: ["biz"],
            creators: [primary],
        },
        {
            event: "e_spring_break",
            space: fam,
            cats: ["c_rest_casual", "c_trans_fuel", "c_kids_act", "c_ent_museum"],
            count: 10,
            source: ["credit"],
            creators: [primary, partner],
        },
        {
            event: "e_wed_friend",
            space: fam,
            cats: ["c_gifts_wed", "c_rest_fine", "c_cloth_work", "c_trans_ride"],
            count: 8,
            source: ["credit", "rewards_cc"],
            creators: [primary, partner],
        },
        {
            event: "e_renov",
            space: fam,
            cats: ["c_home_repair", "c_home_appl", "c_rest_delivery", "c_rest_quick"],
            count: 18,
            source: ["credit", "checking"],
            creators: [primary, partner],
        },
        {
            event: "e_roomparty",
            space: room,
            cats: ["c_rm_enter_bar", "c_rm_enter_gm", "c_rm_gro_drink", "c_rm_sup"],
            count: 6,
            source: ["shared", "cash"],
            creators: [primary, roommate, roommate2],
        },
    ];
    for (const plan of eventSpendPlans) {
        const ev = EVENTS.find((e) => e.key === plan.event)!;
        for (let i = 0; i < plan.count; i++) {
            const cat = pick(plan.cats);
            const pool = TX_POOL[cat];
            const span = Math.max(1, ev.end.getTime() - ev.start.getTime());
            const when = new Date(ev.start.getTime() + rng() * span);
            const isTravelSpace = plan.space === travel;
            push({
                space_id: plan.space,
                created_by: pick(plan.creators),
                type: expenseType,
                amount: range(pool.amt[0], pool.amt[1]),
                source_account_id: accounts[pick(plan.source)],
                destination_account_id: null,
                expense_category_id: categories[cat],
                event_id: events[plan.event],
                description: descOf(cat),
                location: isTravelSpace
                    ? pick(FOREIGN_LOCATIONS)
                    : maybe(0.5)
                      ? pick(GENERIC_LOCATIONS)
                      : null,
                transaction_datetime: atHour(when, range(7, 22), range(0, 59)),
            });
        }
    }
    // (Foreign transaction fees are modeled separately on transfer rows;
    //  expense rows can't carry fees per the fee_shape_check constraint.)

    // --- 21. Planned-but-upcoming travel bookings (pre-bought).
    const upcoming = EVENTS.find((e) => e.key === "e_upcoming_trip")!;
    for (let i = 0; i < 6; i++) {
        const cat = pick(["c_tr_flt_econ", "c_tr_lodge_htl", "c_tr_lodge_bnb"]);
        const pool = TX_POOL[cat];
        push({
            space_id: travel,
            created_by: primary,
            type: expenseType,
            amount: range(pool.amt[0], pool.amt[1]),
            source_account_id: accounts.travel_acc,
            destination_account_id: null,
            expense_category_id: categories[cat],
            event_id: events.e_upcoming_trip,
            description: descOf(cat),
            location: pick(FOREIGN_LOCATIONS),
            transaction_datetime: atHour(daysAgo(range(2, 40)), range(9, 21)),
        });
    }
    // Keep the event reference visible.
    void upcoming;

    // --- 22. Transfers — savings, cash top-ups, CC payoff.
    for (const ps of periodStarts) {
        // Monthly savings transfer — slight month-to-month variance.
        push({
            space_id: fam,
            created_by: primary,
            type: transferType,
            amount: range(700, 1100),
            source_account_id: accounts.checking,
            destination_account_id: accounts.savings,
            expense_category_id: null,
            event_id: null,
            description: "Monthly savings transfer",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 3 * MS_DAY), 10),
        });
        // Cash top-ups — realistic cadence.
        for (let i = 0; i < 3; i++) {
            // Occasionally show an ATM fee.
            const withFee = maybe(0.3);
            push({
                space_id: fam,
                created_by: primary,
                type: transferType,
                amount: range(250, 450),
                source_account_id: accounts.checking,
                destination_account_id: accounts.cash,
                expense_category_id: null,
                event_id: null,
                description: withFee ? "ATM withdrawal" : "Wallet top-up",
                location: withFee ? pick(GENERIC_LOCATIONS) : null,
                transaction_datetime: atHour(
                    new Date(ps.getTime() + (6 + i * 8) * MS_DAY),
                    range(10, 18)
                ),
                fee: withFee
                    ? { amount: rangeF(1, 4.5), expenseCategoryId: categories.c_bank_fees }
                    : undefined,
            });
        }
        // CC payoffs — both cards.
        push({
            space_id: fam,
            created_by: primary,
            type: transferType,
            amount: range(500, 1200),
            source_account_id: accounts.checking,
            destination_account_id: accounts.credit,
            expense_category_id: null,
            event_id: null,
            description: "Credit card payment",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 14 * MS_DAY), 15),
        });
        push({
            space_id: fam,
            created_by: primary,
            type: transferType,
            amount: range(250, 800),
            source_account_id: accounts.checking,
            destination_account_id: accounts.rewards_cc,
            expense_category_id: null,
            event_id: null,
            description: "Rewards card payment",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 16 * MS_DAY), 15),
        });
        // Move into retirement quarterly.
        if (periodStarts.indexOf(ps) % 3 === 0) {
            push({
                space_id: per,
                created_by: primary,
                type: transferType,
                amount: range(500, 900),
                source_account_id: accounts.checking,
                destination_account_id: accounts.retirement,
                expense_category_id: null,
                event_id: null,
                description: "Retirement contribution",
                location: null,
                transaction_datetime: atHour(new Date(ps.getTime() + 20 * MS_DAY), 16),
            });
        }
        // Brokerage top-up (monthly).
        push({
            space_id: per,
            created_by: primary,
            type: transferType,
            amount: range(200, 500),
            source_account_id: accounts.checking,
            destination_account_id: accounts.brokerage,
            expense_category_id: null,
            event_id: null,
            description: "Brokerage deposit",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 8 * MS_DAY), 11),
        });
        // Crypto top-up — intermittent.
        if (maybe(0.4)) {
            push({
                space_id: per,
                created_by: primary,
                type: transferType,
                amount: range(80, 300),
                source_account_id: accounts.checking,
                destination_account_id: accounts.crypto,
                expense_category_id: null,
                event_id: null,
                description: "Crypto top-up",
                location: null,
                transaction_datetime: atHour(
                    new Date(ps.getTime() + range(5, 25) * MS_DAY),
                    range(10, 22)
                ),
                fee: { amount: rangeF(0.5, 5), expenseCategoryId: categories.c_crypto_fees },
            });
        }
        // Shared house top-ups from roommates (recorded as income into
        // the shared account — source is an external payroll/account).
        push({
            space_id: room,
            created_by: roommate,
            type: incomeType,
            amount: 300,
            source_account_id: null,
            destination_account_id: accounts.shared,
            expense_category_id: null,
            event_id: null,
            description: "Taylor — monthly contribution",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 2 * MS_DAY), 10),
        });
        push({
            space_id: room,
            created_by: roommate2,
            type: incomeType,
            amount: 300,
            source_account_id: null,
            destination_account_id: accounts.shared,
            expense_category_id: null,
            event_id: null,
            description: "Morgan — monthly contribution",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 2 * MS_DAY), 11),
        });
        // Business → personal owner draw (quarterly).
        if (periodStarts.indexOf(ps) % 3 === 2) {
            push({
                space_id: side,
                created_by: primary,
                type: transferType,
                amount: range(1500, 3800),
                source_account_id: accounts.biz,
                destination_account_id: accounts.checking,
                expense_category_id: null,
                event_id: null,
                description: "Owner draw",
                location: null,
                transaction_datetime: atHour(new Date(ps.getTime() + 25 * MS_DAY), 15),
            });
        }
        // Travel account top-up.
        push({
            space_id: travel,
            created_by: primary,
            type: transferType,
            amount: range(250, 450),
            source_account_id: accounts.checking,
            destination_account_id: accounts.travel_acc,
            expense_category_id: null,
            event_id: null,
            description: "Travel fund top-up",
            location: null,
            transaction_datetime: atHour(new Date(ps.getTime() + 12 * MS_DAY), 11),
        });
    }

    // --- 23. Occasional international wire with a fee.
    for (let i = 0; i < 4; i++) {
        push({
            space_id: fam,
            created_by: primary,
            type: transferType,
            amount: range(300, 1400),
            source_account_id: accounts.checking,
            destination_account_id: accounts.travel_acc,
            expense_category_id: null,
            event_id: null,
            description: "International wire",
            location: null,
            transaction_datetime: atHour(
                daysAgo(range(20, HISTORY_MONTHS * 30 - 20)),
                range(10, 17)
            ),
            fee: { amount: range(15, 42), expenseCategoryId: categories.c_bank_fees },
        });
    }

    // --- 24. Adjustments (reconciliation).
    push({
        space_id: fam,
        created_by: primary,
        type: adjType,
        amount: range(3, 12),
        source_account_id: accounts.cash,
        destination_account_id: null,
        expense_category_id: null,
        event_id: null,
        description: "Reconcile wallet — counted short",
        location: null,
        transaction_datetime: atHour(daysAgo(range(30, 220)), 21),
    });
    push({
        space_id: per,
        created_by: primary,
        type: adjType,
        amount: range(2, 8),
        source_account_id: null,
        destination_account_id: accounts.mobile,
        expense_category_id: null,
        event_id: null,
        description: "Cashback credited — matched in app",
        location: null,
        transaction_datetime: atHour(daysAgo(range(10, 180)), 17),
    });
    push({
        space_id: room,
        created_by: roommate,
        type: adjType,
        amount: range(5, 20),
        source_account_id: null,
        destination_account_id: accounts.shared,
        expense_category_id: null,
        event_id: null,
        description: "Reconcile house account — rounding",
        location: null,
        transaction_datetime: atHour(daysAgo(range(20, 260)), 18),
    });
    push({
        space_id: side,
        created_by: primary,
        type: adjType,
        amount: range(10, 80),
        source_account_id: accounts.biz,
        destination_account_id: null,
        expense_category_id: null,
        event_id: null,
        description: "Correct duplicate invoice entry",
        location: null,
        transaction_datetime: atHour(daysAgo(range(30, 180)), 11),
    });

    // --- 25. Refunds — as income with a matching description.
    for (let i = 0; i < 8; i++) {
        push({
            space_id: fam,
            created_by: pick([primary, partner]),
            type: incomeType,
            amount: range(15, 140),
            source_account_id: null,
            destination_account_id: accounts.credit,
            expense_category_id: null,
            event_id: null,
            description: pick([
                "Refund — returned item",
                "Refund — cancelled order",
                "Merchant chargeback",
                "Price-match credit",
            ]),
            location: null,
            transaction_datetime: atHour(
                daysAgo(range(15, HISTORY_MONTHS * 30 - 15)),
                range(10, 19)
            ),
        });
    }

    // --- Sort & insert in chunks.
    TX.sort((a, b) => a.transaction_datetime.getTime() - b.transaction_datetime.getTime());

    const CHUNK = 400;
    for (let i = 0; i < TX.length; i += CHUNK) {
        await db
            .insertInto("transactions")
            .values(TX.slice(i, i + CHUNK))
            .execute();
    }
    return TX.length;
}

// ---------------------------------------------------------------------

// When invoked directly (e.g. via `tsx src/db/kysely/seed.mts`), run.
// When imported from bootstrap, the caller drives when to execute.
const invokedDirectly =
    import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith("/seed.mts") ||
    process.argv[1]?.endsWith("/seed.mjs");

if (invokedDirectly) {
    seedDatabase().catch((err: unknown) => {
        logger.error("Seed failed");
        console.error(err);
        process.exit(1);
    });
}
