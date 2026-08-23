/* Seeds the LOCAL PGlite dev database with a demo group and a parsed receipt
   scan, so the receipt review UI can be tried without an OpenRouter key.
   Stop `npm run dev` first (PGlite allows one process), then:
     npm run seed:scan
   Sign in afterwards with dev@example.com. Safe to re-run (idempotent-ish:
   skips seeding when the demo scan already exists). */
import { eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";

const DEMO_HASH = "seed-demo-scan";

// Minimal valid 1x1 JPEG so the receipt-photo route has something to serve.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCwAB//2Q==",
  "base64"
);

async function main() {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    console.error("Refusing to seed: DATABASE_URL is set (this script is for local PGlite only).");
    process.exit(1);
  }
  const client = new PGlite(".pglite");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });

  const [user] = await db
    .insert(schema.users)
    .values({ email: "dev@example.com", name: "dev" })
    .onConflictDoUpdate({ target: schema.users.email, set: { name: "dev" } })
    .returning();

  const existing = await db
    .select({ id: schema.receiptScans.id })
    .from(schema.receiptScans)
    .where(eq(schema.receiptScans.imageHash, DEMO_HASH));
  if (existing.length > 0) {
    console.log("Demo scan already seeded. Sign in as dev@example.com.");
    await client.close();
    return;
  }

  const [group] = await db
    .insert(schema.groups)
    .values({ userId: user.id, name: "Trip to Rila", currency: "EUR" })
    .returning();
  const aliasValues = [
    { groupId: group.id, name: "dev", userId: user.id },
    { groupId: group.id, name: "Maria", userId: null },
    { groupId: group.id, name: "Georgi", userId: null },
  ];
  for (const value of aliasValues) await db.insert(schema.aliases).values(value);

  const [scan] = await db
    .insert(schema.receiptScans)
    .values({
      groupId: group.id,
      createdBy: user.id,
      merchant: "Fantastico",
      date: "2026-08-22",
      currency: "EUR",
      totalCents: 2489,
      confidence: 0.91,
      reconciles: true,
      model: "seed-demo",
      imageHash: DEMO_HASH,
    })
    .returning();
  await db.insert(schema.receiptScanImages).values({
    scanId: scan.id,
    data: new Uint8Array(TINY_JPEG),
    contentType: "image/jpeg",
    byteSize: TINY_JPEG.byteLength,
  });
  const items = [
    { name: "Milk", rawText: "MLEKO 3.5% 2x1.29", quantity: 2, unitPriceCents: 129, totalCents: 258 },
    { name: "Bread", rawText: "HLQB PSHENICHEN", quantity: 1, unitPriceCents: null, totalCents: 145 },
    { name: "Beer", rawText: "BIRA PIRINSKO 3x1.80", quantity: 3, unitPriceCents: 180, totalCents: 540 },
    { name: "Bananas", rawText: "BANANI 0.734kg x 2.19", quantity: 0.734, unitPriceCents: 219, totalCents: 161 },
    { name: "Wine", rawText: "VINO MAVRUD 0.75L", quantity: 1, unitPriceCents: null, totalCents: 1485 },
    { name: "Coupon", rawText: "OTSTAPKA KLIENT", quantity: 1, unitPriceCents: null, totalCents: -100 },
  ];
  for (const [position, item] of items.entries()) {
    await db.insert(schema.receiptItems).values({
      scanId: scan.id,
      position,
      category: null,
      assignMode: "unassigned",
      ...item,
    });
  }
  await client.close();
  console.log(`Seeded group "${group.name}" with a demo scan. Sign in as dev@example.com.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
