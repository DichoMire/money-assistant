# RFC 03 — Settle-Up Payment Helpers: Bank Card, blink Instructions, Revolut Links, EPC QR

> **Status:** Proposed · **Priority: P1 — the most visible "made for Bulgaria" feature**
> **Audience:** a future LLM implementer with full repo access. Read
> [research.md](research.md) and [audit §1.5–1.6](../00-current-state-audit.md) first.
> Constraint (owner decision): **no money moves through the app** — helpers only prepare
> what the payer's own bank/payment app needs. File refs are to commit `14963d2`.

## 1. Problem

Settle-up today records that "A paid B" (`expenses.kind='settlement'`,
[src/app/actions.ts:696-805](../../../src/app/actions.ts)) but gives the debtor zero help actually
paying. In Bulgaria the real rails are: SEPA bank transfer by IBAN (universal), blink P2P
by phone number (every major bank, free ≤ €150 until end-2026), Revolut (22% of the
population), and cash. Users currently juggle between the app and a Viber thread where
someone pastes an IBAN. Splitwise offers nothing here for Bulgaria; Tricount only shows a
profile IBAN. A well-executed "how to pay" card is cheap and immediately differentiating.

There is nowhere to store payment details: neither `users` nor `aliases`
([src/db/schema.ts](../../../src/db/schema.ts)) has IBAN/phone/username fields, and there is no user
settings surface at all (audit §1.10).

## 2. Goals / non-goals

**Goals**
- G1. A member can store their payment details once (IBAN + account-holder name, blink
  phone, Revolut username) and control that co-members can see them.
- G2. The settle flow shows the debtor a "how to pay {creditor}" card: copyable bank
  fields, blink instructions, Revolut link, and an EPC QR — whichever the creditor has.
- G3. One-tap share of a payment-request message into Viber/Messenger (Web Share API).
- G4. Everything works without the creditor being present (details are stored, not live).
- G5. Recorded settlements can carry an optional method tag.

**Non-goals**
- Payment initiation of any kind (PIS/open banking) — excluded by owner decision; research §4 keeps it on the long-term radar.
- Verifying that a payment actually happened (stays an honor-system record).
- Payment details for **virtual members** (v1: real accounts only; a virtual member's owner can put an IBAN in the settlement note manually — revisit if demanded).
- The account-settings screen shell itself ([RFC 06](../06-onboarding-auth/rfc.md) builds it; this RFC contributes a section to it).
- Share-message marketing copy strategy ([RFC 10](../10-growth-marketing/rfc.md)).

## 3. Design

### 3.1 Data: `payment_profiles` table

```
payment_profiles
  user_id      text PK → users.id (cascade delete)   -- one profile per account
  iban         text NULL          -- normalized: uppercase, no spaces
  account_name text NULL          -- MUST match bank records (Verification of Payee)
  blink_phone  text NULL          -- E.164, the number registered for blink receiving
  revolut_tag  text NULL          -- revolut.me username (no URL, no @)
  updated_at   timestamp
```

- Keyed by **user**, not alias — payment identity is a property of the person and reused
  across groups. (Virtual members deliberately excluded, see non-goals.)
- Server-side validation: IBAN mod-97 checksum + length-per-country table (BG=22, but
  accept any valid SEPA IBAN — Bulgarians bank with Revolut LT IBANs too); `account_name`
  ≤ 70 chars (EPC limit); `blink_phone` E.164 with +359 default prefix helper;
  `revolut_tag` `[a-z0-9_.-]{3,32}` (⚠️ exact rules unverified — be permissive, store raw).
- Visibility rule: a member's payment details are readable by users who **share at least
  one group** with them (same trust boundary as the existing Circle feature,
  `loadCircle` in [src/lib/group-data.ts:219-246](../../../src/lib/group-data.ts)). Enforce in the
  server action that serves the settle modal, not client-side.
- Entry UI: "Моите данни за плащане / My payment details" — a modal reachable from the
  members panel and later from RFC 06's settings screen. Under the form, a plain-language
  notice: *"Тези данни се показват на хората, с които споделяте група, за да могат да ви
  превеждат пари."* (shown to co-members so they can pay you). GDPR: user-entered,
  contract basis; include in RFC 08's export/deletion cascades (**deletion note for
  RFC 08:** cascade covers it via `user_id` FK).

### 3.2 The "how to pay" card in `SettleModal`

`SettleModal` ([src/components/SettleModal.tsx](../../../src/components/SettleModal.tsx)) is prefilled
from a debt row today. Extend: when the selected **recipient** is a real account with a
payment profile, render a collapsible "Как да платя? / How to pay" card above the record
form, with one section per available method, ordered per research (reach vs effort):

1. **Bank transfer (SEPA)** — rows for name / IBAN (grouped in fours for readability,
   copied without spaces) / amount / note ("{group name} — уреждане"), each with a copy
   button; one "copy all" composing a text block. Amount = the prefilled settle amount in
   the group currency; when the group currency is EUR (the norm post-[RFC 01](../01-euro-transition/rfc.md)) this is directly transferable.
2. **blink P2P** — the registered phone + amount + a 3-step hint ("Отворете приложението
   на банката си → blink P2P → изберете номера"). Badge: "безплатно до €150" (⚠️ promo
   ends 2026-12-31 — put the string in the i18n dictionary so it's easy to retire).
3. **Revolut** — button linking `https://revolut.me/{tag}` (opens app/site) + the amount
   displayed prominently since the link cannot carry it (research §1). If an empirical
   test finds a working amount parameter, append it behind a feature flag — never depend on it.
4. **EPC QR** — see 3.3. Rendered on demand ("Покажи QR"), with the human-readable bank
   fields printed beneath it (one screen serves scanners and typists).

The card is debtor-facing help; the **creditor** gets the mirror feature: a "request
payment" share button on their own credit rows composing the message in 3.4.

If the recipient has no profile: a one-line nudge ("Иван още не е добавил данни за
плащане") + nothing else. Never block the existing record-settlement flow.

### 3.3 EPC QR generation

- Pure function `buildEpcPayload({name, iban, amountCents, note}): string | null` in a new
  `src/lib/epc-qr.ts`, exactly per the verified spec in [research.md §2](research.md):
  `BCD\n002\n1\nSCT\n\n{name}\n{iban}\nEUR{amount}\n\n\n{note}` (v002, UTF-8, no BIC,
  unstructured remittance only — never both remittance lines).
- Constraints enforced: name ≤ 70 chars; note ≤ 140 chars **and** total payload ≤ 331
  bytes — Cyrillic is 2 bytes/char in UTF-8, so truncate the *note* (never the name/IBAN)
  by bytes with an ellipsis; amount formatted `EUR%d.%02d` from integer cents; return
  `null` (hide the QR option) when the debt currency isn't EUR or amount is outside
  0.01–999999999.99.
- QR rendering: add the `qrcode` npm package (canvas/SVG, no external service — keeps the
  zero-external-requests posture; ~its only runtime dependency footprint is acceptable) at
  error-correction level **M** per spec.
- Unit tests in `scripts/math.test.ts` style (new `scripts/epc.test.ts`): byte-exact
  payload for the research doc's example, Cyrillic-name byte counting, truncation, the
  null cases, IBAN mod-97 fixtures (valid BG/LT IBANs, one-digit corruption rejected).

### 3.4 Share message (Viber-first)

- Localized template, creditor-side: *"Здравей! За „{group}“ имаш да ми превеждаш
  {amount}. IBAN: {iban} ({name}) / blink: {phone} / revolut.me/{tag} — {appUrl}"* —
  include only the methods that exist; EN twin for the `en` locale.
- Mobile: `navigator.share({text})` — the OS share sheet reaches Viber natively (research:
  Viber >90% share, so no Viber-specific deep link needed). Desktop/unsupported: copy to
  clipboard with a "copied" toast, plus an optional `viber://forward?text=` link
  (⚠️ Viber desktop scheme is undocumented/unstable — feature-flag it, default off).
- The app URL in the message doubles as an acquisition loop (coordinates with RFC 10's
  share-payload definitions; this RFC owns the settle-context template).

### 3.5 Settlement method tag (small)

- Add nullable `method` text column to `expenses` (values: `cash|bank|blink|revolut|other`),
  set from an optional segmented control in `SettleModal`, shown as a small chip in
  `ExpenseDetailModal` and included in the audit-log diff (via RFC 02's structured-diff
  format if that lands first; else plain).

## 4. Implementation plan

| Stage | Contents | Touches |
|---|---|---|
| 1 | `payment_profiles` schema + migration + validation lib (IBAN mod-97) + server actions (get/set with co-member visibility check) | `schema.ts`, `drizzle/`, new `src/lib/payment-details.ts`, `actions.ts` |
| 2 | "My payment details" modal + i18n (EN/BG) + privacy notice | new component, `MembersModal.tsx` entry point, `i18n.ts` |
| 3 | "How to pay" card in `SettleModal` (bank + blink + Revolut sections, copy UX) | `SettleModal.tsx`, `group-data.ts` (serve profiles with group payload), `i18n.ts` |
| 4 | `epc-qr.ts` + `qrcode` dep + QR section + `scripts/epc.test.ts` | new files, `SettleModal.tsx`, `package.json` |
| 5 | Share message (Web Share + clipboard fallback), creditor-side request button on `BalancesPanel` credit rows | `SettleModal.tsx`, `BalancesPanel.tsx`, `i18n.ts` |
| 6 | `method` column + chip | `schema.ts`, `drizzle/`, `SettleModal.tsx`, `ExpenseDetailModal.tsx` |

**Pre-ship empirical checklist** (manual, document results in this file's Appendix):
Revolut scans the generated EPC QR (BG account) ✅/❌; `revolut.me/{tag}?amount=`-style
parameters ✅/❌; the share message renders fully in Viber (no truncation) ✅/❌; a DSK/UBB
transfer via copied fields completes with no Verification-of-Payee warning when
`account_name` is correct ✅/❌.

## 5. Acceptance criteria

- A user with a stored profile is payable from any shared group's settle modal; a user
  with no shared group cannot fetch another user's profile (server-enforced — test the
  action directly).
- `buildEpcPayload` matches the research example byte-for-byte; a 140-char Cyrillic note
  is truncated to fit 331 bytes; non-EUR debts render no QR/blink-free-badge but still
  render the bank card.
- Invalid IBAN (`BG80BNBG96611020345679`) is rejected server-side with a localized error;
  the valid fixture passes.
- Web Share fires on mobile Chrome/Safari; clipboard fallback works on desktop Firefox.
- Recording a settlement still works with zero profiles present (no regression to the
  existing flow, including virtual-member settlements).
- `npm run test:math` and the new `epc.test.ts` pass.

## 6. Risks & alternatives

- **EPC QR reach is speculative in BG today** (research: no bank app documented to scan
  it). Mitigation: it ships as the *fourth* section behind copy-first UX; cost is ~a day.
  Re-rank if blink ships any link/request product (re-check in mid-2027).
- **Stale payment details** → wrong-account transfers. Mitigation: show "updated {date}"
  on the card; Verification of Payee catches name mismatches bank-side.
- **Privacy of IBANs**: visibility is opt-in by entering data, scoped to co-members, and
  covered by RFC 08's export/delete. An IBAN alone cannot authorize debits (SEPA DD
  requires mandates), but treat it as personal data regardless.
- **Alternative considered — per-group visibility toggle** (profile visible only in
  selected groups): deferred; adds UI surface for a trust boundary users already accepted
  by joining a group. Revisit if users ask.
- **Alternative considered — storing details on `aliases`** (per-group): rejected;
  duplicates data, drifts, and breaks the "person, not membership" semantics.
