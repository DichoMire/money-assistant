"use client";

import { useState } from "react";
import { sendSettleReminder } from "@/app/notification-actions";
import { getMyPaymentProfile } from "@/app/payment-actions";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { buildBalanceSummaryText, buildPaymentRequestText } from "@/lib/share-text";
import { ROUNDING_WRITE_OFF_CENTS, type Debt } from "@/lib/simplify";
import { todayString } from "@/lib/rates";
import type { GroupDto, PaymentProfileDto } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useLocale, useT } from "./LocaleProvider";

export function BalancesPanel({
  data,
  simplify,
  canToggle,
  onToggleSimplify,
  onSettle,
}: {
  data: GroupDto;
  simplify: boolean;
  canToggle: boolean;
  onToggleSimplify: (value: boolean) => void;
  onSettle: (debt: Debt) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const names = new Map(data.aliases.map((a) => [a.id, a.name]));
  const name = (id: string) => names.get(id) ?? "?";
  const debts = simplify ? data.simplifiedDebts : data.pairwiseDebts;
  const money = (cents: number) => formatCents(cents, data.currency, locale);
  const myAliasId = data.aliases.find((a) => a.userId === data.myUserId)?.id ?? null;
  const [shared, setShared] = useState<string | null>(null);
  // Cached across clicks; undefined = not fetched yet.
  const [myProfile, setMyProfile] = useState<PaymentProfileDto | null | undefined>(undefined);

  /** Share via the OS sheet (reaches Viber natively); desktop falls back to copy. */
  const shareText = async (key: string, text: string) => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        return;
      } catch {
        return; // user canceled the sheet — not an error
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setShared(key);
      setTimeout(() => setShared((s) => (s === key ? null : s)), 1500);
    } catch {}
  };

  const groupUrl = () =>
    typeof window !== "undefined" ? `${window.location.origin}/groups/${data.id}` : "";

  const shareSummary = () => {
    void shareText(
      "summary",
      buildBalanceSummaryText(t, {
        groupName: data.name,
        dateText: formatDate(todayString(), locale),
        currency: data.currency,
        debts: debts.map((d) => ({
          fromName: name(d.fromAliasId),
          toName: name(d.toAliasId),
          amountCents: d.amountCents,
        })),
        url: `${groupUrl()}?ref=summary-share`,
      })
    );
  };

  const [reminderState, setReminderState] = useState<Record<string, "sent" | "error" | string>>({});
  const remind = async (d: Debt) => {
    const result = await sendSettleReminder(data.id, d.fromAliasId);
    setReminderState((prev) => ({
      ...prev,
      [d.fromAliasId]: result.ok ? "sent" : result.error,
    }));
  };

  const requestPayment = async (d: Debt) => {
    let profile = myProfile;
    if (profile === undefined) {
      try {
        profile = await getMyPaymentProfile();
      } catch {
        profile = null;
      }
      setMyProfile(profile);
    }
    await shareText(
      `req-${d.fromAliasId}`,
      buildPaymentRequestText(t, {
        groupName: data.name,
        amountCents: d.amountCents,
        currency: data.currency,
        profile: profile ?? null,
        url: groupUrl(),
      })
    );
  };

  // Chips are derived from the payment list on display, so they always agree
  // with it exactly — including after tiny rounding write-offs.
  const derivedNet = new Map<string, number>();
  for (const d of debts) {
    derivedNet.set(d.fromAliasId, (derivedNet.get(d.fromAliasId) ?? 0) - d.amountCents);
    derivedNet.set(d.toAliasId, (derivedNet.get(d.toAliasId) ?? 0) + d.amountCents);
  }
  const balances = data.aliases
    .map((a) => ({ ...a, net: derivedNet.get(a.id) ?? 0 }))
    .sort((a, b) => b.net - a.net);
  const hasWriteOff = data.aliases.some(
    (a) => (data.netBalances[a.id] ?? 0) !== (derivedNet.get(a.id) ?? 0)
  );

  return (
    <div className="space-y-5">
      {data.rates.excludedCount > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">
            ⚠️{" "}
            {data.rates.excludedCount === 1
              ? t("balances.excludedOne", { currency: data.currency })
              : t("balances.excludedMany", {
                  count: data.rates.excludedCount,
                  currency: data.currency,
                })}
          </p>
          <p className="mt-1 text-xs text-red-600">{t("balances.excludedHint")}</p>
        </div>
      )}
      <div className="card px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-gray-800">{t("balances.title")}</h2>
          <label
            className={`flex items-center gap-2 text-xs font-semibold text-gray-500 ${canToggle ? "cursor-pointer" : "opacity-60"}`}
            title={canToggle ? undefined : t("balances.onlyOwner")}
          >
            {t("balances.simplifyDebts")}
            <span
              role="switch"
              aria-checked={simplify}
              aria-disabled={!canToggle}
              tabIndex={canToggle ? 0 : -1}
              onClick={() => canToggle && onToggleSimplify(!simplify)}
              onKeyDown={(e) => {
                if (canToggle && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onToggleSimplify(!simplify);
                }
              }}
              className="relative inline-block h-5 w-9 rounded-full transition-colors"
              style={{ background: simplify ? "var(--brand)" : "#d1d5db" }}
            >
              <span
                className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
                style={{ left: simplify ? 18 : 2 }}
              />
            </span>
          </label>
        </div>

        <ul className="space-y-2">
          {balances.map((b) => (
            <li key={b.id} className="flex items-center gap-2 text-sm">
              <Avatar id={b.id} name={b.name} size={28} />
              <span className="min-w-0 flex-1 truncate font-medium text-gray-700">{b.name}</span>
              {b.net === 0 ? (
                <span className="text-gray-400">{t("balances.settledUp")}</span>
              ) : (
                <span className={`font-bold ${b.net > 0 ? "amount-pos" : "amount-neg"}`}>
                  {b.net > 0 ? t("balances.getsBack") : t("balances.owes")}{" "}
                  {money(Math.abs(b.net))}
                </span>
              )}
            </li>
          ))}
        </ul>
        {hasWriteOff && (
          <p className="mt-3 text-xs text-gray-400">
            {t("balances.writeOff", { amount: money(ROUNDING_WRITE_OFF_CENTS) })}
          </p>
        )}
      </div>

      <div className="card px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="mb-1 font-bold text-gray-800">
            {simplify ? t("balances.suggestedPayments") : t("balances.whoOwesWhom")}
          </h2>
          <button
            type="button"
            className="btn btn-secondary shrink-0 !px-2.5 !py-1 !text-xs"
            onClick={() => shareSummary()}
            title={t("share.summaryTitle")}
          >
            {shared === "summary" ? t("payment.copied") : t("share.summaryButton")}
          </button>
        </div>
        <p className="mb-3 text-xs text-gray-400">
          {simplify ? t("balances.simplifiedHint") : t("balances.pairwiseHint")}
        </p>
        {debts.length === 0 ? (
          <p className="text-sm text-gray-400">{t("balances.everyoneSettled")}</p>
        ) : (
          <ul className="space-y-2">
            {debts.map((d, i) => (
              <li
                key={`${d.fromAliasId}-${d.toAliasId}-${i}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <Avatar id={d.fromAliasId} name={name(d.fromAliasId)} size={24} />
                <span className="min-w-0 flex-1 truncate text-gray-700">
                  <span className="font-medium">{name(d.fromAliasId)}</span>
                  <span className="text-gray-400"> {t("balances.owesTo")} </span>
                  <span className="font-medium">{name(d.toAliasId)}</span>
                </span>
                <span className="font-bold text-gray-800">
                  {money(d.amountCents)}
                </span>
                {/* Creditor-side helpers — only on rows where the signed-in
                    user is the one owed money. */}
                {myAliasId !== null && d.toAliasId === myAliasId && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary !px-2 !py-1 !text-xs"
                      title={t("payment.requestShare")}
                      onClick={() => void requestPayment(d)}
                    >
                      {shared === `req-${d.fromAliasId}` ? t("payment.copied") : "📤"}
                    </button>
                    {/* „Напомни" exists only when the debtor is a real
                        account (nobody to remind behind a virtual member). */}
                    {data.aliases.find((a) => a.id === d.fromAliasId)?.userId && (
                      <button
                        type="button"
                        className="btn btn-secondary !px-2 !py-1 !text-xs"
                        disabled={reminderState[d.fromAliasId] === "sent"}
                        title={
                          reminderState[d.fromAliasId] && reminderState[d.fromAliasId] !== "sent"
                            ? reminderState[d.fromAliasId]
                            : undefined
                        }
                        onClick={() => void remind(d)}
                      >
                        {reminderState[d.fromAliasId] === "sent"
                          ? t("reminder.sent")
                          : t("reminder.button")}
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="btn btn-secondary !px-2.5 !py-1 !text-xs"
                  onClick={() => onSettle(d)}
                >
                  {t("balances.settle")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
