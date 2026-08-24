# Money Assistant → Bulgaria: Improvement Guide

> **What this is:** the master guide for taking Money Assistant from a working
> Splitwise-style side project to a product Bulgarians actually adopt — calibrated to the
> owner's decisions: **web-only for now** (native maybe later), **freemium from the
> start**, **payment deep-links/QR only** (no money ever moves through the app),
> **side-project budget** growing into a small advertised launch, **GDPR on the radar**.
>
> Produced 2026-08-24 from a full codebase audit ([00-current-state-audit.md](00-current-state-audit.md))
> plus web-verified market research. Each improvement area below links to a **research
> doc** (the evidence) and an **RFC** (an implementation plan written for a future LLM
> implementer). Nothing in this package changes code.
>
> **Implementation status:** a first "personal project" batch shipped on 2026-08-24 —
> the P0 euro fix, locale-correct money parsing/formatting, DB transactions, PWA
> installability, and first-run/engagement polish (a paid-LLM switch was made and then
> reverted by owner decision — receipt scanning stays on free models). See
> [IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md) for exactly what was built, deviations
> from the RFCs, and what remains; affected RFCs carry status stamps.

---

## 1. The thesis: why Bulgaria, why now

Five independently verified facts make late 2026 an unusually good moment:

1. **The market leader is wounded and absent.** Splitwise caps free users at ~3
   expenses/day, gates receipt scanning behind Pro (~$5/month — Spotify money in
   Bulgaria), shows ads, sits at 1.8/5 on Trustpilot — and has **no Bulgarian
   localization at all**. Tricount (the only localized big-name rival) stripped its
   power features after the bunq acquisition. No competitor offers Splitwise-style
   ledger + debt simplification in Bulgarian. ([topic 10 research](10-growth-marketing/research.md))
2. **The euro changeover created new behavior and a broken incumbent-free niche.**
   Bulgaria adopted the euro on 2026-01-01; people still mentally convert to leva; summer
   2026 was the first same-currency Greece vacation season. Meanwhile the changeover
   *broke this very app* (see P0 below) — and it will have broken others' BGN handling
   too. ([topic 01 research](01-euro-transition/research.md))
3. **The Bulgarian-language SEO space is empty.** Searches like „разделяне на сметки
   приложение" return bank bill-pay pages and one small local receipt-splitter
   (Смят.AI — which validates the niche but has no ledger). A handful of good articles
   could own the SERP. ([topic 10 research §5](10-growth-marketing/research.md))
4. **The app's architecture already fits the market.** Web-first + invite links + virtual
   members = "домакинът праща линк във Viber, никой не инсталира нищо" — exactly right
   for a Viber-dominated (~90% share), install-averse market. Competitors require
   everyone to install an app.
5. **The differentiator is already half-built.** LLM receipt scanning tuned on Bulgarian
   fiscal receipts (Billa/Fantastico quirks are in the code today) is a moat no global
   player will build for a 6.4M-person market — and it's the natural paid tier at ~99%
   gross margin. ([topic 04 research](04-receipt-scanning/research.md))

**Positioning in one line:** *„Неограничени разходи. Безплатно сканиране на бонове. Без
реклами."* — free unlimited core forever (the anti-Splitwise promise), Bulgarian-first
quality everywhere, scan credits as the paid tier.

## 2. The one P0: the app is currently wrong for its target market

The ECB removed BGN from its reference rates on 2026-01-02. The app resolves BGN through
those rates, and **silently excludes any expense it can't convert from all balance math**
(`group-data.ts:168`). Consequence: a Bulgarian group with BGN history — or a BGN base
currency — shows **wrong balances today**, with only a small per-row chip as a signal.
There is no fixed-rate concept in the code (1.95583 appears only in test fixtures).

**[RFC 01](01-euro-transition/rfc.md)** fixes this: hardcoded legal conversion
(÷ 1.95583, half-up, per amount — the only lawful method), missing-rate expenses surfaced
loudly instead of dropped, BGN retired from new entry, BGN groups migrated to EUR, an
optional „≈ лв." reference display, and Sofia-timezone date defaults. Stages 1–2 are the
bug fix and should ship before anything else in this guide.

## 3. The eleven improvement areas

| # | Area | Priority | Research | RFC |
|---|---|---|---|---|
| 01 | Euro changeover & BGN correctness | **P0** | [research](01-euro-transition/research.md) | [rfc](01-euro-transition/rfc.md) |
| 02 | Localization correctness (numbers, parsing, audit log) | P1 | [research](02-localization/research.md) | [rfc](02-localization/rfc.md) |
| 03 | Settle-up payment helpers (IBAN card, blink, Revolut, EPC QR) | P1 | [research](03-settle-up-payments/research.md) | [rfc](03-settle-up-payments/rfc.md) |
| 04 | Receipt scanning: paid models, BG receipts, eval, metering | P1 | [research](04-receipt-scanning/research.md) | [rfc](04-receipt-scanning/rfc.md) |
| 05 | PWA installability, offline shell, webview-proof invites | P2 | [research](05-mobile-pwa/research.md) | [rfc](05-mobile-pwa/rfc.md) |
| 06 | Onboarding, auth options, invite/join funnel, settings screen | P1–P2 | [research](06-onboarding-auth/research.md) | [rfc](06-onboarding-auth/rfc.md) |
| 07 | Notifications & engagement (in-app, email, push triggers) | P2 | [research](07-notifications-engagement/research.md) | [rfc](07-notifications-engagement/rfc.md) |
| 08 | GDPR: deletion, export, policies, retention | **P1 (launch-gating)** | [research](08-privacy-gdpr/research.md) | [rfc](08-privacy-gdpr/rfc.md) |
| 09 | Freemium monetization (Paddle MoR, scan credits, entitlements) | P2 | [research](09-monetization/research.md) | [rfc](09-monetization/rfc.md) |
| 10 | Positioning, landing page, SEO, community launch, ads | P2 | [research](10-growth-marketing/research.md) | [rfc](10-growth-marketing/rfc.md) |
| 11 | Reliability & scale (transactions, rate limits, observability, CI) | P1 parts | [research](11-reliability-scale/research.md) | [rfc](11-reliability-scale/rfc.md) |

### 01 · Euro changeover (P0)
Covered in §2 above. Also owns: rate-gap repair after missed crons, the earliest-row
fallback that silently gives 2024 expenses 2026 rates, and UTC "today" being yesterday
in Sofia between 00:00–03:00.

### 02 · Localization correctness (P1)
The words are already native-quality (~440 keys, idiomatic Bulgarian, „…" typography,
build-enforced completeness) — but the **numbers are American**: `formatCents` hardcodes
`en-US` (`€12.34` instead of `12,34 €` on every screen of a money app), and `parseAmount`
rejects `1 234,56` while **silently misparsing `1.234` as 1.23**. The activity log
freezes English diff strings into the database. Research includes live-verified `Intl`
outputs for `bg`; the RFC delivers locale-aware formatting, a deterministic EU-style
amount parser, structured `{key, params}` audit-log fragments (legacy strings rendered
verbatim), Accept-Language default locale (Bulgarian visitors currently land in English),
and a localized `<title>`. Cheap, high-trust — language quality is a verified trust proxy
in this market.

### 03 · Settle-up payment helpers (P1)
Settle-up records payments but doesn't help anyone pay. Research (all live-verified):
Revolut has 1.3M Bulgarian users (~22% penetration) but `revolut.me` links can't carry an
amount; **blink P2P** reaches every major bank free ≤ €150 but has **no deep-link API**;
**no Bulgarian bank app scans EPC QR yet** (bank QRs are proprietary); Settle Up's
open-source pay-via-bank-app pattern is the replicable architecture. The RFC therefore
ships helpers in reach order: per-user payment profile (IBAN + name + blink phone +
Revolut tag, visible to co-members) → copyable **bank-transfer card** + pre-composed
Viber share message → blink instruction card → Revolut link → EPC QR (client-side,
~30 lines, future-proof bet). An empirical pre-ship checklist covers the ⚠️ unknowns.

### 04 · Receipt scanning — the differentiator (P1)
The pipeline is genuinely good (dedupe, reconciliation, Bulgarian-chain heuristics,
review-first UX) but runs on **free OpenRouter endpoints that may train on users'
receipts** — the code's own comments say to change this before real users. The RFC:
paid/EU-friendly model migration (every candidate costs **< 1 eurocent/scan**), prompt +
schema upgrades for the three receipt-currency eras (BGN → dual → EUR-only) with the
printed-1.95583 dual-total as a free validation signal, VAT groups А/Б/В/Г, a golden-set
eval harness with recall/reconcile thresholds (only 6 fixture cases exist today),
unit-level splitting for "3 × беер", scan metering (the foundation RFC 09 bills on), and
delete-image-after-convert by default (the GDPR-critical retention fix).

### 05 · PWA & webview-proof invites (P2)
Responsive foundation is solid; installability is zero (no manifest, no icons beyond
favicon.ico, no service worker). The RFC adds manifest + icons + a minimal Serwist
service worker (strict never-cache contract for actions/API), an engagement-gated install
prompt, dark mode as a token refactor — and the sleeper issue: **invite links opened in
Viber's in-app browser can dead-end at Google OAuth** (`disallowed_useragent`). The
"open in browser" escape hint on `/join` and `/login` is flagged ship-first because all
growth traffic arrives through exactly that path.

### 06 · Onboarding, auth & the join funnel (P1–P2)
Android is ~76% of the Bulgarian market so Google-only login filters less than feared —
but abv.bg-webmail users and iOS holdouts exist; **email magic links** are the right
addition (the RFC found a real landmine: the sign-in upsert would null-wipe Google
name/avatar on first magic-link login). Also: collapse the double-empty-state first run,
template chips, Bulgarian-first login page with a trust strip, invite upgrades (Web Share
→ Viber, QR, OG tags on `/join`, pre-auth invite preview), and the **account settings
screen** — the shared mount point that RFCs 01 (leva toggle), 03 (payment details),
07 (notification prefs) and 08 (delete account) all need.

### 07 · Notifications & engagement (P2)
There is zero notification infrastructure. Ship in-app first (bell + per-group unread
watermark on the existing activity log — no external deps), then Resend email with a
**digest-by-default** policy: only added-to-group and *user-initiated* „напомни"
reminders send immediately — the explicit anti-Settle-Up stance (their unsolicited debt
emails earned 1-star floods). Requires a `users.locale` column (a recipient's language
can't come from the sender's cookie). Push triggers reuse the same table once RFC 05's
service worker lands.

### 08 · GDPR (P1 — gates the launch)
Today: no account deletion (Art. 17 impossible), no export, no policies, receipt images
kept forever and sent to training-permitted US endpoints, emails denormalized into
activity logs visible to whole groups. The good news: no cookie banner needed
(essential-only cookies), no DPO, complaint-driven regulator. The RFC's core engineering:
**account deletion with honest shared-data semantics** (detach-to-virtual preserves other
members' ledgers — an Art. 17(3) balancing argument; owned groups block deletion with a
transfer-or-delete resolution flow; immediate hard delete because the sign-in upsert
would resurrect soft-deleted users), JSON export, activity-log tombstones, policy-page
outlines (bg-first, plain language — 19% of Bulgarians know what GDPR is; „данните ви са
ваши" beats legalese), and the image-purge backfill. **Sequencing rule: policies ship
with or after the deletion/export they promise, and all of it before any marketing push.**

### 09 · Freemium monetization (P2)
The verified path for a Bulgarian solo dev: **Paddle as merchant-of-record onboards
individuals without a company** and erases the entire EU VAT/OSS problem; declare income
from day one and incorporate ЕООД around €500–1,000 MRR (NAP taxes systematic revenue as
trader income regardless). Pricing for local wallets: **€4.49/month / €14.99/year**,
free tier = unlimited everything + ~5 scans/month, Plus = 100 scans + export + charts.
The "unlimited expenses free forever" promise is written into the entitlements file as a
constraint comment. Metering fails open, cancellations downgrade at period end, payers
get a 72h grace on webhook failures. **Two silent traps:** Vercel Hobby prohibits
commercial use (flip to Pro ~$20/month the day checkout ships), and the `:free` LLM
endpoints must be gone before anyone pays. Cost floor: ~$20–25/month at launch,
~$115–450/month at 10k MAU vs ~€800/month revenue at a 2% conversion — thin but viable.

### 10 · Growth & launch (P2)
Engineering half: a real public landing page (today `/` just redirects to login) —
Bulgarian-always at `/`, English at `/en` (deliberate: Accept-Language negotiation would
show Googlebot English and forfeit the empty bg SERP), OG images, sitemap/robots, share
payload templates, rewards-free `?ref=` attribution. Playbook half (drafted, in
Bulgarian): r/bulgaria (~361k) and Kaldata solo-dev launch posts, BG-Mamma
family-vacation angle, student flatshare groups in September, a €150 Meta ads test (BG
CPM ≈ $4.21, among Europe's cheapest; kill threshold CPA > €8). Seasonal windows:
**September students → Dec–Feb Bansko → Jul–Aug seaside**.

### 11 · Reliability & scale (P1 parts)
Launch blockers before charging money: **transactions** (`withTransaction` over the Neon
WebSocket driver with PGlite parity — today `saveExpense` can be killed mid-flight and
leave an expense with no payers, which the balance math then skips), **rate limiting**
(in-Postgres sliding window on the four hot actions incl. LLM spend), and **Sentry**
through the existing error choke-point. Then: CI on the four existing test scripts, CSP/
HSTS, `CRON_SECRET` required in prod, the `Permissions-Policy: camera=()` footgun,
cron-failure pings, cookieless analytics (keeps the no-banner status), image-store
abstraction (bytea → blob adapter; ~1,700 scans would fill Neon's free 0.5 GB),
backups, and pagination — with honest math on when each actually matters.

## 4. Sequenced roadmap

Dependencies that force the order: RFC 06's settings screen is needed by 01/03/07/08 ·
RFC 07's email infra is needed by 06's magic links · RFC 05's service worker is needed by
07's push · RFC 04's metering is needed by 09 · RFC 08's policies gate 09's billing and
10's launch · Vercel Pro is required the day 09 ships.

**Phase 0 — stop being wrong (days).**
RFC 01 stages 1–2 (fixed-rate conversion + missing-rate safety) · RFC 04 stage 1 (paid
LLM endpoint) · RFC 11 (a) transactions on the mutation paths.

**Phase 1 — local fit & trust (weeks).**
RFC 02 (locale numbers/parsing/audit log) · RFC 01 remainder (BGN retirement, group
migration, leva toggle) · RFC 03 (payment helpers) · RFC 04 (eras, eval harness,
metering foundation, image retention) · RFC 08 (deletion, export, policies, consent) ·
RFC 06 stages 1–4 (invite/first-run, settings screen) · RFC 11 (b)(c1) rate limits +
Sentry.

**Phase 2 — app-likeness & engagement (weeks, overlaps Phase 1 tail).**
RFC 05 (manifest/SW/install/webview escape — webview hint can ship in Phase 1) ·
RFC 07 (in-app bell → email digests → reminders) · RFC 06 magic links · RFC 11 (d)(e)
CI + hardening.

**Phase 3 — monetize & launch (when Phases 0–1 are done).**
RFC 09 (entitlements → Paddle sandbox → checkout; Vercel Pro flip) · RFC 10 (landing +
SEO articles → community launch → €150 ads test), timed to the nearest seasonal window.
RFC 11 (f)(h) image store + backups as usage grows.

A solo developer working evenings can realistically land Phase 0 in under a week;
Phases 1–2 are a couple of months of steady work; Phase 3 is mostly operational. The
nearest high-leverage marketing window is **September (student flatshares)** — but
launching into it before Phase 1's trust work is done would burn the one first
impression the community channels allow.

## 5. What was deliberately left out

- **Native/wrapped mobile app** — owner decision: web-only for now. RFC 05 is the ceiling.
- **Payment initiation / open banking (IRIS, Tink-style PIS)** — breaks the no-money-movement
  constraint and pulls in licensing; documented on the long-term radar in topic 03.
- **Viber Pay integration** — no public API today; positioned as complement ("пресметни
  тук, плати във Viber Pay"), re-check in 12 months alongside blink eCommerce/EuroPA.
- **Ads as monetization** — rejected; the Settle Up reputation wound is the evidence.

## 6. Open items to resolve empirically (the ⚠️ ledger)

Highest-value unknowns collected from the research docs:

1. Does the Revolut app in Bulgaria scan a generated EPC QR? Does any undocumented
   `revolut.me` amount parameter work? (topic 03 — pre-ship checklist)
2. Verify the empty „разделяне на сметки" SERP on google.bg from a Bulgarian
   IP before writing articles. (topic 10)
3. Does Stripe's BG onboarding accept individuals without ЕИК? (moot if Paddle; topic 09)
4. Viber in-app browser behavior on the real join → Google OAuth path, on-device. (topics 05/06)
5. One consultation with a Bulgarian accountant before first payout (чл. 97а ЗДДС,
   trader-income timing). (topic 09)
6. Whether Viber Pay group-splitting is fully live for BG wallets. (topic 10)

## 7. Document map

```
docs/bg-market/
├── README.md                        ← this guide
├── 00-current-state-audit.md        ← factual map of the app (commit 14963d2)
└── NN-topic/
    ├── research.md                  ← evidence: web-verified facts, sources, ⚠️ flags
    └── rfc.md                       ← implementation plan for a future LLM implementer
```

Every RFC is self-contained: problem with `file:line` refs (commit `14963d2` — re-locate
by symbol if drifted), goals/non-goals with explicit boundaries to neighboring RFCs,
design, an independently-shippable staged plan, concrete acceptance criteria, and
risks/alternatives. Research docs carry full source URL lists; anything unverifiable is
flagged ⚠️ rather than asserted.
