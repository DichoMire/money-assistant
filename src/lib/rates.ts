export const RATES_STALE_DAYS = 7;

export type FxRow = { date: string; rates: Record<string, number> };

/**
 * Pick the rate row for a transaction date: the latest row on or before the
 * date, or — when the transaction predates all stored rates — the earliest
 * row available. `rows` must be sorted ascending by date.
 */
export function findRateRow(rows: FxRow[], dateStr: string): FxRow | null {
  if (rows.length === 0) return null;
  let candidate: FxRow | null = null;
  for (const row of rows) {
    if (row.date <= dateStr) candidate = row;
    else break;
  }
  return candidate ?? rows[0];
}

/** Convert integer cents between currencies using an EUR-based rate row. */
export function convertCents(
  cents: number,
  from: string,
  to: string,
  row: FxRow | null
): number | null {
  if (from === to) return cents;
  if (!row) return null;
  const rateOf = (code: string) => (code === "EUR" ? 1 : row.rates[code]);
  const fromRate = rateOf(from);
  const toRate = rateOf(to);
  if (!fromRate || !toRate) return null;
  return Math.round((cents * toRate) / fromRate);
}

export function daysBetween(fromDate: string, toDate: string): number {
  const ms = new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime();
  return Math.floor(ms / 86_400_000);
}

/** True when the newest stored rate is missing or older than RATES_STALE_DAYS. */
export function ratesAreStale(latestDate: string | null, today: string): boolean {
  if (!latestDate) return true;
  return daysBetween(latestDate, today) > RATES_STALE_DAYS;
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}
