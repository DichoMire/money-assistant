# RFC 11 — Reliability, Operations & Scale: Transactions, Rate Limits, Observability, CI, Hardening

> **Status update (2026-08-26): COMPLETE except (g5) pagination (P3).** (a) full coverage + set-based merge/teardown; (b) rate limits; (c) Sentry-via-envelope-API (no SDK — documented deviation) + cron ping + Vercel Analytics; (d) CI + Dependabot; (e) HSTS/CSP-report-only(+`CSP_ENFORCE` flip)/camera=(self)/cron fail-closed; (f) ReceiptImageStore (bytea adapter, R2 swap-point documented); (g1–4) fx bounding + Map joins + indexes; (h) backup workflow + restore runbook. Details: [IMPLEMENTATION-LOG.md](../IMPLEMENTATION-LOG.md).

> **Status:** Proposed · **Priority: staged — P1 (launch blockers before charging money):
> transactional integrity (a), rate limiting (b), error tracking (c1);
> P2: CI (d), headers/cron hardening (e), cron ping + analytics (c2/c3), image-store
> abstraction (f), backups (h); P3: pagination & query hygiene beyond the quick wins (g).**
> **Audience:** a future LLM implementer with full repo access. Read
> [research.md](research.md) and [00-current-state-audit.md §9–10](../00-current-state-audit.md)
> first. All file/line references are to commit `14963d2`; re-locate by symbol name if drifted.

## 1. Problem

1. **No database transactions anywhere** (audit item 2). The app's only driver is
   `drizzle-orm/neon-http` ([src/db/index.ts:12](../../../src/db/index.ts)), which cannot
   do interactive transactions. Multi-statement mutations run as independent round trips:
   - `saveExpense` ([src/app/actions.ts:621-660](../../../src/app/actions.ts)): update
     expense → **delete payers (:632) → delete shares (:633) → insert payers (:650) →
     insert shares (:653)**. A crash after the deletes leaves an expense with no
     payers/shares — it then contributes nothing to balance math
     (`group-data.ts:168` skips empty-payer/share expenses), silently corrupting balances.
   - `deleteGroup` ([actions.ts:206-229](../../../src/app/actions.ts)): N+1 delete loop;
     partial failure leaves a half-deleted group.
   - `mergeAliasReferences` ([src/lib/merge-alias.ts:13-71](../../../src/lib/merge-alias.ts)):
     N+1 select/update/delete per referenced expense; partial failure leaves history split
     across two aliases (attach is irreversible from the UI).
   - `persistScanEdits` ([src/app/receipt-actions.ts:232-268](../../../src/app/receipt-actions.ts)):
     delete-all-items → reinsert → update scan header.
   - `parseReceipt` ([receipt-actions.ts:100-124](../../../src/app/receipt-actions.ts)):
     manual compensation (delete scan on later failure) — works, but is the pattern this
     RFC replaces.
2. **No rate limiting** (audit item 24): `parseReceipt` (LLM spend), `updateRatesNow`
   ([actions.ts:864-873](../../../src/app/actions.ts), hits Frankfurter unthrottled),
   `acceptInvite` ([actions.ts:541-567](../../../src/app/actions.ts)).
3. **No observability** (audit item 27): errors go to `console.error` (1-hour Hobby log
   retention); a failing cron ([src/app/api/cron/daily/route.ts](../../../src/app/api/cron/daily/route.ts))
   surfaces only as a stale-rates popup ~7 days later. No analytics of any kind.
4. **No CI** (audit §9): four headless test scripts exist but run only by hand; no
   typecheck gate (`tsc` isn't even in `package.json` scripts); no Dependabot.
5. **Headers/auth gaps** (audit items 23, 25): no CSP, no HSTS
   ([next.config.ts:12-26](../../../next.config.ts));
   `Permissions-Policy: camera=()` ([next.config.ts:22](../../../next.config.ts)) will
   silently break future in-page camera capture; the cron endpoint is **publicly callable
   when `CRON_SECRET` is unset** ([route.ts:15-18](../../../src/app/api/cron/daily/route.ts)).
6. **Receipt images as bytea in the primary DB** (audit item 10;
   [src/db/schema.ts:196-203](../../../src/db/schema.ts)): fills Neon free's 0.5 GB at
   ~1,700 scans, doubles wire size (hex), bloats dumps.
7. **Load-everything reads** (audit items 8-9): `loadGroupData` fetches all expenses +
   payers + shares and the **whole `fx_rates` table**
   ([src/lib/group-data.ts:104-132](../../../src/lib/group-data.ts), fx at `:111`), then
   does an O(expenses × payers) in-JS join (`:150-155`). Only one secondary index exists
   in the schema (`receipt_scans_group_hash_idx`, [schema.ts:191](../../../src/db/schema.ts)).
8. **No backups beyond the platform** (audit §9): Neon free PITR window is 6 h / 1 GB —
   a corruption noticed next morning is unrecoverable; no dump script, no restore runbook.

## 2. Goals / non-goals

**Goals**
- G1. Every multi-statement mutation is atomic in production **and** local dev.
- G2. The four hot actions are rate-limited with zero new vendors.
- G3. A production exception or a silent cron failure reaches the operator within minutes,
  at $0/month, without adding a cookie banner.
- G4. Every push runs typecheck + lint + the four test scripts; dependencies get PRs.
- G5. Strict CSP + HSTS ship without breaking any flow; cron fails closed; the camera
  policy stops blocking the app's own future.
- G6. Receipt-image bytes live behind an interface so the storage vendor is swappable
  without touching callers.
- G7. Reads stop growing unboundedly with time (fx filter) and with group size
  (pagination), in that order of urgency.
- G8. A tested restore path exists.

**Non-goals**
- Monetization, entitlements, scan quotas as *product* limits (→ [RFC 09](../09-monetization/rfc.md);
  the rate limits here are abuse protection and stay even after quotas land).
- LLM provider/model choice and parse-quality work (→ [RFC 04](../04-receipt-scanning/rfc.md)).
- GDPR policy content, retention *policy* for receipt images, consent UX (→
  [RFC 08](../08-privacy-gdpr/rfc.md)). **Coordination boundary for images: 04/08 decide
  *whether/how long* an image is kept; this RFC decides *where* kept bytes live.**
- FX correctness (→ [RFC 01](../01-euro-transition/rfc.md)) — but workstream (g)'s fx date
  filter should land after RFC 01's fixed-leg change to reap the full win.
- PWA/offline, notifications, per-member permissions (other topics).

## 3. Design

### (a) Transactional integrity — P1

**Abstraction first** (everything else follows from it): extend
[src/db/index.ts](../../../src/db/index.ts) with a transaction capability while keeping
the HTTP driver for all reads/one-shots:

```ts
// db/index.ts — sketch
export type TxDb = /* common drizzle pg type over `schema`, see note */;
export async function withTransaction<T>(fn: (tx: TxDb) => Promise<T>): Promise<T>;
```

- **Production path:** lazily import `Pool` from `@neondatabase/serverless` and
  `drizzle` from `drizzle-orm/neon-serverless`. Per call: create a `Pool` from the same
  `DATABASE_URL`, run `db.transaction(fn)`, and `await pool.end()` in a `finally` —
  Neon requires Pool/Client to be created, used, and closed within one request handler.
  ⚠️ If the runtime is Node < 22, set `neonConfig.webSocketConstructor = ws` (add the
  `ws` dependency); Node 22+ has native `WebSocket`.
- **Dev path:** the PGlite drizzle instance already supports `db.transaction` — pass
  through. This is why the abstraction is a callback transaction and **not** `db.batch`:
  drizzle's Batch API does not list PGlite (research §1), so batch would break local parity.
- **Typing note:** the current `Db` is `NeonHttpDatabase<typeof schema>`. The transaction
  callback must accept the neon-serverless *and* PGlite transaction types. Practical
  option: type `TxDb` as `PgDatabase<PgQueryResultHKT, typeof schema>` (the common
  drizzle-pg base) — all call sites in this repo use only query-builder methods that the
  base type carries. Helper signatures that take `Db` today (`mergeAliasReferences`,
  `logActivity`) should widen to this base type.
- **Wrap these paths** (the transaction body is the current code minus the manual
  compensation):
  1. `saveExpense`: from the update/insert of `expenses` through both re-inserts.
     Validation and the pre-read of old rows stay outside; `logActivity` stays outside
     (an audit-log failure must not roll back the expense — it already swallows errors).
  2. `saveSettlement` (same delete-then-reinsert shape, [actions.ts:735-767](../../../src/app/actions.ts)).
  3. `deleteGroup`: replace the N+1 loop with set-based deletes inside one transaction
     (`DELETE FROM expense_payers USING expenses WHERE ...` or drizzle subquery `inArray`),
     then expenses, aliases, group.
  4. `mergeAliasReferences`: wrap whole function; also fix its N+1 (see (g)).
  5. `persistScanEdits`: delete items → reinsert → shares → scan-header update.
  6. `parseReceipt`: scan + image + items in one transaction; delete the
     manual-compensation `try/catch` (`receipt-actions.ts:100-124`) and its comment.
- **Measure before committing** (risk §6): a temporary instrumented action comparing
  HTTP-driver saveExpense vs transactional saveExpense timings in a Vercel preview.
  Expected overhead: one WebSocket setup per mutation (~tens of ms warm). **Fallback** if
  unacceptable: `db.batch` on neon-http for the pure-insert cases (parseReceipt trio,
  the reinsert phase of saveExpense) with a PGlite sequential-in-transaction shim — but
  only saveExpense's *whole* update+delete+insert being atomic removes the corruption
  window, so prefer the Pool even at some latency cost (mutations are not the hot path;
  reads stay on HTTP).

### (b) Rate limiting — P1

**Choice: in-Postgres sliding window.** Justification: zero new vendors/secrets (solo dev,
low budget), identical behavior on PGlite in dev and CI, and the four limited actions each
already make 3+ DB round trips — one more is negligible. Upstash (free tier verified:
500K commands/month) is the documented escape hatch if abuse volume ever makes the DB do
too much counting; the call-site API below is deliberately Upstash-shaped so the swap is a
one-file change.

- New table (drizzle migration):

```ts
export const rateLimits = pgTable("rate_limits", {
  key: text("key").notNull(),            // "scan:<userId>", "rates:global", "invite:<userId>"
  windowStart: timestamp("window_start").notNull(),
  count: integer("count").notNull().default(1),
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] })]);
```

- New `src/lib/rate-limit.ts`: `limit(db, key, { max, windowSec }) → { ok, retryAfterSec }`.
  One round trip: `INSERT ... ON CONFLICT (key, window_start) DO UPDATE SET count =
  rate_limits.count + 1 RETURNING count` on the current fixed window, plus a read of the
  previous window's count for the standard two-bucket sliding-window weighting
  (`prev*overlap + cur > max` ⇒ reject). Old rows are purged by the daily cron
  (`DELETE WHERE window_start < now() - interval '2 days'`).
- **Applied limits** (constants in one place; all keys are user-scoped — every limited
  action requires auth already):
  | Action | Limit | Key |
  |---|---|---|
  | `parseReceipt` | **5/min** and 30/day per user | `scan:<userId>`, `scand:<userId>` |
  | `updateRatesNow` | 1 per 10 min **global** + 3/hour per user | `rates:global`, `rates:<userId>` |
  | `acceptInvite` | 10/hour per user | `invite:<userId>` |
  | `saveExpense`/`saveSettlement` | 60/min per user (fat-finger/abuse ceiling, invisible normally) | `write:<userId>` |
- Rejection returns the existing `ActionResult` error shape with a localized message
  (new i18n keys `errors.tooManyRequests` + per-action variants, EN + BG) and
  `retryAfterSec` for the UI. **Per-action, not middleware** — rationale in research §2;
  auth is Google-OAuth-only so there is no password endpoint to protect.

### (c) Observability — Sentry (P1) + cron ping + analytics (P2)

1. **Sentry (P1):** `@sentry/nextjs` with the standard `instrumentation.ts` /
   `instrumentation-client.ts` setup, DSN via env, `tracesSampleRate: 0` (stay in the
   free 5K errors/month; spans are noise at this scale). Two manual capture points:
   `fail()` in [src/lib/action-helpers.ts:34-40](../../../src/lib/action-helpers.ts) —
   the single choke-point through which every server-action exception passes (capture
   before mapping to the localized message; skip expected validation errors by capturing
   only non-`Error`-message throws or tagging) — and the `catch` in the cron route.
   Scrub PII: `beforeSend` drops request bodies; never attach receipt bytes.
2. **Cron dead-man's switch (P2):** last line of a *successful* cron run pings
   `process.env.CRON_PING_URL` (healthchecks.io free check or Sentry's free cron monitor —
   either works; env-var indirection makes the vendor irrelevant). `fetch(url).catch(() => {})`
   — the ping must never fail the run. Alert fires on silence > 26 h.
3. **Analytics (P2):** `@vercel/analytics` (`<Analytics/>` in
   [src/app/layout.tsx](../../../src/app/layout.tsx)) — cookieless (request-hash discarded
   after 24 h), 50K events/month free on Hobby, keeps the no-cookie-banner status
   ([RFC 08](../08-privacy-gdpr/rfc.md) owns the privacy-policy wording that mentions it).
   No custom events carrying personal data. If >50K events/month before the Pro move, or
   >1-month retention is needed, switch to Umami Cloud Hobby (100K events free) — same
   no-banner posture.

### (d) CI — P2

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push: { branches: [master] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npm run test:math
      - run: npm run test:receipt
      - run: npm run test:receipt-db
      - run: npx tsx scripts/db-smoke.ts
```

- No secrets, no services: `test:receipt-db` uses in-memory PGlite; `db-smoke` falls back
  to PGlite at `.pglite/` because `DATABASE_URL` is unset in CI (keep it unset!).
- Add npm scripts `typecheck` (`tsc --noEmit`) and `test:smoke` so local and CI invoke the
  same names; optionally a `test` script chaining all four.
- `.github/dependabot.yml`: `npm` weekly + `github-actions` weekly, grouped minor/patch.
- Follow-up (not blocking): a `next build` job with stub env vars; wire Vercel's
  "require CI to pass" once the workflow is stable.

### (e) Headers, cron auth — P2

In [next.config.ts](../../../next.config.ts) `headers()` plus a new `src/middleware.ts`:

1. **CSP via middleware nonce** (the app is fully dynamic already — no static-page cost):
   generate a per-request nonce, set
   `Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'
   'nonce-{n}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:
   data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self';
   base-uri 'self'; object-src 'none'` per the Next.js CSP guide (nonce forwarded via the
   `x-nonce` request header). Matcher excludes `_next/static`, `_next/image`,
   `favicon.ico`, and `/api/receipts` (image bytes). Soak report-only ≥ 1 week (reports to
   Sentry via `report-uri`/`report-to` or just browser-console QA of every flow), then
   flip to enforcing. If a violation source can't be nonce-fixed quickly, keep report-only
   rather than shipping a loose enforced policy.
2. **HSTS:** add `Strict-Transport-Security: max-age=31536000; includeSubDomains` to the
   static header list (no `preload` until the custom domain is final).
3. **Permissions-Policy:** `camera=(self), microphone=(), geolocation=()` — unblocks
   future in-page capture ([next.config.ts:22](../../../next.config.ts); research §7).
   `X-Frame-Options: DENY` stays (harmless alongside `frame-ancestors 'none'`).
4. **Cron fail-closed:** in [route.ts:15-18](../../../src/app/api/cron/daily/route.ts),
   production with no `CRON_SECRET` → log + return 500 (misconfiguration must be loud);
   wrong/missing bearer → 401 as today. Dev keeps the open behavior. Document
   `CRON_SECRET` as **required** in `.env.example` and README deploy notes.
5. **Invite hardening (light-touch):** `acceptInvite` rate limit is in (b); keep the
   7-day TTL and single shared link (product-shape change deferred — non-goal here);
   delete the dead "for links placed in emails" comment
   ([src/lib/invites.ts:13](../../../src/lib/invites.ts)).

### (f) Receipt-image store abstraction — P2

New `src/lib/receipt-image-store.ts`:

```ts
export interface ReceiptImageStore {
  put(scanId: string, data: Uint8Array, contentType: string): Promise<void>;
  get(scanId: string): Promise<{ data: Uint8Array; contentType: string; byteSize: number } | null>;
  delete(scanId: string): Promise<void>;   // no-op under bytea (cascade handles it) but part of the contract
}
export function getReceiptImageStore(): ReceiptImageStore; // env-selected
```

- **Adapter 1 (now): `ByteaStore`** — current behavior, moved behind the interface.
  Callers change: `parseReceipt`'s image insert
  ([receipt-actions.ts:103-108](../../../src/app/receipt-actions.ts)) → `store.put(...)`
  (inside the (a) transaction when the store is bytea; for external stores, put **after**
  the transaction commits and compensate on failure), and the image route
  ([src/app/api/receipts/[scanId]/image/route.ts:31-44](../../../src/app/api/receipts/%5BscanId%5D/image/route.ts))
  → `store.get(...)` after the existing membership check. `deleteScan`/cascade semantics
  unchanged under bytea; external adapters hook `delete` into `deleteScan` and the
  04/08 retention job.
- **Adapter 2 (when needed): `R2Store`** (S3-compatible presigned PUT/GET, keys
  `receipts/<scanId>.jpg`; free 10 GB + zero egress — research §3; Vercel Blob is the
  alternative if one-vendor simplicity wins over price). The route keeps its auth check
  and either streams or 302s to a ~60 s presigned URL.
- **Migration script sketch** (`scripts/migrate-receipt-images.ts`): select `scan_id,
  content_type, byte_size` in pages → for each, read bytea, `put()` to the target,
  re-`get()` and compare SHA-256 → after full verification, drizzle migration drops
  `receipt_scan_images.data` (keep the table as metadata: content_type, byte_size,
  storage key). Idempotent, resumable (skip keys that already exist with matching hash).
- **Boundary restated:** retention (delete-after-parse, TTLs) is RFC 04/08's decision;
  this store just makes `delete` cheap wherever bytes live.

### (g) Pagination & query hygiene — quick wins P2, pagination P3

1. **fx_rates date filter (P2, one line):** in
   [group-data.ts:111](../../../src/lib/group-data.ts) fetch only
   `date >= min(expense.date)` (computable from the already-fetched expense rows by
   reordering the queries, or a `min(date)` subquery) — and skip the query entirely when
   no expense needs a floating-leg conversion (post-RFC 01 most BG groups won't).
2. **O(n×m) join fix (P2, trivial):** build `Map<expenseId, rows[]>` for payers and
   shares once; replace the per-expense `.filter()` at
   [group-data.ts:150-155](../../../src/lib/group-data.ts).
3. **Indexes (P2, one migration):** `expenses(group_id, date)`, `aliases(group_id)`,
   `activity_log(group_id, created_at)`, `group_members(user_id)`,
   `expense_payers(alias_id)`, `expense_shares(alias_id)`, `receipt_scans(expense_id)`,
   `group_invites(group_id)`. (Payers/shares lookups by `expense_id` are already covered
   by their PK column order.)
4. **`mergeAliasReferences` set-based rewrite (P2, pairs with (a)):** two statements per
   table instead of N+1 — update non-colliding rows
   (`UPDATE ... SET alias_id = to WHERE alias_id = from AND expense_id NOT IN (SELECT
   expense_id ... WHERE alias_id = to)`), then merge colliding rows with an
   `UPDATE ... FROM` sum + delete. Inside `withTransaction`.
5. **Expense-list cursor pagination (P3):** server loads the first page (e.g. 50) with a
   keyset cursor on `(date DESC, created_at DESC, id)` matching the current sort
   ([group-data.ts:106-110](../../../src/lib/group-data.ts)); a `loadMoreExpenses` server
   action returns the next page. **Balance math keeps a separate full fetch** of the
   minimal columns it needs (payers/shares cents + currency + date) — correct balances
   are non-negotiable; the payload the list UI drags along is what pagination trims.
   Persisted running balances are explicitly deferred until a real group exceeds ~1–2K
   expenses (research §8 sizing: not before thousands of groups at BG-market shapes).

### (h) Backup + restore runbook — P2

- `.github/workflows/backup.yml`: nightly cron, `pg_dump "$DATABASE_URL" --format=custom
  --exclude-table-data=receipt_scan_images -f backup.pgdump` (pin the `postgres-client`
  major to Neon's Postgres version), upload as artifact with 90-day retention. Repo
  secret `DATABASE_URL` (read-only role if practical). Private-repo artifact quota
  (500 MB) holds years of this app's data at these sizes; move the destination to R2 if
  that ever tightens or if image data must be included.
- `docs/ops/restore-runbook.md` (created by this RFC): (1) restore into a **new Neon
  branch/database** with `pg_restore --clean --if-exists`, (2) sanity checks (row counts,
  one group's balances vs production screenshot, `scripts/db-smoke.ts` pattern against
  the restored DB), (3) repoint `DATABASE_URL` in Vercel, redeploy, (4) quarterly drill
  note. Also document Neon PITR per plan (free = 6 h — and the recommendation to move to
  Launch when revenue starts, per [RFC 09](../09-monetization/rfc.md)).

## 4. Implementation plan (staged, independently shippable)

| Stage | Priority | Contents | Touches |
|---|---|---|---|
| 1 | **P1** | `withTransaction` + wrap saveExpense/saveSettlement/persistScanEdits/parseReceipt; latency measurement note | `db/index.ts`, `actions.ts`, `receipt-actions.ts` |
| 2 | **P1** | deleteGroup set-based + transactional; mergeAliasReferences rewrite + transactional | `actions.ts`, `merge-alias.ts` |
| 3 | **P1** | `rate_limits` table + `limit()` helper + 4 action call sites + i18n keys + cron purge | migration, `lib/rate-limit.ts`, `actions.ts`, `receipt-actions.ts`, `i18n.ts`, cron route |
| 4 | **P1** | Sentry: SDK, `fail()` + cron capture, PII scrub | `instrumentation*.ts`, `action-helpers.ts`, cron route, `.env.example` |
| 5 | P2 | CI workflow + Dependabot + `typecheck`/`test:smoke` scripts | `.github/`, `package.json` |
| 6 | P2 | CSP report-only middleware + HSTS + `camera=(self)` + cron fail-closed | `middleware.ts`, `next.config.ts`, cron route, `.env.example` |
| 7 | P2 | Cron ping + `<Analytics/>` | cron route, `layout.tsx` |
| 8 | P2 | Image-store interface + ByteaStore + call-site swap (no vendor move yet) | `lib/receipt-image-store.ts`, `receipt-actions.ts`, image route |
| 9 | P2 | fx date filter, Map join, index migration | `group-data.ts`, migration |
| 10 | P2 | Backup workflow + restore runbook | `.github/`, `docs/ops/` |
| 11 | P2→enforce | CSP flip to enforcing after clean soak | `middleware.ts` |
| 12 | P3 | Expense-list cursor pagination + `loadMoreExpenses` | `group-data.ts`, `actions.ts`, `ExpenseList.tsx` |
| 13 | P3 (on demand) | R2Store adapter + image migration script | `lib/receipt-image-store.ts`, `scripts/` |

Stages 1–4 are the pre-monetization launch blockers. 5–10 are cheap and order-flexible.

## 5. Acceptance criteria

- **Atomicity:** killing the process (`kill -9` / thrown injection) between `saveExpense`'s
  delete and reinsert leaves **no expense row without payers and shares** — verified by a
  PGlite test that throws inside the `withTransaction` callback and asserts full rollback
  (old payers/shares intact), plus ⚠️ one manual run against a Neon branch with the Pool
  driver. Same style of test for `persistScanEdits` (items unchanged on failure) and
  `mergeAliasReferences` (no half-merged alias). `deleteGroup` on a failing FK leaves the
  group fully intact.
- **`parseReceipt` compensation code deleted** — no `try { … } catch { delete scan }`
  remains at `receipt-actions.ts:100-124`.
- **Rate limiting:** the **6th `parseReceipt` within one minute** by one user returns the
  localized too-many-requests error (a UI-visible 429-equivalent), the 5th succeeds;
  second `updateRatesNow` within 10 minutes (any user) is rejected; limits reset after
  the window; PGlite tests cover window rollover and the sliding-window weighting.
- **Observability:** a thrown error in any server action appears in Sentry with no receipt
  bytes/PII in the event; a cron run that throws produces **no ping**, and the monitor
  alerts within 26 h; analytics events appear with zero new cookies (verify in devtools —
  the only cookies remain the Auth.js session + `locale`).
- **CI:** the workflow is green on master running exactly `tsc --noEmit`, `lint`,
  `test:math`, `test:receipt`, `test:receipt-db`, `db-smoke` with no secrets configured;
  a type error in a PR fails the check; Dependabot opens its first PRs.
- **Headers:** CSP ships report-only with zero violations across login → create group →
  invite/join → add/edit expense → scan → convert → settle; then enforced with the same
  zero-violation soak. `curl -sI` of production shows HSTS and
  `Permissions-Policy: camera=(self), …`. Cron: missing secret in prod → 500, wrong
  bearer → 401, correct → 200.
- **Image store:** with `ByteaStore`, the scan flow and image route behave byte-identically
  (existing `test:receipt-db` still passes; image response bytes hash-equal before/after
  the refactor).
- **Query hygiene:** `loadGroupData` issues an fx query bounded by the group's oldest
  expense date (or none when no floating conversion is needed); `EXPLAIN` on
  expenses-by-group uses the new index; group page render for a 500-expense seeded group
  does not regress.
- **Backups:** the nightly artifact exists and `pg_restore` into a scratch PGlite/Neon
  branch succeeds per the runbook, with row counts matching.

## 6. Risks & alternatives considered

- **WebSocket driver per-mutation latency / cold start** — the headline risk. Every
  `withTransaction` pays TLS + WebSocket setup, and a scaled-to-zero Neon compute adds its
  cold start (which HTTP pays too). Mitigations: reads stay on HTTP (unchanged);
  **measure first** (stage 1 includes an instrumented comparison in a preview deploy);
  fallback is `db.batch` (neon-http pipelined single-transaction batch) for the
  insert-only groups, accepting that only same-batch statements are atomic — with a PGlite
  shim (sequential statements inside a PGlite transaction) since drizzle's Batch API
  doesn't list PGlite. Not chosen as primary because batch can't cover
  read-then-write flows like `mergeAliasReferences`.
- **Interactive transactions hold Neon compute slightly longer** than one-shot HTTP
  queries — negligible at this app's mutation volume; revisit only if CU-hours spike.
- **In-Postgres rate limiting lets an attacker make the DB count their abuse** — each
  rejected request still costs one upsert. Acceptable: the guarded resources (LLM call,
  Frankfurter fetch, 120 s invocations) are far more expensive than the upsert, all
  limited actions sit behind Google OAuth, and the Upstash-shaped `limit()` API makes the
  vendor swap a one-file change if it ever matters. Alternative rejected for now: Upstash
  from day one (another vendor/secret for no current need).
- **Nonce CSP forces dynamic rendering** — irrelevant here (every page already calls
  `auth()`), but a future static marketing/landing page must be excluded from the nonce
  matcher or use the hash-based approach; note this in the middleware comment.
- **Enforced CSP breaking an obscure flow** — mitigated by report-only soak + the
  acceptance flow-list; the policy change is one header value to revert.
- **`--exclude-table-data=receipt_scan_images` means dumps can't restore images** — a
  deliberate trade (research §5): images are slated for short retention (04/08) and PITR
  covers them on paid plans. Alternative (full weekly dump to R2) documented in the
  runbook if kept images become precious.
- **Widening `Db` types for `withTransaction`** could ripple through helper signatures —
  contained by typing `TxDb` as the drizzle-pg base and touching only the helpers that
  mutate (`mergeAliasReferences`, `logActivity`).
- **Vercel Analytics is Vercel-locked and capped at 50K events on Hobby** — acceptable:
  the Pro move is already planned (RFC 09), and Umami Cloud is a drop-in-shaped fallback
  documented in research §4.
