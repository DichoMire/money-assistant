import { allocateByWeights } from "./money";

/** A transaction with amounts already converted to the group currency. */
export type BalanceTransaction = {
  payers: { aliasId: string; cents: number }[];
  shares: { aliasId: string; cents: number }[];
};

export type Debt = { fromAliasId: string; toAliasId: string; amountCents: number };

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
 * collapses to A owes B 6), matching how Splitwise displays balances.
 */
export function pairwiseDebts(transactions: BalanceTransaction[]): Debt[] {
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
  return sortDebts(debts);
}

/**
 * Simplified debts: minimal set of payments settling everyone's net balance.
 * Greedy max-debtor/max-creditor matching — at most (n - 1) payments.
 */
export function simplifiedDebts(transactions: BalanceTransaction[]): Debt[] {
  const net = netBalances(transactions);
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
  return sortDebts(debts);
}

function sortDebts(debts: Debt[]): Debt[] {
  return debts.sort(
    (a, b) => b.amountCents - a.amountCents || a.fromAliasId.localeCompare(b.fromAliasId)
  );
}
