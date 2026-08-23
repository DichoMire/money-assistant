export function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Parse a user-typed amount ("12.34", "12,34", "12") into integer cents. Returns null if invalid. */
export function parseAmount(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  if (!/^-?\d+(\.\d{0,})?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Parse a plain number ("2", "33.33", "-5") for percent/share/adjustment inputs. */
export function parseNumber(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
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
