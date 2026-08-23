import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
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
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(".pglite");
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

export { schema };
