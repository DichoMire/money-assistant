import { allocateByWeights, formatCents } from "./money";
import type { ExpenseInput } from "./types";

/**
 * Pure allocation math turning assigned receipt items into per-person totals
 * and an ExpenseInput. Runs on the client for the live summary preview and on
 * the server for enforcement (the split.ts dual-use pattern).
 */

export type AssignMode = "unassigned" | "single" | "equal" | "exact";

export const ASSIGN_MODES: readonly AssignMode[] = ["unassigned", "single", "equal", "exact"];

export type ConvertItemShare = { aliasId: string; exactCents: number | null };

export type ConvertItem = {
  name: string;
  totalCents: number;
  assignMode: AssignMode;
  shares: ConvertItemShare[];
};

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

export function computePersonTotals(
  items: ConvertItem[],
  pool: { taxCents: number; tipCents: number; discountsCents: number },
  currency: string,
  aliasNames?: Map<string, string>
): ConvertResult {
  const nameOf = (aliasId: string) => aliasNames?.get(aliasId) ?? "someone";
  // Zero-priced unassigned lines are harmless; anything with a value must be assigned.
  const unassigned = items.filter((it) => it.assignMode === "unassigned" && it.totalCents !== 0);
  if (unassigned.length > 0) {
    const cents = unassigned.reduce((sum, it) => sum + it.totalCents, 0);
    return {
      ok: false,
      error: `${unassigned.length} item${unassigned.length === 1 ? " is" : "s are"} not assigned yet (${formatCents(cents, currency)}).`,
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
      return { ok: false, error: `"${item.name}" has no people assigned.` };
    }
    if (item.assignMode === "single") {
      if (item.shares.length !== 1) {
        return { ok: false, error: `"${item.name}" has an invalid assignment.` };
      }
      add(item.shares[0].aliasId, item.totalCents);
    } else if (item.assignMode === "equal") {
      const allocated = allocateByWeights(item.totalCents, item.shares.map(() => 1));
      item.shares.forEach((s, i) => add(s.aliasId, allocated[i]));
    } else {
      let sum = 0;
      for (const s of item.shares) {
        if (s.exactCents === null || !Number.isInteger(s.exactCents)) {
          return { ok: false, error: `Enter an amount for everyone splitting "${item.name}".` };
        }
        sum += s.exactCents;
      }
      if (sum !== item.totalCents) {
        return {
          ok: false,
          error: `Amounts for "${item.name}" add up to ${formatCents(sum, currency)}, but the item costs ${formatCents(item.totalCents, currency)}.`,
        };
      }
      for (const s of item.shares) add(s.aliasId, s.exactCents!);
    }
  }

  if (itemCents.size === 0) return { ok: false, error: "Add and assign at least one item." };

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
      error: `${nameOf(negative.aliasId)}'s share would be negative — reassign the discount lines.`,
    };
  }

  const grandTotalCents = itemsSum + poolTotal;
  if (grandTotalCents <= 0) {
    return { ok: false, error: "The receipt total must be greater than zero." };
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
}): ExpenseInput {
  return {
    id: args.existingExpenseId,
    groupId: args.groupId,
    description: args.merchant?.trim() || "Scanned receipt",
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
