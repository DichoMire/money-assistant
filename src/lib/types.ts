import type { SplitMethod, SplitEntry } from "./split";
import type { Debt } from "./simplify";

/** userId links the alias to a real account; null = virtual member. */
export type AliasDto = { id: string; name: string; userId: string | null };

export type GroupRole = "owner" | "member";

export type GroupMemberDto = {
  userId: string;
  name: string;
  email: string;
  isOwner: boolean;
  /** The member's participant alias in this group (null if none linked). */
  aliasId: string | null;
};

export type CircleUserDto = { userId: string; name: string; email: string };

export type InviteLinkDto = { id: string; url: string; expiresAt: string };

export type JoinPreview =
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "member"; groupId: string }
  | { state: "ok"; groupId: string; groupName: string; inviterName: string; peopleCount: number };

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
  memberCount: number;
  role: GroupRole;
};

export type GroupDto = {
  id: string;
  name: string;
  currency: string;
  simplifyDebts: boolean;
  myRole: GroupRole;
  myUserId: string;
  members: GroupMemberDto[];
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
