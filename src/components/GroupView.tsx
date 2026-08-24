"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { addAlias, updateGroup } from "@/app/actions";
import { countWord } from "@/lib/i18n";
import type { Debt } from "@/lib/simplify";
import type { ExpenseDto, GroupDto } from "@/lib/types";
import { ActivityModal } from "./ActivityModal";
import { useT } from "./LocaleProvider";
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
  const t = useT();
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

  // Inline first-step "add people" form (shown while the group has no
  // participants) — no modal detour on the way to the first expense.
  const [quickName, setQuickName] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const quickAdd = async () => {
    if (!quickName.trim()) return;
    setQuickBusy(true);
    setQuickError(null);
    const result = await addAlias(data.id, quickName);
    setQuickBusy(false);
    if (result.ok) setQuickName("");
    else setQuickError(result.error);
  };

  const close = () => setModal(null);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{data.name}</h1>
          <p className="text-sm text-gray-500">
            {data.currency} · {data.aliases.length}{" "}
            {countWord(t, data.aliases.length, "count.person", "count.people")}
            {data.members.length > 1 && ` · ${t("count.accounts", { count: data.members.length })}`}
            {!isOwner && ` · ${t("group.youAreMember")}`}
          </p>
        </div>
        {/* Phones get a uniform 3-column grid of actions instead of a ragged wrap. */}
        <div className="flex flex-wrap gap-2 max-sm:grid max-sm:w-full max-sm:grid-cols-3">
          <button
            type="button"
            className="btn btn-primary max-sm:!px-2"
            onClick={() => setModal({ type: "expense" })}
            disabled={data.aliases.length === 0}
          >
            {t("group.addExpense")}
          </button>
          <Link
            href={`/groups/${data.id}/scan`}
            className={`btn btn-secondary max-sm:!px-2 ${
              data.aliases.length === 0 ? "pointer-events-none opacity-50" : ""
            }`}
            aria-disabled={data.aliases.length === 0}
          >
            {t("group.scanReceipt")}
          </Link>
          <button
            type="button"
            className="btn btn-secondary max-sm:!px-2"
            onClick={() => setModal({ type: "settle" })}
            disabled={data.aliases.length < 2}
          >
            {t("group.settleUp")}
          </button>
          <button type="button" className="btn btn-secondary max-sm:!px-2" onClick={() => setModal({ type: "members" })}>
            {t("group.people")}
          </button>
          <button type="button" className="btn btn-secondary max-sm:!px-2" onClick={() => setModal({ type: "activity" })}>
            {t("group.activity")}
          </button>
          {isOwner && (
            <button type="button" className="btn btn-secondary max-sm:!px-2" onClick={() => setModal({ type: "settings" })}>
              {t("group.settings")}
            </button>
          )}
        </div>
      </div>

      {data.aliases.length === 0 ? (
        <div className="card mx-auto max-w-md px-6 py-10 text-center text-gray-500">
          <p className="text-lg font-semibold text-gray-700">{t("group.addPeopleFirst")}</p>
          <p className="mt-1 text-sm">{t("group.addPeopleHint")}</p>
          {isOwner ? (
            <>
              <form
                className="mt-5 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void quickAdd();
                }}
              >
                <input
                  className="input"
                  placeholder={t("group.quickAddPlaceholder")}
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  autoFocus
                />
                <button
                  type="submit"
                  className="btn btn-primary shrink-0"
                  disabled={quickBusy || !quickName.trim()}
                >
                  {t("members.add")}
                </button>
              </form>
              {quickError && <p className="mt-2 text-sm text-red-600">{quickError}</p>}
              <p className="mt-3 text-xs text-gray-400">{t("group.quickAddHint")}</p>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary mt-4"
              onClick={() => setModal({ type: "members" })}
            >
              {t("group.addPeople")}
            </button>
          )}
        </div>
      ) : (
        // grid-cols-1 keeps the stacked track at container width — an implicit
        // auto track sizes to its content and overflows narrow screens.
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ExpenseList
              data={data}
              onSelect={(expense) => setModal({ type: "detail", expenseId: expense.id })}
            />
          </div>
          {/* On stacked (non-desktop) layouts, balances come before the expense list. */}
          <div className="max-lg:order-first">
            <BalancesPanel
              data={data}
              simplify={simplify}
              canToggle={isOwner}
              onToggleSimplify={toggleSimplify}
              onSettle={(debt) => setModal({ type: "settle", prefill: debt })}
            />
          </div>
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
