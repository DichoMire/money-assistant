"use client";

import { useMemo, useState } from "react";
import { saveExpense } from "@/app/actions";
import { CURRENCIES } from "@/lib/currencies";
import { formatCents, parseAmount, parseNumber } from "@/lib/money";
import {
  computeShares,
  SPLIT_METHOD_LABELS,
  type ComputedShare,
  type SplitEntry,
  type SplitMethod,
  validatePayers,
} from "@/lib/split";

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

const METHOD_TABS: { method: SplitMethod; tab: string; hint: string }[] = [
  { method: "equal", tab: "=", hint: "Split equally. Select which people owe a share." },
  { method: "exact", tab: "1.23", hint: "Specify exactly how much each person owes." },
  { method: "percent", tab: "%", hint: "Enter the percentage of the bill each person owes." },
  { method: "shares", tab: "shares", hint: "Split by shares — great for time-based or per-family splitting." },
  { method: "adjustment", tab: "+/-", hint: "Everyone splits equally, plus or minus the adjustments you enter." },
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
  const aliases = group.aliases;

  const [view, setView] = useState<View>("main");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amountStr, setAmountStr] = useState(expense ? centsToStr(expense.amountCents) : "");
  const [currency, setCurrency] = useState(expense?.currency ?? group.currency);
  const [date, setDate] = useState(expense?.date ?? new Date().toISOString().slice(0, 10));

  const [payerMode, setPayerMode] = useState<"single" | "multi">(
    expense && expense.payers.length > 1 ? "multi" : "single"
  );
  const [singlePayer, setSinglePayer] = useState(
    expense?.payers[0]?.aliasId ?? aliases[0]?.id ?? ""
  );
  const [multiPaid, setMultiPaid] = useState<Values>(() => {
    const values: Values = {};
    if (expense && expense.payers.length > 1) {
      for (const p of expense.payers) values[p.aliasId] = centsToStr(p.paidCents);
    }
    return values;
  });

  const [method, setMethod] = useState<SplitMethod>(expense?.splitMethod ?? "equal");
  const [equalSel, setEqualSel] = useState<Record<string, boolean>>(() => {
    const sel: Record<string, boolean> = {};
    const included = expense?.splitMethod === "equal" ? new Set(expense.shares.map((s) => s.aliasId)) : null;
    for (const a of aliases) sel[a.id] = included ? included.has(a.id) : true;
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
    if (!amountValid) return { payers: null, error: "Enter a valid amount." };
    if (payerMode === "single") {
      if (!singlePayer) return { payers: null, error: "Select who paid." };
      return { payers: [{ aliasId: singlePayer, paidCents: totalCents! }], error: null };
    }
    const payers: { aliasId: string; paidCents: number }[] = [];
    for (const a of aliases) {
      const raw = (multiPaid[a.id] ?? "").trim();
      if (raw === "") continue;
      const cents = parseAmount(raw);
      if (cents === null || cents < 0) return { payers: null, error: `Invalid amount for ${a.name}.` };
      if (cents > 0) payers.push({ aliasId: a.id, paidCents: cents });
    }
    const error = validatePayers(totalCents!, payers, currency);
    return { payers: error ? null : payers, error };
  }, [amountValid, payerMode, singlePayer, multiPaid, aliases, totalCents, currency]);

  const multiPaidSum = aliases.reduce((sum, a) => {
    const cents = parseAmount((multiPaid[a.id] ?? "").trim() || "0");
    return sum + (cents !== null && cents > 0 ? cents : 0);
  }, 0);

  // ----- who owes -----
  const splitResult = useMemo<SplitState>(() => {
    if (!amountValid) return { entries: null, error: "Enter a valid amount." };
    const entries: SplitEntry[] = [];
    const readNumber = (values: Values, id: string): number | null | "invalid" => {
      const raw = (values[id] ?? "").trim();
      if (raw === "") return null;
      const value = method === "exact" || method === "adjustment" ? parseAmount(raw) : parseNumber(raw);
      if (value === null) return "invalid";
      return value;
    };
    if (method === "equal") {
      for (const a of aliases) if (equalSel[a.id]) entries.push({ aliasId: a.id, value: 0 });
    } else {
      const values =
        method === "exact" ? exactVals : method === "percent" ? percentVals : method === "shares" ? sharesVals : adjustVals;
      for (const a of aliases) {
        const value = readNumber(values, a.id);
        if (value === "invalid") return { entries: null, error: `Invalid value for ${a.name}.` };
        if (method === "adjustment") entries.push({ aliasId: a.id, value: value ?? 0 });
        else if (value !== null && value !== 0) entries.push({ aliasId: a.id, value });
      }
    }
    const computed = computeShares(method, totalCents!, entries, currency);
    if (!computed.ok) return { entries: null, error: computed.error };
    return { entries, error: null, shares: computed.shares };
  }, [amountValid, method, aliases, equalSel, exactVals, percentVals, sharesVals, adjustVals, totalCents, currency]);

  const owedByAlias = new Map((splitResult.shares ?? []).map((s) => [s.aliasId, s.owedCents]));

  const validationError = !description.trim()
    ? "Enter a description."
    : !amountValid
      ? "Enter a valid amount."
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
      ? `${(payerResult.payers ?? []).length || "multiple"} people`
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
        <label className="label" htmlFor="exp-desc">Description</label>
        <input
          id="exp-desc"
          className="input"
          placeholder="Dinner, taxi, groceries…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          autoFocus={!expense}
        />
      </div>
      <div className="flex gap-2">
        <div className="w-28 shrink-0">
          <label className="label" htmlFor="exp-cur">Currency</label>
          <select id="exp-cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="label" htmlFor="exp-amount">Amount</label>
          <input
            id="exp-amount"
            className="input text-lg font-semibold"
            placeholder="0.00"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
        </div>
        <div className="w-36 shrink-0">
          <label className="label" htmlFor="exp-date">Date</label>
          <input id="exp-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {currency !== group.currency && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
          This bill is in {currency}; balances are kept in {group.currency} using the exchange rate
          of the transaction date (or the nearest available).
        </p>
      )}

      <p className="text-center text-[15px] text-gray-700">
        Paid by {chip(payerLabel, () => setView("payers"))} and split{" "}
        {chip(SPLIT_METHOD_LABELS[method], () => setView("split"))}.
      </p>

      {(serverError || (validationError && amountStr !== "" && description !== "")) && (
        <p className="text-center text-sm font-medium text-red-600">
          {serverError ?? validationError}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !!validationError}>
          {busy ? "Saving…" : expense ? "Save changes" : "Add expense"}
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
        Multiple people paid
      </label>

      {payerMode === "multi" && amountValid && (
        <p
          className={`px-2 text-sm font-semibold ${multiPaidSum === totalCents ? "text-gray-500" : "text-red-600"}`}
        >
          {formatCents(multiPaidSum, currency)} of {formatCents(totalCents!, currency)} entered —{" "}
          {formatCents(totalCents! - multiPaidSum, currency)} left
        </p>
      )}

      <div className="flex justify-end border-t border-gray-100 pt-3">
        <button type="button" className="btn btn-primary" onClick={() => setView("main")}>Done</button>
      </div>
    </div>
  );

  const splitFooter = () => {
    if (!amountValid) return null;
    const total = totalCents!;
    switch (method) {
      case "equal": {
        const count = aliases.filter((a) => equalSel[a.id]).length;
        return count === 0 ? (
          <p className="text-sm font-semibold text-red-600">Select at least one person.</p>
        ) : (
          <p className="text-sm font-semibold text-gray-500">
            {formatCents(Math.round(total / count), currency)}/person ({count}{" "}
            {count === 1 ? "person" : "people"})
          </p>
        );
      }
      case "exact": {
        const entered = aliases.reduce((sum, a) => sum + (parseAmount((exactVals[a.id] ?? "").trim() || "0") ?? 0), 0);
        const ok = entered === total;
        return (
          <p className={`text-sm font-semibold ${ok ? "text-gray-500" : "text-red-600"}`}>
            {formatCents(entered, currency)} of {formatCents(total, currency)} entered —{" "}
            {formatCents(total - entered, currency)} left
          </p>
        );
      }
      case "percent": {
        const entered = aliases.reduce((sum, a) => sum + (parseNumber((percentVals[a.id] ?? "").trim() || "0") ?? 0), 0);
        const ok = Math.abs(entered - 100) <= 0.01;
        return (
          <p className={`text-sm font-semibold ${ok ? "text-gray-500" : "text-red-600"}`}>
            {Math.round(entered * 100) / 100}% of 100%
          </p>
        );
      }
      case "shares": {
        const entered = aliases.reduce((sum, a) => sum + (parseNumber((sharesVals[a.id] ?? "").trim() || "0") ?? 0), 0);
        return <p className="text-sm font-semibold text-gray-500">{Math.round(entered * 100) / 100} total shares</p>;
      }
      case "adjustment": {
        const adjustments = aliases.reduce((sum, a) => sum + (parseAmount((adjustVals[a.id] ?? "").trim() || "0") ?? 0), 0);
        const remaining = total - adjustments;
        return remaining < 0 ? (
          <p className="text-sm font-semibold text-red-600">Adjustments exceed the total.</p>
        ) : (
          <p className="text-sm font-semibold text-gray-500">
            {formatCents(remaining, currency)} split equally between {aliases.length} on top of adjustments
          </p>
        );
      }
    }
  };

  const splitView = (
    <div className="space-y-3">
      <div className="flex gap-1">
        {METHOD_TABS.map((t) => (
          <button
            key={t.method}
            type="button"
            onClick={() => setMethod(t.method)}
            className={`flex-1 cursor-pointer rounded-lg border px-1 py-1.5 text-sm font-bold transition-colors ${
              method === t.method
                ? "border-transparent text-white"
                : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            }`}
            style={method === t.method ? { background: "var(--brand)" } : undefined}
            title={SPLIT_METHOD_LABELS[t.method]}
          >
            {t.tab}
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-gray-500">
        {METHOD_TABS.find((t) => t.method === method)!.hint}
      </p>

      <div className="max-h-64 space-y-1 overflow-y-auto">
        {aliases.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
            {method === "equal" ? (
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                onClick={() => setEqualSel({ ...equalSel, [a.id]: !equalSel[a.id] })}
              >
                <CheckDot checked={!!equalSel[a.id]} />
                <Avatar id={a.id} name={a.name} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700">{a.name}</span>
                {equalSel[a.id] && owedByAlias.has(a.id) && (
                  <span className="text-sm font-semibold text-gray-500">
                    {formatCents(owedByAlias.get(a.id)!, currency)}
                  </span>
                )}
              </button>
            ) : (
              <>
                <Avatar id={a.id} name={a.name} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700">{a.name}</span>
                {method === "adjustment" && owedByAlias.has(a.id) && (
                  <span className="text-xs text-gray-400">
                    owes {formatCents(owedByAlias.get(a.id)!, currency)}
                  </span>
                )}
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
              </>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-gray-100 px-2 pt-3">{splitFooter()}</div>

      <div className="flex justify-end border-t border-gray-100 pt-3">
        <button type="button" className="btn btn-primary" onClick={() => setView("main")}>Done</button>
      </div>
    </div>
  );

  const titles: Record<View, string> = {
    main: expense ? "Edit expense" : "Add an expense",
    payers: "Who paid?",
    split: "How should this be split?",
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
              aria-label="Back"
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
