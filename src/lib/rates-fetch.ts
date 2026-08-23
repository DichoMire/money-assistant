import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { fxRates } from "@/db/schema";
import { todayString } from "./rates";

const API_BASE = "https://api.frankfurter.dev/v1";
const BACKFILL_DAYS = 90;

type LatestResponse = { base: string; date: string; rates: Record<string, number> };
type RangeResponse = { base: string; rates: Record<string, Record<string, number>> };

/**
 * Fetch the latest ECB reference rates and store them. On the very first run
 * (empty table) it also backfills the last 90 days so historical expenses can
 * be converted at their transaction date.
 */
export async function refreshRates(): Promise<{ storedDates: number; latestDate: string }> {
  const db = await getDb();
  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(fxRates);
  const isEmpty = (existing[0]?.count ?? 0) === 0;

  const rows: { date: string; rates: Record<string, number> }[] = [];

  if (isEmpty) {
    const start = new Date(Date.now() - BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10);
    const res = await fetch(`${API_BASE}/${start}..${todayString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Frankfurter range request failed: ${res.status}`);
    const data = (await res.json()) as RangeResponse;
    for (const [date, rates] of Object.entries(data.rates)) {
      rows.push({ date, rates });
    }
  } else {
    const res = await fetch(`${API_BASE}/latest`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Frankfurter latest request failed: ${res.status}`);
    const data = (await res.json()) as LatestResponse;
    rows.push({ date: data.date, rates: data.rates });
  }

  for (const row of rows) {
    await db
      .insert(fxRates)
      .values({ date: row.date, base: "EUR", rates: row.rates, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: fxRates.date,
        set: { rates: row.rates, fetchedAt: new Date() },
      });
  }

  const latestDate = rows.map((r) => r.date).sort().at(-1) ?? todayString();
  return { storedDates: rows.length, latestDate };
}
