# RFC 01 — Euro Changeover Correctness: Fixed BGN→EUR Conversion & Missing-Rate Safety

> **Status update (2026-08-24):** stages 1–2 implemented; stage 5 implemented as an account setting; stage 6 partially (Sofia/local dates — rate-gap repair outstanding); stages 3–4 outstanding. Details: [IMPLEMENTATION-LOG.md](../IMPLEMENTATION-LOG.md).

> **Status:** Proposed · **Priority: P0 — live correctness bug for the target market**
> **Audience:** a future LLM implementer with full repo access. Read
> [research.md](research.md) and [00-current-state-audit.md §5](../00-current-state-audit.md)
> first. All file/line references are to commit `14963d2`; re-locate by symbol name if drifted.

## 1. Problem

1. The ECB removed BGN from its reference rates on 2026-01-02. `refreshRates()`
   ([src/lib/rates-fetch.ts](../../../src/lib/rates-fetch.ts)) stores whatever Frankfurter returns, so every
   rate row dated ≥ 2026-01-02 has no `BGN` key. `convertCents()`
   ([src/lib/rates.ts:21-34](../../../src/lib/rates.ts)) then returns `null` for any BGN expense dated
   after the changeover — and for **every non-BGN expense in a group whose base currency is BGN**.
2. `loadGroupData` ([src/lib/group-data.ts:168](../../../src/lib/group-data.ts)) does
   `if (e.convertedCents === null …) continue;` — the expense is **silently excluded from
   `netBalances`, `pairwiseDebts`, and `simplifiedDebts`**. Balances are wrong with only a
   small per-row "no rate" chip and a dismissible popup as signals.
3. There is no fixed-rate concept anywhere: 1.95583 appears only in test fixtures.
4. Related but separable defects (fixed here because they share the same files):
   missed-cron rate gaps are never repaired (`rates-fetch.ts:22-39` backfills only when the
   table is empty); `findRateRow` falls back to the *earliest* row for pre-history dates with
   no indication (`rates.ts:17`); "today" is computed in UTC so Bulgarian users get
   yesterday's date between 00:00–03:00 (`rates.ts:47-49`, `ExpenseModal.tsx:57`,
   `SettleModal.tsx:40`).

## 2. Goals / non-goals

**Goals**
- G1. Every BGN amount converts correctly forever, using the legally fixed rate.
- G2. A missing FX rate can never silently corrupt balances again.
- G3. BGN is retired from *new* data entry but renders perfectly for historical data.
- G4. BGN-based groups migrate to EUR without changing any stored expense.
- G5. Optional informational "leva equivalent" display for EUR amounts (BG-market comfort feature).
- G6. Rate-table gap repair; Sofia-timezone "today".

**Non-goals**
- Receipt-parser era handling (→ [RFC 04](../04-receipt-scanning/rfc.md)).
- Locale-aware number formatting of amounts (→ [RFC 02](../02-localization/rfc.md)).
- General multi-currency-exponent support (JPY etc.) — noted in the audit; separate small fix, out of scope here.

## 3. Design

### 3.1 Fixed euro conversion rates (new module or extension of `src/lib/rates.ts`)

```ts
/** Legally fixed conversion rates of currencies replaced by the euro.
 *  Units of the legacy currency per 1 EUR. Full-precision rates as set by
 *  EU Council regulation — never rounded, never inverted (Reg. 1103/97 Art. 4/5). */
export const FIXED_EUR_RATES: Record<string, number> = {
  BGN: 1.95583, // fixed 2026-01-01, Council Reg. (EU) 2025/1408
  HRK: 7.53450, // fixed 2023-01-01 (support pre-2023 Croatian data if it ever appears)
};
```

Conversion algorithm (replaces the body of `convertCents`, keeping its signature
`(amountCents, from, to, dateISO, rows) => number | null`):

1. If `from === to` → identity (already the case).
2. Normalize both endpoints: a currency in `FIXED_EUR_RATES` is converted to/from EUR
   via the fixed rate **first** (BGN→EUR: `divide by 1.95583`; EUR→BGN: `multiply`),
   with **half-up rounding to integer cents at each legal conversion boundary** —
   round-half-up, not banker's rounding, per ЗВЕРБ Art. 13.
3. If the normalized pair is EUR↔EUR, done — **no rate row needed at all**. This is the
   common Bulgarian case (BGN expense in a EUR group) and must work even with an empty
   `fx_rates` table.
4. Otherwise resolve the remaining leg (EUR↔USD etc.) via `findRateRow` exactly as today.
   Chain example BGN→USD: `BGN ÷ 1.95583 → EUR × rate(USD, date)`.
5. Return `null` only when the *floating* leg has no rate — fixed-leg conversion can
   never fail.

Rounding/summation policy (per research §6 and Implication 1): convert **per expense,
then sum** — never convert summed balances. This is already the code's structure
(conversion happens per expense in `loadGroupData`); keep it and document it in a comment.

Notes:
- Keep using integer-cent math: implement the fixed-rate step as
  `Math.round(...)` on `amountCents / 1.95583` (half-up for positives; use
  `Math.sign`-aware half-up so negative adjustment amounts round symmetrically —
  add a helper `roundHalfUp(n: number): number` since `Math.round(-0.5) === -0`
  behavior differs from half-up for negatives).
- `ratesAreStale` and the `RateWarningModal` must **not** fire for groups whose only
  conversions are fixed-leg (a EUR group full of BGN history needs no fresh rates).
  Compute "needs floating rates" during `loadGroupData` and gate the staleness flag on it.

### 3.2 Missing-rate safety (fix the silent drop)

In `loadGroupData` ([src/lib/group-data.ts:166-205](../../../src/lib/group-data.ts)):

- Keep excluding unconvertible expenses from the math (there is no correct number to use),
  **but** count them and return `excludedCount` + the affected expense ids in the payload.
- `BalancesPanel` renders a **non-dismissible error banner** when `excludedCount > 0`:
  "⚠️ N expenses could not be converted to {currency} and are NOT included in these
  balances" (new i18n keys, EN + BG), with the affected rows listed or linked. This is a
  red persistent state, not the amber dismissible rate-staleness popup.
- Add the same warning to the group card on the dashboard (small red dot + tooltip) so the
  owner notices without opening the group. (Cheap: the dashboard already counts expenses.)
- Server-side guard: `saveExpense` should refuse to *create* an expense whose currency
  cannot currently convert to the group currency (fail loud at entry, not at display).
  Exempt fixed-leg pairs (always convertible).

### 3.3 Retire BGN from new entry

- `CURRENCIES` ([src/lib/currencies.ts](../../../src/lib/currencies.ts)): split into
  `ACTIVE_CURRENCIES` (BGN removed — ECB no longer quotes it) and
  `LEGACY_CURRENCIES = ["BGN", "HRK"]`. `isSupportedCurrency` accepts both (stored data
  must stay valid). Type `Currency` covers the union.
- Currency `<select>`s (`NewGroupForm`, `SettingsModal`, `ExpenseModal`, `ScanReviewView`):
  offer `ACTIVE_CURRENCIES` only, **except** render the current value if it's legacy
  (disabled option labeled "BGN (историческа / historical)") so editing an old BGN expense
  doesn't force a currency change.
- Default currency for new groups: change the hardcoded `"USD"`
  (`NewGroupForm.tsx:15`, `schema.ts:47` DB default) to **EUR** — correct for the target
  market and harmless elsewhere. (Locale-aware default is RFC 02's concern; EUR is the
  right static default now.)

### 3.4 Migrate BGN base-currency groups to EUR

- One-time migration (SQL in `drizzle/` + a guarded script in `scripts/`):
  `UPDATE groups SET currency = 'EUR' WHERE currency = 'BGN';`
  Stored expenses are untouched (they carry their own currency). Balances change only in
  the sense that they're now denominated in EUR — computed via the fixed rate, which is
  exactly the legal changeover semantics.
- Write an `activity_log` entry per migrated group (action `settings_changed`, detail
  "currency BGN → EUR (euro changeover)") so the change is visible and explained in the
  group's own audit trail. Use the existing log-insert helper in `actions.ts`.
- Belt-and-braces: `loadGroupData` treats a `currency === "BGN"` group as EUR at runtime
  (lazy migration) in case a row is created between deploy and migration.

### 3.5 Optional leva-equivalent display (product feature)

- A **user-level** preference (not per group): `showBgnEquivalent: boolean`, default off.
  Storage: since there is no user-settings table or screen yet, the cheapest correct home
  is a cookie next to `locale` (same pattern as `locale-actions.ts`), toggled from the
  header/language area or the future settings screen (RFC 06 introduces one; coordinate).
- When on and the displayed currency is EUR, `formatCents` call-sites in summary positions
  (group total, balances panel, expense amount in the detail modal — *not* every list row,
  to avoid clutter) append a muted `≈ 39,12 лв.` computed as `round(eur × 1.95583)`.
  Label it visually as secondary (smaller, muted). Never store the derived figure.
- i18n: the suffix uses `лв.` in both locales (it is a currency symbol, not prose).
- Sunset thought (comment in code): revisit default-off → removal around 2028 as mental
  conversion fades; research shows the German precedent argues for keeping it long-term.

### 3.6 Rate-gap repair + Sofia dates (small fixes, same files)

- `refreshRates` ([src/lib/rates-fetch.ts](../../../src/lib/rates-fetch.ts)): after the `/latest` fetch, detect
  missing **weekday** dates between the newest stored row and today (ECB publishes
  business days only); if any, fetch the range via Frankfurter's
  `GET /v1/{start}..{end}?base=EUR` time-series endpoint and upsert the gap rows. Cap the
  repair window (e.g. 400 days) to bound the response size.
- `findRateRow` ([src/lib/rates.ts:10-18](../../../src/lib/rates.ts)): when falling back to the earliest row
  (transaction predates all stored rates), return the row **plus** a flag; `loadGroupData`
  propagates it as `approxRate: true` on the expense, and the row's converted-amount chip
  gets a `≈` prefix + tooltip (new i18n key). Do not block.
- Replace `todayString()` UTC logic (`rates.ts:47-49`) with an
  `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" })`-based date (en-CA gives
  `YYYY-MM-DD` directly). Use it for the expense/settle date defaults
  (`ExpenseModal.tsx:57`, `SettleModal.tsx:40`). Rationale: the user base is Bulgarian;
  a fully client-timezone solution is more code for no practical gain here. Leave DB
  timestamps as-is (out of scope).

## 4. Implementation plan (ordered, independently shippable)

| Stage | Contents | Touches |
|---|---|---|
| 1 | `FIXED_EUR_RATES`, `roundHalfUp`, new `convertCents` chain + unit tests | `rates.ts`, `scripts/math.test.ts` |
| 2 | Missing-rate safety: `excludedCount` plumb-through, red banner, dashboard dot, `saveExpense` guard | `group-data.ts`, `BalancesPanel.tsx`, `page.tsx`, `actions.ts`, `i18n.ts` |
| 3 | Currency list split, picker updates, EUR defaults | `currencies.ts`, `NewGroupForm.tsx`, `SettingsModal.tsx`, `ExpenseModal.tsx`, `ScanReviewView.tsx`, `schema.ts` (+ drizzle migration for the column default) |
| 4 | BGN-group migration SQL + script + activity-log entries + lazy runtime guard | `drizzle/`, `scripts/`, `group-data.ts` |
| 5 | Leva-equivalent toggle + display | `locale-actions.ts`-style cookie action, `AppHeader.tsx`/settings, `format.ts`/call-sites, `i18n.ts` |
| 6 | Rate-gap repair, `approxRate` flag, Sofia `todayString` | `rates-fetch.ts`, `rates.ts`, `group-data.ts`, `ExpenseList.tsx`, `ExpenseModal.tsx`, `SettleModal.tsx` |

Stages 1–2 are the P0 bug fix and should ship together. 3–4 complete the changeover.
5–6 are polish and can trail.

## 5. Acceptance criteria

- A EUR group containing BGN expenses dated 2025 **and** 2026 shows correct balances with
  an **empty `fx_rates` table** (fixed-leg only, no network).
- `convertCents(19558, "BGN", "EUR", "2026-08-24", [])` → `10000`. `convertCents(100, "BGN", "EUR", …)` → `51` (0.5113 → half-up). Symmetric negative amounts round symmetrically.
- BGN→USD chains through EUR and equals `round(round(bgn/1.95583) × usdRate)` at the transaction date's rate.
- No group can ever display balances that silently omit an expense: forcing a missing-rate
  scenario (e.g. TRY expense with an empty rates table) shows the red banner with the count,
  and `saveExpense` refuses new unconvertible entries with a localized error.
- BGN absent from all currency pickers for new entities; an existing BGN expense still
  opens/edits/renders with `BGN` shown.
- After migration, zero rows in `groups` have `currency = 'BGN'`, each migrated group has
  an activity-log entry, and no expense row changed.
- With the toggle on, a `€20.00` total shows `≈ 39,12 лв.`; toggle off (default) shows nothing.
- All of `npm run test:math`, `npx tsx scripts/receipt.test.ts`, `npx tsx scripts/receipt-db.test.ts`, `npx tsx scripts/db-smoke.ts` pass; new tests cover: fixed-leg identity with empty rates, half-up boundaries (`.005` cents cases), the BGN→X chain, gap repair (mock fetch), and `excludedCount` propagation.

## 6. Risks & alternatives considered

- **Rewriting stored BGN amounts to EUR** (data migration of `amount_cents`): rejected —
  destroys the audit trail, breaks `splitValue` raw-input restoration, and contradicts the
  app's own "original amounts immutable" principle. Fixed-rate conversion at read time is
  lossless and legally exact.
- **Keeping BGN in `fx_rates` by injecting synthetic rows**: rejected — pollutes real ECB
  data with fake rows, still fails for dates before the injection, and hides the fixed-rate
  semantics (a synthetic row would tempt someone to "update" it).
- **Per-group dual display instead of per-user**: rejected — whether someone still thinks
  in leva is a property of the person, not the trip.
- Float drift in the chain: mitigated by rounding to integer cents after each leg; property
  test the round-trip `BGN→EUR→BGN` stays within 1 stotinka.
