# RFC 09 — Freemium Monetization: Entitlements, Scan Metering & Paddle Billing

> **Status update (2026-08-26): stages 1–2 COMPLETE by owner decision** — scan_usage metering (recording), plan columns + `entitlements.ts` (FREE-FOREVER comment, 72h grace), quota UX behind `SCAN_QUOTA_ENFORCED` (off). Stages 3–5 (Paddle checkout/webhooks/launch) deliberately NOT built; the operational path is [OWNER-CHECKLIST.md §7](../OWNER-CHECKLIST.md). Details: [IMPLEMENTATION-LOG.md](../IMPLEMENTATION-LOG.md).

> Part of the [Bulgarian market improvement guide](../README.md).
> **Status:** Proposed · **Priority: P2 — build after the P0/P1 correctness & trust work.**
> The metering foundation (Stage 1, scan counting) is the exception: it should land early,
> alongside the receipt-pipeline work in [RFC 04](../04-receipt-scanning/rfc.md), so real
> usage data exists before any gate ships.
> **Audience:** a future LLM implementer with full repo access. Read
> [research.md](research.md) first — this RFC implements its **"Recommended path"** —
> plus [10-growth-marketing/research.md §2 + Positioning](../10-growth-marketing/research.md)
> (what must never be gated) and
> [00-current-state-audit.md §2, §9](../00-current-state-audit.md) (scan pipeline, platform
> limits). All file/line references are to commit `14963d2`; re-locate by symbol name if drifted.

## 1. Problem

1. **No entitlements concept.** `users` ([src/db/schema.ts:33-39](../../../src/db/schema.ts))
   has `email/name/image` and nothing else. No plan column, no limits, no feature flags —
   every user is identical and everything is free.
2. **No metering.** `parseReceipt` ([src/app/receipt-actions.ts:39](../../../src/app/receipt-actions.ts))
   calls the vision LLM with no per-user quota, no usage accounting, and no rate limit
   (audit §2 "Cost controls: nothing else"). Today the models are `:free` so this costs
   nothing; the moment RFC 04 switches to a paid model, unmetered scanning is unbounded spend.
3. **No billing.** No payment processor, no checkout, no webhook surface, no way to take
   a single euro.
4. **Vercel Hobby prohibits commercial use** (audit §9, research §4). The day the first
   checkout goes live, the project must already be on Vercel Pro — a silent compliance
   trap, not a code change.
5. The research has already made the strategic decisions; this RFC only turns them into
   an implementation plan: **Paddle as merchant of record (individual onboarding, no
   company needed), €4–5/month + strongly discounted annual, receipt-scan credits as the
   metered gate, free tier = unlimited core + a small monthly scan quota.**

## 2. Goals / non-goals

**Goals**
- G1. A single server-side source of truth for entitlements — checked inside server
  actions, so devtools/client state can never unlock anything.
- G2. Atomic, monthly, cheap-to-check scan metering that ships **before** any gate or
  billing exists (data first, enforcement later, behind a flag).
- G3. Paddle Billing checkout + webhook-driven plan flips, with **zero custom billing
  UI** — cancel/card-update/invoices live in the Paddle-hosted customer portal.
- G4. The anti-Splitwise promise is structurally protected: unlimited expenses, groups,
  members, balances and settle-up can never be gated — enforced as a constraint comment
  in the one entitlements file (it is the marketing identity, per
  [10-growth Positioning §1](../10-growth-marketing/research.md)).
- G5. Fail-open degradation: a webhook outage or stale plan state never locks a payer
  out mid-trip.
- G6. A launch operational checklist (Vercel Pro flip, Paddle verification lead time,
  env additions, accountant consultation).

**Non-goals**
- Scan pipeline internals — model choice, the paid-model switch, parse reliability,
  queueing → [RFC 04](../04-receipt-scanning/rfc.md). This RFC only *counts* scans.
- Pricing-page and upgrade-screen marketing copy → [RFC 10](../10-growth-marketing/rfc.md).
  This RFC specs the mechanics and the i18n keys, not the words.
- VAT, ЕООД registration, tax filings — operational, not code;
  [research.md §1-2](research.md) covers it and §3.5 below carries the action items.
- Refund/chargeback *handling* — Paddle as MoR executes refunds and fights disputes;
  only the policy stance appears here (§6).
- Team plans, lifetime unlocks, promo codes, a credits-wallet SKU — future (§6 notes the
  one-time-unlock alternative).

## 3. Design

### 3.1 Entitlements model

**Schema** (migration `drizzle/0005_entitlements.sql`, following the existing
`0000`–`0004` naming):

- `users.plan text NOT NULL DEFAULT 'free'` — `'free' | 'plus'`.
- `users.plan_expires_at timestamp` — null for free; for plus, the end of the paid
  period **plus grace** (§3.6). Plan state is these two columns and nothing else.
- `users.paddle_customer_id text`, `users.paddle_subscription_id text` — nullable,
  Paddle-specific columns kept separate so the entitlements core stays
  processor-agnostic (§6 fallback).

**One file: `src/lib/entitlements.ts`** — the single source of truth for limits,
constants, and the promise:

```ts
/**
 * ============================================================================
 *  PUBLIC PROMISE — DO NOT VIOLATE
 *  "Неограничени разходи. Без реклами. Без дневни лимити."
 *  Unlimited expense entry, unlimited groups and members, balances, settle-up,
 *  debt simplification, and full visibility of your own history are FREE
 *  FOREVER. No ads, ever. This is the product's public anti-Splitwise stance
 *  and its entire marketing identity (docs/bg-market/10-growth-marketing).
 *  Splitwise's 3-expenses/day cap is its #1 churn driver and the reason this
 *  app can exist. Never add an entitlement check to expense/group/settlement
 *  actions. Gate comfort, never core use.
 * ============================================================================
 */
export type Plan = "free" | "plus";

export const PLAN_LIMITS = {
  //        scans/month · CSV/PDF export · spending charts
  free: { scansPerMonth: 5,   export: false, charts: false },
  plus: { scansPerMonth: 100, export: true,  charts: true  },
} as const;

/** Hours a lapsed/stale plus plan keeps working — never lock a payer out
 *  because a webhook failed (§3.6). */
export const PLAN_GRACE_HOURS = 72;

/** Resolve effective entitlements from the two DB columns. Pure function of
 *  (plan, planExpiresAt, now) so it is trivially unit-testable. */
export function entitlements(user: { plan: string; planExpiresAt: Date | null }) { … }
```

Gated features enumerated from [research §3](research.md): **receipt-scan quota** (the
only gate that exists at launch — the app has no export or charts yet), with `export`
and `charts` flags declared now so those features are born gated when RFCs build them.
Per research: raw history stays visible on free forever (hiding people's own financial
records reads as hostage-taking); itemized splits via the scan flow are implicitly
covered by the scan quota, never gated separately.

**Where checks run.** Server actions only. The Auth.js session is a JWT with no DB
round-trip ([src/auth.ts:45](../../../src/auth.ts)) minted at sign-in — **do not put the plan
in the JWT**; it would go stale the moment a webhook flips the plan. Instead, gated
actions read the two plan columns by `user.id` (one indexed select; every action
already does 2–4 reads via `requireUser`/`requireRole`,
[src/lib/action-helpers.ts:17-32](../../../src/lib/action-helpers.ts)). Page-level checks
(counters, upgrade prompts) are UX only and never authoritative.

**Design decision: NO group-level gating.** Groups are shared; gating a *group* because
its owner is free would punish every member — including paying ones — and poison the
network effect exactly the way Splitwise's cap does. Therefore:

- Entitlements attach to the **acting user** — the person who clicks Scan — never to
  the group, its owner, or its other members.
- **The scanner's quota is consumed.** A free member in a group with a paying member:
  when the Plus member scans, the Plus member's quota is used, and the resulting scan
  draft and converted expense are ordinary group data visible to everyone (scans are
  already group-scoped, [src/db/schema.ts:166-192](../../../src/db/schema.ts)). When the free
  member scans, their own 5/month applies — they cannot borrow the Plus member's quota.
  This is deliberate: the trip organizer who scans everything is exactly the person the
  paid tier is for.
- **Features render per-viewer.** The scan counter and upgrade prompts are computed for
  the session user; a group page never says "this group is limited". Ownership is
  irrelevant to entitlements — a free owner in a group full of Plus members is limited
  only in their own scanning.

### 3.2 Scan metering

**Table** (same migration):

```sql
CREATE TABLE scan_usage (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period  text NOT NULL,           -- 'YYYY-MM'
  count   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);
```

`period` derives from the Europe/Sofia day: once [RFC 01 stage 6](../01-euro-transition/rfc.md)
lands its Sofia-timezone `todayString()`, the period is `todayString().slice(0, 7)` so
metering and expense dates share one day boundary. (If metering lands first, UTC months
are an acceptable interim — a 2–3h skew at month boundaries is immaterial.)

**Semantics — decided:**
- **Cap-check before the LLM call; increment only after a successful parse.** A user is
  never charged quota for a provider outage, rate-limit, timeout, or unreadable photo
  (`rate_limited` / `provider_error` / `invalid_response` / `not_a_receipt` outcomes,
  [src/lib/receipt-parse.ts:34-39](../../../src/lib/receipt-parse.ts)). No LLM call attempted
  ⇒ nothing to refund, because nothing was taken.
- **Duplicate uploads are free and never blocked.** The SHA-256 dedupe short-circuit
  ([src/app/receipt-actions.ts:57-63](../../../src/app/receipt-actions.ts)) runs *before* the
  quota check — re-opening an existing scan costs no LLM call, so it must work even at
  0 remaining.
- The increment is a **single atomic upsert** — no transaction needed, which matters
  because the Neon HTTP driver has none (comment at
  [src/app/receipt-actions.ts:100-101](../../../src/app/receipt-actions.ts)):
  `INSERT INTO scan_usage … ON CONFLICT (user_id, period) DO UPDATE SET count = scan_usage.count + 1 RETURNING count`.
- **Known race, accepted:** check-then-increment is not atomic as a pair, so two
  concurrent scans at 4/5 can both pass and land the counter on 6. Overshoot is bounded
  by concurrency (one or two scans, < 1 eurocent) and favors the user. The alternative
  — increment-first, refund on failure — is *worse* without transactions: a lost refund
  silently eats a user's quota.
- **Metering-read failure fails open:** if the `scan_usage` select itself throws, log
  and allow the scan. A broken meter must not break the flagship feature; the downside
  is a few uncounted scans.

**Exact placement in `parseReceipt`** ([src/app/receipt-actions.ts:39-138](../../../src/app/receipt-actions.ts)):
after `requireRole` + file validation + the dedupe short-circuit, and before
`parseReceiptImage(...)` (line 65): resolve `entitlements(user)`, read the counter, and
refuse if `count >= scansPerMonth`. On `outcome.ok`, run the atomic increment before
inserting the scan row (the LLM ran and succeeded — metering is honest even if the
insert then fails and cleans up).

**Typed error → upgrade prompt.** Extend `ParseReceiptResult`
([src/lib/types.ts:179-181](../../../src/lib/types.ts)):

```ts
export type ParseReceiptResult =
  | { ok: true; scanId: string; duplicate?: boolean }
  | { ok: false; error: string; quotaExceeded?: true };
```

`ScanUploadView` ([src/components/ScanUploadView.tsx:96](../../../src/components/ScanUploadView.tsx))
branches on `quotaExceeded`: instead of the generic failure banner it renders a
localized, **non-hostile** upgrade card (new i18n keys EN+BG in
[src/lib/i18n.ts](../../../src/lib/i18n.ts), e.g. `quota.exhaustedTitle`, `quota.exhaustedBody`,
`quota.upgradeCta`, `quota.counter`, `quota.oneLeft`) linking `/upgrade`. Tone rules:
never block mid-review (persisting/converting an *existing* draft is never metered —
only new parses are), always keep the "add the expense manually instead" escape hatch
that already exists in the failure banner.

**Proactive counter.** The scan page loader
([src/app/groups/[id]/scan/page.tsx](../../../src/app/groups/[id]/scan/page.tsx)) additionally
loads `{ used, limit }` for the session user and passes it to `ScanUploadView`, which
shows a muted "X of Y scans this month" line — turning amber with an inline upgrade
link at exactly **1 remaining**, per research ("visible counter, upgrade prompt at
exhaustion" — surprise exhaustion is the hostile pattern we are avoiding).

**Quota numbers** (constants in `entitlements.ts`, from research §3's 3–5 free /
50–100 paid bands — pick the generous ends, consistent with the positioning):
**free = 5/month, plus = 100/month.** Plus hitting 100 shows a softer "fair-use cap
this month" message (`quota.fairUseCap`), not an upgrade CTA. At ≤ $0.006/scan even
100 scans cost < €0.60 — margin stays ~99% (research §4).

**Enforcement flag.** `SCAN_QUOTA_ENFORCED=1` env gate: until billing is live, the
counter renders and metering records, but the cap does not refuse (the UI can label the
state "unlimited during beta"). Gating before a checkout exists would strand users with
no way to pay — the flag flips in Stage 5.

### 3.3 Paddle integration

**Paddle Billing** (the current platform — not Paddle Classic), **sandbox first**.
Matching the codebase's zero-dependency philosophy (audit: five runtime deps, plain
`fetch` for OpenRouter and Frankfurter): no Paddle server SDK — webhook signature
verification is ~20 lines of `node:crypto`, API calls are plain `fetch`, and the
browser side loads Paddle.js from Paddle's CDN in a client component.

**Catalog** (created in the Paddle dashboard, referenced by env — prices are dashboard
config, not code): one product "Plus", two prices:
- **Annual €14.99/year** — the headline SKU, presented first ("≈ €1.25/месец"). Sits at
  the top of the €9.99–14.99 band from [10-growth §4](../10-growth-marketing/research.md);
  "feels one-time-ish" per research §3, and dilutes Paddle's flat $0.50 fee (§6).
- **Monthly €4.49/month** — inside the research's €4–5 band, visibly under Splitwise's
  $4.99.
- **Trial: none — the free tier IS the trial.** State it and configure no Paddle trial;
  a trial on top of a generous free tier only adds cancel-anxiety and card friction
  (61% of BG shoppers are card-shy already).

**`/upgrade` page** (`src/app/upgrade/page.tsx` + a client checkout component):
auth-gated like every page (the app has no middleware; copy the `auth()` + redirect
pattern from [src/app/groups/[id]/scan/page.tsx:14-15](../../../src/app/groups/[id]/scan/page.tsx)).
Renders the two prices and opens the **Paddle.js overlay checkout**
(`Paddle.Initialize({ token, environment })`, `Paddle.Checkout.open({ items, customer: { email }, customData: { userId } })`)
— `customData.userId` is the join key the webhook uses. An already-Plus user sees plan
status + renewal date + a **"Manage subscription"** link instead of prices.

**Customer portal — no custom billing UI.** Cancel, payment-method update, plan switch,
and invoices all happen in the Paddle-hosted customer portal; the app only generates a
portal session link server-side (Paddle API, plain `fetch`) from the `/upgrade` page.

**Webhook: `src/app/api/webhooks/paddle/route.ts`** (POST, Node runtime — default; do
not opt into edge, `node:crypto` is needed):
1. Read the **raw body** with `await req.text()` *before* JSON parsing; verify the
   `Paddle-Signature` header (`ts=…;h1=…` scheme: HMAC-SHA256 of `` `${ts}:${rawBody}` ``
   with `PADDLE_WEBHOOK_SECRET`, constant-time compare). Bad/missing signature → 401,
   no state change. Optionally reject stale `ts` (> 5 min) against replay.
2. Resolve the user: `data.custom_data.userId` primary; fallback match on customer
   email → `users.email` (safe — Google sign-in requires verified emails,
   [src/auth.ts:51-59](../../../src/auth.ts)). Store `paddle_customer_id` /
   `paddle_subscription_id` on first contact.
3. Event handling — **every handler is an idempotent upsert keyed on the subscription
   id** (Paddle retries on non-2xx; duplicates must be harmless), with one uniform
   rule: *set `plan_expires_at` = the subscription's current period end +
   `PLAN_GRACE_HOURS`* —
   - `subscription.created` / `subscription.activated`: `plan='plus'`, ids, expiry per
     the rule.
   - `subscription.updated`: re-apply the rule (renewals extend expiry; a scheduled
     cancel in `scheduled_change` needs no special handling — expiry simply stops
     advancing).
   - `subscription.canceled`: **do not flip `plan` to `'free'`.** Set
     `plan_expires_at` to the event's effective date (period end) + grace; the
     downgrade happens naturally when `entitlements()` sees the expiry pass. This is
     what makes "cancel = keep what you paid for until period end" true by
     construction.
   - `subscription.past_due`: keep `plus`; expiry already covers dunning via grace.
     Record nothing else (Paddle runs the dunning emails).
   - `subscription.paused` / `resumed`: same rule (pause stops expiry advancing;
     resume re-extends).
   - Unknown event types: log and return 200 (returning errors would only cause
     pointless retries).
4. Return 200 fast; the handler does one select + one update — no reason to queue.

**Env additions** (extend [.env.example](../../../.env.example) with a `--- Paddle billing ---`
section): `PADDLE_ENV` (`sandbox`|`production`), `PADDLE_API_KEY`,
`PADDLE_WEBHOOK_SECRET`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`,
`NEXT_PUBLIC_PADDLE_PRICE_MONTHLY`, `NEXT_PUBLIC_PADDLE_PRICE_ANNUAL`, plus
`SCAN_QUOTA_ENFORCED` from §3.2. Sandbox and production have separate tokens, price
ids, and webhook secrets — the swap is env-only by design.

### 3.4 Grandfathering & fairness

- **Every account existing at paywall launch gets 60 days of Plus, free.** One-time
  guarded script (pattern: [RFC 01 §3.4](../01-euro-transition/rfc.md)'s migration script in
  `scripts/`): `UPDATE users SET plan='plus', plan_expires_at = <launch + 60 days> WHERE created_at < <launch>`.
  Rationale: costs ~nothing (LLM inference is < 1¢/scan), converts the earliest and
  most-invested users into the first payers by *taste* rather than by wall, and makes
  the launch announcement a gift instead of a taking. Rejected alternative: a
  bonus-scans counter column — a second quota source complicates the metering read
  path forever for a one-time gesture.
- **Nothing anyone already had is retro-gated.** At launch the only thing that changes
  for a free user is a scan counter appearing — expense entry, groups, balances are
  untouched (see the FREE-FOREVER comment, §3.1 — it exists precisely so a future
  maintainer under revenue pressure re-reads the reasoning before violating the
  public promise).
- Existing scan drafts remain editable and convertible regardless of quota (§3.2 —
  only *new parses* are metered).

### 3.5 Launch checklist (operational — not code)

Do these in order; none of them are deployable artifacts:

1. **Paddle account — start weeks early.** Individual verification (identity + website
   review) has real lead time, and Paddle's website review expects live ToS, privacy
   policy, and refund policy pages — a hard dependency on the
   [RFC 08](../08-privacy-gdpr/rfc.md) legal-pages work. The app never touches money
   (ledger only, no wallet) — say so explicitly in the application to avoid
   financial-services misclassification.
2. **Accountant consultation before the first payout** (research §1-2): declare income
   from the start; ask specifically about **чл. 97а ЗДДС** (limited VAT registration
   for buying EU B2B services — bites early and is separate from the €51,130
   threshold) and the trader-income treatment of app revenue; plan ЕООД at roughly
   €500–1,000 MRR.
3. **Vercel Hobby → Pro ($20/month) before the first live checkout** — Hobby prohibits
   commercial use (audit §9). Also lifts the 1×/day cron cap baked into
   [vercel.json](../../../vercel.json), which RFC 04/11 want anyway.
4. **Switch `OPENROUTER_MODEL` off `:free` endpoints** (the one-variable change
   documented in [.env.example:28-39](../../../.env.example), owned by RFC 04). Charging for
   scans that run on may-train-on-your-receipts free endpoints is indefensible.
5. Production Paddle: live prices, live tokens, webhook URL registered
   (`https://<domain>/api/webhooks/paddle`), one live test purchase + refund.
6. Set all §3.3 env vars in Vercel production; flip `SCAN_QUOTA_ENFORCED=1`; run the
   grandfathering script (§3.4).
7. Update the privacy policy: Paddle as merchant of record / data recipient for
   billing data (RFC 08 coordination).

### 3.6 Kill-switch / degradation — fail OPEN for payers

Small but load-bearing design note:

- `entitlements()` grants Plus while `now < plan_expires_at` — and every webhook
  already wrote expiry as *period end + `PLAN_GRACE_HOURS` (72h)*. So a webhook outage,
  a Paddle incident, or a bug in the handler shorter than the grace window has **zero
  payer impact**: a healthy subscription's expiry is always at least one grace window
  in the future. A payer mid-Bansko-trip whose renewal webhook silently failed keeps
  scanning; the worst case is 72h of free Plus for a genuinely-canceled user — cents.
- The failure direction is asymmetric on purpose: **stale state must degrade toward
  granting, never toward locking out.** The same principle applies to the metering read
  (§3.2: meter unreadable → allow the scan).
- Checkout being down (Paddle incident) degrades gracefully by construction: the free
  core is unaffected and existing payers ride the grace window.
- Emergency lever, no machinery: because entitlements are two plain columns, support
  fixes ("I paid but I'm locked out") and a hypothetical Paddle account suspension are
  handled with a one-line SQL `UPDATE` extending `plan_expires_at` — document this in
  the ops notes rather than building an admin UI.

## 4. Implementation plan (ordered, independently shippable)

| Stage | Contents | Touches | Shippable outcome |
|---|---|---|---|
| 1 | **Metering foundation**: `scan_usage` table, period helper, atomic increment on successful parse. No gate, no UI. Land early, with RFC 04. | `drizzle/0005`, `schema.ts`, `receipt-actions.ts` | Invisible; real usage data accumulates before pricing is finalized |
| 2 | **Entitlements read-path**: plan columns, `src/lib/entitlements.ts` (limits + FREE-FOREVER comment), quota pre-check in `parseReceipt` behind `SCAN_QUOTA_ENFORCED`, typed `quotaExceeded`, counter + amber state + upgrade card UI, i18n keys | `drizzle/0005`, `entitlements.ts`, `receipt-actions.ts`, `types.ts`, `ScanUploadView.tsx`, `scan/page.tsx`, `i18n.ts` | Full gate rehearsable in dev; production still unlimited (flag off), counter visible |
| 3 | **Paddle sandbox**: account + catalog (two prices), env plumbing, `/upgrade` page with overlay checkout (sandbox), portal link | `.env.example`, `src/app/upgrade/*` | End-to-end sandbox checkout opens and completes (no plan flip yet) |
| 4 | **Webhooks + plan flips**: signature-verified `/api/webhooks/paddle`, event handlers per §3.3, grace logic in `entitlements()`, Plus status view on `/upgrade` | `src/app/api/webhooks/paddle/route.ts`, `entitlements.ts`, `upgrade/*` | Sandbox e2e: checkout → plus within seconds; cancel → downgrade at period end |
| 5 | **Launch**: checklist §3.5 top to bottom, grandfathering script, `SCAN_QUOTA_ENFORCED=1` | `scripts/`, Vercel/Paddle dashboards, env | Money |

Stages 1–2 are pure product code with no external accounts and can ship any time after
the P0/P1 work; 3–5 are gated on Paddle verification (start it during Stage 2).

## 5. Acceptance criteria

- **The 6th parse attempt in a calendar month on free** (enforcement on) returns
  `{ ok: false, quotaExceeded: true, … }` **without any OpenRouter request** (assert no
  fetch), and the UI shows the localized (EN + BG) upgrade card with a CTA to
  `/upgrade` — not the generic failure banner.
- A failed parse (`provider_error`, `rate_limited`, `invalid_response`,
  `not_a_receipt`) never increments the counter; a duplicate upload never increments
  **and still succeeds at 0 remaining** (dedupe runs before the quota check).
- The counter renders proactively on the scan page; at exactly 1 remaining it turns
  amber with an inline upgrade link. Saving or converting an existing draft works at 0
  remaining.
- **Server-side only**: no combination of client state, replayed requests, or devtools
  edits produces a 6th parse — the refusal lives inside the `parseReceipt` server
  action, and no gated behavior is decided client-side.
- Sandbox e2e (documented as a step-by-step in the repo ops notes when built):
  checkout with `customData.userId` → webhook → `plan='plus'` within seconds, no
  redeploy → scan limit is 100 → portal cancel → **plan stays `plus` until period
  end** → after `plan_expires_at` (+72h grace) passes, `entitlements()` returns free.
  The period-end-not-immediate behavior is also unit-tested on `entitlements()` with
  fabricated dates.
- Webhook requests with a missing/invalid `Paddle-Signature` → 401 and zero DB writes;
  replaying a valid event twice leaves identical state (idempotent upserts).
- With `plan='free'`, creating expenses, groups, settlements, and members remains
  unlimited — no entitlement check exists in
  [src/app/actions.ts](../../../src/app/actions.ts), and the FREE-FOREVER constraint comment
  is present in `entitlements.ts`.
- Tests: period rollover at YYYY-MM boundaries (Sofia time), the atomic upsert
  increment on PGlite (extend `scripts/receipt-db.test.ts`), `entitlements()` grace
  math, and the existing suites (`npm run test:math`, `scripts/receipt.test.ts`,
  `scripts/receipt-db.test.ts`, `scripts/db-smoke.ts`) all pass.

## 6. Risks & alternatives considered

- **Paddle rejects or stalls the individual account** (their review can misread a
  finance-adjacent app). Mitigations: apply early (Stage 2), stress "ledger only — the
  app never moves money"; fallback is **Lemon Squeezy** (still onboarding in 2026 but
  mid-transition into Stripe, research §1 — hence second choice). The design contains
  the blast radius: everything Paddle-specific lives in the webhook route, the
  `/upgrade` checkout component, and two nullable columns; `plan`/`plan_expires_at`
  and all enforcement are processor-agnostic, so a swap touches two files and a
  migration.
- **Paddle's flat $0.50/transaction vs €-level prices**: on €4.49 monthly the all-in
  take is ≈ 15%; on €14.99 annual ≈ 8%. The annual-first presentation is the
  mitigation (and independently the right call for card-shy Bulgarian buyers). Never
  ship a price under ~€2 — the flat fee makes it uneconomic.
- **Chargebacks/refunds**: Paddle as MoR executes refunds and carries disputes, but
  passes chargeback fees on. Policy stance: honor the EU 14-day withdrawal right and
  be refund-generous on request — a €4.49 refund is always cheaper than a dispute or
  a one-star review, and the anti-Splitwise brand cannot afford billing hostility.
- **`not_a_receipt` spend loop**: failures are unmetered (§3.2), so a hostile user
  could burn LLM calls with junk images without touching their quota. Bounded today by
  the dedupe hash and free-tier photo effort; a per-user attempts-per-hour throttle
  belongs with the general rate-limiting work in [RFC 11](../11-reliability-scale/rfc.md)
  (audit §9: no rate limiting anywhere, including two money-costing actions).
- **Plan in the session JWT** (avoid a DB read per gated action): rejected — stale
  until re-login, which turns every webhook flip into a support ticket. One indexed
  select per *gated* action (scans only, at launch) is noise.
- **Group-level gating**: rejected outright, §3.1 — it recreates the exact Splitwise
  failure this product exists to attack.
- **Append-only `usage_events` log instead of the `(user_id, period)` counter**:
  rejected — every quota check would aggregate, for no benefit until there are
  multiple metered features. The counter is O(1) to check and to increment; revisit
  only if a second metered feature appears.
- **One-time unlock SKU** (Splid-style, resonates with BG payment culture per
  [10-growth §4](../10-growth-marketing/research.md)): deferred, not rejected. Paddle
  supports one-time prices, and `plan_expires_at = null` with `plan='plus'` can
  represent "forever" without schema changes — but a second SKU shape at launch
  doubles the billing surface for a solo dev. Ship subscriptions; add the unlock if
  annual conversion disappoints.
