/* End-to-end smoke test of schema + migrations + group-data pipeline against
   the embedded PGlite database. Run: npx tsx scripts/db-smoke.ts */
import { strict as assert } from "node:assert";
import { getDb } from "../src/db";
import { aliases, expensePayers, expenseShares, expenses, fxRates, groups, users } from "../src/db/schema";
import { loadGroupData, loadGroupSummaries } from "../src/lib/group-data";

async function main() {
  const db = await getDb();

  const [user] = await db.insert(users).values({ email: "smoke@test.local", name: "Smoke" }).returning();
  const [group] = await db.insert(groups).values({ userId: user.id, name: "Trip", currency: "USD" }).returning();
  const [anna] = await db.insert(aliases).values({ groupId: group.id, name: "Anna" }).returning();
  const [ben] = await db.insert(aliases).values({ groupId: group.id, name: "Ben" }).returning();
  const [cara] = await db.insert(aliases).values({ groupId: group.id, name: "Cara" }).returning();

  await db.insert(fxRates).values({ date: "2026-08-20", base: "EUR", rates: { USD: 1.1, BGN: 1.95583 } });

  // Anna paid $30, split equally three ways.
  const [e1] = await db
    .insert(expenses)
    .values({ groupId: group.id, description: "Dinner", amountCents: 3000, currency: "USD", date: "2026-08-21", splitMethod: "equal" })
    .returning();
  await db.insert(expensePayers).values({ expenseId: e1.id, aliasId: anna.id, paidCents: 3000 });
  await db.insert(expenseShares).values([
    { expenseId: e1.id, aliasId: anna.id, owedCents: 1000, splitValue: null },
    { expenseId: e1.id, aliasId: ben.id, owedCents: 1000, splitValue: null },
    { expenseId: e1.id, aliasId: cara.id, owedCents: 1000, splitValue: null },
  ]);

  // Ben paid 11.00 BGN for Cara (foreign currency, needs conversion).
  const [e2] = await db
    .insert(expenses)
    .values({ groupId: group.id, description: "Coffee", amountCents: 1100, currency: "BGN", date: "2026-08-22", splitMethod: "exact" })
    .returning();
  await db.insert(expensePayers).values({ expenseId: e2.id, aliasId: ben.id, paidCents: 1100 });
  await db.insert(expenseShares).values({ expenseId: e2.id, aliasId: cara.id, owedCents: 1100, splitValue: 1100 });

  const summaries = await loadGroupSummaries(user.id);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].aliasCount, 3);
  assert.equal(summaries[0].expenseCount, 2);

  const data = await loadGroupData(group.id, user.id);
  assert.ok(data);
  assert.equal(data.expenses.length, 2);

  const expectedConv = Math.round((1100 * 1.1) / 1.95583); // 619
  const coffee = data.expenses.find((e) => e.currency === "BGN")!;
  assert.equal(coffee.convertedCents, expectedConv);
  assert.equal(coffee.rateDate, "2026-08-20");

  assert.equal(data.netBalances[anna.id], 2000);
  assert.equal(data.netBalances[ben.id], expectedConv - 1000);
  assert.equal(data.netBalances[cara.id], -1000 - expectedConv);

  const pw = data.pairwiseDebts.map((d) => [d.fromAliasId, d.toAliasId, d.amountCents]);
  assert.deepEqual(
    pw.sort(),
    [
      [ben.id, anna.id, 1000],
      [cara.id, anna.id, 1000],
      [cara.id, ben.id, expectedConv],
    ].sort()
  );

  // Nets: Anna +2000, Ben (619 - 1000) = -381, Cara -(1000 + 619) = -1619.
  const simp = data.simplifiedDebts.map((d) => [d.fromAliasId, d.toAliasId, d.amountCents]);
  assert.deepEqual(
    simp.sort(),
    [
      [cara.id, anna.id, 1000 + expectedConv],
      [ben.id, anna.id, 1000 - expectedConv],
    ].sort()
  );

  assert.equal(data.rates.needsConversion, true);
  assert.equal(data.rates.missingRate, false);
  assert.equal(data.rates.latestDate, "2026-08-20");

  // Ownership check: another user must not see this group.
  const [other] = await db.insert(users).values({ email: "other@test.local" }).returning();
  assert.equal(await loadGroupData(group.id, other.id), null);
}

main()
  .then(() => {
    console.log("DB smoke test passed.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
