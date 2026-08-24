# Topic 02 — Localization Correctness & Bulgarian Language Quality: Research

> Part of the [Bulgarian market improvement guide](../README.md).
> Research date: **2026-08-24**; all `Intl` outputs below were verified live that day
> (Node v24.13.1, full ICU). Companion implementation plan: [rfc.md](rfc.md).
> Current-state findings: [00-current-state-audit.md §3](../00-current-state-audit.md).
> Claims that could not be verified are flagged ⚠️.

**Why this matters:** [topic 10's research §6](../10-growth-marketing/research.md) identifies
language quality as a trust proxy in the Bulgarian market — machine-translated or
half-localized products are instantly coded as foreign/scam. The app's *words* are already
native-quality (~440 keys, idiomatic Bulgarian, correct „…“ typography), but its *numbers*
are still American: every amount renders as `€12.34` instead of `12,34 €`, and typing an
amount the Bulgarian way (`12,34` works, `1 234,56` doesn't) gets rejected. Numbers appear
on every screen of a money app; this is the cheapest remaining localization win.

---

## 1. Bulgarian number & currency formatting conventions

### What CLDR says (the `bg` locale)

From [CLDR `bg` number data](https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-numbers-full/main/bg/numbers.json) (verified against the raw JSON):

- **Decimal separator: comma** (`,`).
- **Grouping separator: space** (rendered by `Intl` as no-break space U+00A0).
- **`minimumGroupingDigits: 2`** — grouping only kicks in from 5 integer digits
  (`1234,56` has *no* space; `12 345,67` does). This is a detail almost every
  hand-rolled formatter gets wrong.
- **Currency pattern: `#,##0.00 ¤`** — the currency symbol comes **after** the amount,
  separated by a (non-breaking) space.

The trailing-symbol rule is also EU-official: the
[Interinstitutional Style Guide §7.3.3](https://style-guide.europa.eu/en/content/-/isg/topic?identifier=7.3.3-rules-for-expressing-monetary-units)
puts the euro sign *before* the amount in English/Irish/Maltese/Dutch and **after the
amount with a hard space in the other EU languages, Bulgarian included** (`30 €`).

### What `Intl.NumberFormat("bg", { style: "currency" })` actually produces

Verified live (Node v24.13.1, full ICU; every space inside an output below is a
no-break space, U+00A0):

| Call | Output | Notes |
|---|---|---|
| `("bg", EUR).format(12.34)` | `12,34 €` | comma decimal, NBSP before the trailing € |
| `("bg", EUR).format(1234.56)` | `1234,56 €` | **no grouping at 4 digits** (`minimumGroupingDigits: 2`) |
| `("bg", EUR).format(12345.67)` | `12 345,67 €` | group separator is U+00A0 |
| `("bg", BGN).format(12.34)` | `12,34 лв.` | |
| `("bg", USD).format(12.34)` | `12,34 щ.д.` | CLDR-correct but unusual; `currencyDisplay: "narrowSymbol"` gives `12,34 $` |
| `("bg", GBP).format(1234.56)` | `1234,56 GBP` | no bg symbol for GBP; `narrowSymbol` gives `£` |
| `("bg", JPY).format(1000)` | `1000 JPY` | zero fraction digits — see the zero-decimal caveat below |
| `("en-US", EUR).format(12.34)` | `€12.34` | what the app shows **everyone** today |
| `("en-US", BGN).format(12.34)` | `BGN 12.34` | |

Performance, measured: constructing a formatter ≈ 14 µs; a cached formatter formats
100k values in ~29 ms. A per-`locale+currency` formatter cache is nice-to-have, not critical.

### What the app currently does wrong

- **`formatCents` hardcodes `en-US`** ([src/lib/money.ts:1-10](../../../src/lib/money.ts)):
  `new Intl.NumberFormat("en-US", { style: "currency", currency })`. Every amount on every
  screen — 13 files call it ([00-current-state-audit.md §3](../00-current-state-audit.md)) —
  renders US-style (`€1,234.56`) even when the UI language is Bulgarian. The function does
  not take a locale parameter at all, so no call site *can* do better.
- **`parseAmount` rejects Bulgarian-formatted input**
  ([src/lib/money.ts:13-19](../../../src/lib/money.ts)): it replaces only the **first**
  comma (`.replace(",", ".")` — not `replaceAll`) and then applies `/^-?\d+(\.\d{0,})?$/`,
  which admits no spaces and at most one dot:
  - `"12,34"` → works (the one Bulgarian case that survives).
  - `"1 234,56"` → **rejected** (space fails the regex) — "Enter a valid amount."
  - `"1,234.56"` → `"1.234.56"` → **rejected** (two dots).
  - `"1.234"` (dot-grouped thousands) → **silently parsed as 1.234 → 123 cents** — the
    worst failure mode: not an error but a wrong amount, off by 10×.
  - `parseNumber` ([src/lib/money.ts:22-27](../../../src/lib/money.ts)) has the same
    first-comma-only bug for percent/shares inputs.
- Zero-decimal caveat (owned by the audit's currency-exponent item, not this topic):
  `formatCents` divides by 100 unconditionally, so JPY/HUF amounts are misdisplayed
  regardless of locale. A locale-aware rewrite should not *worsen* this but doesn't fix it.

## 2. Bulgarian pluralization

- **CLDR plural categories for `bg`: `one` (n = 1) and `other`** — same shape as English.
  Verified live: `new Intl.PluralRules("bg").resolvedOptions().pluralCategories` →
  `["one", "other"]`; `select(1)` → `one`, `select(2|5|101)` → `other`.
  Chart: [CLDR language plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) ·
  spec: [cldr.unicode.org plural rules](https://cldr.unicode.org/index/cldr-spec/plural-rules).
- **The бройна форма (count form) nuance** — a grammar layer CLDR's two categories do not
  express: masculine **non-person** nouns take a special count form in **-а/-я** after
  numerals (`два стола`, `пет молива`), distinct from the general plural (`столове`,
  `моливи`); masculine **person** nouns instead take the masculine-personal numerals
  (`двама`, `трима`…) with the ordinary plural, or the suppletive `души`.
  Sources: [Wiktionary — бройна форма](https://en.wiktionary.org/wiki/%D0%B1%D1%80%D0%BE%D0%B9%D0%BD%D0%B0_%D1%84%D0%BE%D1%80%D0%BC%D0%B0) ·
  [Pancheva, *The Bulgarian 'count' form is semantically singular* (PDF)](https://www.uni-goettingen.de/de/document/download/70c2bcba62af7f5bbc4df8a71677e780.pdf/Pancheva_The_Bulgarian_count_form_is_semantically_singular.pdf) ·
  [Polyglot Club — Bulgarian cardinal numerals](https://polyglotclub.com/wiki/Language/Bulgarian/Grammar/CARDINAL-NUMERALS-%E2%80%93-%D0%91%D1%80%D0%BE%D0%B9%D0%BD%D0%B8-%D1%87%D0%B8%D1%81%D0%BB%D0%B8%D1%82%D0%B5%D0%BB%D0%BD%D0%B8).
- **Verdict on the current `countWord()`** ([src/lib/i18n.ts:926-928](../../../src/lib/i18n.ts)):
  the binary `count === 1 ? one : many` selector **exactly matches CLDR `bg`** (and `en`),
  so it is *not* "working by coincidence" at the rule level — the audit's caveat really
  concerns the dictionary contents. And those are already right: because `countWord` is
  only ever used adjacent to a numeral, the "many" slot must hold the **count form**, which
  the `bg` dictionary does (`count.expenses: "разхода"`, `count.shares: "дяла"`,
  `count.items: "артикула"`, `count.accounts: "{count} акаунта"`) and uses `души` for
  people (`3 души`). Conclusion: **sufficient for en+bg**. It stops being sufficient the
  moment a locale with more categories (ru/uk/pl/sr have `one/few/many`) is added — the
  future-proof form is an `Intl.PluralRules`-backed key suffix (`count.expense.one` /
  `.other`), a small, non-urgent refactor.
- ⚠️ Compounds ending in *един* (`21`, `101`) show real-world variation in Bulgarian
  (`сто и един лев` vs `101 лева`); CLDR resolves this by scoping `one` to exactly n = 1,
  which is the convention to follow — no action needed.

## 3. Parsing amounts typed by EU users — best practice

- **There is no parse API in `Intl`** — ECMA-402 defines formatting only
  ([MDN — Intl.NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat));
  every web app hand-rolls or imports amount parsing.
- **Do not use `<input type="number">` for money.** Browsers interpret typed decimal
  commas inconsistently against the page/OS locale — some silently drop the comma
  (`12,34` → `1234`!), some reject it
  ([Ctrl.blog — browser support for decimal marks in number inputs](https://www.ctrl.blog/entry/html5-input-number-localization.html));
  GOV.UK dropped `type="number"` service-wide in favor of
  `type="text"` + `inputmode` ([GOV.UK technology blog](https://technology.blog.gov.uk/2020/02/24/why-the-gov-uk-design-system-team-changed-the-input-type-for-numbers/)).
  The app already does this correctly: text inputs with `inputMode="decimal"`
  ([00-current-state-audit.md §4](../00-current-state-audit.md)) — the gap is
  purely in `parseAmount`.
- **Accept both `.` and `,` as the decimal mark regardless of UI locale** — users type in
  *their* habit, not the app's locale ([Ctrl.blog](https://www.ctrl.blog/entry/html5-input-number-localization.html)
  recommends supporting both interchangeably;
  [Microsoft's globalization guidance](https://learn.microsoft.com/en-us/globalization/text/parsing-input)
  stresses that a comma is decimal in one locale and grouping in another, so parsing must
  disambiguate rather than assume).
- **Disambiguation heuristics used in practice** (Excel-style, and what the naive
  first-comma replace breaks on):
  1. Spaces (incl. U+00A0/U+202F) and apostrophes are always grouping — strip them.
  2. If **both** `.` and `,` appear, the **rightmost** one is the decimal separator; the
     other is grouping (`1.234,56` and `1,234.56` both → 1234.56).
  3. A single separator followed by exactly **3** trailing digits is ambiguous in general
     (`1,234`), but **not for a 2-decimal money field**: 3 decimals are impossible, so it
     must be grouping. A single separator followed by 1–2 trailing digits is a decimal
     mark. (This money-specific rule is stricter than general number parsing — a big
     advantage of parsing cents rather than floats.)
- Locale-appropriate **placeholder hints** (`0,00` in bg, `0.00` in en) nudge the format
  without restricting input. ⚠️ Common practice; no formal study cited.

## 4. The stored-English activity log — industry pattern

The pattern for localizable audit/event logs is decades old: **store a machine event
(key/ID + typed parameters), render localized text at display time; never persist display
strings.** The canonical implementation is the Windows Event Log — applications log only
the event source, event ID and language-independent *insertion strings*; Event Viewer
resolves the human-readable message from the viewer's localized message file when the log
is *read* ([Microsoft — event identifiers](https://learn.microsoft.com/en-us/windows/win32/eventlog/event-identifiers),
[EventSentry — how event log message files work](https://www.eventsentry.com/blog/2008/04/event-log-message-files-the-de.html)).
General i18n guidance says the same: keys + runtime interpolation, translations only in
resource bundles ([Lokalise — translation key best practices](https://lokalise.com/blog/translation-keys-naming-and-organizing/),
[Mozilla l10n developer best practices](https://mozilla-l10n.github.io/documentation/localization/dev_best_practices.html)).

**The app already follows this pattern for 21 of its 22 action types** — `activity_log`
rows store an `action` key plus raw params in jsonb
([src/db/schema.ts:149-159](../../../src/db/schema.ts)), and `describe()` in
[src/components/ActivityModal.tsx:12-74](../../../src/components/ActivityModal.tsx) renders
them through `t()` in the viewer's current locale, formatting `amountCents`/`currency` at
display time. The exceptions, all persisted as English display strings at *write* time:

- `buildExpenseChanges` ([src/app/actions.ts:61-118](../../../src/app/actions.ts)) — eight
  English fragments (`description "X" → "Y"`, `amount €1.00 → €2.00`, `date Aug 23 → Aug 24`,
  `split method equally → by shares`, `paid by …`, `split between …`,
  `payer/split amounts adjusted`) frozen into `details.changes`.
- The settlement equivalents ([src/app/actions.ts:779-793](../../../src/app/actions.ts)):
  `payer X → Y`, `recipient X → Y`, plus the same `amount`/`date` fragments.
- Inside those fragments, `formatCents` bakes in en-US currency style
  ([actions.ts:81, 788](../../../src/app/actions.ts)) and `formatDate` is called without a
  locale, baking in **English month names** ([actions.ts:85, 792](../../../src/app/actions.ts)).
- `participantSummary` emits `` `${ids.length} people` `` ([actions.ts:50-53](../../../src/app/actions.ts)).

`ActivityModal.tsx:16` documents the consequence: *"Stored details.changes fragments are
historical data and stay as written"* — i.e. **Bulgarian users will read English diffs
forever**, and every day of production use grows the untranslatable backlog. The fix
direction is obvious from the app's own design: make `changes` structured
(`{ key, params }[]`), render legacy string fragments verbatim as fallback.

## 5. Locale auto-detection (the app defaults to English)

- Current behavior: `DEFAULT_LOCALE = "en"` ([src/lib/i18n.ts:9](../../../src/lib/i18n.ts));
  `getLocale()` reads only the cookie ([src/lib/i18n-server.ts:5-9](../../../src/lib/i18n-server.ts));
  there is **no `middleware.ts` in the project** (verified) and nothing reads
  `Accept-Language`. A first-time Bulgarian visitor gets an English UI and must find the
  EN/БГ pill ([00-current-state-audit.md §6](../00-current-state-audit.md)).
- Every mainstream browser sends the user's preferred languages in the `Accept-Language`
  request header with q-values; honoring it on first visit is the standard negotiation
  pattern. The [Next.js App Router i18n guide](https://nextjs.org/docs/app/guides/internationalization)
  demonstrates it with `Negotiator` + `@formatjs/intl-localematcher` running in
  middleware (renamed "proxy" in Next 16; this repo is on Next 15.5, where the file is
  `middleware.ts`), typically to redirect to `/{locale}` sub-paths.
- The app deliberately does **not** use locale sub-paths (cookie-based, auth-gated app —
  no SEO surface today; public-page URL strategy belongs to topic 10). For a cookie-based
  setup the negotiation can equally run **per-request in `getLocale()`**: if the cookie is
  absent, read `headers().get("accept-language")` and match against `["bg", "en"]`. With
  exactly two supported locales the q-value parse is ~10 lines — no need for the two
  dependencies (relevant given the repo's zero-runtime-dependency stance,
  [00-current-state-audit.md](../00-current-state-audit.md) header).
  `headers()` forces dynamic rendering, but every page already calls `auth()` and
  `cookies()` — the app has no static pages to lose.
- **Cookie override pattern** (already half-built): the explicit choice made via
  `setLocale` ([src/app/locale-actions.ts](../../../src/app/locale-actions.ts)) writes the
  1-year `locale` cookie, which must always win over the header. Detection only ever fills
  the gap before the first explicit choice.

## 6. Typography: what's right, what's left

**Already correct** (worth protecting — it is the trust signal of research §6):

- Bulgarian quotation marks **„…“** exactly per CLDR `bg` delimiters
  (`quotationStart: „` U+201E, `quotationEnd: “` U+201C —
  [CLDR bg delimiters.json](https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-misc-full/main/bg/delimiters.json),
  verified). The bg dictionary uses them consistently (e.g. `„{name}“` in error keys).
- Cyrillic font subsets loaded ([src/app/layout.tsx:7-15](../../../src/app/layout.tsx)),
  `<html lang={locale}>` set ([layout.tsx:40](../../../src/app/layout.tsx)).
- `formatDate` is day-first in bg (`23 авг` —
  [src/lib/format.ts:9-15](../../../src/lib/format.ts)). Note `Intl` for bg abbreviates
  numerically (`day:numeric, month:short` → `23.08`; `dateStyle:"medium"` → `23.08.2026 г.`,
  verified live) — the hand-rolled `23 авг` is *more* readable than CLDR's short forms and
  fine to keep; it just must keep receiving the locale (the activity-log call sites don't,
  see §4).

**Remaining polish:**

- The page `<title>` is hardcoded `"Money Assistant"` while the `description` meta *is*
  localized ([src/app/layout.tsx:25-31](../../../src/app/layout.tsx)) — the browser tab
  and share cards stay English-only.
- `LanguageToggle`'s `aria-label="Language / Език"` is bilingual-hardcoded
  ([src/components/LanguageToggle.tsx:26](../../../src/components/LanguageToggle.tsx)).
  For a language *switcher* a bilingual label is a defensible a11y choice (it must be
  understandable before switching) — but it should be a deliberate, commented constant,
  not an accident.
- Native `<input type="date">` pickers render in the **browser** locale, not the app
  cookie locale ([00-current-state-audit.md §3](../00-current-state-audit.md)) — a
  bg-browser user sees Bulgarian pickers even in the English UI and vice versa. Unfixable
  without replacing native inputs; accept and document (mobile UX of native pickers is
  worth more than locale consistency here).
- Stored-English odds and ends adjacent to the log problem: settlement `description:
  "Payment"` written to the DB ([src/app/actions.ts:747](../../../src/app/actions.ts),
  masked by the UI's `t("expenses.payment")`), fallback strings `"Member"`
  ([actions.ts:242](../../../src/app/actions.ts)), `"Someone"`
  ([src/lib/group-data.ts:272](../../../src/lib/group-data.ts)), `"Scanned receipt"`
  ([src/lib/receipt-convert.ts:151](../../../src/lib/receipt-convert.ts)).

## Implications for the app (summary — the RFC turns these into a plan)

1. **`formatCents` must take a locale** and map `bg` → `Intl.NumberFormat("bg")`. Expected
   bg output, verified: `12,34 €`, `1234,56 €` (no grouping under 5 digits), `12 345,67 €`
   (NBSP), `12,34 лв.`. Prefer `currencyDisplay: "narrowSymbol"` so USD/GBP render `$`/`£`
   instead of `щ.д.`/`GBP`. Thread the locale via the existing `useLocale()`/`getLocale()`
   plumbing — every call site already lives under `LocaleProvider` or a server request.
2. **Rewrite `parseAmount`** with the money-specific disambiguation of §3: strip
   space-class chars, rightmost-separator-wins when both appear, 3-trailing-digits ⇒
   grouping, 1–2 ⇒ decimals. `"1 234,56"`, `"1,234.56"`, `"1.234,56"` must all → 123456
   cents; the silent `"1.234"` → 123 misparse must die. Same `replaceAll` fix in
   `parseNumber`.
3. **Structured activity-log diffs**: change `details.changes` from `string[]` to
   `{ key, params }[]` at write time; render through `t()` with display-time
   `formatCents`/`formatDate`; render legacy plain-string fragments verbatim (the
   Windows-Event-Log pattern the app already uses for its other 21 action types).
4. **Accept-Language negotiation on first visit** inside `getLocale()` (cookie absent →
   match `bg`/`en` from the header; cookie always wins). No new dependencies needed.
5. **Localize `<title>`** via the existing `generateMetadata`, and make the toggle's
   bilingual `aria-label` deliberate.
6. `countWord()` stays as-is for en+bg (CLDR-exact); move to `Intl.PluralRules` only when
   a third locale arrives. The bg dictionary's count forms (`разхода`, `дяла`, `души`) are
   already grammatically correct — protect them in review.

## Sources

- CLDR bg numbers (decimal comma, space grouping, `minimumGroupingDigits: 2`, `#,##0.00 ¤`): https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-numbers-full/main/bg/numbers.json
- CLDR bg delimiters („…“): https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-misc-full/main/bg/delimiters.json
- CLDR plural rules: https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html · https://cldr.unicode.org/index/cldr-spec/plural-rules
- EU Interinstitutional Style Guide §7.3.3 (euro sign after the amount in Bulgarian): https://style-guide.europa.eu/en/content/-/isg/topic?identifier=7.3.3-rules-for-expressing-monetary-units
- Bulgarian count form: https://en.wiktionary.org/wiki/%D0%B1%D1%80%D0%BE%D0%B9%D0%BD%D0%B0_%D1%84%D0%BE%D1%80%D0%BC%D0%B0 · https://www.uni-goettingen.de/de/document/download/70c2bcba62af7f5bbc4df8a71677e780.pdf/Pancheva_The_Bulgarian_count_form_is_semantically_singular.pdf · https://polyglotclub.com/wiki/Language/Bulgarian/Grammar/CARDINAL-NUMERALS-%E2%80%93-%D0%91%D1%80%D0%BE%D0%B9%D0%BD%D0%B8-%D1%87%D0%B8%D1%81%D0%BB%D0%B8%D1%82%D0%B5%D0%BB%D0%BD%D0%B8
- Number-input parsing: https://learn.microsoft.com/en-us/globalization/text/parsing-input · https://www.ctrl.blog/entry/html5-input-number-localization.html · https://technology.blog.gov.uk/2020/02/24/why-the-gov-uk-design-system-team-changed-the-input-type-for-numbers/ · https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat
- Localizable event logs (store IDs + params, render at view time): https://learn.microsoft.com/en-us/windows/win32/eventlog/event-identifiers · https://www.eventsentry.com/blog/2008/04/event-log-message-files-the-de.html · https://lokalise.com/blog/translation-keys-naming-and-organizing/ · https://mozilla-l10n.github.io/documentation/localization/dev_best_practices.html
- Next.js App Router i18n / Accept-Language negotiation: https://nextjs.org/docs/app/guides/internationalization
- Trust framing: [10-growth-marketing/research.md §6](../10-growth-marketing/research.md)

**Live checks (2026-08-24, Node v24.13.1 full ICU):** all `Intl.NumberFormat`,
`Intl.PluralRules` and `Intl.DateTimeFormat` outputs quoted above, including exact
code points (U+00A0 before €, U+00A0 grouping). Browser ICU may drift from Node ICU
across CLDR releases — see the hydration note in [rfc.md](rfc.md).
