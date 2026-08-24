# Topic 06 — Onboarding, Auth & Invites: Research

> Part of the [Bulgarian market improvement guide](../README.md).
> Research date: **2026-08-24**. Companion implementation plan: [rfc.md](rfc.md).
> Current-state findings: [audit §6 (auth & onboarding)](../00-current-state-audit.md) and
> [audit §1.3 (invites)](../00-current-state-audit.md). Claims that could not be verified are flagged ⚠️.

**Why this topic matters:** invite links are the app's **only growth loop** — there is no
marketing site, no store listing, no email. Every new user arrives either organically or
through `/join/<token>`. That makes the login page, the join flow, and the first ten minutes
inside a group the entire acquisition funnel, and today each stage has measurable friction:
Google-only auth ([src/auth.ts:12-13](../../../src/auth.ts)), a double empty state, an
English-first login card, copy-to-clipboard as the only sharing mechanism, and zero
consent/trust signals.

---

## 1. Google-only sign-in as a funnel filter

### Who it covers in Bulgaria

- **Mobile OS share, Bulgaria (StatCounter, July 2026): Android 75.95%, iOS 24.04%.**
  Every functioning Android phone practically requires a signed-in Google account (Play
  Store), so ~3/4 of Bulgarian mobile users can pass the current gate with zero new
  credentials. ⚠️ "Has a Google account" ≠ "is willing to OAuth with it on an unknown
  site" — no BG-specific measurement of Google-login acceptance exists; inference from OS share.
- **Who gets filtered out:** (a) the iOS quarter, skewing urban/affluent — many have
  Google accounts anyway, but not all; (b) **older users on legacy Bulgarian webmail** —
  abv.bg claims 2M+ monthly active accounts (United Media), and Similarweb ranked mail.bg
  the most-visited email site in BG (Aug 2025). These addresses *can* back a Google
  account, but their owners rarely created one deliberately on desktop; (c) desktop-only
  users without Android. For a group app the filter compounds: **one non-Google member per
  group blocks that member's self-service participation** — today the owner falls back to a
  virtual member and proxies their expenses.
- A subtle correctness note: the app already handles the non-Gmail-Google-account case —
  [src/auth.ts:51-58](../../../src/auth.ts) rejects Google profiles with
  `email_verified !== true`, precisely because Google accounts registered on outside
  addresses (abv.bg etc.) can carry unverified emails. Correct, but it means the *most
  BG-typical* marginal user (older, abv.bg address) can hit a silent dead end.

### The 2026 indie-auth landscape

- **Email magic links — the natural fit.** Auth.js v5 ships first-class passwordless email
  providers (**Nodemailer** for SMTP, **Resend**/HTTP providers): the sign-in email carries
  a tokenized URL; clicking it *is* proof of mailbox possession. Two hard facts for this
  codebase:
  1. **A database adapter is required** — verification tokens must be stored server-side.
     The app currently runs adapter-less JWT sessions with a manual `users` upsert
     ([src/auth.ts:42-49, 60-77](../../../src/auth.ts)); adding the email provider means adding
     at least a verification-token table + minimal adapter methods (details in the [RFC §3a](rfc.md)).
  2. **An email sender is required** — the app sends no email at all today
     ([audit §7](../00-current-state-audit.md)). This is exactly the infrastructure
     [topic 07 (notifications)](../07-notifications-engagement/research.md) has to build anyway;
     magic links should ride that dependency, not duplicate it.
  - **Why it fits this app specifically:** email is already the identity and
    invite-matching key (the `signIn` callback exists to defend it). A magic link
    preserves the verified-email invariant *by construction* — no OAuth consent screen, no
    password storage, works identically for gmail.com, abv.bg, and corporate addresses,
    on any OS. It is the standard second provider for indie apps in 2026.
  - Cost: deliverability work (SPF/DKIM, a sending domain — topic 07's problem), a
    slower loop than OAuth (switch to inbox, find mail, click), and phishing-shaped UX
    that some users distrust. Mitigation: keep Google as the fast path, magic link as
    the universal fallback.
- **Passkeys — not yet, for this app.** Ecosystem status 2026: FIDO Alliance counts
  ~5B passkeys in use and 69% of surveyed consumers have passkeys on at least some
  accounts, but **site-side support remains thin** (⚠️ one 2026 estimate: 20–25% of the
  top-1000 websites; secondary source). Auth.js's WebAuthn/Passkey provider is still
  **flagged experimental and requires a database adapter** plus an authenticator table.
  Decisive against, though: a passkey authenticates a *device pair*, it does not bootstrap
  an *email identity* — the app would still need email verification first. Revisit
  as a "add a passkey to your account" convenience once an adapter exists anyway.
- **Apple Sign-In — optional, with a trap.** App Store guideline 4.8 forces Sign in with
  Apple only on **native apps** that offer exclusively third-party logins; a web-only app
  has **no obligation**. It would serve the iOS ~24% nicely, but Apple's **Hide My Email**
  relay (`@privaterelay.appleid.com`) actively breaks this app's email-matching model:
  circle search, invite matching, and virtual-member attach all assume the address the
  friend knows. Magic links cover iOS users without that trap. Verdict: skip for now.

## 2. Guest / no-account participation

The strongest onboarding pattern in the splitting-app category is **not requiring accounts
from the whole group** — and the app is already halfway there.

### What competitors do

- **Kittysplit** (the pattern's originator, since 2012): no registration, no passwords —
  the secret event link *is* the access control; anyone with it adds expenses in any
  browser. Marketed explicitly as "no app, no account" and it is the core of their pitch
  against Splid/Splitwise.
- **Смят.AI (smetkata.live)** — the Bulgarian local competitor
  ([topic 10 §1](../10-growth-marketing/research.md)): host photographs the receipt,
  shares a link, **each person ticks their own items in the browser with no install and
  no login**. One receipt at a time, no ledger — but the no-login flow is the whole product.
- **Tricount**: a shared tricount is addressable by its sharing token
  (`tricount.com/t...`); per bunq's help center, **the sharing link alone is enough to
  open and edit a tricount** — accounts exist but are optional for participation.
  ⚠️ Exact current edit-permission semantics after the v8 bunq rework unverified.
- **Splitwise** sits at the opposite pole: full account required for everyone; its
  workaround is the same "add a person by name, they claim it later" model this app has.

### What the app already has — and the honest gap

- **Virtual members** (aliases with `userId = null`,
  [audit §1.2](../00-current-state-audit.md)) let the owner track people with no account,
  and **attach** merges a virtual member's whole history into a real account when the
  person finally signs up — a genuine *claim-your-identity* upgrade path
  (`src/lib/merge-alias.ts`, owner-initiated via
  [MembersModal.tsx:285-331](../../../src/components/MembersModal.tsx)).
- The gap versus Kittysplit/Смят.AI: participation is **owner-proxied**. A virtual member
  cannot see balances, cannot add "I paid for the taxi", cannot even view the group.
  Everything funnels through the owner's phone.

### Assessment: full guest editing vs the current owner-proxy model

Arguments for link-grants-edit (Kittysplit model): removes the last adoption barrier;
matches how Bulgarian groups actually behave (one организатор, everyone else in the Viber
chat); it's the local competitor's whole moat. Arguments against, specific to this app:

1. The invite token is already flagged as a **bearer URL exposing financial history +
   member emails** ([audit §8](../00-current-state-audit.md)); making it grant *write*
   access sharpens that from privacy issue to integrity issue (any link-holder could edit
   any expense — and members already can, [audit §1.1](../00-current-state-audit.md)).
2. Anonymous edits break the activity log's actor model and the "who typed this" trust
   inside the group.
3. The full model (ephemeral guest sessions bound to an alias, later claimable) is a
   large auth rework for a solo project.

**Recommended stance:** keep accounts required for *writing*, but (a) make claiming
frictionless — the join flow could offer "which of these people are you?" when virtual
members exist (today attach is a buried owner-side action); (b) consider a cheap
**read-only share view** later (balances + expense list behind the invite link) so
non-account members can at least *see* the ledger — that alone answers 80% of "какво
дължа?" Viber questions. Full guest editing is a deliberate non-goal until the bearer-link
security posture improves.

## 3. First-run experience patterns

### What the app does today — the double-empty-state funnel

A brand-new user crosses **two dead ends** before any value
([audit §6](../00-current-state-audit.md)):

1. Dashboard empty state ([src/app/page.tsx:25-29](../../../src/app/page.tsx)): "no groups"
   text + a separate button in the header.
2. Create-group modal ([NewGroupForm.tsx](../../../src/components/NewGroupForm.tsx)) — two
   fields, **currency defaulting to USD** (`NewGroupForm.tsx:15`) for a EUR-country user.
3. The new group page then shows a **second** empty state — "add people first"
   ([GroupView.tsx:99-110](../../../src/components/GroupView.tsx)) — with Add Expense, Scan
   and Settle Up all disabled (`GroupView.tsx:64,73,82`).
4. Adding people means a **modal detour** (MembersModal) mixing invite-search, invite-link
   and virtual-member entry, then closing it to finally reach the first expense.

That is 4 screens and ~8 interactions to the first expense — the "aha" moment for a
splitting app (first expense entered, balance appears).

### What the research says works

- **Time-to-first-value:** 2026 onboarding benchmarks put the target "aha" at **under
  5–15 minutes** with steep abandonment beyond ~30; average SaaS activation is ~37.5%
  (⚠️ B2B-skewed samples; consumer utility apps differ, directionally valid).
- **Guided empty states beat blank ones:** contextual guidance/examples in empty states
  improves task completion 30–45% (⚠️ secondary citation of NN/g research).
  The fix is cheap here: the second empty state should *be* the add-people form, not a
  button pointing at a modal.
- **Checklists** (3–4 steps, visible progress) lift completion 20–30% — likely overkill
  for a 3-step product; an inline first-step panel achieves the same with less machinery.
- **Templates:** Splitwise's create-group asks for a **group type** (Trip / Home / Couple /
  Other) and adjusts small affordances per type. For this app, templates should stay
  honest — a **name placeholder and suggested settings only** (e.g. Trip → simplify-debts
  on), because the product genuinely has no type-specific behavior yet. Locally resonant
  presets: *Почивка* (trip — Гърция/Банско per [topic 10 §3](../10-growth-marketing/research.md)),
  *Съквартиранти* (flatmates), *Двойка* (couple).
- **Demo data:** a pre-filled sample group demonstrates value instantly but pollutes a
  real account and confuses the "delete it later" path; weak fit for an app this simple.
  A worked example inside the empty state (static illustration, not data) gets the benefit
  without the cleanup.

## 4. Locale-aware first impression

- **Language:** the app defaults to English with no `Accept-Language` sniffing
  ([audit §6](../00-current-state-audit.md)) — a Bulgarian visitor's first screen is
  English with a small EN/БГ pill. [Topic 02](../02-localization/research.md) owns the
  detection mechanism; this topic's requirement is simply that **the login and join pages
  are Bulgarian-first for Bulgarian visitors** — they are the two pages seen before any
  user preference exists.
- **The `$` logo:** the login card and join card brand-mark is a literal dollar sign
  ([login/page.tsx:27-32](../../../src/app/login/page.tsx),
  [JoinCard.tsx:43-48](../../../src/components/JoinCard.tsx)) — a currency signal from the
  wrong continent for a EUR/лв. audience. Trivial to swap; disproportionate first-impression value.
- **Trust signals** (from [topic 10 §6](../10-growth-marketing/research.md)): Bulgarians
  rank lowest in the EU on feeling in control of their data, and native-quality Bulgarian
  is itself a trust proxy (machine-translated Bulgarian codes as scam). The login page —
  currently logo + tagline + one button — has room for a three-item trust strip:
  **„Без достъп до банката ви"** (no bank access — the app counts, it never touches money),
  **„Данните ви са в ЕС"** (data in the EU — accurate once processors are pinned per
  [topic 08](../08-privacy-gdpr/research.md)), **„Направено в България"**. All three are
  claims competitors cannot all make; none require engineering.

## 5. Consent at signup

The legal analysis lives in [topic 08](../08-privacy-gdpr/research.md); this section is
only about the **signup UX** that satisfies it without killing conversion.

- **Key distinction — notice vs consent.** The app's core processing rests on
  **Art. 6(1)(b) contract**, not consent ([topic 08 §1](../08-privacy-gdpr/research.md)).
  GDPR therefore requires **transparency at collection (Art. 13)** — identity, purposes,
  rights, link to the full policy — but **no consent checkbox for the processing itself**.
  Checkbox-consent rules (unticked, granular, freely given) bind only consent-based
  processing (marketing, analytics), none of which exists yet.
- **ToS acceptance is contract formation**, a separate question. The enforceability
  ladder: **clickwrap** (explicit unticked checkbox) > **sign-in-wrap** ("By continuing,
  you agree to the [Terms] and acknowledge the [Privacy Policy]" adjacent to the button) >
  browsewrap (footer link only — broadly unenforceable in the EU). For a free, low-stakes
  service whose ToS mainly *disclaims* (not a bank, balances are informal records —
  [topic 08 §2](../08-privacy-gdpr/research.md)), a **prominent sign-in-wrap notice
  directly under the auth buttons is the standard, defensible choice** and costs zero
  clicks; it is what Google, Splitwise and most consumer apps ship. ⚠️ Sign-in-wrap
  enforceability is jurisprudence-derived (mostly US case law) rather than statute; a
  checkbox remains the conservative option if paid features later raise the stakes.
- **One flow, two meanings:** the login page cannot distinguish signup from login (OAuth
  and magic links unify them), so the notice must read as covering both — "By continuing…"
  handles that naturally.
- **Age statement:** Bulgaria's digital-consent age is **14** (Art. 25c ЗЗЛД,
  [topic 08 §2](../08-privacy-gdpr/research.md)). Since processing is contract-based, a
  **ToS eligibility clause (14+) plus one clause-line in the signup notice** suffices — no
  age-gate UI, no date-of-birth field (which would itself be needless data collection).

## 6. Invite/join flow friction audit

The full loop today, annotated with likely drop-off:

| # | Step | Friction |
|---|---|---|
| 1 | Owner opens Members modal → creates/copies link ([MembersModal.tsx:139-182](../../../src/components/MembersModal.tsx)) | Copy-to-clipboard is the **only** mechanism — no Web Share API, no QR, no Viber deep link ([audit §1.3](../00-current-state-audit.md)). On mobile the owner must paste manually into Viber. |
| 2 | Link lands in a Viber chat | Bare URL, no rich preview: the app sets **no Open Graph tags anywhere** ([layout.tsx:25-31](../../../src/app/layout.tsx)) — Viber (like Messenger) builds link previews from OG metadata (⚠️ Viber's exact OG parsing is undocumented; empirically it renders og:title/og:image). An unfurnished localhost-style link in a chat reads as suspicious — a trust tax at the highest-leverage moment. |
| 3 | Friend taps days later | **7-day TTL** ([invites.ts:3](../../../src/lib/invites.ts)); trips are organized weeks ahead, so the pinned link in the trip chat is often dead on arrival. The error page offers only "ask the owner" (`join/[token]/page.tsx:17-31`). One shared link per group ([actions.ts:508-513](../../../src/app/actions.ts)) with no regenerate — revoke-then-create is the only refresh. |
| 4 | `/join/<token>` **immediately redirects to login** ([join/[token]/page.tsx:10-13](../../../src/app/join/[token]/page.tsx)) | The visitor must authenticate **before seeing what they're joining** — no group name, no inviter, nothing. Discord shows the invite preview first; this app's own `JoinCard` exists but renders only post-auth. Asking for Google OAuth on a blank promise is the single most likely drop-off point. |
| 5 | OAuth round trip | Google-only (§1). Extra hazard: Viber opens links in its **in-app browser**, and Google **blocks OAuth from embedded webviews** (`disallowed_useragent`). ⚠️ Whether Viber's Android in-app browser triggers the block in 2026 is unverified — must be tested on-device; Facebook/Instagram in-app browsers historically did. A magic-link provider (§1) is immune: the user opens their mail app instead. |
| 6 | Back to `/join/<token>` → JoinCard → Accept | Solid (state handling covers member/expired/invalid). Minor: after joining, the user lands in the group with **no attach prompt** — if the owner had them as a virtual member, only the owner can merge the histories, later, from a different screen. |

The **circle** shortcut (returning users searchable by name/email, instant add —
[audit §1.3](../00-current-state-audit.md)) is genuinely good and needs no work; friction
concentrates entirely on the *first-contact* path.

## Implications for the app

1. **Add email magic links as the second provider** — the highest-leverage auth change:
   covers iOS/non-Google/older-webmail users, preserves the verified-email invariant by
   construction, dodges the in-app-browser OAuth hazard, and its only real cost (email
   infrastructure) is already on topic 07's roadmap. Skip passkeys (experimental in
   Auth.js, doesn't bootstrap identity) and Apple Sign-In (no web obligation; Hide My
   Email breaks invite matching).
2. **Keep owner-proxy + virtual members as the participation model**; invest in the
   *claim* path (offer attach at join time), not in guest editing — the bearer-link
   security posture forbids link-grants-write for now. Read-only share view is the
   future middle ground.
3. **Collapse the double empty state:** the new group's empty state should *be* the
   add-people form (inline quick-add + invite link), and group creation should offer
   honest templates (Почивка/Съквартиранти/Двойка = name placeholder + suggested
   settings). EUR default comes from [RFC 01](../01-euro-transition/rfc.md).
4. **Make the login page Bulgarian-first** (mechanism from
   [topic 02](../02-localization/research.md)) with a three-line trust strip (no bank
   access · data in EU · made in Bulgaria) and swap the `$` mark.
5. **Consent = sign-in-wrap notice, not a checkbox:** one line under the auth buttons
   linking ToS + privacy policy ([topic 08](../08-privacy-gdpr/research.md) pages), with
   14+ stated in the ToS. Zero conversion cost, Art. 13-compliant.
6. **Rebuild invite sharing around Viber:** Web Share API button (native share sheet
   reaches Viber), QR code for in-person joins, longer/regenerable link TTL, OG tags on
   `/join/[token]` so the chat preview shows the group invitation — and show the invite
   preview *before* login.

## Sources

<details><summary>Full source list (URLs)</summary>

- Mobile OS share Bulgaria: https://gs.statcounter.com/os-market-share/mobile/bulgaria (checked 2026-08-24: Android 75.95% / iOS 24.04%, July 2026) · https://www.statista.com/statistics/669547/market-share-mobile-operating-systems-bulgaria/
- BG email providers: https://unitedmedia.net/media-outlet/abv/ · https://www.similarweb.com/top-websites/bulgaria/computers-electronics-and-technology/email/
- Auth.js email/magic-link providers: https://authjs.dev/getting-started/authentication/email · https://authjs.dev/getting-started/providers/nodemailer · https://authjs.dev/getting-started/providers/resend · https://authjs.dev/guides/configuring-resend
- Auth.js WebAuthn (experimental): https://authjs.dev/getting-started/authentication/webauthn · https://authjs.dev/getting-started/providers/passkey · https://github.com/nextauthjs/next-auth/pull/8808
- Passkeys 2026 state: https://www.dualmedia.com/passkeys-web-adoption-2026/ · https://www.panicvault.org/passkeys/adoption-statistics/ · https://www.dashlane.com/blog/passkeys-long-way
- Apple guideline 4.8: https://developer.apple.com/news/?id=09122019b · https://developer.apple.com/forums/thread/765145
- Kittysplit: https://www.kittysplit.com/en/help · https://www.kittysplit.com/en/splid-alternative
- Tricount link access: https://help.tricount.com/articles/tricount-faqs · https://help.tricount.com/articles/tricount-effortlessly-share-expenses-with-friends
- Смят.AI: https://smetkata.live/ (analysis in [topic 10](../10-growth-marketing/research.md))
- Splitwise group types: https://www.tapsmart.com/tips-and-tricks/shared-bills-splitwise/ · https://blog.splitwise.com/2011/08/18/using-splitwise-for-group-travel/
- Onboarding/TTV benchmarks: https://www.digitalapplied.com/blog/customer-onboarding-time-to-value-2026-saas-metrics-framework · https://rocknroll.dev/p/saas-onboarding-checklist/ · https://www.saasfactor.co/blogs/saas-user-activation-proven-onboarding-strategies-to-increase-retention-and-mrr
- Clickwrap/browsewrap/consent UX: https://www.termsfeed.com/blog/clickwrap-eu/ · https://www.termsfeed.com/blog/clickwrap-browsewrap-scrollwrap/ · https://termly.io/resources/articles/browsewrap-vs-clickwrap/ · https://www.policystamp.com/blog/gdpr-article-13-checklist · https://gdprexplorer.com/gdpr-article-13-explained-what-it-is-what-it-requires-and-real-life-examples
- Web Share API support: https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API · https://caniuse.com/mdn-api_navigator_share (not Baseline: desktop Firefox and Linux Chrome lack it — feature-detect)
- Viber deep links / share: https://developers.viber.com/docs/tools/deep-links/ · https://developers.viber.com/docs/tools/share-button/ · https://hackmd.io/q-SNXkQ8ST6rM-noqRFtRQ (`viber://forward?text=`)
- Google OAuth webview block: https://developers.googleblog.com/en/modernizing-oauth-interactions-in-native-apps-for-better-usability-and-security/ (disallowed_useragent policy)

</details>

**Key unverified items (⚠️):** Google-account penetration in BG (inferred from Android share);
top-1000-site passkey support estimate; Tricount post-v8 edit-permission semantics; NN/g
empty-state uplift figures (secondary citation); Viber OG-preview parsing details and
whether Viber's in-app browser triggers Google's webview OAuth block (test on-device);
sign-in-wrap enforceability is case-law-derived, not statutory.
