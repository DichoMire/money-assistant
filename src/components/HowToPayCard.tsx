"use client";

import { useState } from "react";
import { buildEpcPayload } from "@/lib/epc-qr";
import { formatCents } from "@/lib/money";
import { formatIbanGroups } from "@/lib/payment-details";
import type { PaymentProfileDto } from "@/lib/types";
import { useT } from "./LocaleProvider";

/**
 * Debtor-facing "how to pay {creditor}" helpers (RFC 03): copyable SEPA bank
 * fields, blink P2P instructions, a Revolut link, and an on-demand EPC QR.
 * Ordered by real-world reach; every method is copy-first because no
 * Bulgarian bank app takes a payment deep-link today. The app never moves
 * money — these only prepare what the payer's own bank app needs.
 */
export function HowToPayCard({
  profile,
  recipientName,
  amountCents,
  currency,
  groupName,
}: {
  profile: PaymentProfileDto;
  recipientName: string;
  amountCents: number | null;
  currency: string;
  groupName: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);

  const amountText =
    amountCents !== null && amountCents > 0 ? formatCents(amountCents, currency, t.locale) : null;
  const note = t("payment.noteTemplate", { group: groupName });

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard unavailable — the values are visible and selectable */
    }
  };

  const epcPayload =
    profile.iban && profile.accountName && currency === "EUR" && amountCents !== null && amountCents > 0
      ? buildEpcPayload({
          name: profile.accountName,
          iban: profile.iban,
          amountCents,
          note,
        })
      : null;

  const showQr = async () => {
    if (!epcPayload || qrBusy) return;
    setQrBusy(true);
    try {
      // Lazy: the qrcode encoder stays out of the main bundle.
      const QRCode = (await import("qrcode")).default;
      setQrUrl(await QRCode.toDataURL(epcPayload, { errorCorrectionLevel: "M", scale: 5 }));
    } finally {
      setQrBusy(false);
    }
  };

  const row = (key: string, label: string, value: string, copyValue?: string) => (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-20 shrink-0 text-xs text-gray-400">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-gray-700">{value}</span>
      <button
        type="button"
        className="btn btn-secondary shrink-0 !px-2 !py-0.5 !text-xs"
        onClick={() => void copy(key, copyValue ?? value)}
      >
        {copied === key ? t("payment.copied") : t("payment.copy")}
      </button>
    </div>
  );

  const hasBank = !!(profile.iban && profile.accountName);
  const bankBlock = [
    profile.accountName,
    profile.iban,
    amountText,
    note,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <details className="rounded-xl border border-emerald-200 bg-emerald-50/50">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-emerald-800">
        {t("payment.howToPay", { name: recipientName })}
        <span className="ml-2 font-normal text-emerald-600/70">
          {t("payment.updatedOn", { date: profile.updatedAt })}
        </span>
      </summary>
      <div className="space-y-4 px-4 pt-1 pb-4">
        {hasBank && (
          <section className="space-y-1.5">
            <p className="text-xs font-bold tracking-wide text-gray-500 uppercase">
              {t("payment.bankTransfer")}
            </p>
            {row("name", t("payment.accountName"), profile.accountName!)}
            {row("iban", "IBAN", formatIbanGroups(profile.iban!), profile.iban!)}
            {amountText && row("amount", t("payment.amount"), amountText)}
            {row("note", t("payment.note"), note)}
            <button
              type="button"
              className="btn btn-secondary !px-2.5 !py-1 !text-xs"
              onClick={() => void copy("all", bankBlock)}
            >
              {copied === "all" ? t("payment.copied") : t("payment.copyAll")}
            </button>
          </section>
        )}

        {profile.blinkPhone && (
          <section className="space-y-1.5">
            <p className="text-xs font-bold tracking-wide text-gray-500 uppercase">
              blink P2P{" "}
              {currency === "EUR" && (
                <span className="font-normal normal-case text-emerald-700">
                  · {t("payment.blinkFree")}
                </span>
              )}
            </p>
            {row("blink", t("payment.blinkPhone"), profile.blinkPhone)}
            <p className="text-xs text-gray-500">{t("payment.blinkSteps")}</p>
          </section>
        )}

        {profile.revolutTag && (
          <section className="space-y-1.5">
            <p className="text-xs font-bold tracking-wide text-gray-500 uppercase">Revolut</p>
            <div className="flex items-center gap-2">
              <a
                className="btn btn-secondary !px-2.5 !py-1 !text-xs"
                href={`https://revolut.me/${profile.revolutTag}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("payment.revolutOpen")} ↗
              </a>
              {amountText && <span className="text-sm font-bold text-gray-800">{amountText}</span>}
            </div>
            <p className="text-xs text-gray-500">{t("payment.revolutAmountNote")}</p>
          </section>
        )}

        {epcPayload && (
          <section className="space-y-1.5">
            {qrUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrUrl}
                  alt="EPC QR"
                  className="h-44 w-44 rounded-lg border border-gray-200 bg-white p-1"
                />
                <p className="text-xs text-gray-500">{t("payment.qrHint")}</p>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-secondary !px-2.5 !py-1 !text-xs"
                disabled={qrBusy}
                onClick={() => void showQr()}
              >
                {t("payment.showQr")}
              </button>
            )}
          </section>
        )}
      </div>
    </details>
  );
}
