"use client";

import { useState } from "react";
import { deleteExpense } from "@/app/actions";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import type { ExpenseDto, GroupDto } from "@/lib/types";

export function ExpenseList({
  data,
  onEdit,
}: {
  data: GroupDto;
  onEdit: (expense: ExpenseDto) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const names = new Map(data.aliases.map((a) => [a.id, a.name]));
  const name = (id: string) => names.get(id) ?? "?";

  const remove = async (expense: ExpenseDto) => {
    const label = expense.kind === "settlement" ? "payment" : "expense";
    if (!window.confirm(`Delete this ${label}?`)) return;
    setDeletingId(expense.id);
    const result = await deleteExpense(expense.id);
    setDeletingId(null);
    if (!result.ok) window.alert(result.error);
  };

  if (data.expenses.length === 0) {
    return (
      <div className="card px-6 py-12 text-center text-gray-500">
        <p className="text-lg font-semibold text-gray-700">No expenses yet</p>
        <p className="mt-1 text-sm">Add the first bill with the button above.</p>
      </div>
    );
  }

  return (
    <div className="card divide-y divide-gray-100">
      {data.expenses.map((e) => {
        const foreign = e.currency !== data.currency;
        const paidLine =
          e.kind === "settlement"
            ? `${name(e.payers[0]?.aliasId ?? "")} paid ${name(e.shares[0]?.aliasId ?? "")}`
            : e.payers.length === 1
              ? `${name(e.payers[0].aliasId)} paid ${formatCents(e.amountCents, e.currency)}`
              : `${e.payers.length} people paid ${formatCents(e.amountCents, e.currency)}`;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onEdit(e)}
            className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
          >
            <span className="w-14 shrink-0 text-xs leading-tight text-gray-400">
              {formatDate(e.date)}
            </span>
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${
                e.kind === "settlement" ? "bg-emerald-50" : "bg-gray-100"
              }`}
              aria-hidden
            >
              {e.kind === "settlement" ? "💸" : "🧾"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-gray-800">
                {e.kind === "settlement" ? "Payment" : e.description}
              </span>
              <span className="block truncate text-xs text-gray-500">{paidLine}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-bold text-gray-800">
                {formatCents(e.amountCents, e.currency)}
              </span>
              {foreign &&
                (e.convertedCents !== null ? (
                  <span
                    className="block text-xs text-gray-400"
                    title={e.rateDate ? `Converted with the rate from ${formatDate(e.rateDate)}` : undefined}
                  >
                    ≈ {formatCents(e.convertedCents, data.currency)}
                  </span>
                ) : (
                  <span className="block text-xs font-semibold text-red-500">no rate</span>
                ))}
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label="Delete"
              className="ml-1 shrink-0 rounded-md px-2 py-1 text-lg leading-none text-gray-300 hover:bg-red-50 hover:text-red-500"
              onClick={(ev) => {
                ev.stopPropagation();
                void remove(e);
              }}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  ev.stopPropagation();
                  void remove(e);
                }
              }}
            >
              {deletingId === e.id ? "…" : "×"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
