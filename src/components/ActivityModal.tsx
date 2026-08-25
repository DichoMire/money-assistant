"use client";

import { useEffect, useState } from "react";
import { getActivityLog } from "@/app/actions";
import { formatDate } from "@/lib/format";
import type { Locale, TFunc, TKey } from "@/lib/i18n";
import { formatCents } from "@/lib/money";
import { SPLIT_METHODS } from "@/lib/split";
import type { ActivityEntryDto, GroupDto } from "@/lib/types";
import { useLocale, useT } from "./LocaleProvider";
import { Modal } from "./Modal";

function describe(entry: ActivityEntryDto, t: TFunc, locale: Locale): string {
  const d = entry.details;
  const s = (key: string) => String(d[key] ?? "?");
  const money = () => formatCents(Number(d.amountCents ?? 0), String(d.currency ?? "USD"), locale);
  const merchant = d.merchant ? t("activity.fromMerchant", { merchant: s("merchant") }) : "";
  switch (entry.action) {
    case "group.created":
      return t("activity.groupCreated", { name: s("name") });
    case "group.renamed":
      return t("activity.groupRenamed", { from: s("from"), to: s("to") });
    case "group.currency_changed":
      return t("activity.currencyChanged", { from: s("from"), to: s("to") });
    case "group.simplify_toggled":
      return d.on ? t("activity.simplifyOn") : t("activity.simplifyOff");
    case "alias.added":
      return t("activity.aliasAdded", { name: s("name") });
    case "alias.renamed":
      return t("activity.aliasRenamed", { from: s("from"), to: s("to") });
    case "alias.deleted":
      return t("activity.aliasDeleted", { name: s("name") });
    case "alias.attached":
      return (
        t("activity.aliasAttached", {
          alias: s("aliasName"),
          account: s("accountName"),
          email: s("accountEmail"),
        }) + (d.merged ? t("activity.mergedHistories") : "")
      );
    case "member.joined":
      return d.via === "circle"
        ? t("activity.memberJoinedCircle", { name: s("name"), email: s("email") })
        : t("activity.memberJoinedLink");
    case "member.left":
      return t("activity.memberLeft");
    case "member.removed":
      return t("activity.memberRemoved", { name: s("name"), email: s("email") });
    case "invite.created":
      return t("activity.inviteCreated", { date: formatDate(s("expiresAt"), locale) });
    case "invite.revoked":
      return t("activity.inviteRevoked");
    case "expense.added":
      return t("activity.expenseAdded", { description: s("description"), amount: money() });
    case "expense.updated":
      return t("activity.expenseUpdated", { description: s("description"), amount: money() });
    case "expense.deleted":
      return t("activity.expenseDeleted", { description: s("description"), amount: money() });
    case "payment.added":
      return t("activity.paymentAdded", { from: s("fromName"), to: s("toName"), amount: money() });
    case "payment.updated":
      return t("activity.paymentUpdated", { from: s("fromName"), to: s("toName"), amount: money() });
    case "payment.deleted":
      return t("activity.paymentDeleted", { from: s("fromName"), to: s("toName"), amount: money() });
    case "receipt.scanned":
      return t("activity.receiptScanned", { merchant, amount: money() });
    case "receipt.converted":
      return t("activity.receiptConverted", { merchant, amount: money() });
    case "receipt.deleted":
      return t("activity.receiptDeleted", { merchant, amount: money() });
    default:
      return entry.action;
  }
}

/** "Ana, Ben" for short lists, "{count} people" beyond 4 — from the stored
 *  {names, count} snapshot (see participantParams in actions.ts). */
function renderNameList(value: unknown, t: TFunc): string {
  if (typeof value !== "object" || value === null) return "?";
  const { names, count } = value as { names?: unknown; count?: unknown };
  const n = typeof count === "number" ? count : Array.isArray(names) ? names.length : 0;
  if (n > 4) return t("activity.nPeople", { count: n });
  return Array.isArray(names) && names.length > 0 ? names.map(String).join(", ") : "?";
}

/**
 * Render one details.changes fragment in the viewer's locale. Legacy rows
 * stored pre-rendered English strings — those render verbatim (immutable
 * history); everything written since RFC 02 §3.3 is {key, params} and gets
 * display-time formatting. Unknown keys render as the key itself so a newer
 * writer never crashes an older reader.
 */
function renderChange(fragment: unknown, t: TFunc, locale: Locale): string {
  if (typeof fragment === "string") return fragment;
  if (typeof fragment !== "object" || fragment === null) return String(fragment);
  const { key, params } = fragment as { key?: unknown; params?: unknown };
  if (typeof key !== "string") return "?";
  const p = (typeof params === "object" && params !== null ? params : {}) as Record<string, unknown>;
  const str = (k: string) => String(p[k] ?? "?");
  switch (key) {
    case "description":
      return t("activity.change.description", { from: str("from"), to: str("to") });
    case "amount":
      return t("activity.change.amount", {
        from: formatCents(Number(p.fromCents ?? 0), String(p.fromCurrency ?? "EUR"), locale),
        to: formatCents(Number(p.toCents ?? 0), String(p.toCurrency ?? "EUR"), locale),
      });
    case "date":
      return t("activity.change.date", {
        from: formatDate(str("from"), locale),
        to: formatDate(str("to"), locale),
      });
    case "splitMethod": {
      const label = (v: string) =>
        (SPLIT_METHODS as readonly string[]).includes(v) ? t(`splitMethod.${v}` as TKey) : v;
      return t("activity.change.splitMethod", { from: label(str("from")), to: label(str("to")) });
    }
    case "paidBy":
      return t("activity.change.paidBy", { from: renderNameList(p.from, t), to: renderNameList(p.to, t) });
    case "splitBetween":
      return t("activity.change.splitBetween", { from: renderNameList(p.from, t), to: renderNameList(p.to, t) });
    case "payerAmountsAdjusted":
      return t("activity.change.payerAmountsAdjusted");
    case "splitAmountsAdjusted":
      return t("activity.change.splitAmountsAdjusted");
    case "payer":
      return t("activity.change.payer", { from: str("from"), to: str("to") });
    case "recipient":
      return t("activity.change.recipient", { from: str("from"), to: str("to") });
    default:
      return key;
  }
}

function timestamp(iso: string, locale: Locale): string {
  const time = new Date(iso).toLocaleTimeString(locale === "bg" ? "bg-BG" : [], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatDate(iso.slice(0, 10), locale)}, ${time}`;
}

export function ActivityModal({ group, onClose }: { group: GroupDto; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [entries, setEntries] = useState<ActivityEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getActivityLog(group.id)
      .then(setEntries)
      .catch(() => setError(t("activity.loadError")));
  }, [group.id, t]);

  return (
    <Modal title={t("activity.title")} onClose={onClose} wide>
      {error ? (
        <p className="text-sm font-medium text-red-600">{error}</p>
      ) : entries === null ? (
        <p className="py-6 text-center text-sm text-gray-400">{t("activity.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">{t("activity.none")}</p>
      ) : (
        <>
          <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.id} className="flex gap-3 py-2 text-sm max-sm:flex-col max-sm:gap-0.5">
                <span className="w-28 shrink-0 pt-0.5 text-xs leading-tight text-gray-400 max-sm:w-auto">
                  {timestamp(entry.createdAt, locale)}
                </span>
                <span className="min-w-0 flex-1 text-gray-600">
                  <span className="font-semibold text-gray-800">{entry.actorName}</span>{" "}
                  {describe(entry, t, locale)}
                  {Array.isArray(entry.details.changes) && entry.details.changes.length > 0 && (
                    <span className="mt-0.5 block text-xs text-gray-400">
                      {(entry.details.changes as unknown[])
                        .map((c) => renderChange(c, t, locale))
                        .join(" · ")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {entries.length >= 200 && (
            <p className="mt-2 text-xs text-gray-400">{t("activity.showingLatest")}</p>
          )}
        </>
      )}
    </Modal>
  );
}
