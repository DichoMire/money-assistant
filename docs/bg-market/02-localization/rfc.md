# RFC 02 — Localization Correctness: Locale-Aware Money, Robust Amount Parsing, Structured Activity Log, Locale Auto-Detection

> **Status:** Proposed · **Priority: P1 — high, cheap, market-critical**
> (numbers appear on every screen of a money app; wrong number formatting undermines the
> native-quality Bulgarian the app already ships — see
> [research.md](research.md) and [10-growth-marketing/research.md §6](../10-growth-marketing/research.md)).
> **Audience:** a future LLM implementer with full repo access. Read
> [research.md](research.md) and [00-current-state-audit.md §3](../00-current-state-audit.md)
> first. All file/line references are to commit `14963d2`; re-locate by symbol name if drifted.

## 1. Problem

1. **`formatCents` hardcodes `en-US`** ([src/lib/money.ts:1-10](../../../src/lib/money.ts)) and
   takes no locale parameter. Every amount in the app renders `€1,234.56` / `BGN 12.34`
   even in the Bulgarian UI. Correct bg output (verified live, Node v24.13.1 full ICU —
   [research.md §1](research.md)) is `1234,56 €` / `12,34 лв.` — comma decimal, **no**
   grouping under 5 digits (`minimumGroupingDigits: 2`), no-break-space-separated trailing
   symbol. 13 files call `formatCents`: 9 client components (`ExpenseList`, `ExpenseModal`,
   `ExpenseDetailModal`, `BalancesPanel`, `SettleModal`, `ActivityModal`, `ScanReviewView`,
   `ScanAssignModal`, `ScanUploadView`), two shared libs
   ([src/lib/split.ts:57-58,103,133-134](../../../src/lib/split.ts),
   [src/lib/receipt-convert.ts:49,91-92](../../../src/lib/receipt-convert.ts)) and the
   audit-log builders in [src/app/actions.ts](../../../src/app/actions.ts) (see 3.).
2. **`parseAmount` rejects or misparses European input**
   ([src/lib/money.ts:13-19](../../../src/lib/money.ts)): it replaces only the **first**
   comma and its regex admits no spaces/second dot, so `"1 234,56"` → error,
   `"1,234.56"` → error, and — worst — `"1.234"` (dot-grouped thousands) **silently
   parses as 123 cents**, a 10× wrong amount. `parseNumber`
   ([money.ts:22-27](../../../src/lib/money.ts)) shares the first-comma-only bug.
3. **Activity-log diffs are English display strings frozen into jsonb.**
   `participantSummary` emits `` `${ids.length} people` ``
   ([actions.ts:50-53](../../../src/app/actions.ts)); `buildExpenseChanges`
   ([actions.ts:61-118](../../../src/app/actions.ts)) pushes eight English fragments
   (`description "X" → "Y"`, `amount … → …`, `date … → …`, `split method … → …`,
   `paid by …`, `split between …`, `payer/split amounts adjusted`); the settlement path
   pushes `payer`/`recipient`/`amount`/`date` fragments
   ([actions.ts:779-793](../../../src/app/actions.ts)). Inside them, `formatCents` bakes
   en-US style ([actions.ts:81,788](../../../src/app/actions.ts)) and `formatDate` runs
   with no locale → English months ([actions.ts:85,792](../../../src/app/actions.ts)).
   `ActivityModal.tsx:16` documents the consequence: stored fragments render as written —
   in English — forever. Every other detail in the log is already structured and rendered
   via `t()` at display time ([src/components/ActivityModal.tsx:12-74](../../../src/components/ActivityModal.tsx));
   only `changes` breaks the pattern.
4. **First visit defaults to English.** `DEFAULT_LOCALE = "en"`
   ([src/lib/i18n.ts:9](../../../src/lib/i18n.ts)), `getLocale()` reads only the cookie
   ([src/lib/i18n-server.ts:5-9](../../../src/lib/i18n-server.ts)), the project has no
   `middleware.ts`, and nothing reads `Accept-Language`. A Bulgarian visitor lands in
   English and must find the EN/БГ pill.
5. **Metadata half-localized.** `generateMetadata` localizes `description` but hardcodes
   `title: "Money Assistant"` ([src/app/layout.tsx:25-31](../../../src/app/layout.tsx)).
   `LanguageToggle` has a bilingual hardcoded `aria-label="Language / Език"`
   ([src/components/LanguageToggle.tsx:26](../../../src/components/LanguageToggle.tsx)).

Not a problem (documented for the record): `countWord()`
([src/lib/i18n.ts:926-928](../../../src/lib/i18n.ts)) is binary but **exactly matches CLDR
`bg` (`one`/`other`)**, and the bg dictionary already holds correct count forms
(`разхода`, `дяла`, `души`) — see [research.md §2](research.md). Leave it; revisit only
when adding a locale with more plural categories.

## 2. Goals / non-goals

**Goals**
- G1. Every displayed amount is formatted for the viewer's UI locale via `Intl`.
- G2. `parseAmount` accepts everything a Bulgarian or English-habit user plausibly types
  (`12,34`, `12.34`, `1 234,56`, `1,234.56`, `1.234,56`) with deterministic ambiguity
  rules and no silent misparses.
- G3. New activity-log `changes` are structured `{ key, params }` fragments rendered in
  the viewer's locale at display time; existing English-string rows keep rendering verbatim.
- G4. First-time visitors get the UI language their browser asks for (`Accept-Language`);
  the explicit cookie choice always wins.
- G5. Localized `<title>`; deliberate (not accidental) toggle `aria-label`.
- G6. Zero new runtime dependencies (the repo's standing constraint).

**Non-goals** (owned elsewhere — do not implement here)
- Leva dual display / `≈ … лв.` suffix — [RFC 01 §3.5](../01-euro-transition/rfc.md) owns it.
- SEO, Bulgarian public content, locale-prefixed URLs (`/bg/...`) — topic 10.
- Receipt-parser Bulgarian handling (лв/евро recognition, era logic) — topic 04.
- Zero-decimal currency exponent (JPY/HUF misdisplay) — audit §5 item; a separate small fix.
  This RFC must not worsen it (`Intl` already formats JPY with 0 decimals; the `/100`
  storage assumption is untouched).
- Replacing native `<input type="date">` (browser-locale pickers stay; accepted trade-off).
- A third locale, and migrating/rewriting legacy `activity_log` jsonb rows (immutable history).
- The stored `description: "Payment"` sentinel ([actions.ts:747](../../../src/app/actions.ts))
  stays — never displayed (UI substitutes `t("expenses.payment")`); add a comment only.

## 3. Design

### 3.1 Locale-aware `formatCents` and call-site threading

New signature in [src/lib/money.ts](../../../src/lib/money.ts) (backward-compatible default):

```ts
const formatters = new Map<string, Intl.NumberFormat>(); // key `${locale}:${currency}`

export function formatCents(cents: number, currency: string, locale: Locale = "en"): string {
  const tag = locale === "bg" ? "bg" : "en-US";
  // narrowSymbol: bg gets "$"/"£" instead of "щ.д."/"GBP"; en unchanged for EUR/USD.
  // Trade-off: "$" is ambiguous across dollar currencies — acceptable here (see §6).
  try {
    let f = formatters.get(`${tag}:${currency}`);
    if (!f) {
      f = new Intl.NumberFormat(tag, { style: "currency", currency, currencyDisplay: "narrowSymbol" });
      formatters.set(`${tag}:${currency}`, f);
    }
    return f.format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
```

The cache is an optimization, not a requirement (construction ≈ 14 µs, measured); keep the
`try/catch` fallback for bogus currency codes exactly as today.

**Threading strategy** — the locale already reaches every call site; pass it explicitly:

- *Client components* (9 files): they already call `useT()`; add `useLocale()` where
  missing and pass it as the third argument. Optional ergonomics: add a
  `useMoney(): (cents, currency) => string` hook next to `useT()` in
  [src/components/LocaleProvider.tsx](../../../src/components/LocaleProvider.tsx) that
  binds the locale once — recommended, it keeps the 9 diffs mechanical.
- *Shared libs*: [src/lib/split.ts](../../../src/lib/split.ts) (`computeSplit`,
  `validatePayers`) and [src/lib/receipt-convert.ts](../../../src/lib/receipt-convert.ts)
  (`computePersonTotals`) already thread `t: TFunc = enT` for their error strings — add a
  sibling `locale: Locale = "en"` parameter and pass it to their `formatCents` calls.
  Callers that pass `t` already have the locale in hand.
- *Server*: `getLocale()` ([src/lib/i18n-server.ts](../../../src/lib/i18n-server.ts)) in
  pages/actions. After 3.3, [src/app/actions.ts](../../../src/app/actions.ts) no longer
  calls `formatCents` at all (its only uses are the diff builders).

**Hydration note:** client components SSR with Node's ICU and hydrate with the browser's;
a CLDR skew (e.g. space vs U+00A0) would trigger React text-mismatch patches. Current bg
data is stable (U+00A0 in both places); as cheap insurance, normalize narrow
no-break space (U+202F) to no-break space (U+00A0) in the return value and assert
exact code points only in Node tests.

### 3.2 Robust `parseAmount` (money-specific, ≤ 2 decimals)

Replace the body of `parseAmount` ([money.ts:13-19](../../../src/lib/money.ts)) with:

1. Trim; remember and strip a leading `-`; strip all space-class characters
   (regular space, no-break space U+00A0, narrow no-break space U+202F, apostrophe) — always grouping.
2. If **both** `.` and `,` occur: the **rightmost** occurrence is the decimal separator;
   strip all occurrences of the other character (grouping), then require the decimal part
   to be 1–2 digits.
3. If exactly **one** separator character occurs (one or more times):
   - multiple occurrences → grouping; strip (validate: every group after the first is
     exactly 3 digits, else `null`).
   - single occurrence with **1–2** trailing digits → decimal separator.
   - single occurrence with **exactly 3** trailing digits → grouping (a 2-decimal money
     amount cannot have 3 decimals — the domain resolves the classic `1,234` ambiguity).
   - single occurrence with **≥ 4** trailing digits → `null`.
4. Remaining string must be `/^\d+$/` (plus optional 1–2-digit decimal part); compute
   integer cents directly (`whole * 100 + decimals`) — no float round-trip needed.

`parseNumber` ([money.ts:22-27](../../../src/lib/money.ts)) — percent/shares/adjustment
inputs where >2 decimals are legitimate (`33,333`): fix only the separator handling
(strip spaces, `replaceAll` comma→dot when comma is the sole separator, rightmost-wins when
both occur); do **not** apply the 3-digit grouping rule there — `33,333` must stay 33.333.

UI polish (same stage or stage 5): locale-dependent placeholder on amount inputs
(`0,00` bg / `0.00` en) in `ExpenseModal`, `SettleModal`, `ScanReviewView`,
`ScanAssignModal`. Inputs already use `inputMode="decimal"` — keep.

### 3.3 Structured activity-log `changes` with legacy fallback

**Write side** ([src/app/actions.ts](../../../src/app/actions.ts)) — `changes` becomes an
array of:

```ts
type ChangeFragment =
  | string                                                  // legacy rows only — never written anew
  | { key: string; params?: Record<string, unknown> };      // stored in jsonb as-is
```

Replace the fragment builders (`buildExpenseChanges`, the settlement block, and
`participantSummary`) so they emit machine data, e.g.:

| Old stored string | New fragment |
|---|---|
| `description "A" → "B"` | `{ key: "description", params: { from: "A", to: "B" } }` |
| `amount €1.00 → €2.00` | `{ key: "amount", params: { fromCents, fromCurrency, toCents, toCurrency } }` |
| `date Aug 23 → Aug 24` | `{ key: "date", params: { from: "2026-08-23", to: "2026-08-24" } }` (ISO) |
| `split method equally → by shares` | `{ key: "splitMethod", params: { from: "equal", to: "shares" } }` (method ids) |
| `paid by Иван → Мария, Иван` | `{ key: "paidBy", params: { fromNames: [...], fromCount, toNames: [...], toCount } }` |
| `split between …` | `{ key: "splitBetween", params: { … same shape … } }` |
| `payer amounts adjusted` | `{ key: "payerAmountsAdjusted" }` |
| `split amounts adjusted` | `{ key: "splitAmountsAdjusted" }` |
| `payer X → Y` / `recipient X → Y` | `{ key: "payer" \| "recipient", params: { from, to } }` |

Names stay denormalized (this table's deliberate design — readable after deletions);
`participantSummary`'s >4 truncation moves to the renderer (store names up to a cap of ~8
plus the count; render the count via a new key when `count > 4`).

**Read side** ([src/components/ActivityModal.tsx:115-119](../../../src/components/ActivityModal.tsx)):
replace `.map(String).join(" · ")` with a `renderChange(fragment, t, locale)` helper:
`typeof fragment === "string"` → render verbatim (legacy); object → switch on `key`,
apply **display-time** `formatCents(…, locale)` / `formatDate(…, locale)` /
name-list-or-count assembly, then `t("activity.change." + key, …)`; unknown key → render
the key itself (forward-compatible, never crash). New i18n keys (~11 `activity.change.*`,
`activity.nPeople: "{count} people"`, and 5 `splitMethod.*` labels) in **both**
dictionaries — the `Record<TKey, string>` type enforces bg completeness at build time.

Cleanup enabled by this: `SPLIT_METHOD_LABELS`
([src/lib/split.ts:7-13](../../../src/lib/split.ts)) loses its last consumer — delete it;
`actions.ts` drops its `formatCents`/`formatDate`/`SPLIT_METHOD_LABELS` imports.
No DB migration: jsonb holds both shapes; old rows are untouched (immutable history).

### 3.4 `Accept-Language` default locale (first visit)

Chosen: **per-request negotiation in `getLocale()`** — no middleware, no dependencies.
The [Next.js-documented](https://nextjs.org/docs/app/guides/internationalization)
middleware + `Negotiator` + `@formatjs/intl-localematcher` pattern exists for
URL-prefixed locales; for a cookie-based two-locale app it is two dependencies and an
extra moving part for ~10 lines of logic (rationale in [research.md §5](research.md)).

- Add to [src/lib/i18n.ts](../../../src/lib/i18n.ts) a pure, unit-testable
  `negotiateLocale(header: string | null): Locale`: split on `,`, parse optional
  `;q=` (default 1), sort by q descending (stable), return the first entry whose
  **primary subtag** (`bg` from `bg-BG`) is a supported locale; else `DEFAULT_LOCALE`.
- Change `getLocale()` ([src/lib/i18n-server.ts:5-9](../../../src/lib/i18n-server.ts)):
  cookie valid → cookie (explicit choice always wins); else
  `negotiateLocale((await headers()).get("accept-language"))`.
- Do **not** write the cookie from detection — only `setLocale`
  ([src/app/locale-actions.ts](../../../src/app/locale-actions.ts)) writes it. Detection
  simply keeps applying until the user toggles. `headers()` forces dynamic rendering,
  which changes nothing here — every page already awaits `auth()` and `cookies()`.
- `<html lang>`, `LocaleProvider`, and the toggle's pressed state all flow from
  `getLocale()` already ([src/app/layout.tsx:38-45](../../../src/app/layout.tsx)) — no
  further changes.

### 3.5 Localized `<title>` + toggle label

- Add `app.title` to both dictionaries (en: `"Money Assistant — split group expenses"`,
  bg: `"Money Assistant — разделяйте общи разходи"`; brand name stays Latin) and use it in
  `generateMetadata` ([src/app/layout.tsx:25-31](../../../src/app/layout.tsx)). OG/social
  metadata is topic 10's.
- `LanguageToggle` `aria-label`: keep it bilingual **on purpose** (a language switcher
  must be readable before switching) — hoist to a named constant with a comment saying so,
  so it stops looking like an unlocalized leftover.

## 4. Implementation plan (ordered, independently shippable)

| Stage | Contents | Touches |
|---|---|---|
| 1 | `formatCents(locale)` + formatter cache + `useMoney()` hook; thread through 9 client components and `split.ts` / `receipt-convert.ts` | `money.ts`, `LocaleProvider.tsx`, `ExpenseList.tsx`, `ExpenseModal.tsx`, `ExpenseDetailModal.tsx`, `BalancesPanel.tsx`, `SettleModal.tsx`, `ActivityModal.tsx`, `ScanReviewView.tsx`, `ScanAssignModal.tsx`, `ScanUploadView.tsx`, `split.ts`, `receipt-convert.ts` |
| 2 | `parseAmount` / `parseNumber` rewrite + test matrix | `money.ts`, `scripts/math.test.ts` |
| 3 | Structured `changes` fragments + `renderChange` with legacy fallback + new i18n keys + delete `SPLIT_METHOD_LABELS` | `actions.ts`, `ActivityModal.tsx`, `i18n.ts`, `split.ts`, `types.ts` |
| 4 | `negotiateLocale` + `getLocale()` header fallback + tests | `i18n.ts`, `i18n-server.ts`, `scripts/math.test.ts` (or a new tiny test script) |
| 5 | Localized title, deliberate aria-label, locale-aware `0,00` placeholders | `layout.tsx`, `i18n.ts`, `LanguageToggle.tsx`, `ExpenseModal.tsx`, `SettleModal.tsx`, `ScanReviewView.tsx`, `ScanAssignModal.tsx` |

Each stage ships alone; 1+2 are the user-visible market fix, 3 stops the untranslatable
backlog from growing (every production day before it lands adds English-forever rows —
ship early), 4–5 are cheap wins.

## 5. Acceptance criteria

**Parsing** (` ` may be U+0020 or U+00A0; all return integer cents):

| Input | Result | Why |
|---|---|---|
| `"12,34"` | `1234` | comma decimal |
| `"12.34"` | `1234` | dot decimal |
| `"1 234,56"` | `123456` | space grouping + comma decimal |
| `"1,234.56"` | `123456` | rightmost separator (`.`) wins |
| `"1.234,56"` | `123456` | rightmost separator (`,`) wins |
| `"1.234"` | `123400` | single sep + 3 trailing digits ⇒ grouping (**today: silent `123`**) |
| `"1,234"` | `123400` | same rule |
| `"1 234"` | `123400` | space grouping |
| `"1.234.567"` | `123456700` | repeated ⇒ grouping |
| `"12,3"` | `1230` · `"-5,50"` → `-550` · `"12"` → `1200` | |
| `"1,2345"` | `null` | ≥4 trailing digits |
| `"12,34,56"` | `null` | malformed groups (not 3 digits) |

`parseNumber("33,333")` → `33.333` (no grouping rule); `parseNumber("1 000")` → `1000`.

**Formatting** (assert exact strings incl. code points in Node tests; the spaces shown
inside expected outputs below are no-break spaces U+00A0 in the real output — the first
bullet's hex dump is authoritative):

- `formatCents(1234, "EUR", "bg")` → `"12,34 €"` (`31 32 2c 33 34 a0 20ac`).
- `formatCents(123456, "EUR", "bg")` → `"1234,56 €"` — **no grouping** at 4 digits.
- `formatCents(1234567, "EUR", "bg")` → `"12 345,67 €"` (group sep U+00A0).
- `formatCents(1234, "BGN", "bg")` → `"12,34 лв."`; `formatCents(1234, "USD", "bg")` →
  `"12,34 $"` (narrowSymbol).
- `formatCents(1234, "EUR", "en")` → `"€12.34"`; omitted locale ⇒ `"en"` (unchanged
  behavior for un-migrated call sites).
- In the running app with БГ selected: expense list, balances chips, split footer
  ("entered/left"), scan review totals and activity amounts all show comma-decimal
  trailing-symbol amounts; with EN selected, en-US style throughout.

**Activity log:**

- Editing an expense (description + amount + date + method) in the БГ UI writes
  `changes` as `{key, params}` objects (verify the jsonb row), and the modal renders all
  fragments in Bulgarian with `12,34 €`-style amounts and `23 авг`-style dates; switching
  to EN re-renders the *same row* in English.
- A pre-existing row with `changes: ["description \"A\" → \"B\""]` still renders that
  string verbatim; a fragment with an unknown `key` renders the key, no crash.
- `SPLIT_METHOD_LABELS` no longer exists; `actions.ts` imports neither `formatCents` nor
  `formatDate`.

**Locale detection** (curl-testable):

- No `locale` cookie + `Accept-Language: bg-BG,bg;q=0.9,en;q=0.8` → Bulgarian UI,
  `<html lang="bg">`. Same with `Accept-Language: bg`.
- No cookie + `Accept-Language: en-US,en;q=0.9` (or header absent, or `de-DE,de;q=0.9`) → English.
- Cookie `locale=en` + Bulgarian header → English (cookie wins); toggling writes the
  cookie and survives new requests.
- `negotiateLocale` unit tests cover q-value ordering, region subtags, whitespace, `*`,
  and garbage input.

**Meta:** with БГ active the document `<title>` contains the Bulgarian strapline.

**Regression:** `npm run test:math`, `npx tsx scripts/receipt.test.ts`,
`npx tsx scripts/receipt-db.test.ts` pass; `tsc` clean (the `Record<TKey, string>` bg
dictionary type forces the new keys to be translated).

## 6. Risks & alternatives considered

- **Server/browser ICU skew → hydration warnings** on `Intl`-formatted text. Low for
  en/bg today (verified identical U+00A0 conventions); mitigated by the U+202F → U+00A0
  normalization and by asserting exact bytes only in Node tests. Do not
  `suppressHydrationWarning` — a real skew should be visible in dev.
- **`narrowSymbol` ambiguity** (`$` for USD/CAD/AUD). Accepted: Bulgarian groups
  overwhelmingly use EUR/BGN where narrow == standard; alternative
  `currencyDisplay: "symbol"` yields the correct-but-alien `щ.д.` for USD in bg. Either is
  defensible — pick `narrowSymbol` and leave a comment; flipping later is one line.
- **`"1,234"` ⇒ 1234.00 could surprise** someone meaning a 3-decimal figure (fuel-style
  prices). Money fields are 2-decimal by domain; the `ExpenseModal` live preview and the
  "entered/left" footer show the parsed value immediately, so a misread is visible before
  save. The alternative — rejecting all single-separator-3-digit inputs — punishes every
  `1,234.56`-habit user instead; rejected.
- **Rendering legacy English fragments forever** in otherwise-Bulgarian logs. Accepted
  (history is immutable, matches the existing code comment); the alternative of
  best-effort regex-translating old strings at render time was rejected as fragile
  guesswork on user-generated content.
- **Storing pre-rendered per-locale strings** (write both en+bg at log time): rejected —
  freezes the locale set at write time, doubles storage, and re-breaks on locale #3;
  the display-time pattern is the industry standard ([research.md §4](research.md)).
- **Adopting `next-intl`/`i18next`** for plurals, number formats and negotiation:
  rejected — the hand-rolled system is complete for 2 locales, type-safe on key coverage,
  and the repo's zero-runtime-dependency constraint is a stated feature
  ([00-current-state-audit.md](../00-current-state-audit.md)).
- **Middleware-based detection** (set the cookie once): workable, but adds the only
  middleware in the repo plus two dependencies for behavior `getLocale()` achieves
  per-request; revisit only if locale-prefixed public pages arrive (topic 10).
