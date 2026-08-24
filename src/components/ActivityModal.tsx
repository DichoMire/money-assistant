"use client";

import { useEffect, useState } from "react";
import { getActivityLog } from "@/app/actions";
import { formatDate } from "@/lib/format";
import type { Locale, TFunc } from "@/lib/i18n";
import { formatCents } from "@/lib/money";
import type { ActivityEntryDto, GroupDto } from "@/lib/types";
import { useLocale, useT } from "./LocaleProvider";
import { Modal } from "./Modal";

function describe(entry: ActivityEntryDto, t: TFunc, locale: Locale): string {
  const d = entry.details;
  const s = (key: string) => String(d[key] ?? "?");
  const money = () => formatCents(Number(d.amountCents ?? 0), String(d.currency ?? "USD"));
  // Stored details.changes fragments are historical data and stay as written.
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
                      {(entry.details.changes as unknown[]).map(String).join(" · ")}
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
