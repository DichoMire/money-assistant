import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("USD"),
  simplifyDebts: boolean("simplify_debts").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A participant in a group. userId links the alias to a real account ("real
// member"); null means a virtual member tracked on their behalf. Removing a
// member detaches the link instead of deleting the alias, preserving history.
export const aliases = pgTable("aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })]
);

// Shareable multi-use join links, valid for 7 days (the daily cron expires
// them). status: active | expired | revoked.
export const groupInvites = pgTable("group_invites", {
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
});

// kind: "expense" | "settlement". A settlement ("A paid B") is stored as a
// transaction with one payer (A) and one share (B owes the full amount), which
// makes it flow through the same balance math as regular expenses.
export const expenses = pgTable("expenses", {
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
});

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
  (t) => [primaryKey({ columns: [t.expenseId, t.aliasId] })]
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
  (t) => [primaryKey({ columns: [t.expenseId, t.aliasId] })]
);

// One row per day of ECB reference rates (base EUR), fetched by the Vercel
// cron job. rates maps currency code -> units per 1 EUR.
export const fxRates = pgTable("fx_rates", {
  date: date("date", { mode: "string" }).primaryKey(),
  base: text("base").notNull().default("EUR"),
  rates: jsonb("rates").$type<Record<string, number>>().notNull(),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
});
