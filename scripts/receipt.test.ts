/* Sanity tests for the receipt parsing/validation/conversion math. Run: npm run test:receipt */
import { strict as assert } from "node:assert";
import {
  cleanParsedItems,
  extractJson,
  reconcile,
  validateParsedReceipt,
  type ParsedReceiptItem,
} from "../src/lib/receipt-schema";
import {
  buildExpenseInput,
  computePersonTotals,
  type ConvertItem,
} from "../src/lib/receipt-convert";
import { computeShares } from "../src/lib/split";

// ---- extractJson ----
assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
assert.deepEqual(extractJson('Here is the JSON you asked for:\n{"a":{"b":2}}\nDone!'), { a: { b: 2 } });
assert.equal(extractJson("no json here"), null);
assert.equal(extractJson("{broken"), null);

// ---- validateParsedReceipt ----
const goodWire = {
  merchant: "  Lidl  ",
  purchased_at: "2026-08-20T18:33:00",
  currency: "eur",
  items: [
    { raw_text: "MILK 1L", name: "Milk", quantity: 2, unit_price_minor: 129, total_price_minor: 258, category: "food" },
    { raw_text: "COUPON", name: "Coupon", quantity: 1, unit_price_minor: null, total_price_minor: -100, category: "other" },
    { raw_text: "BANANAS 0.734kg", name: "Bananas", quantity: 0.734, unit_price_minor: 219, total_price_minor: 161.0001, category: "food" },
  ],
  subtotal_minor: 319,
  tax_minor: "12",
  tip_minor: null,
  discounts_minor: -5,
  total_minor: 326,
  confidence: 0.93,
};
const v = validateParsedReceipt(goodWire, "USD");
assert.equal(v.ok, true);
if (v.ok) {
  assert.equal(v.receipt.merchant, "Lidl");
  assert.equal(v.receipt.date, "2026-08-20");
  assert.equal(v.receipt.currency, "EUR");
  assert.equal(v.receipt.items.length, 3);
  assert.equal(v.receipt.items[2].totalCents, 161); // stray float rounded
  assert.equal(v.receipt.items[1].totalCents, -100); // negative coupon line kept
  assert.equal(v.receipt.taxCents, 12); // numeric string coerced
  assert.equal(v.receipt.tipCents, 0); // null -> 0
  assert.equal(v.receipt.discountsCents, 5); // sign normalized
  assert.equal(v.receipt.totalCents, 326);
}

// missing name falls back to raw_text, then "Item N"
const noNames = validateParsedReceipt(
  { items: [{ raw_text: "XX 123", total_price_minor: 100 }, { total_price_minor: 50 }] },
  "USD"
);
assert.equal(noNames.ok, true);
if (noNames.ok) {
  assert.equal(noNames.receipt.items[0].name, "XX 123");
  assert.equal(noNames.receipt.items[1].name, "Item 2");
  assert.equal(noNames.receipt.currency, "USD"); // fallback to group currency
  assert.equal(noNames.receipt.totalCents, 150); // computed from parts when missing
}

// unusable rows dropped; all-unusable fails
const dropped = validateParsedReceipt({ items: [{ name: "x" }, { name: "y", total_price_minor: 7 }] }, "USD");
assert.equal(dropped.ok, true);
if (dropped.ok) assert.equal(dropped.receipt.items.length, 1);
assert.equal(validateParsedReceipt({ items: [{ name: "x" }] }, "USD").ok, false);
assert.equal(validateParsedReceipt({ items: [] }, "USD").ok, false);
assert.equal(validateParsedReceipt("nope", "USD").ok, false);
assert.equal(validateParsedReceipt({ merchant: "x" }, "USD").ok, false);

const notReceipt = validateParsedReceipt({ error: "not_a_receipt" }, "USD");
assert.equal(notReceipt.ok, false);
if (!notReceipt.ok) assert.equal(notReceipt.notAReceipt, true);

// ---- cleanParsedItems: quirks observed from real free models on a Billa receipt ----
const mk = (
  name: string,
  totalCents: number,
  quantity = 1,
  unitPriceCents: number | null = null
): ParsedReceiptItem => ({ rawText: name, name, quantity, unitPriceCents, totalCents, category: null });

// Nemotron quirk: summary/payment rows as items + a bare "0.726 x 1.99" item
// next to the product it describes.
let cleanedItems = cleanParsedItems(
  [
    mk("ГЪБИ 250ГР", 153),
    mk("КРАСТАВИЦИ", 144),
    mk("0.726 x 1.99", 144),
    mk("ОБЩА СУМА", 4234),
    mk("ПЛАТЕНО БАНК. КАРТА ЕВРО", 4234),
  ],
  297
);
assert.deepEqual(
  cleanedItems.map((it) => [it.name, it.totalCents, it.quantity, it.unitPriceCents]),
  [
    ["ГЪБИ 250ГР", 153, 1, null],
    ["КРАСТАВИЦИ", 144, 0.726, 199],
  ]
);

// dots quirk: quantity line folded AND kept -> duplicated twin rows.
cleanedItems = cleanParsedItems(
  [
    mk("СВ.МЕСО ЗА ГОТВЕНЕ", 300),
    mk("СВ.МЕСО ЗА ГОТВЕНЕ", 300, 0.602, 498),
    mk("КРАСТАВИЦИ", 144),
    mk("КРАСТАВИЦИ", 144, 0.726, 199),
  ],
  444
);
assert.deepEqual(
  cleanedItems.map((it) => [it.name, it.totalCents, it.quantity]),
  [
    ["СВ.МЕСО ЗА ГОТВЕНЕ", 300, 0.602],
    ["КРАСТАВИЦИ", 144, 0.726],
  ]
);

// Two genuinely separate identical purchases (both q=1) are both kept.
cleanedItems = cleanParsedItems([mk("БИРА", 180), mk("БИРА", 180)], 360);
assert.equal(cleanedItems.length, 2);

// The improvement guard keeps a twin when dropping it would hurt reconciliation.
cleanedItems = cleanParsedItems(
  [mk("СНЕЖАНКА", 291), mk("СНЕЖАНКА", 291, 1.122, 259)],
  582
);
assert.equal(cleanedItems.length, 2);

// A qty-line with no matching neighbor and no known target stays (user-editable).
cleanedItems = cleanParsedItems([mk("ХЛЯБ", 145), mk("2 x 0.85", 170)], null);
assert.equal(cleanedItems.length, 2);

// Zero-total qty-lines whose q×unit equals the adjacent product's total fold
// into it (the shape the app produced live: "0.602 x 4.98" at €0.00 next to
// СВ.МЕСО at 3.00).
cleanedItems = cleanParsedItems(
  [
    mk("СВ.МЕСО ЗА ГОТВЕНЕ", 300),
    mk("0.602 x 4.98", 0, 0.602, 498),
    mk("КРАСТАВИЦИ", 144),
    mk("0.726 x 1.99", 0, 0.726, 199),
  ],
  444
);
assert.deepEqual(
  cleanedItems.map((it) => [it.name, it.totalCents, it.quantity, it.unitPriceCents]),
  [
    ["СВ.МЕСО ЗА ГОТВЕНЕ", 300, 0.602, 498],
    ["КРАСТАВИЦИ", 144, 0.726, 199],
  ]
);

// End-to-end through the validator: summary rows dropped, qty line folded.
const messy = validateParsedReceipt(
  {
    currency: "EUR",
    items: [
      { raw_text: "КРАСТАВИЦИ", name: "КРАСТАВИЦИ", quantity: 1, total_price_minor: 144 },
      { raw_text: "0.726 x 1.99", name: "0.726 x 1.99", quantity: 0.726, unit_price_minor: 199, total_price_minor: 144 },
      { raw_text: "ОБЩА СУМА", name: "ОБЩА СУМА", quantity: 1, total_price_minor: 144 },
    ],
    total_minor: 144,
  },
  "EUR"
);
assert.equal(messy.ok, true);
if (messy.ok) {
  assert.equal(messy.receipt.items.length, 1);
  assert.equal(messy.receipt.items[0].quantity, 0.726);
  assert.equal(reconcile(messy.receipt).ok, true);
}

// ---- reconcile ----
assert.deepEqual(
  reconcile({ items: [{ totalCents: 258 }, { totalCents: -100 }], taxCents: 12, tipCents: 0, discountsCents: 5, totalCents: 165 }),
  { ok: true, computedCents: 165, diffCents: 0 }
);
const off = reconcile({ items: [{ totalCents: 100 }], taxCents: 0, tipCents: 0, discountsCents: 0, totalCents: 90 });
assert.equal(off.ok, false);
assert.equal(off.diffCents, 10);

// ---- computePersonTotals ----
const A = "a", B = "b", C = "c";
const names = new Map([[A, "Ana"], [B, "Bo"], [C, "Cid"]]);
const single = (aliasId: string) => ({ assignMode: "single" as const, shares: [{ aliasId, exactCents: null }] });
const equal = (...ids: string[]) => ({ assignMode: "equal" as const, shares: ids.map((id) => ({ aliasId: id, exactCents: null })) });

// mixed modes, no pool: sums exactly
let items: ConvertItem[] = [
  { name: "Beer", totalCents: 900, ...single(A) },
  { name: "Wine", totalCents: 1000, ...equal(A, B, C) },
  { name: "Cake", totalCents: 500, assignMode: "exact", shares: [{ aliasId: B, exactCents: 300 }, { aliasId: C, exactCents: 200 }] },
];
let r = computePersonTotals(items, { taxCents: 0, tipCents: 0, discountsCents: 0 }, "USD", names);
assert.equal(r.ok, true);
if (r.ok) {
  assert.equal(r.grandTotalCents, 2400);
  const by = new Map(r.persons.map((p) => [p.aliasId, p.totalCents]));
  assert.equal(by.get(A), 900 + 334);
  assert.equal(by.get(B), 333 + 300);
  assert.equal(by.get(C), 333 + 200);
  assert.equal(r.persons.reduce((sum, p) => sum + p.totalCents, 0), 2400);
}

// pool distributed pro-rata with remainder cents, still exact
r = computePersonTotals(
  [{ name: "Dinner", totalCents: 3000, ...equal(A, B, C) }],
  { taxCents: 1001, tipCents: 0, discountsCents: 0 },
  "USD",
  names
);
assert.equal(r.ok, true);
if (r.ok) {
  assert.equal(r.grandTotalCents, 4001);
  assert.equal(r.persons.reduce((sum, p) => sum + p.totalCents, 0), 4001);
}

// negative coupon line via equal split nets against items
r = computePersonTotals(
  [
    { name: "Pizza", totalCents: 2000, ...equal(A, B) },
    { name: "Coupon", totalCents: -500, ...equal(A, B) },
  ],
  { taxCents: 0, tipCents: 0, discountsCents: 0 },
  "USD",
  names
);
assert.equal(r.ok, true);
if (r.ok) assert.equal(r.grandTotalCents, 1500);

// a discount line assigned to someone with nothing to offset -> negative guard
r = computePersonTotals(
  [
    { name: "Steak", totalCents: 2000, ...single(A) },
    { name: "Coupon", totalCents: -300, ...single(B) },
  ],
  { taxCents: 0, tipCents: 0, discountsCents: 0 },
  "USD",
  names
);
assert.equal(r.ok, false);
if (!r.ok) assert.ok(r.error.includes("Bo") && r.error.includes("negative"));

// pro-rata pool discount shrinks shares proportionally but stays non-negative
r = computePersonTotals(
  [
    { name: "Steak", totalCents: 2000, ...single(A) },
    { name: "Water", totalCents: 100, ...single(B) },
  ],
  { taxCents: 0, tipCents: 0, discountsCents: 1200 },
  "USD",
  names
);
assert.equal(r.ok, true);
if (r.ok) {
  assert.equal(r.grandTotalCents, 900);
  assert.equal(r.persons.reduce((sum, p) => sum + p.totalCents, 0), 900);
  assert.ok(r.persons.every((p) => p.totalCents >= 0));
}

// unassigned gating (zero-priced unassigned lines are ignored)
r = computePersonTotals(
  [
    { name: "Milk", totalCents: 258, assignMode: "unassigned", shares: [] },
    { name: "Bag", totalCents: 0, assignMode: "unassigned", shares: [] },
    { name: "Eggs", totalCents: 300, ...single(A) },
  ],
  { taxCents: 0, tipCents: 0, discountsCents: 0 },
  "USD",
  names
);
assert.equal(r.ok, false);
if (!r.ok) assert.ok(r.error.includes("1 item is"));

// exact amounts must sum to the line total
r = computePersonTotals(
  [{ name: "Cake", totalCents: 500, assignMode: "exact", shares: [{ aliasId: A, exactCents: 300 }, { aliasId: B, exactCents: 100 }] }],
  { taxCents: 0, tipCents: 0, discountsCents: 0 },
  "USD",
  names
);
assert.equal(r.ok, false);

// grand total must be positive
r = computePersonTotals(
  [{ name: "Refund", totalCents: -500, ...single(A) }],
  { taxCents: 0, tipCents: 0, discountsCents: 0 },
  "USD",
  names
);
assert.equal(r.ok, false);

// ---- buildExpenseInput feeds computeShares("exact") deterministically ----
items = [
  { name: "Beer", totalCents: 900, ...single(A) },
  { name: "Wine", totalCents: 1000, ...equal(A, B, C) },
];
r = computePersonTotals(items, { taxCents: 155, tipCents: 200, discountsCents: 55 }, "USD", names);
assert.equal(r.ok, true);
if (r.ok) {
  const input = buildExpenseInput({
    groupId: "g",
    merchant: " Fancy Bar ",
    date: "2026-08-23",
    currency: "USD",
    payerAliasId: A,
    persons: r.persons,
    grandTotalCents: r.grandTotalCents,
  });
  assert.equal(input.description, "Fancy Bar");
  assert.equal(input.amountCents, 2200);
  assert.equal(input.payers[0].paidCents, 2200);
  const check = computeShares("exact", input.amountCents, input.splits, "USD");
  assert.equal(check.ok, true, !check.ok ? check.error : "");
}

console.log("All receipt tests passed.");
