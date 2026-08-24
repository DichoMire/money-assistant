# RFC 04 — Receipt Scanning: Paid Models, Bulgarian Eras, Eval Harness, Unit Splits, Metering & Retention

> **Status:** Proposed · **Priority: P1 — blocks real-user launch and is the monetization foundation**
> **Audience:** a future LLM implementer with full repo access. Read
> [research.md](research.md) and [00-current-state-audit.md §2](../00-current-state-audit.md)
> first; era facts come from [01-euro-transition/research.md §3](../01-euro-transition/research.md).
> All file/line references are to commit `14963d2`; re-locate by symbol name if drifted.

## 1. Problem

1. **Free LLM endpoints are the production default.** `DEFAULT_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free"`
   plus three `:free` fallbacks ([src/lib/receipt-parse.ts:23-28](../../../src/lib/receipt-parse.ts)).
   [.env.example:29-32](../../../.env.example) itself says to switch before real users' receipts
   are involved (training-on-input, card last-4 / loyalty IDs); the module comment
   (`receipt-parse.ts:14-19`) documents the free-tier failure modes the ladder exists to absorb.
   Also doc drift: `.env.example:36-39` lists two fallbacks, omitting
   `dots-studio/dots-3-note-preview:free`.
2. **The prompt/schema ignores Bulgarian receipt eras.** `buildReceiptPrompt`
   ([src/lib/receipt-schema.ts:38-79](../../../src/lib/receipt-schema.ts)) teaches only
   `"лв" = BGN, "ЕВРО" = EUR`. The 2026 dual-total (`ОБЩА СУМА` in EUR **and** BGN with printed
   `1.95583`) is *discarded* by `SUMMARY_LINE_RE` (`receipt-schema.ts:112-113`) instead of used
   as a validation signal; VAT-group letters (А/Б/В/Г) are stripped from names
   (`receipt-schema.ts:70`) and never captured; deposit/discount lines are stored
   indistinguishable from products.
3. **No eval harness.** `cleanParsedItems` is ~70 lines of heuristics fitted to Billa/Fantastico
   output (`receipt-schema.ts:126-195`) guarded by exactly six synthetic quirk cases
   ([scripts/receipt.test.ts:82-161](../../../scripts/receipt.test.ts)) — no image-level
   extraction metric exists, so a model swap is unmeasurable
   ([audit §10 items 15-16](../00-current-state-audit.md)).
4. **Quantity is display-only.** "3 × Beer" cannot be split at unit granularity — the review UI
   edits only the line total ([src/components/ScanReviewView.tsx:27-29](../../../src/components/ScanReviewView.tsx));
   `claudeConv.md:46-47` flagged this as the top practical gap.
5. **No metering or quota.** `parseReceipt` ([src/app/receipt-actions.ts:39-138](../../../src/app/receipt-actions.ts))
   has no per-user accounting, no `usage` capture, no rate limit — LLM spend is unbounded per
   user, and the planned freemium credit tier ([topic 09 §3](../09-monetization/research.md)) has
   no enforcement layer to attach to.
6. **Images are retained forever** as `bytea` ([src/db/schema.ts:196-203](../../../src/db/schema.ts)),
   conflicting with data minimization ([topic 08 §1](../08-privacy-gdpr/research.md)); the parse
   blocks a synchronous invocation sized by `maxDuration = 120`
   ([src/app/groups/[id]/scan/page.tsx:10](../../../src/app/groups/%5Bid%5D/scan/page.tsx)).

## 2. Goals / non-goals

**Goals**
- G1. Paid, no-training model default; provider/endpoint fully env-driven with an EU-friendly path; ladder retained.
- G2. Era-aware prompt + schema: era inference from receipt date, dual-total cross-check at 1.95583 ± 0.01, VAT-group letters per item, deposit/discount line typing.
- G3. Golden-set eval harness (`scripts/receipt-eval.ts` + fixtures) with item-recall and reconcile-rate metrics, CI-runnable, baseline-diffable.
- G4. Unit-level quantity splitting for integer quantities; disabled for fractional (weighted) items.
- G5. Per-user monthly scan metering + quota enforcement in `parseReceipt` with a localized quota-exceeded UX hook for the future paywall.
- G6. Image bytes deleted after successful conversion by default, per-scan "keep image" opt-in; EXIF-stripping status verified and documented.
- G7. Documented decision + trigger points for background processing (stay synchronous now).

**Non-goals**
- Billing, entitlements, pricing UI, payment provider — [RFC 09](../09-monetization/rfc.md) (this RFC only meters and enforces a quota number it is handed).
- Moving image storage out of Postgres to object storage — [RFC 11](../11-reliability-scale/rfc.md).
- Privacy-policy/ToS text and general GDPR machinery (account deletion, export) — [RFC 08](../08-privacy-gdpr/rfc.md).
- FX/era handling outside the parser (fixed 1.95583 conversion, currency retirement) — [RFC 01](../01-euro-transition/rfc.md).

## 3. Design

### 3.1 (a) Model/provider migration path

- **Env surface** (all optional, sane paid defaults):
  - `RECEIPT_API_URL` — default `https://openrouter.ai/api/v1/chat/completions` (replaces the
    `API_URL` const at `receipt-parse.ts:22`). Pointing it at `https://eu.api.openai.com/v1/chat/completions`
    (with `OPENROUTER_API_KEY` holding an OpenAI key and `OPENROUTER_MODEL=gpt-5-mini`) is the
    EU-residency option with **zero further code** — the request body is already
    OpenAI-compatible. Consider renaming the key var to `RECEIPT_API_KEY` with the old name as
    fallback, so the naming stops lying when not on OpenRouter.
  - `OPENROUTER_MODEL` — **new default: a paid model.** Recommendation at time of writing:
    `google/gemini-2.5-flash-lite` (≈$0.0005/scan) with a note that it retires ~Oct 2026; ⚠️ the
    implementer must re-verify the cheapest adequate tier (likely `google/gemini-3.1-flash-lite`)
    and run the eval harness (3.3) before pinning. Accuracy-first alternative:
    `anthropic/claude-haiku-4.5` (≈$0.006/scan).
  - `OPENROUTER_FALLBACK_MODEL` — default to one or two *paid* alternates from different vendors
    (e.g. `openai/gpt-5-mini,anthropic/claude-haiku-4.5`). Free models remain usable for local
    dev by overriding. Ladder mechanics (`modelLadder`, timeouts, salvage) stay unchanged.
  - `OPENROUTER_ZDR` — when `"true"`, add `provider: { zdr: true }` to the request body
    ([OpenRouter ZDR](https://openrouter.ai/docs/guides/features/zdr)). Independently, the
    operator checklist (in `.env.example` comments) says: disable "train on inputs" endpoints in
    the OpenRouter account privacy settings.
- **Structured outputs:** add `response_format: { type: "json_schema", json_schema: { name: "receipt", strict: true, schema: … } }`
  mirroring the wire schema, plus `provider: { require_parameters: true }` when on OpenRouter so
  routing only hits endpoints that honor it. Keep `extractJson` + the reasoning-field salvage as
  fallback (harmless, and dev free-models still need it).
- **`.env.example` rewrite** for the receipt block: paid default, ZDR flag, EU-endpoint recipe,
  fix the fallback-list drift.

### 3.2 (b) Prompt + schema upgrade for Bulgarian eras

- **Era helper** in `receipt-schema.ts` (isomorphic, testable):

  ```ts
  export type ReceiptEra = "bgn" | "dual" | "eur";
  export function inferReceiptEra(dateISO: string | null): ReceiptEra | null {
    if (!dateISO) return null;
    if (dateISO <= "2025-12-31") return "bgn";
    if (dateISO <= "2026-08-08") return "dual";
    return "eur"; // voluntary BGN reference lines may still appear — tolerate
  }
  ```

- **Wire-schema additions** (all optional so older models degrade gracefully):
  - receipt level: `second_total_minor` + `second_total_currency` (the printed dual total, e.g.
    BGN on a 2026 receipt), `printed_rate` (the `1.95583` line if shown), `is_fiscal_receipt`
    (fiscal footer "ФИСКАЛЕН БОН" / QR present).
  - item level: `tax_group` (`"А" | "Б" | "В" | "Г" | null` — the letter printed after the name),
    `line_type` (`"product" | "deposit" | "discount" | "fee"`).
- **Prompt additions:** the three-era table (line items BGN ≤ 2025, EUR from 2026; dual totals
  Jan–Aug 2026); "the second `ОБЩА СУМА`/`ОБЩА СУМА В ЛЕВА` in the other currency goes in
  `second_total_minor`, never in `items`"; "the tax-group letter goes in `tax_group`"; "classify
  deposit (`ДЕПОЗИТ`) and discount (`ОТСТЪПКА`) lines via `line_type`"; keep every existing rule.
- **Validation additions** in `validateParsedReceipt`:
  1. `era = inferReceiptEra(date)`. If era is `bgn` and claimed currency is EUR (or era `eur`/
     `dual` and claimed BGN), and the model gave no strong symbol evidence, prefer the
     era-implied currency; log the correction.
  2. **Dual-total cross-check**: when `second_total_minor` is present in the opposite currency,
     compute `expected = round(eurTotal × 1.95583)` and set
     `dualTotalMatches = |bgnTotal − expected| ≤ 1` (±0.01 in minor units). Expose it on
     `ParsedReceipt`; `parseReceipt` stores it. A `false` here (or a reconcile failure) is the
     trigger for the review-UI amber banner and the retry-at-higher-res offer (3.7).
  3. VAT-letter fallback: when `tax_group` is null but `raw_text` ends with `*?[АБВГ]`, capture
     it by regex.
- **Storage:** nullable columns via drizzle migration — `receipt_items.tax_group text`,
  `receipt_items.line_type text`; `receipt_scans.second_total_cents integer`,
  `receipt_scans.second_currency text`, `receipt_scans.dual_total_matches boolean`. The second
  total also feeds [RFC 01](../01-euro-transition/rfc.md)'s leva-equivalent display for free.
- **`cleanParsedItems`:** unchanged in spirit; ensure the dual-total/rate lines the model might
  still emit as items are dropped (extend `SUMMARY_LINE_RE` with `курс` and `в лева`) — but only
  *after* the validator has consumed `second_total_minor`.

### 3.3 (c) Golden-set eval harness

- **Files:** `scripts/receipt-eval.ts` (tsx, `node:assert`-free — it reports, doesn't assert)
  reading fixtures from `RECEIPT_FIXTURES_DIR` (default `scripts/receipt-fixtures/`). Each
  fixture: `NNN-slug/image.jpg` + `truth.json` (a `ParsedReceipt` plus `era`, `chain`,
  `quality` tags). **Fixtures are personal data — the folder is gitignored**; commit only
  `manifest.json` (id, chain, era, sha256) so runs are comparable across machines
  ([topic 08 §1](../08-privacy-gdpr/research.md)). Target ≥ 30 receipts across
  Billa/Kaufland/Lidl/Fantastico/T-Market/restaurant × the three eras × good/degraded photos.
- **Metrics** (printed as a table + written to `eval-report.json`):
  - **Line-item recall & precision**: greedy one-to-one matching (Hungarian-style) of predicted
    vs truth items on exact `totalCents` first, then normalized-name similarity ≥ 0.5 as
    tiebreak — order-insensitive, per the receipt-benchmark practice cited in
    [research.md §3](research.md).
  - **Reconcile rate**: fraction of receipts where `reconcile(...).ok` (function already exists —
    `receipt-schema.ts:277-288`).
  - **Total accuracy** (exact cents), **date / merchant / currency / era accuracy**,
    **dual-total capture rate** on dual-era fixtures.
  - Per-model cost and latency from the response `usage` field.
- **Modes:** `--model X` (override env), `--baseline eval-report.json` (print deltas — the
  model-swap regression check), `--only chain=billa`.
- **CI:** GitHub Actions `workflow_dispatch` job (manual trigger; needs `OPENROUTER_API_KEY`
  secret and a fixtures artifact) — **not** on push: costs money, needs secrets, and LLM output
  is not perfectly deterministic even at `temperature: 0`. Local: `npm run eval:receipts`.
- **Thresholds** (initial, revise after the first baseline): item recall ≥ 0.90,
  reconcile rate ≥ 0.80, total accuracy ≥ 0.90. The six existing quirk tests stay in
  `npm run test:receipt` guarding `cleanParsedItems` deterministically.

### 3.4 (d) Unit-level quantity splitting

- **Eligibility:** `Number.isInteger(quantity) && quantity >= 2 && quantity <= 99`. Fractional
  (weighted) quantities keep today's whole-line modes, with a hint in the assign sheet.
- **Data model:** add `"units"` to `ASSIGN_MODES` ([src/lib/receipt-convert.ts:11-13](../../../src/lib/receipt-convert.ts))
  and a nullable `units integer` column to `receipt_item_shares`
  ([src/db/schema.ts:228-240](../../../src/db/schema.ts)). For `assignMode === "units"`: one share
  row per participating person with `units ≥ 1`, `exactCents` null, and
  `sum(units) === item.quantity` — validated in `persistScanEdits`
  ([src/app/receipt-actions.ts:178-230](../../../src/app/receipt-actions.ts)) alongside the
  existing per-mode rules.
- **Allocation:** in `computePersonTotals`, the `units` branch is
  `allocateByWeights(item.totalCents, shares.map(s => s.units))` — largest-remainder already
  guarantees exact sums (`src/lib/money.ts:34-51`), so 3 units of 5.00 → 167/167/166.
- **UI (`ScanReviewView` / `ScanAssignModal`):** eligible items show a "по бройки / by units"
  mode in the assign sheet with a stepper per person ("2 от 3"); the inline chips keep meaning
  equal-split (tapping chips falls back to equal, as today — `ScanReviewView.tsx:122-129`).
  Remaining-units counter mirrors the exact-mode "entered/left" pattern.
- **Types:** `ScanItemInput`/`ScanItemDto` shares gain `units: number | null`; DTO mapping in
  `group-data.ts` scan loaders.

### 3.5 (e) Scan metering + quota

- **Table** (drizzle migration):

  ```ts
  export const scanUsage = pgTable("scan_usage", {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    month: text("month").notNull(),          // "YYYY-MM", Europe/Sofia month boundary (reuse RFC 01's Sofia todayString)
    count: integer("count").notNull().default(0),
  }, (t) => [primaryKey({ columns: [t.userId, t.month] })]);
  ```

- **Quota source:** `SCAN_MONTHLY_QUOTA` env (default `5`, per [topic 09 §3](../09-monetization/research.md):
  free 3–5) plus a nullable `users.scan_quota_override integer` column — the single hook
  [RFC 09](../09-monetization/rfc.md)'s entitlement layer will write (paid: 50–100). This RFC
  never reads payment state.
- **Enforcement in `parseReceipt`** (`receipt-actions.ts:39`), ordered:
  1. auth/role/file checks (existing);
  2. dedupe check (existing, `:55-63`) — **duplicates never consume quota** (no LLM call);
  3. quota check: read `count` for `(user.id, currentMonth)`; if `count >= quota`, return a new
     failure shape `{ ok: false, error: t("parse.quotaExceeded", { quota }), quotaExceeded: true }`
     (extend `ParseReceiptResult` in `src/lib/types.ts`); **no LLM call, no scan row**;
  4. parse (existing); on success, one atomic statement — safe without transactions on the Neon
     HTTP driver:
     `INSERT INTO scan_usage (user_id, month, count) VALUES ($1,$2,1) ON CONFLICT (user_id, month) DO UPDATE SET count = scan_usage.count + 1`.
     Failed parses don't count (user got nothing; spend risk is bounded by the quota check +
     paid-model prices; hard rate limiting stays [RFC 11](../11-reliability-scale/rfc.md)).
- **Cost capture:** read the OpenRouter response `usage` object (always included —
  [usage accounting](https://openrouter.ai/docs/use-cases/usage-accounting)); store
  `receipt_scans.cost_microusd integer` (nullable; `round(usage.cost × 1e6)`) and token counts if
  desired. Direct-provider endpoints without a `cost` field leave it null.
- **UX hook:** new i18n keys (EN + BG): `parse.quotaExceeded`
  ("Използвахте безплатните си {quota} сканирания за този месец." + a slot-in second sentence),
  `scan.quotaCounter` ("{used} от {quota} сканирания този месец") rendered on the upload view.
  `ScanUploadView` renders the quota-exceeded state as a distinct banner (not the generic error
  row) with a placeholder CTA area — RFC 09 swaps in the actual upgrade action. The counter needs
  the current usage passed from the scan page loader.
- **Race note:** read-then-increment can overshoot by 1–2 under concurrent uploads from one
  user; acceptable (cost ≈ half a eurocent). Increment-first-then-refuse was rejected — it burns
  a credit on a refused scan.

### 3.6 (f) Image retention

- **Default: delete after successful conversion.** At the end of `convertScan`
  (`receipt-actions.ts:342-345`, after the expense link is written): if `!scan.keepImage`,
  `DELETE FROM receipt_scan_images WHERE scan_id = …`. New column
  `receipt_scans.keep_image boolean NOT NULL DEFAULT false` + a checkbox in the review view
  ("Запази снимката след осчетоводяване" / "Keep the photo after converting"). `imageHash` stays
  on `receipt_scans`, so group-level dedupe (`:55-63`) keeps working — a re-upload of a deleted
  image still short-circuits to the existing scan.
- **Drafts:** extend the daily cron (`api/cron/daily/route.ts`) to delete image rows for
  *unconverted* scans older than **90 days** (⚠️ align the exact number with
  [RFC 08](../08-privacy-gdpr/rfc.md); scans/items themselves stay — they're the user's data).
- **UI:** `ScanDetailDto` gains `hasImage: boolean`; the review view hides the thumbnail/link
  when false; `GET /api/receipts/[scanId]/image` already 404s naturally on a missing row —
  verify and keep.
- **EXIF — verified stripped client-side:** `downscaleToJpeg`
  ([ScanUploadView.tsx:46-65](../../../src/components/ScanUploadView.tsx)) always redraws
  through a canvas and re-encodes with `canvas.toBlob(..., "image/jpeg", q)` — the output JPEG
  carries **no EXIF/GPS/serial metadata** from the original (canvas encoders write pixels only),
  and orientation is pre-applied via `createImageBitmap(file, { imageOrientation: "from-image" })`
  (`:27`). This holds even when `scale === 1` (no resize — still re-encoded). State it in a code
  comment. **Residual gap:** a crafted direct call to the `parseReceipt` server action can upload
  un-stripped bytes (the server accepts any JPEG/PNG/WebP ≤ 3.5 MB, `receipt-actions.ts:30-31`);
  server-side re-encode is deliberately out of scope here (noted for
  [RFC 11](../11-reliability-scale/rfc.md) if images move to object storage).

### 3.7 (g) Background processing — assessed, deferred

**Decision: stay synchronous.** With a paid primary model the ladder almost never walks; typical
end-to-end parse is seconds, well inside the 35 s attempt timeout and the 120 s page budget
(`receipt-parse.ts:29-32`, `scan/page.tsx:10`). A queue forces a status-polling/streaming UI
(the unused `receiptScans.status` field would finally earn its keep) — complexity not justified
at current scale. Options are documented in [research.md §5](research.md) (Vercel `after()`/
Queues/Workflow, QStash free ~500–1,000 msg/day, Inngest free ~50k runs/month — all low-budget).

**Documented trigger points for moving the parse to a queue** (record this list in a comment at
the top of `receipt-parse.ts`):
1. sustained p95 parse latency > ~30 s (measure via the new per-scan latency capture, 3.5);
2. a batch/multi-receipt upload feature;
3. server-side automatic retries (incl. retry-at-higher-res) rather than user-driven ones;
4. function-duration or concurrency pressure on the Vercel plan after the move to Pro
   ([topic 09 §4](../09-monetization/research.md)).

**Do now instead — client-side retry-with-higher-res:** on `invalid_response`, or a parse with
`reconciles === false` and `|diffCents|` above ~5% of the total, `ScanUploadView` offers one
"Опитай с по-високо качество" retry: re-encode the still-held original `File` at max edge 3600 px
/ quality 0.85 and resubmit. The new bytes hash differently so dedupe won't short-circuit;
count it against quota like any scan (it's a real LLM call), or ⚠️ decide to exempt one retry —
implementer's call with topic 09.

## 4. Implementation plan (ordered, independently shippable)

| Stage | Contents | Touches | Why this order |
|---|---|---|---|
| 1 | Paid-model defaults, `RECEIPT_API_URL`, ZDR flag, structured outputs, `.env.example` rewrite (3.1) | `receipt-parse.ts`, `.env.example` | Privacy/reliability launch blocker; everything else assumes a stable model |
| 2 | Eval harness + fixture collection + first baseline (3.3) | `scripts/receipt-eval.ts`, `scripts/receipt-fixtures/` (gitignored), `.github/workflows/`, `package.json` | Baselines the stage-1 model **before** prompt changes, so stage 3 is measured |
| 3 | Era prompt/schema/validation, dual-total cross-check, VAT groups, line typing (3.2) | `receipt-schema.ts`, `receipt-actions.ts`, `schema.ts` + migration, `receipt.test.ts` | The BG-specific accuracy win; verified by re-running stage 2 |
| 4 | Metering table, quota check, cost capture, quota UX hook (3.5) | `schema.ts` + migration, `receipt-actions.ts`, `types.ts`, `i18n.ts`, `ScanUploadView.tsx`, scan `page.tsx` | Must exist before any marketing push / the RFC 09 paywall |
| 5 | Image retention: keep-image flag, post-convert delete, cron sweep (3.6) | `schema.ts` + migration, `receipt-actions.ts`, `ScanReviewView.tsx`, `api/cron/daily` | GDPR minimization (topic 08) — before launch |
| 6 | Unit-level splitting (3.4) | `receipt-convert.ts`, `receipt-actions.ts`, `schema.ts` + migration, `ScanReviewView.tsx`, `ScanAssignModal.tsx`, `types.ts`, `receipt.test.ts` | Feature polish; independent of 1–5 |
| 7 | Retry-with-higher-res + queue-trigger documentation (3.7) | `ScanUploadView.tsx`, `receipt-parse.ts` comment | Nice-to-have; needs stage 4's latency numbers |

Stages 1, 4, 5 are the real-user launch gate; 2–3 are the quality program; 6–7 trail.

## 5. Acceptance criteria

- **Model/config:** with only env vars, the app runs against (a) an OpenRouter paid ladder and
  (b) `eu.api.openai.com` directly — zero code changes between them. No `:free` model is reachable
  in a default production deployment. `ParsedReceipt` still round-trips through
  `npm run test:receipt`.
- **Era inference:** `inferReceiptEra("2025-11-30") === "bgn"`, `("2026-03-14") === "dual"`,
  `("2026-08-24") === "eur"`, `(null) === null` — unit-tested. A dual-era fixture with EUR total
  20.00 and printed `ОБЩА СУМА В ЛЕВА 39.12` yields `currency: "EUR"`,
  `secondTotalCents: 3912`, `secondCurrency: "BGN"`, `dualTotalMatches: true`; changing the BGN
  line to 39.20 flips `dualTotalMatches` to `false` (|3920 − 3912| > 1). A 2025 fixture with
  `лв` totals yields `currency: "BGN"`.
- **VAT/line typing:** items on a fixture carry `taxGroup` ∈ {А,Б,В,Г} where printed; a
  `ДЕПОЗИТ` line gets `lineType: "deposit"`, an `ОТСТЪПКА` line `"discount"` with negative cents.
- **Eval harness:** `npx tsx scripts/receipt-eval.ts` over ≥ 30 fixtures prints per-metric table
  and writes `eval-report.json`; `--baseline` prints deltas; the CI job runs via
  `workflow_dispatch`. Stage-3 completion requires item recall ≥ 0.90 and reconcile rate ≥ 0.80
  on the default model (revise thresholds with the first baseline, but never below stage-2's
  measured baseline).
- **Unit splits:** a "3 × Бира 5.40" item assigned 2 units to A and 1 to B produces 3.60 / 1.80;
  a 5.00 item over 3 units produces 167/167/166 summing exactly; a 0.726-quantity item offers no
  units mode; a server call with `sum(units) !== quantity` is rejected with a localized error;
  converting produces an expense whose exact splits sum to the total (existing
  `computeShares("exact")` check in `receipt.test.ts:303-325` pattern extended).
- **Quota:** with `SCAN_MONTHLY_QUOTA=5` and 5 counted scans this Sofia-month, the 6th upload
  returns the localized quota message with `quotaExceeded: true`, creates **no** scan row and
  makes **no** LLM call; re-uploading an *existing* image (dedupe hit) still succeeds and does
  not increment; two concurrent first-scans both land and `count === 2` (upsert is atomic);
  `users.scan_quota_override = 100` lifts the limit for that user; the upload view shows
  "X от Y сканирания".
- **Retention:** converting with the keep-checkbox off deletes the `receipt_scan_images` row
  (verify in PGlite test alongside `receipt-db.test.ts` cascades), the API route 404s, the
  review view renders without a thumbnail, and dedupe on the same hash still short-circuits;
  with the checkbox on, the image survives. The cron sweep deletes only images of unconverted
  scans older than the cutoff.
- **EXIF:** a JPEG with GPS EXIF uploaded through the UI arrives at the server without any EXIF
  segment (documented manual check + the code comment from 3.6).
- All existing suites pass: `npm run test:math`, `npx tsx scripts/receipt.test.ts`,
  `npx tsx scripts/receipt-db.test.ts`, `npx tsx scripts/db-smoke.ts`.

## 6. Risks & alternatives considered

- **Model churn** (Gemini 2.5 Flash-Lite retirement ~Oct 2026; any pinned name rots): mitigated
  by env-driven names + the eval harness making a swap a measured half-day, not a leap of faith.
- **Structured outputs vary across OpenRouter endpoints**: `require_parameters` narrows routing
  (possibly to fewer/pricier endpoints); the salvage path stays as belt-and-braces. Alternative
  — dropping OpenRouter for one direct provider — rejected for now: the ladder's cross-vendor
  fallback is worth keeping at this scale.
- **Dedicated OCR service instead of a VLM** (Google Document AI receipt parser, Azure Document
  Intelligence): rejected — ⚠️ per-page pricing (~$0.01+) is 10–100× the VLM cost, adds a vendor,
  and current VLMs handle Cyrillic thermal receipts well enough to measure first.
- **Quota race without transactions**: read-then-increment can exceed quota by 1–2 concurrent
  scans; accepted (sub-cent exposure). The alternative (atomic increment-then-refuse) charges
  users for refused scans — worse.
- **Deleting images kills future re-parse / late retry-at-higher-res**: accepted — retry is only
  offered in-session while the client holds the original; the parsed line items (the user's
  actual data) are never deleted. Users who want the photo check "keep image".
- **Era logic post-2026**: voluntary BGN reference lines are legal indefinitely
  ([01 research §3](../01-euro-transition/research.md) ⚠️ note) — the schema treats
  `second_total_minor` as always-optional, so nothing breaks when they disappear or persist.
- **Fixture privacy**: real receipts in a public repo would leak personal data — gitignored
  folder + committed hash manifest chosen over (a) committing scrubbed images (labor-intensive,
  destroys the degradation realism) and (b) synthetic receipts only (misses exactly the quirks
  `cleanParsedItems` exists for).
- **Unit-split scope creep** (per-unit differing prices, partial units): out of scope — units are
  uniform by construction (`quantity × unit_price ≈ total`); anything else is the exact-cents mode.
