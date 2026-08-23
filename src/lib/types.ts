import type { SplitMethod, SplitEntry } from "./split";
import type { Debt } from "./simplify";

export type AliasDto = { id: string; name: string };

export type PayerDto = { aliasId: string; paidCents: number };

export type ShareDto = { aliasId: string; owedCents: number; splitValue: number | null };

export type ExpenseDto = {
  id: string;
  kind: "expense" | "settlement";
  description: string;
  amountCents: number;
  currency: string;
  date: string;
  splitMethod: SplitMethod;
  payers: PayerDto[];
  shares: ShareDto[];
  /** Total converted to the group currency (null when no rate is available). */
  convertedCents: number | null;
  /** Date of the FX rate used for the conversion (null if none / not needed). */
  rateDate: string | null;
};

export type RatesInfo = {
  latestDate: string | null;
  stale: boolean;
  /** True when at least one expense is in a currency other than the group's. */
  needsConversion: boolean;
  /** True when some expense could not be converted at all (no rates stored). */
  missingRate: boolean;
};

export type GroupSummary = {
  id: string;
  name: string;
  currency: string;
  simplifyDebts: boolean;
  aliasCount: number;
  expenseCount: number;
};

export type GroupDto = {
  id: string;
  name: string;
  currency: string;
  simplifyDebts: boolean;
  aliases: AliasDto[];
  expenses: ExpenseDto[];
  /** aliasId -> net cents in group currency (positive = is owed money). */
  netBalances: Record<string, number>;
  pairwiseDebts: Debt[];
  simplifiedDebts: Debt[];
  rates: RatesInfo;
};

export type ExpenseInput = {
  id?: string;
  groupId: string;
  description: string;
  amountCents: number;
  currency: string;
  date: string;
  splitMethod: SplitMethod;
  payers: PayerDto[];
  splits: SplitEntry[];
};

export type SettlementInput = {
  id?: string;
  groupId: string;
  fromAliasId: string;
  toAliasId: string;
  amountCents: number;
  currency: string;
  date: string;
};

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };
