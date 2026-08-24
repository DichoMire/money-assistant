# Money Assistant — Current-State Audit

> **Purpose**: factual map of the application as it exists today, produced as the foundation
> for the Bulgarian-market improvement guide ([README.md](README.md)).
> Audited at commit `14963d2`, 2026-08-24. This document describes **what is**, not what should be —
> improvement proposals live in the per-topic research docs and RFCs.

**Scale:** ~93 tracked files, ~14k LOC excluding lockfile. Next.js 15.5 + React 19.1, Drizzle 0.45,
next-auth 5.0.0-beta, Tailwind v4. Zero runtime dependencies beyond those five (`package.json`) —
no UI kit, no form lib, no validation lib, no test runner, no analytics SDK.

---

## 1. Feature inventory

### 1.1 Groups
- Create (name + currency from a 31-code list), rename, change currency, delete, `simplifyDebts` toggle. `src/app/actions.ts:142-229`, `src/components/NewGroupForm.tsx`, `SettingsModal.tsx`.
- Owner is implicit (`groups.userId`); no `group_members` row for them (`src/db/schema.ts:65-79`). Roles are exactly two: `owner` | `member` (`src/lib/types.ts:8`).
- Dashboard lists owned + joined groups with person/expense/account counts (`src/app/page.tsx`).
- **Limitations:** no group archiving, no group avatar/color/category, no group-level notes, no "recent activity" preview on the dashboard card, no search/filter, no pagination (all groups and *all* expenses load at once). Currency default in the create form is hardcoded `"USD"` (`NewGroupForm.tsx:15`) and DB default is `'USD'` (`schema.ts:47`) — no locale-aware default.
- Only the owner can change settings, add people, invite, remove members (`requireRole(..., "owner")`). Members can add/edit/delete *any* expense in the group, including ones they didn't create (`actions.ts:576`, `:701`, `:814` all use `"member"`).

### 1.2 Members / virtual members / attach
- `aliases` = participants. `userId != null` → real account, `null` → virtual member (`schema.ts:55-63`).
- Owner adds virtual members by name; duplicate names rejected case-insensitively (`actions.ts:250-272`).
- Owner renames anyone; a member can rename only their own alias (`actions.ts:282-307`).
- Delete virtual member blocked if they appear in any expense (`actions.ts:318-327`) — the only way out is deleting those expenses.
- **Attach** virtual → account, merging histories via `mergeAliasReferences` (`src/lib/merge-alias.ts`), which sums `paidCents`/`owedCents` and sums `splitValue` (null-safe). Owner-only.
- Remove member / leave group both *detach* (`aliases.userId = null`) rather than delete, preserving history (`actions.ts:380-426`). Owner cannot leave; must delete the group.
- **Limitations:** `mergeAliasReferences` runs N+1 queries in a loop with no transaction (Neon HTTP driver has no transactions — noted in `receipt-actions.ts:100`). A partial failure mid-merge leaves the data inconsistent. Attach is irreversible from the UI.

### 1.3 Invites
- **Invite-link only** — the app never sends email. Link = `randomBytes(24).toString("base64url")`, 7-day TTL (`src/lib/invites.ts`).
- One active link per group; `createInviteLink` returns the existing one rather than minting a new one (`actions.ts:508-522`). Revoke sets `status='revoked'`. Daily cron flips expired → `expired` (`api/cron/daily/route.ts:22-26`).
- **Circle**: people you already share any group with are searchable by name/email and join instantly with no invite (`loadCircle` in `group-data.ts:219-246`, `addCircleMember` in `actions.ts:442-470`).
- Logged-out visitors → `/login?callbackUrl=/join/<token>` → Discord-style `JoinCard`. Same-site relative redirect only (`login/page.tsx:12-16`).
- **Limitations:** no way to share the link except copy-to-clipboard — **no Web Share API, no QR code, no Viber/WhatsApp/Messenger deep link**. Base URL comes from `APP_URL` or `VERCEL_PROJECT_PRODUCTION_URL` (`invites.ts:14-20`); if unset in a preview deploy the link points at localhost. The comment on `appBaseUrl` still says "for links placed in emails" — dead reference to the removed email flow.

### 1.4 Expenses & split methods
- Five methods: equal, exact, percent, shares, adjustment (`src/lib/split.ts:4-13, 32-119`). All five support include/exclude toggles per person (`ExpenseModal.tsx:77-82`).
- Multiple payers supported (`expense_payers` is a table, not a column).
- `splitValue` stores the raw user input so the edit UI restores exactly what was typed (`schema.ts:128-143`).
- `ExpenseModal` is a 3-view drill-down (main → payers → split) with live per-person previews and a running "entered / left" footer.
- `ExpenseDetailModal` shows payers, owers, split hints (`50%`, `2 shares`, `+€3.00 adj.`), link to the source receipt, edit + delete.
- Per-expense "personal impact" column ("you owe" / "you lent") on the list (`ExpenseList.tsx:28-34`).
- **Limitations:** no categories, no notes/comments, no attachments (other than a scan), no recurring expenses, no expense search or date filtering, no "itemized" split outside the receipt flow. Delete failure surfaces via `window.alert(result.error)` (`ExpenseList.tsx:50`, `ScanUploadView.tsx:119`) — the only two non-localized-dialog error paths left. Deletion is hard-delete, no undo, no soft-delete.

### 1.5 Settlements
- Stored as `expenses.kind='settlement'` with one payer + one share, so they flow through the same balance math (`actions.ts:696-805`).
- `SettleModal` prefills from a debt row when launched via the "Settle" button in the balances panel.
- **Limitations:** description is hardcoded `"Payment"` in English at insert time (`actions.ts:747`) — never shown (the UI substitutes `t("expenses.payment")`), but it is what lands in the DB. No payment method/reference field, no reminders, no partial-settle helper beyond typing an amount. Settle-up is pure bookkeeping — no link to any actual money movement.

### 1.6 Balances & simplify
- Balances are **computed on the fly** from transactions every page load; nothing derived is persisted (`group-data.ts:166-205`).
- Two views: `pairwiseDebts` (netted per pair) and `simplifiedDebts` (greedy max-debtor/max-creditor, ≤ n−1 payments) — `src/lib/simplify.ts:112-190`.
- Rounding write-off of ≤ 2 cents with multi-pass absorption (`simplify.ts:16-56`) plus `applyNetCorrections` to keep pairwise debts consistent with forgiven nets (`simplify.ts:63-90`).
- Chips in the panel are derived from the displayed debt list so they always agree with it (`BalancesPanel.tsx:28-39`).
- **Limitations:** the simplify toggle is owner-only and group-wide. No per-person "total across all groups" view. No dedicated settlement-history view.

### 1.7 Multi-currency + FX
- 31 currencies, exactly the ECB/Frankfurter set (`src/lib/currencies.ts`).
- Daily cron fetches `api.frankfurter.dev/v1/latest`; first run backfills 90 days (`src/lib/rates-fetch.ts`).
- Conversion picks the latest row ≤ transaction date, else the earliest row available (`rates.ts:10-18`).
- Stale-rate popup (>7 days) with "Update rates now" (`RateWarningModal.tsx`), dismissal remembered in `sessionStorage` per group.
- **Limitations:** see §5 — significant, including a euro-changeover break.

### 1.8 Receipt scanning
See §2. Complete happy path (upload → parse → review → assign → convert), but on free LLM endpoints.

### 1.9 Activity log
- `activity_log` table, jsonb details, denormalized names (`schema.ts:149-159`).
- 22 action types rendered in `ActivityModal.tsx:12-74`. Visible to **all members**, capped at 200 rows, no pagination (`actions.ts:121-138`).
- Field-level diffs for expense/payment edits (`actions.ts:61-118`).
- **Limitation:** the diff fragments are **built in English on the server and stored as data** (`actions.ts:77-116`: `description "X" → "Y"`, `amount`, `date`, `split method`, `paid by`, …). `ActivityModal.tsx:16` acknowledges this: *"Stored details.changes fragments are historical data and stay as written."* They will always render in English for Bulgarian users. `participantSummary` also emits `"${ids.length} people"` (`actions.ts:51`), and dates inside diffs use `formatDate(...)` with no locale → English months (`actions.ts:85, 792`).

### 1.10 Settings
- Only *group* settings exist (`SettingsModal.tsx`): name, currency, delete group. **There is no user/account settings screen at all** — no profile, no display-name change (except per-group alias rename), no default currency, no notification prefs, no account deletion, no data export. The language toggle lives in the header.

---

## 2. Receipt scanning — full pipeline

### Provider & models
- **OpenRouter**, OpenAI-compatible chat completions via plain `fetch`, no SDK (`src/lib/receipt-parse.ts:22`).
- Primary model default: **`nvidia/nemotron-nano-12b-v2-vl:free`** (`receipt-parse.ts:23`).
- Fallback ladder default: `dots-studio/dots-3-note-preview:free`, `google/gemma-4-26b-a4b-it:free`, `google/gemma-4-31b-it:free` (`receipt-parse.ts:24-28`).
- **Doc drift:** `.env.example:36-39` documents only two fallbacks and omits `dots-studio/dots-3-note-preview:free`.
- Overridable by `OPENROUTER_MODEL` / `OPENROUTER_FALLBACK_MODEL`. `.env.example:29-32` warns that `:free` endpoints may train on inputs and that receipts carry card last-4 / loyalty IDs, and that the model should be switched before real users' receipts are involved. **This has not been done — the shipped default is a free endpoint.**
- Request params: `temperature: 0`, `max_tokens: 8000`, `reasoning: { enabled: false }`.

### Flow
1. **Client downscale** (`ScanUploadView.tsx:14-65`): `createImageBitmap` with EXIF correction, fallback to `<img>.decode()`. Max edge 2000px, or 2800px for tall (aspect ≥ 1.8) receipts. JPEG q0.8, re-encoded at q0.6 if > 2.5 MB.
2. **Upload** as FormData through a server action; Next body limit raised to 4 MB (`next.config.ts:9-11`), server rejects > 3.5 MB and non-JPEG/PNG/WebP (`receipt-actions.ts:30-31, 48-53`).
3. **Dedupe**: SHA-256 of the bytes; same hash in the same group short-circuits to the existing scan with no LLM call (`receipt-actions.ts:55-63`). Indexed on `(group_id, image_hash)`.
4. **Parse**: model ladder walked with a 35 s per-attempt timeout and an 80 s total budget, sized against the page's `maxDuration = 120` (`receipt-parse.ts:29-32`, `scan/page.tsx:10`).
5. **Salvage paths**: empty `content` falls back to the `reasoning` field; HTTP-200 model errors read from `payload.error.message`; JSON extracted between the first `{` and last `}`.
6. **Validate + clean** (`receipt-schema.ts:201-270`): coerces numeric strings/floats to ints, caps at 100 items, normalizes discount sign, falls back to group currency, `Item N` name fallback. `cleanParsedItems` (`:126-195`) is a hand-tuned de-quirker for Bulgarian Billa/Fantastico receipts — drops `ОБЩА СУМА`/`ПЛАТЕНО`/`ТИ СПЕСТИ` summary rows, folds bare `0.726 x 1.99` quantity lines into their neighbor, removes duplicated twin rows. Risky merges only apply when they move the items sum *toward* the printed total.
7. **Reconcile**: `sum(items) + tax + tip − discounts == total` (`receipt-schema.ts:277-288`), stored as `reconciles`, surfaced as an amber banner with one-click "Set total to X", never a hard error.
8. **Storage**: the downscaled JPEG goes into a separate `receipt_scan_images` table as **`bytea` in Postgres** (`schema.ts:196-203`). Served by `GET /api/receipts/[scanId]/image` with membership check and `Cache-Control: private, max-age=3600`.
9. **Review UI** (`ScanReviewView.tsx`, 731 lines — the largest component): editable merchant/date/currency/tax/tip/discount/total, per-line name + price with a `±` sign toggle (iOS keypad has no minus), `raw_text` under the cleaned name, quantity hint. Participant chips, per-item assignment, `ScanAssignModal` for equal-subgroup or exact amounts. Live per-person summary. Save draft / Convert to expense / Update linked expense.
10. **Convert**: `computePersonTotals` (`receipt-convert.ts:37-134`) allocates items, then distributes tax+tip−discounts pro-rata by item subtotal using largest-remainder, falls back to equal when nobody has a positive subtotal, guards against negative person totals. Fed into `saveExpense` as an `exact` split. Re-converting updates the linked expense; if the expense was deleted the FK nulls out and a fresh one is created.

### Error handling
Five failure codes → localized messages (`ParseFailureCode` at `receipt-parse.ts:34-51`, dictionary keys `parse.*`). Rate-limit across the ladder appends a "backup model was busy" hint. Failure banner always offers "Add the expense manually instead". Post-insert failure deletes the scan row so no orphan drafts remain.

### Cost controls
- Free models by default (zero marginal cost, but no SLA and training-on-input risk).
- Image-hash dedupe; 3.5 MB / ~2000-2800px cap.
- **Nothing else.** No per-user/group/daily quota, no cost accounting, no `usage` tracking, no queue/background job (parse blocks a 120 s serverless invocation), no retry-with-higher-resolution.

### Rough / unfinished
- Free-model reliability is explicitly designed around in code comments (`receipt-parse.ts:14-19`).
- `subtotalCents` and `category` are parsed and stored but never used or displayed. `confidence` stored, never shown. `receiptScans.status` written but the UI derives state from `expenseId` instead.
- Quantity is display-only; you cannot split "3 × Beer" at unit granularity.
- Participant selection in the review view is client-only state, lost on reload.
- Images retained forever with no expiry (see §8).

---

## 3. Localization

### Mechanism
Hand-rolled, zero-dependency: one flat `Record<TKey, string>` per locale with `{param}` interpolation (`src/lib/i18n.ts`). Locale in a cookie (`locale`, 1-year, `sameSite: lax`), read server-side via `getLocale()`/`getT()` (`i18n-server.ts`), client-side via `LocaleProvider`/`useT()`. EN/БГ segmented control in the header and login card.

### Coverage
- **`bg` is 100% complete by construction**: typed `Record<TKey, string>` where `TKey = keyof typeof en`, so TS fails the build on missing keys. ~440 keys, all translated.
- Quality is high and idiomatic — Bulgarian typographic quotes `„…“`, correct terminology (*„виртуален член“*, *„дялове“*, *„бакшиш“*), month abbreviations in `format.ts:5`, Cyrillic font subsets loaded, `<html lang={locale}>`.
- `countWord()` is binary singular/plural (`i18n.ts:926-928`). Works for BG count forms by coincidence; not a real plural-rule engine.

### Formatting — the main gap
- **`formatCents` hardcodes `en-US`** (`src/lib/money.ts:1-10`). Every amount renders as `BGN 12.34` / `€12.34` with `.` decimal and `,` thousands regardless of locale. Bulgarian convention is `12,34 лв.` / `1 234,56`. Single-function fix; affects every screen.
- `parseAmount` (`money.ts:13-19`) replaces **only the first comma**. `"1,234.56"` → `"1.234.56"` → `null`. `"1 234,56"` also fails (space rejected). Bulgarian users typing local formats get "Enter a valid amount."
- `formatDate` **is** locale-aware (`format.ts:9-15`): `bg` → `23 авг`. Custom, not `Intl`.
- Activity timestamps use `toLocaleTimeString("bg-BG")` for the time portion only.
- Date pickers are native `<input type="date">` — browser locale, not app locale.

### Hardcoded English outside the dictionary
| Location | String |
|---|---|
| `src/app/actions.ts:51` | `` `${ids.length} people` `` in audit-log diffs |
| `src/app/actions.ts:77-116` | 8 English diff fragments — **persisted to the DB as jsonb** |
| `src/app/actions.ts:781-792` | `payer`, `recipient` diff fragments |
| `src/app/actions.ts:85, 792` | `formatDate(...)` with no locale → English months inside stored diffs |
| `src/app/actions.ts:242` | alias-name fallback `"Member"` |
| `src/app/actions.ts:747` | settlement description `"Payment"` stored in DB |
| `src/lib/group-data.ts:272` | inviter fallback `"Someone"` |
| `src/lib/receipt-convert.ts:151` | `"Scanned receipt"` fallback |
| `src/lib/receipt-parse.ts:45-51` | English `PARSE_ERROR_MESSAGES` (dead in practice) |
| `src/lib/split.ts:7-13` | English `SPLIT_METHOD_LABELS` (audit diffs only) |
| `src/lib/receipt-schema.ts:202-246` | validator error strings (logs only) |
| API routes | `"Unauthorized"` / `"Not found"` bodies |
| `LanguageToggle.tsx:26` | bilingual-hardcoded `aria-label` |

`app.tagline` is localized in `<meta description>` but the page `title` is not.

---

## 4. Mobile / PWA readiness

### Present
- `viewport` export with `themeColor` and `viewportFit: "cover"`; safe-area insets in header and modals.
- Modals become **bottom sheets on phones** (`Modal.tsx:37-41`, `sheet-in` animation in `globals.css:142-149`).
- iOS zoom prevention (16px inputs below `sm`), `touch-action: manipulation`, taller mobile buttons, normalized native `<select>`/date inputs.
- `inputMode="decimal"` on money fields; `±` toggle because the iOS keypad lacks minus.
- `accept="image/*"` opens the camera on mobile.
- Responsive layouts throughout; 4 mobile-specific commits in recent history.

### Blocking installable-PWA status
- **No manifest**, **no service worker**, **no offline capability**.
- **No app icons** — `public/` has only stock Next.js SVGs; just `favicon.ico` exists. No 192/512 PNGs, no `apple-touch-icon`, no maskable icon.
- No `appleWebApp` metadata, no splash screens, no install-prompt handling, no PWA tooling dependency.

### Other mobile gaps
- No pull-to-refresh, swipe gestures, or haptics.
- Expense-row delete is a `<span role="button">` nested inside a `<button>` (`ExpenseList.tsx:167-185`) — tiny hit target, non-standard a11y.
- Modal has no focus trap and no `aria-labelledby`.
- Light-mode only — no `prefers-color-scheme` handling.

---

## 5. Money & FX correctness

### Storage & rounding
- All money is **integer minor units** in `integer` columns. No floats in the money path except `split_value` (raw user input) and `quantity`.
- `allocateByWeights` (`money.ts:34-51`) is largest-remainder, sign-aware, guarantees exact sums. Used by every split, the tax/tip pool, and post-FX re-allocation.
- Currency conversion re-allocates the *converted total* across payers/shares proportionally rather than converting each part independently, avoiding cent drift (`group-data.ts:162-175`).
- Rounding write-off: nets within ±2 cents zeroed and absorbed by the largest opposite balance, multi-pass, test-covered (`scripts/math.test.ts:124-174`).
- `int4` ceiling: max ±21,474,836.47. For JPY/HUF (zero/low-decimal currencies) `formatCents` divides by 100 unconditionally — `¥1000` entered is stored as 100000 and displayed `¥100,000`. No minor-unit-exponent table.

### Simplify algorithm
Greedy max-debtor/max-creditor with deterministic tiebreak, ≤ n−1 payments, filters residues ≤ 2 cents. Standard Splitwise behavior; deterministic and test-covered.

### BGN handling — no special-casing at all
- `BGN` is treated identically to every other code. `convertCents` returns `null` when a code is absent from a rate row.
- The receipt prompt teaches the model `"лв"` = BGN, `"ЕВРО"` = EUR (`receipt-schema.ts:76`); item cleanup is tuned on Bulgarian receipt text.
- **No hardcoded 1.95583 peg anywhere** — the fixed rate appears only in test/seed fixtures.

### EUR changeover — this breaks
Bulgaria's euro adoption (2026-01-01) removes BGN from the ECB daily reference set. The failure chain:

1. `refreshRates` stores whatever Frankfurter returns; a BGN-less `rates` jsonb is written for each new day.
2. For any expense dated after that, `rateOf("BGN")` → `undefined` → `convertCents` → `null`.
3. `loadGroupData` sets `convertedCents: null`, the row shows a red "no rate" chip.
4. **Critically**, `group-data.ts:168` skips the expense — it is **silently excluded from `netBalances`, `pairwiseDebts` and `simplifiedDebts` entirely**. Balances become wrong, not merely incomplete.
5. Historical BGN rate rows keep working for back-dated expenses; the break is forward-only and gradual — harder to notice.
6. A group whose **base currency is BGN** inverts the problem: every non-BGN expense fails to convert.

### Secondary FX issues
- `refreshRates` only backfills when the table is **empty**; missed cron days become permanent gaps silently served by older rows.
- `findRateRow` falls back to the *earliest* stored row for transactions predating all rates — a 2024 expense gets a 2026 rate with no indication.
- 90-day backfill horizon at launch.
- `updateRatesNow` callable by any signed-in user, unthrottled.
- `todayString()` and expense-date defaults use UTC — between 00:00 and 03:00 Bulgarian time the default date is yesterday.
- All `timestamp` columns are timezone-naive.

---

## 6. Auth & onboarding

- **Google OAuth only** in production (`src/auth.ts:8-13`). No email/magic-link, Apple, Facebook, phone, or password.
- `signIn` requires `profile.email_verified === true` (email is the identity/invite-matching key).
- Dev login: passwordless Credentials provider, only when Google creds absent and `NODE_ENV === "development"`.
- JWT sessions, no DB session table, no adapter — `users` upserted manually in the `jwt` callback.
- No middleware — every page does its own `auth()` + redirect.

### What a brand-new user sees
Login → dashboard empty state → create group (auto-creates owner's alias) → group page shows a *second* empty state ("Add people first"). Add Expense / Scan Receipt disabled until ≥1 alias; Settle Up until ≥2.

### Friction points
- Google-only excludes anyone without a Google account.
- Two consecutive empty states before any value.
- No group templates; create form defaults to `USD`.
- **Locale defaults to `en` with no `Accept-Language` sniffing** — a Bulgarian visitor lands in English and must find the EN/БГ pill.
- No onboarding tour, no demo group, no checklist, no ToS/privacy consent at signup.

---

## 7. Notifications / comms

**None. There is no notification infrastructure of any kind.**

- No email (no dependency, no SMTP, no templates; migration `0002` removed the old email-invite path).
- No web push (no service worker, no VAPID, no `Notification` API usage).
- No in-app notification centre, no unread badges, no toast/snackbar system — feedback is inline text plus two `window.alert()` calls.
- Activity log is pull-only. No reminders, no digests, no settle-up nudges.
- The only outbound communication is the user manually copying an invite URL.

---

## 8. Data / privacy

### Personal data stored
| Table | Personal data |
|---|---|
| `users` | email (unique, identity key), name, Google avatar URL |
| `aliases` | display name per group |
| `expenses` + payers/shares | free-text descriptions, amounts, dates, who-owes-whom graph |
| `activity_log` | actor name **and email** denormalized into jsonb, plus expense descriptions/amounts, retained after the referenced records are deleted |
| `receipt_scans` | merchant, date, totals, model name, image hash |
| `receipt_scan_images` | **the full receipt JPEG as bytea** |
| `receipt_items` | `raw_text` — verbatim printed receipt lines |

Receipt images can contain card last-4, loyalty IDs, names, and a full purchase history. They are sent to a **US-based router (OpenRouter) and a free model endpoint that may train on the input** — the risk is documented in `.env.example:29-32` and not mitigated.

### Deletion paths that exist
- Delete expense (hard), delete group (hard, cascades), delete receipt scan (cascades image + items; converted expense kept), delete virtual member (only if unreferenced), leave/remove (detach only, history retained).

### Gaps
- **No account deletion** — nothing anywhere deletes a `users` row. Erasure cannot be exercised.
- **No data export** (no CSV/JSON) and no import.
- **No receipt-image retention policy** — images live in Postgres indefinitely. No TTL, no post-conversion purge, no "discard after review" option.
- **No privacy policy, no ToS, no cookie/consent banner, no DPA reference** anywhere. (Two cookies: Auth.js session + `locale`.)
- Activity-log entries embed members' **emails**, visible to every group member, surviving the person's departure.
- Invite token is a bearer URL granting full read of financial history + member emails.
- Members are never told receipt photos go to a third-party LLM.

---

## 9. Infra & operations

- **Vercel**; `vercel.json` = one daily cron `GET /api/cron/daily` at 06:00 UTC (Hobby one-per-day limit). No regions/function config.
- Cron does: `refreshRates()` + expire stale invites. Auth via `CRON_SECRET` **only if set** — otherwise publicly callable (documented as intentional; both tasks idempotent). Failures return 500, otherwise unobserved.
- `maxDuration = 120` on the scan page only.
- **Security headers** (`next.config.ts:12-26`): `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (camera/mic/geo disabled — note this would block any future in-page camera capture). **No CSP, no HSTS.**
- **Rate limiting: none** — including on `parseReceipt` (LLM spend), `updateRatesNow` (third-party API), `acceptInvite`.
- **Backups:** whatever Neon's plan provides; no dump script, no restore runbook.
- **Monitoring / analytics / error tracking: entirely absent.** Errors go to `console.error` in three places. No health check, no uptime probe, no cron-failure alerting.
- **CI: none.** No workflows, no hooks, no Dependabot.
- **Tests** — three tsx scripts (plain `node:assert`, run manually): `math.test.ts` (splits, simplify, rates — the only one in npm scripts), `receipt.test.ts` (parse/validate/clean/convert incl. six real Bulgarian-receipt quirks), `receipt-db.test.ts` (PGlite migrations, bytea, cascades), plus `db-smoke.ts` (end-to-end). **Untested:** all React components, all server actions (1,252 lines incl. authorization), `auth.ts`, `rates-fetch.ts`, the OpenRouter call path.
- Local dev: zero-setup PGlite with auto-migrations; two seed scripts (incl. a Bulgarian "Fantastico" receipt fixture).

---

## 10. Technical debt / risks (ranked-ish)

**Correctness**
1. **Expenses with a missing FX rate vanish from balance math** (`group-data.ts:168`). Combined with the BGN/euro-changeover break (§5), the highest-severity issue in the codebase.
2. **No database transactions anywhere** (Neon HTTP driver limitation). `saveExpense` delete-then-reinserts payers/shares across separate round-trips; `deleteGroup`, `mergeAliasReferences`, `persistScanEdits` have the same exposure.
3. Zero-decimal currency bug (JPY/HUF/KRW/ISK assume 2 minor digits).
4. `int4` money columns cap at ~21.5M minor units.
5. UTC "today" → yesterday's date for Bulgarian users between 00:00–03:00.
6. Timezone-naive timestamps throughout.
7. Group currency change re-bases every balance retroactively with minimal warning.

**Scaling**
8. `loadGroupData` loads **everything** per page view — all expenses, payers, shares, and the **entire `fx_rates` table** (no date filter); payer/share matching is O(expenses × payers) in JS.
9. No pagination anywhere (dashboard, expenses, scans; activity capped at 200 with no load-more).
10. Receipt images as `bytea` in the primary DB (~300 KB × N on Neon storage; hex-encoded transfer roughly doubles wire size; every read passes through a serverless function).
11. `mergeAliasReferences` is N+1 per referenced expense.
12. `loadCircle` fans out over every group on every MembersModal open.
13. `revalidatePath("/")` on nearly every mutation.
14. Scan parse blocks a 120 s serverless invocation — no queue/background job.

**Fragile / half-done**
15. Free LLM endpoints as production default; model names pinned in code will rot.
16. `cleanParsedItems` is ~70 lines of heuristics fitted to Billa/Fantastico output — no eval harness/golden set beyond six test cases.
17. Audit-log diffs are English strings frozen into jsonb — unfixable retroactively; `details` shape untyped.
18. `receiptScans.status` unused; `subtotalCents`, `category`, `confidence` stored but never surfaced.
19. `ScanReviewView.tsx` is 731 lines, ~20 `useState` hooks, `JSON.stringify` dirty check.
20. No dirty-state guard on scan drafts (`beforeunload` absent).
21. Dead comment referencing removed email flow (`invites.ts:13`); `.env.example` out of sync with the model ladder.
22. `claudeConv.md` (raw chat transcript) committed at repo root; `.gitignore` duplicates; stray `tsconfig.tsbuildinfo`.

**Security / operational**
23. Cron endpoint open when `CRON_SECRET` unset.
24. No rate limiting on any action, incl. the two that cost money.
25. No CSP.
26. Invite tokens: long-lived bearer URLs, one shared link per group, no per-invitee tracking.
27. No observability — a silently failing cron surfaces only via a dismissible user-facing popup ~7 days later.
28. Any member can delete any expense; the owner cannot restrict this.
