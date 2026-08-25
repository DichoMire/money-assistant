# RFC 10 — Growth & Marketing: Landing Page, SEO Surface, Viral Sharing & Launch Playbook

> **Status update (2026-08-26): code stages (1, 2, 3-scaffold) COMPLETE** — bg-always landing at `/` + `/en`, OG cards, hreflang/robots/sitemap, FAQ JSON-LD, blog registry+SSG pages, share payloads, `?ref=` → `users.signup_ref`. The playbook stages (SERP verification, articles, community posts, ads) and stage 6 (analytics events) are the owner's — [OWNER-CHECKLIST.md §8](../OWNER-CHECKLIST.md). Landing copy lives in a locally-typed dict (documented deviation). Details: [IMPLEMENTATION-LOG.md](../IMPLEMENTATION-LOG.md).

> Part of the [Bulgarian market improvement guide](../README.md).
> **Status:** Proposed · **Priority: P2 — after the correctness/localization/trust foundations
> (RFC 01 euro fix, RFC 02 formatting, RFC 08 privacy pages), but sequenced against the seasonal
> windows in [research.md §5](research.md): September students (imminent — today is 2026-08-24),
> December–February Bansko, July–August seaside.**
> **Audience:** this RFC is **part engineering, part marketing-operations playbook**. Engineering
> workstreams (a), (c) and the event definitions in (e) target a future LLM implementer with full
> repo access; playbook workstreams (b), (d) and the review cadence in (e) target the owner and
> involve **no code**. Each workstream is tagged `[code]` or `[playbook]`. Read
> [research.md](research.md) and [00-current-state-audit.md §1.3, §6](../00-current-state-audit.md)
> first. All file/line references are to commit `14963d2`; re-locate by symbol name if drifted.

## 1. Problem

The product has essentially **zero acquisition surface**:

1. **There is no landing page.** [src/app/page.tsx:12](../../../src/app/page.tsx) does
   `if (!session?.user?.id) redirect("/login")` — a logged-out visitor's first impression is the
   bare login card in [src/app/login/page.tsx](../../../src/app/login/page.tsx) (a `$` tile, one
   tagline, a Google button). Verified: login **is** the landing (audit §6).
2. **No social previews.** [src/app/layout.tsx:25-31](../../../src/app/layout.tsx) emits only
   `title: "Money Assistant"` (unlocalized) and a localized `description`. No `openGraph`, no
   `twitter`, no `metadataBase`, no OG image. A link pasted into Viber — the #1 Bulgarian
   messenger, ~90% share per research §3, and the app's **only** growth loop via invite links
   (audit §1.3) — renders as a naked URL.
3. **No SEO surface.** No `robots.ts`, no `sitemap.ts`, no hreflang, no `opengraph-image`, no
   public content of any kind (verified: none exist under `src/app/` or
   [public/](../../../public/), which holds only stock Next.js SVGs).
4. **No Bulgarian content** anywhere on the public web, while research §5 found the Bulgarian
   bill-splitting SERP essentially **empty** — the single largest free acquisition opportunity.
5. **No share mechanics beyond copy-to-clipboard** (audit §1.3: no Web Share API, no Viber deep
   link, no QR) and **no referral/channel attribution** of any kind.
6. **No analytics** (audit §9: "monitoring / analytics / error tracking: entirely absent") — even
   if any of the above shipped today, nothing could measure whether it worked.

Meanwhile the market moment is unusually good (research §1–2): Splitwise is wounded (daily caps,
1.8/5 Trustpilot, no Bulgarian), no competitor does Bulgarian-language debt simplification, and
the September student-flatshare window opens in ~2 weeks.

## 2. Goals / non-goals

**Goals**

- G1. A real, bilingual (bg-default) marketing landing page at `/` for logged-out visitors, with
  the three-punch positioning from research: *„Неограничени разходи. Безплатно сканиране на
  бонове. Без реклами."*
- G2. Links to the app unfurl with a branded card in Viber and Messenger.
- G3. A minimal but complete SEO surface: metadata, hreflang, `sitemap.xml`, `robots.txt`,
  FAQ structured data, and a home for Bulgarian articles targeting the empty SERP.
- G4. Localized share **payloads** (invite text, group-summary snapshot) that make every group a
  small distribution event in Viber.
- G5. Lightweight channel attribution (`?ref=`) so the owner learns which channel produces signups.
- G6. An ordered, copy-drafted launch playbook the owner can execute against the September window.
- G7. A defined acquisition funnel (6 events) ready to wire into RFC 11's analytics choice.

**Non-goals**

- Paid-tier pricing page and any pricing copy — → [RFC 09](../09-monetization/rfc.md)
  (research: [09-monetization/research.md](../09-monetization/research.md)). The landing may say
  "безплатно" about the free tier; it does not describe paid plans.
- OG tags / share button UI on `/join/[token]` — RFC 06 owns the join page and builds the invite
  share **button**; this RFC only defines the shared **payload** templates it consumes (§3c).
- Analytics tooling choice (cookieless requirement per
  [08-privacy-gdpr/research.md](../08-privacy-gdpr/research.md)) —
  → [RFC 11](../11-reliability-scale/rfc.md); this RFC **consumes** its event API (§3e).
- A rewards-based referral program (give-get credits) — deliberately deferred, justification in §3c.
- App-store presence, PWA installability, email marketing, press outreach beyond the launch posts.

## 3. Design / workstreams

### 3.1 (a) Public landing page `[code]`

#### Routing & rendering

- Keep `/` as the single entry point. In
  [src/app/page.tsx](../../../src/app/page.tsx), replace the logged-out `redirect("/login")` with
  rendering a new `<LandingPage locale="bg" />` server component; logged-in behavior (dashboard)
  is unchanged. Rationale vs. a separate marketing route: the root URL is what gets shared,
  printed, and ranked — it must carry the marketing content itself, not a redirect hop.
- **SSG note:** `/` cannot be fully static because it calls `auth()`. That is fine for SEO — what
  crawlers need is complete server-rendered HTML on first byte, which a dynamic server component
  provides (Googlebot has no session → gets the landing markup). The landing sections themselves
  are plain static JSX with zero client components except the language-suggestion banner and the
  FAQ accordion (which should be `<details>`/`<summary>` — no JS at all). Blog pages (§3.2) *are*
  SSG via `generateStaticParams`.

#### Language strategy (decision)

- **`/` is Bulgarian, always, for visitors without a locale cookie. `/en` is a second static
  route with the English version.** This trivially satisfies "bg default for bg-BG
  Accept-Language" and is deliberately stronger: content negotiation on `/` would show Googlebot
  (which sends no Bulgarian `Accept-Language`) the English page and forfeit the Bulgarian SERP —
  the exact opposite of the strategy. One URL = one language = deterministic canonical content.
- Visitors whose `Accept-Language` does **not** prefer `bg` see a slim dismissible banner on `/`:
  "This page is also available in English → /en". A returning user with `locale=en` cookie is
  offered the same banner pre-expanded (do **not** auto-redirect — redirect loops with shared
  links and crawlers are not worth it).
- Separately, fix the app-wide default (audit §6 friction #4): `getLocale()` in
  [src/lib/i18n-server.ts](../../../src/lib/i18n-server.ts) should fall back
  cookie → `Accept-Language` sniff (`bg*` → `bg`) → `en`, so a Bulgarian visitor who clicks
  through to `/login` or a `/join/<token>` link also lands in Bulgarian. Small, self-contained,
  belongs here because the landing CTA depends on it.

#### Page structure & copy (bg shown; en mirrors it — all strings go into the typed dictionary in [src/lib/i18n.ts](../../../src/lib/i18n.ts) under new `landing.*` keys, so the `Record<TKey, string>` type guarantees both locales stay complete)

1. **Hero**
   - H1: **„Общите разходи, пресметнати. Кой на кого колко дължи — без караници."**
   - Sub: „Групови разходи за почивки, квартири и излизания на едно място. Money Assistant смята
     балансите и предлага най-малкия брой преводи."
   - Three-punch strip (verbatim from research positioning #1, visually prominent):
     **„Неограничени разходи. Безплатно сканиране на бонове. Без реклами."**
   - CTA primary: „Създай група — безплатно" → `/login` (carries any `?ref=` through, §3.3).
     CTA secondary: „Виж как работи" (anchor to How-it-works).
   - Screenshot: group page with balances panel, Bulgarian UI, EUR amounts (take fresh screenshots
     **after** RFC 02's `formatCents` fix so amounts read `12,40 €`, not `€12.40`). Static
     `next/image` assets in `public/screenshots/`, proper `alt` text in both locales.
2. **How it works** — three steps, mirroring research positioning #2:
   „1. Създавате група и добавяте участниците. 2. Пращате линк във Viber — останалите се
   включват от браузъра, **без да инсталират нищо**. 3. Записвате разходите или снимате касовия
   бон — приложението поддържа баланса и показва кой на кого колко дължи."
3. **Feature grid** (6 tiles max): неограничени записи · сканиране на български бонове ·
   умно разделяне (поравно, проценти, дялове) · опростяване на дълговете (минимум преводи) ·
   лв./€ двойно показване (RFC 01 feature) · работи на телефон и компютър, без инсталация.
4. **Trust strip** (research §6 / positioning #7 — plain Bulgarian, not legalese):
   „**Без достъп до банкови сметки.** Приложението само смята — не пипа пари." ·
   „**Данните ви са в ЕС.**" · „**Изтриване на всичко по всяко време.**" ·
   link „Как пазим данните ви" → the privacy page from
   [RFC 08](../08-privacy-gdpr/rfc.md).
5. **Honest comparison strip** (one row, factual, no logos): „Splitwise ограничава безплатните
   записи и няма български език. Tricount няма сканиране на бонове. Тук и двете са безплатни."
   Keep claims verifiable against research §1–2; revisit quarterly.
6. **FAQ** — `<details>` accordions **plus** `FAQPage` JSON-LD (`<script type="application/ld+json">`
   rendered server-side). The questions double as keyword surface:
   - „Безплатно ли е приложението за разделяне на сметки?" — „Да. Записването на общи разходи е
     неограничено и безплатно, без реклами. Планираме допълнителни платени удобства, но основното
     остава безплатно."
   - „Трябва ли всички в групата да инсталират приложение?" — „Не. Money Assistant работи в
     браузъра — домакинът праща линк, останалите влизат директно."
   - „Как се разделят разходите от почивка или обща квартира?" — кратко: методи на разделяне,
     много валути, крайният баланс с минимум преводи.
   - „Имате ли достъп до банковата ми сметка?" — „Не. Не искаме банкови данни и не извършваме
     плащания — приложението само води сметките."
   - „Каква е разликата със Splitwise?" — „Splitwise ограничава безплатните записи (~3 на ден),
     държи сканирането на бонове в платения план и няма българска версия. Тук няма лимити и
     сканирането е безплатно."
   - „Работи ли с левове и евро?" — „Да — сумите могат да се показват и в двете, по фиксирания
     курс 1,95583."
7. **Footer**: links to privacy/terms (RFC 08), `/blog`, `/en` ↔ `/` language switch, „Направено в
   България" (trust signal per research §6), contact email.

#### Metadata `[code]`

In [src/app/layout.tsx](../../../src/app/layout.tsx) `generateMetadata()` (plus per-page overrides
on `/`, `/en`, `/blog/*`):

- `metadataBase: new URL(appBaseUrl())` reusing the helper in
  [src/lib/invites.ts](../../../src/lib/invites.ts) — and update its stale doc comment ("for links
  placed in emails", audit §1.3) to "for links placed in emails, share payloads and metadata".
- Localized `title`/`description`. The root title should carry keywords, not just the brand:
  bg: `Money Assistant — приложение за общи разходи и разделяне на сметки`;
  en: `Money Assistant — split bills and track shared expenses`. Title template
  `%s · Money Assistant` for inner pages.
- `openGraph`: `type: "website"`, `siteName`, localized title/description, `locale: "bg_BG"` /
  `alternateLocale: "en_US"`, and the OG image below. `twitter: { card: "summary_large_image" }`.
- **OG image** — one static PNG per locale, `public/og/card-bg.png` and `public/og/card-en.png`,
  **1200×630**. Design spec (simple branded card): flat brand-green background (`var(--brand)`),
  the white rounded-square `$` mark from the login card at top-left, then in white:
  line 1 large „Money Assistant", line 2 the three-punch message
  „Неограничени разходи. Безплатно сканиране на бонове. Без реклами.", bottom-right the bare
  domain. System-safe geometric sans with proper Cyrillic (export from any design tool; commit the
  PNGs). *Alternative considered and rejected:* Next's `opengraph-image.tsx` + `ImageResponse` —
  requires bundling a Cyrillic font file for Satori and adds a runtime render path for a card that
  changes maybe yearly; static files are cache-friendly and risk-free. Keep each file < 300 KB
  (Viber is aggressive about large previews).
- **hreflang** via the Metadata API `alternates`:
  on `/`: `{ canonical: "/", languages: { bg: "/", en: "/en", "x-default": "/" } }`; mirrored on
  `/en` with `canonical: "/en"`. Bulgarian is `x-default` — deliberate, this is a bg-first product.
- `/login` gets `robots: { index: false }` (thin duplicate of the landing CTA) — the landing is
  the canonical public face.

#### Crawl surface `[code]`

App Router conventions, both trivial:

- `src/app/robots.ts` — allow `/`, `/en`, `/blog`; disallow `/groups/`, `/join/`, `/api/`,
  `/login`; point at the sitemap. (`/groups/` also covers the scan pages at
  `/groups/[id]/scan`, verified route layout.)
- `src/app/sitemap.ts` — `/`, `/en`, `/blog`, plus every entry of the blog article registry
  (§3.2) with real `lastModified` dates. Zero maintenance once the registry drives it.

### 3.2 (b) SEO content plan `[playbook`, plus a thin `[code]` blog scaffold`]`

#### Where articles live (decision)

**A simple `/blog` with plain TSX pages, no MDX.** Concretely: a typed registry
`src/lib/blog.ts` (`{ slug, titleBg, descriptionBg, published, updated }[]`) that drives
`src/app/blog/page.tsx` (index) and `src/app/blog/[slug]/page.tsx` with
`generateStaticParams` (SSG) — each article's body is a small server component. Justification:
the repo has **zero runtime dependencies beyond five** (audit header) and an explicit zero-dep
ethos; `@next/mdx` adds a build pipeline, version churn and loader config for what will be
**5–8 pages written by one person**. Plain TSX articles cost ~nothing to maintain, get typo-checked
by the compiler, and reuse the landing's typography styles. Revisit MDX only if the article count
passes ~15. Articles are **Bulgarian-only** (the SERP being targeted is Bulgarian; an `/en` blog
would dilute effort) — `hreflang` therefore only annotates `bg` + `x-default` on blog URLs.
FAQ sections on the landing (§3.1) cover the head terms redundantly, which is intentional: the
landing targets transactional intent, the articles informational intent.

#### Article list (from research §5), with target keyword and publish order

| # | Working title (bg) | Target query | Window |
|---|---|---|---|
| 1 | „Приложение за общи разходи със съквартиранти — наръчник за студентската квартира (2026)" | „приложение за общи разходи съквартиранти" | **September — first** |
| 2 | „Splitwise на български — има ли алтернатива? Сравнение 2026" | „Splitwise алтернатива на български", brand queries „Splitwise", „Tricount" | September |
| 3 | „Как да разделим сметката: най-добрите приложения за разделяне на сметки" | „разделяне на сметки приложение" | October |
| 4 | „Споделени разходи без караници: как работи общата каса" | „споделени разходи" | October |
| 5 | „Как да разделим разходите от почивката — Гърция, морето и първото лято с евро" | „как да разделим разходите от почивка" | November (evergreen; refresh + push May 2027) |
| 6 | „Обща каса за ски уикенда: Банско и Боровец без спорове за сметката" | „споделени разходи" long-tail, ski season | late November (Dec–Feb window) |

Editorial rules: native Bulgarian only (machine-translated Bulgarian is read as scam, research §6);
answer the query honestly including competitors (article 3 genuinely compares — credibility is the
ranking asset in an empty SERP); one soft CTA block per article, never mid-text.

#### Internal linking

- Every article links: landing CTA (once), 2 sibling articles, and the landing FAQ anchor that
  matches its query. The landing footer links `/blog`; the blog index links every article.
  No orphan pages; every public URL reachable within 2 clicks of `/`.

#### Measurement loop `[playbook]`

1. **Before writing anything**: verify the empty-SERP finding on google.bg (research flags it ⚠️
   US-datacenter). From Bulgaria or with `gl=bg&hl=bg` params, search all five target queries and
   screenshot results into the owner's notes. If a query is already owned, demote it, prefer
   long-tail variants.
2. Register the domain in **Google Search Console** (DNS TXT verification), submit
   `/sitemap.xml`, request indexing of each article on publish.
3. Weekly (see §3.5): impressions/clicks per query, position trend; retitle articles that get
   impressions but no clicks.

### 3.3 (c) Share / viral mechanics `[code]`

#### Invite share payload (consumed by RFC 06's button)

RFC 06 builds the Web Share API button on the invite UI and owns `/join/[token]` OG tags. This RFC
defines the **payload templates** as i18n dictionary keys (so the typed dictionary enforces bg
completeness), rendered in the *sharer's* locale:

- `share.inviteText` bg:
  „Здрасти! Направих група „{group}" в Money Assistant, за да си водим общите разходи. Влез от
  линка — отваря се в браузъра, нищо не се инсталира: {url}"
- `share.inviteText` en:
  "Hey! I set up "{group}" on Money Assistant to track our shared expenses. Join from the link —
  it opens in the browser, nothing to install: {url}"
- Web Share API payload: `{ title: "Money Assistant", text: t("share.inviteText", {...}) }` —
  put the URL **inside `text`**, not in the `url` field: Viber on Android drops the separate
  `url` field for some share targets, and a URL embedded in text always survives and unfurls.

#### „Share group summary" — balances snapshot to Viber

New feature, this RFC's own engineering scope:

- **Where:** a „Сподели" button in the `BalancesPanel` header
  ([src/components/BalancesPanel.tsx](../../../src/components/BalancesPanel.tsx)) and on the
  settle-up success state — the two natural „tell the group" moments (after settle-up, month-end).
- **What:** a pure-text snapshot (v1 needs **no image** — in Viber, text plus a link that unfurls
  via the §3.1 OG card is the whole visual; generating share images is real complexity for
  marginal gain). Composition helper `src/lib/share-text.ts`, unit-testable:

  ```
  Балансът в „{group}" към {date}:
  • Иван дължи 12,40 € на Мария
  • Петър дължи 8,15 € на Мария
  Виж подробно: {url}?ref=summary-share
  ```

  Rules: use `simplifiedDebts` when the group toggle is on, else `pairwiseDebts` (must match what
  the panel displays — same source as the chips, audit §1.6); largest debt first; cap at 6 lines
  then „…и още {n}"; amounts via the locale-aware `formatCents` (**RFC 02 dependency** — before
  that fix the text would read `€12.40`, wrong register for a Bulgarian chat); all-settled variant:
  „Всички сме квит в „{group}" 🎉". Settle-up variant: „{payer} върна {amount} на {recipient} —
  балансите са в Money Assistant: {url}?ref=summary-share".
- **How:** `navigator.share({ text })` with copy-to-clipboard fallback (same progressive
  enhancement RFC 06 uses). The `{url}` is the group URL — which requires login and membership, so
  the link is a re-engagement hook for members and a landing redirect for outsiders; that is the
  correct behavior, no new public page needed.

#### Referral tracking LIGHT (`?ref=`)

Channel attribution only — **no rewards program**. Justification for deferring rewards: (1) the
core loop is already intrinsically viral — the app is useless alone, every group *must* invite;
(2) rewards need fraud controls, terms, accounting and a paid tier to grant credit against
(→ RFC 09), all premature; (3) what the owner actually lacks is *knowledge of which channel
works*, which a bare param delivers for ~50 lines of code.

Mechanics (works today, with no analytics SDK — deliberately independent of RFC 11):

1. Any public URL may carry `?ref=<slug>` from a controlled vocabulary:
   `reddit`, `kaldata`, `bgmamma`, `fb-org` (organic groups), `fb-ads-a`/`fb-ads-b` (ad variants),
   `blog`, `summary-share` (invite links themselves are already attributable as invites — no param
   needed).
2. Landing/login read the param and set a `ref` cookie (30 days, first-touch wins — do not
   overwrite an existing value; first-touch is the honest measure of *discovery*).
3. Add nullable `signupRef: text("signup_ref")` to `users` in
   [src/db/schema.ts:33-39](../../../src/db/schema.ts) (+ drizzle migration). On the first
   authenticated dashboard render where `users.signupRef IS NULL` and the `ref` cookie exists,
   write it once and clear the cookie. This deliberately avoids threading cookies through the
   next-auth `jwt` callback — the first dashboard visit is attribution-equivalent to signup and
   the code stays out of [src/auth.ts](../../../src/auth.ts).
4. Reading it is a SQL one-liner (`SELECT signup_ref, count(*) FROM users GROUP BY 1`) until
   RFC 11 provides dashboards. No consent implication: a first-party cookie holding a channel
   slug, no third-party calls, no identifier — consistent with RFC 08's no-banner status.

### 3.4 (d) Launch playbook `[playbook]` — ordered checklist with copy drafts

**Preconditions (hard gates — do not launch without):** landing live (§3.1) · privacy/terms pages
live (RFC 08) · euro/balance correctness shipped (RFC 01 — launching with silently wrong balances
would burn the one first impression) · Bulgarian number formatting (RFC 02) · receipt LLM moved
off `:free` training-capable endpoints (audit §2 / RFC 04) · `?ref=` attribution live (§3.3).

Sequencing targets the **September student window** (research §5(e)); dates assume preconditions
land in the first week of September.

**□ Step 1 — r/bulgaria launch post (~Sep 8–10), `?ref=reddit`.**
~361k members, English-tolerant, honest solo-dev posts land well (research §5). Post in Bulgarian
(add a one-line English TL;DR). Draft skeleton:

> **Заглавие:** Направих безплатно приложение за общи разходи (като Splitwise, но без лимити и на
> български) — търся честна обратна връзка
>
> Здравейте! През последната година в свободното си време правя Money Assistant — уеб приложение
> за групови разходи: почивки, общи квартири, излизания.
>
> Защо изобщо се захванах: след поредното пътуване Splitwise ми спря безплатните записи по средата
> на вечерята (има лимит ~3 на ден), а и никога не е имал български език.
>
> Какво е различното:
> • изцяло в браузъра — само домакинът се регистрира, останалите влизат от линк, без инсталация;
> • неограничени разходи, без реклами;
> • сканиране на български касови бонове (Билла/Фантастико се четат изненадващо добре);
> • смята кой на кого колко дължи с минимален брой преводи; работи с лв./€.
>
> Правя го сам, няма инвеститори и нищо не събирам — основните функции са и ще останат безплатни.
> Ще се радвам на критика: какво е объркващо, какво липсва, бихте ли го ползвали изобщо?
> Линк: {url}?ref=reddit
>
> *TL;DR (EN): I built a free, Bulgarian-first, web-based bill-splitting app (no install for
> guests, free receipt scanning, no daily limits). Feedback welcome.*

Commit to answering every comment for 48h. Do not argue with negative feedback — thank and log it.

**□ Step 2 — Kaldata forum post (~Sep 11–14), `?ref=kaldata`.**
Largest BG tech portal (research §5). Same story, more technical angle — the audience respects
build details. Skeleton: the reddit story + a „как работи отвътре" section (уеб приложение,
Postgres, OCR на бонове през LLM, алгоритъм за опростяване на дългове до ≤ n−1 превода,
фиксираният курс 1,95583 за стари записи в левове) + explicit „направено в България". Ask for
feedback on the receipt scanner specifically — Kaldata users will stress-test it and that
generates thread activity.

**□ Step 3 — Facebook groups, 2–3 max (~Sep 15–20), `?ref=fb-org`.**
Targets (⚠️ specific group names/sizes unverified per research — confirm before posting): one
student-housing/flatshare group (София/Пловдив „квартири" groups), one Greece-vacation group
(off-season but evergreen membership), one general „студенти" group.
**Etiquette (non-negotiable):** read the group rules first; message admins for permission where
rules are unclear; post from the personal profile with the same solo-dev story (compressed to ~6
lines), openly as the author; one post per group, never repost; reply to every comment; if a post
is removed, apologize to admins and do not retry.

**□ Step 4 — BG-Mamma thread (~Sep 22+), `?ref=bgmamma`.**
Bulgaria's most influential forum community; word-of-mouth around family budgets and vacations
(research §5). **Different angle — family vacation budgets, not tech:** two families on a shared
seaside/villa vacation, кой е платил хранителните, кой горивото, как да се разделят накрая без
неудобни разговори. Approach: participate genuinely in 2–3 existing „семеен бюджет"/„почивка"
threads first; then start a thread titled e.g. „Как си разделяте разходите, когато летувате с
други семейства?" — first line discloses authorship of the app, body leads with the problem and
personal story, link at the end. BG-Mamma's paid native-ad formats exist as a later option;
organic-with-disclosure first.

**□ Step 5 — Meta ads test, €150 (range €100–200), ~Sep 15–30, `?ref=fb-ads-a/b`.**

| Parameter | Spec |
|---|---|
| Objective | **Traffic** (link clicks) — *not* a conversion objective: conversion optimization needs the Meta Pixel, which would break the site's no-consent-banner status ([08-privacy-gdpr/research.md](../08-privacy-gdpr/research.md)). CPA is computed from our own `?ref=` attribution instead. |
| Audience | Bulgaria, ages 20–35, interests: пътуване/travel, university/студентски живот, roommates; exclude nothing else — the audience is small enough. |
| Placements | Automatic (FB + IG feeds/stories). |
| Creative | 2 variants of the three-punch card (reuse the §3.1 OG design language): **A** student-flatshare framing („Квартирата няма да се кара за сметки"), **B** the raw three-punch message. Each links to `/` with its own `ref`. |
| Budget/flight | €10/day × 15 days ≈ €150. |
| Expected mechanics | BG CPM ≈ **$4.21** (research §5) → ~33–38k impressions; at a conservative 1% CTR → ~330–380 clicks ≈ €0.40–0.45/click. |
| Success metric | **Signup CPA ≤ €5** (i.e., ≥ ~30 attributed signups on €150 — implies a ~9% visit→signup rate, ambitious but honest for a free product with Google-only login). **Kill threshold: CPA > €8** at €75 spent → pause, fix the landing, don't buy more traffic. Secondary quality gate: ≥ ⅓ of attributed signups create a group **and** get a 2nd member within 7 days — signups that never form a group are worthless. |

**□ Step 6 — seasonal repeats `[playbook, recurring]`:** Bansko/Borovets creative + article #6 push
late November (Dec–Feb window); Greece/seaside creative + article #5 refresh in May–June 2027
(Jul–Aug window). Same €100–200 test-size until a channel proves CPA ≤ €5.

### 3.5 (e) Measurement `[code interface + playbook cadence]`

Six funnel events, to be emitted through whatever analytics tool
[RFC 11](../11-reliability-scale/rfc.md) selects (must be cookieless per RFC 08; this RFC only
fixes the event **contract** so instrumentation points can be wired the day RFC 11 lands):

| # | Event | Trigger point | Properties |
|---|---|---|---|
| 1 | `landing_view` | `/` and `/en` render (server-side count or beacon) | `locale`, `ref`, `path` |
| 2 | `signup` | first `users` insert (jwt callback in [src/auth.ts](../../../src/auth.ts)) | `ref` (from §3.3 cookie) |
| 3 | `group_created` | `createGroup` in [src/app/actions.ts](../../../src/app/actions.ts) | — |
| 4 | `member_joined` | `acceptInvite` / `addCircleMember` | `via: invite\|circle` — the group's **first** such event is the „2nd member" milestone, the retention hinge |
| 5 | `first_expense` | `saveExpense` when it is the group's first expense | `kind: manual\|scan` |
| 6 | `first_scan` | successful `parseReceipt` when it is the user's first | — |

**Weekly review cadence `[playbook]`:** 30 minutes, every Monday, starting the week of the reddit
post. Checklist: (1) Search Console — impressions/clicks/position per target query; (2) funnel —
landing→signup→group→2nd-member conversion; (3) `signup_ref` channel table; (4) during the ads
flight — spend, clicks, CPA vs. the €5/€8 thresholds; (5) one decision written down (kill/keep/
double-down). No dashboards required; a text file of weekly numbers is enough at this scale.

## 4. Implementation plan (ordered; code stages independently shippable)

| Stage | Type | Contents | Touches | Target |
|---|---|---|---|---|
| 1 | **code** | Landing page at `/` + `/en`, i18n `landing.*` keys, Accept-Language locale fallback, metadata/OG image/hreflang, `robots.ts` + `sitemap.ts`, `noindex` on `/login` | `page.tsx`, new `en/page.tsx` + `LandingPage` component, `layout.tsx`, `i18n.ts`, `i18n-server.ts`, `invites.ts` (comment), `public/og/`, `public/screenshots/` | **ship first**, by ~Sep 5 |
| 2 | **code** | Share payload keys, `share-text.ts` + summary-share button, `?ref=` cookie + `users.signup_ref` migration + first-visit write | `i18n.ts`, `src/lib/share-text.ts`, `BalancesPanel.tsx`, `SettleModal.tsx` (success state), `schema.ts` + drizzle migration, `page.tsx` | with / right after RFC 06's button |
| 3 | **code (thin) + playbook** | Blog scaffold (`blog.ts` registry, index + `[slug]` SSG pages, sitemap hookup); then articles at **1/week** in §3.2 order | `src/lib/blog.ts`, `src/app/blog/**`, `sitemap.ts` | scaffold with stage 1; articles from Sep on |
| 4 | **playbook** | Community launch: reddit → Kaldata → FB groups → BG-Mamma (steps 1–4, §3.4) | — | Sep 8–25 |
| 5 | **playbook** | Meta ads €150 test (step 5) | — | Sep 15–30 |
| 6 | **code (deferred)** | Wire the six §3.5 events when RFC 11's analytics lands; until then `signup_ref` SQL + Search Console are the measurement | per RFC 11 | with RFC 11 |

Stage 1 is the only hard blocker for everything else and is deliberately small — the September
window matters more than landing-page polish.

## 5. Acceptance criteria

**Engineering stages (1–2, 3-scaffold, 6):**

- Logged-out `GET /` returns the full Bulgarian landing HTML (no redirect, HTTP 200); logged-in
  behavior at `/` is byte-for-byte the current dashboard. `GET /en` serves the English variant.
- Lighthouse **SEO score ≥ 95** on `/`, `/en`, `/blog`, and one article page.
- Pasting the production URL into **Viber** (real device) and **Messenger** (Meta Sharing
  Debugger, then a real chat) renders title + description + the branded 1200×630 card in the
  correct language.
- hreflang validates: Search Console reports no hreflang errors; each of `/` and `/en` annotates
  `bg`, `en`, `x-default` and self-canonicalizes.
- `GET /sitemap.xml` serves and lists exactly the public URLs (`/`, `/en`, `/blog`, all registry
  articles); `GET /robots.txt` disallows `/groups/`, `/join/`, `/api/`, `/login` and names the
  sitemap. `/login` carries `noindex`.
- A visit with no `locale` cookie and `Accept-Language: bg-BG` renders `/login` and `/join/*` in
  Bulgarian; `Accept-Language: de-DE` still gets Bulgarian on `/` (with the EN banner) and English
  in the app.
- Visiting `/?ref=reddit`, signing up via Google OAuth, and landing on the dashboard leaves
  `users.signup_ref = 'reddit'`; a second `?ref=` visit does not overwrite it.
- The summary share button produces exactly the §3.3 template — locale-formatted amounts, correct
  debts source (simplified vs. pairwise matching the panel), ≤ 6 lines + „и още N", the
  `?ref=summary-share` link — verified by unit tests on `share-text.ts`; `navigator.share` absent
  → clipboard fallback with confirmation.
- FAQ JSON-LD passes Google's Rich Results Test as `FAQPage`.
- `npm run test:math` and the other three script tests (audit §9) still pass; TypeScript build
  fails if any new `landing.*`/`share.*` key is missing a Bulgarian translation (typed-dictionary
  property, must remain intact).

**Playbook stages (3–5) — completion checklists, not metrics promises:**

- google.bg SERP verification screenshots recorded for all five target queries **before** article 1.
- Articles 1–4 published, indexed (Search Console „URL is on Google"), and present in the sitemap
  by end of October; Search Console verified and receiving data.
- Steps 1–4 of §3.4 executed: post URLs + dates + `ref` slugs recorded; every comment answered
  within 48h during launch week.
- Ads test: both variants ran, spend ≤ €200, final CPA computed from `signup_ref` counts, and a
  written keep/kill decision exists.
- Four consecutive weekly reviews (§3.5) written down.

## 6. Risks & mitigations

1. **The empty-SERP finding is unverified on google.bg** (research flags US-datacenter results ⚠️).
   *Mitigation:* it is the playbook's literal first action (§3.2); if the SERP is contested,
   pivot to long-tail and the untouched competitor-brand queries before writing five articles.
2. **Community backlash — posts read as ads.** r/bulgaria and Kaldata are allergic to marketing.
   *Mitigation:* genuine solo-dev story with a real founding incident, disclosure in the first
   line, feedback-ask rather than download-ask, no reposting, answer everything including
   hostility; FB group admin permission before posting.
3. **Смят.AI reacts** — the local receipt-splitter (research §1) could add a ledger, or outrank us
   on „сканиране на бонове" queries. *Mitigation:* our moat is the combination
   (ledger + balances + debt simplification + OCR + no-install web) which is months of work to
   copy; check smetkata.live monthly in the weekly review; do not attack them by name anywhere.
4. **No Meta Pixel means weaker ad delivery optimization** (traffic objective only, §3.4) and
   self-computed CPA undercounts (cookie cleared, cross-device). *Mitigation:* accepted cost of
   keeping the no-consent-banner status; treat measured CPA as an upper bound; revisit
   Pixel/CAPI + consent UX only if paid becomes a primary channel (with RFC 08).
5. **Viber's link-preview crawler is poorly documented** — the OG card may render differently than
   in Messenger. *Mitigation:* test on a real device in stage 1 acceptance; keep the card simple
   (large text, no fine detail), keep `og:title`/`og:description` strong enough to carry a
   text-only unfurl.
6. **English brand name („Money Assistant") is weak in a Bulgarian SERP** and generic besides.
   *Mitigation:* keyword-carrying title tags and H1s do the ranking work while the brand does the
   trust work; a rename is out of scope but flagged as an open question for the owner.
7. **The September window is two weeks away** — scope creep on the landing kills the launch
   timing. *Mitigation:* stage 1 is intentionally minimal (static sections, no animations, two
   pages); articles and ads can trail the community posts by weeks without harm.
8. **Solo-dev support surge** after launch posts (bug reports, feature demands, receipt-scan LLM
   spend). *Mitigation:* launch gates include the paid-LLM switch and rate limiting is flagged in
   [RFC 11](../11-reliability-scale/rfc.md); keep launch-week calendar clear; a pinned „known
   issues" reply template.
