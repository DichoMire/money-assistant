import { enT, type TFunc } from "./i18n";
import { allocateByWeights, formatCents } from "./money";

export const SPLIT_METHODS = ["equal", "exact", "percent", "shares", "adjustment"] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

/**
 * One participant entry of the split as entered in the UI.
 * The meaning of `value` depends on the method:
 *  - equal:      ignored (inclusion in the list means the person participates)
 *  - exact:      cents this person owes
 *  - percent:    percentage (0..100)
 *  - shares:     share count (>= 0)
 *  - adjustment: cents on top of (or below, if negative) the equal base share
 */
export type SplitEntry = { aliasId: string; value: number };

export type ComputedShare = { aliasId: string; owedCents: number; splitValue: number | null };

export type SplitResult =
  | { ok: true; shares: ComputedShare[] }
  | { ok: false; error: string };

export function computeShares(
  method: SplitMethod,
  totalCents: number,
  entries: SplitEntry[],
  currency: string,
  t: TFunc = enT
): SplitResult {
  if (totalCents <= 0) return { ok: false, error: t("splitError.amountGreaterZero") };
  if (entries.length === 0) return { ok: false, error: t("split.selectAtLeastOne") };

  switch (method) {
    case "equal": {
      const owed = allocateByWeights(totalCents, entries.map(() => 1));
      return {
        ok: true,
        shares: entries.map((e, i) => ({ aliasId: e.aliasId, owedCents: owed[i], splitValue: null })),
      };
    }
    case "exact": {
      const sum = entries.reduce((a, e) => a + Math.round(e.value), 0);
      if (entries.some((e) => e.value < 0)) return { ok: false, error: t("splitError.amountsNegative") };
      if (sum !== totalCents) {
        return {
          ok: false,
          error: t("splitError.amountsSum", {
            sum: formatCents(sum, currency, t.locale),
            total: formatCents(totalCents, currency, t.locale),
          }),
        };
      }
      return {
        ok: true,
        shares: entries.map((e) => ({
          aliasId: e.aliasId,
          owedCents: Math.round(e.value),
          splitValue: Math.round(e.value),
        })),
      };
    }
    case "percent": {
      const sum = entries.reduce((a, e) => a + e.value, 0);
      if (entries.some((e) => e.value < 0)) return { ok: false, error: t("splitError.percentNegative") };
      if (Math.abs(sum - 100) > 0.01) {
        return { ok: false, error: t("splitError.percentSum", { sum: round2(sum) }) };
      }
      const positive = entries.filter((e) => e.value > 0);
      if (positive.length === 0) return { ok: false, error: t("splitError.percentAboveZero") };
      const owed = allocateByWeights(totalCents, positive.map((e) => e.value));
      return {
        ok: true,
        shares: positive.map((e, i) => ({ aliasId: e.aliasId, owedCents: owed[i], splitValue: e.value })),
      };
    }
    case "shares": {
      if (entries.some((e) => e.value < 0)) return { ok: false, error: t("splitError.sharesNegative") };
      const positive = entries.filter((e) => e.value > 0);
      if (positive.length === 0) return { ok: false, error: t("splitError.shareAboveZero") };
      const owed = allocateByWeights(totalCents, positive.map((e) => e.value));
      return {
        ok: true,
        shares: positive.map((e, i) => ({ aliasId: e.aliasId, owedCents: owed[i], splitValue: e.value })),
      };
    }
    case "adjustment": {
      // Everyone gets an equal cut of what remains after the adjustments,
      // plus their own adjustment (Splitwise "+/- adjustment" semantics).
      const adjustmentSum = entries.reduce((a, e) => a + Math.round(e.value), 0);
      const base = totalCents - adjustmentSum;
      if (base < 0) {
        return {
          ok: false,
          error: t("splitError.adjustmentsSum", { sum: formatCents(adjustmentSum, currency, t.locale) }),
        };
      }
      const baseShares = allocateByWeights(base, entries.map(() => 1));
      const shares = entries.map((e, i) => ({
        aliasId: e.aliasId,
        owedCents: baseShares[i] + Math.round(e.value),
        splitValue: Math.round(e.value),
      }));
      const negative = shares.find((s) => s.owedCents < 0);
      if (negative) {
        return { ok: false, error: t("splitError.adjustmentNegative") };
      }
      return { ok: true, shares };
    }
  }
}

/** Validate the "who paid" side. Returns an error string or null. */
export function validatePayers(
  totalCents: number,
  payers: { aliasId: string; paidCents: number }[],
  currency: string,
  t: TFunc = enT
): string | null {
  if (payers.length === 0) return t("splitError.selectWhoPaid");
  if (payers.some((p) => p.paidCents < 0)) return t("splitError.paidNegative");
  const sum = payers.reduce((a, p) => a + p.paidCents, 0);
  if (sum !== totalCents) {
    return t("splitError.paymentsSum", {
      sum: formatCents(sum, currency, t.locale),
      total: formatCents(totalCents, currency, t.locale),
    });
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
