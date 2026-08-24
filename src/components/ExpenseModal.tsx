"use client";

import { useMemo, useState } from "react";
import { saveExpense } from "@/app/actions";
import { CURRENCIES } from "@/lib/currencies";
import { localTodayString } from "@/lib/format";
import { countWord, type TKey } from "@/lib/i18n";
import { formatCents, parseAmount, parseNumber } from "@/lib/money";
import {
  computeShares,
  type ComputedShare,
  type SplitEntry,
  type SplitMethod,
  validatePayers,
} from "@/lib/split";
import { useT } from "./LocaleProvider";

type SplitState = {
  entries: SplitEntry[] | null;
  error: string | null;
  shares?: ComputedShare[];
};
import type { ExpenseDto, GroupDto } from "@/lib/types";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";

type View = "main" | "payers" | "split";
type Values = Record<string, string>;

const centsToStr = (cents: number) => (cents / 100).toFixed(2);

// tab: null renders the localized "shares" word instead of a symbol.
const METHOD_TABS: { method: SplitMethod; tab: string | null; hintKey: TKey }[] = [
  { method: "equal", tab: "=", hintKey: "expenseModal.hintEqual" },
  { method: "exact", tab: "1.23", hintKey: "expenseModal.hintExact" },
  { method: "percent", tab: "%", hintKey: "expenseModal.hintPercent" },
  { method: "shares", tab: null, hintKey: "expenseModal.hintShares" },
  { method: "adjustment", tab: "+/-", hintKey: "expenseModal.hintAdjustment" },
];

export function ExpenseModal({
  group,
  expense,
  onClose,
}: {
  group: GroupDto;
  expense?: ExpenseDto;
  onClose: () => void;
}) {
  const t = useT();
  const money = (cents: number, currency: string) => formatCents(cents, currency, t.locale);
  const methodLabel = (m: SplitMethod) => t(`splitMethod.${m}` as TKey);
  const aliases = group.aliases;

  const [view, setView] = useState<View>("main");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amountStr, setAmountStr] = useState(expense ? centsToStr(expense.amountCents) : "");
  const [currency, setCurrency] = useState(expense?.currency ?? group.currency);
  const [date, setDate] = useState(expense?.date ?? localTodayString());

  const [payerMode, setPayerMode] = useState<"single" | "multi">(
    expense && expense.payers.length > 1 ? "multi" : "single"
  );
  // New expenses default to the current user's own participant as the payer.
  const myAliasId = group.members.find((m) => m.userId === group.myUserId)?.aliasId ?? null;
  const [singlePayer, setSinglePayer] = useState(
    expense?.payers[0]?.aliasId ?? myAliasId ?? aliases[0]?.id ?? ""
  );
  const [multiPaid, setMultiPaid] = useState<Values>(() => {
    const values: Values = {};
    if (expense && expense.payers.length > 1) {
      for (const p of expense.payers) values[p.aliasId] = centsToStr(p.paidCents);
    }
    return values;
  });

  const [method, setMethod] = useState<SplitMethod>(expense?.splitMethod ?? "equal");
  // Who participates in the split — the check toggle applies to every method.
  const [included, setIncluded] = useState<Record<string, boolean>>(() => {
    const sel: Record<string, boolean> = {};
    const present = expense ? new Set(expense.shares.map((s) => s.aliasId)) : null;
    for (const a of aliases) sel[a.id] = present ? present.has(a.id) : true;
    return sel;
  });
  const initialValues = (want: SplitMethod, toStr: (v: number) => string): Values => {
    const values: Values = {};
    if (expense?.splitMethod === want) {
      for (const s of expense.shares) {
        if (s.splitValue !== null && s.splitValue !== 0) values[s.aliasId] = toStr(s.splitValue);
      }
    }
    return values;
  };
  const [exactVals, setExactVals] = useState<Values>(() => initialValues("exact", centsToStr));
  const [percentVals, setPercentVals] = useState<Values>(() => initialValues("percent", String));
  const [sharesVals, setSharesVals] = useState<Values>(() => initialValues("shares", String));
  const [adjustVals, setAdjustVals] = useState<Values>(() => initialValues("adjustment", centsToStr));

  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const totalCents = parseAmount(amountStr);
  const amountValid = totalCents !== null && totalCents > 0;

  // ----- who paid -----
  const payerResult = useMemo(() => {
    if (!amountValid) return { payers: null, error: t("expenseModal.enterValidAmount") };
    if (payerMode === "single") {
      if (!singlePayer) return { payers: null, error: t("splitError.selectWhoPaid") };
      return { payers: [{ aliasId: singlePayer, paidCents: totalCents! }], error: null };
    }
    const payers: { aliasId: string; paidCents: number }[] = [];
    for (const a of aliases) {
      const raw = (multiPaid[a.id] ?? "").trim();
      if (raw === "") continue;
      const cents = parseAmount(raw);
      if (cents === null || cents < 0) {
        return { payers: null, error: t("expenseModal.invalidAmountFor", { name: a.name }) };
      }
      if (cents > 0) payers.push({ aliasId: a.id, paidCents: cents });
    }
    const error = validatePayers(totalCents!, payers, currency, t);
    return { payers: error ? null : payers, error };
  }, [amountValid, payerMode, singlePayer, multiPaid, aliases, totalCents, currency, t]);

  const multiPaidSum = aliases.reduce((sum, a) => {
    const cents = parseAmount((multiPaid[a.id] ?? "").trim() || "0");
    return sum + (cents !== null && cents > 0 ? cents : 0);
  }, 0);

  // ----- who owes -----
  const splitResult = useMemo<SplitState>(() => {
    if (!amountValid) return { entries: null, error: t("expenseModal.enterValidAmount") };
    const entries: SplitEntry[] = [];
    const readNumber = (values: Values, id: string): number | null | "invalid" => {
      const raw = (values[id] ?? "").trim();
      if (raw === "") return null;
      const value = method === "exact" || method === "adjustment" ? parseAmount(raw) : parseNumber(raw);
      if (value === null) return "invalid";
      return value;
    };
    if (method === "equal") {
      for (const a of aliases) if (included[a.id]) entries.push({ aliasId: a.id, value: 0 });
    } else {
      const values =
        method === "exact" ? exactVals : method === "percent" ? percentVals : method === "shares" ? sharesVals : adjustVals;
      for (const a of aliases) {
        if (!included[a.id]) continue;
        const value = readNumber(values, a.id);
        if (value === "invalid") {
          return { entries: null, error: t("expenseModal.invalidValueFor", { name: a.name }) };
        }
        if (method === "adjustment") entries.push({ aliasId: a.id, value: value ?? 0 });
        else if (value !== null && value !== 0) entries.push({ aliasId: a.id, value });
      }
    }
    const computed = computeShares(method, totalCents!, entries, currency, t);
    if (!computed.ok) return { entries: null, error: computed.error };
    return { entries, error: null, shares: computed.shares };
  }, [amountValid, method, aliases, included, exactVals, percentVals, sharesVals, adjustVals, totalCents, currency, t]);

  const owedByAlias = new Map((splitResult.shares ?? []).map((s) => [s.aliasId, s.owedCents]));

  const validationError = !description.trim()
    ? t("expenseModal.enterDescription")
    : !amountValid
      ? t("expenseModal.enterValidAmount")
      : (payerResult.error ?? splitResult.error);

  const save = async () => {
    if (validationError || !payerResult.payers || !splitResult.entries) return;
    setBusy(true);
    setServerError(null);
    const result = await saveExpense({
      id: expense?.id,
      groupId: group.id,
      description: description.trim(),
      amountCents: totalCents!,
      currency,
      date,
      splitMethod: method,
      payers: payerResult.payers,
      splits: splitResult.entries,
    });
    setBusy(false);
    if (result.ok) onClose();
    else setServerError(result.error);
  };

  const payerLabel =
    payerMode === "multi"
      ? (payerResult.payers ?? []).length > 0
        ? t("expenseModal.multiPayers", { count: (payerResult.payers ?? []).length })
        : t("expenseModal.multiplePayers")
      : (aliases.find((a) => a.id === singlePayer)?.name ?? "…");

  const chip = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="mx-1 inline-block cursor-pointer rounded-md border border-gray-300 bg-gray-50 px-2 py-0.5 font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-100"
    >
      {label}
    </button>
  );

  // ---------- subviews ----------

  const mainView = (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="exp-desc">{t("expenseModal.description")}</label>
        <input
          id="exp-desc"
          className="input"
          placeholder={t("expenseModal.descriptionPlaceholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          autoFocus={!expense}
        />
      </div>
      <div className="flex gap-2 max-sm:flex-wrap">
        <div className="w-28 shrink-0">
          <label className="label" htmlFor="exp-cur">{t("expenseModal.currency")}</label>
          <select id="exp-cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="label" htmlFor="exp-amount">{t("expenseModal.amount")}</label>
          <input
            id="exp-amount"
            className="input text-lg font-semibold"
            placeholder="0.00"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
        </div>
        <div className="w-36 shrink-0 max-sm:w-full">
          <label className="label" htmlFor="exp-date">{t("expenseModal.date")}</label>
          <input id="exp-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {currency !== group.currency && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
          {t("expenseModal.foreignNote", { currency, groupCurrency: group.currency })}
        </p>
      )}

      <p className="text-center text-[15px] text-gray-700">
        {t("expenseModal.paidBy")} {chip(payerLabel, () => setView("payers"))}{" "}
        {t("expenseModal.andSplit")} {chip(methodLabel(method), () => setView("split"))}.
      </p>

      {(serverError || (validationError && amountStr !== "" && description !== "")) && (
        <p className="text-center text-sm font-medium text-red-600">
          {serverError ?? validationError}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
        <button type="button" className="btn btn-secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !!validationError}>
          {busy ? t("expenseModal.saving") : expense ? t("expenseModal.saveChanges") : t("group.addExpense")}
        </button>
      </div>
    </div>
  );

  const payersView = (
    <div className="space-y-3">
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {aliases.map((a) => {
          const selected = payerMode === "single" && singlePayer === a.id;
          return (
            <div key={a.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                onClick={() => {
                  setPayerMode("single");
                  setSinglePayer(a.id);
                  setView("main");
                }}
              >
                <RadioDot checked={selected} />
                <Avatar id={a.id} name={a.name} size={28} />
                <span className="truncate text-sm font-medium text-gray-700">{a.name}</span>
              </button>
              {payerMode === "multi" && (
                <div className="w-28 shrink-0">
                  <input
                    className="input !py-1.5 text-right"
                    placeholder="0.00"
                    inputMode="decimal"
                    value={multiPaid[a.id] ?? ""}
                    onChange={(e) => setMultiPaid({ ...multiPaid, [a.id]: e.target.value })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <label className="flex cursor-pointer items-center gap-2 border-t border-gray-100 px-2 pt-3 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          className="h-4 w-4 accent-(--brand)"
          checked={payerMode === "multi"}
          onChange={(e) => setPayerMode(e.target.checked ? "multi" : "single")}
        />
        {t("expenseModal.multiplePaid")}
      </label>

      {payerMode === "multi" && amountValid && (
        <p
          className={`px-2 text-sm font-semibold ${multiPaidSum === totalCents ? "text-gray-500" : "text-red-600"}`}
        >
          {t("split.enteredLeft", {
            entered: money(multiPaidSum, currency),
            total: money(totalCents!, currency),
            left: money(totalCents! - multiPaidSum, currency),
          })}
        </p>
      )}

      <div className="flex justify-end border-t border-gray-100 pt-3">
        <button type="button" className="btn btn-primary" onClick={() => setView("main")}>{t("common.done")}</button>
      </div>
    </div>
  );

  const splitFooter = () => {
    if (!amountValid) return null;
    const total = totalCents!;
    const includedAliases = aliases.filter((a) => included[a.id]);
    if (includedAliases.length === 0) {
      return <p className="text-sm font-semibold text-red-600">{t("split.selectAtLeastOne")}</p>;
    }
    switch (method) {
      case "equal": {
        const count = includedAliases.length;
        return (
          <p className="text-sm font-semibold text-gray-500">
            {t("expenseModal.perPerson", {
              amount: money(Math.round(total / count), currency),
              count,
              word: countWord(t, count, "count.person", "count.people"),
            })}
          </p>
        );
      }
      case "exact": {
        const entered = includedAliases.reduce((sum, a) => sum + (parseAmount((exactVals[a.id] ?? "").trim() || "0") ?? 0), 0);
        const ok = entered === total;
        return (
          <p className={`text-sm font-semibold ${ok ? "text-gray-500" : "text-red-600"}`}>
            {t("split.enteredLeft", {
              entered: money(entered, currency),
              total: money(total, currency),
              left: money(total - entered, currency),
            })}
          </p>
        );
      }
      case "percent": {
        const entered = includedAliases.reduce((sum, a) => sum + (parseNumber((percentVals[a.id] ?? "").trim() || "0") ?? 0), 0);
        const ok = Math.abs(entered - 100) <= 0.01;
        return (
          <p className={`text-sm font-semibold ${ok ? "text-gray-500" : "text-red-600"}`}>
            {t("expenseModal.percentOf", { entered: Math.round(entered * 100) / 100 })}
          </p>
        );
      }
      case "shares": {
        const entered = includedAliases.reduce((sum, a) => sum + (parseNumber((sharesVals[a.id] ?? "").trim() || "0") ?? 0), 0);
        return (
          <p className="text-sm font-semibold text-gray-500">
            {t("expenseModal.totalShares", { count: Math.round(entered * 100) / 100 })}
          </p>
        );
      }
      case "adjustment": {
        const adjustments = includedAliases.reduce((sum, a) => sum + (parseAmount((adjustVals[a.id] ?? "").trim() || "0") ?? 0), 0);
        const remaining = total - adjustments;
        return remaining < 0 ? (
          <p className="text-sm font-semibold text-red-600">{t("expenseModal.adjustmentsExceed")}</p>
        ) : (
          <p className="text-sm font-semibold text-gray-500">
            {t("expenseModal.equalOnTop", {
              amount: money(remaining, currency),
              count: includedAliases.length,
            })}
          </p>
        );
      }
    }
  };

  const splitView = (
    <div className="space-y-3">
      <div className="flex gap-1">
        {METHOD_TABS.map((tab) => (
          <button
            key={tab.method}
            type="button"
            onClick={() => setMethod(tab.method)}
            className={`flex-1 cursor-pointer rounded-lg border px-1 py-1.5 text-sm font-bold transition-colors ${
              method === tab.method
                ? "border-transparent text-white"
                : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            }`}
            style={method === tab.method ? { background: "var(--brand)" } : undefined}
            title={methodLabel(tab.method)}
          >
            {tab.tab ?? t("expenseModal.tabShares")}
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-gray-500">
        {t(METHOD_TABS.find((x) => x.method === method)!.hintKey)}
      </p>

      <div className="max-h-64 space-y-1 overflow-y-auto">
        {aliases.map((a) => {
          const isIncluded = !!included[a.id];
          return (
            <div key={a.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                title={isIncluded ? t("expenseModal.excludeTooltip") : t("expenseModal.includeTooltip")}
                onClick={() => setIncluded({ ...included, [a.id]: !isIncluded })}
              >
                <CheckDot checked={isIncluded} />
                <Avatar id={a.id} name={a.name} size={28} />
                <span
                  className={`min-w-0 flex-1 truncate text-sm font-medium ${isIncluded ? "text-gray-700" : "text-gray-400 line-through"}`}
                >
                  {a.name}
                </span>
                {isIncluded && method !== "exact" && owedByAlias.has(a.id) && (
                  <span
                    className={
                      method === "equal" ? "text-sm font-semibold text-gray-500" : "text-xs text-gray-400"
                    }
                  >
                    {method === "equal"
                      ? money(owedByAlias.get(a.id)!, currency)
                      : t("split.owesAmount", { amount: money(owedByAlias.get(a.id)!, currency) })}
                  </span>
                )}
              </button>
              {method !== "equal" && isIncluded && (
                <div className="relative w-28 shrink-0">
                  <input
                    className={`input !py-1.5 text-right ${method === "percent" ? "!pr-7" : ""}`}
                    placeholder={method === "shares" ? "0" : method === "adjustment" ? "±0.00" : "0.00"}
                    inputMode="decimal"
                    value={
                      (method === "exact" ? exactVals : method === "percent" ? percentVals : method === "shares" ? sharesVals : adjustVals)[a.id] ?? ""
                    }
                    onChange={(e) => {
                      const setter =
                        method === "exact" ? setExactVals : method === "percent" ? setPercentVals : method === "shares" ? setSharesVals : setAdjustVals;
                      const current =
                        method === "exact" ? exactVals : method === "percent" ? percentVals : method === "shares" ? sharesVals : adjustVals;
                      setter({ ...current, [a.id]: e.target.value });
                    }}
                  />
                  {method === "percent" && (
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-gray-400">%</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-gray-100 px-2 pt-3">{splitFooter()}</div>

      <div className="flex justify-end border-t border-gray-100 pt-3">
        <button type="button" className="btn btn-primary" onClick={() => setView("main")}>{t("common.done")}</button>
      </div>
    </div>
  );

  const titles: Record<View, string> = {
    main: expense ? t("expenseModal.editTitle") : t("expenseModal.addTitle"),
    payers: t("expenseModal.whoPaidTitle"),
    split: t("expenseModal.splitTitle"),
  };

  return (
    <Modal
      title={
        view === "main" ? (
          titles.main
        ) : (
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView("main")}
              className="cursor-pointer rounded-md px-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label={t("common.back")}
            >
              ←
            </button>
            {titles[view]}
          </span>
        )
      }
      onClose={view === "main" ? onClose : () => setView("main")}
      wide
    >
      {view === "main" ? mainView : view === "payers" ? payersView : splitView}
    </Modal>
  );
}

function RadioDot({ checked }: { checked: boolean }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
      style={{ borderColor: checked ? "var(--brand)" : "#d1d5db" }}
    >
      {checked && <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--brand)" }} />}
    </span>
  );
}

function CheckDot({ checked }: { checked: boolean }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold text-white"
      style={{
        borderColor: checked ? "var(--brand)" : "#d1d5db",
        background: checked ? "var(--brand)" : "transparent",
      }}
    >
      {checked ? "✓" : ""}
    </span>
  );
}
