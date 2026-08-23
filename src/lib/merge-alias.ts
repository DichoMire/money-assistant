import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { expensePayers, expenseShares } from "@/db/schema";

/**
 * Move every expense reference from one alias onto another. Where both aliases
 * appear in the same expense, the rows are combined: paid/owed cents are
 * summed, and the raw split input is summed too (which is correct for exact,
 * percent, shares, and adjustment values; equal-split rows carry null and stay
 * null). Used when attaching a virtual member to an account whose own alias
 * already has history.
 */
export async function mergeAliasReferences(
  db: Db,
  fromAliasId: string,
  toAliasId: string
): Promise<void> {
  const fromPayers = await db
    .select()
    .from(expensePayers)
    .where(eq(expensePayers.aliasId, fromAliasId));
  for (const row of fromPayers) {
    const existing = await db
      .select()
      .from(expensePayers)
      .where(and(eq(expensePayers.expenseId, row.expenseId), eq(expensePayers.aliasId, toAliasId)));
    if (existing[0]) {
      await db
        .update(expensePayers)
        .set({ paidCents: existing[0].paidCents + row.paidCents })
        .where(and(eq(expensePayers.expenseId, row.expenseId), eq(expensePayers.aliasId, toAliasId)));
      await db
        .delete(expensePayers)
        .where(and(eq(expensePayers.expenseId, row.expenseId), eq(expensePayers.aliasId, fromAliasId)));
    } else {
      await db
        .update(expensePayers)
        .set({ aliasId: toAliasId })
        .where(and(eq(expensePayers.expenseId, row.expenseId), eq(expensePayers.aliasId, fromAliasId)));
    }
  }

  const fromShares = await db
    .select()
    .from(expenseShares)
    .where(eq(expenseShares.aliasId, fromAliasId));
  for (const row of fromShares) {
    const existing = await db
      .select()
      .from(expenseShares)
      .where(and(eq(expenseShares.expenseId, row.expenseId), eq(expenseShares.aliasId, toAliasId)));
    if (existing[0]) {
      const splitValue =
        existing[0].splitValue !== null && row.splitValue !== null
          ? existing[0].splitValue + row.splitValue
          : null;
      await db
        .update(expenseShares)
        .set({ owedCents: existing[0].owedCents + row.owedCents, splitValue })
        .where(and(eq(expenseShares.expenseId, row.expenseId), eq(expenseShares.aliasId, toAliasId)));
      await db
        .delete(expenseShares)
        .where(and(eq(expenseShares.expenseId, row.expenseId), eq(expenseShares.aliasId, fromAliasId)));
    } else {
      await db
        .update(expenseShares)
        .set({ aliasId: toAliasId })
        .where(and(eq(expenseShares.expenseId, row.expenseId), eq(expenseShares.aliasId, fromAliasId)));
    }
  }
}
