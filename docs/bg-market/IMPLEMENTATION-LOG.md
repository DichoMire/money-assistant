# Implementation Log

> Two batches so far: the **personal-project batch** (2026-08-24, below) and
> the **release-prep batch** (2026-08-26, [appendix at the bottom](#release-prep-batch-2026-08-26))
> which implemented the commercial scope of RFCs 03, 04, 06, 07, 08, 10 and
> the rest of 11, plus RFC 09's metering/entitlements foundation.
> What only the owner can do next lives in [OWNER-CHECKLIST.md](OWNER-CHECKLIST.md).

# Personal-Project Batch (2026-08-24)

> **What this is:** the record of the first implementation pass over the
> [improvement guide](README.md), scoped by the owner to the "personal project used with
> friends" subset: priority items **1–11** (with #9 as an account setting) plus **15–16**;
> items 12–14 and everything commercial (monetization, GDPR build-out, growth, PWA
> service worker) deliberately deferred. Written for whoever (human or LLM) picks the
> work up next: what was done, what was decided differently from the RFCs and why, and
> what remains.

**Verification state at the end of this batch:** `npm run test:math` ✅ ·
`npx tsx scripts/receipt.test.ts` ✅ · `npx tsx scripts/receipt-db.test.ts` ✅ ·
`npx tsx scripts/db-smoke.ts` ✅ (fresh PGlite, migrations 0000→0005) ·
`npm run lint` ✅ · `npx tsc --noEmit` ✅ · `npm run build` ✅ (routes `/settings` and
`/manifest.webmanifest` present).

---

## What was implemented

### 1 · Euro-changeover correctness — [RFC 01](01-euro-transition/rfc.md) stages 1–2 (P0)

- `src/lib/rates.ts`: new `FIXED_EUR_RATES` (BGN 1.95583, HRK 7.5345), `roundHalfUp`
  (half away from zero — `Math.round(-0.5)` is wrong for the legal rule), `isFixedLegPair`,
  `eurToBgnCents`, and a rewritten `convertCents`: fixed legs convert **without any rate
  row**, mixed pairs (BGN→USD) chain fixed-leg-first with rounding to integer cents at
  the legal conversion boundary; floating↔floating keeps the legacy single-step math
  bit-for-bit (existing tests unchanged).
- **Behavior change:** BGN→USD style conversions can differ by 1 cent from the old
  single-step formula (the smoke test's 11.00 лв → $6.19 became $6.18). The new value is
  the legally correct one (round at the BGN→EUR boundary); `scripts/db-smoke.ts`
  expectations updated.
- `src/lib/group-data.ts`: `rates.needsConversion` now means "needs an **ECB** rate" —
  a EUR group full of BGN history no longer triggers the stale-rates popup; fixed-leg
  conversions carry `rateDate: null` (no misleading "rate from" tooltip). New
  `rates.excludedCount` counts expenses excluded from balance math.
- `src/components/BalancesPanel.tsx`: **red, non-dismissible banner** when
  `excludedCount > 0` ("N разхода… НЕ са включени в тези салда"), replacing the silent
  drop as the only signal.
- `src/app/actions.ts`: `saveExpense` and `saveSettlement` now **refuse** a currency that
  can't convert to the group currency (`currencyConversionError` helper + new
  `errors.noRateForCurrency` key) — fail loud at entry, not at display.
- Tests: fixed-leg cases in `scripts/math.test.ts` (no-row BGN↔EUR, half-up boundaries,
  negative symmetry, round-trip ≤1 stotinka, BGN→USD chain, null on missing floating leg).

**Deviations from RFC 01:** the dashboard red dot for missing rates was skipped
(computing FX per group on the dashboard is expensive; the in-group banner + entry guard
cover it at friends scale). Stages 3–4 (retiring BGN from pickers, migrating BGN groups
to EUR) were **not** in the chosen scope — BGN stays selectable and now always converts
correctly via the fixed leg, which makes those stages less urgent than the RFC assumed.

### 2 · `parseAmount` rewrite — [RFC 02](02-localization/rfc.md) stage 2

- `src/lib/money.ts`: deterministic EU-style parser. `"12,34"` → 12.34; `"1 234,56"`
  (any space incl. NBSP) → 1234.56; `"1,234.56"` / `"1.234,56"` → 1234.56;
  **`"1.234"` → 1234.00** (3 trailing digits = thousands — this was previously a *silent
  misparse to 1.23*); `"1,2345"` → invalid. `parseNumber` also strips spaces now.
- Note the deliberate semantic: a single separator with exactly 3 trailing digits reads
  as grouping. Someone typing `"1.234"` meaning 1 лв 23.4 ст was already losing money
  silently before; now it's the documented EU convention. Test matrix in `math.test.ts`.

### 3 · Paid LLM endpoint — **REVERTED same day by owner decision**

- Was implemented (paid defaults `google/gemini-2.5-flash-lite` +
  `anthropic/claude-haiku-4.5`), then **reverted at the owner's request** — the app is
  back on the original free ladder (`nvidia/nemotron-nano-12b-v2-vl:free` →
  `dots-studio/dots-3-note-preview:free` → gemma variants), no funded OpenRouter account
  required. `src/lib/receipt-parse.ts` and `.env.example` are byte-identical to the
  pre-batch state.
- The original caveats therefore stand (and are still documented in `.env.example`):
  free endpoints may train on inputs and are unreliable (shared rate-limit pools,
  hangs). **Switching to a paid model remains a one-env-var change**
  (`OPENROUTER_MODEL`) and should happen before anyone outside the friend group uploads
  receipts. RFC 04 stage 1 is back to fully outstanding.

### 4 · Timezone-correct "today" — RFC 01 stage 6 (partial)

- Server: `todayString()` in `rates.ts` now pinned to **Europe/Sofia**.
- Client: new `localTodayString()` in `src/lib/format.ts` (device-local, not Sofia — the
  right choice client-side) used for the date defaults in `ExpenseModal` and `SettleModal`.
- Not done from stage 6: rate-gap repair after missed crons, `approxRate` ≈-flag for
  earliest-row fallback (see Outstanding).

### 5 · Real transactions — [RFC 11](11-reliability-scale/rfc.md) workstream (a) (core)

- `src/db/index.ts`: new **`withTransaction(fn)`** — PGlite uses its native transaction
  locally; production opens a short-lived **Neon WebSocket `Pool`** per call
  (`drizzle-orm/neon-serverless`), ended in `finally`. New runtime dep: `ws` (+
  `@types/ws`), loaded only when no global `WebSocket` exists.
- Wrapped: **`saveExpense`** (the delete-then-reinsert of payers/shares can no longer be
  torn), **`saveSettlement`**, **`deleteExpense`**, **`deleteGroup`**, and
  **`attachAlias`**'s merge (`mergeAliasReferences` + delete + relink).
- Design note: validation stays outside the transaction; in-transaction early exits
  return `{error}` through the callback rather than throwing.
- Not wrapped (outstanding): `persistScanEdits` / receipt-actions paths, `joinGroup`.
  Per-call Pool costs ~1 extra round-trip on mutations only — acceptable at this scale
  (RFC 11's cached-pool optimization can come later).

### 6 · EUR defaults

- `NewGroupForm` state default and the DB column default (`groups.currency`) are now
  `EUR` (migration `drizzle/0005_euro-personal.sql`).

### 7 · Bulgarian number formatting — RFC 02 stage 1

- `formatCents(cents, currency, locale = "en")`: `Intl.NumberFormat` with `narrowSymbol`
  and a formatter cache — bg renders `12,34 €` / `12,34 лв.`, en keeps `€12.34`.
- Threaded through **every UI call site** via a per-component `money()` wrapper:
  `BalancesPanel`, `ExpenseList`, `ExpenseDetailModal`, `ExpenseModal`, `SettleModal`,
  `ScanReviewView`, `ScanAssignModal`, `ScanUploadView`, `ActivityModal`.
- Shared lib error messages (`split.ts`, `receipt-convert.ts`) format via **`t.locale`** —
  `TFunc` now carries its locale (`makeT` attaches it), so amounts inside translated
  errors match the words.
- **Deliberate exception:** the audit-log diff fragments built in `actions.ts` keep the
  default `"en"` formatting — they are *stored data* (the RFC 02 stage-3 structured-diff
  redesign is the real fix and remains outstanding).

### 8 · Accept-Language default locale — RFC 02 stage 4

- `src/lib/i18n-server.ts`: `negotiateLocale()` (q-ordered parse, primary-subtag match);
  `getLocale()` = cookie wins, else Accept-Language, else `en`; `headers()` failure falls
  back safely. A Bulgarian browser now lands in Bulgarian on first visit; the EN/БГ
  toggle still overrides permanently via the cookie.

### 9 · Leva-equivalent as an **account setting** (owner-adjusted RFC 01 stage 5)

- The RFC proposed a cookie; the owner asked for an account setting — implemented as
  **`users.show_bgn_equivalent`** (migration 0005) so it follows the account across
  devices.
- New **`/settings`** page (`src/app/settings/page.tsx` + `AccountSettings.tsx`):
  language toggle + the leva switch with the "informational, fixed 1 € = 1,95583 лв."
  hint; ⚙ link in `AppHeader`. Server action: `src/app/user-actions.ts`.
- Display: `BalancesPanel` (net amounts + debt rows) and `ExpenseDetailModal` (main
  amount) append a muted `≈ 39,12 лв.` when the amount's currency is EUR — deliberately
  *not* on every list row (clutter). i18n keys live under **`account.*`** (`settings.*`
  was already taken by the group-settings modal — naming collision found by tsc).

### 10 · PWA installability (manifest + icons only — [RFC 05](05-mobile-pwa/rfc.md) subset)

- `src/app/manifest.ts` (served at `/manifest.webmanifest`, auto-linked): standalone
  display, id `/`, brand icons.
- Icons generated (GDI+ script, brand `#1cc29f` tile + white `$`, matching the login
  tile): `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (smaller glyph =
  mask safe zone), `apple-touch-icon.png` (180px).
- `layout.tsx`: `icons.apple` + `appleWebApp` metadata.
- Not done (deferred with the rest of RFC 05): service worker/offline, install prompt,
  webview escape hint, dark mode.

### 11 · Web Share on invites — [RFC 06](06-onboarding-auth/rfc.md) stage 1 subset

- `MembersModal`: a **Share** button next to Copy (rendered only when
  `navigator.share` exists — i.e. phones), sharing a localized message with the URL
  embedded in the text so Viber/Messenger render a preview. Share-sheet cancel is not
  treated as an error. QR code, link regeneration, and 30-day TTL were not included.

### 15 · First-run collapse — RFC 06 stage 3 subset

- `NewGroupForm`: **template chips** (Пътуване / Съквартиранти / Двойка) that prefill
  the name; localized.
- `GroupView`: the dead "Add people first" empty state is now (for owners) an **inline
  add-people form** — type a name, press Добави, repeat; server-action revalidation
  refreshes the alias list live, and the panel yields to the normal view at the first
  person. Members still get the modal button.

### 16 · "New activity" dot — [RFC 07](07-notifications-engagement/rfc.md) stage 1 subset

- New **`group_reads`** table (groupId+userId PK, `last_seen_at`; migration 0005).
- Opening a group page upserts the watermark (`markGroupSeen`, failure-tolerant).
- `loadGroupSummaries` computes `hasNews`: newest audit entry **by someone else**
  (`actor_user_id IS DISTINCT FROM me`) newer than my watermark → brand-colored dot on
  the dashboard card (`dashboard.newActivity` tooltip). No bell/in-group badge yet.

---

## Cross-cutting notes

- **Migration:** one new file, `drizzle/0005_euro-personal.sql` — `users.show_bgn_equivalent`,
  `groups.currency` default EUR, `group_reads` table. Applied automatically to PGlite on
  first connect; for Neon run `npm run db:push` (or apply the migration) on next deploy.
- **New i18n keys** (all EN+BG): `header.settings`, `account.*` (5), `balances.excluded*`
  (3), `errors.noRateForCurrency`, `members.share`, `members.shareText`,
  `newGroup.templates*` (4), `group.quickAdd*` (2), `dashboard.newActivity`.
- **New dependencies:** `ws` (runtime, Neon WebSocket transactions), `@types/ws` (dev).
- **⚠️ Incident during testing:** the local `.pglite/` dev database was deleted by a
  cleanup step after a failed rename (the smoke test needed a fresh DB). Production/Neon
  data was never involved; a fresh `.pglite` was recreated from migrations and the smoke
  suite passes. If you had local dev-login data, re-seed with
  `npx tsx scripts/seed-dev.ts you@example.com` (dev server stopped).

## Outstanding — deferred by scope choice (items 12–14 skipped by owner)

| What | Where specified | Why it matters later |
|---|---|---|
| Settle-up payment helpers (IBAN card, blink, Revolut, EPC QR) | [RFC 03](03-settle-up-payments/rfc.md) | The headline "made for Bulgaria" feature |
| BG receipt-era prompting + eval harness | RFC 04 stages 2–3 | Accuracy on 2026 EUR-only receipts |
| Viber-webview "open in browser" escape on `/join`,`/login` | RFC 05 | Invite links opened in Viber can dead-end at Google OAuth |

## Outstanding — within touched areas (natural next steps)

- **Rate-gap repair + `approxRate` flag** (RFC 01 stage 6 remainder): missed cron days
  are still permanent gaps; pre-history expenses silently use the earliest row.
- ~~**BGN retirement + BGN-group migration** (RFC 01 stages 3–4)~~ **Done 2026-08-25** —
  see the addendum below; by owner decision the removal went *further* than the RFC
  (stored BGN data rewritten to EUR, superseding RFC 01 §6).
- **Structured audit-log fragments** (RFC 02 stage 3): diffs are still stored as English
  strings; new entries keep accruing in en formatting.
- **Transactions for receipt actions** (`persistScanEdits`, convert/delete paths).
- **Scan metering** (RFC 04 stage 4): the paid endpoint now has real (tiny) per-scan
  cost and no quota; fine among friends, required before any public exposure.
- **Localized `<title>` / remaining RFC 02 stage 5 polish.**
- The rest of RFC 05 (service worker, install prompt, dark mode) and RFC 07 (bell,
  email) when appetite returns.

## RFC status stamps

Each affected RFC now carries a status line pointing here: RFC 01 (stages 1–2 + 5–6
partial ✅), RFC 02 (stages 1, 2, 4 ✅), RFC 04 (stage 1 implemented then **reverted** —
fully outstanding), RFC 05 (manifest/icons ✅), RFC 06 (stages 1/3 subsets ✅), RFC 07
(stage 1 subset ✅), RFC 11 ((a) core ✅).

---

# Addendum — BGN fully removed (2026-08-25)

Owner decision: remove BGN from the application entirely, **including** a one-time
rewrite of stored BGN data to EUR — explicitly superseding RFC 01 §6's "never rewrite
stored amounts" stance and closing RFC 01 stages 3–4 (see the struck-through
outstanding item above).

- **`drizzle/0007_remove-bgn.sql`** — combined data + schema migration, idempotent
  (a re-run finds no BGN rows and changes nothing):
  - Expenses, payers, and shares converted at the fixed rate 1.95583 (half away from
    zero per amount); per-expense rounding drift settled on the largest payer/share row
    so `sum(paid) = sum(owed) = amount` stays exact. `split_value` converted for the
    cents-denominated methods (`exact` mirrors the converted `owed_cents`;
    `adjustment` converted directly); percent/shares values untouched.
  - Receipt scans, items, and exact-mode item shares converted the same way;
    `reconciles` recomputed afterwards (per-field rounding can shift the identity by
    a cent).
  - BGN groups flipped to EUR with a `group.currency_changed` audit entry
    (actor "System") per group; `fx_rates` rows scrubbed of stale `BGN` keys;
    `users.show_bgn_equivalent` dropped (`IF EXISTS`, so the file re-runs cleanly).
- **`scripts/migrate-bgn-to-eur.ts`** — guarded runner for the hosted DB: dry-run by
  default (prints BGN row counts), `--yes` applies the 0007 file inside one
  transaction. PGlite applies 0007 automatically on next start; **Neon needs this
  script (or the SQL applied manually) — `npm run db:push` syncs schema only and
  never runs the data statements.**
- **Code removals:** `BGN` out of `CURRENCIES` (all pickers + validation follow);
  `FIXED_EUR_RATES` now HRK-only; `eurToBgnCents` deleted; the leva-equivalent
  account setting (§9 above) removed end-to-end — `src/app/user-actions.ts` deleted,
  `AccountSettings` toggle gone, `GroupDto.showBgnEquivalent` gone,
  `account.showBgn`/`account.showBgnHint` i18n keys gone, "≈ лв." displays removed
  from `BalancesPanel` and `ExpenseDetailModal`.
- **Receipt prompt:** the `"лв" means BGN` hint became "ignore лв amounts, extract the
  euro values" (2026 Bulgarian receipts dual-print an informational lev total).
- **Tests:** fixed-leg coverage in `math.test.ts` and `db-smoke.ts` moved from BGN to
  HRK (round-trip tolerance widened to ±4 cents for the larger rate); `seed-dev.ts`'s
  foreign-currency expense is now GBP. The migration itself was verified against an
  in-memory PGlite (conversion values, drift correction, `reconciles` recompute,
  audit entries, idempotency) via a temporary script, since removed.
- **Left alone by design:** historical activity-log entries keep their original BGN
  amounts and wording — the audit trail is a denormalized record of what actually
  happened and is not rewritten.

Verification: `npm run test:math` ✅ · `npm run test:receipt` ✅ ·
`npm run test:receipt-db` ✅ · `npx tsx scripts/db-smoke.ts` ✅ (fresh PGlite,
migrations 0000→0007) · `npm run lint` ✅ · `npx tsc --noEmit` ✅ ·
`npm run build` ✅.

---

# Release-Prep Batch (2026-08-26)

> One autonomous implementation run (branch `release-prep`, commits
> `dd1f1be`…) taking the app from "polished hobby" to "launchable product"
> per the owner's planning decisions: **paid LLM env-ready but free defaults
> kept · full email + magic links (dormant until Resend env) · metering +
> entitlements but no Paddle code · landing/SEO/legal drafts in · service
> worker + dark mode out.** Verification at every stage and at the end:
> `npm test` (8 suites incl. 4 new), `npm run lint`, `npx tsc --noEmit`,
> `npm run build` — all green. Migrations 0008–0013 (see OWNER-CHECKLIST §1
> for the Neon apply procedure — two carry data backfills).

## What shipped, per RFC

- **RFC 01 — complete.** Stage 6 remainder: FX gap repair (missed cron
  weekdays fetched via the range endpoint, TARGET-holiday-safe) and the
  `approxRate` flag (pre-history conversions render an amber ≈ chip).
- **RFC 02 — complete.** Stage 3: `details.changes` now stored as
  `{key, params}` fragments rendered in the viewer's locale (legacy strings
  verbatim; `SPLIT_METHOD_LABELS` deleted; `actions.ts` no longer formats
  money/dates into stored data). Stage 5: localized `<title>`, deliberate
  bilingual toggle aria-label, locale-aware `0,00` placeholders.
- **RFC 03 — complete (code).** `payment_profiles` (IBAN mod-97 + holder
  name required together, blink E.164, Revolut tag), server-enforced
  shared-group visibility, settings editor, how-to-pay card in the settle
  modal (copy-first SEPA fields, blink steps + free-≤€150 badge, revolut.me,
  on-demand EPC069-12 QR at level M with 331-byte note-only truncation),
  settlement method tag + chip, creditor-side request-payment and
  balance-summary shares (`share-text.ts`). `scripts/epc.test.ts`. The
  pre-ship empirical checklist is the owner's (checklist §6).
- **RFC 04 — complete (code); model switch is the owner's env flip.**
  Env surface (`RECEIPT_API_URL`/`RECEIPT_API_KEY`/`OPENROUTER_ZDR`,
  EU-endpoint recipe, structured outputs for non-`:free` models, cost +
  latency capture), era-aware prompt/validator (dual-total cross-check at
  1.95583 ±1 стотинка, VAT groups А–Г with raw-text fallback, line typing,
  and — post-BGN-removal — BGN receipts normalized to EUR at the fixed rate),
  eval harness (`scripts/receipt-eval.ts` + gitignored fixtures + manual CI
  job), metering (see RFC 09), image retention (keep-photo checkbox,
  delete-on-convert, 30-day draft sweep, backfill script), unit-level "по
  бройки" splitting with steppers, one-shot retry-at-higher-res, queue
  triggers documented in code.
- **RFC 06 — complete except things needing devices/email.** Invite QR
  (client-rendered), link regeneration, TTL 30d; pre-auth join preview with
  OG tags via a token-nonconfirming public loader; login overhaul (trust
  strip, consent line, € brand mark shared via `BrandMark`); settings screen
  grew profile editing (+ payment/notification/privacy sections); **magic
  links** via a minimal custom Auth.js adapter (single-use tokens, JWT
  sessions kept, no accounts table, 3 links/hour throttle, branded
  check-email page) — registered only when email env exists; the `ensureUser`
  COALESCE landmine fixed.
- **RFC 07 — complete except push (out of scope with the service worker).**
  `notifications` table + `notifyUsers` at every relevant call site, header
  bell + mark-read panel, `users.locale` capture, digest-by-default email
  policy implemented structurally (two immediate types only), Resend via
  plain REST (documented deviation from react-email/SDK), per-user daily
  digest with 14-day window + 90/day cap + idempotent `emailedAt`, RFC 8058
  one-click unsubscribe, prefs card, „Напомни" with server-recomputed debt +
  7-day per-debtor limit. `scripts/notify.test.ts` (mocked Resend).
- **RFC 08 — complete.** Email minimization (writers + jsonb backfill),
  account deletion with detach-to-virtual semantics / conflicted-group
  resolution UX / ownership transfer / tombstoned actor names /
  `groups.userId` FK → RESTRICT, JSON export with 10-min throttle, `/privacy`
  + `/terms` full bg+en drafts (lawyer review pending — checklist §3),
  consent surfaces (login line, one-time banner, scan-page vendor caption +
  first-use dialog), `docs/ROPA.md`. `scripts/account.test.ts` proves other
  members' balances stay byte-identical through a deletion.
- **RFC 09 — stages 1–2 only (owner decision).** `scan_usage` Sofia-month
  metering (check-before-LLM, increment-after-success, duplicates free,
  fails open), `users.plan`/`plan_expires_at` + `entitlements.ts` with the
  FREE-FOREVER constraint comment and 72h fail-open grace, quota UX behind
  `SCAN_QUOTA_ENFORCED` (off). No Paddle code — §7 of the checklist.
- **RFC 10 — code stages complete.** Bulgarian-always landing at `/` for
  logged-out visitors + `/en` twin, OG cards (generated, script included),
  hreflang/robots/sitemap/noindex-login, FAQPage JSON-LD, blog scaffold with
  the six-article queue documented, `?ref=` first-touch attribution into
  `users.signup_ref`, share payloads. Articles/playbook/ads are the owner's.
- **RFC 11 — all workstreams except pagination (P3).** (a) transactions now
  cover receipt paths/joinGroup/createGroup; set-based `mergeAliasReferences`
  and `deleteGroup`. (b) in-Postgres sliding-window rate limits on the four
  hot actions + write ceiling. (c) Sentry via envelope API (no SDK —
  documented deviation), `CRON_PING_URL` dead-man's switch, cookieless
  Vercel Analytics. (d) CI (8 suites, secret-free) + Dependabot. (e) HSTS,
  `camera=(self)`, nonce CSP report-only with `CSP_ENFORCE` flip, cron
  fail-closed. (f) `ReceiptImageStore` abstraction (bytea adapter). (g) fx
  query bounded + skipped for fixed-leg groups, Map joins, 8 indexes.
  (h) nightly backup workflow + restore runbook. Deferred: (g5) expense
  pagination (P3 — revisit at ~1–2K-expense groups).

## Notable cross-cutting decisions (beyond the RFC texts)

- **BGN-era receipts** are normalized to EUR at 1.95583 during validation
  (the RFCs predate the owner's full BGN removal; this keeps pre-2026
  receipts scannable and consistent with migration 0007's philosophy).
- **Brand glyph $ → €** across header/login/join/PWA icons/OG cards
  (RFC 06's "wrong-currency signal"); one-place revert via `BrandMark` +
  `scripts/generate-brand-assets.ps1`.
- **No new SDKs**: Resend, Sentry and Paddle-someday all speak plain
  `fetch`, matching the repo's OpenRouter/Frankfurter pattern. New runtime
  deps this run: `qrcode` (lazy-loaded), `@vercel/analytics`.
- `db-smoke` now runs against a throwaway `.pglite-smoke/` dir (`PGLITE_DIR`)
  — the incident class that once deleted local dev data is closed.
- Landing copy lives in a locally-typed dict inside `LandingPage.tsx` rather
  than ~40 `landing.*` app-dictionary keys (same bg-completeness guarantee).

## New test suites (all in CI)

`reliability` (tx rollback, rate limiter incl. sliding weight, FX gap repair
with mocked fetch, approx flag) · `account` (deletion engine end-to-end) ·
`epc` (EPC payload byte-exactness, IBAN fixtures, share text) · `notify`
(recipient computation, email guard rails, digest idempotency) — plus era/
units/VAT coverage added to `receipt`, and `test`/`typecheck` npm scripts.
