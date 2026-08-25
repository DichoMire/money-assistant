/* Sanity tests for the receipt parsing/validation/conversion math. Run: npm run test:receipt */
import { strict as assert } from "node:assert";
import {
  cleanParsedItems,
  extractJson,
  inferReceiptEra,
  reconcile,
  validateParsedReceipt,
  type ParsedReceiptItem,
} from "../src/lib/receipt-schema";
import {
  buildExpenseInput,
  computePersonTotals,
  resolveDiscountCents,
  unitsEligible,
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

// ---- resolveDiscountCents ----
assert.equal(resolveDiscountCents(10000, 1000), 1000); // 10% of 100.00
assert.equal(resolveDiscountCents(999, 1050), 105); // 10.5% of 9.99 rounds
assert.equal(resolveDiscountCents(10000, 0), 0);
assert.equal(resolveDiscountCents(0, 5000), 0);
assert.equal(resolveDiscountCents(-500, 1000), 0); // all-negative items clamp at 0

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

// ---- Bulgarian eras (RFC 04 §3.2) ----
assert.equal(inferReceiptEra("2025-11-30"), "bgn");
assert.equal(inferReceiptEra("2026-03-14"), "dual");
assert.equal(inferReceiptEra("2026-08-24"), "eur");
assert.equal(inferReceiptEra(null), null);
assert.equal(inferReceiptEra("garbage"), null);

// Dual-era receipt: EUR total 20.00, printed lev total 39.12 → captured and
// cross-checked at the fixed 1.95583 rate.
const dual = validateParsedReceipt(
  {
    merchant: "Билла",
    purchased_at: "2026-03-14",
    currency: "EUR",
    items: [{ name: "Хляб", total_price_minor: 2000 }],
    total_minor: 2000,
    second_total_minor: 3912,
    second_total_currency: "BGN",
    printed_rate: 1.95583,
    is_fiscal_receipt: true,
  },
  "EUR"
);
assert.equal(dual.ok, true);
if (dual.ok) {
  assert.equal(dual.receipt.secondTotalCents, 3912);
  assert.equal(dual.receipt.secondCurrency, "BGN");
  assert.equal(dual.receipt.dualTotalMatches, true);
  assert.equal(dual.receipt.printedRate, 1.95583);
  assert.equal(dual.receipt.isFiscalReceipt, true);
}
// A lev total off by more than a stotinka flips the flag.
const dualOff = validateParsedReceipt(
  {
    currency: "EUR",
    items: [{ name: "Хляб", total_price_minor: 2000 }],
    total_minor: 2000,
    second_total_minor: 3920,
    second_total_currency: "BGN",
  },
  "EUR"
);
assert.equal(dualOff.ok && dualOff.receipt.dualTotalMatches, false);

// Pre-2026 BGN receipt: normalized to EUR at the fixed rate (the app retired
// BGN), per-amount half-up.
const bgnEra = validateParsedReceipt(
  {
    purchased_at: "2025-07-01",
    currency: "BGN",
    items: [{ name: "Кафе", total_price_minor: 391 }], // 3.91 лв → 2.00 €
    total_minor: 391,
  },
  "EUR"
);
assert.equal(bgnEra.ok, true);
if (bgnEra.ok) {
  assert.equal(bgnEra.receipt.currency, "EUR");
  assert.equal(bgnEra.receipt.items[0].totalCents, 200);
  assert.equal(bgnEra.receipt.totalCents, 200);
  assert.equal(bgnEra.receipt.convertedFromBgn, true);
}

// VAT group letters: model field wins; raw_text "*Б" fallback works.
const vat = validateParsedReceipt(
  {
    currency: "EUR",
    items: [
      { name: "Бира", total_price_minor: 300, tax_group: "Б" },
      { name: "Хляб", raw_text: "ХЛЯБ ДОБРУДЖА 1.20 *В", total_price_minor: 120 },
      { name: "Депозит", total_price_minor: 20, line_type: "deposit" },
    ],
    total_minor: 440,
  },
  "EUR"
);
assert.equal(vat.ok, true);
if (vat.ok) {
  assert.equal(vat.receipt.items[0].taxGroup, "Б");
  assert.equal(vat.receipt.items[1].taxGroup, "В");
  assert.equal(vat.receipt.items[2].lineType, "deposit");
}

// ---- unit-level splitting (RFC 04 §3.4) ----
assert.equal(unitsEligible(3), true);
assert.equal(unitsEligible(1), false);
assert.equal(unitsEligible(0.726), false);
assert.equal(unitsEligible(100), false);

// "3 × Бира 5.40" with 2 units to A, 1 to B → 3.60 / 1.80.
{
  const unitItems: ConvertItem[] = [
    {
      name: "Бира",
      totalCents: 540,
      quantity: 3,
      assignMode: "units",
      shares: [
        { aliasId: A, exactCents: null, units: 2 },
        { aliasId: B, exactCents: null, units: 1 },
      ],
    },
  ];
  const ur = computePersonTotals(unitItems, { taxCents: 0, tipCents: 0, discountsCents: 0 }, "EUR", names);
  assert.equal(ur.ok, true, !ur.ok ? ur.error : "");
  if (ur.ok) {
    assert.equal(ur.persons.find((p) => p.aliasId === A)?.totalCents, 360);
    assert.equal(ur.persons.find((p) => p.aliasId === B)?.totalCents, 180);
  }
  // 5.00 over 3 units → 167/167/166, summing exactly.
  const three: ConvertItem[] = [
    {
      name: "Кафе",
      totalCents: 500,
      quantity: 3,
      assignMode: "units",
      shares: [
        { aliasId: A, exactCents: null, units: 1 },
        { aliasId: B, exactCents: null, units: 1 },
        { aliasId: C, exactCents: null, units: 1 },
      ],
    },
  ];
  const tr = computePersonTotals(three, { taxCents: 0, tipCents: 0, discountsCents: 0 }, "EUR", names);
  assert.equal(tr.ok, true);
  if (tr.ok) {
    const cents = tr.persons.map((p) => p.totalCents).sort((a, b) => b - a);
    assert.deepEqual(cents, [167, 167, 166]);
  }
  // Units not summing to the quantity is rejected.
  const bad: ConvertItem[] = [
    {
      name: "Бира",
      totalCents: 540,
      quantity: 3,
      assignMode: "units",
      shares: [{ aliasId: A, exactCents: null, units: 2 }],
    },
  ];
  const br = computePersonTotals(bad, { taxCents: 0, tipCents: 0, discountsCents: 0 }, "EUR", names);
  assert.equal(br.ok, false);
}

console.log("All receipt tests passed.");
