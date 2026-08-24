# RFC 06 — Onboarding & Auth: Magic Links, First-Run Flow, Invite Sharing & Account Settings

> **Status update (2026-08-24):** implemented subsets — Web Share invite button (stage 1), template chips + inline first-run add-people (stage 3), minimal /settings page (stage 5, language + leva toggle only); the rest outstanding. Details: [IMPLEMENTATION-LOG.md](../IMPLEMENTATION-LOG.md).

> **Status:** Proposed · **Priority: P1** (stages 3.e/3.b) **– P2** (rest) — the invite
> loop is the app's only growth channel; auth breadth and first-run gate every acquisition.
> **Audience:** a future LLM implementer with full repo access. Read
> [research.md](research.md), [audit §6 / §1.3](../00-current-state-audit.md) first.
> All file/line references are to commit `14963d2`; re-locate by symbol name if drifted.
> **Dependencies:** email sending from [RFC 07](../07-notifications-engagement/rfc.md) (blocks §3a only);
> locale detection from [RFC 02](../02-localization/rfc.md) (§3b); policy pages from
> [RFC 08](../08-privacy-gdpr/rfc.md) (§3b consent links, §3f delete-account);
> EUR default from [RFC 01](../01-euro-transition/rfc.md) (§3c references it).

## 1. Problem

1. **Google-only auth.** [src/auth.ts:12-13](../../../src/auth.ts) pushes only the Google
   provider in production (dev-only Credentials fallback at `:14-27`). Anyone without a
   usable Google account — iOS users (~24% of BG mobile), abv.bg/mail.bg webmail users —
   cannot join at all. The `signIn` callback ([auth.ts:51-58](../../../src/auth.ts))
   correctly requires `profile.email_verified === true` because **email is the identity
   and invite-matching key**; any new provider must preserve that invariant.
2. **Login page is a bare English card.** [src/app/login/page.tsx:27-34](../../../src/app/login/page.tsx):
   a `$` glyph logo (wrong-currency signal; duplicated in
   [JoinCard.tsx:43-48](../../../src/components/JoinCard.tsx)), hardcoded "Money Assistant"
   title, tagline, one button. No trust signals, no ToS/privacy notice, English-first
   (locale defaults to `en`; [audit §6](../00-current-state-audit.md)).
3. **Double empty state.** Dashboard empty card
   ([src/app/page.tsx:25-29](../../../src/app/page.tsx)) → create-group modal
   ([NewGroupForm.tsx](../../../src/components/NewGroupForm.tsx), currency `useState("USD")`
   at `:15`) → a second dead empty state "add people first"
   ([GroupView.tsx:99-110](../../../src/components/GroupView.tsx)) with Add Expense/Scan/Settle
   disabled (`GroupView.tsx:64,73,82`) → MembersModal detour before the first expense.
4. **Invite sharing is copy-to-clipboard only.**
   [MembersModal.tsx:139-182](../../../src/components/MembersModal.tsx): readonly input +
   Copy + Revoke. No Web Share API, no QR, no Viber path. 7-day TTL
   ([src/lib/invites.ts:3](../../../src/lib/invites.ts)); one link per group —
   `createInviteLink` returns the existing link ([actions.ts:508-513](../../../src/app/actions.ts));
   no regenerate. `/join/[token]` redirects logged-out visitors to login **before showing
   any preview** ([join/[token]/page.tsx:10-13](../../../src/app/join/%5Btoken%5D/page.tsx)).
   No Open Graph tags anywhere ([layout.tsx:25-31](../../../src/app/layout.tsx)) → naked
   link previews in Viber. Dead comment "for links placed in emails"
   ([invites.ts:13](../../../src/lib/invites.ts)).
5. **No account settings screen exists** ([audit §1.10](../00-current-state-audit.md)) —
   no profile-name change, no home for the language preference, nothing for RFC 01's
   leva-equivalent toggle, RFC 07's notification prefs, or RFC 08's delete/export entry
   points. Several RFCs are queued behind this missing surface.

## 2. Goals / non-goals

**Goals**
- G1. A user with any verified email address can sign in (magic link), with the same
  `users` row regardless of which provider they use.
- G2. Bulgarian-first login/join pages with trust strip and a legally sufficient consent notice.
- G3. First expense reachable in one screen after group creation — no dead empty state.
- G4. Invite links shareable natively (share sheet / QR / Viber), previewable in chat
  (OG), regenerable, and long-lived enough for trip planning.
- G5. An `/settings` account screen exists as the shared mount point for profile name,
  language, and other RFCs' entries.

**Non-goals**
- Notification content, email templates, or the email-sending infrastructure itself
  (→ [RFC 07](../07-notifications-engagement/rfc.md); §3a consumes its send capability).
- Deletion/export internals (→ [RFC 08](../08-privacy-gdpr/rfc.md); §3f only links to them).
- PWA install prompts / manifest (→ [RFC 05](../05-mobile-pwa/rfc.md)).
- Marketing landing page and general OG/social strategy (→ [RFC 10](../10-growth-marketing/rfc.md);
  this RFC owns exactly the `/join/[token]` page's tags).
- Guest *editing* via share link and passkeys/Apple Sign-In — assessed and deferred in
  [research §1–2](research.md).

## 3. Design

### 3.a Email magic-link provider (depends on RFC 07's email infra)

**Blocked until** RFC 07 provides a server-side `sendMail({ to, subject, html, text })`
helper with a configured sender domain. Design against that interface; do not add a second
email dependency here.

- **Provider:** Auth.js **Nodemailer or Resend provider** (match whichever transport
  RFC 07 picks), added to the `providers` array in [src/auth.ts](../../../src/auth.ts)
  alongside Google. Override `sendVerificationRequest` to call RFC 07's helper with a
  minimal localized subject/body (BG/EN via `getT()` — the *template system* stays RFC 07's;
  this is one hardcoded-format transactional mail). Set `maxAge` for the token to ~15 min.
- **Adapter — the tricky part.** Auth.js email providers require a database adapter for
  verification tokens, but the app is deliberately adapter-less with JWT sessions and a
  manual upsert ([auth.ts:42-49, 60-77](../../../src/auth.ts)). Keep `strategy: "jwt"`
  and implement a **minimal custom Drizzle adapter** — only the methods the email flow
  touches: `createVerificationToken`, `useVerificationToken` (single-use delete-on-read),
  `getUserByEmail`, `createUser`, `getUser`, `updateUser`. Map user methods onto the
  **existing `users` table** (add an `email_verified timestamp` column via drizzle
  migration — Auth.js expects it; backfill existing rows with their `created_at` since
  Google rows were verified at entry). New `verification_tokens` table
  (`identifier`, `token` hashed, `expires`) + daily-cron purge of expired rows
  (extend [api/cron/daily/route.ts](../../../src/app/api/cron/daily/route.ts)).
  Do **not** add `accounts`/`sessions` tables — no OAuth account linking is stored today
  and nothing needs it.
- **Same-email unification is automatic but has one landmine:** identity is
  `users.email` (unique). A Google user later using a magic link resolves to the same row
  via `getUserByEmail`/`ensureUser`. **Landmine:** `ensureUser`
  ([auth.ts:29-40](../../../src/auth.ts)) upserts with `set: { name: name ?? null, image:
  image ?? null }` — a magic-link sign-in (no profile) would **wipe the Google-provided
  name and avatar**. Change the conflict-update to only overwrite with non-null values
  (`sql`COALESCE(excluded.name, users.name)``-style, or build `set` conditionally).
  Add a regression test.
- **Verified-email invariant preserved:** clicking the emailed link is possession proof —
  strictly stronger than `email_verified` from an OAuth profile. No change to the Google
  path's check.
- **Abuse control:** per-email + per-IP throttle on requesting links (e.g. 3/hour) — the
  app has no rate limiting anywhere ([audit §9](../00-current-state-audit.md)); a
  send-email endpoint must not launch unthrottled. Simple `verification_tokens` count
  query per identifier suffices at this scale.
- **Login page UX:** email field + "Изпрати ми линк за вход" under the Google button;
  a "check your inbox" state (Auth.js `verifyRequest` page — style it, don't ship the
  unbranded default). Keep dev-login untouched.

### 3.b Login page overhaul

[src/app/login/page.tsx](../../../src/app/login/page.tsx):

- **Bulgarian-default copy** via the locale-detection mechanism from
  [RFC 02](../02-localization/rfc.md) (Accept-Language → default locale before any cookie
  exists). This RFC adds no detection code — it only requires the login/join pages render
  from `getT()` (already true) so they flip automatically when RFC 02 lands.
- **Trust strip:** three muted items under the auth controls (i18n keys, BG-first per
  [research §4](research.md)): „Без достъп до банката ви" · „Данните ви са в ЕС" ·
  „Направено в България". Ship the second item only once RFC 08's processor pinning makes
  it true — gate with a comment referencing [RFC 08](../08-privacy-gdpr/rfc.md).
- **Consent notice (sign-in-wrap, not a checkbox** — rationale in [research §5](research.md)):
  one line directly beneath the buttons: „Продължавайки, приемате [Условията] и се
  запознахте с [Политиката за поверителност]. Услугата е за лица над 14 г." Links target
  the pages RFC 08 creates (`/terms`, `/privacy` — confirm final routes there). Do not
  ship the line before those pages exist; a notice linking to 404s is worse than none.
- **Swap the `$` mark** in login + JoinCard for a neutral brand glyph (shared small
  component so it changes in one place).

### 3.c Group templates (+ EUR default by reference)

[NewGroupForm.tsx](../../../src/components/NewGroupForm.tsx):

- A row of 4 preset chips above the name field: **Почивка / Trip**, **Съквартиранти /
  Flatmates**, **Двойка / Couple**, **Друго / Other** (i18n keys). Selecting one sets
  (1) the name **placeholder** (e.g. „Гърция 2026" for Trip), (2) suggested settings:
  Trip → `simplifyDebts: true` on create; others → current defaults. **Nothing else** —
  no fake type-specific features, no stored `group.type` column (add one only when real
  behavior differs; YAGNI). Keep "Other" preselected so the form works exactly as today
  when ignored.
- Currency default `USD` → `EUR` is **owned by [RFC 01 §3.3](../01-euro-transition/rfc.md)**
  (`NewGroupForm.tsx:15` + `schema.ts:47`). Do not duplicate the change here; if RFC 01
  shipped first this is already done.

### 3.d Collapse the double empty state

- **Replace the dead empty state** ([GroupView.tsx:99-110](../../../src/components/GroupView.tsx))
  with an inline **first-step panel** rendered when `aliases.length <= 1` (owner's own
  alias is auto-created — [actions.ts:154-155](../../../src/app/actions.ts)):
  - A quick-add name input (Enter/comma adds each name via the existing `addAlias`
    action, chips listing those added) — the MembersModal virtual-member form
    ([MembersModal.tsx:383-401](../../../src/components/MembersModal.tsx)) inlined, owner-only.
  - The invite-link block (share/QR from §3.e) so "send the Viber link" is a first-class
    alternative to typing names.
  - A one-line worked example ("Добави Мария и Георги, после първия разход") instead of
    demo data.
  - The panel disappears once a second alias exists; the action buttons above it
    un-disable live (state already flows from server data).
- **Optional combined create form:** add a "Кой участва?" multi-name field to the
  create-group modal, batch-calling `addAlias` after `createGroup` succeeds (client-side
  sequential calls are fine; each is idempotent-ish and validated server-side —
  [actions.ts:250-272](../../../src/app/actions.ts)). Ship the inline panel first; add
  this only if the panel proves insufficient (measure via [RFC 11](../11-reliability-scale/rfc.md)
  analytics if present).

### 3.e Invite sharing upgrade

All in [MembersModal.tsx](../../../src/components/MembersModal.tsx) (+ the §3.d panel,
which reuses the same subcomponent — extract `InviteLinkCard`):

- **Web Share API button** (primary on mobile): feature-detect `navigator.share`; payload
  `{ title: group name, text: t("invite.shareText", { group }), url: link.url }`. The OS
  share sheet reaches Viber/Messenger natively — no per-app deep links needed on mobile.
  Fallback order: `navigator.share` → copy button (existing). Desktop keeps copy + QR.
  Optionally add an explicit `viber://forward?text=<encoded text + url>` anchor when the
  UA is mobile (⚠️ verify on-device; see research §6 — do not build Viber-specific logic
  beyond this one link).
- **QR code** in a small modal ("Покажи QR") for in-person joins: render **client-side,
  no external service** (a chart-API URL would leak invite tokens to a third party —
  forbidden). Add the `qrcode` npm package (zero-config, `toDataURL`/`toCanvas`, works in
  browser) — the project's first runtime dep beyond the core five; acceptable, or
  hand-roll (~250 lines) if the maintainer prefers zero deps. Render lazily (dynamic
  import) so it stays out of the main bundle.
- **Regenerate:** new server action `regenerateInviteLink(groupId)` = revoke active +
  mint new (owner-only, reuse `requireRole`). UI: "Нов линк" button beside Revoke.
  Keep `createInviteLink`'s return-existing semantics for idempotence.
- **TTL 7 → 30 days** ([invites.ts:3](../../../src/lib/invites.ts)): trips are planned
  weeks ahead; regeneration + revoke cover the security delta. Fix the dead
  "emails" comment at [invites.ts:13](../../../src/lib/invites.ts) while touching the file.
- **OG tags for `/join/[token]`** (this RFC owns this page's tags; site-wide OG →
  [RFC 10](../10-growth-marketing/rfc.md)): add `generateMetadata` to
  [join/[token]/page.tsx](../../../src/app/join/%5Btoken%5D/page.tsx) — `og:title`
  „Покана за {groupName}", `og:description` „{inviter} те кани — {n} души",
  `og:image` a **static** branded 1200×630 PNG in `public/` (no per-group image
  generation), `og:type website`. Metadata must not require auth: split a
  `loadInvitePublicPreview(token)` out of `loadInvitePreview`
  ([group-data.ts:249-275](../../../src/lib/group-data.ts)) that skips the membership
  check and returns nothing for invalid/expired tokens (fall back to generic app
  metadata — never confirm token validity to scrapers beyond what the page itself shows).
- **Pre-auth invite preview** (drop-off fix, research §6): stop redirecting logged-out
  visitors immediately ([join/[token]/page.tsx:10-13](../../../src/app/join/%5Btoken%5D/page.tsx));
  render the JoinCard preview (group name, inviter, people count from
  `loadInvitePublicPreview`) with the accept button replaced by "Влез, за да се
  присъединиш" → `/login?callbackUrl=/join/<token>`. The consent notice from §3.b renders
  here too (it is a signup surface).

### 3.f Account settings screen skeleton (shared dependency)

New route `src/app/settings/page.tsx` + `SettingsView` client component; link from the
avatar menu in [AppHeader.tsx](../../../src/components/AppHeader.tsx). Sections:

| Section | Contents | Owner |
|---|---|---|
| Профил | Display name (edits `users.name` via new `updateProfile` action; note it feeds `createLinkedAlias` defaults, not existing per-group aliases — say so in helper text), avatar (read-only from Google), email (read-only) | this RFC |
| Език | The existing locale toggle, relocated/duplicated | this RFC (mechanism [RFC 02](../02-localization/rfc.md)) |
| Показване | Mount point for the leva-equivalent toggle | [RFC 01 §3.5](../01-euro-transition/rfc.md) |
| Известия | Placeholder card „Скоро" | [RFC 07](../07-notifications-engagement/rfc.md) |
| Данни и поверителност | „Изтегли данните ми" + „Изтрий акаунта" entry points wired to RFC 08's flows; links to /privacy, /terms | [RFC 08](../08-privacy-gdpr/rfc.md) |

Ship the skeleton with Профил + Език live and the rest as clearly-labeled placeholders —
the point is that dependent RFCs get a mount point, not that everything works day one.
`updateProfile` validates non-empty trimmed name, max ~80 chars, and must **not** let the
name change affect `activity_log` history (names there are denormalized by design).

## 4. Implementation plan (ordered, independently shippable)

| Stage | Contents | Depends on | Touches |
|---|---|---|---|
| 1 | Invite sharing: `InviteLinkCard` extraction, Web Share, QR, regenerate action, TTL 30d, comment fix | — | `MembersModal.tsx`, `actions.ts`, `invites.ts`, `i18n.ts`, `package.json` (qrcode) |
| 2 | Join-page: pre-auth preview + `loadInvitePublicPreview` + OG tags + static OG image | — | `join/[token]/page.tsx`, `JoinCard.tsx`, `group-data.ts`, `public/` |
| 3 | First-run: template chips, inline first-step panel | — (EUR default via RFC 01) | `NewGroupForm.tsx`, `GroupView.tsx`, `MembersModal.tsx`, `i18n.ts` |
| 4 | Login/Join overhaul: brand glyph, trust strip; consent line once RFC 08 pages exist | RFC 02 (auto-locale), RFC 08 (links) | `login/page.tsx`, `JoinCard.tsx`, `i18n.ts` |
| 5 | `/settings` skeleton + `updateProfile` | — (placeholders for 01/07/08) | `app/settings/`, `AppHeader.tsx`, `actions.ts`, `i18n.ts` |
| 6 | Magic links: verification-token table + migration, minimal adapter, provider, `ensureUser` COALESCE fix, throttle, login-page email form, verify-request page, cron purge | **RFC 07 email infra** | `auth.ts`, `db/schema.ts`, `drizzle/`, `login/page.tsx`, `api/cron/daily/route.ts` |

Stages 1–3 are pure product wins with no external dependencies — ship first (P1).
Stage 6 is the biggest change to the most security-sensitive file; land it last, alone.

## 5. Acceptance criteria

- **Invites:** on a phone, the invite card offers a share button that opens the OS share
  sheet with the URL; a QR modal renders offline (no network request beyond the page);
  "Нов линк" invalidates the old token (old URL → expired page) and shows a new one; a
  fresh link expires 30 days out. No invite token ever appears in a request to a
  third-party host.
- **Join:** a logged-out visit to a valid `/join/<token>` shows group name, inviter and
  people count *without* authentication, plus a login CTA that round-trips back to the
  same token. Pasting a valid join link into a Viber/Messenger chat renders title,
  description and image (⚠️ verify Viber on-device). Invalid/expired tokens render
  generic metadata — `curl -s <url> | grep og:` shows no group name.
- **First run:** create a group via the Trip chip → name placeholder is trip-flavored,
  `simplifyDebts` is on; the group page shows the inline panel (not the dead state);
  typing two names + Enter enables Add Expense without opening any modal. Creating via
  "Other" with everything ignored behaves byte-for-byte like today.
- **Login page:** with `Accept-Language: bg` and no cookie, all copy renders Bulgarian
  (once RFC 02 lands); trust strip and consent line present, links resolve (no 404s);
  no checkbox anywhere; no `$` glyph.
- **Settings:** `/settings` renders for a signed-in user; renaming the profile updates
  the dashboard header name and future group memberships but no activity-log history.
- **Magic links (stage 6):** an email address with no Google account can sign in and
  lands on the same dashboard; a Google user signing in via magic link with the same
  email sees the same groups and **keeps their name/avatar** (regression test on
  `ensureUser`); tokens are single-use and expire (~15 min); a 4th link request within an
  hour is refused with a localized message; `signIn` callback still rejects unverified
  Google profiles. Existing tests (`npm run test:math`, receipt suites, `db-smoke`) pass;
  new adapter unit test covers create/use/expire of verification tokens.

## 6. Risks & alternatives considered

- **Viber's in-app browser may block Google OAuth** (`disallowed_useragent`) — the exact
  failure mode of our primary share channel meeting our primary auth. ⚠️ Test on-device
  early (stage 2); magic links (stage 6) are the structural mitigation since they route
  through the mail app. If confirmed, add an "open in browser" hint on the join page for
  Viber UAs.
- **Partial Auth.js adapter is unsupported territory:** the docs assume a full adapter.
  Mitigation: implement exactly the methods the email+JWT flow calls, integration-test
  the full sign-in round trip against PGlite, and pin the `next-auth` beta version —
  it is already pinned by lockfile; note the risk of beta drift in a comment.
  Alternative (full `DrizzleAdapter` + DB sessions) rejected: larger blast radius,
  changes session semantics for every existing user for zero product gain.
- **Email deliverability** (magic links landing in spam) is inherited from RFC 07; do not
  ship stage 6 before RFC 07's domain/SPF/DKIM checklist is green.
- **OG metadata leaks group names to anyone who scrapes a leaked link.** Accepted: the
  join page already shows the same fields post-auth to any token holder; the public
  preview adds no new data, and expired/invalid tokens reveal nothing. Alternative
  (generic preview only) rejected — a faceless invite converts measurably worse in chat.
- **Template creep:** presets must stay placeholder+settings; resist adding a `type`
  column or type-specific screens until a real behavioral difference exists.
- **`qrcode` dependency** breaks the zero-runtime-deps streak. Alternatives: hand-rolled
  encoder (more code to own) or no QR (loses the in-person flow). The dependency is
  small, stable, and lazily loaded — accepted.
- **Longer invite TTL widens the bearer-token window** ([audit §8](../00-current-state-audit.md)).
  Mitigated by regenerate + revoke and accepted consciously; per-invitee tokens and
  scoped previews remain future work under RFC 08's security items.
