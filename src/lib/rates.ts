export const RATES_STALE_DAYS = 7;

export type FxRow = { date: string; rates: Record<string, number> };

/**
 * Legally fixed conversion rates of currencies replaced by the euro, in units
 * of the legacy currency per 1 EUR. These are the full-precision rates set by
 * EU Council regulation — never rounded, never inverted (Reg. 1103/97 Art. 4/5)
 * — and they take precedence over any stored ECB reference row (the ECB
 * reference for BGN was 4-decimal 1.9558, which must not be used to convert).
 * BGN fixed 2026-01-01 (Council Reg. (EU) 2025/1408); HRK fixed 2023-01-01.
 */
export const FIXED_EUR_RATES: Record<string, number> = {
  BGN: 1.95583,
  HRK: 7.5345,
};

/** True when converting `from` -> `to` needs no ECB rate row (fixed legs only). */
export function isFixedLegPair(from: string, to: string): boolean {
  const fixedOrEur = (c: string) => c === "EUR" || FIXED_EUR_RATES[c] !== undefined;
  return from === to || (fixedOrEur(from) && fixedOrEur(to));
}

/**
 * Round half away from zero, as the euro-adoption rounding rules require
 * (ЗВЕРБ Art. 13). JS Math.round(-0.5) gives -0 (rounds toward +∞), so
 * negatives need the sign-aware form.
 */
export function roundHalfUp(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

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

/** EUR cents -> BGN stotinki at the fixed rate (informational display only). */
export function eurToBgnCents(eurCents: number): number {
  return roundHalfUp(eurCents * FIXED_EUR_RATES.BGN);
}

/**
 * Convert integer cents between currencies. Currencies replaced by the euro
 * (BGN, HRK) convert through their fixed legal rate and need no rate row at
 * all; anything else resolves through the EUR-based ECB row. Mixed pairs
 * (e.g. BGN -> USD) chain the fixed leg first, rounding to integer cents at
 * the legal conversion boundary. Returns null only when a floating leg has no
 * available rate.
 */
export function convertCents(
  cents: number,
  from: string,
  to: string,
  row: FxRow | null
): number | null {
  if (from === to) return cents;
  const fixedFrom = FIXED_EUR_RATES[from];
  const fixedTo = FIXED_EUR_RATES[to];

  if (fixedFrom !== undefined || fixedTo !== undefined) {
    // Leg 1: normalize to EUR cents.
    let eurCents: number;
    if (from === "EUR") {
      eurCents = cents;
    } else if (fixedFrom !== undefined) {
      // Divide by the full 5-decimal rate, half-up per amount — never inverse.
      eurCents = roundHalfUp(cents / fixedFrom);
    } else {
      const rate = row?.rates[from];
      if (!rate) return null;
      eurCents = roundHalfUp(cents / rate);
    }
    // Leg 2: EUR cents to the target.
    if (to === "EUR") return eurCents;
    if (fixedTo !== undefined) return roundHalfUp(eurCents * fixedTo);
    const toRate = row?.rates[to];
    if (!toRate) return null;
    return roundHalfUp(eurCents * toRate);
  }

  // Floating <-> floating: single-step ECB cross via the EUR base (unchanged
  // legacy behavior — no intermediate rounding).
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

/**
 * Today's date in Bulgarian local time. The user base is in Europe/Sofia
 * (UTC+2/+3); a UTC date would default expenses logged between midnight and
 * 03:00 to yesterday. en-CA yields YYYY-MM-DD directly.
 */
export function todayString(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());
}
