"use client";

import { formatCents } from "@/lib/money";
import { ROUNDING_WRITE_OFF_CENTS, type Debt } from "@/lib/simplify";
import type { GroupDto } from "@/lib/types";
import { Avatar } from "./Avatar";

export function BalancesPanel({
  data,
  simplify,
  canToggle,
  onToggleSimplify,
  onSettle,
}: {
  data: GroupDto;
  simplify: boolean;
  canToggle: boolean;
  onToggleSimplify: (value: boolean) => void;
  onSettle: (debt: Debt) => void;
}) {
  const names = new Map(data.aliases.map((a) => [a.id, a.name]));
  const name = (id: string) => names.get(id) ?? "?";
  const debts = simplify ? data.simplifiedDebts : data.pairwiseDebts;

  // Chips are derived from the payment list on display, so they always agree
  // with it exactly — including after tiny rounding write-offs.
  const derivedNet = new Map<string, number>();
  for (const d of debts) {
    derivedNet.set(d.fromAliasId, (derivedNet.get(d.fromAliasId) ?? 0) - d.amountCents);
    derivedNet.set(d.toAliasId, (derivedNet.get(d.toAliasId) ?? 0) + d.amountCents);
  }
  const balances = data.aliases
    .map((a) => ({ ...a, net: derivedNet.get(a.id) ?? 0 }))
    .sort((a, b) => b.net - a.net);
  const hasWriteOff = data.aliases.some(
    (a) => (data.netBalances[a.id] ?? 0) !== (derivedNet.get(a.id) ?? 0)
  );

  return (
    <div className="space-y-5">
      <div className="card px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-gray-800">Balances</h2>
          <label
            className={`flex items-center gap-2 text-xs font-semibold text-gray-500 ${canToggle ? "cursor-pointer" : "opacity-60"}`}
            title={canToggle ? undefined : "Only the group owner can change this"}
          >
            Simplify debts
            <span
              role="switch"
              aria-checked={simplify}
              aria-disabled={!canToggle}
              tabIndex={canToggle ? 0 : -1}
              onClick={() => canToggle && onToggleSimplify(!simplify)}
              onKeyDown={(e) => {
                if (canToggle && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onToggleSimplify(!simplify);
                }
              }}
              className="relative inline-block h-5 w-9 rounded-full transition-colors"
              style={{ background: simplify ? "var(--brand)" : "#d1d5db" }}
            >
              <span
                className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
                style={{ left: simplify ? 18 : 2 }}
              />
            </span>
          </label>
        </div>

        <ul className="space-y-2">
          {balances.map((b) => (
            <li key={b.id} className="flex items-center gap-2 text-sm">
              <Avatar id={b.id} name={b.name} size={28} />
              <span className="min-w-0 flex-1 truncate font-medium text-gray-700">{b.name}</span>
              {b.net === 0 ? (
                <span className="text-gray-400">settled up</span>
              ) : (
                <span className={`font-bold ${b.net > 0 ? "amount-pos" : "amount-neg"}`}>
                  {b.net > 0 ? "gets back " : "owes "}
                  {formatCents(Math.abs(b.net), data.currency)}
                </span>
              )}
            </li>
          ))}
        </ul>
        {hasWriteOff && (
          <p className="mt-3 text-xs text-gray-400">
            Rounding differences of up to {formatCents(ROUNDING_WRITE_OFF_CENTS, data.currency)}{" "}
            are written off.
          </p>
        )}
      </div>

      <div className="card px-4 py-4">
        <h2 className="mb-1 font-bold text-gray-800">
          {simplify ? "Suggested payments" : "Who owes whom"}
        </h2>
        <p className="mb-3 text-xs text-gray-400">
          {simplify
            ? "Debts are simplified into the fewest possible payments."
            : "Each debt is shown as-is, netted per pair."}
        </p>
        {debts.length === 0 ? (
          <p className="text-sm text-gray-400">Everyone is settled up 🎉</p>
        ) : (
          <ul className="space-y-2">
            {debts.map((d, i) => (
              <li
                key={`${d.fromAliasId}-${d.toAliasId}-${i}`}
                className="flex items-center gap-2 text-sm"
              >
                <Avatar id={d.fromAliasId} name={name(d.fromAliasId)} size={24} />
                <span className="min-w-0 flex-1 truncate text-gray-700">
                  <span className="font-medium">{name(d.fromAliasId)}</span>
                  <span className="text-gray-400"> owes </span>
                  <span className="font-medium">{name(d.toAliasId)}</span>
                </span>
                <span className="font-bold text-gray-800">
                  {formatCents(d.amountCents, data.currency)}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary !px-2.5 !py-1 !text-xs"
                  onClick={() => onSettle(d)}
                >
                  Settle
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
