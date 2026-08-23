"use client";

import { useState } from "react";
import { deleteExpense } from "@/app/actions";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { SPLIT_METHOD_LABELS } from "@/lib/split";
import type { ExpenseDto, GroupDto } from "@/lib/types";
import { Avatar } from "./Avatar";
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
        return `${splitValue} ${splitValue === 1 ? "share" : "shares"}`;
      case "adjustment":
        return `${splitValue >= 0 ? "+" : "−"}${formatCents(Math.abs(splitValue), expense.currency)} adj.`;
      default:
        return null;
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete this ${isSettlement ? "payment" : "expense"}?`)) return;
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
    <Modal title={isSettlement ? "Payment details" : "Expense details"} onClose={onClose} wide>
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
              {isSettlement ? "Payment" : expense.description}
            </p>
            <p className="text-sm text-gray-500">
              {formatDate(expense.date)}
              {!isSettlement && <> · split {SPLIT_METHOD_LABELS[expense.splitMethod]}</>}
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
                  {expense.rateDate && <> · rate from {formatDate(expense.rateDate)}</>}
                </p>
              ) : (
                <p className="text-xs font-semibold text-red-500">no exchange rate</p>
              ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
            <p className="label">Paid by</p>
            <ul>
              {expense.payers.map((p) =>
                personRow(p.aliasId, formatCents(p.paidCents, expense.currency))
              )}
            </ul>
          </section>
          <section className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
            <p className="label">{isSettlement ? "Received by" : "Who owes"}</p>
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
            {busy ? "Deleting…" : "Delete"}
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn btn-primary" onClick={onEdit} disabled={busy}>
              Edit
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
