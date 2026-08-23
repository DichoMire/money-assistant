/* Sanity tests for the money/split/simplify/rates math. Run: npm run test:math */
import { strict as assert } from "node:assert";
import { allocateByWeights, parseAmount } from "../src/lib/money";
import { computeShares, validatePayers } from "../src/lib/split";
import {
  forgiveRounding,
  netBalances,
  pairwiseDebts,
  simplifiedDebts,
  type BalanceTransaction,
} from "../src/lib/simplify";
import { convertCents, findRateRow, ratesAreStale } from "../src/lib/rates";

function shares(result: ReturnType<typeof computeShares>) {
  assert.equal(result.ok, true, !result.ok ? result.error : "");
  if (!result.ok) throw new Error("unreachable");
  return result.shares;
}

// ---- money ----
assert.deepEqual(allocateByWeights(1000, [1, 1, 1]), [334, 333, 333]);
assert.deepEqual(allocateByWeights(999, [2, 1]), [666, 333]);
assert.deepEqual(allocateByWeights(-1000, [1, 1, 1]), [-334, -333, -333]);
assert.equal(parseAmount("12.34"), 1234);
assert.equal(parseAmount("12,3"), 1230);
assert.equal(parseAmount("7"), 700);
assert.equal(parseAmount("abc"), null);

// ---- splits ----
const A = "a", B = "b", C = "c";

let s = shares(computeShares("equal", 1000, [{ aliasId: A, value: 0 }, { aliasId: B, value: 0 }, { aliasId: C, value: 0 }], "USD"));
assert.deepEqual(s.map((x) => x.owedCents), [334, 333, 333]);

let bad = computeShares("exact", 1000, [{ aliasId: A, value: 400 }, { aliasId: B, value: 500 }], "USD");
assert.equal(bad.ok, false);
s = shares(computeShares("exact", 1000, [{ aliasId: A, value: 400 }, { aliasId: B, value: 600 }], "USD"));
assert.deepEqual(s.map((x) => x.owedCents), [400, 600]);

s = shares(computeShares("percent", 1001, [{ aliasId: A, value: 50 }, { aliasId: B, value: 25 }, { aliasId: C, value: 25 }], "USD"));
assert.equal(s.reduce((t, x) => t + x.owedCents, 0), 1001);
bad = computeShares("percent", 1000, [{ aliasId: A, value: 50 }, { aliasId: B, value: 40 }], "USD");
assert.equal(bad.ok, false);

s = shares(computeShares("shares", 999, [{ aliasId: A, value: 2 }, { aliasId: B, value: 1 }], "USD"));
assert.deepEqual(s.map((x) => x.owedCents), [666, 333]);

s = shares(computeShares("adjustment", 3000, [{ aliasId: A, value: 300 }, { aliasId: B, value: 0 }, { aliasId: C, value: 0 }], "USD"));
assert.deepEqual(s.map((x) => x.owedCents), [1200, 900, 900]);
bad = computeShares("adjustment", 1000, [{ aliasId: A, value: 2000 }, { aliasId: B, value: 0 }], "USD");
assert.equal(bad.ok, false);

assert.equal(validatePayers(1000, [{ aliasId: A, paidCents: 600 }, { aliasId: B, paidCents: 400 }], "USD"), null);
assert.notEqual(validatePayers(1000, [{ aliasId: A, paidCents: 600 }], "USD"), null);

// ---- balances: single payer, equal 3-way ----
const tx1: BalanceTransaction = {
  payers: [{ aliasId: A, cents: 3000 }],
  shares: [{ aliasId: A, cents: 1000 }, { aliasId: B, cents: 1000 }, { aliasId: C, cents: 1000 }],
};
let debts = pairwiseDebts([tx1]);
assert.deepEqual(
  debts.map((d) => [d.fromAliasId, d.toAliasId, d.amountCents]).sort(),
  [[B, A, 1000], [C, A, 1000]].sort()
);

// settlement: B pays A 1000 -> only C still owes A
const settle: BalanceTransaction = {
  payers: [{ aliasId: B, cents: 1000 }],
  shares: [{ aliasId: A, cents: 1000 }],
};
debts = pairwiseDebts([tx1, settle]);
assert.deepEqual(debts.map((d) => [d.fromAliasId, d.toAliasId, d.amountCents]), [[C, A, 1000]]);

// cross-expense netting
const tx2: BalanceTransaction = {
  payers: [{ aliasId: A, cents: 2000 }],
  shares: [{ aliasId: A, cents: 1000 }, { aliasId: B, cents: 1000 }],
};
const tx3: BalanceTransaction = {
  payers: [{ aliasId: B, cents: 3000 }],
  shares: [{ aliasId: A, cents: 1000 }, { aliasId: B, cents: 1000 }, { aliasId: C, cents: 1000 }],
};
debts = pairwiseDebts([tx2, tx3]);
assert.deepEqual(debts.map((d) => [d.fromAliasId, d.toAliasId, d.amountCents]), [[C, B, 1000]]);
let simplified = simplifiedDebts([tx2, tx3]);
assert.deepEqual(simplified.map((d) => [d.fromAliasId, d.toAliasId, d.amountCents]), [[C, B, 1000]]);

// multi-payer: A 600 + B 400, equal 4-way with D
const D = "d";
const tx4: BalanceTransaction = {
  payers: [{ aliasId: A, cents: 600 }, { aliasId: B, cents: 400 }],
  shares: [A, B, C, D].map((id) => ({ aliasId: id, cents: 250 })),
};
debts = pairwiseDebts([tx4]);
const totalToA = debts.filter((x) => x.toAliasId === A).reduce((t, x) => t + x.amountCents, 0)
  - debts.filter((x) => x.fromAliasId === A).reduce((t, x) => t + x.amountCents, 0);
assert.equal(totalToA, 350); // A net = 600 paid - 250 owed
const net = netBalances([tx4]);
assert.equal(net.get(A), 350);
assert.equal(net.get(B), 150);
assert.equal(net.get(C), -250);
assert.equal(net.get(D), -250);
simplified = simplifiedDebts([tx4]);
assert.equal(simplified.reduce((t, x) => t + x.amountCents, 0), 500);
assert.ok(simplified.length <= 3);

// simplification reduces payment count
const many: BalanceTransaction[] = [
  { payers: [{ aliasId: A, cents: 900 }], shares: [A, B, C].map((id) => ({ aliasId: id, cents: 300 })) },
  { payers: [{ aliasId: B, cents: 900 }], shares: [A, B, C].map((id) => ({ aliasId: id, cents: 300 })) },
  { payers: [{ aliasId: C, cents: 600 }], shares: [{ aliasId: A, cents: 300 }, { aliasId: B, cents: 300 }] },
];
const pw = pairwiseDebts(many);
const simp = simplifiedDebts(many);
const netMany = netBalances(many);
const owedTotal = [...netMany.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
assert.equal(simp.reduce((t, x) => t + x.amountCents, 0), owedTotal);
assert.ok(simp.length <= pw.length);

// ---- rounding write-off ----
let forgiven = forgiveRounding(new Map([[A, 501], [B, -1], [C, -500]]));
assert.deepEqual([...forgiven.entries()].sort(), [[A, 500], [B, 0], [C, -500]].sort());

// cascade: absorbing tiny balances can create new tiny balances
forgiven = forgiveRounding(new Map([["p", 2], ["q", 2], ["r", 2], ["s", -3], ["t", -3]]));
assert.ok([...forgiven.values()].every((v) => v === 0));

// The screenshot scenario: $10 equal 3-way paid by G, $5 equal 3-way paid by D.
// Raw nets: G +500, D -1, H -499 — D's phantom cent must disappear.
const G = "g", DD = "d", H = "h";
const screenshot: BalanceTransaction[] = [
  {
    payers: [{ aliasId: G, cents: 1000 }],
    shares: [{ aliasId: DD, cents: 334 }, { aliasId: G, cents: 333 }, { aliasId: H, cents: 333 }],
  },
  {
    payers: [{ aliasId: DD, cents: 500 }],
    shares: [{ aliasId: DD, cents: 167 }, { aliasId: G, cents: 167 }, { aliasId: H, cents: 166 }],
  },
];
simplified = simplifiedDebts(screenshot);
assert.deepEqual(simplified.map((d) => [d.fromAliasId, d.toAliasId, d.amountCents]), [[H, G, 499]]);

const pwScreenshot = pairwiseDebts(screenshot);
assert.deepEqual(
  pwScreenshot.map((d) => [d.fromAliasId, d.toAliasId, d.amountCents]).sort(),
  [[H, G, 333], [DD, G, 166], [H, DD, 166]].sort()
);
// implied nets from the repaired pairwise list match the forgiven balances
const implied = new Map<string, number>();
for (const d of pwScreenshot) {
  implied.set(d.fromAliasId, (implied.get(d.fromAliasId) ?? 0) - d.amountCents);
  implied.set(d.toAliasId, (implied.get(d.toAliasId) ?? 0) + d.amountCents);
}
assert.equal(implied.get(G), 499);
assert.equal(implied.get(DD) ?? 0, 0);
assert.equal(implied.get(H), -499);

// A standalone 1-cent pair debt between people with large balances is dropped.
const tinyPair: BalanceTransaction[] = [
  { payers: [{ aliasId: B, cents: 1 }], shares: [{ aliasId: A, cents: 1 }] },
  { payers: [{ aliasId: A, cents: 500 }], shares: [{ aliasId: C, cents: 500 }] },
  { payers: [{ aliasId: C, cents: 400 }], shares: [{ aliasId: B, cents: 400 }] },
];
debts = pairwiseDebts(tinyPair);
assert.ok(debts.every((d) => d.amountCents > 2));
assert.deepEqual(
  debts.map((d) => [d.fromAliasId, d.toAliasId, d.amountCents]).sort(),
  [[C, A, 500], [B, C, 400]].sort()
);

// ---- rates ----
const rows = [
  { date: "2026-08-01", rates: { USD: 1.1, BGN: 1.95583 } },
  { date: "2026-08-04", rates: { USD: 1.2, BGN: 1.95583 } },
];
assert.equal(findRateRow(rows, "2026-08-03")!.date, "2026-08-01");
assert.equal(findRateRow(rows, "2026-07-20")!.date, "2026-08-01"); // earliest available
assert.equal(findRateRow(rows, "2026-08-10")!.date, "2026-08-04");
assert.equal(convertCents(1000, "USD", "EUR", rows[0]), 909);
assert.equal(convertCents(1000, "USD", "BGN", rows[0]), 1778);
assert.equal(convertCents(1000, "EUR", "USD", rows[1]), 1200);
assert.equal(convertCents(1000, "USD", "USD", null), 1000);
assert.equal(ratesAreStale("2026-08-15", "2026-08-23"), true);
assert.equal(ratesAreStale("2026-08-16", "2026-08-23"), false);
assert.equal(ratesAreStale(null, "2026-08-23"), true);

console.log("All math tests passed.");
