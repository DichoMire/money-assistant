/* Payment-helper tests (RFC 03): EPC QR payload byte-exactness + truncation,
   IBAN mod-97, phone/tag normalization, share-text builders.
   Run: npm run test:epc */
import { strict as assert } from "node:assert";
import { buildEpcPayload } from "../src/lib/epc-qr";
import { makeT } from "../src/lib/i18n";
import {
  formatIbanGroups,
  isValidIban,
  normalizeIban,
  normalizePhone,
  normalizeRevolutTag,
} from "../src/lib/payment-details";
import { buildBalanceSummaryText, buildPaymentRequestText } from "../src/lib/share-text";

const bytes = (s: string) => new TextEncoder().encode(s).length;

// ---- EPC payload ----
{
  const payload = buildEpcPayload({
    name: "Ivan Petrov",
    iban: "BG80 BNBG 9661 1020 3456 78",
    amountCents: 2050,
    note: "Гърция 2026 — уреждане",
  });
  assert.equal(
    payload,
    "BCD\n002\n1\nSCT\n\nIvan Petrov\nBG80BNBG96611020345678\nEUR20.50\n\n\nГърция 2026 — уреждане"
  );

  // Cyrillic name + long Cyrillic note: total payload must fit 331 bytes with
  // only the NOTE truncated (2 bytes per Cyrillic char).
  const longNote = "б".repeat(140);
  const p2 = buildEpcPayload({
    name: "Иван Петров-Станимиров",
    iban: "BG80BNBG96611020345678",
    amountCents: 12345,
    note: longNote,
  });
  assert.ok(p2);
  assert.ok(bytes(p2) <= 331, `payload is ${bytes(p2)} bytes`);
  assert.ok(p2.includes("Иван Петров-Станимиров"), "name is never truncated");
  assert.ok(p2.includes("…"), "note is ellipsis-truncated");
  assert.ok(p2.includes("BG80BNBG96611020345678"));

  // Null cases.
  assert.equal(buildEpcPayload({ name: "", iban: "BG80BNBG96611020345678", amountCents: 100 }), null);
  assert.equal(buildEpcPayload({ name: "X".repeat(71), iban: "BG80BNBG96611020345678", amountCents: 100 }), null);
  assert.equal(buildEpcPayload({ name: "Ivan", iban: "BG80BNBG96611020345678", amountCents: 0 }), null);
  assert.equal(buildEpcPayload({ name: "Ivan", iban: "BG80BNBG96611020345678", amountCents: -100 }), null);
  assert.equal(
    buildEpcPayload({ name: "Ivan", iban: "BG80BNBG96611020345678", amountCents: 100_000_000_000 }),
    null
  );
  // Amount formatting: exact cents.
  const p3 = buildEpcPayload({ name: "Ivan", iban: "BG80BNBG96611020345678", amountCents: 5 });
  assert.ok(p3!.includes("EUR0.05"));
  console.log("EPC payload ok");
}

// ---- IBAN ----
{
  assert.equal(isValidIban("BG80 BNBG 9661 1020 3456 78"), true); // official example
  assert.equal(isValidIban("bg80bnbg96611020345678"), true); // case/space-insensitive
  assert.equal(isValidIban("LT12 1000 0111 0100 1000"), true); // Revolut-style LT
  assert.equal(isValidIban("BG80BNBG96611020345679"), false); // one-digit corruption
  assert.equal(isValidIban("BG80BNBG9661102034567"), false); // wrong length for BG
  assert.equal(isValidIban("XX00"), false);
  assert.equal(isValidIban(""), false);
  assert.equal(normalizeIban(" bg80 bnbg.9661 1020 3456 78 "), "BG80BNBG96611020345678");
  assert.equal(formatIbanGroups("BG80BNBG96611020345678"), "BG80 BNBG 9661 1020 3456 78");
  console.log("IBAN validation ok");
}

// ---- phone / revolut tag ----
{
  assert.equal(normalizePhone("0888 123 456"), "+359888123456");
  assert.equal(normalizePhone("+359 88 812-3456"), "+359888123456");
  assert.equal(normalizePhone("00359888123456"), "+359888123456");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("not a phone"), null);
  assert.equal(normalizeRevolutTag("https://revolut.me/ivan_petrov"), "ivan_petrov");
  assert.equal(normalizeRevolutTag("@ivan.petrov"), "ivan.petrov");
  assert.equal(normalizeRevolutTag("ivan petrov"), null);
  console.log("phone/tag normalization ok");
}

// ---- share text ----
{
  const t = makeT("bg");
  const req = buildPaymentRequestText(t, {
    groupName: "Гърция 2026",
    amountCents: 1240,
    currency: "EUR",
    profile: {
      iban: "BG80BNBG96611020345678",
      accountName: "Ivan Petrov",
      blinkPhone: "+359888123456",
      revolutTag: "ivan",
      updatedAt: "2026-08-26",
    },
    url: "https://example.com/groups/1",
  });
  assert.ok(req.includes("12,40"), "bg-formatted amount");
  assert.ok(req.includes("IBAN: BG80BNBG96611020345678 (Ivan Petrov)"));
  assert.ok(req.includes("blink: +359888123456"));
  assert.ok(req.includes("revolut.me/ivan"));
  assert.ok(req.endsWith("https://example.com/groups/1"));

  // Methods that don't exist are omitted.
  const reqBare = buildPaymentRequestText(t, {
    groupName: "X",
    amountCents: 100,
    currency: "EUR",
    profile: null,
    url: "u",
  });
  assert.ok(!reqBare.includes("IBAN") && !reqBare.includes("blink") && !reqBare.includes("revolut"));

  const debts = Array.from({ length: 8 }, (_, i) => ({
    fromName: `P${i}`,
    toName: "Мария",
    amountCents: (i + 1) * 100,
  }));
  const summary = buildBalanceSummaryText(t, {
    groupName: "Съквартиранти",
    dateText: "26 авг",
    currency: "EUR",
    debts,
    url: "https://example.com/groups/1?ref=summary-share",
  });
  const lines = summary.split("\n");
  assert.equal(lines.filter((l) => l.startsWith("•")).length, 6, "capped at 6 debt lines");
  assert.ok(summary.includes("…и още 2"));
  assert.ok(lines[1].includes("8,00"), "largest debt first");

  const settled = buildBalanceSummaryText(t, {
    groupName: "X",
    dateText: "26 авг",
    currency: "EUR",
    debts: [],
    url: "u",
  });
  assert.ok(settled.includes("квит"));
  console.log("share text ok");
}

console.log("All payment-helper tests passed.");
