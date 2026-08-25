/* Account-deletion engine tests (RFC 08 §3.1) against in-memory PGlite:
   classifier, detach semantics (other members' balances byte-identical),
   solo-group teardown, image purge, tombstone, idempotent re-run, and the
   RESTRICT guard on groups.user_id.
   Run: npm run test:account */
import { strict as assert } from "node:assert";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import {
  activityLog,
  aliases,
  expensePayers,
  expenseShares,
  expenses,
  groupMembers,
  groups,
  receiptScanImages,
  receiptScans,
  users,
} from "../src/db/schema";
import {
  classifyGroupsForDeletion,
  executeAccountDeletion,
} from "../src/lib/account-deletion";
import { loadGroupData } from "../src/lib/group-data";
import { ACTIVITY_TOMBSTONE } from "../src/lib/types";

async function main() {
  const db = await getDb();

  // ---- fixture ----
  const [ana] = await db.insert(users).values({ email: "ana@test.local", name: "Ana" }).returning();
  const [ben] = await db.insert(users).values({ email: "ben@test.local", name: "Ben" }).returning();

  // Ana's solo group: virtual member + expense + scan with image.
  const [solo] = await db
    .insert(groups)
    .values({ userId: ana.id, name: "Solo", currency: "EUR" })
    .returning();
  const [soloAna] = await db
    .insert(aliases)
    .values({ groupId: solo.id, name: "Ana", userId: ana.id })
    .returning();
  const [soloVirt] = await db
    .insert(aliases)
    .values({ groupId: solo.id, name: "Мария" })
    .returning();
  const [soloExp] = await db
    .insert(expenses)
    .values({ groupId: solo.id, description: "Обяд", amountCents: 2000, currency: "EUR", date: "2026-08-01" })
    .returning();
  await db.insert(expensePayers).values({ expenseId: soloExp.id, aliasId: soloAna.id, paidCents: 2000 });
  await db.insert(expenseShares).values([
    { expenseId: soloExp.id, aliasId: soloAna.id, owedCents: 1000, splitValue: null },
    { expenseId: soloExp.id, aliasId: soloVirt.id, owedCents: 1000, splitValue: null },
  ]);

  // Ben's group where Ana is a member; expenses involve both. Ana scanned a
  // receipt there (image must die with her account, items must survive).
  const [shared] = await db
    .insert(groups)
    .values({ userId: ben.id, name: "Shared", currency: "EUR" })
    .returning();
  const [shBen] = await db
    .insert(aliases)
    .values({ groupId: shared.id, name: "Ben", userId: ben.id })
    .returning();
  const [shAna] = await db
    .insert(aliases)
    .values({ groupId: shared.id, name: "Ana", userId: ana.id })
    .returning();
  await db.insert(groupMembers).values({ groupId: shared.id, userId: ana.id });
  const [shExp] = await db
    .insert(expenses)
    .values({ groupId: shared.id, description: "Вечеря", amountCents: 3000, currency: "EUR", date: "2026-08-02" })
    .returning();
  await db.insert(expensePayers).values({ expenseId: shExp.id, aliasId: shAna.id, paidCents: 3000 });
  await db.insert(expenseShares).values([
    { expenseId: shExp.id, aliasId: shAna.id, owedCents: 1500, splitValue: null },
    { expenseId: shExp.id, aliasId: shBen.id, owedCents: 1500, splitValue: null },
  ]);
  const [shScan] = await db
    .insert(receiptScans)
    .values({
      groupId: shared.id,
      createdBy: ana.id,
      date: "2026-08-02",
      currency: "EUR",
      totalCents: 3000,
      imageHash: "hash-1",
    })
    .returning();
  await db.insert(receiptScanImages).values({
    scanId: shScan.id,
    data: new Uint8Array([1, 2, 3]),
    contentType: "image/jpeg",
    byteSize: 3,
  });
  await db.insert(activityLog).values({
    groupId: shared.id,
    actorUserId: ana.id,
    actorName: "Ana",
    action: "expense.added",
    details: { description: "Вечеря", amountCents: 3000, currency: "EUR" },
  });

  // Ana's conflicted group: she owns it, Ben is a member.
  const [conf] = await db
    .insert(groups)
    .values({ userId: ana.id, name: "Conflicted", currency: "EUR" })
    .returning();
  await db.insert(aliases).values({ groupId: conf.id, name: "Ana", userId: ana.id });
  await db.insert(groupMembers).values({ groupId: conf.id, userId: ben.id });

  // ---- classifier ----
  const overview = await classifyGroupsForDeletion(db, ana.id);
  assert.deepEqual(overview.memberGroups.map((g) => g.name), ["Shared"]);
  assert.deepEqual(overview.soloGroups.map((g) => g.name), ["Solo"]);
  assert.deepEqual(overview.conflictedGroups.map((g) => g.name), ["Conflicted"]);
  assert.deepEqual(overview.conflictedGroups[0].members.map((m) => m.name), ["Ben"]);

  // Deletion refuses while a conflicted group remains.
  await assert.rejects(executeAccountDeletion(db, { id: ana.id, name: "Ana", email: ana.email }));

  // RESTRICT guard: a raw DELETE on a user who still owns a group must fail
  // at the database.
  await assert.rejects(db.delete(users).where(eq(users.id, ana.id)));

  // Resolve the conflict the "delete the group" way (simplest for the test).
  await db.delete(aliases).where(eq(aliases.groupId, conf.id));
  await db.delete(groups).where(eq(groups.id, conf.id));

  // Snapshot Ben's view of the shared group before Ana is deleted.
  const before = await loadGroupData(shared.id, ben.id);
  assert.ok(before);

  // ---- the deletion itself ----
  await executeAccountDeletion(db, { id: ana.id, name: "Ana", email: ana.email });

  // users row gone; solo group fully gone.
  assert.equal((await db.select().from(users).where(eq(users.id, ana.id))).length, 0);
  assert.equal((await db.select().from(groups).where(eq(groups.id, solo.id))).length, 0);
  assert.equal((await db.select().from(expenses).where(eq(expenses.groupId, solo.id))).length, 0);

  // Shared group: Ana's alias survives detached; expense rows untouched;
  // Ben's balances byte-identical (modulo Ana's membership disappearing).
  const anaAlias = (await db.select().from(aliases).where(eq(aliases.id, shAna.id)))[0];
  assert.ok(anaAlias);
  assert.equal(anaAlias.userId, null);
  const after = await loadGroupData(shared.id, ben.id);
  assert.ok(after);
  assert.deepEqual(after.netBalances, before!.netBalances);
  assert.deepEqual(after.pairwiseDebts, before!.pairwiseDebts);
  assert.deepEqual(
    after.expenses.map((e) => ({ id: e.id, payers: e.payers, shares: e.shares })),
    before!.expenses.map((e) => ({ id: e.id, payers: e.payers, shares: e.shares }))
  );

  // Scan row + items survive; the image is gone.
  assert.equal((await db.select().from(receiptScans).where(eq(receiptScans.id, shScan.id))).length, 1);
  assert.equal(
    (await db.select().from(receiptScanImages).where(eq(receiptScanImages.scanId, shScan.id))).length,
    0
  );

  // Activity log: actor tombstoned, details untouched.
  const logRows = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.groupId, shared.id));
  const anaEntry = logRows.find((r) => r.action === "expense.added");
  assert.ok(anaEntry);
  assert.equal(anaEntry.actorName, ACTIVITY_TOMBSTONE);
  assert.equal(anaEntry.actorUserId, null);
  assert.equal((anaEntry.details as { description: string }).description, "Вечеря");

  // Idempotency: re-running for the now-gone user is a clean no-op.
  await executeAccountDeletion(db, { id: ana.id, name: "Ana", email: ana.email });

  console.log("All account-deletion tests passed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
