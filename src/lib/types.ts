import type { SplitMethod, SplitEntry } from "./split";
import type { AssignMode } from "./receipt-convert";
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
  /** True when the expense predates all stored rates and the earliest row was
   *  used as an approximation (rendered with a "≈" hint). */
  approxRate: boolean;
  /** The receipt scan this expense was converted from, if any. */
  scanId: string | null;
  /** Settlements only: how the money moved (cash|bank|blink|revolut|other). */
  method: string | null;
};

export type RatesInfo = {
  latestDate: string | null;
  stale: boolean;
  /** True when some expense needs an ECB rate (fixed euro legs don't). */
  needsConversion: boolean;
  /** True when some expense could not be converted at all (no rates stored). */
  missingRate: boolean;
  /** Expenses excluded from the balance math because they couldn't convert. */
  excludedCount: number;
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
  /** Audit entries by other members newer than the user's last visit. */
  hasNews: boolean;
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
  /** How the money moved (cash|bank|blink|revolut|other) — optional. */
  method: string | null;
};

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

// ---------- Notifications (RFC 07) ----------

/**
 * Notification preferences stored on users.notify_prefs. Defaults are applied
 * in code, not stored: digest "daily", both immediates true. The in-app bell
 * has no preference — it is the product UI, not a communication.
 */
export type NotifyPrefs = {
  digest?: "daily" | "weekly" | "off";
  emailAddedToGroup?: boolean;
  emailReminders?: boolean;
};

export type NotificationDto = {
  id: string;
  groupId: string;
  groupName: string;
  type: string;
  actorName: string;
  details: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

// ---------- Payment profiles (RFC 03) ----------

export type PaymentProfileDto = {
  iban: string | null;
  accountName: string | null;
  blinkPhone: string | null;
  revolutTag: string | null;
  /** ISO date of the last update — shown as "updated {date}" on the card. */
  updatedAt: string;
};

// ---------- Account (settings / GDPR) ----------

/**
 * Sentinel stored in activity_log.actor_name (and name-bearing details) when
 * an account is deleted. Never a human-language string — the renderer maps it
 * to the viewer's locale ("изтрит потребител" / "deleted user").
 */
export const ACTIVITY_TOMBSTONE = "__deleted__";

export type DeletionOverview = {
  /** Groups where the user is a plain member — they will be detached. */
  memberGroups: { id: string; name: string }[];
  /** Owned groups with no other real member — deleted outright. */
  soloGroups: { id: string; name: string }[];
  /** Owned groups with other members — must be transferred or deleted first. */
  conflictedGroups: {
    id: string;
    name: string;
    members: { userId: string; name: string }[];
  }[];
};

// ---------- Receipt scanning ----------

export type ScanItemShareDto = {
  aliasId: string;
  exactCents: number | null;
  /** assignMode "units": whole units this person takes (sum === quantity). */
  units: number | null;
};

export type ScanItemDto = {
  id: string;
  position: number;
  /** Verbatim printed receipt line, for "that's wrong" verification. */
  rawText: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number | null;
  /** Negative for coupon / deposit-return lines. */
  totalCents: number;
  category: string | null;
  assignMode: AssignMode;
  shares: ScanItemShareDto[];
};

export type ScanDetailDto = {
  id: string;
  groupId: string;
  status: string;
  merchant: string | null;
  date: string;
  currency: string;
  subtotalCents: number | null;
  taxCents: number;
  tipCents: number;
  /** Receipt-level discount as a positive magnitude. */
  discountsCents: number;
  /**
   * Non-null when the discount was entered as a percentage of the items
   * subtotal (basis points, 1050 = 10.5%); discountsCents holds the resolved
   * amount either way.
   */
  discountPercentBp: number | null;
  totalCents: number;
  confidence: number | null;
  reconciles: boolean;
  model: string | null;
  /** Linked expense after conversion (null = draft, or expense was deleted). */
  expenseId: string | null;
  /** False once the photo has been deleted (post-convert or retention sweep). */
  hasImage: boolean;
  /** User opted to keep the photo after conversion. */
  keepImage: boolean;
  items: ScanItemDto[];
  createdAt: string;
};

export type ScanSummaryDto = {
  id: string;
  merchant: string | null;
  date: string;
  currency: string;
  totalCents: number;
  itemCount: number;
  reconciles: boolean;
  expenseId: string | null;
  createdAt: string;
};

export type ScanItemInput = Omit<ScanItemDto, "id">;

export type ScanEditInput = {
  scanId: string;
  merchant: string | null;
  date: string;
  currency: string;
  taxCents: number;
  tipCents: number;
  discountsCents: number;
  /** See ScanDetailDto — non-null switches the discount to percent mode. */
  discountPercentBp: number | null;
  totalCents: number;
  /** Keep the photo after conversion (default: delete — data minimization). */
  keepImage: boolean;
  items: ScanItemInput[];
};

export type ParseReceiptResult =
  | { ok: true; scanId: string; duplicate?: boolean }
  | {
      ok: false;
      error: string;
      /** True when the monthly scan quota refused the parse — the UI renders
       *  an upgrade card instead of the generic failure banner. */
      quotaExceeded?: true;
    };

/**
 * One entry of an activity-log `details.changes` array. New rows store
 * machine-readable {key, params} fragments rendered in the VIEWER's locale at
 * display time (ActivityModal). Plain strings are legacy rows written before
 * this existed — they render verbatim, in the English they were frozen in,
 * and are never written anew.
 */
export type ChangeFragment =
  | string
  | { key: string; params?: Record<string, unknown> };

export type ActivityEntryDto = {
  id: string;
  actorName: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
};
