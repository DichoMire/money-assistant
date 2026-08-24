# Topic 09 — Freemium Monetization, Business Setup & Cost Floor: Research

> Part of the [Bulgarian market improvement guide](../README.md).
> Research date: **2026-08-24**. Companion implementation plan: [rfc.md](rfc.md).
> GDPR/ToS findings from the same research live in [08-privacy-gdpr/research.md](../08-privacy-gdpr/research.md);
> willingness-to-pay context in [10-growth-marketing/research.md §4](../10-growth-marketing/research.md).
> Unverified claims flagged ⚠️. Not legal or tax advice.

---

## 1. Charging money as a solo dev in Bulgaria (2026)

### Stripe — available, but you carry VAT
- Bulgaria is on Stripe's supported-country list with a direct BG registration flow. ⚠️ Whether BG onboarding accepts a plain individual with no ЕИК, or requires ЕТ/ЕООД data, is not clearly documented — verify in the actual signup flow.
- Stripe is a **payment processor, not a merchant of record**: you remain the seller, so EU B2C digital-services VAT is your problem (Stripe Tax computes it; you still register/file).
- EU fees: ~1.5% + €0.25 standard EEA cards, plus Billing/Tax add-ons pushing the effective rate up ~1%+.

### Paddle — onboards individuals, no company needed ← the practical winner
- Paddle explicitly does **not** require a legal entity — individuals pass identity verification only.
- Pricing: **5% + $0.50 per transaction, all-inclusive** (tax compliance, subscriptions, fraud). The flat $0.50 punishes sub-€5 subscriptions — price at €4–5+/month or push annual plans.

### Lemon Squeezy — open but in transition
- Acquired by Stripe (2024); still live and accepting signups in 2026, while successor **Stripe Managed Payments** is waitlist-only. ⚠️ BG-individual onboarding not explicitly documented. Given the transition, **Paddle is the more stable MoR bet right now**.

### What a merchant of record solves
The MoR is legally the reseller — two transactions occur (customer→MoR, MoR→you). The MoR calculates, collects, and remits VAT in 100+ jurisdictions and carries the tax risk. Your revenue becomes a single B2B payout stream — no OSS, no per-country VAT, no €10k threshold tracking.

### When must you register a business in Bulgaria?
- Recurring subscription revenue is **systematic commercial activity for profit** — under the Commerce Act this makes you a "trader by occupation"; NAP looks at substance, not labels.
- Even **without** registering, чл. 26, ал. 7 ЗДДФЛ taxes an unregistered de-facto trader like a sole trader: **15% on the ET base + social-security contributions**. You can't use the 10% freelancer regime for product sales. There is no fixed euro threshold — the trigger is regularity + profit intent.
- **ЕООД in 2026:** minimum capital effectively €1; state fee ~€28 online; realistic all-in €200–800 with an agent (full-service up to ~€1,500), plus **€120–200/month accounting**. ЕООД pays 10% corporate tax + 5% dividend withholding; ЕТ means unlimited personal liability and 15% — ЕООД is the standard choice.

## 2. EU VAT for a B2C SaaS

- An app subscription is a **TBE/digital service**: B2C sales to EU consumers are taxed at the *customer's* country rate once past the **€10,000/year EU-wide cross-border threshold**; then either register everywhere or use **OSS** (one quarterly return via NAP).
- **Bulgarian domestic threshold 2026: €51,130** (the former BGN 100,000) taxable turnover/calendar year. ⚠️ A rise to €85,000 in 2027 has been discussed.
- New since 2025: the **EU SME scheme** allows staying VAT-exempt on cross-border EU sales up to €100,000 EU-wide (and under €51,130 domestically) without OSS.
- ⚠️ Confirm with an accountant: Bulgarian businesses *buying* B2B services from EU suppliers (Google Ireland, SaaS vendors) generally need a limited **чл. 97а ЗДДС** registration and must self-assess 20% VAT on those purchases — separate from the €51,130 threshold and bites early.
- **A MoR sidesteps all of this** — you invoice only the MoR.

## 3. Freemium gate design (2026 best practice)

### What must stay free — the Splitwise-backlash lesson
Splitwise capped free users to ~3–5 expenses/day with cooldown timers and ads; it became the single biggest churn driver and spawned a cottage industry of "unlimited free" competitors. Therefore: **unlimited expense entry, unlimited groups/members, balances and settle-up stay free forever.** Group products live on network effects — every friend blocked from entering an expense poisons the whole group's experience.

### What converts — gate these
Exactly what Splitwise successfully sells: receipt scanning, charts/analytics, search, currency conversion, itemized splits, export.

- **Receipt-scan credits are the natural paid tier**: real marginal cost (LLM inference), obvious value, and credit/metered pricing is the 2026 default for AI features. Small free quota (3–5 scans/month), a visible counter, upgrade prompt at exhaustion. Never unmetered free AI.
- Secondary gates: CSV/PDF export, spending charts, long-history analytics (keep raw history *visible* — hiding people's own financial records reads as hostage-taking), itemized/OCR-assisted splits, advanced multi-currency.
- **Conversion benchmarks:** freemium converts ~2–5% typically; RevenueCat 2026 medians ~1.4–2.8% download-to-paid (top quartile 4–6%). Plan around **1–3%** for a consumer utility with a generous free core.

### Price point for Bulgaria
From [topic 10 §4](../10-growth-marketing/research.md): local subscription band is €3–6/month (Spotify ≈ €5.62; Netflix from €5.99); 61% of BG online shoppers still prefer cash on delivery, so card-on-file friction is real. Recommendation: **€4–5/month** headline with a strongly discounted annual (~€10–15/year feels "one-time-ish"), or a Splid-style one-time unlock for some gates. Paddle's $0.50 flat fee also argues for annual. Never monthly-only, never ads.

## 4. Cost floor at small scale (2026 numbers)

### Platform limits

| | Vercel Hobby | Vercel Pro ($20/seat) |
|---|---|---|
| Commercial use | **Prohibited** — payments/ads require Pro | Allowed |
| Cron | 2/project, 1×/day each | 40/project, any frequency |
| Function duration | short default (~10–60 s ceiling) | 60 s default, up to 300 s |
| Bandwidth | 100 GB | 1 TB included, then $0.15/GB |
| Image transformations | 5K/month (serve receipt images unoptimized!) | usage-based $0.05/1K |

**The moment you charge money, Hobby is off the table** — Vercel Pro $20/month is the first fixed cost. (The current app is on Hobby with the 1×/day cron limit baked into `vercel.json`.)

- **Neon free plan:** 0.5 GB storage, 100 CU-hours/month, scale-to-zero. Paid Launch ~$5–19/month typical at small scale (~$0.106/CU-hr). Note: receipt images stored as `bytea` in Postgres count against the 0.5 GB — ~1,700 scans at 300 KB fills it ([audit §9-10](../00-current-state-audit.md); moving images out of the DB is covered in [RFC 11](../11-reliability-scale/rfc.md)).
- **LLM per-scan cost** (~1500px receipt + ~700 output tokens):
  - Gemini 2.5 Flash-Lite ($0.10/M in, $0.40/M out; ~1,000–1,600 image tokens): ≈ **$0.0005/scan**. ⚠️ Slated for retirement Oct 2026 — plan on its successor at similar pricing.
  - Claude Haiku 4.5 ($1/M in, $5/M out; image ≈ W×H/750 tokens): ≈ **$0.006/scan**.
  - Either way **well under 1 eurocent** — a €4/month tier with 50 scans has ~99% gross margin on inference.
- **Email:** Resend free = 3,000/month (100/day) — enough until ~1,000 MAU; Pro $20 = 50k. Postmark free tier is test-only.

### Estimated monthly cost (⚠️ estimates from cited unit prices, not measured bills; ~3 scans + ~2 emails per MAU/month)

| MAU | Vercel | Neon | LLM | Email | **Total/month** |
|---|---|---|---|---|---|
| 100 | Pro $20 | $0 | $0.15–2 | $0 | **~$20–22** |
| 1,000 | $20–40 | $0–20 | $1.50–18 | $0 | **~$25–80** |
| 10,000 | $50–150 | $30–100 | $15–180 | $20 | **~$115–450** |

Sanity check: at 10k MAU, 2% conversion at €4/month ≈ €800/month revenue against ~$115–450 costs (before Paddle's 5% + $0.50 and accounting) — viable but thin. **Fixed costs (Vercel Pro + accountant) dominate until ~1k MAU.**

## Recommended path

1. **Paddle as an individual** from day one of charging: erases the EU VAT/OSS problem entirely. €4–5/month + discounted annual.
2. **Declare income from the start; incorporate ЕООД at roughly €500–1,000 MRR** — below that, ЕООД accounting costs (~€1,500–2,400/year) exceed the benefit, but NAP taxes systematic app revenue as trader income (15% + social security) even unregistered. One consultation with a Bulgarian accountant before first payout; ask specifically about чл. 97а ЗДДС.
3. **Freemium shape:** free = unlimited expenses/groups/settle-up + 3–5 scans/month. Paid = 50–100 scans, export, charts, itemized splits. No daily caps, no ads, ever.
4. **Move to Vercel Pro the day the paywall goes live** (Hobby prohibits commercial use — the one silent compliance trap in the current stack).
5. Expect a **~$20–25/month cost floor at launch**, ~$100–450/month at 10k MAU.

## Sources

<details><summary>Full source list (URLs)</summary>

**Payments / business:** https://stripe.com/global · https://www.cs-cart.com/blog/stripe-supported-countries/ · https://checkoutpage.com/blog/stripe-international-fees · https://www.paddle.com/help/start/account-verification/what-is-business-verification · https://help.boathouse.co/guides/beginners-guide-to-paddle/faq-can-i-sell-via-paddle-as-an-individual · https://www.paddle.com/blog/what-is-merchant-of-record · https://www.paddle.com/help/start/intro-to-paddle/how-paddle-is-able-to-take-on-your-vat-and-tax-responsibilities · https://churntools.com/blog/paddle-pricing · https://www.lemonsqueezy.com/blog/2026-update · https://docs.lemonsqueezy.com/help/getting-started/supported-countries · https://nra.bg/wps/portal/nra/taxes/godishen-danak-varhu-dohdite/oblagane.prodajbi.internet · https://www.tita.bg/free/taxes/517 · https://accountingnews.bg (ФЛ и е-търговия, art. 284) · https://innovires.com/tax-residency/blog/company-registration-bulgaria-cost.html · https://sofiaoffices.com/open-company-in-bulgaria/ · https://aidosbg.com/working-in-bulgaria-freelancer-vs-company-registration/
**VAT:** https://www.vatupdate.com/2026/02/10/bulgaria-comprehensive-vat-country-guide-2026/ · https://eurofast.eu/bulgaria-vat-reform-2026-what-businesses-need-to-know/ · https://aidosbg.com/vat-changes-bulgaria-2026/ · https://amavat.eu/vat-oss-threshold-explained-what-happens-after-e10000/ · https://www.geraldedelman.com/insights/eu-one-stop-shop-simplifying-vat-for-cross-border-digital-services/ · https://www.vatcalc.com/bulgaria/bulgaria-to-increase-vat-registration-threshold-2023-eu-approval/
**Freemium:** https://splittyapp.com/learn/splitwise-free-limits/ · https://splitterup.app/blog/splitwise-pro-worth-it · https://usefairsplit.com/blog/splitwise-pricing/ · https://www.revenuecat.com/state-of-subscription-apps · https://www.artisangrowthstrategies.com/blog/freemium-conversion-rate-benchmarks · https://dev.to/paywallpro/global-subscription-app-conversion-benchmarks-3c75 · https://dodopayments.com/blogs/ai-saas-monetization-2026 · https://flexprice.io/blog/best-credit-based-pricing-software-for-ai-companies · https://www.stigg.io/blog-posts/ai-pricing
**Costs:** https://vercel.com/docs/limits/fair-use-guidelines · https://vercel.com/docs/limits · https://www.fencode.dev/en/blog/vercel-free-vs-pro-2026-official-limits-pricing · https://crontap.com/blog/vercel-cron-hourly-limit-and-how-to-beat-it · https://neon.com/faqs/free-plan-limits-and-quotas · https://neon.com/docs/introduction/plans · https://vela.run/articles/neon-serverless-postgres-pricing-2026/ · https://ai.google.dev/gemini-api/docs/pricing · https://devtk.ai/en/models/gemini-2-5-flash-lite/ · https://www.stackscored.com/pricing/transactional-email/resend/ · https://nuntly.com/versus/resend-vs-postmark · Claude Haiku 4.5 pricing verified against Anthropic's model pricing table.

</details>
