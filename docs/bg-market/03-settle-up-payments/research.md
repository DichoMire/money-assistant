# Topic 03 — Settle-Up Payment Links & QR: Research

> Part of the [Bulgarian market improvement guide](../README.md).
> Research date: **2026-08-24**. Companion implementation plan: [rfc.md](rfc.md).
> Scope decision (owner): **deep links & QR only** — the user's own bank/payment app
> does the transfer; no money ever moves through this app, no PSP, no license.
> Current state: settle-up is pure bookkeeping ([audit §1.5](../00-current-state-audit.md)).
> Unverified claims flagged ⚠️.

**Context (verified):** Bulgaria adopted the euro 2026-01-01; since 2026-02-01 the euro is
sole legal tender. All domestic transfers are now ordinary **SEPA credit transfers in EUR**
— euro-area standards (EPC QR, SEPA Instant) apply to Bulgaria for the first time.

---

## 1. Revolut in Bulgaria

- **Adoption — high and verified:** over **1.3 million Bulgarian users** by end-2025 (+27% YoY), ≈ **22% population penetration**; effectively the default P2P rail among younger urban users (the core splitting demographic). BGN balances were force-converted to EUR on 2025-12-17; EUR SEPA transfers free on Standard.
- **revolut.me links:** `https://revolut.me/<username>` is a public payment page. Users can share the generic link (payer types the amount) or create an amount-set request **in-app** (expires after 10 days). Payers don't need a Revolut account (can pay by card).
- ⚠️ **No documented public URL parameter** exists to prefill amount+note from outside the app (e.g. `revolut.me/user/10`). Needs an empirical on-device test; treat the bare username link as the only safe constructible link. No public API for personal payment requests (payment-link APIs are Business-only).
- **QR scanning:** Revolut's in-app scanner prefills recipient/amount from payment QRs; secondary sources state it **scans EPC QRs for SEPA transfers**. ⚠️ Not confirmed in official docs — verify on-device before shipping.

## 2. EPC QR (SEPA Credit Transfer QR / "GiroCode")

**Spec:** EPC069-12 v2.10 (2024-06-17). Payload = **12 newline-separated lines**, error correction M, QR version ≤ 13, ≤ **331 bytes**:

| # | Field | Value / limit |
|---|---|---|
| 1 | Service tag | `BCD` (fixed) |
| 2 | Version | use `002` (BIC optional) |
| 3 | Charset | `1` = UTF-8 |
| 4 | Identification | `SCT` |
| 5 | BIC | empty in v002 |
| 6 | Beneficiary name | ≤ 70 chars |
| 7 | IBAN | no spaces |
| 8 | Amount | `EUR12.50` (period decimal, 2 dp; ⚠️ range 0.01–999,999,999.99 per implementation guides) |
| 9 | Purpose code | usually empty |
| 10 | Structured remittance | ISO 11649 RF ref (⚠️ ≤ 35 chars) |
| 11 | Unstructured remittance | free text ≤ 140 chars |
| 12 | Beneficiary-to-originator info | ≤ 70 chars, optional |

⚠️ Use **either** line 10 **or** 11, not both (stated across implementation guides; EPC PDF itself not fetchable).

Example for a Bulgarian payee in EUR (v002, no BIC, unstructured note):

```
BCD
002
1
SCT

Ivan Petrov
BG80BNBG96611020345678
EUR12.50


Settle up: Bansko trip
```

### Who in Bulgaria can actually scan an EPC QR (Aug 2026)

| App | EPC QR scan? | Their QR is… |
|---|---|---|
| **Revolut** | ⚠️ Reportedly yes (secondary sources only; test on-device) | also has revolut.me QRs |
| **UniCredit Bulbank** | No evidence | proprietary "Scan and Pay" — scannable **only by other Bulbank Mobile users**; format unpublished |
| **UBB (KBC)** | ⚠️ Unclear — FAQ mentions a QR "easing filling in requisites", standard unspecified | — |
| **DSK (DSK Smart)** | No evidence — no scan-to-transfer feature documented | — |
| **Postbank ONE wallet** | No evidence | can *share own account details* as QR; wallet transfers by phone number; format unpublished |
| **Fibank (My Fibank)** | No evidence | QR used for token activation/3-DS only |

**Bottom line:** ⚠️ **no Bulgarian bank app is documented to scan EPC QRs as of Aug 2026** — bank QR features are proprietary/intra-app. EPC QR is widespread in DE/AT/NL/BE/FI; Romania is the cautionary counter-example (national scheme instead). Generating EPC QRs today serves **Revolut payers (pending verification)** and is a cheap future-proof bet — but it is **not** a here-today mass rail through Bulgarian bank apps.

**Verification of Payee (since Oct 2025):** banks run recipient-name checks — the beneficiary name in any QR/IBAN block must match the account holder's registered name or payers see a mismatch warning.

## 3. blink by BORICA

- Bulgaria's national instant-payment scheme (BORICA), 24/7, TIPS-integrated for EUR since Dec 2024. Instant payments grew from 3.5% (2022) to 20.4% (2024) of credit transfers.
- **blink P2P** = send EUR instantly using only the recipient's **phone number** (recipient registers one receiving account in their own bank's app). **Free up to €150/transfer for individuals — promo until 2026-12-31.** Participants: DSK, UniCredit Bulbank, UBB, Postbank, Fibank, CCB, Investbank, ProCredit, TBI, Transcard — every major retail bank. **Revolut does not participate** ⚠️ (absence from lists, not stated anywhere). **1.3M+ active P2P users**, 45% brand recognition (Jan 2026).
- **Third-party initiation: none.** ⚠️ Exhaustive search found **no URL scheme, deep link, request-to-pay, or developer API** to open a bank's blink screen pre-filled, and no cross-bank consumer "request money" product. blink lives entirely inside each bank's app. Best possible: an instruction card ("Open your bank app → blink P2P → number X → amount Y").
- Roadmap to watch: blink eCommerce, Google/Apple Pay, cross-border P2P via the **EuroPA alliance** (Bizum/MB WAY/BLIK/Vipps).

## 4. iris / open banking

- **IRIS Solutions** (Sofia) is the leading Bulgarian PSD2 TPP (licensed PIS+AIS); consumer product **IRIS Pay** does account-to-account payments by QR/link/click — **merchant-only**. ⚠️ No P2P request-money product for individuals.
- A PISP link initiates payment *through the provider* — violating the "no money movement" constraint (the app would sit in the commercial chain). **Out of scope** per the owner's decision; documented for the long-term radar.
- No Bulgarian consumer implementation of EPC **SEPA Request-to-Pay** found ⚠️.
- Prior art that PIS works for splitting: Splitwise × **Tink** "Pay by Bank" (UK/FR/DE/AT). ⚠️ Tink's Bulgarian bank coverage unverified.

## 5. Other habits (2026)

- **Cash fading but real:** the changeover accelerated cashless (Dec 2025: 57.2M card transactions, +11% YoY; cash ≈35% of card-operation volume). Friend-to-friend cash settling remains a path the app records but can't automate.
- **ePay.bg/EasyPay:** still operates (EUR since Jan 2026, free micro-account P2P with money-request feature) — ⚠️ mostly bill payments for an older demographic (assessment, no usage data).
- **iCard, A1 Wallet, Paysera:** alive but niche next to Revolut + blink.
- **IBAN sharing over Viber:** Viber >90% market share; even IRIS Pay markets "send link via Viber" as a primary channel. ⚠️ That texting an IBAN/Revolut tag in Viber is *the* P2P-debt norm is consistent with everything found but anecdotal.

## 6. Prior art: competitors' settle-up integrations

- **Splitwise:** PayPal/Venmo deep links (US-only); Tink Pay-by-Bank (UK/FR/DE/AT); elsewhere settle = "record payment."
- **Tricount (bunq):** users attach their **IBAN to their profile** (visible to group members), in-app payment requests, bunq.me link pages.
- **Settle Up — the closest architectural model:** settles via **payment QR + launching the payer's own banking app**, no money through Settle Up. Their production open-source library [`step-up-labs/pay-via-bank-app`](https://github.com/step-up-labs/pay-via-bank-app) encodes the debt as a SPAYD (CZ/SK) payload; on Android it fires an intent so registered bank apps open pre-filled, on iOS it shows QR + share sheet. README plans EPC support. **This QR-standard + OS-handoff pattern is exactly replicable for Bulgaria with EPC QR instead of SPAYD.**

## Recommendations (ranked: user reach vs effort)

1. **"Bank transfer card" with copy-to-clipboard — do first.** Payee stores IBAN once; the settle screen shows name + IBAN + EUR amount + note with per-field copy buttons and a pre-composed **Viber/Messenger share message**. Reach ~100% of banked users; effort trivial; digitizes the actual current habit. Displayed name must match the account holder (Verification of Payee).
2. **blink P2P instruction card** (payee's registered phone + amount + step hint). Reach: every major BG bank, instant, free ≤€150 — ideal for typical splits; no deep link exists, so it's a guided manual flow.
3. **Revolut `revolut.me/<username>` link/QR.** Reach 1.3M users; effort trivial. ⚠️ Amount cannot be prefilled per current docs — UI shows the amount to type; empirically test undocumented parameters as a bonus, never a dependency.
4. **EPC QR generation** (payload above; client-side, ~30 lines + a QR lib). Reach today: Revolut payers (⚠️ verify) + euro-area visitors; reach tomorrow: likely grows as euro-area norms reach BG banks. Ship alongside (1), never instead. Print human-readable fields under the QR so one screen serves both.
5. **Skip / monitor:** blink deep links (don't exist), IRIS Pay / Tink-style PIS (merchant-oriented; breaks the no-money-movement constraint; licensing), ePay.bg links (declining niche), SEPA Request-to-Pay (no BG consumer implementation). **Re-check blink eCommerce and EuroPA in ~12 months** — a public blink request/link product would change this ranking.

## Sources

<details><summary>Full source list (URLs)</summary>

**Revolut:** https://boulevardbulgaria.bg/articles/revolut-otchita-rekordna-pechalba-prez-2025-godina · https://www.capital.bg/biznes/finansi/2026/03/24/4895952_revolut_otchita_65_rust_na_pechalbata_do_13_mlrd/ · https://help.revolut.com/en-BG/help/accounts/bulgaria-joins-eur-faqs/question-bulgaria-is-joining-euro-what-will-happen/ · https://fintechbulgaria.com/revolut-preminavane-kam-evro/ · https://help.revolut.com/help/transfers/payment-links/revolut-me-link/ · https://help.revolut.com/en-US/help/adding-money/with-money-from-friends-or-relatives/requesting-money/ · https://julianweber.blog/en/revolut-qr-code-scan/ · https://developer.revolut.com/docs/guides/manage-accounts/transfers/payout-links
**EPC QR:** https://www.europeanpaymentscouncil.eu/document-library/guidance-documents/quick-response-code-guidelines-enable-data-capture-initiation · https://en.wikipedia.org/wiki/EPC_QR_code · https://girocodegenerator.com/en/wissen/epc-standard · https://segno.readthedocs.io/en/latest/epc-qrcodes.html · https://getqr.ro/en/blog/which-banks-support-sepa-qr-code
**BG bank apps:** https://www.unicreditbulbank.bg/bg/bulbank-mobile/funktsionalnosti/prevodi/ · https://www.unicreditbulbank.bg/bg/za-nas/media/novini/promeni-BBM-BBO-euro/ · https://ebb.ubb.bg/help/faq0BG_Re.html · https://ubb.bg/en/ubb-mobile/transfers · https://dskbank.bg/dsk-smart-banking · https://dskbank.bg/индивидуални-клиенти/електронно-банкиране/незабавни-преводи-blink · https://www.postbank.bg/bg-BG/Digitalno-bankirane/ONE-wallet-by-Postbank/Payments-and-Transfers · https://www.fibank.bg/web/files/documents/74/files/UsageDirections_MyFibank.pdf
**blink:** https://www.blinkpay.bg/ · https://www.blinkpay.bg/blinkp2p/ · https://www.borica.bg/en/latest/novini/instant-payments-in-bulgaria-3-years-after-the-first-transaction_en · https://www.borica.bg/en/latest/novini/skorost-i-sigurnost-kato-standart-za-razplashtaniyata-u-nas · https://www.bcard.bg/en/news/natsionalnata-kampaniya-za-nezabavni-prevodi-po-mobilen-nomer-blink-blink-p2p-priklyuchi · https://www.ubb.bg/en/news/view/blink-p2p-prevodi-po-mobilen-nomer-bez-taksa · https://www.transcard.bg/bg/blinkvay-po-mobilen-nomer-bezplatno-do-31-12-2026-godina/
**Open banking:** https://www.irisbgsf.com/en · https://www.irisbgsf.com/en/paymentinitiation · https://irispay.eu/en/
**Habits:** https://www.economic.bg/bg/a/view/keshyt-v-bylgarija-otstypva-po-byrzo-zaradi-priemaneto-na-evroto · https://businessnovinite.bg/bg-biznes/vse-po-malko-balgari-izpolzvat-kesh-sled-vavezhdaneto-na-evroto.html · https://www.svobodnaevropa.bg/a/bulgaria-siva-ikonomika-evropeyski-sayuz/33377283.html · https://www.epay.bg/v3main/front?p=news · https://www.epay.bg/v3main/front?p=h_cash · https://mobilebulgaria.com/news/viber-ima-nad-90-pazaren-dyal-v-balgariya · https://icard.com/bg/features · https://www.a1.bg/a1-wallet
**Prior art:** https://kb.splitwise.com/payment-integrations/how-do-i-send-money-via-paypal-or-venmo · https://tink.com/press/splitwise-tink-partner/ · https://thefintechtimes.com/splitwise-expands-pay-by-bank-to-france-germany-and-austria-with-tink/ · https://www.tricount.com/ · https://help.tricount.com/articles/tricount-faqs · https://github.com/step-up-labs/pay-via-bank-app

</details>

**Key ⚠️ items to resolve empirically before shipping:** (a) does the Revolut app scan EPC QRs in Bulgaria; (b) does any undocumented revolut.me amount parameter work; (c) exact formats of Bulbank/UBB/ONE proprietary QRs; (d) Tink's Bulgarian coverage; (e) EPC fine print (amount range, RF-ref limit, ref-XOR-text rule) — verified via implementation guides only.
