"use client";

import { useState } from "react";
import { saveSettlement } from "@/app/actions";
import { CURRENCIES } from "@/lib/currencies";
import { formatCents, parseAmount } from "@/lib/money";
import type { Debt } from "@/lib/simplify";
import type { ExpenseDto, GroupDto } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useT } from "./LocaleProvider";
import { Modal } from "./Modal";

export function SettleModal({
  group,
  settlement,
  prefill,
  onClose,
}: {
  group: GroupDto;
  settlement?: ExpenseDto;
  prefill?: Debt;
  onClose: () => void;
}) {
  const t = useT();
  const aliases = group.aliases;
  const [fromId, setFromId] = useState(
    settlement?.payers[0]?.aliasId ?? prefill?.fromAliasId ?? aliases[0]?.id ?? ""
  );
  const [toId, setToId] = useState(
    settlement?.shares[0]?.aliasId ?? prefill?.toAliasId ?? aliases[1]?.id ?? ""
  );
  const [amountStr, setAmountStr] = useState(
    settlement
      ? (settlement.amountCents / 100).toFixed(2)
      : prefill
        ? (prefill.amountCents / 100).toFixed(2)
        : ""
  );
  const [currency, setCurrency] = useState(settlement?.currency ?? group.currency);
  const [date, setDate] = useState(settlement?.date ?? new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = parseAmount(amountStr);
  const valid = amountCents !== null && amountCents > 0 && fromId && toId && fromId !== toId;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const result = await saveSettlement({
      id: settlement?.id,
      groupId: group.id,
      fromAliasId: fromId,
      toAliasId: toId,
      amountCents: amountCents!,
      currency,
      date,
    });
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error);
  };

  const personSelect = (value: string, onChange: (id: string) => void, label: string, id: string) => (
    <div className="flex-1">
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {aliases.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
    </div>
  );

  const fromName = aliases.find((a) => a.id === fromId)?.name ?? "?";
  const toName = aliases.find((a) => a.id === toId)?.name ?? "?";

  return (
    <Modal title={settlement ? t("settle.editTitle") : t("settle.title")} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-3 py-1">
          <Avatar id={fromId} name={fromName} size={40} />
          <span className="text-2xl text-gray-400" aria-hidden>→</span>
          <Avatar id={toId} name={toName} size={40} />
        </div>
        <p className="text-center text-sm text-gray-600">
          <span className="font-semibold">{fromName}</span> {t("settle.paidWord")}{" "}
          <span className="font-semibold">{toName}</span>
          {valid ? ` ${formatCents(amountCents!, currency)}` : ""}
        </p>

        <div className="flex gap-2">
          {personSelect(fromId, setFromId, t("settle.whoPaid"), "settle-from")}
          {personSelect(toId, setToId, t("settle.whoReceived"), "settle-to")}
        </div>
        {fromId === toId && (
          <p className="text-sm text-red-600">{t("settle.differentPeople")}</p>
        )}

        <div className="flex gap-2 max-sm:flex-wrap">
          <div className="w-28 shrink-0">
            <label className="label" htmlFor="settle-cur">{t("expenseModal.currency")}</label>
            <select id="settle-cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="settle-amount">{t("expenseModal.amount")}</label>
            <input
              id="settle-amount"
              className="input font-semibold"
              placeholder="0.00"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              autoFocus={!settlement}
            />
          </div>
          <div className="w-36 shrink-0 max-sm:w-full">
            <label className="label" htmlFor="settle-date">{t("expenseModal.date")}</label>
            <input id="settle-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !valid}>
            {busy ? t("common.saving") : settlement ? t("expenseModal.saveChanges") : t("settle.recordPayment")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
