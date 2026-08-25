import { isSupportedCurrency } from "./currencies";

/**
 * The wire schema the LLM is asked to produce (snake_case, minor units) and
 * the validated camelCase form the rest of the app consumes. Kept isomorphic
 * (no server imports) so the validator can run in tests via tsx.
 */

export type ParsedReceiptItem = {
  rawText: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number | null;
  totalCents: number;
  category: string | null;
};

export type ParsedReceipt = {
  merchant: string | null;
  /** YYYY-MM-DD or null when unreadable. */
  date: string | null;
  currency: string;
  items: ParsedReceiptItem[];
  subtotalCents: number | null;
  taxCents: number;
  tipCents: number;
  /** Receipt-level discount as a positive magnitude. */
  discountsCents: number;
  totalCents: number;
  confidence: number | null;
};

export const MAX_RECEIPT_ITEMS = 100;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The extraction instructions sent with every receipt image. */
export function buildReceiptPrompt(groupCurrency: string): string {
  return `You are extracting structured data from a photo of a retail receipt (grocery store, restaurant, shop, etc.).

Output ONLY one JSON object. No markdown fences, no commentary, no explanations.

Schema:
{
  "merchant": "store name as printed, or null",
  "purchased_at": "receipt date as YYYY-MM-DD, or null",
  "currency": "ISO 4217 code, e.g. EUR",
  "items": [
    {
      "raw_text": "the verbatim printed line",
      "name": "short cleaned-up item name",
      "quantity": 1,
      "unit_price_minor": 599,
      "total_price_minor": 599,
      "category": "food|alcohol|household|other"
    }
  ],
  "subtotal_minor": 0,
  "tax_minor": 0,
  "tip_minor": 0,
  "discounts_minor": 0,
  "total_minor": 0,
  "confidence": 0.0
}

Rules:
- ALL monetary values are integers in minor units (cents/stotinki) of "currency". Never use decimal amounts.
- Use null when a value is unreadable or absent. Never guess.
- Receipts may be in any language or script (e.g. Bulgarian Cyrillic). Keep "name" and "raw_text" in the original language and script; do not translate or transliterate.
- Include EVERY printed line item. Bottle deposits and fees are their own items. Tax-group markers after names (like "*Б" or "*A") are not part of the name.
- Discount, coupon and deposit-return LINES (e.g. "ОТСТЪПКА АКЦИЯ -0.54") are items with a negative "total_price_minor". A receipt-level discount that is not tied to a line goes in "discounts_minor" as a positive number. Never record the same discount in both places.
- Standalone lines like "0.602 x 4.98" or "12 x 1.00" state quantity times unit price for an ADJACENT product line (printed directly above or below it - match by quantity*unit equaling that product's printed total). Fold them into that item as "quantity" and "unit_price_minor"; NEVER output such a line as its own item.
- Each printed product becomes EXACTLY ONE entry in "items" - when a quantity line accompanies a product, output one combined item, never two.
- NEVER include subtotal, total ("ОБЩА СУМА", "TOTAL"), payment ("ПЛАТЕНО", card/cash), change, tax-summary or savings ("ТИ СПЕСТИ") lines as items - they belong in the dedicated fields or nowhere.
- "quantity" may be fractional for weighted items (e.g. 0.734 for 0.734 kg). For "3 x" lines set quantity 3 and the per-unit price in "unit_price_minor"; "total_price_minor" is always the printed line total.
- "currency": infer from symbols or text on the receipt (e.g. "ЕВРО" or "€" means EUR). Bulgarian receipts may print an informational lev total ("лв") next to the euro one - ignore "лв" amounts and extract the euro values. If unclear, use "${groupCurrency}".
- The identity sum(items.total_price_minor) + tax_minor + tip_minor - discounts_minor = total_minor must hold. If it does not, re-check your line extraction. In many countries tax is already included in item prices - then tax_minor is 0.
- "confidence": your overall confidence in this extraction, 0 to 1.
- If the image is not a purchase receipt at all, output exactly {"error":"not_a_receipt"}.`;
}

/** Pull the first JSON object out of a model reply that may include fences or prose. */
export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Free models sometimes emit floats or numeric strings where ints belong. */
function intOrNull(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n);
}

function strOrNull(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

// Summary rows small free models keep emitting as items despite instructions.
const SUMMARY_LINE_RE =
  /(обща\s*сума|междинна\s*сума|ти\s*спести|платено|ресто|subtotal|total|amount\s*due|change\s*due)/i;
// A bare "0.726 x 1.99" quantity-detail line (Latin x, ×, or Cyrillic х).
const QTY_LINE_RE = /^\s*(\d+(?:[.,]\d+)?)\s*[x×х*]\s*(\d+(?:[.,]\d+)?)\s*$/i;

const itemsSum = (items: ParsedReceiptItem[]) => items.reduce((a, it) => a + it.totalCents, 0);

/**
 * Deterministic cleanup of model quirks observed on real receipt formats
 * (Billa-style): summary/payment rows returned as items, quantity-detail
 * lines emitted as their own items, and duplicated rows when a quantity line
 * gets folded AND kept. Risky merges only happen when they move the items
 * sum TOWARD the printed total, so a correct parse can't be made worse.
 */
export function cleanParsedItems(
  items: ParsedReceiptItem[],
  targetItemsSum: number | null
): ParsedReceiptItem[] {
  // 1. Summary/payment/savings rows are never purchasable items.
  let list = items.filter(
    (it) => !SUMMARY_LINE_RE.test(it.name) && !(it.rawText !== null && SUMMARY_LINE_RE.test(it.rawText))
  );

  const improves = (candidate: ParsedReceiptItem[]) =>
    targetItemsSum !== null &&
    Math.abs(itemsSum(candidate) - targetItemsSum) < Math.abs(itemsSum(list) - targetItemsSum);

  // 2. Fold "q x unit" pseudo-items into the adjacent product they describe —
  //    matched by equal printed total, or by q×unit equaling the neighbor's
  //    total (models often give the pseudo-item a 0 total). Dropping is
  //    unconditional only when it provably cannot hurt the sum.
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const m = item.name.match(QTY_LINE_RE);
    if (!m) continue;
    const qty = Number(m[1].replace(",", "."));
    const unitCents = Math.round(Number(m[2].replace(",", ".")) * 100);
    const expected = Math.round(qty * unitCents);
    const neighbor = [list[i - 1], list[i + 1]].find(
      (n) =>
        n &&
        !QTY_LINE_RE.test(n.name) &&
        (n.totalCents === item.totalCents || n.totalCents === expected)
    );
    const without = list.filter((_, idx) => idx !== i);
    const safeDrop =
      item.totalCents === 0 || (neighbor !== undefined && neighbor.totalCents === item.totalCents);
    if (neighbor && (safeDrop || improves(without))) {
      if (neighbor.quantity === 1) {
        neighbor.quantity = qty;
        neighbor.unitPriceCents = unitCents;
      }
      list = without;
      i -= 1;
    } else if (!neighbor && improves(without)) {
      list = without;
      i -= 1;
    }
  }

  // 3. Adjacent twin rows: same name and total, one carrying real quantity
  //    detail (q≠1, q×unit ≈ total) and the other a plain q=1 copy — the
  //    plain copy is the un-folded duplicate.
  for (let i = 0; i < list.length - 1; i++) {
    const [a, b] = [list[i], list[i + 1]];
    if (a.totalCents !== b.totalCents || a.name !== b.name) continue;
    const detailed = [a, b].find(
      (it) =>
        it.quantity !== 1 &&
        it.unitPriceCents !== null &&
        Math.abs(it.quantity * it.unitPriceCents - it.totalCents) <= 2
    );
    if (!detailed) continue;
    const plain = detailed === a ? b : a;
    if (plain.quantity !== 1) continue;
    const without = list.filter((it) => it !== plain);
    if (targetItemsSum === null || improves(without)) {
      list = without;
      i -= 1;
    }
  }

  return list;
}

export type ValidateResult =
  | { ok: true; receipt: ParsedReceipt }
  | { ok: false; error: string; notAReceipt?: boolean };

export function validateParsedReceipt(raw: unknown, groupCurrency: string): ValidateResult {
  if (!isRecord(raw)) return { ok: false, error: "The model did not return a JSON object." };
  if (typeof raw.error === "string") {
    return { ok: false, error: "This image doesn't look like a receipt.", notAReceipt: true };
  }
  if (!Array.isArray(raw.items)) return { ok: false, error: "The model returned no item list." };

  const items: ParsedReceiptItem[] = [];
  for (const [i, entry] of raw.items.slice(0, MAX_RECEIPT_ITEMS).entries()) {
    if (!isRecord(entry)) continue;
    const totalCents = intOrNull(entry.total_price_minor);
    if (totalCents === null) continue; // a line without a price is unusable
    const rawText = strOrNull(entry.raw_text, 300);
    const qty = typeof entry.quantity === "number" && Number.isFinite(entry.quantity) && entry.quantity > 0
      ? entry.quantity
      : 1;
    items.push({
      rawText,
      name: strOrNull(entry.name, 200) ?? rawText ?? `Item ${i + 1}`,
      quantity: qty,
      unitPriceCents: intOrNull(entry.unit_price_minor),
      totalCents,
      category: strOrNull(entry.category, 40),
    });
  }
  if (items.length === 0) {
    return { ok: false, error: "The model couldn't read any items from this receipt." };
  }

  const currencyRaw = typeof raw.currency === "string" ? raw.currency.trim().toUpperCase() : "";
  const currency = isSupportedCurrency(currencyRaw) ? currencyRaw : groupCurrency;

  const dateRaw = typeof raw.purchased_at === "string" ? raw.purchased_at.slice(0, 10) : "";
  const date = DATE_RE.test(dateRaw) ? dateRaw : null;

  const taxCents = intOrNull(raw.tax_minor) ?? 0;
  const tipCents = intOrNull(raw.tip_minor) ?? 0;
  const discountsCents = Math.abs(intOrNull(raw.discounts_minor) ?? 0);
  const modelTotal = intOrNull(raw.total_minor) || null;
  const cleaned = cleanParsedItems(
    items,
    modelTotal === null ? null : modelTotal - taxCents - tipCents + discountsCents
  );
  if (cleaned.length === 0) {
    return { ok: false, error: "The model couldn't read any items from this receipt." };
  }
  const totalCents = modelTotal ?? itemsSum(cleaned) + taxCents + tipCents - discountsCents;

  const confidenceRaw = raw.confidence;
  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.min(1, Math.max(0, confidenceRaw))
      : null;

  return {
    ok: true,
    receipt: {
      merchant: strOrNull(raw.merchant, 120),
      date,
      currency,
      items: cleaned,
      subtotalCents: intOrNull(raw.subtotal_minor),
      taxCents,
      tipCents,
      discountsCents,
      totalCents,
      confidence,
    },
  };
}

/**
 * The primary extraction-quality signal (claudeConv.md): the parts must add up
 * to the printed total. Failures surface as a banner in the review UI, never
 * as a silent accept or a hard error.
 */
export function reconcile(r: {
  items: { totalCents: number }[];
  taxCents: number;
  tipCents: number;
  discountsCents: number;
  totalCents: number;
}): { ok: boolean; computedCents: number; diffCents: number } {
  const itemsSum = r.items.reduce((sum, it) => sum + it.totalCents, 0);
  const computedCents = itemsSum + r.taxCents + r.tipCents - r.discountsCents;
  const diffCents = computedCents - r.totalCents;
  return { ok: diffCents === 0, computedCents, diffCents };
}
