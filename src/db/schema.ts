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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  },
  (t) => [primaryKey({ columns: [t.itemId, t.aliasId] })]
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
