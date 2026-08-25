import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { expensePayers, expenseShares } from "@/db/schema";

/**
 * Move every expense reference from one alias onto another. Where both aliases
 * appear in the same expense, the rows are combined: paid/owed cents are
 * summed, and the raw split input is summed too (which is correct for exact,
 * percent, shares, and adjustment values; equal-split rows carry null and stay
 * null — a null on either side keeps the merged value null). Used when
 * attaching a virtual member to an account whose own alias already has history.
 *
 * Set-based (three statements per table, independent of history size) and
 * meant to run inside withTransaction — a partial merge would corrupt both
 * identities' histories.
 */
export async function mergeAliasReferences(
  db: Db,
  fromAliasId: string,
  toAliasId: string
): Promise<void> {
  // 1. Fold colliding payer rows into the target alias's rows.
  await db.execute(sql`
    UPDATE expense_payers AS t
    SET paid_cents = t.paid_cents + f.paid_cents
    FROM expense_payers AS f
    WHERE t.alias_id = ${toAliasId}
      AND f.alias_id = ${fromAliasId}
      AND f.expense_id = t.expense_id
  `);
  // 2. Drop the now-merged source rows (exactly those with a target twin).
  await db.execute(sql`
    DELETE FROM expense_payers AS f
    WHERE f.alias_id = ${fromAliasId}
      AND EXISTS (
        SELECT 1 FROM expense_payers AS t
        WHERE t.alias_id = ${toAliasId} AND t.expense_id = f.expense_id
      )
  `);
  // 3. Re-point the remaining (non-colliding) rows.
  await db
    .update(expensePayers)
    .set({ aliasId: toAliasId })
    .where(eq(expensePayers.aliasId, fromAliasId));

  // Same three steps for shares, with the null-safe splitValue sum.
  await db.execute(sql`
    UPDATE expense_shares AS t
    SET owed_cents = t.owed_cents + f.owed_cents,
        split_value = CASE
          WHEN t.split_value IS NULL OR f.split_value IS NULL THEN NULL
          ELSE t.split_value + f.split_value
        END
    FROM expense_shares AS f
    WHERE t.alias_id = ${toAliasId}
      AND f.alias_id = ${fromAliasId}
      AND f.expense_id = t.expense_id
  `);
  await db.execute(sql`
    DELETE FROM expense_shares AS f
    WHERE f.alias_id = ${fromAliasId}
      AND EXISTS (
        SELECT 1 FROM expense_shares AS t
        WHERE t.alias_id = ${toAliasId} AND t.expense_id = f.expense_id
      )
  `);
  await db
    .update(expenseShares)
    .set({ aliasId: toAliasId })
    .where(eq(expenseShares.aliasId, fromAliasId));
}
