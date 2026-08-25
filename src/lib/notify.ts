import type { TFunc, TKey } from "./i18n";
import { formatCents } from "./money";

/**
 * Shared, isomorphic rendering of a notification row in the VIEWER's locale —
 * used by the in-app bell (client) and the email layer (server), so both
 * always say the same thing. details are machine data, never stored prose
 * (the audit-log lesson, RFC 02/07).
 */

/** The complete set of notification types this app may write (RFC 07 §3.1).
 *  Adding an IMMEDIATE-email type requires amending the RFC — digest is the
 *  default for everything else, by policy. */
export const IMMEDIATE_EMAIL_TYPES = ["group.added_you", "settle.reminder"] as const;

export function describeNotification(
  type: string,
  actorName: string,
  details: Record<string, unknown>,
  t: TFunc
): string {
  const s = (k: string) => String(details[k] ?? "?");
  const money = () =>
    formatCents(Number(details.amountCents ?? 0), String(details.currency ?? "EUR"), t.locale);
  switch (type) {
    case "group.added_you":
      return t("notify.addedYou", { actor: actorName });
    case "expense.involves_you":
      return t("notify.expenseAdded", { actor: actorName, description: s("description"), amount: money() });
    case "expense.updated":
      return t("notify.expenseUpdated", { actor: actorName, description: s("description") });
    case "expense.deleted":
      return t("notify.expenseDeleted", { actor: actorName, description: s("description") });
    case "payment.received":
      return t("notify.paymentReceived", { actor: actorName, amount: money() });
    case "payment.updated":
      return t("notify.paymentUpdated", { actor: actorName, amount: money() });
    case "payment.deleted":
      return t("notify.paymentDeleted", { actor: actorName, amount: money() });
    case "member.joined":
      return t("notify.memberJoined", { name: s("name") });
    case "settle.reminder":
      return t("notify.settleReminder", { actor: actorName, amount: money() });
    default:
      // Forward-compatible: unknown types render their key, never crash.
      return type as TKey;
  }
}
