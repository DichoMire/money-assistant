# Topic 08 — GDPR, Privacy & Terms of Service: Research

> Part of the [Bulgarian market improvement guide](../README.md).
> Research date: **2026-08-24**. Companion implementation plan: [rfc.md](rfc.md).
> Business/VAT findings from the same research live in [09-monetization/research.md](../09-monetization/research.md).
> Current gaps: [audit §8](../00-current-state-audit.md) — no account deletion, no export,
> no retention policy, no policies at all, receipt images sent to a free US LLM endpoint.
> Unverified claims flagged ⚠️. Not legal advice.

---

## 1. GDPR essentials for this specific app

### Lawful basis
- **Art. 6(1)(b) contract** for the core service: accounts, groups, expenses, receipt parsing as a requested feature.
- Legitimate interest for security/abuse logs.
- Consent only becomes relevant if analytics/marketing are added later.

### Privacy policy — required (Art. 13)
Must state: identity, purposes, legal bases, processors, transfers, retention, data-subject rights, and the right to complain to **КЗЛД (CPDP)**.

### Cookie banner — NOT needed (today)
- Auth/session cookies are the textbook "strictly necessary" ePrivacy exemption; a user-set locale cookie is likewise generally exempt.
- The app currently sets exactly two cookies (Auth.js session + `locale`) → **no consent banner required**, but both must be disclosed in the privacy/cookie policy.
- Adding any analytics or marketing tag changes this instantly. (Choose a cookieless analytics tool — see [RFC 11](../11-reliability-scale/rfc.md) — to keep the no-banner status.)

### Data-subject rights — must be implemented
- **Self-serve account deletion** (currently impossible — nothing deletes a `users` row): cascade DB rows, receipt images, and document LLM-provider retention windows. One-month response deadline.
- **Data export** (JSON/CSV of expenses, groups, receipts) covers Art. 15 access + Art. 20 portability.

### Receipt images are personal data
Once linked to an account they can contain card last-4, loyalty IDs, names, and location/time purchase patterns. Minimize: **parse then delete the image** (or make retention a user choice), strip EXIF, don't store fields you don't need. Card last-4 is not PCI-regulated but is still personal data. ⚠️ Reasoned from Art. 4(1); no authority guidance specific to receipt images found.

### Processors & DPAs — all available
| Processor | DPA status |
|---|---|
| Vercel | DPA at vercel.com/legal/dpa, Art. 28(3) subprocessor flow-downs |
| Neon | GDPR-compliant DPA embedded in ToS, separately signable |
| Google (Sign-In) | Essentially an independent controller for auth; Cloud DPA applies only if GCP/Vertex is used |
| LLM provider | Anthropic: DPA built into Commercial Terms, published subprocessor list, 7-day default API-log deletion. OpenAI and Google offer standard DPAs. **OpenRouter free endpoints (current default) may train on inputs — incompatible with real users' receipts** ([audit §2](../00-current-state-audit.md)) |

List all in the privacy policy.

### Sending receipts to an LLM — EU residency options (2026)
- **Anthropic first-party API: no EU inference** (`inference_geo` US/global only; EU "coming"). For EU-resident Claude: AWS Bedrock EU regions or Vertex AI.
- **OpenAI: yes** — new API projects can select Europe (`eu.api.openai.com`) with in-region processing and zero retention for eligible customers.
- **Google: yes via Vertex AI** EU regions under the Cloud DPA; the consumer Gemini Developer API has **no** EU pinning. ⚠️ One source reports the newest Gemini models run global-only even on Vertex.
- EU residency is a **nice-to-have, not a strict requirement** — US processing remains lawful under SCCs / EU-US Data Privacy Framework — but an EU endpoint simplifies the privacy story, and per [topic 10 §6](../10-growth-marketing/research.md) "data stays in the EU" is a real trust signal for Bulgarian users.

### DPO / records
- **DPO: not required** — Art. 37 triggers don't apply to a small expense app.
- **Art. 30 ROPA: keep one anyway.** The under-250-employee exemption fails whenever processing is "not occasional" — a live app processes continuously, so regulators read the exemption as almost never applying. It's a one-page spreadsheet.

### КЗЛД (CPDP) enforcement posture
Overwhelmingly **complaint-driven**, not proactive; headline fines target large breaches (NRA ~€2.55M, DSK ~€500k); 2025 priority is minors' data. A small compliant app is very unlikely to be targeted absent a complaint or breach — but the **72-hour breach-notification duty** applies regardless.

## 2. Terms of service basics for a friend-debt tracker

Standard clauses, all verifiable in competitors' live ToS (Splitwise, SplitPal, NeatSplit, Splits):

1. **Not a financial institution**: not a bank, payment processor, money transmitter, or lender; the service never holds or moves funds; settlement happens outside the service.
2. **Records are informational**: Splitwise's exact framing — balances/IOUs are "informal records, not legally binding contracts." Add: not evidence of enforceable debt; the operator is not a party to user disputes.
3. **AI accuracy disclaimer**: receipt scanning is automated and may be inaccurate; users must verify parsed amounts before relying on them.
4. **Age**: Bulgaria's digital-consent age is **14** (Art. 25c of the BG Personal Data Protection Act). Clean choice: **14+** (or 16+ to sidestep entirely); any future payment-adjacent features 18+. (Core service relies on contract, not consent, so 14+ is defensible.)
5. **Liability**: cap at fees paid in the last 12 months; exclude indirect damages. EU consumer law bars excluding gross-negligence liability and grants a **14-day withdrawal right** for digital purchases — handled via consent-to-immediate-performance waiver at checkout (a merchant-of-record checkout does this automatically). Bulgarian/EU mandatory consumer protections apply regardless of governing-law clause. ⚠️ Standard practice; no dedicated source.

## 3. App-specific gap list (from the [audit](../00-current-state-audit.md), to be closed by the RFC)

| Gap | Severity |
|---|---|
| No account deletion path at all | **High** — Art. 17 right cannot be exercised |
| Receipt images retained forever, sent to free/training-permitted US endpoints | **High** — data minimization + processor problem; also blocks monetization launch |
| No privacy policy / ToS / processor disclosure anywhere | **High** — required before any marketing push |
| No data export | Medium — Art. 15/20 |
| Activity log embeds member **emails** in jsonb, visible to all group members, surviving the member's departure | Medium — minimization; names alone suffice |
| Members never told receipt photos go to a third-party LLM | Medium — transparency |
| Invite token = long-lived bearer URL exposing full financial history + emails | Medium — security-adjacent |
| No breach-response plan | Low at this scale, but the 72-hour duty exists |

## Recommended path ("one focused weekend" + the deletion/export build)

1. Write the privacy policy + ToS in **plain Bulgarian first, English second** — per [topic 10 §6](../10-growth-marketing/research.md), a short "Данните ви са ваши" page beats legalese for an audience where only 19% know what GDPR is (⚠️ 2019 data).
2. Build self-serve **delete account** + **JSON export** (the RFC specifies the cascade semantics — the tricky part is shared data: expenses in groups with other members are *their* records too; detach-to-virtual is the right erasure semantics for shared history, full delete for solo data).
3. **Delete receipt images after parsing** by default (or user-controlled retention); strip EXIF on upload.
4. Switch the LLM to a **paid, no-training endpoint** (EU-resident if convenient) before any real-user push — this is both a GDPR and a trust issue. (Model choice: [04-receipt-scanning/rfc.md](../04-receipt-scanning/rfc.md).)
5. Stop denormalizing **emails** into the activity log (names suffice going forward).
6. Maintain a one-page Art. 30 record; no DPO, no cookie banner (while cookies stay essential-only).

## Sources

<details><summary>Full source list (URLs)</summary>

- Vercel DPA: https://vercel.com/legal/dpa · Neon GDPR: https://neon.com/blog/gdpr-compliance-and-neon · Anthropic DPA: https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa · OpenAI EU residency: https://openai.com/index/introducing-data-residency-in-europe/ · Claude GDPR 2026: https://sonomos.ai/blog/is-claude-gdpr-compliant-2026/ · https://compound.law/en-DE/tools/claude-eu-hosting/ · Gemini GDPR 2026: https://sonomos.ai/blog/is-gemini-gdpr-compliant-2026/ · Vertex EU: https://omnifact.ai/blog/feature-drop-eu-data-residency-vertex-ai
- Art. 30: https://gdpr-info.eu/art-30-gdpr/ · https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/documentation/who-needs-to-document-their-processing-activities/ · https://www.dpo-consulting.com/blog/gdpr-article-30-guide
- Cookies: https://www.cookieyes.com/blog/cookie-consent-exemption-for-strictly-necessary-cookies/ · https://veracly.app/blog/essential-cookies-no-banner · https://www.pii.ai/blog/Strictly-Necessary-Cookies-Under-the-GDPR
- КЗЛД enforcement: https://cms.law/en/int/publication/GDPR-Enforcement-Tracker-Report/bulgaria · https://www.pinsentmasons.com/out-law/news/gdpr-fines-for-data-breaches-in-bulgaria
- Consent age 14: https://gdprhub.eu/Data_Protection_in_Bulgaria · https://gdprlocal.com/digital-age-of-consent-under-the-gdpr/
- ToS prior art: https://www.splitwise.com/terms · https://splitpal.io/terms-of-service/ · https://www.neatsplit.com/terms · https://trysplits.com/terms

</details>
