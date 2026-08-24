# Topic 10 — Competitive Landscape, Positioning & Growth: Research

> Part of the [Bulgarian market improvement guide](../README.md).
> Research date: **2026-08-24**. Companion implementation plan: [rfc.md](rfc.md).
> Claims that could not be verified are flagged ⚠️.

---

## 1. Competitive landscape in Bulgaria

### Splitwise (market leader, wounded)
- **Pricing:** freemium. Free tier capped at roughly **3 expense entries per calendar day** across all groups (exact cap unpublished, ~3–5 observed), shows **ads**, and keeps **receipt scanning, charts, search, itemization and currency conversion behind Pro**. Pro is **$4.99/month**; annual reported $39.99–59.99/year depending on source/date. ⚠️ Exact EUR App Store price in Bulgaria unverified.
- **Bulgarian localization: NO.** Supported: English, Dutch, French, German, Indonesian, Italian, Japanese, Polish, Portuguese, Spanish, Swedish, Thai.
- **User complaints:** the daily cap hitting mid-dinner/mid-trip is the #1 complaint; Trustpilot reported at **1.8/5 with ~65% one-star reviews** (March 2026).

### Tricount (bunq) — strongest European rival
- **Pricing:** since app v8.0 under bunq, **Premium was discontinued and the app is fully free** — but bunq also **removed former premium features** (CSV/PDF export, expense sorting, custom split templates) rather than unlocking them, and pushes bunq bank accounts/cards.
- **Scale:** ~5.4M users at 2022 acquisition; users split **€16.4B in 2024**. Core markets: FR/BE/ES/DE/IT. ⚠️ No Bulgaria-specific numbers; anecdotally low visibility in BG.
- **Bulgarian localization: YES** — Bulgarian is on Tricount's official language list. The only localized big-name competitor.
- **Weaknesses:** post-v8.0 feature removals angered legacy users; increasingly a bunq acquisition funnel; no receipt OCR in the free flow.

### Settle Up (Czech)
- **Pricing:** freemium with **ads (banners + interstitials)** on free; Premium ~$20/year. Free lacks recurring transactions.
- **Bulgarian localization: NO** (public Weblate lists ~40 languages, no Bulgarian).
- **Weaknesses per reviews:** un-closeable ads, unsolicited "settle up" emails to friends, "absurdly expensive," unintuitive redesign. Praised for offline mode.

### Splid (German, solo developer)
- **Pricing:** free core; **one-time ~$4.99** unlocks unlimited groups + export — the only non-subscription paid model among the big names.
- **Bulgarian localization: NO.**
- **Weaknesses:** **no web app** (everyone must install), no receipt scanning, limited advanced features.

### SettleKing
- A US/India-oriented AI-fintech platform (remittances), **not** a European splitting-app peer. Irrelevant for Bulgaria.

### Bulgarian local competitors
- **Смят.AI / Smyat.AI (smetkata.live)** — the one true local player found: a **Bulgarian-language receipt-scanning bill splitter**. Photograph the receipt (or add items manually), share a link, each person ticks their items **in the browser (no install for guests)**, amounts in EUR. Android app live, iOS "coming soon", currently appears free. ⚠️ Team, funding, traction unknown — small/new. Closest direct competitor; validates the BG-first-web-splitter niche. Notably it covers *one receipt at a time* — not an ongoing group ledger with balances and debt simplification.
- **Splitly** — a trivial tip/bill calculator on Google Play; not a group-ledger app.
- **Viber Pay (Rakuten Viber)** — the sleeping giant. **Launched in Bulgaria February 2026** (ninth European market), enabled by euro adoption: wallet-to-wallet transfers in chat, free in EUR, bank transfers to local accounts. Viber Pay already has **group payments / bill splitting** (even/custom splits, up to 249 members) in its global feature set. ⚠️ Whether group-split is fully live for BG wallets in Aug 2026 is unverified. Crucially, it settles *payments*, not ongoing *ledgers* — no running balances across a trip, no netting over weeks. **No competitor found doing Splitwise-style debt simplification in Bulgarian.**

## 2. The Splitwise pricing backlash

- **Gated on free (2026):** ~3 expenses/day; receipt scanning Pro-only; ads; itemization, charts/search, currency conversion Pro-gated. The cap arrived in **2023** with no notice, framed as a "rate limit."
- **Price:** $4.99/month; annual $39.99→$59.99/yr in 2026 sources. $59.99/yr ≈ €57 ≈ **4% of one month's average Bulgarian net salary** — steep locally.
- **Fallout:** 1.8/5 Trustpilot, one-star floods, and a cottage industry of "Splitwise alternative" apps (splitty, Spliit, GoodShare, Fairsplit, Splital, Kittysplit) all marketing "no daily limits, no ads."
- **Opportunity:** the market leader trained millions on the workflow, then broke trust at the exact moment of use. Free-unlimited entry + free receipt scanning attacks the two most-hated gates; in Bulgaria the attack is stronger still — Splitwise has **no Bulgarian UI** and a US-tuned price.

## 3. Bulgarian consumer habits relevant to group expenses

- **Restaurants:** both patterns coexist — "всеки си плаща своето" (each pays their own) and equal splits; separate payment at the table is routinely tolerated by waiters, and since 2024 restaurants must have POS terminals, easing card-splitting. Inviter-pays applies to formal invitations. ⚠️ Directionally supported by etiquette articles, not quantified by survey.
- **Where a ledger app matters:** the one-off restaurant bill is largely solved socially. The pain concentrates in **multi-day, multi-payer contexts**: Bansko/Borovets ski weekends, seaside vacations, Greece road trips (a mass Bulgarian summer pattern — and 2026 is *the first same-currency summer* in Greece), bachelor/ette parties, and student flatshares in Sofia/Plovdiv/Veliko Tarnovo. ⚠️ The "обща каса" (common cash pot) trip tradition is culturally well known but unverified by sources. Tricount's data: travel/transport/groceries are the top splitting categories Europe-wide.
- **Messaging: Viber is still #1 in Bulgaria in 2026** (one of a handful of such countries: BG, Greece, Serbia, Belarus) with **~90% market-share claims**, 2.3–3M active users through 2025; Messenger ~3.8M registered BG users; WhatsApp/Telegram trail. **Implication: share/invite must be Viber-first** (deep links + link previews that render well in Viber), Messenger second. Viber Pay's BG launch makes "settle via Viber Pay" a plausible future CTA.
- **Currency context:** euro since 1 Jan 2026; people still mentally double-convert in 2026 — a **лв.↔€ dual display** is a cheap, locally resonant feature no global competitor bothers with (details in [01-euro-transition/research.md](../01-euro-transition/research.md)).

## 4. Willingness to pay

- **Income anchor:** average gross salary Q1 2026 ≈ **€1,400/month** (NSI); minimum wage €550–620 gross.
- **Reference subscriptions in BG (2026):** Netflix €5.99/€8.99/€10.99; Spotify Premium ~€5.62/month. The local "acceptable app subscription" band is **€3–6/month** and utility apps sit at the bottom of it. A €5/month splitter competes with all of Spotify — a losing frame.
- **Payment-culture caution:** **61% of BG online shoppers still prefer cash on delivery** vs 35% card — card-on-file subscription friction is real. ⚠️ No published survey on BG app-subscription willingness specifically; inference: freemium with a **cheap annual price (€9.99–14.99/year) or a Splid-style one-time unlock** converts better than monthly; ads are tolerated but hated (see Settle Up's reputation).

## 5. Distribution channels (low budget)

- **Facebook is unchallenged:** **4.5M BG users (67.6% of population, Dec 2025)**; largest cohort 25–34. Niches: travel groups (Greece vacation, ski), student housing/flatshare groups, Erasmus. ⚠️ Specific group names/sizes unverified.
- **Meta ads among Europe's cheapest:** BG e-commerce CPM ≈ **$4.21** (Germany $9.05, US $16.08, Romania $5.38). A few hundred € buys meaningful reach targeting Greece/Bansko travel + student interests.
- **BG-Mamma:** still Bulgaria's most influential forum community; native-advertising formats; strong word-of-mouth (family budgets, vacations, shared household costs threads).
- **Reddit r/bulgaria:** ~361k members (Aug 2026), young/urban/tech, English-tolerant — good for an honest "I built this" launch post.
- **Kaldata:** largest BG tech portal — ~50k unique visits/day, 310k registered forum users — good for a review/launch article.
- **SEO — the striking finding:** searches for "разделяне на сметки приложение" and "споделени разходи приложение" return **no strong Bulgarian-language content** — just bank bill-pay pages, a defunct 2015 article, a Play-Store listing, and Smyat.AI. Even "Splitwise алтернатива" surfaces **Russian**, not Bulgarian, content. ⚠️ US-datacenter SERPs — verify on google.bg. Signal: **2–5 well-written BG articles could own this SERP cheaply** ("Как да разделите разходите от почивката в Гърция", "Splitwise на български — алтернативи 2026", "Приложение за общи разходи със съквартиранти"). Also target BG-language competitor brand queries ("Splitwise", "Tricount").
- Other: university FB groups, AIESEC/ESN Erasmus networks (⚠️ unverified reach); predpriemach.com for founder-community feedback.

## 6. Trust factors

- **Low institutional trust:** only 16% of Bulgarians report high trust in central government (OECD 2025, lowest tier) — trust must be earned peer-to-peer, not claimed institutionally.
- **Data anxiety without data literacy:** Bulgarians ranked **lowest in the EU** on feeling in control of their data (48%) and on knowing GDPR rights (19% know what GDPR is). ⚠️ 2019 Eurobarometer, latest found. Takeaway: a short, plain-Bulgarian "Данните ви са ваши" page beats legalistic boilerplate; explicitly state "no bank access, no card required — the app only *counts*, it doesn't *touch money*."
- **Cash culture & fraud fear:** 61% COD preference persists; social-engineering fraud is a 2025–26 theme; the euro period bred price-gouging suspicion. A ledger-only app is an *easier* trust sell than a wallet — say so.
- **Language quality as trust proxy:** machine-translated Bulgarian is instantly detected and coded as scam/foreign. Native-quality copy, correct Cyrillic typography, лв./€ handling, and a visible Bulgarian founder identity ("направено в България") are strong, cheap trust signals. ⚠️ Inference from localization practice, no BG-specific study.
- **Known-brand shortcuts:** press in Kaldata/Capital/DevStyleR; association with brands Bulgarians trust daily (Viber above all).

## Positioning recommendations

1. **Attack Splitwise's two hated gates head-on:** *"Неограничени разходи. Безплатно сканиране на бонове. Без реклами."* Free unlimited expense entry forever; receipt scanning free at least at a generous quota (Pro-only at Splitwise, absent from every competitor's free flow). Bulgarian fiscal-receipt OCR quality is a moat no global player will build for a 6.4M-person market — and Smyat.AI proves the niche while lacking the ledger.
2. **Be web-first and guest-friendly** — the existing advantage. "Домакинът създава групата, праща линк във Viber, никой друг не инсталира нищо" collapses the group-adoption barrier that kills splitting apps.
3. **Viber-native sharing** — invite links designed for Viber (deep link + rich preview), Messenger second. Position as the *ledger* that complements Viber Pay's *payments* ("пресметни тук, плати във Viber Pay"), not its competitor.
4. **Own the euro-transition moment:** dual €/лв. display; content around "първото лято с евро" group trips to Greece.
5. **Monetization for BG wallets:** core free forever; charge for comfort, not use — **€9.99–14.99/year** or a one-time unlock (unlimited OCR, exports, recurring, history depth). Never monthly-only, never interstitial ads. (Details: [09-monetization/research.md](../09-monetization/research.md).)
6. **Distribution sequencing:** (a) BG SEO articles into the empty SERP; (b) r/bulgaria + Kaldata solo-dev launch posts; (c) seasonal Meta ads (CPM ~$4) timed to July–August seaside/Greece and December–February Bansko; (d) BG-Mamma native thread (family budget/vacation angle); (e) student flatshare groups in September.
7. **Trust page in plain Bulgarian:** no bank connection, no money touched, data in the EU, delete-everything button.

## Sources

<details><summary>Full source list (URLs)</summary>

- Splitwise limits/pricing/backlash: https://splittyapp.com/learn/splitwise-free-limits/ · https://usefairsplit.com/blog/splitwise-pricing/ · https://www.areweeven.com/blog/splitwise-free-vs-pro-2026 · https://split-circle.com/en/blog/splitwise-daily-limit · https://splitterup.app/blog/splitwise-pro-worth-it · https://x.com/ArtemR/status/1740150704268849568 · https://viewappprice.com/en/apps/splitwise · https://feedback.splitwise.com/forums/162446-general/suggestions/11147898
- Tricount: https://help.tricount.com/articles/what-happened-with-tricount-premium · https://help.tricount.com/articles/use-the-tricount-app-in-a-language-of-your-choice · https://goodshare.app/blog/tricount-alternatives/ · https://countclub.app/en/compare/tricount-vs-countclub · https://www.pymnts.com/acquisitions/2022/neobank-bunq-acquires-belgian-fintech-tricount-adding-5-4m-users/ · https://press.bunq.com/246589-from-roommates-to-road-trips-tricount-tallies-16-4-billion-shared-in-2024/
- Settle Up / Splid: https://justuseapp.com/en/app/737534985/settle-up-group-expenses/reviews · https://translate.settleup.io/projects/settle-up/ · https://www.areweeven.com/blog/free-expense-splitting-apps · https://splittyapp.com/learn/splitwise-vs-splid-vs-settleup/ · https://justuseapp.com/en/app/991473495/splid-split-group-bills/reviews · https://hipposplit.com/blog/best-expense-splitting-apps/ · https://splital.com/best-expense-splitting-apps · https://www.malavida.com/en/soft/splid/android/
- Local BG: https://smetkata.live/ · https://www.settleking.com/
- Viber / Viber Pay: https://www.capital.bg/biznes/fintech/2026/02/09/4881042_chatut_stava_portfeil_viber_pay_trugva_v_bulgariia/ · https://www.mediapool.bg/viber-pay-za-razplashtaniya-mezhdu-potrebiteli-tragva-v-bulgaria-news380067.html · https://fintechbulgaria.com/viber-pay-bulgaria/ · https://help.viber.com/hc/en-us/articles/18288951398045-Group-payments · https://www.viber.com/en/blog/2024-11-07/group-payments-made-simple-split-bills-and-collect-payments-effortlessly-with-viber-pay/ · https://www.infobip.com/blog/most-popular-messaging-apps-by-country · https://sensortower.com/blog/2025-q4-android-top-5-communication-apps-revenue-bg-6070aae1241bc16eb81f5bab
- Habits/etiquette: https://ladyzone.bg/recepti/idei/koj-plashta-smetkata-v-zavedenie.html · https://bg.dobrblog.com/articles/plashhane-na-smetki-v-restoranta.html · https://www.burgas24.bg/novini/Bylgaria/Zavedeniyata-veche-tryabva-da-imat-POS-terminal-za-plashtane-s-karta-2024772
- Economy: https://www.nsi.bg/press-release/naeti-lica-i-sredna-rabotna-zaplata-i-trimesechie-2026-godina-9022 · https://suma.bg/minimalna-rabotna-zaplata-2026/ · https://webcafe.bg/seriali/netflix-obyavi-novite-tseni-na-abonamentnite-si-planove-v-balgariya.html · https://www.spotify.com/bg-bg/premium/ · https://www.novinite.com/articles/226026/
- Channels: https://stats.napoleoncat.com/social-media-users-in-bulgaria/2025/ · https://www.novinite.com/articles/231489/ · https://datareportal.com/reports/digital-2025-bulgaria · https://lebesgue.io/facebook-ads/facebook-cpm-by-country · https://www.accio.com/biz-cheap/low-cost-facebook-ads-countries · https://neg.bg/novini/uspeshni-neytiv-reklamni-formati-v-bg-mamma/ · https://gummysearch.com/r/bulgaria/ · https://corp.kaldata.com/about-us/
- Trust: https://www.oecd.org/en/publications/oecd-survey-on-drivers-of-trust-in-public-institutions-2026-results_c88c8869-en/bulgaria_31bcfcc8-en.html · https://sofiaglobe.com/2019/06/13/eurobarometer-poll-bulgarians-among-least-informed-on-gdpr-rights/ · https://digipay.bg/en/blog/bulgaria-with-more-recommendations-for-money-laundering/
- Euro context: https://www.bta.bg/en/news/economy/1033496 · https://en.wikipedia.org/wiki/Adoption_of_the_euro_in_Bulgaria

</details>

**Key unverified items (⚠️):** exact Splitwise EUR price in BG; Viber Pay group-split live status in BG; quantified BG bill-splitting norms and "обща каса" culture; specific FB group names/sizes; google.bg SERP confirmation; GDPR-awareness data is from 2019.
