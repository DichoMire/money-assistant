"use client";

import { useState } from "react";
import { deleteExpense } from "@/app/actions";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import type { ExpenseDto, GroupDto } from "@/lib/types";

export function ExpenseList({
  data,
  onSelect,
}: {
  data: GroupDto;
  onSelect: (expense: ExpenseDto) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const names = new Map(data.aliases.map((a) => [a.id, a.name]));
  const name = (id: string) => names.get(id) ?? "?";
  const myAliasId = data.members.find((m) => m.userId === data.myUserId)?.aliasId ?? null;

  // My net for one expense in its own currency: positive = I lent, negative =
  // I owe, null = not involved.
  const impactFor = (e: ExpenseDto): number | null => {
    if (!myAliasId) return null;
    const paid = e.payers.filter((p) => p.aliasId === myAliasId).reduce((s, p) => s + p.paidCents, 0);
    const owed = e.shares.filter((s) => s.aliasId === myAliasId).reduce((s, x) => s + x.owedCents, 0);
    if (paid === 0 && owed === 0) return null;
    return paid - owed;
  };

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
        const impact = e.kind === "expense" ? impactFor(e) : null;
        const iOwe = impact !== null && impact < 0;
        const iLent = impact !== null && impact > 0;
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
            onClick={() => onSelect(e)}
            className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
          >
            <span className="w-14 shrink-0 text-xs leading-tight text-gray-400">
              {formatDate(e.date)}
            </span>
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${
                e.kind === "settlement"
                  ? "bg-emerald-50"
                  : iOwe
                    ? "bg-red-50"
                    : iLent
                      ? "bg-emerald-50"
                      : "bg-gray-100"
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
            {e.kind === "expense" && (
              <span className="hidden w-24 shrink-0 text-right sm:block">
                {impact !== null && impact !== 0 && (
                  <>
                    <span
                      className={`block text-[11px] font-medium ${iOwe ? "amount-neg" : "amount-pos"}`}
                    >
                      {iOwe ? "you owe" : "you lent"}
                    </span>
                    <span
                      className={`block text-sm font-bold ${iOwe ? "amount-neg" : "amount-pos"}`}
                    >
                      {formatCents(Math.abs(impact), e.currency)}
                    </span>
                  </>
                )}
              </span>
            )}
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
