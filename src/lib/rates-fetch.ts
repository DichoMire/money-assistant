import { desc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { fxRates } from "@/db/schema";
import { daysBetween, todayString } from "./rates";

const API_BASE = "https://api.frankfurter.dev/v1";
const BACKFILL_DAYS = 90;
/** Cap for gap repair after long outages — bounds the range-response size. */
const MAX_GAP_REPAIR_DAYS = 400;

type LatestResponse = { base: string; date: string; rates: Record<string, number> };
type RangeResponse = { base: string; rates: Record<string, Record<string, number>> };

function shiftDateISO(dateISO: string, days: number): string {
  return new Date(new Date(`${dateISO}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Any weekday strictly between the two dates? (ECB publishes business days.) */
export function hasMissingWeekdayBetween(fromISO: string, toISO: string): boolean {
  for (let d = shiftDateISO(fromISO, 1); d < toISO; d = shiftDateISO(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) return true;
  }
  return false;
}

/**
 * Fetch the latest ECB reference rates and store them. On the very first run
 * (empty table) it also backfills the last 90 days so historical expenses can
 * be converted at their transaction date. Missed cron days are repaired: when
 * weekdays are missing between the newest stored row and the newly published
 * date, the whole gap is fetched via the time-series endpoint (TARGET
 * holidays legitimately have no data and stop mattering once a newer row
 * exists, so old holes are never re-fetched).
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

    const newestStored = await db
      .select({ date: fxRates.date })
      .from(fxRates)
      .orderBy(desc(fxRates.date))
      .limit(1);
    const newest = newestStored[0]?.date;
    if (newest && newest < data.date && hasMissingWeekdayBetween(newest, data.date)) {
      const start =
        daysBetween(newest, data.date) > MAX_GAP_REPAIR_DAYS
          ? shiftDateISO(data.date, -MAX_GAP_REPAIR_DAYS)
          : newest;
      const gapRes = await fetch(`${API_BASE}/${start}..${data.date}`, { cache: "no-store" });
      if (gapRes.ok) {
        const gapData = (await gapRes.json()) as RangeResponse;
        for (const [date, rates] of Object.entries(gapData.rates)) {
          rows.push({ date, rates });
        }
      }
      // A failed repair is not fatal — the day's own row below still lands.
    }
    if (!rows.some((r) => r.date === data.date)) {
      rows.push({ date: data.date, rates: data.rates });
    }
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
