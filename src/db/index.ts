import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleNeonWs } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __dbPromise?: Promise<Db> };

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (url) {
    return drizzleNeon(neon(url), { schema });
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is not set. Connect a Neon/Vercel Postgres database and set DATABASE_URL (or POSTGRES_URL)."
    );
  }
  // Local development fallback: embedded Postgres (PGlite) persisted under
  // .pglite/, with migrations applied on first connect. Zero setup required.
  // PGLITE_DIR lets test scripts point at a throwaway directory instead of
  // the developer's live data.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(process.env.PGLITE_DIR ?? ".pglite");
  const db = drizzlePglite(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  if (!globalForDb.__dbPromise) {
    globalForDb.__dbPromise = init();
  }
  return globalForDb.__dbPromise;
}

/**
 * Run `fn` inside a real database transaction, so multi-statement mutations
 * (delete-then-reinsert of payers/shares, group deletion, alias merges) can
 * never be left half-applied by a mid-flight failure.
 *
 * The everyday `getDb()` handle stays on the Neon HTTP driver (cheapest for
 * single reads) which cannot do interactive transactions — so this opens a
 * short-lived WebSocket Pool per call in production. PGlite (local dev)
 * supports transactions natively. The `tx` handle is structurally the same
 * query-builder surface as `Db`; the casts below bridge the driver-specific
 * transaction types.
 */
export async function withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    const db = (await getDb()) as unknown as {
      transaction: <R>(f: (tx: unknown) => Promise<R>) => Promise<R>;
    };
    return db.transaction(async (tx) => fn(tx as unknown as Db));
  }
  // Node < 22 has no global WebSocket client; hand the driver the ws package.
  if (!neonConfig.webSocketConstructor && typeof WebSocket === "undefined") {
    const { default: ws } = await import("ws");
    neonConfig.webSocketConstructor = ws as unknown as typeof globalThis.WebSocket;
  }
  const pool = new Pool({ connectionString: url });
  try {
    const db = drizzleNeonWs(pool, { schema });
    return await db.transaction(async (tx) => fn(tx as unknown as Db));
  } finally {
    await pool.end();
  }
}

export { schema };
