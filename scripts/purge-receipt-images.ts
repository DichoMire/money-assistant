/* One-off backfill for the receipt-image retention policy (RFC 08 §3.5):
   deletes stored photos of already-converted scans (unless keep_image) and of
   drafts untouched for 30+ days. The daily cron keeps this true afterwards —
   this script exists to clean up history from before the policy shipped.

   Dry-run by default (prints counts); pass --yes to apply.
   Set DATABASE_URL to run against the hosted database.
   Run: npx tsx scripts/purge-receipt-images.ts [--yes] */
import { sql } from "drizzle-orm";
import { getDb } from "../src/db";

const APPLY = process.argv.includes("--yes");

async function main() {
  const db = await getDb();
  const candidates = await db.execute(sql`
    SELECT count(*)::int AS count, coalesce(sum(i.byte_size), 0)::bigint AS bytes
    FROM receipt_scan_images i
    JOIN receipt_scans s ON s.id = i.scan_id
    WHERE (s.expense_id IS NOT NULL AND s.keep_image = false)
       OR (s.expense_id IS NULL AND s.updated_at < now() - interval '30 days')
  `);
  const row = (candidates as unknown as { rows: { count: number; bytes: string }[] }).rows[0];
  console.log(`Images eligible for deletion: ${row.count} (${row.bytes} bytes)`);
  if (!APPLY) {
    console.log("Dry run — pass --yes to delete them.");
    return;
  }
  await db.execute(sql`
    DELETE FROM receipt_scan_images WHERE scan_id IN (
      SELECT id FROM receipt_scans
      WHERE (expense_id IS NOT NULL AND keep_image = false)
         OR (expense_id IS NULL AND updated_at < now() - interval '30 days')
    )
  `);
  console.log("Deleted.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
