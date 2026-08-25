/**
 * EPC069-12 "SEPA credit transfer" QR payload (the standard every European
 * banking app that scans payment QRs understands). Version 002, UTF-8, no
 * BIC, unstructured remittance only — never both remittance lines (RFC 03,
 * research-verified format). Render at error-correction level M.
 *
 * Payload layout (line-separated, LF):
 *   BCD          service tag
 *   002          version
 *   1            charset (1 = UTF-8)
 *   SCT          SEPA credit transfer
 *   (empty)      BIC — optional since v002
 *   {name}       beneficiary (<= 70 chars)
 *   {iban}
 *   EUR{amount}  e.g. EUR12.34
 *   (empty)      purpose code
 *   (empty)      structured remittance
 *   {note}       unstructured remittance (<= 140 chars)
 */

const MAX_PAYLOAD_BYTES = 331;
const MAX_NAME_CHARS = 70;
const MAX_NOTE_CHARS = 140;

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Truncate by BYTES (Cyrillic is 2 bytes/char in UTF-8) with an ellipsis. */
function truncateBytes(s: string, maxBytes: number): string {
  if (byteLength(s) <= maxBytes) return s;
  let out = "";
  for (const ch of s) {
    if (byteLength(out + ch + "…") > maxBytes) break;
    out += ch;
  }
  return `${out}…`;
}

export function buildEpcPayload(params: {
  name: string;
  iban: string;
  amountCents: number;
  note?: string;
}): string | null {
  const name = params.name.trim();
  const iban = params.iban.replace(/\s/g, "").toUpperCase();
  if (!name || name.length > MAX_NAME_CHARS) return null;
  if (!iban) return null;
  // EPC bounds: 0.01 .. 999,999,999.99 EUR.
  if (
    !Number.isInteger(params.amountCents) ||
    params.amountCents < 1 ||
    params.amountCents > 99_999_999_999
  ) {
    return null;
  }
  const euros = Math.floor(params.amountCents / 100);
  const cents = params.amountCents % 100;
  const amount = `EUR${euros}.${String(cents).padStart(2, "0")}`;

  const assemble = (note: string) =>
    ["BCD", "002", "1", "SCT", "", name, iban, amount, "", "", note].join("\n");

  let note = (params.note ?? "").trim().slice(0, MAX_NOTE_CHARS);
  let payload = assemble(note);
  if (byteLength(payload) > MAX_PAYLOAD_BYTES) {
    // Only the note is ever truncated — never the name or IBAN.
    const overhead = byteLength(assemble(""));
    note = truncateBytes(note, Math.max(0, MAX_PAYLOAD_BYTES - overhead));
    payload = assemble(note);
    if (byteLength(payload) > MAX_PAYLOAD_BYTES) return null;
  }
  return payload;
}
