# Topic 11 — Reliability, Operations & Scale: Research

> Part of the [Bulgarian market improvement guide](../README.md).
> Research date: **2026-08-24**. Companion implementation plan: [rfc.md](rfc.md).
> Current-state findings: [00-current-state-audit.md §9–10](../00-current-state-audit.md)
> (debt items 2, 8–14, 23–28 are this topic's). Platform-cost context:
> [09-monetization/research.md §4](../09-monetization/research.md). Unverified claims flagged ⚠️.

**Why this topic matters now:** topic 09 concludes the app will charge money (freemium,
Vercel Pro move at paywall time). Paid users expect that a crash mid-save doesn't corrupt
their balances, that the operator notices failures before they do, and that data can be
restored. Today the app has **no transactions, no rate limits, no error tracking, no CI,
no backup script, no CSP** — all cheap to fix at this size, expensive to retrofit later.

---

## 1. Transactions on Neon serverless (2026)

The app connects through `drizzle-orm/neon-http` over the `neon()` fetch-based driver
([src/db/index.ts:12](../../../src/db/index.ts)). The state of the art:

- **HTTP driver = one-shot queries only.** Neon's docs are explicit: querying over HTTP is
  faster for single, non-interactive queries, but **HTTP mode does not support sessions or
  interactive transactions**. Drizzle's `neon-http` dialect throws on `db.transaction()`
  (long-standing, by design).
- **Non-interactive batch exists on HTTP:** `neon(...).transaction([q1, q2, ...])` sends
  multiple queries in **one HTTP request executed inside a single implicit transaction** —
  all-or-nothing, but later queries **cannot depend on earlier results** and per-query
  options can't be set. Drizzle exposes this as **`db.batch([...])`** on the neon-http
  dialect (Batch API supports Neon, LibSQL, D1). ⚠️ PGlite is *not* on drizzle's Batch API
  driver list — `db.batch` cannot be assumed to work in local dev without a shim.
- **WebSocket driver = real transactions.** `@neondatabase/serverless` also exports
  `Pool`/`Client` over WebSockets: session support, **interactive transactions**, and
  node-postgres drop-in compatibility. Drizzle's `drizzle-orm/neon-serverless` dialect over
  a `Pool` supports ordinary `db.transaction(async (tx) => { ... })`.
- **Serverless usage rule:** a WebSocket `Pool`/`Client` must be **created, used, and closed
  within one request handler** (`await pool.end()` or `ctx.waitUntil(pool.end())`). No
  cross-invocation reuse.
- **Latency tradeoff:** HTTP wins for one-shot queries (message pipelining, no handshake);
  WebSocket pays a **connection-setup cost per invocation** (TLS + WebSocket upgrade,
  several round trips) that amortizes over multi-query transactions. ⚠️ No published
  2026 benchmark of the delta on Vercel→Neon same-region; measure before committing
  (expect tens of ms warm, more against a scaled-to-zero Neon compute — cold start applies
  to both drivers). ⚠️ On Node < 22 the WebSocket driver needs
  `neonConfig.webSocketConstructor = ws` (the `ws` package); Node 22+ has a native
  `WebSocket` — verify against the project's Vercel Node runtime.
- **PGlite parity:** `drizzle-orm/pglite` supports `db.transaction()` natively, so a
  `withTransaction(fn)` abstraction gets local-dev parity for free. A `db.batch`-based
  design would instead need a PGlite fallback (sequential queries inside a PGlite
  transaction) — parity argues for the callback-transaction abstraction.

**What in this repo needs it** (audit item 2): `saveExpense` updates the expense row, then
deletes and re-inserts payers/shares across ~4 separate round trips
([src/app/actions.ts:621-660](../../../src/app/actions.ts)) — a crash between delete and
insert leaves an expense **with no payers/shares that silently corrupts balances**;
`deleteGroup` runs an N+1 delete loop ([actions.ts:206-229](../../../src/app/actions.ts));
`mergeAliasReferences` is N+1 update/delete pairs
([src/lib/merge-alias.ts](../../../src/lib/merge-alias.ts)); `persistScanEdits`
delete-then-reinserts all receipt items
([src/app/receipt-actions.ts:232-268](../../../src/app/receipt-actions.ts)); `parseReceipt`
already hand-rolls compensation (delete the scan row on later failure,
[receipt-actions.ts:100-124](../../../src/app/receipt-actions.ts)) — a comment there is the
only place the no-transaction limitation is acknowledged.

## 2. Rate limiting on Vercel serverless

Serverless invocations share no memory, so in-process token buckets are useless — state
must live in an external store. Options for this stack:

| Option | Cost | Notes |
|---|---|---|
| **Upstash Redis + `@upstash/ratelimit`** | Free: 256 MB, **500K commands/month**, 10 GB bandwidth; then $0.20/100K commands with a hard budget cap | The de-facto standard on Vercel; sliding-window algorithm built in; SDK itself free. One more vendor + one more secret. |
| **In-Postgres sliding window** | $0 — uses Neon | One `rate_limits` table + one `INSERT ... ON CONFLICT ... RETURNING` per check (two-bucket sliding-window approximation, Upstash-style). Works identically on PGlite in dev. Costs one extra DB round trip per limited action; during an abuse burst the DB still does the counting work. |
| Vercel WAF rate limiting | Pro-plan feature, usage-billed ⚠️ | Coarse, path-level; can't see the user id inside a server-action POST. |

**What needs limiting here** (audit items 24, 27; §9):

1. **`parseReceipt`** — the only action that spends money per call (LLM inference) and
   blocks a long serverless invocation ([receipt-actions.ts:39](../../../src/app/receipt-actions.ts)).
   Topic 09's freemium quota will *also* cap it later, but a rate limit is abuse protection,
   not entitlement — both are needed.
2. **`updateRatesNow`** — any signed-in user can hammer the Frankfurter API
   ([actions.ts:864-873](../../../src/app/actions.ts)); needs a global cooldown (once per
   ~10 min is plenty — rates change daily).
3. **`acceptInvite`** — token guessing (defense-in-depth; the 24-byte token is 192-bit
   entropy, so brute force is not realistic) and join-spam
   ([actions.ts:541-567](../../../src/app/actions.ts)).
4. **Auth attempts** — production auth is Google OAuth only ([audit §6](../00-current-state-audit.md));
   there is no password endpoint to brute-force. Worth revisiting only if email/credentials
   login ever lands (then limit at middleware on `/api/auth/*`).

**Middleware vs per-action:** all four hot paths are authenticated server actions — the
natural key is the **user id**, which middleware can't cheaply extract from an action POST
(and middleware taxes every request). **Per-action checks inside the existing
`requireUser()` flow are the right shape here**; middleware-level IP limiting is a later
add-on if anonymous abuse (login page, invite preview) ever shows up.

## 3. Receipt image storage

Today the downscaled JPEG (~300 KB) is `bytea` in the primary DB
([src/db/schema.ts:196-203](../../../src/db/schema.ts)), served through a
membership-checked function route
([src/app/api/receipts/[scanId]/image/route.ts](../../../src/app/api/receipts/%5BscanId%5D/image/route.ts)).
Consequences (audit item 10): ~1,700 scans fill Neon free's 0.5 GB
([topic 09 §4](../09-monetization/research.md)); hex encoding roughly doubles wire size;
every view passes through a serverless function; images bloat every backup.

2026 object-storage options (verified):

| | Vercel Blob | Cloudflare R2 |
|---|---|---|
| Free tier | 1 GB storage + 10 GB transfer/month (Hobby) | **10 GB-month storage**, 1M Class A + 10M Class B ops/month, **egress always free** |
| Paid | $0.023/GB-mo storage, $0.05/GB transfer, $0.40/1M simple + $5/1M advanced ops (Pro) | $0.015/GB-mo, $4.50/1M writes, $0.36/1M reads |
| Access control | Private blobs; short-lived URLs via SDK; first-party Vercel integration | S3-compatible **presigned URLs**; needs its own Cloudflare account + keys |

- **Signed-URL pattern:** keep the existing route as the auth gate, but have it issue a
  302 to a short-lived signed URL (or stream from the store) — membership check stays in
  app code, bytes stop transiting Postgres.
- **Migration approach for existing rows:** iterate `receipt_scan_images`, upload each blob
  keyed by `scanId`, verify size/hash, then null/drop the `data` column (keep
  `content_type`/`byte_size` as metadata). Small table today, so a single script run.
- **Scope note:** topics [04](../04-receipt-scanning/research.md)/[08](../08-privacy-gdpr/research.md)
  are heading toward **delete-after-parse / short retention** for receipt images, which
  shrinks this problem dramatically — but a store must still exist for images the user
  keeps, so the *abstraction* is needed regardless; the *vendor move* may never be urgent.
  At ≤ a few hundred retained images, **bytea is genuinely fine**; R2 is the best
  price/exit-cost option when the move happens.

## 4. Observability — minimal solo-dev stack

The app currently has zero observability (audit items 27, §9): three `console.error` sites,
1-hour log retention on Vercel Hobby, no alerting, and a failed cron surfaces as a user
popup ~7 days later.

- **Error tracking — Sentry Developer (free, verified):** 5,000 errors/month, 5M spans,
  50 session replays, **1 cron monitor, 1 uptime monitor**, 1 user. Team plan $26/month if
  ever needed. `@sentry/nextjs` covers server actions, route handlers, and client errors;
  the app's centralized `fail()` helper
  ([src/lib/action-helpers.ts:34-40](../../../src/lib/action-helpers.ts)) is a single
  choke-point where every server-action exception already lands — one `captureException`
  there instruments all 1,250 lines of actions.
- **Vercel logs (verified):** runtime log retention is **1 hour on Hobby, 1 day on Pro**;
  **log drains are Pro-only**. Structured `console.error` + Sentry is the practical
  substitute until Pro (which topic 09 schedules for paywall day anyway).
- **Cron failure alerting:** the daily cron ([src/app/api/cron/daily/route.ts](../../../src/app/api/cron/daily/route.ts))
  returns 500 on failure but nobody is listening. Dead-man's-switch ping services (free
  tiers verified): **healthchecks.io — 20 checks free** (ping URL after success; alert on
  silence, email/Telegram); **Better Stack — 10 monitors + 10 heartbeats free**. Sentry's
  single free cron monitor also fits, keeping the stack at one vendor. Any of the three
  works; the pattern is identical (HTTP GET to the ping URL as the last line of a
  successful run).
- **Cookieless analytics** — must preserve the app's no-cookie-banner status
  ([topic 08](../08-privacy-gdpr/research.md); the only cookies today are the Auth.js
  session and `locale`, both strictly necessary):
  - **Vercel Web Analytics** (verified): Hobby includes **50,000 events/month free**,
    1-month reporting window; Hobby cannot buy more (collection pauses); Pro is
    usage-billed $0.03/1K events, 12-month window. Identifies visitors by a request hash
    **discarded after 24 h — no cookies**, no consent banner needed per Vercel. Zero-setup
    winner on this stack.
  - **Umami Cloud** — Hobby plan **free: 100K events/month, 3 sites, 6-month retention**;
    genuinely cookieless (server-side salted rotating hash); Pro $20/month. Best free
    depth; EU-friendly; one more vendor.
  - **Plausible** — cookieless, GDPR-positioned, **no free tier**: from $9/month
    (10K pageviews). EU-hosted. Fine product, unnecessary spend at this stage.
  - ⚠️ "Cookieless ⇒ no consent needed" is the vendors' own legal position; topic 08's
    research treats truly-anonymous, non-cross-site measurement as not requiring consent —
    keep analytics config in that envelope (no custom events carrying personal data).

## 5. Backup / restore reality on Neon

- **Instant restore (PITR) by plan (verified):** Free plan — restore window up to
  **6 hours**, capped at 1 GB of change history; Launch — up to **7 days**; Scale — up to
  **30 days** (history billed ~$0.20/GB-month on paid plans). Restore is branch-level with
  LSN/timestamp granularity and takes seconds; only root branches can be restored.
- So on the free plan, a bad deploy noticed the next morning is **already unrecoverable**
  via PITR. Until the Launch upgrade, cheap belt-and-braces:
- **pg_dump-to-storage pattern:** a scheduled GitHub Actions workflow running
  `pg_dump --format=custom` against `DATABASE_URL` (repo secret), uploaded as a workflow
  artifact (private-repo artifact storage 500 MB free, retention configurable up to 90
  days) or to R2 (10 GB free). Neon's own backup docs bless the pg_dump route. The app's
  data minus receipt images is tiny (KB–MB for years of expenses);
  `--exclude-table-data=receipt_scan_images` keeps dumps small — acceptable because images
  are (a) slated for short retention per topics 04/08 and (b) covered by PITR on paid
  plans; revisit if kept images become precious.
- **A restore runbook must exist before it's needed:** restore into a fresh Neon branch,
  verify, repoint `DATABASE_URL`. Neon's branching makes rehearsal free.

## 6. CI on GitHub Actions

- **Free tier (verified):** public repos — unlimited minutes; private repos — **2,000
  Linux minutes/month** + 500 MB artifact storage. A run of this repo's suite is ~2–4
  minutes ⇒ even 5 pushes/day fits the private-repo allowance. **Dependabot is free on all
  repos** (version + security updates).
- The four test entry points already run headless with zero infrastructure:
  `npm run test:math`, `npm run test:receipt`, `npm run test:receipt-db` (in-memory
  PGlite), and `npx tsx scripts/db-smoke.ts` (PGlite at `.pglite/` via the `getDb()`
  fallback — a fresh CI checkout is clean, and `DATABASE_URL` must simply be left unset).
  Add `npx tsc --noEmit` (not currently in any script) and `npm run lint`.
- `next build` in CI is worth having but needs care: pages call `auth()`/`getDb()` at
  render time, so a production build may want stub env vars — treat as a follow-up, not a
  blocker.

## 7. Security hardening

- **CSP (audit item 25 — none today).** Next.js App Router 2026 state: the supported
  strict pattern is a **middleware-generated nonce** + `strict-dynamic`, which forces
  dynamic rendering of nonce-consuming pages; the hash/SRI alternative for static pages is
  still experimental. This app is *already fully dynamic* (every page begins with
  `auth()`; no static marketing pages, no third-party scripts, fonts self-hosted via
  `next/font`), so the nonce cost is ~zero and the policy can be tight:
  `default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'`;
  `style-src 'self' 'unsafe-inline'` (Next injects inline styles; nonce-ing styles is
  low-value), `img-src 'self' blob: data:` (scan preview uses `blob:` object URLs —
  [ScanUploadView.tsx:177](../../../src/components/ScanUploadView.tsx); Google avatar URLs
  are stored but never rendered today — add `lh3.googleusercontent.com` only if that
  changes); `frame-ancestors 'none'` (supersedes `X-Frame-Options`), `form-action 'self'`,
  `base-uri 'self'`, `object-src 'none'`. Ship **Report-Only first**, enforce after a
  clean soak.
- **HSTS:** not set ([next.config.ts:12-26](../../../next.config.ts)). ⚠️ Vercel serves
  HSTS on `*.vercel.app` domains automatically, but set
  `Strict-Transport-Security: max-age=31536000; includeSubDomains` explicitly so a future
  custom domain is covered from day one; add `preload` only once the custom domain is
  final (preload-list removal is slow).
- **The `Permissions-Policy: camera=()` footgun** ([next.config.ts:22](../../../next.config.ts)):
  today's scan flow uses `<input accept="image/*">`, which opens the native camera app —
  file pickers are **not** gated by Permissions-Policy, so nothing is broken *yet*. But
  `camera=()` disables `getUserMedia` for the page itself, which would silently break any
  future **in-page camera capture** (live receipt framing, the natural upgrade for the scan
  UX). Change to `camera=(self)` now; keep `microphone=()`/`geolocation=()`.
- **Cron auth (audit item 23):** the endpoint is open when `CRON_SECRET` is unset
  ([route.ts:15-18](../../../src/app/api/cron/daily/route.ts)). Vercel automatically sends
  `Authorization: Bearer $CRON_SECRET` when the env var exists — the fix is to **fail
  closed in production** (500/401 when the secret is missing) rather than degrade to
  public. "Both tasks are idempotent" underestimates the cost: an attacker can loop the
  endpoint to hammer Frankfurter from the app's egress and burn compute.
- **Invite tokens (audit item 26):** 24 random bytes base64url (192-bit) — cryptographically
  fine. The weaknesses are lifecycle, not entropy: one shared multi-use link per group,
  7-day TTL, full financial-history + member-email read on join. Practical hardening:
  rate-limit `acceptInvite` (§2), keep 7-day TTL (shorter TTLs mostly punish legitimate
  slow joiners), add an owner-visible "revoke" nudge (exists) and an optional
  **single-use / auto-revoke-after-N-joins mode** later. Per-invitee links + owner
  approval are real features (they change the join UX) — defer to a product decision, not
  this RFC.

## 8. Postgres-side scaling for the load-everything pattern

**What happens per group page view** ([src/lib/group-data.ts:98-213](../../../src/lib/group-data.ts)):
6 parallel queries then 2 more — including **all expenses ever**
(`group-data.ts:106-110`), all payers/shares for them, and **the entire `fx_rates` table
with no date filter** (`group-data.ts:111`). Payer/share attachment is then
`payerRows.filter(...)` inside `expenseRows.map(...)` (`group-data.ts:150-155`) — an
O(expenses × payers) in-JS join.

- **`fx_rates` is the silent grower:** ~260 ECB business-day rows/year × ~600 B of jsonb ≈
  **~160 KB/year fetched on every page view of every group, forever**, independent of app
  success. Fix is a one-line date filter (`date >= min(expense date)` or last-400-days) —
  and after [RFC 01](../01-euro-transition/rfc.md), fixed-leg BGN↔EUR groups need **zero**
  rate rows.
- **Indexes present** ([schema.ts](../../../src/db/schema.ts)): primary keys, `users.email` /
  `group_invites.token` uniques, and exactly one secondary index —
  `receipt_scans_group_hash_idx (group_id, image_hash)` (`schema.ts:191`). **Postgres does
  not auto-index FK columns**, so these hot lookups are all sequential scans:
  `expenses(group_id)` (every page view), `aliases(group_id)`, `activity_log(group_id,
  created_at)` (the 200-row activity query), `group_members(user_id)` (reverse lookup in
  `loadGroupSummaries`/`loadCircle`), `expense_payers(alias_id)` / `expense_shares(alias_id)`
  (`mergeAliasReferences` scans by alias), `receipt_scans(expense_id)`, `group_invites(group_id)`.
  All are cheap `CREATE INDEX` wins.
- **Pagination:** nothing is paginated (audit item 9). The expense list is the one that
  grows per group — keyset/cursor pagination on `(date DESC, created_at DESC, id)` matches
  the existing sort exactly. The catch: **balance math genuinely needs every expense**, so
  pagination alone can't cap the load — either keep full-fetch for balances (fine for a
  long time) or eventually maintain persisted per-alias running nets (a real project;
  don't start it yet).
- **Honest sizing:** a typical BG group (3–10 people, 100–300 expenses/year) produces a
  few hundred to ~2,000 rows per page view — Neon and the HTTP driver handle that without
  drama. Trouble starts around **~1–2K+ expenses in a single group** (payload creeping
  toward ~1 MB, hex-doubled; multi-hundred-ms transfer + serverless memory) or around
  **thousands of active groups**, where redundant full loads start eating the Neon free
  plan's **100 compute-hours/month** and paid CU-hours after. Conclusion: the pattern is
  **not a launch blocker** — but the fx filter, the missing indexes, and the O(n×m) join
  fix are near-free and worth doing now; cursor pagination next; persisted balances only
  on demonstrated growth.

## Implications for the app

1. **Adopt a `withTransaction` abstraction in `src/db/index.ts`** backed by the WebSocket
   `Pool` driver in production and PGlite's native transactions in dev; wrap `saveExpense`,
   `deleteGroup`, `mergeAliasReferences`, `persistScanEdits`, and `parseReceipt`'s insert
   trio. Measure the WebSocket per-invocation cost first; `db.batch` is the fallback for
   the simple all-insert cases.
2. **Rate-limit the four hot actions with an in-Postgres sliding window** (zero new
   vendors, PGlite-identical in dev); Upstash is the escape hatch if DB-side counting ever
   becomes the bottleneck.
3. **Sentry free tier + one cron ping + Vercel Web Analytics** is a complete solo-dev
   observability stack at $0 that preserves the no-cookie-banner posture.
4. **CI is a half-day job**: typecheck + lint + the four existing headless scripts on
   GitHub Actions free minutes, plus Dependabot.
5. **Headers hardening in one PR**: nonce CSP (report-only → enforce), explicit HSTS,
   `camera=(self)`, and cron fail-closed on missing `CRON_SECRET`.
6. **Receipt images:** keep bytea behind a storage interface now; R2 (10 GB free, zero
   egress) is the designated exit when retained volume grows. Retention policy itself
   belongs to topics 04/08.
7. **Backups:** nightly `pg_dump` workflow + a written restore runbook immediately; Neon
   Launch (7-day PITR) when revenue starts — the free plan's 6-hour window is not a
   business-grade safety net.
8. **Query hygiene now, pagination when needed:** fx date filter, ~8 missing indexes, Map
   -based join — immediately; expense-list cursor pagination — P3; persisted balances —
   not before real scale.

## Sources

<details><summary>Full source list (URLs)</summary>

**Neon drivers / transactions:** https://neon.com/docs/serverless/serverless-driver · https://neon.com/docs/connect/choose-connection · https://orm.drizzle.team/docs/connect-neon · https://orm.drizzle.team/docs/batch-api · https://orm.drizzle.team/docs/transactions · https://www.answeroverflow.com/m/1149370348593217619 (drizzle neon-http no-transaction confirmation)
**Rate limiting:** https://upstash.com/pricing/redis (free-tier limits verified 2026-08-24) · https://github.com/upstash/ratelimit-js
**Storage:** https://vercel.com/docs/vercel-blob/usage-and-pricing · https://vercel.com/docs/vercel-blob · https://developers.cloudflare.com/r2/pricing/ · https://egresscost.com/cloudflare/ · https://www.budgetforge.dev/tools/cloudflare-r2-pricing-2026
**Observability:** https://sentry.io/pricing/ (Developer plan verified: 5K errors, 5M spans, 50 replays, 1 cron + 1 uptime monitor) · https://vercel.com/docs/logs/runtime · https://vercel.com/docs/drains · https://healthchecks.io/pricing/ · https://freetier.co/directory/products/better-stack · https://vercel.com/docs/analytics/limits-and-pricing (Hobby 50K events verified) · https://vercel.com/docs/analytics · https://umami.is/pricing · https://docs.umami.is/docs/cloud/faq · https://plausible.io/#pricing · https://datascale.de/en/blog/plausible-for-smb/
**Backup/restore:** https://neon.com/docs/introduction/restore-window (per-plan windows verified) · https://neon.com/docs/introduction/branch-restore · https://neon.com/docs/manage/backups · https://neon.com/docs/guides/backup-restore
**CI:** https://docs.github.com/en/actions/concepts/billing-and-usage · https://cicdcalculator.com/github-actions-free-tier · https://appsecsanta.com/dependabot
**CSP / headers:** https://nextjs.org/docs/app/guides/content-security-policy · https://johnkavanagh.co.uk/articles/content-security-policy-in-nextjs/ · https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy · https://vercel.com/docs/cron-jobs/manage-cron-jobs (CRON_SECRET bearer behavior)

</details>
