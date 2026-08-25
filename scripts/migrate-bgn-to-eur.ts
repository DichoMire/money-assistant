/* One-time production data migration: convert every stored BGN row to EUR at
   the fixed legal rate (1 EUR = 1.95583 BGN) and drop the retired
   users.show_bgn_equivalent column, by executing drizzle/0007_remove-bgn.sql.

     Dry run (prints affected row counts):  npx tsx scripts/migrate-bgn-to-eur.ts
     Apply:                                 npx tsx scripts/migrate-bgn-to-eur.ts --yes

   Requires DATABASE_URL (the hosted Neon database): `npm run db:push` syncs
   the schema but never runs data statements, so this script covers those.
   Local dev PGlite applies migration 0007 automatically on next start.
   Safe to re-run: a second pass finds no BGN rows and changes nothing. */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb, withTransaction } from "../src/db";

async function main() {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.error(
      "DATABASE_URL is not set - refusing to run. This script targets the hosted database; local PGlite applies drizzle/0007_remove-bgn.sql on its own."
    );
    process.exit(1);
  }
  const db = await getDb();
  const count = async (table: string) => {
    const result = await db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE currency = 'BGN'`)
    );
    return Number(result.rows[0].n);
  };
  const before = {
    expenses: await count("expenses"),
    scans: await count("receipt_scans"),
    groups: await count("groups"),
  };
  console.log(
    `BGN rows: ${before.expenses} expenses, ${before.scans} receipt scans, ${before.groups} groups.`
  );

  if (!process.argv.includes("--yes")) {
    console.log("Dry run - nothing changed. Re-run with --yes to convert to EUR.");
    return;
  }

  const statements = readFileSync(new URL("../drizzle/0007_remove-bgn.sql", import.meta.url), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  await withTransaction(async (tx) => {
    for (const statement of statements) {
      await tx.execute(sql.raw(statement));
    }
  });
  console.log("Converted all BGN data to EUR and dropped users.show_bgn_equivalent.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
