"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteExpense } from "@/app/actions";
import { formatDate } from "@/lib/format";
import { countWord, type TKey } from "@/lib/i18n";
import { formatCents } from "@/lib/money";
import type { ExpenseDto, GroupDto } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useLocale, useT } from "./LocaleProvider";
import { Modal } from "./Modal";

export function ExpenseDetailModal({
  group,
  expense,
  onEdit,
  onClose,
}: {
  group: GroupDto;
  expense: ExpenseDto;
  onEdit: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = new Map(group.aliases.map((a) => [a.id, a.name]));
  const name = (id: string) => names.get(id) ?? "?";
  const isSettlement = expense.kind === "settlement";
  const foreign = expense.currency !== group.currency;

  const splitHint = (splitValue: number | null): string | null => {
    if (splitValue === null) return null;
    switch (expense.splitMethod) {
      case "percent":
        return `${splitValue}%`;
      case "shares":
        return `${splitValue} ${countWord(t, splitValue, "count.share", "count.shares")}`;
      case "adjustment":
        return `${splitValue >= 0 ? "+" : "−"}${formatCents(Math.abs(splitValue), expense.currency)} ${t("detail.adjSuffix")}`;
      default:
        return null;
    }
  };

  const remove = async () => {
    const message = isSettlement
      ? t("expenses.deletePaymentConfirm")
      : t("expenses.deleteExpenseConfirm");
    if (!window.confirm(message)) return;
    setBusy(true);
    setError(null);
    const result = await deleteExpense(expense.id);
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error);
  };

  const personRow = (aliasId: string, amount: string, hint?: string | null) => (
    <li key={aliasId} className="flex items-center gap-2 py-1">
      <Avatar id={aliasId} name={name(aliasId)} size={26} />
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{name(aliasId)}</span>
      {hint && <span className="shrink-0 text-xs text-gray-400">{hint}</span>}
      <span className="shrink-0 text-sm font-semibold text-gray-800">{amount}</span>
    </li>
  );

  return (
    <Modal title={isSettlement ? t("detail.paymentTitle") : t("detail.expenseTitle")} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl ${
              isSettlement ? "bg-emerald-50" : "bg-gray-100"
            }`}
            aria-hidden
          >
            {isSettlement ? "💸" : "🧾"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-gray-800">
              {isSettlement ? t("expenses.payment") : expense.description}
            </p>
            <p className="text-sm text-gray-500">
              {formatDate(expense.date, locale)}
              {!isSettlement && (
                <>
                  {" · "}
                  {t("detail.split", { label: t(`splitMethod.${expense.splitMethod}` as TKey) })}
                </>
              )}
              {expense.scanId && (
                <>
                  {" · "}
                  <Link
                    href={`/groups/${group.id}/scan/${expense.scanId}`}
                    className="underline hover:text-gray-700"
                    onClick={onClose}
                  >
                    {t("detail.viewReceipt")}
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xl font-bold text-gray-800">
              {formatCents(expense.amountCents, expense.currency)}
            </p>
            {foreign &&
              (expense.convertedCents !== null ? (
                <p className="text-xs text-gray-400">
                  ≈ {formatCents(expense.convertedCents, group.currency)}
                  {expense.rateDate && (
                    <> · {t("detail.rateFrom", { date: formatDate(expense.rateDate, locale) })}</>
                  )}
                </p>
              ) : (
                <p className="text-xs font-semibold text-red-500">{t("detail.noRate")}</p>
              ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
            <p className="label">{t("detail.paidBy")}</p>
            <ul>
              {expense.payers.map((p) =>
                personRow(p.aliasId, formatCents(p.paidCents, expense.currency))
              )}
            </ul>
          </section>
          <section className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
            <p className="label">{isSettlement ? t("detail.receivedBy") : t("detail.whoOwes")}</p>
            <ul>
              {expense.shares.map((s) =>
                personRow(
                  s.aliasId,
                  formatCents(s.owedCents, expense.currency),
                  isSettlement ? null : splitHint(s.splitValue)
                )
              )}
            </ul>
          </section>
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={busy}>
            {busy ? t("common.deleting") : t("common.delete")}
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("common.close")}
            </button>
            <button type="button" className="btn btn-primary" onClick={onEdit} disabled={busy}>
              {t("common.edit")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
