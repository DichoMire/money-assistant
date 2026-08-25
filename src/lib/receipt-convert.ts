import { enT, type TFunc } from "./i18n";
import { allocateByWeights, formatCents } from "./money";
import type { ExpenseInput } from "./types";

/**
 * Pure allocation math turning assigned receipt items into per-person totals
 * and an ExpenseInput. Runs on the client for the live summary preview and on
 * the server for enforcement (the split.ts dual-use pattern).
 */

export type AssignMode = "unassigned" | "single" | "equal" | "exact" | "units";

export const ASSIGN_MODES: readonly AssignMode[] = ["unassigned", "single", "equal", "exact", "units"];

export type ConvertItemShare = { aliasId: string; exactCents: number | null; units?: number | null };

export type ConvertItem = {
  name: string;
  totalCents: number;
  /** Needed to validate "units" mode: sum(units) === quantity. */
  quantity?: number;
  assignMode: AssignMode;
  shares: ConvertItemShare[];
};

/** Unit splitting works for whole small counts only — fractional (weighted)
 *  quantities keep the whole-line modes (RFC 04 §3.4). */
export function unitsEligible(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity >= 2 && quantity <= 99;
}

export type PersonTotal = {
  aliasId: string;
  /** Cents from directly assigned items (can be negative via discount lines). */
  itemCents: number;
  /** Pro-rata share of tax + tip − receipt-level discounts. */
  poolCents: number;
  totalCents: number;
};

export type ConvertResult =
  | { ok: true; persons: PersonTotal[]; grandTotalCents: number }
  | { ok: false; error: string };

/**
 * Resolve a percent-mode discount (basis points of the items subtotal) into
 * cents. Shared by the client preview and the server save path so the stored
 * discountsCents can never drift from the stored percentage. Clamped at 0 for
 * the degenerate all-negative-items case.
 */
export function resolveDiscountCents(itemsSumCents: number, percentBp: number): number {
  return Math.max(0, Math.round((itemsSumCents * percentBp) / 10000));
}

export function computePersonTotals(
  items: ConvertItem[],
  pool: { taxCents: number; tipCents: number; discountsCents: number },
  currency: string,
  aliasNames?: Map<string, string>,
  t: TFunc = enT
): ConvertResult {
  const nameOf = (aliasId: string) => aliasNames?.get(aliasId) ?? t("convert.someone");
  // Zero-priced unassigned lines are harmless; anything with a value must be assigned.
  const unassigned = items.filter((it) => it.assignMode === "unassigned" && it.totalCents !== 0);
  if (unassigned.length > 0) {
    const cents = unassigned.reduce((sum, it) => sum + it.totalCents, 0);
    const amount = formatCents(cents, currency, t.locale);
    return {
      ok: false,
      error:
        unassigned.length === 1
          ? t("convert.unassignedOne", { amount })
          : t("convert.unassignedMany", { count: unassigned.length, amount }),
    };
  }

  const itemCents = new Map<string, number>();
  const add = (aliasId: string, cents: number) =>
    itemCents.set(aliasId, (itemCents.get(aliasId) ?? 0) + cents);

  let itemsSum = 0;
  for (const item of items) {
    if (item.assignMode === "unassigned") continue; // zero-priced, per the gate above
    itemsSum += item.totalCents;
    if (item.shares.length === 0) {
      return { ok: false, error: t("convert.noPeople", { name: item.name }) };
    }
    if (item.assignMode === "single") {
      if (item.shares.length !== 1) {
        return { ok: false, error: t("convert.invalidAssignment", { name: item.name }) };
      }
      add(item.shares[0].aliasId, item.totalCents);
    } else if (item.assignMode === "equal") {
      const allocated = allocateByWeights(item.totalCents, item.shares.map(() => 1));
      item.shares.forEach((s, i) => add(s.aliasId, allocated[i]));
    } else if (item.assignMode === "units") {
      // "2 of 3 beers" — allocate the line total by unit counts
      // (largest-remainder guarantees the cents sum exactly).
      const units = item.shares.map((s) => s.units ?? 0);
      if (units.some((u) => !Number.isInteger(u) || u < 1)) {
        return { ok: false, error: t("convert.invalidAssignment", { name: item.name }) };
      }
      const unitSum = units.reduce((a, b) => a + b, 0);
      if (item.quantity !== undefined && unitSum !== item.quantity) {
        return {
          ok: false,
          error: t("convert.unitsSum", {
            name: item.name,
            sum: unitSum,
            quantity: item.quantity,
          }),
        };
      }
      const allocated = allocateByWeights(item.totalCents, units);
      item.shares.forEach((s, i) => add(s.aliasId, allocated[i]));
    } else {
      let sum = 0;
      for (const s of item.shares) {
        if (s.exactCents === null || !Number.isInteger(s.exactCents)) {
          return { ok: false, error: t("convert.enterAmountForAll", { name: item.name }) };
        }
        sum += s.exactCents;
      }
      if (sum !== item.totalCents) {
        return {
          ok: false,
          error: t("convert.itemAmountsSum", {
            name: item.name,
            sum: formatCents(sum, currency, t.locale),
            total: formatCents(item.totalCents, currency, t.locale),
          }),
        };
      }
      for (const s of item.shares) add(s.aliasId, s.exactCents!);
    }
  }

  if (itemCents.size === 0) return { ok: false, error: t("convert.addAssignOne") };

  // Tax, tip and receipt-level discounts are distributed pro-rata by each
  // person's item subtotal (largest-remainder, so cents sum exactly). When
  // nobody has a positive subtotal, fall back to an equal split.
  const poolTotal = pool.taxCents + pool.tipCents - pool.discountsCents;
  const aliasIds = [...itemCents.keys()];
  let poolShares: number[] = aliasIds.map(() => 0);
  if (poolTotal !== 0) {
    const weights = aliasIds.map((id) => Math.max(itemCents.get(id)!, 0));
    const usable = weights.some((w) => w > 0) ? weights : aliasIds.map(() => 1);
    poolShares = allocateByWeights(poolTotal, usable);
  }

  const persons: PersonTotal[] = aliasIds.map((aliasId, i) => ({
    aliasId,
    itemCents: itemCents.get(aliasId)!,
    poolCents: poolShares[i],
    totalCents: itemCents.get(aliasId)! + poolShares[i],
  }));

  const negative = persons.find((p) => p.totalCents < 0);
  if (negative) {
    return {
      ok: false,
      error: t("convert.negativeShare", { name: nameOf(negative.aliasId) }),
    };
  }

  const grandTotalCents = itemsSum + poolTotal;
  if (grandTotalCents <= 0) {
    return { ok: false, error: t("convert.totalGreaterZero") };
  }
  return { ok: true, persons, grandTotalCents };
}

export function buildExpenseInput(args: {
  groupId: string;
  existingExpenseId?: string;
  merchant: string | null;
  date: string;
  currency: string;
  payerAliasId: string;
  persons: PersonTotal[];
  grandTotalCents: number;
  /** Description when the receipt has no merchant (localized by the caller). */
  fallbackDescription?: string;
}): ExpenseInput {
  return {
    id: args.existingExpenseId,
    groupId: args.groupId,
    description: args.merchant?.trim() || args.fallbackDescription || "Scanned receipt",
    amountCents: args.grandTotalCents,
    currency: args.currency,
    date: args.date,
    splitMethod: "exact",
    payers: [{ aliasId: args.payerAliasId, paidCents: args.grandTotalCents }],
    // "exact" split semantics: value = cents owed, must sum to amountCents —
    // guaranteed by computePersonTotals' construction.
    splits: args.persons
      .filter((p) => p.totalCents !== 0)
      .map((p) => ({ aliasId: p.aliasId, value: p.totalCents })),
  };
}
