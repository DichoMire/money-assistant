# Topic 01 — Euro Changeover & BGN Handling: Research

> Part of the [Bulgarian market improvement guide](../README.md).
> Research date: **2026-08-24**; all live-API checks performed that day. Companion
> implementation plan: [rfc.md](rfc.md). Current-state findings:
> [00-current-state-audit.md §5](../00-current-state-audit.md).

**Why this is topic #1:** the app has a live correctness bug for its target market.
The ECB removed BGN from its reference rates in January 2026; the app's FX pipeline
(`src/lib/rates.ts`, `src/lib/rates-fetch.ts`) resolves BGN via those rates, and
`src/lib/group-data.ts:168` silently drops any expense whose rate can't be resolved
from **all balance math**. A Bulgarian group with BGN history — or a BGN base
currency — produces wrong balances today.

---

## 1. Changeover facts

- **Conversion rate — confirmed:** 1 EUR = **1.95583 BGN**, fixed and irrevocable. Set by Council Decision (EU) 2025/1407 and Council Regulation (EU) 2025/1408 (8 July 2025); equals the lev's ERM II central rate. Bulgaria adopted the euro on **1 January 2026** as the 21st euro-area member.
- **Legal basis for rounding:** Bulgaria's Law on the Introduction of the Euro (ЗВЕРБ) — Art. 12 fixes the rate; Art. 13 sets rounding. Mirrors EU Council Regulation (EC) 1103/97.
- **Rounding rules:**
  - BGN→EUR conversion divides by the **full rate 1.95583** — the rate "shall not be rounded or truncated" and **inverse rates must not be used** (Reg. 1103/97 Art. 4).
  - Result rounds to the **second decimal, half-up** (third decimal ≥ 5 rounds up).
  - Rounding applies **per monetary amount converted** — no rule forces per-line-item conversion of receipts; the final payable total is what got the dual-total treatment.
- **Dual circulation:** **1–31 January 2026** (both currencies legal tender; change given in euro). Euro-only from 1 February 2026. Lev cash exchangeable at banks until 30 June 2026 (fees possible after), and at the Bulgarian National Bank **indefinitely, free**.

## 2. Dual price display

- **Mandatory period: 8 August 2025 → 8 August 2026.** It did **not** run to end-2026.
- During it: both prices in close proximity, same font/size/colour, converted at exactly 1.95583. Bound merchants, service providers, financial institutions, public institutions.
- **Receipts during dual display:** final total in both EUR and BGN **with the official rate printed on the receipt**. Until 31 Dec 2025: BGN primary + EUR equivalent; from 1 Jan 2026: EUR primary + BGN equivalent.
- **In force today (2026-08-24)? NO.** Ended 8 Aug 2026. Prices are now announced **in euro only**; merchants **may voluntarily** keep a lev figure as clearly-marked reference info — "the price in euro is the only selling and payable price."

## 3. Fiscal receipts (касова бележка) in 2026

Regulated by Art. 118 VAT Act + **Ordinance № N-18/2006**, amended in 2025 for the euro. Typical layout (feeds the receipt parser — see [topic 04](../04-receipt-scanning/research.md)):

- **Header:** trader name + address, обект (site), ЕИК (company ID), ЗДДС № (VAT no.), operator.
- **Line items:** each item individually (grouping banned since 2017): name, **tax-group letter**, quantity × unit price, value.
- **Tax groups:** **А** = exempt/0%, **Б** = 20% standard, **В** = liquid fuels (20%), **Г** = 9% reduced (books, baby food, hotel accommodation). VAT breakdown by group near the total.
- **Totals:** МЕЖДИННА СУМА (subtotal), **ОБЩА СУМА** (total), payment method, VAT-per-group lines.
- **Fiscal footer:** fiscal logo ("ФИСКАЛЕН БОН"), fiscal device + memory numbers, document number, date/time, UNP, **QR code**.
- **Currency by era — critical for the parser:**
  | Receipt date | Line items | Totals |
  |---|---|---|
  | ≤ 2025-12-31 | BGN (лв) | BGN; from 8 Aug 2025 also EUR total + rate |
  | 2026-01-01 → 2026-08-08 | EUR | EUR + **mandatory BGN dual-total + printed 1.95583** |
  | ≥ 2026-08-09 (today) | EUR | EUR only; voluntary informational BGN line still legal |
- ⚠️ One Fiscal Solutions article claimed the dual-total obligation ran to 31 Dec 2026; Bulgarian-language sources and post-8-Aug reporting contradict it. Treat **8 Aug 2026** as correct, but the parser should tolerate voluntary BGN lines through 2026 and beyond.

## 4. FX data

- **ECB:** BGN was **removed from the euro reference rates with the publication of Friday, 2 January 2026** (ECB technical update, 11 Dec 2025).
- ⚠️ The ECB *reference* rate was published to 4 decimals (**1.9558**), the *legal conversion* rate has 5 (**1.95583**). Never use 1.9558 for conversions.
- **Frankfurter API — verified live 2026-08-24:**
  - `GET /v1/latest?base=EUR` → 29 currencies, **no BGN**.
  - `GET /v1/latest?symbols=BGN` → **HTTP 404**.
  - `GET /v1/2025-12-30?base=EUR&symbols=BGN` → still works, returns **1.9558** (4-decimal reference — do not use for conversion).
- **Standard practice:** hardcode **1.95583** as a fixed constant (full rate, no inverse, half-up to 2 dp). Fintechs did exactly this (e.g. Payhawk's changeover FAQ).

## 5. Consumer sentiment (mid-2026)

- Support flipped after adoption: 43%/50% against (May 2025 Eurobarometer) → **54% support** (Feb 2026, Alpha Research) → **55% / 39%** (spring 2026 Standard Eurobarometer).
- Price impact small (~0.3–0.4 pp one-off HICP in Jan 2026); perceived inflation actually *declined* in January 2026 (ECB blog).
- ⚠️ Press coverage of Flash Eurobarometer 3713 (April 2026): 78% felt well informed, 62% found the transition smooth (figures from press, not the raw report).
- **Do people still think in leva?** Aug 2026 coverage: many now calculate in euro, but mentally converting to "old lev prices" remains widespread; some merchants voluntarily keep lev reference prices. ⚠️ No formal survey of "% still thinking in leva as of Aug 2026" exists. Given the 26-year peg (and Germany's decades-long DM-conversion habit as precedent), a **secondary BGN reference display is a defensible, low-cost feature for 2026–2027**, best as an opt-in toggle.

## 6. Legal position of the app

- The dual-display/conversion obligations bind **traders offering goods/services to consumers**; B2B, invoices, contracts, wholesale are out of scope. A private app displaying *informational* converted historical amounts is not announcing a selling price — **no dual-display obligation applies**. ⚠️ No provision addresses apps specifically (absence-of-regulation conclusion, not legal advice).
- Using the official method avoids misrepresentation concerns:
  - **BGN → EUR:** `EUR = round(BGN / 1.95583, 2)` — full 5-decimal rate, half-up, per amount.
  - **EUR → BGN (reference):** `BGN = round(EUR × 1.95583, 2)` — never a stored inverse rate.

## Implications for the app (summary — the RFC turns these into a plan)

1. **Stored BGN expenses stay immutable**; derive EUR at `amount / 1.95583`, half-up. Convert per-expense, then sum (matches how prices were legally converted); apply one policy consistently.
2. **Hardcode 1.95583** as a constant. Don't query FX APIs for BGN at current dates (404/omitted). For cross-currency history (BGN→USD), chain BGN→EUR at 1.95583, then EUR→USD at the date's ECB rate.
3. **Migrate BGN base-currency groups to EUR**; stop offering BGN for new groups/expenses; keep rendering legacy BGN entries with original amount + EUR conversion.
4. **Optional "show leva equivalent" toggle** (EUR × 1.95583), labeled informational.
5. **Receipt parser: three eras** keyed off receipt date (see table above); anchor on `ОБЩА СУМА`; recognize `лв`/`лева`, `EUR`/`€`/`евро`, printed `1.95583`; parse VAT groups А/Б/В/Г; use the fiscal footer as validity signal; when both totals appear, EUR is authoritative for 2026 receipts, BGN for 2025; cross-check the pair against 1.95583 (±0.01) as a quality validation.
6. **Fix the silent-drop bug independently of BGN:** any missing-rate expense must never silently vanish from balances (see RFC — this is the top-priority change).

## Sources

- Council press release: https://www.consilium.europa.eu/en/press/press-releases/2025/07/08/bulgaria-ready-to-use-the-euro-from-1-january-2026-council-takes-final-steps/
- ECB Economic Bulletin: https://www.ecb.europa.eu/press/economic-bulletin/focus/2026/html/ecb.ebbox202508_01~b4379b735b.en.html
- ECB technical update (BGN removal): https://www.ecb.europa.eu/services/using-our-site/technical-updates/html/ecb.technical_update251211.en.html
- ECB blogs: https://www.ecb.europa.eu/press/blog/date/2026/html/ecb.blog20260409~cc951a0d29.en.html · https://www.ecb.europa.eu/press/blog/date/2025/html/ecb.blog20251104~cf577c8f68.en.html
- Council Regulation 1103/97 (conversion/rounding): https://eur-lex.europa.eu/eli/reg/1997/1103/oj/eng
- Sofia Globe: https://sofiaglobe.com/2026/08/06/bulgaria-and-the-euro-dual-price-display-ends-on-august-8-2026/ · https://sofiaglobe.com/2025/08/08/bulgaria-and-the-euro-mandatory-dual-pricing-comes-into-effect/ · https://sofiaglobe.com/2025/12/29/bulgaria-and-the-euro-a-practical-guide-to-the-transition/
- BNB dual-display Q&A: https://www.bnb.bg/AboutUs/AUEurosystem/AUAccessionToTheEuroArea/AUAEFIQuestionsAndAnswers/POAEFI_QUESTIONSANDANS10_BG
- Consumer Protection Commission FAQ: https://kzp.bg/bg/za-evroto/faq
- CMS Law-Now: https://cms-lawnow.com/en/ealerts/2025/07/dual-pricing-obligations-immediate-measures-for-businesses
- Fiscal receipt rules: https://www.fiscal-requirements.com/news/4044 · /news/4205 · /news/4025 · https://www.faragency.bg/news/17518053052495/s-novata-valuta-idva-novata-kasova-belezhka · https://www.dataplus-bg.com/kasova-belejka/ · https://www.dataplus-bg.com/kray-na-dvojnoto-oboznachavane/ · https://kostelbg.net/en/node/62
- Sentiment: https://www.bta.bg/en/news/world/1122210-more-than-half-of-bulgarians-now-support-euro-latest-eurobarometer-survey-shows · https://europa.eu/eurobarometer/surveys/detail/3713 · https://manager.bg/икономика/krai-na-cenite-v-levove-ot-dnes-etiketite-v-balgaria-veche-sa-samo-v-evro · https://www.24chasa.bg/biznes/article/23350381
- Cash exchange: https://www.bsi.si/en/media/posts/the-bulgarian-lev-will-soon-be-replaced-by-the-euro-how-do-i-exchange-them
- Fintech practice: https://payhawk.com/help/faq-on-the-bgn-to-eur-eurozone-transition
- Frankfurter API (live checks 2026-08-24): https://api.frankfurter.dev/v1/latest?base=EUR · https://api.frankfurter.dev/v1/latest?symbols=BGN · https://api.frankfurter.dev/v1/2025-12-30?base=EUR&symbols=BGN
