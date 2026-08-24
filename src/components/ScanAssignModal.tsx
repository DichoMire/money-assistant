"use client";

import { useState } from "react";
import { allocateByWeights, formatCents, parseAmount } from "@/lib/money";
import type { AliasDto } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useT } from "./LocaleProvider";
import { Modal } from "./Modal";

type Values = Record<string, string>;

/**
 * Per-item "complex division" editor: share the line equally among a subgroup,
 * or give each chosen person an exact amount (must sum to the line total).
 */
export function ScanAssignModal({
  itemName,
  itemTotalCents,
  currency,
  aliases,
  initialMode,
  initialSelected,
  initialExactVals,
  onDone,
  onClose,
}: {
  itemName: string;
  itemTotalCents: number | null;
  currency: string;
  aliases: AliasDto[];
  initialMode: "equal" | "exact";
  initialSelected: string[];
  initialExactVals: Values;
  onDone: (mode: "equal" | "exact", selectedIds: string[], exactVals: Values) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"equal" | "exact">(initialMode);
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const sel: Record<string, boolean> = {};
    // An unsplit item opens with everyone selected — the common "shared by
    // the table" case; a previously split item restores its subgroup.
    const preset = initialSelected.length > 0 ? new Set(initialSelected) : null;
    for (const a of aliases) sel[a.id] = preset ? preset.has(a.id) : true;
    return sel;
  });
  const [exactVals, setExactVals] = useState<Values>(initialExactVals);

  const selectedIds = aliases.filter((a) => selected[a.id]).map((a) => a.id);
  const equalShares =
    itemTotalCents !== null && selectedIds.length > 0
      ? allocateByWeights(itemTotalCents, selectedIds.map(() => 1))
      : null;
  const equalByAlias = new Map(selectedIds.map((id, i) => [id, equalShares?.[i] ?? 0]));

  const exactEntered = selectedIds.reduce(
    (sum, id) => sum + (parseAmount((exactVals[id] ?? "").trim() || "0") ?? 0),
    0
  );
  const exactInvalid = selectedIds.some(
    (id) => (exactVals[id] ?? "").trim() !== "" && parseAmount(exactVals[id]) === null
  );
  const exactOk =
    itemTotalCents !== null && !exactInvalid && exactEntered === itemTotalCents;

  const doneDisabled = selectedIds.length === 0 || (mode === "exact" && !exactOk);

  const done = () => {
    if (doneDisabled) return;
    onDone(
      mode,
      selectedIds,
      mode === "exact"
        ? Object.fromEntries(selectedIds.map((id) => [id, exactVals[id] ?? ""]))
        : {}
    );
  };

  return (
    <Modal title={t("assign.title", { name: itemName })} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-1">
          {(
            [
              { key: "equal", label: t("assign.equally") },
              { key: "exact", label: t("assign.exactAmounts") },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              className={`flex-1 cursor-pointer rounded-lg border px-2 py-1.5 text-sm font-bold transition-colors ${
                mode === tab.key
                  ? "border-transparent text-white"
                  : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              }`}
              style={mode === tab.key ? { background: "var(--brand)" } : undefined}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="text-center text-xs text-gray-500">
          {mode === "equal" ? t("assign.equalHint") : t("assign.exactHint")}
        </p>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {aliases.map((a) => {
            const isSelected = !!selected[a.id];
            return (
              <div key={a.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                  onClick={() => setSelected({ ...selected, [a.id]: !isSelected })}
                >
                  <CheckDot checked={isSelected} />
                  <Avatar id={a.id} name={a.name} size={28} />
                  <span
                    className={`min-w-0 flex-1 truncate text-sm font-medium ${
                      isSelected ? "text-gray-700" : "text-gray-400 line-through"
                    }`}
                  >
                    {a.name}
                  </span>
                  {mode === "equal" && isSelected && equalShares && (
                    <span className="text-sm font-semibold text-gray-500">
                      {formatCents(equalByAlias.get(a.id)!, currency)}
                    </span>
                  )}
                </button>
                {mode === "exact" && isSelected && (
                  <div className="w-28 shrink-0">
                    <input
                      className="input !py-1.5 text-right"
                      placeholder="0.00"
                      inputMode="decimal"
                      value={exactVals[a.id] ?? ""}
                      onChange={(e) => setExactVals({ ...exactVals, [a.id]: e.target.value })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-gray-100 px-2 pt-3">
          {selectedIds.length === 0 ? (
            <p className="text-sm font-semibold text-red-600">{t("split.selectAtLeastOne")}</p>
          ) : mode === "exact" && itemTotalCents !== null ? (
            <p className={`text-sm font-semibold ${exactOk ? "text-gray-500" : "text-red-600"}`}>
              {t("split.enteredLeft", {
                entered: formatCents(exactEntered, currency),
                total: formatCents(itemTotalCents, currency),
                left: formatCents(itemTotalCents - exactEntered, currency),
              })}
            </p>
          ) : mode === "exact" ? (
            <p className="text-sm font-semibold text-red-600">{t("assign.enterValidPrice")}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn-primary" onClick={done} disabled={doneDisabled}>
            {t("common.done")}
          </button>
        </div>
      </div>
    </Modal>
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
