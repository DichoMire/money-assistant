# RFC 08 — Privacy & GDPR: Account Deletion, Data Export, Policies, Minimization

> **Status update (2026-08-26): COMPLETE** — all 6 stages (minimization + backfill, deletion with resolution UX + FK RESTRICT, export, retention machinery with RFC 04, policy pages as full bg+en DRAFTS + consent surfaces, ROPA). The policy text awaits one lawyer review before any marketing push ([OWNER-CHECKLIST.md §3](../OWNER-CHECKLIST.md)); the email-keyed tombstone sweep became actor-name-only because migration 0009 scrubbed emails from details entirely. Details: [IMPLEMENTATION-LOG.md](../IMPLEMENTATION-LOG.md).

> Part of the [Bulgarian market improvement guide](../README.md).
> **Status:** Proposed · **Priority: P1 — legally required before any marketing push**
> **Audience:** a future LLM implementer with full repo access. Read
> [research.md](research.md) and [00-current-state-audit.md §8](../00-current-state-audit.md)
> first; §1.2 of the audit (detach/leave semantics) is the model for erasure of shared data.
> All file/line references are to commit `14963d2`; re-locate by symbol name if drifted.
> Deletion and export are the engineering core; the policy pages are writing work
> (owner + lawyer, briefed by the research doc).

## 1. Problem

The gap table from [research.md §3](research.md), restated against the code:

1. **No account deletion path.** Nothing anywhere deletes a `users` row
   ([src/db/schema.ts:33-39](../../../src/db/schema.ts)). Art. 17 cannot be exercised. Worse, a naive
   `DELETE FROM users` would be destructive *and* broken: `groups.userId` has
   `onDelete: "cascade"` ([schema.ts:43-45](../../../src/db/schema.ts)) — the DB would nuke every group
   the user owns, including groups full of other people's records — and the cascade can
   trip the `RESTRICT` FKs from `expense_payers`/`expense_shares` to `aliases`
   ([schema.ts:120-122, 137-139](../../../src/db/schema.ts)), which is exactly why `deleteGroup` hand-orders
   its teardown ([src/app/actions.ts:206-229](../../../src/app/actions.ts)).
2. **No data export** of any kind (Art. 15/20).
3. **No privacy policy, no ToS, no processor disclosure** anywhere; the login page
   ([src/app/login/page.tsx](../../../src/app/login/page.tsx)) shows no terms line, and members are never told
   receipt photos go to a third-party LLM.
4. **Receipt images retained forever**: stored as `bytea` in `receipt_scan_images`
   ([schema.ts:196-203](../../../src/db/schema.ts)), written at parse time
   ([src/app/receipt-actions.ts:103-108](../../../src/app/receipt-actions.ts)), deleted only when the user
   deletes the whole scan (`deleteScan`, [receipt-actions.ts:360-379](../../../src/app/receipt-actions.ts)).
   No TTL, no post-conversion purge. (The provider-side fix — paid, no-training,
   ideally EU endpoint — is [RFC 04](../04-receipt-scanning/rfc.md)'s.)
5. **Activity log embeds member emails** in jsonb `details`, visible to every member,
   surviving the member's departure. Verified writers:
   `attachAlias` → `accountEmail` ([actions.ts:364-369](../../../src/app/actions.ts)),
   `removeMember` → `email` ([actions.ts:400-403](../../../src/app/actions.ts)),
   `leaveGroup` → `{ email: user.email }` ([actions.ts:420](../../../src/app/actions.ts)),
   `addCircleMember` → `email` ([actions.ts:460-464](../../../src/app/actions.ts)),
   `acceptInvite` → `email` ([actions.ts:557-561](../../../src/app/actions.ts)).
   `member.left` stores the email and then **never renders it** —
   `ActivityModal.tsx:45-46` interpolates nothing — pure minimization waste.
6. **No Art. 30 record, no breach-response plan** (72-hour КЗЛД duty exists regardless
   of scale).

## 2. Goals / non-goals

**Goals**
- G1. Self-serve account deletion with legally sound semantics for shared data,
  leaving every other member's ledger intact.
- G2. Self-serve JSON export covering Art. 15 access + Art. 20 portability.
- G3. `/privacy` + `/terms` pages (bg primary, en), consent surfaces at login,
  for existing users, and at receipt upload.
- G4. Data minimization: no more emails in the activity log; receipt images deleted
  after conversion; EXIF stance verified and documented.
- G5. A one-page Art. 30 ROPA + 10-line breach checklist in `docs/ROPA.md`.

**Non-goals**
- LLM provider switch, EU residency, paid endpoint mechanics → [RFC 04](../04-receipt-scanning/rfc.md).
  This RFC only *names* the vendor in disclosures and defines the image-retention policy.
- Payment/VAT/consumer-withdrawal compliance for the paid tier → [RFC 09](../09-monetization/rfc.md).
- Security hardening: CSP, rate-limiting infrastructure, invite-token redesign,
  cron auth → [RFC 11](../11-reliability-scale/rfc.md). (Export gets a minimal
  self-contained throttle here; nothing more.)
- Cookie banner — not needed while the only cookies are the Auth.js session and
  `locale` ([src/app/locale-actions.ts:8-17](../../../src/app/locale-actions.ts)); both get *disclosed*, not consented.

## 3. Design

### 3.1 Account deletion

The hard part is shared data. An expense ledger is joint data: every expense the user
touched is simultaneously the record of what *other* members are owed. Art. 17(3)(b)/(e)
balancing supports keeping the shared history while unlinking the person — and the app
already has exactly this operation: `detachMember` sets `aliases.userId = NULL` and
drops the `group_members` row ([actions.ts:380-388](../../../src/app/actions.ts)), leaving a virtual member
whose name the owner can rename. That is the erasure semantics for everything shared;
hard delete is reserved for data only the user can see.

**Deletion algorithm** (new server action in a new `src/app/account-actions.ts`), given
the confirmed user `u`:

1. **Classify groups**:
   - *Member groups* — groups where `getMembership` returns role `member`
     ([src/lib/group-data.ts:32-46](../../../src/lib/group-data.ts)).
   - *Solo-owned groups* — `groups.userId = u.id` with **zero `group_members` rows**
     (virtual members may exist; no other account has access, so the whole group is
     the user's own data).
   - *Conflicted groups* — owned, with ≥ 1 other real member.
2. **Conflicted groups block deletion until resolved — with resolution UX, not an
   error.** The deletion screen lists each conflicted group with two choices:
   *transfer ownership* (member picker) or *delete the group* (existing
   `deleteGroup` confirm). Deletion proceeds only when the list is empty.
   **Rejected alternative — auto-transfer to the oldest member:** it makes someone an
   owner without their consent (owner is the future billing anchor under freemium,
   [RFC 09](../09-monetization/rfc.md)), silently grants them member-removal and
   settings power, and hides a consequential decision inside an unrelated flow.
   Realistic users own a handful of groups; an explicit two-click resolution is cheap,
   and because both resolution options are self-serve inside the same flow, the Art. 17
   right remains exercisable without waiting on anyone (one-month deadline is safe).
   - *Transfer mechanics* (new owner-only action, independently useful):
     `groups.userId = newOwnerId`; delete the new owner's `group_members` row (the
     owner has none by convention, [schema.ts:65-67](../../../src/db/schema.ts)); insert one for the old
     owner; log `group.ownership_transferred` (names only). The departing user's alias
     is then handled by the member-group path below.
3. **Member groups** — reuse `detachMember` per group. Do *not* call `leaveGroup`
   (it logs the email, [actions.ts:420](../../../src/app/actions.ts) — fixed in §3.5 anyway); log
   `member.left` with the alias name only.
4. **Solo-owned groups** — hard delete via the exact `deleteGroup` teardown order
   (payers/shares → expenses → aliases → group, [actions.ts:211-223](../../../src/app/actions.ts));
   `receipt_scans`, `receipt_scan_images`, `receipt_items`, `activity_log`, and
   invites cascade with the group row.
5. **Receipt images in surviving groups** — delete `receipt_scan_images` rows for every
   scan with `createdBy = u.id` in groups that survive (member groups + transferred
   groups). The scan row, parsed items, and linked expense stay — they are the group's
   ledger; the *photo* (card last-4, loyalty IDs, purchase patterns — research §1) is
   the user's richest personal artifact and no one needs it after this point. The review
   UI must already tolerate a missing image per §3.6's retention policy.
6. **Activity-log tombstone sweep** (before the `users` row goes, while
   `actorUserId` is still set):
   - `UPDATE activity_log SET actor_name = '<TOMBSTONE>' WHERE actor_user_id = u.id`.
   - jsonb sweep on `details`, keyed by **email** (names collide, emails don't):
     where `details->>'email' = u.email`, set `email` and `name` to the tombstone;
     where `details->>'accountEmail' = u.email`, set `accountEmail` and `accountName`
     likewise (`jsonb_set`, two UPDATE statements via `sql` template).
   - `TOMBSTONE` is the sentinel string `"__deleted__"`; `ActivityModal.describe`
     ([src/components/ActivityModal.tsx:12-74](../../../src/components/ActivityModal.tsx)) and the `actorName`
     render path map it to a new i18n key `activity.deletedUser` — bg
     **„изтрит потребител“**, en "deleted user". Do **not** store the literal Bulgarian
     string: frozen-language jsonb is precisely the audit's §1.9 complaint about the
     English diff fragments.
7. **Delete the `users` row.** Remaining FK effects are now safe and intended:
   `group_members` cascade (none left), `aliases.userId` set-null (already null),
   `activity_log.actorUserId` set-null, `receipt_scans.createdBy` set-null
   ([schema.ts:154, 173](../../../src/db/schema.ts)), `group_invites.createdBy` cascade (owner-only
   creator, [actions.ts:508-522](../../../src/app/actions.ts), so only their own groups' links die).
8. **Guard-rail migration**: change `groups.userId` FK from `cascade` to `restrict`.
   After this RFC the app deletes owned groups explicitly before the user row, so the
   cascade is dead weight whose only remaining power is to silently destroy shared
   groups on a raw admin `DELETE`. Make the database refuse instead.

**Ordering and failure**: there are no transactions on the Neon HTTP driver
(noted at [receipt-actions.ts:100-101](../../../src/app/receipt-actions.ts)). Run the steps in the order above —
each step leaves the database consistent on its own, and the whole action is
**idempotent**: re-invoking it after a mid-flight crash skips already-done work
(detached memberships, deleted groups, swept log rows) and finishes the job. The UI
treats "user row still exists" as "deletion pending, offer retry".

**UX — two-step, immediate, no grace period.** Settings (the account section this app
still lacks — coordinate with RFC 06's settings screen; until then a minimal
`/account` page is fine) → "Delete account" → confirmation modal that explains the
semantics in plain language (what is erased, what is anonymized, conflicted-group list)
→ user must **type their account email** to arm the button (locale-independent typed
phrase) → immediate hard delete → `signOut()`.

**Rejected alternative — 7-day soft-delete flag:** a `deletedAt` flag needs a
suppression check on every query path *and* in the auth callback — `ensureUser`
upserts the user by email on every sign-in ([src/auth.ts:29-40](../../../src/auth.ts)), so a
soft-deleted account would silently resurrect (or need special-casing) the moment the
user's Google session touches the app — plus a purge cron and a restore flow. That is
real ongoing complexity for a solo-dev app, bought against a risk the typed-email
confirmation already covers. Immediate deletion is simpler, honest, and what the button
says. A user who signs in again later just gets a fresh empty account via the same
upsert — clean semantics for free.

### 3.2 Data export

One server action, `exportAccountData()` (same new `account-actions.ts`), returning a
single JSON document; the client wraps it in a `Blob` and triggers an `<a download>`
click — no new route, matching the app's server-action-everywhere style.
Synchronous is right: realistic accounts are a few thousand rows of integers and short
strings, well under a megabyte of JSON.

**Contents** (all keys camelCase, one `exportedAt` + `formatVersion: 1` header):

- `profile`: the `users` row (id, email, name, image, createdAt).
- `groups[]`: every group the user owns or is a member of — id, name, currency,
  `role` (from `getMembership` semantics), their own alias (id, name), and the group's
  member-visible metadata they already see in-app.
- Per group, `expenses[]`: expenses **where the user's alias appears as payer or
  share-holder** (settlements included — they're `kind: "settlement"` rows in the same
  table, [schema.ts:97-99](../../../src/db/schema.ts)), each with full payers and shares (alias *names*
  included). Rationale: other members' expenses that never touch the user are not the
  user's data; but for expenses that do, the co-payers/co-owers are an inseparable part
  of the record and are exactly what the user already sees on screen.
- `receiptScans[]`: scans with `createdBy = user.id` — full scan metadata plus
  `receipt_items` (incl. `rawText`), plus `imageUrl` pointing at the existing
  authenticated route `/api/receipts/{scanId}/image`
  ([src/app/api/receipts/[scanId]/image/route.ts:13-45](../../../src/app/api/receipts/%5BscanId%5D/image/route.ts)).
- `activity[]`: optional, skip — activity entries are group records, not user records,
  and are available in-app. (Documented decision, not an oversight.)

**Receipt images: no zip.** Rejected for v1: images are `bytea` blobs (~300 KB each)
that would need an archive encoder (the codebase has zero runtime dependencies beyond
the framework — audit header) and could push a serverless invocation past memory/body
limits for scan-heavy accounts. The structured data the user *provided* (Art. 20) is in
the JSON; the photos themselves are individually downloadable through the existing
authenticated image route linked from the export, while the account exists. Revisit if
users ask.

**Rate limit** (self-contained, serverless-safe — no in-memory counters): add a nullable
`users.lastExportAt` timestamp (single-column migration); refuse a second export within
10 minutes with a localized message. This is the only rate-limiting this RFC does;
app-wide limits are [RFC 11](../11-reliability-scale/rfc.md).

### 3.3 Policy pages — `/privacy` and `/terms`

Static server-rendered pages, localized through the existing `getT()`/`getLocale()`
pattern, **Bulgarian primary, English second** (research: plain "Данните ви са ваши"
language beats legalese for this audience). Linked from: login card (§3.4), a small
footer on the dashboard/layout, and the privacy page from the receipt-upload notice.

**Content is an owner + lawyer task** — the research doc is the brief; this RFC fixes
only the required *outline*:

`/privacy`:
1. Who we are (controller identity + contact email).
2. What we store — plain-language table mirroring audit §8: account (email, name,
   Google avatar), group ledgers (names, amounts, descriptions, who-owes-whom),
   receipt scans (merchant, items, verbatim receipt lines, the photo while retained),
   activity log.
3. Why & legal basis — contract (Art. 6(1)(b)) for the service; legitimate interest
   for abuse/security.
4. **Processor table** — Vercel (hosting), Neon (database), Google (sign-in),
   **the LLM vendor by name** for receipt parsing (whichever RFC 04 lands on —
   currently OpenRouter, which this table must *not* ship describing while free
   training-permitted endpoints are the default), each with DPA link and transfer
   mechanism (SCCs / EU-US DPF).
5. **Retention table** — account data: until deletion; receipt images: until
   conversion, drafts max 30 days (§3.6); activity log: life of the group, emails
   never (post-§3.5), tombstoned on account deletion; LLM provider API logs: vendor's
   documented window.
6. Your rights — access/export, rectification, **deletion (self-serve, described
   honestly incl. the shared-ledger anonymization)**, and the right to complain to
   **КЗЛД (cpdp.bg)**.
7. Cookies — the two cookies (session, `locale`), both strictly necessary; no banner
   because there is nothing to consent to.
8. Age — **14+** (Bulgaria's digital-consent age, research §2.4).
9. Changes to this policy.

`/terms`:
1. The service (informal expense tracking between people who know each other).
2. **Not a financial institution** — not a bank, payment processor, or lender; the
   service never holds or moves money; settlement happens entirely outside the app.
3. **Records are informational** — balances are informal records, not legally binding
   contracts nor evidence of enforceable debt; the operator is not a party to user
   disputes.
4. **AI accuracy disclaimer** — receipt scanning is automated and may be wrong; verify
   amounts before relying on them.
5. Age 14+; acceptable use; account termination.
6. Liability cap and mandatory-consumer-law carve-outs (lawyer's clause; the paid-tier
   withdrawal-right mechanics live in [RFC 09](../09-monetization/rfc.md)).
7. Governing law: Bulgaria.

### 3.4 Consent surfaces

- **Login page**: one muted line under the sign-in buttons
  ([login/page.tsx:36-53](../../../src/app/login/page.tsx)): *"By continuing you accept the
  [Terms](/terms) and acknowledge the [Privacy Policy](/privacy)"* (bg primary). Accept
  for terms, acknowledge for privacy — the lawful basis is contract, not consent, so
  the privacy policy is *notice*, not an agreement.
- **Existing users**: add nullable `users.policiesAcceptedAt` (+ `policiesVersion`
  int if you want cheap future re-prompts). The app layout shows a one-time dismissible
  banner when null: "We've published our Terms and Privacy Policy" + links + a
  "Разбрах / Got it" button that stamps the column via a small server action. Server-side
  column, not a cookie — it must survive devices and sessions.
- **Receipt upload**: two layers in `ScanUploadView`
  ([src/components/ScanUploadView.tsx:124-193](../../../src/components/ScanUploadView.tsx)):
  a **permanent** small caption on the upload card — *"Photos are sent to {LLM vendor}
  to read the receipt — [Privacy Policy](/privacy)"* (vendor name interpolated from the
  same constant RFC 04 configures) — plus a **first-use** confirm dialog through the
  existing `useConfirm` hook, remembered in `localStorage`. Device-scoped memory is
  acceptable because this is a transparency notice, not a consent record; the
  always-visible caption is the layer that actually satisfies Art. 13 transparency.

### 3.5 Data minimization fixes

- **Stop writing emails into `activity_log`.** Forward-only code fix at the five
  verified writers (§1.5): drop the `email`/`accountEmail` keys; keep names.
  `member.left` gets `{ name: aliasName }` (it rendered nothing anyway);
  `member.joined`/`member.removed`/`alias.attached` templates and their
  `ActivityModal.tsx` render cases ([:38, :43, :48](../../../src/components/ActivityModal.tsx)) plus the
  i18n strings lose the email parameter. **Plus one optional cheap backfill** (do it —
  it turns "forward-only" into "actually clean"): a single
  `UPDATE activity_log SET details = details - 'email' - 'accountEmail' WHERE details ? 'email' OR details ? 'accountEmail'`
  after the renderers stop reading those keys. The §3.1 tombstone sweep then only
  matters for `actorName`.
  Related hygiene, same intent: `requireUser` falls back to the raw email as the
  display name ([src/lib/action-helpers.ts:21](../../../src/lib/action-helpers.ts)) and `createLinkedAlias`
  uses the email local-part ([actions.ts:242](../../../src/app/actions.ts)) — acceptable (Google always
  supplies a name in production), no change required.
- **Receipt images: delete-after-conversion is the policy.** Precisely: the stored
  image exists to serve the review UI while a scan is a **draft**; on `convertScan`
  success the image row is deleted; drafts older than **30 days** are purged by the
  existing daily cron; `deleteScan` already cascades. **Boundary:** the pipeline change
  itself (deleting in `convertScan`, review-view behavior with a missing image,
  a possible user-facing "keep photo" option) is implemented in
  [RFC 04](../04-receipt-scanning/rfc.md); *this* RFC owns the policy statement, its
  disclosure in the retention table, and the **backfill purge script**
  (`scripts/purge-receipt-images.ts`): delete `receipt_scan_images` rows where the
  scan has `expense_id IS NOT NULL` (converted) or is a draft with
  `updated_at < now() - 30 days`; log counts; idempotent; run once at deploy, then the
  cron keeps it true.
- **EXIF — verified stripped on the normal path.** The client always re-encodes
  through a canvas: `downscaleToJpeg` draws the decoded bitmap and re-emits JPEG via
  `canvas.toBlob` ([ScanUploadView.tsx:46-65](../../../src/components/ScanUploadView.tsx)), which serializes
  pixels only — EXIF/GPS metadata cannot survive; orientation is honored beforehand via
  `createImageBitmap(file, { imageOrientation: "from-image" })`
  ([:27](../../../src/components/ScanUploadView.tsx)). State this in the privacy policy. Known gap, accepted:
  the server action itself accepts any JPEG/PNG/WebP ≤ 3.5 MB without re-stripping
  ([receipt-actions.ts:46-53](../../../src/app/receipt-actions.ts)), so a hand-crafted request can store
  EXIF-bearing bytes — server-side re-encoding needs an image library and is
  [RFC 11](../11-reliability-scale/rfc.md) hardening territory, not worth a dependency here.

### 3.6 Art. 30 record + breach note — `docs/ROPA.md`

One markdown file, two parts, no tooling:

- **ROPA table** — columns: processing activity · purpose · legal basis · data
  categories · data subjects · processors/recipients · transfers (mechanism) ·
  retention · security measures. Rows: accounts & auth; group ledgers; receipt
  scanning (incl. LLM vendor); activity log; cookies. (FX rates hold no personal data —
  note excluded.)
- **Breach checklist, 10 lines**: detect & timestamp → contain (revoke creds, rotate
  secrets) → snapshot evidence → assess scope (whose data, which tables) → risk-assess
  (high risk to individuals?) → **notify КЗЛД within 72 h** (cpdp.bg portal) if
  reportable → notify affected users without undue delay if high risk → document
  everything in this file regardless of notification → fix root cause → post-mortem
  review of this checklist.

Keep both updated when RFC 04 changes the LLM vendor.

## 4. Implementation plan (ordered, independently shippable)

Policies must **not** ship before the rights they promise exist — a published privacy
policy describing a deletion button that isn't there is worse than none. Deletion and
export land first; the policy pages ship last and describe reality.

| Stage | Contents | Touches |
|---|---|---|
| 1 | Minimization: strip email keys from the 5 log writers + renderers + i18n; jsonb backfill | `actions.ts`, `ActivityModal.tsx`, `i18n.ts`, one-off SQL |
| 2 | Ownership transfer action; account deletion (classify → resolve → detach/teardown → image delete → tombstone sweep → user delete); `groups.userId` FK → `restrict`; minimal `/account` page + typed-email confirm UX | new `account-actions.ts`, `actions.ts`, `schema.ts` + migration, new `/account` page, `ActivityModal.tsx` (tombstone render), `i18n.ts` |
| 3 | Export action + `users.lastExportAt` throttle + download button on `/account` | `account-actions.ts`, `schema.ts` + migration, `/account` page |
| 4 | Image-retention backfill purge script + cron draft-purge; retention policy fixed in writing (pipeline change itself → RFC 04) | `scripts/purge-receipt-images.ts`, `api/cron/daily/route.ts` |
| 5 | `/privacy` + `/terms` pages (outline scaffold, owner+lawyer text); login notice line; existing-user banner + `policiesAcceptedAt`; receipt-upload caption + first-use dialog | new pages, `login/page.tsx`, layout/banner component, `ScanUploadView.tsx`, `schema.ts` + migration, `i18n.ts` |
| 6 | `docs/ROPA.md` (table + breach checklist) | docs only |

Stages 1–3 are the engineering core. Stage 5 is gated on 2–4 being live (its retention
table and rights section must be true). Stage 6 is an hour of writing, any time.
Coordinate stage 4/5 vendor naming with [RFC 04](../04-receipt-scanning/rfc.md):
**do not launch marketing while the free OpenRouter default is what the policy would
have to disclose.**

## 5. Acceptance criteria

- Deleting an account that is a *member* of shared groups leaves every other member's
  balances **byte-identical** (compare `loadGroupData` output before/after): aliases
  survive with `userId = NULL`, all expense/payer/share rows untouched.
- A user owning a group with other real members gets the **resolution UX** (transfer or
  delete per group), never a bare error; after resolving, deletion completes; the
  transferee sees owner controls.
- Solo-owned groups (incl. ones with virtual members and receipt scans) are fully gone:
  no rows in any table reference them.
- After deletion: no `users` row, no `receipt_scan_images` row with the user's
  authorship in surviving groups (scan rows + items remain), no `activity_log` row
  whose `actor_name` or `details` contain the deleted user's email; tombstoned entries
  render „изтрит потребител“ / "deleted user" in the activity modal in both locales.
- Re-running the deletion action after a simulated mid-flight failure completes cleanly
  (idempotency); signing in with the same Google account afterwards yields a fresh,
  empty account.
- Export: the downloaded file round-trips `JSON.parse`; contains the profile, every
  group with correct `role`, every expense the user's alias pays or owes in (incl.
  settlements, payers, shares), and scan metadata + items for scans they created;
  a second export within 10 minutes is refused with a localized message.
- Raw `DELETE FROM users WHERE id = …` against a user owning a shared group **fails**
  at the database (post FK-migration).
- `/privacy` and `/terms` render in bg and en; login page links them; an existing user
  sees the one-time banner exactly once across devices; the scan-upload card names the
  LLM vendor and links the privacy policy before any upload.
- A JPEG with GPS EXIF uploaded through the UI is stored EXIF-free (inspect stored
  bytes); the converted scan's image row is gone after `convertScan` (post-RFC 04) and
  after the backfill script for pre-existing converted scans.
- Existing test suites (`npm run test:math`, `scripts/receipt.test.ts`,
  `scripts/receipt-db.test.ts`, `scripts/db-smoke.ts`) still pass; new PGlite-backed
  tests cover the deletion classifier, tombstone sweep, and export shape.

## 6. Risks & alternatives considered

- **No transactions (Neon HTTP driver)** → a crash mid-deletion leaves partial state.
  Mitigated by strict step ordering (each step independently consistent) + idempotent
  re-run; the same pattern `deleteGroup` and `parseReceipt` already rely on.
- **Tombstone-by-email misses rows** where the email was recorded with different casing
  or the account's email changed at Google between join and deletion. Accepted: sweep
  case-insensitively (`lower(details->>'email')`), and note that after Stage 1 no new
  email-bearing rows are written at all, so the exposure only shrinks.
- **Anonymize-in-place instead of deleting the `users` row** (scrub email/name, keep
  the row): rejected — the unique real email is the identity key, `ensureUser`
  ([src/auth.ts:29-40](../../../src/auth.ts)) would resurrect the account on next sign-in anyway, and a
  scrubbed row serves no one. True deletion + detach achieves the same referential
  safety through the existing `set null` FKs.
- **Auto-transfer ownership / soft-delete grace period / image zip in export**:
  rejected in §3.1/§3.2 with reasons (consent, `ensureUser` resurrection + query-path
  complexity, dependency + serverless limits respectively).
- **Blocking deletion could be abused as dark-pattern friction.** It isn't, provided
  both resolution options are one click away inside the flow and solo/member cases
  delete with zero extra steps — keep it that way; КЗЛД complaints are
  complaint-driven (research §1) and "couldn't delete my account" is the classic one.
- **Policy text drift**: the processor/retention tables live in prose and will rot when
  RFC 04/09/11 land. Mitigation: `docs/ROPA.md` is named the single source of truth,
  and each of those RFCs' acceptance criteria should include "ROPA + privacy policy
  updated".
