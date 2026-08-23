"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb, type Db } from "@/db";
import { aliases, expensePayers, expenseShares, expenses, groups } from "@/db/schema";
import { isSupportedCurrency } from "@/lib/currencies";
import { refreshRates } from "@/lib/rates-fetch";
import { computeShares, validatePayers, SPLIT_METHODS } from "@/lib/split";
import type { ActionResult, ExpenseInput, SettlementInput } from "@/lib/types";

async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new Error("Not signed in.");
  return id;
}

async function requireOwnedGroup(db: Db, groupId: string, userId: string) {
  const rows = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.userId, userId)));
  if (!rows[0]) throw new Error("Group not found.");
  return rows[0];
}

function fail(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
}

function revalidateGroup(groupId: string) {
  revalidatePath("/");
  revalidatePath(`/groups/${groupId}`);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- Groups ----------

export async function createGroup(name: string, currency: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Group name is required." };
    if (!isSupportedCurrency(currency)) return { ok: false, error: "Unsupported currency." };
    const db = await getDb();
    const rows = await db
      .insert(groups)
      .values({ userId, name: trimmed, currency })
      .returning({ id: groups.id });
    revalidatePath("/");
    return { ok: true, id: rows[0].id };
  } catch (e) {
    return fail(e);
  }
}

export async function updateGroup(
  groupId: string,
  patch: { name?: string; currency?: string; simplifyDebts?: boolean }
): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const db = await getDb();
    await requireOwnedGroup(db, groupId, userId);
    const set: Partial<typeof groups.$inferInsert> = {};
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) return { ok: false, error: "Group name is required." };
      set.name = trimmed;
    }
    if (patch.currency !== undefined) {
      if (!isSupportedCurrency(patch.currency)) return { ok: false, error: "Unsupported currency." };
      set.currency = patch.currency;
    }
    if (patch.simplifyDebts !== undefined) set.simplifyDebts = patch.simplifyDebts;
    if (Object.keys(set).length > 0) {
      await db.update(groups).set(set).where(eq(groups.id, groupId));
    }
    revalidateGroup(groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteGroup(groupId: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const db = await getDb();
    await requireOwnedGroup(db, groupId, userId);
    // FK order: aliases are referenced by payers/shares with RESTRICT, so
    // remove transactions first, then aliases, then the group.
    const groupExpenses = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.groupId, groupId));
    for (const e of groupExpenses) {
      await db.delete(expensePayers).where(eq(expensePayers.expenseId, e.id));
      await db.delete(expenseShares).where(eq(expenseShares.expenseId, e.id));
    }
    await db.delete(expenses).where(eq(expenses.groupId, groupId));
    await db.delete(aliases).where(eq(aliases.groupId, groupId));
    await db.delete(groups).where(eq(groups.id, groupId));
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Aliases (participants) ----------

export async function addAlias(groupId: string, name: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Name is required." };
    const db = await getDb();
    await requireOwnedGroup(db, groupId, userId);
    const existing = await db.select().from(aliases).where(eq(aliases.groupId, groupId));
    if (existing.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: `"${trimmed}" is already in this group.` };
    }
    const rows = await db
      .insert(aliases)
      .values({ groupId, name: trimmed })
      .returning({ id: aliases.id });
    revalidateGroup(groupId);
    return { ok: true, id: rows[0].id };
  } catch (e) {
    return fail(e);
  }
}

async function requireOwnedAlias(db: Db, aliasId: string, userId: string) {
  const rows = await db
    .select({ alias: aliases })
    .from(aliases)
    .innerJoin(groups, eq(aliases.groupId, groups.id))
    .where(and(eq(aliases.id, aliasId), eq(groups.userId, userId)));
  if (!rows[0]) throw new Error("Person not found.");
  return rows[0].alias;
}

export async function renameAlias(aliasId: string, name: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Name is required." };
    const db = await getDb();
    const alias = await requireOwnedAlias(db, aliasId, userId);
    await db.update(aliases).set({ name: trimmed }).where(eq(aliases.id, aliasId));
    revalidateGroup(alias.groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAlias(aliasId: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const db = await getDb();
    const alias = await requireOwnedAlias(db, aliasId, userId);
    const [paid, owed] = await Promise.all([
      db.select({ id: expensePayers.expenseId }).from(expensePayers).where(eq(expensePayers.aliasId, aliasId)).limit(1),
      db.select({ id: expenseShares.expenseId }).from(expenseShares).where(eq(expenseShares.aliasId, aliasId)).limit(1),
    ]);
    if (paid.length > 0 || owed.length > 0) {
      return {
        ok: false,
        error: `${alias.name} is part of existing expenses. Delete or edit those expenses first.`,
      };
    }
    await db.delete(aliases).where(eq(aliases.id, aliasId));
    revalidateGroup(alias.groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Expenses ----------

export async function saveExpense(input: ExpenseInput): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const db = await getDb();
    await requireOwnedGroup(db, input.groupId, userId);

    const description = input.description.trim();
    if (!description) return { ok: false, error: "Description is required." };
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return { ok: false, error: "Amount must be greater than zero." };
    }
    if (!isSupportedCurrency(input.currency)) return { ok: false, error: "Unsupported currency." };
    if (!DATE_RE.test(input.date)) return { ok: false, error: "Invalid date." };
    if (!SPLIT_METHODS.includes(input.splitMethod)) return { ok: false, error: "Invalid split method." };

    const groupAliases = await db.select().from(aliases).where(eq(aliases.groupId, input.groupId));
    const aliasIds = new Set(groupAliases.map((a) => a.id));
    const payerIds = input.payers.map((p) => p.aliasId);
    const splitIds = input.splits.map((s) => s.aliasId);
    if (
      payerIds.some((id) => !aliasIds.has(id)) ||
      splitIds.some((id) => !aliasIds.has(id)) ||
      new Set(payerIds).size !== payerIds.length ||
      new Set(splitIds).size !== splitIds.length
    ) {
      return { ok: false, error: "Invalid participants." };
    }

    const payerError = validatePayers(input.amountCents, input.payers, input.currency);
    if (payerError) return { ok: false, error: payerError };

    const split = computeShares(input.splitMethod, input.amountCents, input.splits, input.currency);
    if (!split.ok) return { ok: false, error: split.error };

    let expenseId = input.id;
    if (expenseId) {
      const existing = await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, input.groupId)));
      if (!existing[0]) return { ok: false, error: "Expense not found." };
      await db
        .update(expenses)
        .set({
          description,
          amountCents: input.amountCents,
          currency: input.currency,
          date: input.date,
          splitMethod: input.splitMethod,
          kind: "expense",
        })
        .where(eq(expenses.id, expenseId));
      await db.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
      await db.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
    } else {
      const rows = await db
        .insert(expenses)
        .values({
          groupId: input.groupId,
          kind: "expense",
          description,
          amountCents: input.amountCents,
          currency: input.currency,
          date: input.date,
          splitMethod: input.splitMethod,
        })
        .returning({ id: expenses.id });
      expenseId = rows[0].id;
    }

    await db.insert(expensePayers).values(
      input.payers.map((p) => ({ expenseId: expenseId!, aliasId: p.aliasId, paidCents: p.paidCents }))
    );
    await db.insert(expenseShares).values(
      split.shares.map((s) => ({
        expenseId: expenseId!,
        aliasId: s.aliasId,
        owedCents: s.owedCents,
        splitValue: s.splitValue,
      }))
    );

    revalidateGroup(input.groupId);
    return { ok: true, id: expenseId };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSettlement(input: SettlementInput): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const db = await getDb();
    await requireOwnedGroup(db, input.groupId, userId);

    if (input.fromAliasId === input.toAliasId) {
      return { ok: false, error: "Payer and recipient must be different people." };
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return { ok: false, error: "Amount must be greater than zero." };
    }
    if (!isSupportedCurrency(input.currency)) return { ok: false, error: "Unsupported currency." };
    if (!DATE_RE.test(input.date)) return { ok: false, error: "Invalid date." };

    const groupAliases = await db.select().from(aliases).where(eq(aliases.groupId, input.groupId));
    const aliasIds = new Set(groupAliases.map((a) => a.id));
    if (!aliasIds.has(input.fromAliasId) || !aliasIds.has(input.toAliasId)) {
      return { ok: false, error: "Invalid participants." };
    }

    let expenseId = input.id;
    if (expenseId) {
      const existing = await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, input.groupId)));
      if (!existing[0]) return { ok: false, error: "Payment not found." };
      await db
        .update(expenses)
        .set({ amountCents: input.amountCents, currency: input.currency, date: input.date })
        .where(eq(expenses.id, expenseId));
      await db.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
      await db.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
    } else {
      const rows = await db
        .insert(expenses)
        .values({
          groupId: input.groupId,
          kind: "settlement",
          description: "Payment",
          amountCents: input.amountCents,
          currency: input.currency,
          date: input.date,
          splitMethod: "exact",
        })
        .returning({ id: expenses.id });
      expenseId = rows[0].id;
    }

    await db.insert(expensePayers).values([
      { expenseId: expenseId!, aliasId: input.fromAliasId, paidCents: input.amountCents },
    ]);
    await db.insert(expenseShares).values([
      {
        expenseId: expenseId!,
        aliasId: input.toAliasId,
        owedCents: input.amountCents,
        splitValue: input.amountCents,
      },
    ]);

    revalidateGroup(input.groupId);
    return { ok: true, id: expenseId };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteExpense(expenseId: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const db = await getDb();
    const rows = await db
      .select({ expense: expenses })
      .from(expenses)
      .innerJoin(groups, eq(expenses.groupId, groups.id))
      .where(and(eq(expenses.id, expenseId), eq(groups.userId, userId)));
    if (!rows[0]) return { ok: false, error: "Expense not found." };
    await db.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
    await db.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
    await db.delete(expenses).where(eq(expenses.id, expenseId));
    revalidateGroup(rows[0].expense.groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- FX rates ----------

export async function updateRatesNow(): Promise<ActionResult> {
  try {
    await requireUserId();
    await refreshRates();
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
