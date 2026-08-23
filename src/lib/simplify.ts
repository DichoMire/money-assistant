import { allocateByWeights } from "./money";

/** A transaction with amounts already converted to the group currency. */
export type BalanceTransaction = {
  payers: { aliasId: string; cents: number }[];
  shares: { aliasId: string; cents: number }[];
};

export type Debt = { fromAliasId: string; toAliasId: string; amountCents: number };

/**
 * Net imbalances up to this many cents are treated as settled. Integer splits
 * hand their spare cents to different people per expense, which otherwise
 * accumulates into silly suggestions like "pay 1 cent".
 */
export const ROUNDING_WRITE_OFF_CENTS = 2;

/**
 * Write off tiny net imbalances: entries within the threshold become zero and
 * the written-off cents are absorbed by the largest remaining balances (moving
 * them toward zero, never past it), so the total still sums to exactly zero.
 * Runs in passes because absorbing can itself create a new tiny balance.
 */
export function forgiveRounding(
  net: Map<string, number>,
  writeOffCents = ROUNDING_WRITE_OFF_CENTS
): Map<string, number> {
  const adjusted = new Map(net);
  for (let pass = 0; pass < 10; pass++) {
    let forgiven = 0;
    for (const [id, value] of adjusted) {
      if (value !== 0 && Math.abs(value) <= writeOffCents) {
        forgiven += value;
        adjusted.set(id, 0);
      }
    }
    if (forgiven === 0) break;
    // The remaining entries sum to -forgiven, so there is always enough mass
    // of the opposite sign to absorb it without any balance crossing zero.
    while (forgiven !== 0) {
      let bestId: string | null = null;
      let bestValue = 0;
      for (const [id, value] of adjusted) {
        if (Math.sign(value) === -Math.sign(forgiven) && Math.abs(value) > Math.abs(bestValue)) {
          bestId = id;
          bestValue = value;
        }
      }
      if (bestId === null) break;
      const amount = Math.sign(forgiven) * Math.min(Math.abs(forgiven), Math.abs(bestValue));
      adjusted.set(bestId, bestValue + amount);
      forgiven -= amount;
    }
  }
  return adjusted;
}

/**
 * Nudge debt amounts so each person's implied net (incoming minus outgoing)
 * matches the target nets. Deltas are at most a few written-off cents; each
 * step shrinks the remaining delta, so this terminates quickly.
 */
function applyNetCorrections(debts: Debt[], delta: Map<string, number>): void {
  for (let guard = 0; guard < 10_000; guard++) {
    let underpaid: string | null = null; // delta > 0: should pay less / receive more
    let overpaid: string | null = null; // delta < 0: should pay more / receive less
    for (const [id, d] of delta) {
      if (d > 0 && underpaid === null) underpaid = id;
      if (d < 0 && overpaid === null) overpaid = id;
    }
    if (underpaid === null || overpaid === null) break;
    const step = Math.min(delta.get(underpaid)!, -delta.get(overpaid)!);

    const forward = debts.find(
      (x) => x.fromAliasId === underpaid && x.toAliasId === overpaid && x.amountCents > 0
    );
    if (forward) {
      const amount = Math.min(step, forward.amountCents);
      forward.amountCents -= amount;
      delta.set(underpaid, delta.get(underpaid)! - amount);
      delta.set(overpaid, delta.get(overpaid)! + amount);
      continue;
    }
    const backward = debts.find((x) => x.fromAliasId === overpaid && x.toAliasId === underpaid);
    if (backward) backward.amountCents += step;
    else debts.push({ fromAliasId: overpaid, toAliasId: underpaid, amountCents: step });
    delta.set(underpaid, delta.get(underpaid)! - step);
    delta.set(overpaid, delta.get(overpaid)! + step);
  }
}

/** Net balance per person: positive = is owed money, negative = owes money. */
export function netBalances(transactions: BalanceTransaction[]): Map<string, number> {
  const net = new Map<string, number>();
  const add = (aliasId: string, cents: number) =>
    net.set(aliasId, (net.get(aliasId) ?? 0) + cents);
  for (const tx of transactions) {
    for (const p of tx.payers) add(p.aliasId, p.cents);
    for (const s of tx.shares) add(s.aliasId, -s.cents);
  }
  return net;
}

/**
 * Non-simplified debts: within each transaction every ower owes the payer(s),
 * split proportionally to how much each payer put in. Mutual debts between the
 * same two people are netted across transactions (A owes B 10 and B owes A 4
 * collapses to A owes B 6), matching how Splitwise displays balances. Amounts
 * are then nudged by at most a few cents so everyone's net matches the
 * rounding-forgiven balances, and leftover tiny debts are dropped.
 */
export function pairwiseDebts(
  transactions: BalanceTransaction[],
  writeOffCents = ROUNDING_WRITE_OFF_CENTS
): Debt[] {
  const matrix = new Map<string, number>(); // "from|to" -> cents
  const add = (from: string, to: string, cents: number) => {
    if (cents === 0 || from === to) return;
    const key = `${from}|${to}`;
    matrix.set(key, (matrix.get(key) ?? 0) + cents);
  };

  for (const tx of transactions) {
    const payers = tx.payers.filter((p) => p.cents > 0);
    if (payers.length === 0) continue;
    for (const share of tx.shares) {
      if (share.cents <= 0) continue;
      // The payer's own share cancels against their payment implicitly:
      // they "owe themselves", which add() drops.
      const parts = allocateByWeights(share.cents, payers.map((p) => p.cents));
      payers.forEach((p, i) => add(share.aliasId, p.aliasId, parts[i]));
    }
  }

  const debts: Debt[] = [];
  const seen = new Set<string>();
  for (const [key, cents] of matrix) {
    if (seen.has(key)) continue;
    const [from, to] = key.split("|");
    const reverseKey = `${to}|${from}`;
    seen.add(key);
    seen.add(reverseKey);
    const netCents = cents - (matrix.get(reverseKey) ?? 0);
    if (netCents > 0) debts.push({ fromAliasId: from, toAliasId: to, amountCents: netCents });
    else if (netCents < 0) debts.push({ fromAliasId: to, toAliasId: from, amountCents: -netCents });
  }

  const raw = netBalances(transactions);
  const adjusted = forgiveRounding(raw, writeOffCents);
  const delta = new Map<string, number>();
  for (const [id, value] of adjusted) delta.set(id, value - (raw.get(id) ?? 0));
  applyNetCorrections(debts, delta);

  return sortDebts(debts.filter((d) => d.amountCents > writeOffCents));
}

/**
 * Simplified debts: minimal set of payments settling everyone's net balance
 * (after tiny rounding imbalances are written off). Greedy max-debtor/
 * max-creditor matching — at most (n - 1) payments.
 */
export function simplifiedDebts(
  transactions: BalanceTransaction[],
  writeOffCents = ROUNDING_WRITE_OFF_CENTS
): Debt[] {
  const net = forgiveRounding(netBalances(transactions), writeOffCents);
  const debtors: { aliasId: string; cents: number }[] = [];
  const creditors: { aliasId: string; cents: number }[] = [];
  for (const [aliasId, cents] of net) {
    if (cents < 0) debtors.push({ aliasId, cents: -cents });
    else if (cents > 0) creditors.push({ aliasId, cents });
  }

  const debts: Debt[] = [];
  debtors.sort((a, b) => b.cents - a.cents || a.aliasId.localeCompare(b.aliasId));
  creditors.sort((a, b) => b.cents - a.cents || a.aliasId.localeCompare(b.aliasId));
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].cents, creditors[c].cents);
    if (amount > 0) {
      debts.push({ fromAliasId: debtors[d].aliasId, toAliasId: creditors[c].aliasId, amountCents: amount });
    }
    debtors[d].cents -= amount;
    creditors[c].cents -= amount;
    if (debtors[d].cents === 0) d += 1;
    if (creditors[c].cents === 0) c += 1;
  }
  return sortDebts(debts.filter((x) => x.amountCents > writeOffCents));
}

function sortDebts(debts: Debt[]): Debt[] {
  return debts.sort(
    (a, b) => b.amountCents - a.amountCents || a.fromAliasId.localeCompare(b.fromAliasId)
  );
}
