import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { NotifyPrefs } from "@/lib/types";

// Postgres bytea (drizzle pg-core has no built-in). toDriver hands over a
// Buffer: PGlite serializes Uint8Array natively, and the Neon HTTP driver
// hex-encodes Buffers itself (encodeBuffersAsBytea). fromDriver is defensive
// because the drivers decode differently (PGlite -> Uint8Array, Neon HTTP ->
// Buffer, raw "\x..." string when parsers are bypassed).
const bytea = customType<{ data: Uint8Array; driverData: unknown }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => {
    if (value instanceof Uint8Array) return value; // covers Buffer too
    if (typeof value === "string" && value.startsWith("\\x")) {
      return new Uint8Array(Buffer.from(value.slice(2), "hex"));
    }
    throw new Error("Unexpected bytea driver value");
  },
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  /** Export throttle: refuse a second data export within 10 minutes. */
  lastExportAt: timestamp("last_export_at"),
  /** When the user dismissed the "we published terms/privacy" notice. */
  policiesAcceptedAt: timestamp("policies_accepted_at"),
  /**
   * Entitlements (src/lib/entitlements.ts) are exactly these two columns:
   * plan 'free' | 'plus', and — for plus — when it lapses (period end + grace,
   * written by the future billing webhook). Deliberately NOT in the JWT: it
   * would go stale the moment a webhook flips the plan.
   */
  plan: text("plan").notNull().default("free"),
  planExpiresAt: timestamp("plan_expires_at"),
  /**
   * The recipient's UI language for email (RFC 07): a sender's cookie can't
   * tell us what language user B reads. Captured at sign-in and on every
   * locale toggle; the cookie stays authoritative for the UI itself.
   */
  locale: text("locale").notNull().default("en"),
  /** Per-type × per-channel notification preferences (defaults live in code). */
  notifyPrefs: jsonb("notify_prefs").$type<NotifyPrefs>().notNull().default({}),
  /** Global email kill-switch (one-click unsubscribe "all"). */
  unsubscribedAt: timestamp("unsubscribed_at"),
  /** Bearer token for no-login unsubscribe links; rotatable. */
  unsubscribeToken: text("unsubscribe_token")
    .notNull()
    .default(sql`gen_random_uuid()`),
  /** Auth.js email-provider expectation; Google rows verified at entry. */
  emailVerified: timestamp("email_verified"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Per-recipient notifications, written by the same server actions that write
 * activity_log (no separate event system). Snapshots are denormalized so rows
 * stay renderable after what they reference is deleted; details are typed
 * {key,params}-style data rendered in the VIEWER's locale — never prose.
 * The bell is a recency surface: rows older than 90 days are cron-purged
 * (activity_log remains the archive).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    /** expense/invite/scan id — no FK on purpose (survives deletion). */
    refId: uuid("ref_id"),
    actorName: text("actor_name").notNull(),
    groupName: text("group_name").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    readAt: timestamp("read_at"),
    /** Set when emailed immediately OR included in a digest. */
    emailedAt: timestamp("emailed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_unread_idx").on(t.userId, t.readAt),
    index("notifications_user_email_idx").on(t.userId, t.emailedAt),
  ]
);

/** Auth.js email magic-link verification tokens (minimal custom adapter). */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires").notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })]
);

// The owner FK is RESTRICT on purpose: account deletion explicitly deletes or
// transfers owned groups first (account-actions.ts), so the only thing a
// cascade could ever do is let a raw admin DELETE silently destroy shared
// groups. Make the database refuse instead.
export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("EUR"),
  simplifyDebts: boolean("simplify_debts").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A participant in a group. userId links the alias to a real account ("real
// member"); null means a virtual member tracked on their behalf. Removing a
// member detaches the link instead of deleting the alias, preserving history.
export const aliases = pgTable(
  "aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("aliases_group_idx").on(t.groupId)]
);

// Non-owner accounts that joined a group. The owner is groups.userId and has
// no row here, which keeps pre-multi-user groups valid without a backfill.
export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("group_members_user_idx").on(t.userId),
  ]
);

// Shareable multi-use join links, valid for 7 days (the daily cron expires
// them). status: active | expired | revoked.
export const groupInvites = pgTable(
  "group_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [index("group_invites_group_idx").on(t.groupId)]
);

// One payment profile per account (not per alias — payment identity belongs
// to the person and is reused across groups). Visible to users who share at
// least one group with the owner, enforced server-side. Virtual members
// deliberately have none (RFC 03).
export const paymentProfiles = pgTable("payment_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Normalized: uppercase, no spaces. */
  iban: text("iban"),
  /** Must match bank records (Verification of Payee). */
  accountName: text("account_name"),
  /** E.164, the number registered for blink P2P receiving. */
  blinkPhone: text("blink_phone"),
  /** revolut.me username (no URL, no @). */
  revolutTag: text("revolut_tag"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// kind: "expense" | "settlement". A settlement ("A paid B") is stored as a
// transaction with one payer (A) and one share (B owes the full amount), which
// makes it flow through the same balance math as regular expenses.
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("expense"),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    splitMethod: text("split_method").notNull().default("equal"),
    /** Settlements only: how the money moved (cash|bank|blink|revolut|other). */
    method: text("method"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("expenses_group_date_idx").on(t.groupId, t.date)]
);

export const expensePayers = pgTable(
  "expense_payers",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    aliasId: uuid("alias_id")
      .notNull()
      .references(() => aliases.id, { onDelete: "restrict" }),
    paidCents: integer("paid_cents").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.aliasId] }),
    index("expense_payers_alias_idx").on(t.aliasId),
  ]
);

// splitValue holds the raw user input for the chosen split method (exact cents,
// percent, share count, or adjustment cents) so the edit UI can be restored.
// owedCents is the canonical computed amount and is what balance math uses.
export const expenseShares = pgTable(
  "expense_shares",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    aliasId: uuid("alias_id")
      .notNull()
      .references(() => aliases.id, { onDelete: "restrict" }),
    owedCents: integer("owed_cents").notNull(),
    splitValue: doublePrecision("split_value"),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.aliasId] }),
    index("expense_shares_alias_idx").on(t.aliasId),
  ]
);

// Owner-visible audit trail of everything that happens in a group. Names and
// amounts are denormalized into details so entries stay readable after the
// people or expenses they mention are deleted.
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("activity_log_group_created_idx").on(t.groupId, t.createdAt)]
);

// A parsed receipt draft. status: "draft" | "converted". expenseId links the
// expense created by conversion; deleting that expense nulls the link (the UI
// treats a null expenseId as "draft" again), so a scan can be re-converted
// after its expense is deleted. discountsCents is the receipt-level discount
// as a positive magnitude; line-level discounts are negative receipt_items.
// A non-null discountPercentBp means the discount was entered as a percentage
// of the items subtotal (basis points, 1050 = 10.5%); discountsCents then
// holds the resolved amount, recomputed on every save.
export const receiptScans = pgTable(
  "receipt_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("draft"),
    merchant: text("merchant"),
    date: date("date", { mode: "string" }).notNull(),
    currency: text("currency").notNull(),
    subtotalCents: integer("subtotal_cents"),
    taxCents: integer("tax_cents").notNull().default(0),
    tipCents: integer("tip_cents").notNull().default(0),
    discountsCents: integer("discounts_cents").notNull().default(0),
    discountPercentBp: integer("discount_percent_bp"),
    totalCents: integer("total_cents").notNull(),
    confidence: doublePrecision("confidence"),
    reconciles: boolean("reconciles").notNull().default(false),
    model: text("model"),
    imageHash: text("image_hash").notNull(),
    /**
     * Data minimization (RFC 04/08): the photo exists to serve the review UI
     * while the scan is a draft. On conversion it is deleted unless the user
     * checked "keep the photo"; stale drafts are purged by the daily cron.
     * imageHash stays either way, so group-level dedupe keeps working.
     */
    keepImage: boolean("keep_image").notNull().default(false),
    /** Dual-era receipts (Jan–Aug 2026): the second printed total, e.g. the
     *  informational BGN total on a EUR receipt — a free validation signal. */
    secondTotalCents: integer("second_total_cents"),
    secondCurrency: text("second_currency"),
    /** |bgn − round(eur × 1.95583)| ≤ 1 cent; null when no second total. */
    dualTotalMatches: boolean("dual_total_matches"),
    /** Per-scan LLM cost from the provider's usage object (µUSD; null when
     *  the endpoint reports none) and end-to-end parse latency. */
    costMicroUsd: integer("cost_microusd"),
    latencyMs: integer("latency_ms"),
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("receipt_scans_group_hash_idx").on(t.groupId, t.imageHash),
    index("receipt_scans_expense_idx").on(t.expenseId),
  ]
);

// The downscaled receipt JPEG lives in its own table so scan-list queries
// never drag ~300KB blobs through the driver.
export const receiptScanImages = pgTable("receipt_scan_images", {
  scanId: uuid("scan_id")
    .primaryKey()
    .references(() => receiptScans.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
  contentType: text("content_type").notNull().default("image/jpeg"),
  byteSize: integer("byte_size").notNull(),
});

// One receipt line. quantity is a double so weighted items ("0.734 kg") work;
// totalCents may be negative (coupons, deposit returns). assignMode:
// "unassigned" | "single" | "equal" | "exact" — the share rows below carry the
// participants so the assignment editor can be restored exactly.
export const receiptItems = pgTable("receipt_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanId: uuid("scan_id")
    .notNull()
    .references(() => receiptScans.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  rawText: text("raw_text"),
  name: text("name").notNull(),
  quantity: doublePrecision("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents"),
  totalCents: integer("total_cents").notNull(),
  category: text("category"),
  /** Bulgarian fiscal VAT group letter (А/Б/В/Г) printed after the name. */
  taxGroup: text("tax_group"),
  /** product | deposit | discount | fee — deposit/discount lines typed. */
  lineType: text("line_type"),
  assignMode: text("assign_mode").notNull().default("unassigned"),
});

// Assignment participants of one receipt line. single/equal: one row per
// person (exactCents null); exact: exactCents per person, summing to the
// item's totalCents. aliasId cascades (draft data — deleting a virtual person
// must not be blocked by a scan, unlike expense_shares which RESTRICTs).
export const receiptItemShares = pgTable(
  "receipt_item_shares",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => receiptItems.id, { onDelete: "cascade" }),
    aliasId: uuid("alias_id")
      .notNull()
      .references(() => aliases.id, { onDelete: "cascade" }),
    exactCents: integer("exact_cents"),
    /** assignMode "units": whole units of the item this person takes
     *  (sum(units) === item.quantity); null for every other mode. */
    units: integer("units"),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.aliasId] })]
);

/** Per-user monthly scan counter (Europe/Sofia month) — the metering RFC 09
 *  bills against. Incremented only after a SUCCESSFUL parse. */
export const scanUsage = pgTable(
  "scan_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "YYYY-MM". */
    period: text("period").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.period] })]
);

// Per-user "last seen" watermark for a group, updated when the user opens the
// group page. The dashboard shows a "new activity" dot when the group's audit
// trail has entries by OTHER members newer than this.
export const groupReads = pgTable(
  "group_reads",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })]
);

// Fixed-window counters backing the in-Postgres sliding-window rate limiter
// (src/lib/rate-limit.ts). key examples: "scan:<userId>", "rates:global".
// Stale windows are purged by the daily cron.
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start").notNull(),
    count: integer("count").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })]
);

// One row per day of ECB reference rates (base EUR), fetched by the Vercel
// cron job. rates maps currency code -> units per 1 EUR.
export const fxRates = pgTable("fx_rates", {
  date: date("date", { mode: "string" }).primaryKey(),
  base: text("base").notNull().default("EUR"),
  rates: jsonb("rates").$type<Record<string, number>>().notNull(),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
});
