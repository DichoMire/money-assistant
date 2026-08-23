"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { convertScan, saveScan } from "@/app/receipt-actions";
import { CURRENCIES } from "@/lib/currencies";
import { formatCents, parseAmount, parseNumber } from "@/lib/money";
import { computePersonTotals, type AssignMode, type ConvertItem } from "@/lib/receipt-convert";
import type { GroupDto, ScanDetailDto, ScanEditInput, ScanItemDto } from "@/lib/types";
import { Avatar } from "./Avatar";
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

function fromDto(item: ScanItemDto): EditableItem {
  return {
    key: item.id,
    rawText: item.rawText,
    name: item.name,
    qtyStr: String(item.quantity),
    totalStr: centsToStr(item.totalCents),
    unitPriceCents: item.unitPriceCents,
    category: item.category,
    assignMode: item.assignMode,
    shareAliasIds: item.shares.map((s) => s.aliasId),
    exactVals: Object.fromEntries(
      item.shares.filter((s) => s.exactCents !== null).map((s) => [s.aliasId, centsToStr(s.exactCents!)])
    ),
  };
}

function newItem(): EditableItem {
  return {
    key: crypto.randomUUID(),
    rawText: null,
    name: "",
    qtyStr: "1",
    totalStr: "",
    unitPriceCents: null,
    category: null,
    assignMode: "unassigned",
    shareAliasIds: [],
    exactVals: {},
  };
}

/** Parse an optional money field ("" counts as 0); null = invalid input. */
const parseOptMoney = (s: string): number | null => (s.trim() === "" ? 0 : parseAmount(s));

export function ScanReviewView({ group, scan }: { group: GroupDto; scan: ScanDetailDto }) {
  const router = useRouter();
  const aliases = group.aliases;
  const aliasNames = new Map(aliases.map((a) => [a.id, a.name]));
  const myAliasId = group.members.find((m) => m.userId === group.myUserId)?.aliasId ?? null;

  const [items, setItems] = useState<EditableItem[]>(() => scan.items.map(fromDto));
  const [merchantStr, setMerchantStr] = useState(scan.merchant ?? "");
  const [dateStr, setDateStr] = useState(scan.date);
  const [currency, setCurrency] = useState(scan.currency);
  const [taxStr, setTaxStr] = useState(centsToOptStr(scan.taxCents));
  const [tipStr, setTipStr] = useState(centsToOptStr(scan.tipCents));
  const [discountStr, setDiscountStr] = useState(centsToOptStr(scan.discountsCents));
  const [totalStr, setTotalStr] = useState(centsToStr(scan.totalCents));
  const [payerAliasId, setPayerAliasId] = useState(myAliasId ?? aliases[0]?.id ?? "");
  const [assignItemKey, setAssignItemKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "convert" | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const serialize = (its: EditableItem[]) =>
    JSON.stringify({ merchantStr, dateStr, currency, taxStr, tipStr, discountStr, totalStr, its });
  const [snapshot, setSnapshot] = useState<string>(() => serialize(scan.items.map(fromDto)));
  const dirty = serialize(items) !== snapshot;

  const updateItem = (key: string, patch: Partial<EditableItem>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  // ----- validation & math (all derived, recomputed every render) -----

  const taxCents = parseOptMoney(taxStr);
  const tipCents = parseOptMoney(tipStr);
  const discountsCents = parseOptMoney(discountStr);
  const totalCents = parseAmount(totalStr);

  let draftError: string | null = null;
  if (items.length === 0) draftError = "Keep at least one item.";
  else if (!dateStr) draftError = "Enter a date.";
  else if (totalCents === null) draftError = "Enter a valid receipt total.";
  else if (taxCents === null || taxCents < 0) draftError = "Invalid tax amount.";
  else if (tipCents === null || tipCents < 0) draftError = "Invalid tip amount.";
  else if (discountsCents === null || discountsCents < 0) draftError = "Invalid discount amount.";
  else {
    for (const it of items) {
      const label = it.name.trim() || "an item";
      if (!it.name.trim()) {
        draftError = "Every item needs a name.";
        break;
      }
      if (parseAmount(it.totalStr) === null) {
        draftError = `Invalid price for "${label}".`;
        break;
      }
      const qty = parseNumber(it.qtyStr);
      if (qty === null || qty <= 0) {
        draftError = `Invalid quantity for "${label}".`;
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
        aliasNames
      );

  const unassignedItems = items.filter(
    (it) => it.assignMode === "unassigned" && parseAmount(it.totalStr) !== 0
  );
  const convertError =
    draftError ??
    (summary && !summary.ok ? summary.error : null) ??
    (!payerAliasId ? "Select who paid." : null);

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

  const assignRemainingToEveryone = () =>
    setItems((list) =>
      list.map((it) =>
        it.assignMode === "unassigned" && parseAmount(it.totalStr) !== 0
          ? { ...it, assignMode: "equal", shareAliasIds: aliases.map((a) => a.id), exactVals: {} }
          : it
      )
    );

  const assignItem = items.find((it) => it.key === assignItemKey) ?? null;
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
          aria-label="Back to receipt upload"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold text-gray-800">Review receipt</h1>
          <p className="text-sm text-gray-500">{group.name}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            isConverted ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
          }`}
        >
          {isConverted ? "Converted" : "Draft"}
        </span>
      </div>

      <div className="space-y-4">
        {/* ---- receipt meta ---- */}
        <div className="card space-y-3 px-4 py-4">
          <div className="flex flex-wrap gap-2">
            <div className="min-w-40 flex-1">
              <label className="label" htmlFor="scan-merchant">Merchant</label>
              <input
                id="scan-merchant"
                className="input"
                placeholder="Store or restaurant"
                value={merchantStr}
                onChange={(e) => setMerchantStr(e.target.value)}
              />
            </div>
            <div className="w-36 shrink-0">
              <label className="label" htmlFor="scan-date">Date</label>
              <input
                id="scan-date"
                type="date"
                className="input"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>
            <div className="w-24 shrink-0">
              <label className="label" htmlFor="scan-cur">Currency</label>
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
          <div className="flex flex-wrap gap-2">
            <div className="w-24 flex-1">
              <label className="label" htmlFor="scan-tax">Tax</label>
              <input id="scan-tax" className="input" placeholder="0.00" inputMode="decimal"
                value={taxStr} onChange={(e) => setTaxStr(e.target.value)} />
            </div>
            <div className="w-24 flex-1">
              <label className="label" htmlFor="scan-tip">Tip</label>
              <input id="scan-tip" className="input" placeholder="0.00" inputMode="decimal"
                value={tipStr} onChange={(e) => setTipStr(e.target.value)} />
            </div>
            <div className="w-24 flex-1">
              <label className="label" htmlFor="scan-disc">Discount</label>
              <input id="scan-disc" className="input" placeholder="0.00" inputMode="decimal"
                value={discountStr} onChange={(e) => setDiscountStr(e.target.value)} />
            </div>
            <div className="w-28 flex-1">
              <label className="label" htmlFor="scan-total">Receipt total</label>
              <input id="scan-total" className="input font-semibold" placeholder="0.00" inputMode="decimal"
                value={totalStr} onChange={(e) => setTotalStr(e.target.value)} />
            </div>
          </div>
          {currency !== group.currency && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
              This receipt is in {currency}; balances are kept in {group.currency} using the
              exchange rate of the transaction date (or the nearest available).
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-gray-500 hover:text-gray-700">
              Show receipt photo
            </summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/receipts/${scan.id}/image`}
              alt="Scanned receipt"
              loading="lazy"
              className="mt-2 max-h-[70vh] w-full rounded-lg border border-gray-200 object-contain"
            />
          </details>
        </div>

        {mismatch && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Items + tax/tip − discounts add up to{" "}
            <strong>{formatCents(computedCents, currency)}</strong>, but the receipt total reads{" "}
            <strong>{formatCents(totalCents!, currency)}</strong>. Check the items against the
            photo — the converted expense will use the items&apos; sum.{" "}
            <button
              type="button"
              className="cursor-pointer font-semibold underline"
              onClick={() => setTotalStr(centsToStr(computedCents))}
            >
              Set total to {formatCents(computedCents, currency)}
            </button>
          </div>
        )}

        {/* ---- items ---- */}
        <div className="card">
          <div className="hidden gap-2 border-b border-gray-100 px-4 py-2 sm:flex">
            <span className="label !mb-0 min-w-40 flex-1">Item</span>
            <span className="label !mb-0 w-14 shrink-0">Qty</span>
            <span className="label !mb-0 w-24 shrink-0 text-right">Price</span>
            <span className="label !mb-0 w-44 shrink-0">Who pays</span>
            <span className="w-6 shrink-0" />
          </div>
          <ul className="divide-y divide-gray-100">
            {items.map((it) => {
              const itemCents = parseAmount(it.totalStr);
              const selectValue =
                it.assignMode === "single"
                  ? it.shareAliasIds[0]
                  : it.assignMode === "unassigned"
                    ? ""
                    : "__split";
              return (
                <li key={it.key} className="flex flex-wrap items-start gap-2 px-4 py-3">
                  <div className="min-w-40 flex-1">
                    <input
                      className="input !py-1.5"
                      placeholder="Item name"
                      aria-label="Item name"
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
                  <div className="w-14 shrink-0">
                    <input
                      className="input !px-2 !py-1.5 text-right"
                      aria-label="Quantity"
                      inputMode="decimal"
                      value={it.qtyStr}
                      onChange={(e) => updateItem(it.key, { qtyStr: e.target.value })}
                    />
                  </div>
                  <div className="w-24 shrink-0">
                    <input
                      className={`input !py-1.5 text-right ${itemCents !== null && itemCents < 0 ? "amount-neg" : ""}`}
                      placeholder="0.00"
                      aria-label="Price"
                      inputMode="decimal"
                      value={it.totalStr}
                      onChange={(e) => updateItem(it.key, { totalStr: e.target.value })}
                    />
                  </div>
                  <div className="w-44 shrink-0">
                    <select
                      className="input !py-1.5"
                      aria-label="Who pays for this item"
                      value={selectValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") {
                          updateItem(it.key, { assignMode: "unassigned", shareAliasIds: [], exactVals: {} });
                        } else if (v === "__split") {
                          setAssignItemKey(it.key);
                        } else {
                          updateItem(it.key, { assignMode: "single", shareAliasIds: [v], exactVals: {} });
                        }
                      }}
                    >
                      <option value="">Assign to…</option>
                      {aliases.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                      <option value="__split">
                        {it.assignMode === "equal" || it.assignMode === "exact"
                          ? `Split · ${it.shareAliasIds.length} ${it.shareAliasIds.length === 1 ? "person" : "people"}`
                          : "Split between several…"}
                      </option>
                    </select>
                    {(it.assignMode === "equal" || it.assignMode === "exact") && (
                      <button
                        type="button"
                        className="mt-0.5 cursor-pointer text-xs text-gray-500 underline hover:text-gray-700"
                        onClick={() => setAssignItemKey(it.key)}
                      >
                        edit split
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="cursor-pointer rounded-md px-1.5 py-1 text-lg leading-none text-gray-300 hover:bg-red-50 hover:text-red-500"
                    aria-label="Remove item"
                    onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))}
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
              onClick={() => setItems((list) => [...list, newItem()])}
            >
              + Add item
            </button>
            <p className="text-sm font-semibold text-gray-500">
              Items: {formatCents(itemsSum, currency)}
            </p>
          </div>
        </div>

        {/* ---- summary ---- */}
        <div className="card space-y-3 px-4 py-4">
          <p className="label">Summary</p>
          {unassignedItems.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {unassignedItems.length} {unassignedItems.length === 1 ? "item" : "items"} not
              assigned yet.{" "}
              <button
                type="button"
                className="cursor-pointer font-semibold underline"
                onClick={assignRemainingToEveryone}
              >
                Split the rest between everyone
              </button>
            </div>
          )}
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
                Total: {formatCents(summary.grandTotalCents, currency)}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400">
              {summary && !summary.ok
                ? summary.error
                : "Assign the items to see who owes what."}
            </p>
          )}

          <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
            <label className="label !mb-0 shrink-0" htmlFor="scan-payer">Paid by</label>
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
              {busy === "save" ? "Saving…" : dirty ? "Save draft" : "Saved"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void convert()}
              disabled={!!busy || !!convertError}
            >
              {busy === "convert"
                ? "Converting…"
                : isConverted
                  ? "Update linked expense"
                  : "Convert to expense"}
            </button>
          </div>
        </div>
      </div>

      {assignItem && (
        <ScanAssignModal
          itemName={assignItem.name.trim() || "item"}
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
    </div>
  );
}
