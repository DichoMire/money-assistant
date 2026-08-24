"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { convertScan, saveScan } from "@/app/receipt-actions";
import { CURRENCIES } from "@/lib/currencies";
import { countWord } from "@/lib/i18n";
import { formatCents, parseAmount, parseNumber } from "@/lib/money";
import { computePersonTotals, type AssignMode, type ConvertItem } from "@/lib/receipt-convert";
import type { GroupDto, ScanDetailDto, ScanEditInput, ScanItemDto } from "@/lib/types";
import { Avatar } from "./Avatar";
import { ConfirmModal } from "./ConfirmModal";
import { useT } from "./LocaleProvider";
import { ScanAssignModal } from "./ScanAssignModal";

const centsToStr = (cents: number) => (cents / 100).toFixed(2);
/** Money inputs where 0 means "not on this receipt" render as empty. */
const centsToOptStr = (cents: number) => (cents === 0 ? "" : centsToStr(cents));

type Values = Record<string, string>;

type EditableItem = {
  key: string;
  rawText: string | null;
  name: string;
  qtyStr: string;
  totalStr: string;
  unitPriceCents: number | null;
  category: string | null;
  assignMode: AssignMode;
  shareAliasIds: string[];
  exactVals: Values;
};

/* Unassigned items (fresh scans, older drafts) default to an equal split
   between everyone; the UI no longer offers an "unassigned" state. */
function fromDto(item: ScanItemDto, allAliasIds: string[]): EditableItem {
  const unassigned = item.assignMode === "unassigned";
  return {
    key: item.id,
    rawText: item.rawText,
    name: item.name,
    qtyStr: String(item.quantity),
    totalStr: centsToStr(item.totalCents),
    unitPriceCents: item.unitPriceCents,
    category: item.category,
    assignMode: unassigned ? "equal" : item.assignMode,
    shareAliasIds: unassigned ? allAliasIds : item.shares.map((s) => s.aliasId),
    exactVals: Object.fromEntries(
      item.shares.filter((s) => s.exactCents !== null).map((s) => [s.aliasId, centsToStr(s.exactCents!)])
    ),
  };
}

function newItem(allAliasIds: string[]): EditableItem {
  return {
    key: crypto.randomUUID(),
    rawText: null,
    name: "",
    qtyStr: "1",
    totalStr: "",
    unitPriceCents: null,
    category: null,
    assignMode: "equal",
    shareAliasIds: allAliasIds,
    exactVals: {},
  };
}

/* The iOS decimal keypad has no minus key, so negative prices (discount
   lines) get a ± toggle button instead. */
const toggleSign = (s: string) => {
  const t = s.trim();
  return t.startsWith("-") ? t.slice(1) : `-${t}`;
};

/** Parse an optional money field ("" counts as 0); null = invalid input. */
const parseOptMoney = (s: string): number | null => (s.trim() === "" ? 0 : parseAmount(s));

export function ScanReviewView({ group, scan }: { group: GroupDto; scan: ScanDetailDto }) {
  const router = useRouter();
  const t = useT();
  const aliases = group.aliases;
  const allAliasIds = aliases.map((a) => a.id);
  const aliasNames = new Map(aliases.map((a) => [a.id, a.name]));
  const myAliasId = group.members.find((m) => m.userId === group.myUserId)?.aliasId ?? null;

  const [items, setItems] = useState<EditableItem[]>(() => scan.items.map((it) => fromDto(it, allAliasIds)));
  const [merchantStr, setMerchantStr] = useState(scan.merchant ?? "");
  const [dateStr, setDateStr] = useState(scan.date);
  const [currency, setCurrency] = useState(scan.currency);
  const [taxStr, setTaxStr] = useState(centsToOptStr(scan.taxCents));
  const [tipStr, setTipStr] = useState(centsToOptStr(scan.tipCents));
  const [discountStr, setDiscountStr] = useState(centsToOptStr(scan.discountsCents));
  const [totalStr, setTotalStr] = useState(centsToStr(scan.totalCents));
  const [payerAliasId, setPayerAliasId] = useState(myAliasId ?? aliases[0]?.id ?? "");
  const [assignItemKey, setAssignItemKey] = useState<string | null>(null);
  const [removeItemKey, setRemoveItemKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "convert" | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const serialize = (its: EditableItem[]) =>
    JSON.stringify({ merchantStr, dateStr, currency, taxStr, tipStr, discountStr, totalStr, its });
  const [snapshot, setSnapshot] = useState<string>(() => serialize(scan.items.map((it) => fromDto(it, allAliasIds))));
  const dirty = serialize(items) !== snapshot;

  const updateItem = (key: string, patch: Partial<EditableItem>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  // ----- validation & math (all derived, recomputed every render) -----

  const taxCents = parseOptMoney(taxStr);
  const tipCents = parseOptMoney(tipStr);
  const discountsCents = parseOptMoney(discountStr);
  const totalCents = parseAmount(totalStr);

  let draftError: string | null = null;
  if (items.length === 0) draftError = t("scanReview.keepOneItem");
  else if (!dateStr) draftError = t("scanReview.enterDate");
  else if (totalCents === null) draftError = t("scanReview.enterValidTotal");
  else if (taxCents === null || taxCents < 0) draftError = t("scanReview.invalidTax");
  else if (tipCents === null || tipCents < 0) draftError = t("scanReview.invalidTip");
  else if (discountsCents === null || discountsCents < 0) draftError = t("scanReview.invalidDiscount");
  else {
    for (const it of items) {
      const label = it.name.trim() || t("scanReview.anItem");
      if (!it.name.trim()) {
        draftError = t("scanReview.everyItemNeedsName");
        break;
      }
      if (parseAmount(it.totalStr) === null) {
        draftError = t("scanReview.invalidPriceFor", { name: label });
        break;
      }
      const qty = parseNumber(it.qtyStr);
      if (qty === null || qty <= 0) {
        draftError = t("scanReview.invalidQtyFor", { name: label });
        break;
      }
    }
  }

  const itemsSum = draftError
    ? 0
    : items.reduce((sum, it) => sum + (parseAmount(it.totalStr) ?? 0), 0);
  const computedCents = itemsSum + (taxCents ?? 0) + (tipCents ?? 0) - (discountsCents ?? 0);
  const mismatch = !draftError && totalCents !== null && computedCents !== totalCents;

  const buildShares = (it: EditableItem) =>
    it.shareAliasIds.map((aliasId) => ({
      aliasId,
      exactCents: it.assignMode === "exact" ? parseAmount(it.exactVals[aliasId] ?? "") : null,
    }));

  const convertItems: ConvertItem[] = draftError
    ? []
    : items.map((it) => ({
        name: it.name.trim(),
        totalCents: parseAmount(it.totalStr)!,
        assignMode: it.assignMode,
        shares: buildShares(it),
      }));
  const summary = draftError
    ? null
    : computePersonTotals(
        convertItems,
        { taxCents: taxCents!, tipCents: tipCents!, discountsCents: discountsCents! },
        currency,
        aliasNames,
        t
      );

  const convertError =
    draftError ??
    (summary && !summary.ok ? summary.error : null) ??
    (!payerAliasId ? t("splitError.selectWhoPaid") : null);

  // ----- actions -----

  const buildInput = (): ScanEditInput => ({
    scanId: scan.id,
    merchant: merchantStr.trim() || null,
    date: dateStr,
    currency,
    taxCents: taxCents!,
    tipCents: tipCents!,
    discountsCents: discountsCents!,
    totalCents: totalCents!,
    items: items.map((it, position) => ({
      position,
      rawText: it.rawText,
      name: it.name.trim(),
      quantity: parseNumber(it.qtyStr)!,
      unitPriceCents: it.unitPriceCents,
      totalCents: parseAmount(it.totalStr)!,
      category: it.category,
      assignMode: it.assignMode,
      shares: buildShares(it),
    })),
  });

  const save = async () => {
    if (draftError || busy) return;
    setBusy("save");
    setServerError(null);
    const result = await saveScan(buildInput());
    setBusy(null);
    if (result.ok) {
      setSnapshot(serialize(items));
      router.refresh();
    } else setServerError(result.error);
  };

  const convert = async () => {
    if (convertError || busy) return;
    setBusy("convert");
    setServerError(null);
    const result = await convertScan({ ...buildInput(), payerAliasId });
    if (result.ok) {
      router.push(`/groups/${group.id}`);
      return; // stay busy while navigating
    }
    setBusy(null);
    setServerError(result.error);
  };

  const assignItem = items.find((it) => it.key === assignItemKey) ?? null;
  const removeItem = items.find((it) => it.key === removeItemKey) ?? null;
  const removeItemCents = removeItem ? parseAmount(removeItem.totalStr) : null;
  const isConverted = scan.expenseId !== null;

  const summaryByAlias = new Map(
    summary?.ok ? summary.persons.map((p) => [p.aliasId, p]) : []
  );
  const poolTotal = (taxCents ?? 0) + (tipCents ?? 0) - (discountsCents ?? 0);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center gap-3">
        <Link
          href={`/groups/${group.id}/scan`}
          className="cursor-pointer rounded-md px-2 py-1 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label={t("scanReview.backAria")}
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold text-gray-800">{t("scanReview.title")}</h1>
          <p className="text-sm text-gray-500">{group.name}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            isConverted ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
          }`}
        >
          {isConverted ? t("scan.converted") : t("scan.draft")}
        </span>
      </div>

      <div className="space-y-4">
        {/* ---- receipt meta ---- */}
        <div className="card space-y-3 px-4 py-4">
          <div className="flex flex-wrap gap-2">
            <div className="min-w-40 flex-1 max-sm:basis-full">
              <label className="label" htmlFor="scan-merchant">{t("scanReview.merchant")}</label>
              <input
                id="scan-merchant"
                className="input"
                placeholder={t("scanReview.merchantPlaceholder")}
                value={merchantStr}
                onChange={(e) => setMerchantStr(e.target.value)}
              />
            </div>
            <div className="w-36 min-w-0 shrink-0 max-sm:flex-1">
              <label className="label" htmlFor="scan-date">{t("scanReview.date")}</label>
              <input
                id="scan-date"
                type="date"
                className="input"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>
            <div className="w-24 shrink-0">
              <label className="label" htmlFor="scan-cur">{t("scanReview.currency")}</label>
              <select
                id="scan-cur"
                className="input"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Four money fields: one row on desktop, a 2×2 grid on phones. */}
          <div className="flex flex-wrap gap-2">
            <div className="w-24 flex-1 max-sm:w-[calc(50%-0.25rem)] max-sm:flex-none">
              <label className="label" htmlFor="scan-tax">{t("scanReview.tax")}</label>
              <input id="scan-tax" className="input" placeholder="0.00" inputMode="decimal"
                value={taxStr} onChange={(e) => setTaxStr(e.target.value)} />
            </div>
            <div className="w-24 flex-1 max-sm:w-[calc(50%-0.25rem)] max-sm:flex-none">
              <label className="label" htmlFor="scan-tip">{t("scanReview.tip")}</label>
              <input id="scan-tip" className="input" placeholder="0.00" inputMode="decimal"
                value={tipStr} onChange={(e) => setTipStr(e.target.value)} />
            </div>
            <div className="w-24 flex-1 max-sm:w-[calc(50%-0.25rem)] max-sm:flex-none">
              <label className="label" htmlFor="scan-disc">{t("scanReview.discount")}</label>
              <input id="scan-disc" className="input" placeholder="0.00" inputMode="decimal"
                value={discountStr} onChange={(e) => setDiscountStr(e.target.value)} />
            </div>
            <div className="w-28 flex-1 max-sm:w-[calc(50%-0.25rem)] max-sm:flex-none">
              <label className="label" htmlFor="scan-total">{t("scanReview.receiptTotal")}</label>
              <input id="scan-total" className="input font-semibold" placeholder="0.00" inputMode="decimal"
                value={totalStr} onChange={(e) => setTotalStr(e.target.value)} />
            </div>
          </div>
          {currency !== group.currency && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
              {t("scanReview.foreignNote", { currency, groupCurrency: group.currency })}
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-gray-500 hover:text-gray-700">
              {t("scanReview.showPhoto")}
            </summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/receipts/${scan.id}/image`}
              alt={t("scanReview.photoAlt")}
              loading="lazy"
              className="mt-2 max-h-[70vh] w-full rounded-lg border border-gray-200 object-contain"
            />
          </details>
        </div>

        {mismatch && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {t("scanReview.mismatch1")} <strong>{formatCents(computedCents, currency)}</strong>
            {t("scanReview.mismatch2")} <strong>{formatCents(totalCents!, currency)}</strong>
            {t("scanReview.mismatch3")}{" "}
            <button
              type="button"
              className="cursor-pointer font-semibold underline"
              onClick={() => setTotalStr(centsToStr(computedCents))}
            >
              {t("scanReview.setTotalTo", { amount: formatCents(computedCents, currency) })}
            </button>
          </div>
        )}

        {/* ---- items ---- */}
        <div className="card">
          <div className="hidden gap-2 border-b border-gray-100 px-4 py-2 sm:flex">
            <span className="label !mb-0 min-w-40 flex-1">{t("scanReview.item")}</span>
            <span className="label !mb-0 w-14 shrink-0 text-right">{t("scanReview.qty")}</span>
            <span className="label !mb-0 w-24 shrink-0 text-right">{t("scanReview.price")}</span>
            <span className="label !mb-0 w-44 shrink-0">{t("scanReview.whoPays")}</span>
            <span className="w-6 shrink-0" />
          </div>
          <ul className="divide-y divide-gray-100">
            {items.map((it) => {
              const itemCents = parseAmount(it.totalStr);
              const selectValue = it.assignMode === "single" ? it.shareAliasIds[0] : "__split";
              return (
                <li key={it.key} className="flex flex-wrap items-start gap-2 px-4 py-3">
                  <div className="min-w-40 flex-1">
                    <input
                      className="input !py-1.5"
                      placeholder={t("scanReview.itemName")}
                      aria-label={t("scanReview.itemName")}
                      value={it.name}
                      onChange={(e) => updateItem(it.key, { name: e.target.value })}
                    />
                    {it.rawText && it.rawText !== it.name && (
                      <p className="mt-0.5 truncate text-[11px] text-gray-400" title={it.rawText}>
                        {it.rawText}
                      </p>
                    )}
                    {it.unitPriceCents !== null && (parseNumber(it.qtyStr) ?? 1) !== 1 && (
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {it.qtyStr} × {formatCents(it.unitPriceCents, currency)}
                      </p>
                    )}
                  </div>
                  {/* Phone layout via order utilities: name on the first line,
                      qty + sign + price + remove on the second, assignment
                      full-width below. */}
                  <div className="w-14 shrink-0 max-sm:order-1">
                    <input
                      className="input !px-2 !py-1.5 text-right"
                      aria-label={t("scanReview.quantityAria")}
                      inputMode="decimal"
                      value={it.qtyStr}
                      onChange={(e) => updateItem(it.key, { qtyStr: e.target.value })}
                    />
                  </div>
                  <div className="flex w-24 shrink-0 max-sm:order-1 max-sm:flex-1">
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={t("scanReview.toggleNegAria")}
                      title={t("scanReview.toggleNegTitle")}
                      className={`cursor-pointer rounded-l-lg border border-r-0 border-gray-300 px-2 text-sm font-medium transition-colors ${
                        itemCents !== null && itemCents < 0
                          ? "bg-red-50 text-red-600 hover:bg-red-100"
                          : "bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                      }`}
                      onClick={() => updateItem(it.key, { totalStr: toggleSign(it.totalStr) })}
                    >
                      ±
                    </button>
                    <input
                      className={`input min-w-0 flex-1 !rounded-l-none !py-1.5 text-right ${itemCents !== null && itemCents < 0 ? "amount-neg" : ""}`}
                      placeholder="0.00"
                      aria-label={t("scanReview.priceAria")}
                      inputMode="decimal"
                      value={it.totalStr}
                      onChange={(e) => updateItem(it.key, { totalStr: e.target.value })}
                    />
                  </div>
                  <div className="w-44 shrink-0 max-sm:order-2 max-sm:w-full">
                    <select
                      className="input !py-1.5"
                      aria-label={t("scanReview.whoPaysAria")}
                      value={selectValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__split") {
                          setAssignItemKey(it.key);
                        } else {
                          updateItem(it.key, { assignMode: "single", shareAliasIds: [v], exactVals: {} });
                        }
                      }}
                    >
                      {aliases.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                      <option value="__split">
                        {it.assignMode === "equal" || it.assignMode === "exact"
                          ? t("scanReview.splitCount", {
                              count: it.shareAliasIds.length,
                              word: countWord(t, it.shareAliasIds.length, "count.person", "count.people"),
                            })
                          : t("scanReview.splitBetween")}
                      </option>
                    </select>
                    {(it.assignMode === "equal" || it.assignMode === "exact") && (
                      <button
                        type="button"
                        className="mt-0.5 cursor-pointer text-xs text-gray-500 underline hover:text-gray-700"
                        onClick={() => setAssignItemKey(it.key)}
                      >
                        {t("scanReview.editSplit")}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="w-6 shrink-0 cursor-pointer rounded-md py-1 text-center text-lg leading-none text-red-400 hover:bg-red-50 hover:text-red-600 max-sm:order-1"
                    aria-label={t("scanReview.removeItemAria")}
                    onClick={() => setRemoveItemKey(it.key)}
                  >
                    &times;
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2">
            <button
              type="button"
              className="cursor-pointer text-sm font-semibold hover:underline"
              style={{ color: "var(--brand-dark)" }}
              onClick={() => setItems((list) => [...list, newItem(allAliasIds)])}
            >
              {t("scanReview.addItem")}
            </button>
            <p className="text-sm font-semibold text-gray-500">
              {t("scanReview.itemsSum", { amount: formatCents(itemsSum, currency) })}
            </p>
          </div>
        </div>

        {/* ---- summary ---- */}
        <div className="card space-y-3 px-4 py-4">
          <p className="label">{t("scanReview.summary")}</p>
          {summary?.ok ? (
            <>
              <ul>
                {aliases
                  .filter((a) => summaryByAlias.has(a.id))
                  .map((a) => {
                    const p = summaryByAlias.get(a.id)!;
                    return (
                      <li key={a.id} className="flex items-center gap-2 py-1">
                        <Avatar id={a.id} name={a.name} size={26} />
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{a.name}</span>
                        {poolTotal !== 0 && (
                          <span className="shrink-0 text-xs text-gray-400">
                            {formatCents(p.itemCents, currency)} {p.poolCents >= 0 ? "+" : "−"}{" "}
                            {formatCents(Math.abs(p.poolCents), currency)}
                          </span>
                        )}
                        <span className="shrink-0 text-sm font-semibold text-gray-800">
                          {formatCents(p.totalCents, currency)}
                        </span>
                      </li>
                    );
                  })}
              </ul>
              <p className="border-t border-gray-100 pt-2 text-right text-sm font-bold text-gray-800">
                {t("scanReview.total", { amount: formatCents(summary.grandTotalCents, currency) })}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400">
              {summary && !summary.ok ? summary.error : t("scanReview.completeDetails")}
            </p>
          )}

          <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
            <label className="label !mb-0 shrink-0" htmlFor="scan-payer">{t("scanReview.paidBy")}</label>
            <select
              id="scan-payer"
              className="input max-w-52"
              value={payerAliasId}
              onChange={(e) => setPayerAliasId(e.target.value)}
            >
              {aliases.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {(serverError || draftError) && (
            <p className="text-sm font-medium text-red-600">{serverError ?? draftError}</p>
          )}

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void save()}
              disabled={!!busy || !!draftError || !dirty}
            >
              {busy === "save" ? t("scanReview.saving") : dirty ? t("scanReview.saveDraft") : t("scanReview.saved")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void convert()}
              disabled={!!busy || !!convertError}
            >
              {busy === "convert"
                ? t("scanReview.converting")
                : isConverted
                  ? t("scanReview.updateLinked")
                  : t("scanReview.convertToExpense")}
            </button>
          </div>
        </div>
      </div>

      {assignItem && (
        <ScanAssignModal
          itemName={assignItem.name.trim() || t("scanReview.itemFallback")}
          itemTotalCents={parseAmount(assignItem.totalStr)}
          currency={currency}
          aliases={aliases}
          initialMode={assignItem.assignMode === "exact" ? "exact" : "equal"}
          initialSelected={assignItem.shareAliasIds}
          initialExactVals={assignItem.exactVals}
          onDone={(mode, selectedIds, exactVals) => {
            updateItem(assignItem.key, {
              assignMode: mode,
              shareAliasIds: selectedIds,
              exactVals,
            });
            setAssignItemKey(null);
          }}
          onClose={() => setAssignItemKey(null)}
        />
      )}

      {removeItem && (
        <ConfirmModal
          message={t("scanReview.removeItemConfirm", {
            name: removeItem.name.trim() || t("scanReview.itemFallback"),
            price: removeItemCents !== null ? ` (${formatCents(removeItemCents, currency)})` : "",
          })}
          confirmLabel={t("common.remove")}
          onConfirm={() => setItems((list) => list.filter((x) => x.key !== removeItem.key))}
          onClose={() => setRemoveItemKey(null)}
        />
      )}
    </div>
  );
}
