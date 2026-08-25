/**
 * Validation/normalization for stored payment details (RFC 03). Pure and
 * isomorphic — used by the server actions (authoritative) and the entry form
 * (feedback). Philosophy: strict on IBAN (a wrong IBAN sends money to the
 * wrong place; mod-97 catches typos), permissive on the rest.
 */

/** Uppercase, no spaces/dots — the canonical stored form. */
export function normalizeIban(input: string): string {
  return input.replace(/[\s.]/g, "").toUpperCase();
}

/** SEPA-country IBAN lengths (subset — any other country: structural check only). */
const IBAN_LENGTHS: Record<string, number> = {
  BG: 22, // Bulgarian banks
  LT: 20, // Revolut Bank UAB
  DE: 22, GR: 27, RO: 24, FR: 27, ES: 24, IT: 27, NL: 18, BE: 16, AT: 20,
  IE: 22, PT: 25, PL: 28, CZ: 24, SK: 24, HU: 28, HR: 21, SI: 19, EE: 20,
  LV: 21, FI: 18, DK: 18, SE: 24, NO: 15, GB: 22, CH: 21, LU: 20, MT: 31, CY: 28,
};

/** ISO 13616 checksum: rearrange, map letters to numbers, mod 97 must be 1. */
export function isValidIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected !== undefined && iban.length !== expected) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** "BG80 BNBG 9661 ..." — display form; copy actions use the compact form. */
export function formatIbanGroups(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Normalize a phone number toward E.164, with the Bulgarian convention as the
 * default: "0888 123 456" -> "+359888123456". Returns null when unusable.
 */
export function normalizePhone(input: string): string | null {
  let s = input.replace(/[\s\-()./]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("0") && /^\d{9,10}$/.test(s)) s = `+359${s.slice(1)}`;
  if (!/^\+\d{7,15}$/.test(s)) return null;
  return s;
}

/** revolut.me username: strip URL/@ prefixes, keep permissive (rules unverified). */
export function normalizeRevolutTag(input: string): string | null {
  const s = input
    .trim()
    .replace(/^https?:\/\/(www\.)?revolut\.me\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");
  if (!/^[a-z0-9_.-]{2,32}$/i.test(s)) return null;
  return s;
}

export const SETTLE_METHODS = ["cash", "bank", "blink", "revolut", "other"] as const;
export type SettleMethod = (typeof SETTLE_METHODS)[number];

export function isSettleMethod(value: unknown): value is SettleMethod {
  return (SETTLE_METHODS as readonly string[]).includes(value as string);
}
