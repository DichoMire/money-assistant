# Topic 04 — Receipt Scanning: Research

> Part of the [Bulgarian market improvement guide](../README.md).
> Research date: **2026-08-24**; pricing/policy claims web-checked that day. Companion
> implementation plan: [rfc.md](rfc.md). Current pipeline:
> [00-current-state-audit.md §2](../00-current-state-audit.md). Key inputs from other topics:
> receipt-format eras in [01-euro-transition/research.md §3](../01-euro-transition/research.md),
> LLM privacy/EU residency in [08-privacy-gdpr/research.md §1](../08-privacy-gdpr/research.md),
> per-scan cost & freemium shape in [09-monetization/research.md §3–4](../09-monetization/research.md).
> Unverified claims flagged ⚠️.

**Why this is the app's #1 differentiator:** Splitwise gates receipt scanning behind Pro
(~$4.99/month — [topic 10 §2](../10-growth-marketing/research.md)), and no global competitor
handles Bulgarian fiscal receipts (Cyrillic item lines, ОБЩА СУМА anchors, the 2025/2026
currency eras) well. The one local player, **Смят.AI / smetkata.live** — a BG-language
receipt-scan bill splitter, one receipt at a time, no group ledger
([topic 10 §1](../10-growth-marketing/research.md)) — validates the niche without occupying it.
Receipt scanning is also the planned **paid tier** (scan credits: free ~3–5/month, paid 50–100 —
[topic 09 §3](../09-monetization/research.md)), so the feature must become reliable, private and
metered before it can be either marketed or sold.

---

## 1. The free-endpoint setup must change before real users

The shipped default is `nvidia/nemotron-nano-12b-v2-vl:free` with three `:free` fallbacks
([src/lib/receipt-parse.ts:23-28](../../../src/lib/receipt-parse.ts)). The codebase itself
documents why this is untenable:

- [.env.example:29-32](../../../.env.example) warns that `:free` models "may use your inputs for
  training, and receipts can carry card last-4 / loyalty IDs — switch … before real users'
  receipts are involved". Not done ([audit §10 item 15](../00-current-state-audit.md)).
- The module comment ([receipt-parse.ts:14-19](../../../src/lib/receipt-parse.ts)) catalogs the
  free-tier failure modes the whole ladder/salvage design exists to absorb: shared upstream
  429 pools, responses that hang after headers, reasoning modes that burn the token budget and
  return empty content. No SLA, no recourse.
- OpenRouter's own docs confirm the policy reality: retention/training is governed by the
  **downstream provider**, and most free endpoints train on or may publish prompts — OpenRouter's
  account toggle "disallow training providers" filters out essentially all free endpoints at once
  ([support article](https://openrouter.zendesk.com/hc/en-us/articles/51690904755227)).
- GDPR angle: a receipt image tied to an account is personal data; sending it to a
  training-permitted endpoint is a processor problem that blocks launch
  ([topic 08 §1, §3](../08-privacy-gdpr/research.md)).

### Paid-model landscape for receipt extraction (verified 2026-08-24)

Per-scan estimates assume the app's actual payload: ~1600–2800 px JPEG + ~700-token prompt +
~700-token JSON output (⚠️ derived from cited unit prices, not measured bills — matches
[topic 09 §4](../09-monetization/research.md)).

| Model | $/M in | $/M out | ≈ cost/scan | Notes |
|---|---|---|---|---|
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | ~$0.0005–0.001 | Cheapest usable tier; ⚠️ slated for retirement ~Oct 2026 — plan on its successor ([Google pricing](https://ai.google.dev/gemini-api/docs/pricing)) |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | ~$0.002 | The successor tier, live on the same price list ([Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [pricepertoken](https://pricepertoken.com/pricing-page/model/google-gemini-3.1-flash-lite-preview)) |
| GPT-5 mini | $0.25 | $2.00 | ~$0.002–0.003 | OpenAI's mini tier as of Aug 2026 ([devtk](https://devtk.ai/en/models/gpt-5-mini/), [pricepertoken](https://pricepertoken.com/pricing-page/model/openai-gpt-5-mini)) |
| Claude Haiku 4.5 | $1.00 | $5.00 | ~$0.006 | Image ≈ W×H/750 tokens; verified against Anthropic's current price table |
| Gemini 3.5 Flash | $1.50 | $9.00 | ~$0.01+ | Overkill for this task; listed for completeness |

Every option is **well under one eurocent per scan** — a €4/month tier with 50–100 scans keeps
~99% gross margin on inference ([topic 09 §4](../09-monetization/research.md)). Model choice is
therefore about accuracy on Cyrillic thermal receipts (measure with the eval harness, §3), not
cost.

### Structured output / JSON-schema support

The current code relies on prompt discipline plus a brace-extraction salvage
([receipt-parse.ts:125-127](../../../src/lib/receipt-parse.ts)) — a free-model necessity. Every
paid candidate now does schema-enforced output:

- **OpenAI**: Structured Outputs (`response_format: json_schema`, `strict: true`) — guaranteed-valid JSON. https://platform.openai.com/docs/guides/structured-outputs
- **Google**: `responseSchema` / JSON mode on the Gemini API. https://ai.google.dev/gemini-api/docs/structured-output
- **Anthropic**: structured outputs via `output_config.format` on the Messages API (plus strict tool schemas). https://platform.claude.com/docs
- **OpenRouter**: passes `response_format` through; `provider: { require_parameters: true }` routes only to endpoints supporting it. https://openrouter.ai/docs/features/structured-outputs

Adopting schema enforcement removes the invalid-JSON failure class and most of
`validateParsedReceipt`'s coercion work (numeric strings, floats —
[receipt-schema.ts:98-103](../../../src/lib/receipt-schema.ts)).

### OpenRouter paid routing vs direct provider APIs

| | OpenRouter (paid endpoints) | Direct provider API |
|---|---|---|
| Code change | None — same endpoint, change `OPENROUTER_MODEL` (the design goal of [receipt-parse.ts:11-12](../../../src/lib/receipt-parse.ts)) | Small — the request body is OpenAI-compatible; only URL/key/model differ |
| Data policy | OpenRouter itself keeps ZDR — prompts not stored unless logging is opted into; retention/training still governed by the downstream provider; account/per-request controls: disallow training endpoints, `provider: {"zdr": true}` ([ZDR docs](https://openrouter.ai/docs/guides/features/zdr)) | Provider DPA applies directly; one processor fewer to disclose |
| EU residency | ⚠️ Routing-layer data-residency controls exist ([blog](https://openrouter.ai/blog/insights/ai-data-residency/)) but the router is a US company | **OpenAI**: EU projects (`eu.api.openai.com`); **Google**: Vertex AI EU regions; **Anthropic**: no first-party EU inference — via Bedrock/Vertex EU ([topic 08 §1](../08-privacy-gdpr/research.md)) |
| Provider training on API input | Paid endpoints of the big three don't train by default (below) | Same |
| Extras | Model ladder across vendors with one key; `usage` incl. **cost** on every response (§6); ⚠️ ~5% credit-purchase fee | Native rate limits, batch APIs, fewer hops |

Provider API data policies (all compatible with real users, unlike `:free`):
**OpenAI** — API inputs not used for training by default; EU residency + zero retention for
eligible customers ([topic 08 §1](../08-privacy-gdpr/research.md)). **Google** — paid-tier Gemini
API content "not used to improve our products"; the **free tier is** used
([Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)). **Anthropic** — API content
not used for training by default; 30-day retention is the standard non-ZDR default, ZDR
arrangements for eligible orgs (not on the newest frontier models)
([platform docs](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention),
[The Register](https://www.theregister.com/ai-and-ml/2026/08/20/openai-chases-anthropics-biz-customers-with-zero-data-retention-pledge/5290609)).

**Bottom line:** staying on OpenRouter but with paid models + "no training" account settings is
the zero-code-change fix; a direct EU endpoint (OpenAI EU or Vertex EU) is the stronger privacy
story ([topic 08 §1](../08-privacy-gdpr/research.md): "data stays in the EU" is a real BG trust
signal) at the cost of losing the cross-vendor ladder. The env-driven design supports either.

## 2. What a Bulgarian fiscal receipt gives an extraction prompt

Full format research in [01-euro-transition/research.md §3](../01-euro-transition/research.md);
what matters for extraction:

### The three currency eras (the single highest-value schema upgrade)

| Receipt date | Line items | Totals | Parser implication |
|---|---|---|---|
| ≤ 2025-12-31 | BGN (лв) | BGN; from 8 Aug 2025 also EUR total + printed rate | BGN authoritative |
| 2026-01-01 → 2026-08-08 | EUR | EUR + **mandatory BGN dual total + printed `1.95583`** | EUR authoritative; BGN total is a free cross-check |
| ≥ 2026-08-09 | EUR | EUR only; voluntary BGN reference lines remain legal (⚠️ tolerate indefinitely) | EUR authoritative |

When both totals appear, `|BGN − round(EUR × 1.95583)|` ≤ 0.01 is a **near-free extraction-quality
signal** — a mismatch means a misread total. Today the second total and rate line are *discarded*
as summary rows by `SUMMARY_LINE_RE` ([receipt-schema.ts:112-113](../../../src/lib/receipt-schema.ts))
rather than exploited.

### Fixed anatomy worth teaching the model

- **Header**: trader name/address, обект, ЕИК, ЗДДС № — merchant extraction anchors.
- **Items**: one line per article (grouping banned since 2017), each carrying a **VAT-group
  letter**: **А** = exempt/0%, **Б** = 20% standard, **В** = fuels, **Г** = 9% reduced. The
  letter marks a line as a *product* line — a structural item-vs-summary discriminator. The
  current prompt tells the model to strip the marker ([receipt-schema.ts:70](../../../src/lib/receipt-schema.ts))
  but not to capture it.
- **Totals block**: МЕЖДИННА СУМА (subtotal — a mid-list checkpoint), **ОБЩА СУМА** (the total
  anchor), payment lines (В БРОЙ / С КАРТА), ДДС breakdown per group.
- **Fiscal footer**: "ФИСКАЛЕН БОН" text/logo, device + fiscal-memory numbers, doc number,
  date/time, УНП, **QR code** (⚠️ encodes device number, doc number, date/time and total per
  Ordinance N-18 — a future offline cross-check, though decoding QR from a photo is unreliable).
  Presence of the footer is a strong "this is a real receipt" signal for the `not_a_receipt`
  gate; absence (invoices, handwritten notes) is informative too.
- **Line phenomena**: weighted items (`0.726 x 2.19` quantity-detail lines — handled by
  `QTY_LINE_RE` folding), bottle **deposits** (`ДЕПОЗИТ` / `депозит` — prompt says "own items",
  correct), per-line discounts (`ОТСТЪПКА`, negative), receipt-level savings summaries
  (`ТИ СПЕСТИ` — correctly excluded).

### Chain-specific quirks

| Chain | Observed / expected quirks | Status in code |
|---|---|---|
| **Billa** | Summary rows returned as items; bare `0.726 x 1.99` qty lines; duplicated twin rows; ТИ СПЕСТИ savings | **Handled** — `cleanParsedItems` was tuned on real Billa output ([receipt-schema.ts:119-195](../../../src/lib/receipt-schema.ts)); 6 test cases ([scripts/receipt.test.ts:82-161](../../../scripts/receipt.test.ts)) |
| **Fantastico** | Cyrillic layout in dev fixture ([scripts/seed-scan-dev.ts](../../../scripts/seed-scan-dev.ts)) | Partially exercised via seed data |
| **Kaufland** | ⚠️ K Card loyalty discounts printed as negative lines under items; long receipts (45+ lines) | Negative lines handled generically; length drove the 2800 px tall-image path ([ScanUploadView.tsx:14-19](../../../src/components/ScanUploadView.tsx)) |
| **Lidl** | ⚠️ Lidl Plus coupon lines; compact print | Untested — no fixture |
| **T-Market** | ⚠️ No specifics found | Untested — no fixture |

**Covered vs not covered today:** summary-row filtering, qty-line folding (Latin/Cyrillic ×),
twin dedupe, negative discount/deposit items, `лв`/`ЕВРО` currency inference, tax-marker
stripping — covered. **Not covered:** era inference from date, dual-total cross-check, VAT-group
capture per item, deposit/discount **typing** (they're indistinguishable from products in the
stored data), fiscal-footer validity signal, МЕЖДИННА СУМА as checkpoint.

## 3. Eval-harness practice for receipt extraction

- **Academic baseline**: the classic receipt IE datasets are SROIE (ICDAR 2019, 1k scanned
  receipts) and CORD (Indonesian receipts, line-item level labels); standard metrics are
  **field-level F1** and tree-edit-distance accuracy ([MDPI survey](https://www.mdpi.com/2504-4990/7/4/167),
  [ReceiptSense](https://arxiv.org/html/2406.04493v2)). 2025–26 MLLM benchmarks add
  LLM-judges + **Hungarian matching for line-item lists** (order-insensitive alignment before
  scoring) ([real-world receipt benchmark](https://arxiv.org/html/2605.22413v1),
  [ExtractBench](https://arxiv.org/html/2602.12247v2)) and consistently find general MLLMs
  underperform on dense/degraded receipts — i.e. **measure, don't assume**.
- **Practical LLM-era template**: Braintrust's receipt-extraction cookbook — small golden set,
  per-field scorers, line-item match scoring, compare models on one dashboard
  ([braintrust.dev](https://www.braintrust.dev/docs/cookbook/recipes/ReceiptExtraction)).
- **Right-sized for this app**: a golden set of **30–50 real Bulgarian receipts** with
  hand-verified ground truth, stratified across chains (Billa/Kaufland/Lidl/Fantastico/T-Market
  + restaurants), the three eras, and photo quality (crumpled, faded thermal, long, flash glare).
  Core metrics: **line-item recall/precision** (match on cents + fuzzy name),
  **total-reconciliation rate** (`reconcile` already computes this —
  [receipt-schema.ts:277-288](../../../src/lib/receipt-schema.ts)), total/date/merchant/currency
  accuracy, era-correctness.
- **Regression on model swap** is the point: model names pinned in env/code rot
  ([audit §10 item 15](../00-current-state-audit.md) — and Gemini 2.5 Flash-Lite retires ~Oct 2026),
  so every swap needs a before/after score, not vibes. A 50-receipt run at Haiku prices costs
  ~$0.30 (⚠️ estimate) — cheap enough for a manually-triggered CI job, too nondeterministic and
  key-dependent for every push.
- **Current state**: only 6 quirk cases exist, and they test the *post-parse cleanup*
  (`cleanParsedItems`) on synthetic item lists — **no image-level eval at all**
  ([audit §10 item 16](../00-current-state-audit.md)). The ~70 lines of heuristics in
  `cleanParsedItems` are exactly the kind of code that silently breaks when the model changes.
- **Privacy**: golden-set receipts are personal data (card last-4, loyalty IDs). Scrub or crop
  before committing, or keep the fixture folder out of the public repo entirely
  ([topic 08 §1](../08-privacy-gdpr/research.md)).

## 4. Unit-quantity splitting ("3 × Beer" across people)

The audit calls quantity **display-only** ([audit §2](../00-current-state-audit.md)); the code
comment says it outright ([ScanReviewView.tsx:27-29](../../../src/components/ScanReviewView.tsx):
"the UI edits only the line total"). The committed design conversation flagged this as the top
real-world bite (`claudeConv.md:46-47`): *"3× Beer 18.00" should be splittable as three units
across different people … disable unit-level splitting when quantity is fractional.*

- The scenario is the default at Bulgarian restaurant/store group orders: one line
  `3 x БИРА ЗАГОРКА 5.40`, three different drinkers. Today the only options are equal/exact
  split of the whole line — exact-cents entry for a third of 5.40 is manual toil.
- The data is already there: `quantity` (double) and `unitPriceCents` survive parsing and
  storage ([schema.ts:209-222](../../../src/db/schema.ts)); the qty-line folding logic exists to
  preserve them. What's missing is an assignment mode that distributes **units**.
- The math is solved in-repo: `allocateByWeights` (largest-remainder, sign-aware —
  [src/lib/money.ts:34-51](../../../src/lib/money.ts)) with unit counts as weights handles
  non-divisible totals (3 units of a 5.00 line → 167/167/166).
- Guardrail per claudeConv: unit assignment only when quantity is a **positive integer ≥ 2**;
  weighted items (0.726 кг) keep whole-line splitting.

Splitwise's itemization (Pro) splits per *item*, not per unit; ⚠️ no mainstream competitor
found offering unit-level assignment — a small genuine differentiator on top of an
already-differentiating feature.

## 5. Reliability architecture

**Current**: fully synchronous — the server action holds the connection through the model ladder
(35 s per attempt, 80 s total budget, sized against the page's `maxDuration = 120` —
[receipt-parse.ts:29-32](../../../src/lib/receipt-parse.ts),
[scan/page.tsx:10](../../../src/app/groups/%5Bid%5D/scan/page.tsx)). The user watches a spinner;
worst case blocks a paid serverless invocation for two minutes
([audit §10 item 14](../00-current-state-audit.md)).

**Paid models change the calculus**: a single reliable vision model returns in seconds and the
ladder almost never walks — most of the 120 s ceiling exists to absorb free-tier pathology.

**Low-budget background options on Vercel (2026)**, for when synchronous stops being enough:

- **`after()` / `waitUntil`** (Next 15.1+, `@vercel/functions`): run work *after* the response is
  sent, still bounded by the function's max duration — right for metering writes and cleanup,
  wrong for the parse itself (the user is waiting for the result)
  ([Vercel KB](https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out),
  [field notes](https://dev.to/ahmed_mahmoud360/background-jobs-on-vercel-in-2026-field-notes-on-waituntil-queues-workflow-and-cron-1l6g)).
- **Vercel Queues / Workflow** — native durable messaging + multi-step execution on Fluid
  Compute (⚠️ availability/pricing per plan should be re-checked at implementation time).
- **Upstash QStash** — HTTP-first queue, free tier ~500–1,000 messages/day, then ~$1 per 100k
  ([pricing](https://upstash.com/pricing/qstash)). The cheapest external option.
- **Inngest** — durable functions, free tier ~50k runs/month ([comparison](https://apiscout.dev/guides/upstash-qstash-vs-inngest-vs-aws-sqs-2026)).

Any of these forces a **status-polling or streaming UI** (scan row `status` field is already in
the schema and unused — [audit §10 item 18](../00-current-state-audit.md)) — real complexity
that isn't justified while p95 parse time is tens of seconds and volume is small.

**Retry-with-higher-res**: the client still holds the original `File` after a failed or badly
reconciling parse; re-encoding at a higher max edge (2800→3600 px) and retrying once is the
cheapest accuracy lever for "unreadable" outcomes ([audit §2 cost controls](../00-current-state-audit.md)
lists its absence). Token cost roughly doubles for that one scan — negligible at paid-tier prices.

## 6. Cost control & metering (the freemium foundation)

**Present**: image-hash dedupe — same photo in the same group short-circuits with **no LLM call**
([receipt-actions.ts:55-63](../../../src/app/receipt-actions.ts)), so retries/double-taps are
free; 3.5 MB / ~2000–2800 px caps. **Absent**: everything else — no per-user quota, no cost
accounting, no `usage` capture, no rate limiting on the one action that spends money
([audit §2, §9 item 24](../00-current-state-audit.md)).

- **OpenRouter now returns usage on every response** — native token counts plus **`cost` in
  credits** (and `cost_details.upstream_inference_cost`); a `/generation?id=` endpoint allows
  async lookup ([usage accounting docs](https://openrouter.ai/docs/use-cases/usage-accounting)).
  Persisting this per scan turns "≈$0.0005–0.006" estimates into measured unit economics — the
  number the paid tier's pricing depends on ([topic 09 §4](../09-monetization/research.md)).
- **Per-user monthly scan counting** is the entire enforcement layer the freemium gate needs:
  a `(user_id, month, count)` table checked in `parseReceipt` before the LLM call and
  incremented after success. Topic 09 designs the tier (free 3–5, paid 50–100, visible counter,
  upgrade prompt at exhaustion); this topic only builds metering + quota + the localized
  "quota exceeded" UX hook the paywall will attach to. Credit-metered AI features are the 2026
  freemium default ([topic 09 §3](../09-monetization/research.md)).
- A monthly quota doubles as a **spend cap per user** — the missing rate limit's worst case
  drops from "unbounded" to "quota × per-scan cost" (fractions of a cent × 5). General
  rate limiting stays with [topic 11](../11-reliability-scale/research.md).
- Dedupe interacts nicely: duplicate uploads should **not** consume credits (they already skip
  the LLM), which the short-circuit ordering gives for free.

## Implications for the app

1. **Switch to paid models before any real-user push** — a config change by design; default the
   ladder to paid (cheapest adequate: Gemini Flash-Lite tier at ~$0.0005–0.002/scan; most robust
   candidates: Haiku 4.5 / GPT-5 mini) and turn on OpenRouter's no-training/ZDR settings, or go
   direct to an EU endpoint. This is simultaneously the GDPR fix, the reliability fix, and the
   monetization prerequisite.
2. **Adopt schema-enforced JSON output** (`response_format` + `require_parameters` on
   OpenRouter) — deletes the invalid-JSON failure class the salvage paths exist for.
3. **Teach the prompt/validator the three eras**: era from receipt date, EUR-authoritative from
   2026, capture the dual BGN total + printed 1.95583 and cross-check at ±0.01 as a quality
   signal; capture VAT-group letters and type deposit/discount lines instead of only tolerating
   them.
4. **Build the golden-set eval harness before further prompt/heuristic work** — 30–50 real BG
   receipts, item recall + reconcile-rate metrics, baseline-diff on every model swap. The 6
   existing quirk tests keep guarding `cleanParsedItems` but measure nothing about extraction.
5. **Unit-level splitting for integer quantities** — small data-model addition, big UX win,
   no competitor does it.
6. **Meter every scan** (monthly per-user count + per-scan cost from the `usage` field) and
   enforce a quota with a localized upsell hook — the foundation [topic 09](../09-monetization/research.md)'s
   credit tier snaps onto.
7. **Stay synchronous for now**; document the queue trigger points (QStash/Inngest/Vercel Queues
   are all viable at low budget) and add client-side retry-at-higher-resolution instead.
8. **Delete image bytes after conversion by default** (per-scan opt-out) — coordinates with
   [topic 08](../08-privacy-gdpr/research.md)'s minimization requirement; EXIF is already
   stripped by the client's canvas re-encode.

## Sources

<details><summary>Full source list (URLs)</summary>

**Models & pricing:** https://ai.google.dev/gemini-api/docs/pricing · https://pricepertoken.com/pricing-page/model/google-gemini-3.1-flash-lite-preview · https://devtk.ai/en/models/gpt-5-mini/ · https://pricepertoken.com/pricing-page/model/openai-gpt-5-mini · https://www.cloudzero.com/blog/openai-pricing/ · https://www.cloudzero.com/blog/gemini-pricing/ · Claude Haiku 4.5 pricing verified against Anthropic's model pricing table (platform.claude.com)
**Structured outputs:** https://platform.openai.com/docs/guides/structured-outputs · https://ai.google.dev/gemini-api/docs/structured-output · https://openrouter.ai/docs/features/structured-outputs
**Data policies:** https://openrouter.ai/docs/guides/features/zdr · https://openrouter.zendesk.com/hc/en-us/articles/51690904755227 · https://openrouter.ai/blog/insights/ai-data-residency/ · https://platform.claude.com/docs/en/manage-claude/api-and-data-retention · https://www.theregister.com/ai-and-ml/2026/08/20/openai-chases-anthropics-biz-customers-with-zero-data-retention-pledge/5290609 · https://openai.com/index/introducing-data-residency-in-europe/ (via topic 08)
**Eval methodology:** https://www.mdpi.com/2504-4990/7/4/167 · https://arxiv.org/html/2406.04493v2 (ReceiptSense) · https://arxiv.org/html/2605.22413v1 · https://arxiv.org/html/2602.12247v2 (ExtractBench) · https://www.braintrust.dev/docs/cookbook/recipes/ReceiptExtraction
**Background processing:** https://dev.to/ahmed_mahmoud360/background-jobs-on-vercel-in-2026-field-notes-on-waituntil-queues-workflow-and-cron-1l6g · https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out · https://upstash.com/pricing/qstash · https://apiscout.dev/guides/upstash-qstash-vs-inngest-vs-aws-sqs-2026
**Metering:** https://openrouter.ai/docs/use-cases/usage-accounting
**Competitors:** https://smetkata.live/ · Splitwise Pro gating per [topic 10 §2](../10-growth-marketing/research.md)
**Bulgarian receipt format:** [01-euro-transition/research.md §3](../01-euro-transition/research.md) and its cited fiscal sources (fiscal-requirements.com, dataplus-bg.com, faragency.bg)

</details>
