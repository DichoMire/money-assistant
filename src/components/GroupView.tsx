"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { updateGroup } from "@/app/actions";
import type { Debt } from "@/lib/simplify";
import type { ExpenseDto, GroupDto } from "@/lib/types";
import { ActivityModal } from "./ActivityModal";
import { BalancesPanel } from "./BalancesPanel";
import { ExpenseDetailModal } from "./ExpenseDetailModal";
import { ExpenseList } from "./ExpenseList";
import { ExpenseModal } from "./ExpenseModal";
import { MembersModal } from "./MembersModal";
import { RateWarningModal } from "./RateWarningModal";
import { SettingsModal } from "./SettingsModal";
import { SettleModal } from "./SettleModal";

type ModalState =
  | { type: "expense"; expense?: ExpenseDto }
  | { type: "settle"; settlement?: ExpenseDto; prefill?: Debt }
  | { type: "detail"; expenseId: string }
  | { type: "members" }
  | { type: "settings" }
  | { type: "activity" }
  | null;

export function GroupView({ data }: { data: GroupDto }) {
  const isOwner = data.myRole === "owner";
  const [modal, setModal] = useState<ModalState>(null);
  // Optimistic mirror of the persisted toggle so switching feels instant —
  // both debt lists are already computed server-side.
  const [simplify, setSimplify] = useState(data.simplifyDebts);
  useEffect(() => setSimplify(data.simplifyDebts), [data.simplifyDebts]);

  const toggleSimplify = (value: boolean) => {
    if (!isOwner) return;
    setSimplify(value);
    void updateGroup(data.id, { simplifyDebts: value });
  };

  const close = () => setModal(null);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{data.name}</h1>
          <p className="text-sm text-gray-500">
            {data.currency} · {data.aliases.length}{" "}
            {data.aliases.length === 1 ? "person" : "people"}
            {data.members.length > 1 && ` · ${data.members.length} accounts`}
            {!isOwner && " · you're a member"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModal({ type: "expense" })}
            disabled={data.aliases.length === 0}
          >
            Add expense
          </button>
          <Link
            href={`/groups/${data.id}/scan`}
            className={`btn btn-secondary ${
              data.aliases.length === 0 ? "pointer-events-none opacity-50" : ""
            }`}
            aria-disabled={data.aliases.length === 0}
          >
            Scan receipt
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setModal({ type: "settle" })}
            disabled={data.aliases.length < 2}
          >
            Settle up
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setModal({ type: "members" })}>
            People
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setModal({ type: "activity" })}>
            Activity
          </button>
          {isOwner && (
            <button type="button" className="btn btn-secondary" onClick={() => setModal({ type: "settings" })}>
              Settings
            </button>
          )}
        </div>
      </div>

      {data.aliases.length === 0 ? (
        <div className="card px-6 py-12 text-center text-gray-500">
          <p className="text-lg font-semibold text-gray-700">Add people first</p>
          <p className="mt-1 text-sm">
            Add the people (aliases) in this group, then start logging bills.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-4"
            onClick={() => setModal({ type: "members" })}
          >
            Add people
          </button>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ExpenseList
              data={data}
              onSelect={(expense) => setModal({ type: "detail", expenseId: expense.id })}
            />
          </div>
          <BalancesPanel
            data={data}
            simplify={simplify}
            canToggle={isOwner}
            onToggleSimplify={toggleSimplify}
            onSettle={(debt) => setModal({ type: "settle", prefill: debt })}
          />
        </div>
      )}

      {modal?.type === "expense" && (
        <ExpenseModal group={data} expense={modal.expense} onClose={close} />
      )}
      {modal?.type === "detail" &&
        (() => {
          // Always render from the freshest server data, so an edit made in
          // another tab (or a revalidation) shows up when returning here.
          const expense = data.expenses.find((e) => e.id === modal.expenseId);
          if (!expense) return null;
          return (
            <ExpenseDetailModal
              group={data}
              expense={expense}
              onClose={close}
              onEdit={() =>
                setModal(
                  expense.kind === "settlement"
                    ? { type: "settle", settlement: expense }
                    : { type: "expense", expense }
                )
              }
            />
          );
        })()}
      {modal?.type === "settle" && (
        <SettleModal
          group={data}
          settlement={modal.settlement}
          prefill={modal.prefill}
          onClose={close}
        />
      )}
      {modal?.type === "members" && <MembersModal group={data} onClose={close} />}
      {modal?.type === "settings" && <SettingsModal group={data} onClose={close} />}
      {modal?.type === "activity" && <ActivityModal group={data} onClose={close} />}

      <RateWarningModal group={data} />
    </div>
  );
}
