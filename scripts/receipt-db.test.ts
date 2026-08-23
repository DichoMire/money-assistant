/* DB-level sanity for the receipt tables against an IN-MEMORY PGlite: the
   migration folder applies cleanly, bytea round-trips, cascades and the
   expense SET NULL link behave. Run: npm run test:receipt-db */
import { strict as assert } from "node:assert";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

async function main() {
  const client = new PGlite(); // in-memory — never touches .pglite/
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });

  const [user] = await db
    .insert(schema.users)
    .values({ email: "test@example.com", name: "Test" })
    .returning();
  const [group] = await db
    .insert(schema.groups)
    .values({ userId: user.id, name: "Trip", currency: "EUR" })
    .returning();
  const [alias] = await db
    .insert(schema.aliases)
    .values({ groupId: group.id, name: "Ana", userId: user.id })
    .returning();

  // ---- scan + image + items + shares ----
  const [scan] = await db
    .insert(schema.receiptScans)
    .values({
      groupId: group.id,
      createdBy: user.id,
      merchant: "Lidl",
      date: "2026-08-23",
      currency: "EUR",
      totalCents: 358,
      imageHash: "abc123",
    })
    .returning();
  assert.equal(scan.status, "draft");

  // bytea round-trip, including 0x00/0xff edges
  const bytes = new Uint8Array(512).map((_, i) => i % 256);
  await db.insert(schema.receiptScanImages).values({
    scanId: scan.id,
    data: bytes,
    contentType: "image/jpeg",
    byteSize: bytes.byteLength,
  });
  const [image] = await db
    .select()
    .from(schema.receiptScanImages)
    .where(eq(schema.receiptScanImages.scanId, scan.id));
  assert.ok(image.data instanceof Uint8Array);
  assert.deepEqual([...image.data], [...bytes]);

  const [item] = await db
    .insert(schema.receiptItems)
    .values({
      scanId: scan.id,
      position: 0,
      name: "Milk",
      quantity: 0.734, // fractional weighted quantity survives
      totalCents: -100, // negative line survives
      assignMode: "single",
    })
    .returning();
  await db.insert(schema.receiptItemShares).values({ itemId: item.id, aliasId: alias.id, exactCents: null });
  const [readItem] = await db.select().from(schema.receiptItems).where(eq(schema.receiptItems.id, item.id));
  assert.equal(readItem.quantity, 0.734);
  assert.equal(readItem.totalCents, -100);

  // ---- expense link SET NULL on expense delete ----
  const [expense] = await db
    .insert(schema.expenses)
    .values({ groupId: group.id, description: "Lidl", amountCents: 358, currency: "EUR", date: "2026-08-23" })
    .returning();
  await db
    .update(schema.receiptScans)
    .set({ expenseId: expense.id, status: "converted" })
    .where(eq(schema.receiptScans.id, scan.id));
  await db.delete(schema.expenses).where(eq(schema.expenses.id, expense.id));
  const [afterExpenseDelete] = await db
    .select()
    .from(schema.receiptScans)
    .where(eq(schema.receiptScans.id, scan.id));
  assert.equal(afterExpenseDelete.expenseId, null); // link nulled, scan kept

  // ---- alias delete cascades only the share rows ----
  const [virtual] = await db.insert(schema.aliases).values({ groupId: group.id, name: "Guest" }).returning();
  await db.insert(schema.receiptItemShares).values({ itemId: item.id, aliasId: virtual.id, exactCents: 50 });
  await db.delete(schema.aliases).where(eq(schema.aliases.id, virtual.id));
  const sharesAfter = await db
    .select()
    .from(schema.receiptItemShares)
    .where(eq(schema.receiptItemShares.itemId, item.id));
  assert.equal(sharesAfter.length, 1); // Guest's row gone, Ana's kept

  // ---- scan delete cascades image + items + shares in one statement ----
  await db.delete(schema.receiptScans).where(eq(schema.receiptScans.id, scan.id));
  assert.equal((await db.select().from(schema.receiptScanImages)).length, 0);
  assert.equal((await db.select().from(schema.receiptItems)).length, 0);
  assert.equal((await db.select().from(schema.receiptItemShares)).length, 0);

  await client.close();
  console.log("All receipt DB tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
