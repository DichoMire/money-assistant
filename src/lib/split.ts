import { allocateByWeights, formatCents } from "./money";

export const SPLIT_METHODS = ["equal", "exact", "percent", "shares", "adjustment"] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export const SPLIT_METHOD_LABELS: Record<SplitMethod, string> = {
  equal: "equally",
  exact: "by exact amounts",
  percent: "by percentages",
  shares: "by shares",
  adjustment: "by adjustment",
};

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
  currency: string
): SplitResult {
  if (totalCents <= 0) return { ok: false, error: "Amount must be greater than zero." };
  if (entries.length === 0) return { ok: false, error: "Select at least one person." };

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
      if (entries.some((e) => e.value < 0)) return { ok: false, error: "Amounts cannot be negative." };
      if (sum !== totalCents) {
        return {
          ok: false,
          error: `Amounts add up to ${formatCents(sum, currency)}, but the total is ${formatCents(totalCents, currency)}.`,
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
      if (entries.some((e) => e.value < 0)) return { ok: false, error: "Percentages cannot be negative." };
      if (Math.abs(sum - 100) > 0.01) {
        return { ok: false, error: `Percentages add up to ${round2(sum)}%, they must total 100%.` };
      }
      const positive = entries.filter((e) => e.value > 0);
      if (positive.length === 0) return { ok: false, error: "At least one percentage must be above zero." };
      const owed = allocateByWeights(totalCents, positive.map((e) => e.value));
      return {
        ok: true,
        shares: positive.map((e, i) => ({ aliasId: e.aliasId, owedCents: owed[i], splitValue: e.value })),
      };
    }
    case "shares": {
      if (entries.some((e) => e.value < 0)) return { ok: false, error: "Shares cannot be negative." };
      const positive = entries.filter((e) => e.value > 0);
      if (positive.length === 0) return { ok: false, error: "Enter at least one share above zero." };
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
          error: `Adjustments add up to ${formatCents(adjustmentSum, currency)}, which exceeds the total.`,
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
        return { ok: false, error: "An adjustment makes someone's share negative. Reduce it." };
      }
      return { ok: true, shares };
    }
  }
}

/** Validate the "who paid" side. Returns an error string or null. */
export function validatePayers(
  totalCents: number,
  payers: { aliasId: string; paidCents: number }[],
  currency: string
): string | null {
  if (payers.length === 0) return "Select who paid.";
  if (payers.some((p) => p.paidCents < 0)) return "Paid amounts cannot be negative.";
  const sum = payers.reduce((a, p) => a + p.paidCents, 0);
  if (sum !== totalCents) {
    return `Payments add up to ${formatCents(sum, currency)}, but the total is ${formatCents(totalCents, currency)}.`;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
