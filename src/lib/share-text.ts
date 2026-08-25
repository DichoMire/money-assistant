import type { TFunc } from "./i18n";
import { formatCents } from "./money";
import type { PaymentProfileDto } from "./types";

/**
 * Composable share-message builders (RFC 03 §3.4 / RFC 10 §3.3). Pure and
 * unit-testable; rendered in the SHARER's locale. URLs are embedded in the
 * text (not a separate share field) because Viber on Android drops the url
 * field for some targets — text always survives and unfurls.
 */

/** Creditor-side payment request: only the methods that exist are listed. */
export function buildPaymentRequestText(
  t: TFunc,
  params: {
    groupName: string;
    amountCents: number;
    currency: string;
    profile: PaymentProfileDto | null;
    url: string;
  }
): string {
  const lines: string[] = [
    t("share.requestIntro", {
      group: params.groupName,
      amount: formatCents(params.amountCents, params.currency, t.locale),
    }),
  ];
  const p = params.profile;
  if (p?.iban && p.accountName) lines.push(`IBAN: ${p.iban} (${p.accountName})`);
  if (p?.blinkPhone) lines.push(`blink: ${p.blinkPhone}`);
  if (p?.revolutTag) lines.push(`revolut.me/${p.revolutTag}`);
  lines.push(params.url);
  return lines.join("\n");
}

/**
 * Balances snapshot for the group chat (RFC 10 §3.3): matches what the
 * panel displays (simplified vs pairwise), largest debt first, capped at 6
 * lines with an "…and N more" tail.
 */
export function buildBalanceSummaryText(
  t: TFunc,
  params: {
    groupName: string;
    dateText: string;
    currency: string;
    debts: { fromName: string; toName: string; amountCents: number }[];
    url: string;
  }
): string {
  if (params.debts.length === 0) {
    return `${t("share.allSettled", { group: params.groupName })}\n${params.url}`;
  }
  const sorted = [...params.debts].sort((a, b) => b.amountCents - a.amountCents);
  const shown = sorted.slice(0, 6);
  const lines = [
    t("share.summaryIntro", { group: params.groupName, date: params.dateText }),
    ...shown.map((d) =>
      t("share.summaryLine", {
        from: d.fromName,
        to: d.toName,
        amount: formatCents(d.amountCents, params.currency, t.locale),
      })
    ),
  ];
  if (sorted.length > shown.length) {
    lines.push(t("share.summaryMore", { count: sorted.length - shown.length }));
  }
  lines.push(`${t("share.summaryOutro")}: ${params.url}`);
  return lines.join("\n");
}
