import type { Locale } from "./i18n";

const BCP47: Record<Locale, string> = { en: "en-US", bg: "bg-BG" };
const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * Locale-aware money formatting: en -> "€12.34", bg -> "12,34 €" (decimal
 * comma, symbol after the amount, per CLDR bg conventions). The locale
 * defaults to "en" so stored audit-log fragments keep their historical
 * formatting; UI call sites pass the viewer's locale.
 */
export function formatCents(cents: number, currency: string, locale: Locale = "en"): string {
  const key = `${locale}:${currency}`;
  try {
    let fmt = formatterCache.get(key);
    if (!fmt) {
      fmt = new Intl.NumberFormat(BCP47[locale] ?? "en-US", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      });
      formatterCache.set(key, fmt);
    }
    return fmt.format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

const symbolCache = new Map<string, string>();

/** Narrow symbol for a currency ("€", "$"), falling back to the code. */
export function currencySymbol(currency: string, locale: Locale = "en"): string {
  const key = `sym:${locale}:${currency}`;
  const cached = symbolCache.get(key);
  if (cached) return cached;
  let symbol = currency;
  try {
    const fmt = new Intl.NumberFormat(BCP47[locale] ?? "en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    });
    symbol = fmt.formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    /* unknown code — keep the code itself */
  }
  symbolCache.set(key, symbol);
  return symbol;
}

/** Locale-styled placeholder for amount inputs ("0.00" en, "0,00" bg). */
export function amountPlaceholder(locale: Locale = "en", signed = false): string {
  const zero = locale === "bg" ? "0,00" : "0.00";
  return signed ? `±${zero}` : zero;
}

// Spaces users type as thousands separators. JS \s already matches NBSP
// (U+00A0) and narrow NBSP (U+202F), which bg-BG formatting itself produces,
// so pasted amounts round-trip.
const SPACE_RE = /\s/g;

/**
 * Parse a user-typed amount into integer cents, accepting both the Bulgarian
 * ("1 234,56", "12,34") and English ("1,234.56", "12.34") conventions.
 * Deterministic rules, rightmost-separator-wins:
 *  - both "." and "," present -> the rightmost one is the decimal separator;
 *  - a single separator followed by exactly 3 digits is a thousands separator
 *    ("1.234" -> 1234.00), by 1-2 digits a decimal one ("1.23" -> 1.23);
 *  - more than 2 decimal digits is invalid ("1,2345" -> null).
 * Returns null if invalid.
 */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(SPACE_RE, "");
  if (s === "") return null;
  let sign = 1;
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimalSep: string | null = null;
  if (lastDot !== -1 && lastComma !== -1) {
    decimalSep = lastDot > lastComma ? "." : ",";
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const occurrences = s.split(sep).length - 1;
    const trailing = s.length - 1 - Math.max(lastDot, lastComma);
    if (occurrences > 1 || trailing === 3) decimalSep = null; // thousands grouping
    else if (trailing <= 2) decimalSep = sep;
    else return null; // e.g. "1,2345"
  }

  let intPart = s;
  let decPart = "";
  if (decimalSep) {
    const at = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, at);
    decPart = s.slice(at + 1);
  }
  const groupingSep = decimalSep === "." ? "," : decimalSep === "," ? "." : null;
  if (groupingSep) intPart = intPart.split(groupingSep).join("");
  if (!decimalSep) intPart = intPart.replace(/[.,]/g, "");
  if (intPart === "" && decPart === "") return null;
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart) || decPart.length > 2) return null;

  const cents = Number(intPart || "0") * 100 + Number((decPart || "0").padEnd(2, "0").slice(0, 2));
  if (!Number.isFinite(cents)) return null;
  return sign * cents;
}

/** Parse a plain number ("2", "33.33", "33,33", "-5") for percent/share/adjustment inputs. */
export function parseNumber(input: string): number | null {
  const normalized = input.trim().replace(SPACE_RE, "").replace(",", ".");
  if (normalized === "") return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Split totalCents proportionally to weights into integers that sum exactly to
 * totalCents (largest-remainder method). Weights must be non-negative with a
 * positive sum. Works for negative totals too (used when netting).
 */
export function allocateByWeights(totalCents: number, weights: number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) throw new Error("allocateByWeights: weight sum must be positive");
  const sign = totalCents < 0 ? -1 : 1;
  const absTotal = Math.abs(totalCents);
  const exact = weights.map((w) => (absTotal * w) / weightSum);
  const floors = exact.map(Math.floor);
  let remainder = absTotal - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ frac: value - Math.floor(value), index }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  const result = [...floors];
  for (let i = 0; remainder > 0; i = (i + 1) % order.length) {
    result[order[i].index] += 1;
    remainder -= 1;
  }
  return result.map((v) => sign * v);
}
