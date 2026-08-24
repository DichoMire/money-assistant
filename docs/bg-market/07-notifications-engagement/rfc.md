# RFC 07 — Notifications & Engagement: In-App Feed, Digest-First Email, User-Initiated Reminders

> **Status update (2026-08-24):** stage 1 subset implemented — group_reads watermark + dashboard new-activity dot (no bell, no email). Details: [IMPLEMENTATION-LOG.md](../IMPLEMENTATION-LOG.md).

> **Status:** Proposed · **Priority: P2 — engagement layer, after core correctness (RFC 01) and localization (RFC 02)**
> **Audience:** a future LLM implementer with full repo access. Read [research.md](research.md),
> [00-current-state-audit.md §7/§1.9/§9](../00-current-state-audit.md), and the freemium/cost context in
> [09-monetization/research.md §4](../09-monetization/research.md) first. All file/line references are to
> commit `14963d2`; re-locate by symbol name if drifted.
> Coordinates with: **RFC 05** (PWA/service worker — owns push plumbing), **RFC 06** (account settings
> screen — this RFC adds a section to it), **RFC 08** (privacy policy/processors).

## 1. Problem

1. The app has **no notification infrastructure of any kind** ([audit §7](../00-current-state-audit.md)):
   no email dependency, no push, no in-app unread state. A member who doesn't proactively open a group
   has no way to learn that an expense was added involving them, that they were added to a group, or
   that a debt is outstanding. For a shared ledger, "did everyone see this?" is a trust feature, not a
   luxury.
2. The event stream already exists — every mutation writes `activity_log` via `logActivity`
   ([src/lib/action-helpers.ts:50-68](../../../src/lib/action-helpers.ts)) — but it is pull-only,
   group-scoped, and has **no per-user read state and no per-user targeting**: e.g. the
   `expense.added` details jsonb stores only description/amount/currency/date
   ([src/app/actions.ts:682-687](../../../src/app/actions.ts)); the participant alias ids needed to
   answer "does this involve *me*?" are not in the row.
3. Constraints that shape any solution: Vercel Hobby allows only once-per-day crons and one slot is
   already used ([vercel.json](../../../vercel.json) → `/api/cron/daily`, 06:00 UTC); the email budget
   is Resend's free tier (3,000/month, **100/day**); recipient-locale is not available server-side
   (locale lives in the *requester's* cookie — [src/lib/i18n-server.ts](../../../src/lib/i18n-server.ts));
   and the market evidence ([research §1](research.md)) says unsolicited per-event email destroys
   trust (Settle Up) while user-initiated reminders and digests retain it (Splitwise).

## 2. Goals / non-goals

**Goals**
- G1. In-app notifications: header bell + unread count, "new activity" dot per group card —
  shippable **alone**, zero external dependencies.
- G2. Email via Resend + react-email, **digest-by-default**: immediate email for exactly
  *added-to-group* and *user-initiated settle reminders*; everything else batched into a daily
  (default) or weekly digest. No other immediate email types may be added without amending this RFC.
- G3. Bilingual email (BG/EN) rendered from the **recipient's** stored locale.
- G4. User-initiated settle reminders ("напомни") — creditor→debtor, rate-limited, mutable.
- G5. Notification preferences (per-type × per-channel) as a section of RFC 06's account settings,
  with one-click unsubscribe and a global `unsubscribed_at` kill-switch.
- G6. The same `notifications` rows later drive web push behind a flag once RFC 05's service-worker
  foundation lands.
- G7. **Never email anyone who is not a signed-in member of the group the event belongs to.**
  Virtual members (no account) never generate outbound mail to anyone on their "behalf".

**Non-goals**
- Service-worker/push plumbing, manifest, VAPID key management → **RFC 05** (this RFC only defines
  triggers + payload source).
- Creating the account-settings screen → **RFC 06** (this RFC specifies the notifications section
  inside it).
- Marketing/broadcast/announcement email — **out entirely**, no schema or code path for it.
- Viber/SMS channels (Viber-first *sharing* is topic 10; a Viber bot/business account is neither
  free nor in scope).
- Realtime in-app delivery (websockets/SSE) — badge freshness on navigation/refresh is enough at
  this scale.

## 3. Design

### 3.1 (a) Event source: derive from the `logActivity` call sites — no new event system

A new table, deliberately shaped like `activity_log`'s denormalized style
([src/db/schema.ts:149-159](../../../src/db/schema.ts)):

```ts
// Per-recipient notification, written by the same server actions that write
// activity_log. Snapshots (actorName, details) are denormalized so rows stay
// renderable after the expense/person they reference is deleted.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // recipient
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    type: text("type").notNull(),            // see mapping table below
    refId: uuid("ref_id"),                    // expense/invite/scan id, no FK (survives deletion)
    actorName: text("actor_name").notNull(),  // snapshot, like activity_log
    details: jsonb("details").$type<Record<string, unknown>>().notNull(), // description, amountCents, currency, fromName/toName…
    readAt: timestamp("read_at"),
    emailedAt: timestamp("emailed_at"),       // set when sent immediately OR included in a digest
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("notifications_user_unread_idx").on(t.userId, t.readAt),
          index("notifications_user_email_idx").on(t.userId, t.emailedAt)]
);
```

A helper `notifyUsers(db, recipientUserIds, { groupId, type, refId, actor, details })` lives next to
`logActivity` in [src/lib/action-helpers.ts](../../../src/lib/action-helpers.ts) with the **same
swallow-errors contract** (a notification failure must never fail the action; Neon HTTP has no
transactions anyway — [audit §10.2](../00-current-state-audit.md)). It always excludes the actor
(`recipientUserIds.filter(id => id !== actor.id)`) and inserts one row per recipient.

**Recipients are computed in the action, not from the log row** (the jsonb lacks participant ids —
research §4). The data is already in scope at every call site:

| Notification `type` | Trigger (call site) | Recipients |
|---|---|---|
| `group.added_you` | `addCircleMember` ([actions.ts:442-470](../../../src/app/actions.ts)) | the added user |
| `expense.involves_you` | `saveExpense` insert path ([actions.ts:682](../../../src/app/actions.ts)) | real users behind payer/share aliases: map `input.payers[].aliasId` ∪ `split.shares[].aliasId` through `groupAliases` (already loaded, has `userId`) |
| `expense.updated` / `expense.deleted` | update path ([actions.ts:673](../../../src/app/actions.ts)), `deleteExpense` ([actions.ts:848](../../../src/app/actions.ts)) | union of old + new participants' users |
| `payment.received` / `payment.updated` / `payment.deleted` | `saveSettlement` ([actions.ts:795-798](../../../src/app/actions.ts)), `deleteExpense` settlement branch | the *counterparty* user (payer alias's user for received) |
| `member.joined` / `member.left` / `member.removed` / `alias.attached` | respective call sites | group owner (+ the removed/attached user where applicable) |
| `settle.reminder` | new action, §3.4 | the debtor user |
| `receipt.converted` | [receipt-actions.ts:346](../../../src/app/receipt-actions.ts) | folded into `expense.involves_you` semantics (participants of the created expense) — no separate type |

Deliberately **not** notified: group renames/currency/simplify toggles, alias renames, invite
create/revoke, `receipt.scanned` drafts — they remain visible in the activity log; notifying them is
noise. Membership stays derivable from `groupMembers` + implicit owner
(`groups.userId` — [schema.ts:65-79](../../../src/db/schema.ts)).

**Retention:** delete rows older than ~90 days in the daily cron (the bell is a recency surface, not
an archive; `activity_log` remains the archive).

### 3.2 (b) In-app layer — ships first, alone

- **Header bell** in `AppHeader`: server-computed unread count
  (`count(*) where userId = me and readAt is null`, capped display "9+"). Clicking opens a dropdown/
  modal (reuse [Modal.tsx](../../../src/components/Modal.tsx) bottom-sheet behavior) listing the
  latest ~30 notifications rendered exactly like `ActivityModal.describe`
  ([src/components/ActivityModal.tsx:12-74](../../../src/components/ActivityModal.tsx)) — new i18n
  keys per type, EN + BG, **rendered from typed `details` at display time** (do NOT repeat the
  audit-log mistake of persisting English prose — [audit §1.9](../00-current-state-audit.md)). Each
  row links to its group; opening the panel marks listed rows read (`markNotificationsRead` action).
- **Per-group "new since last visit" dot** on dashboard group cards: a tiny watermark table
  `group_reads(userId, groupId, lastSeenAt, pk(userId, groupId))`, upserted whenever the user loads
  `groups/[id]`. The dashboard query ([src/app/page.tsx](../../../src/app/page.tsx)) additionally
  fetches `max(activity_log.createdAt)` per group and compares. This intentionally uses
  `activity_log`, not `notifications`, so *any* group activity (including events that don't target
  me) lights the dot — complementary signals, two cheap queries.
- No toast system, no realtime — out of scope.

### 3.3 (c) Email layer: Resend + react-email, digest by default

**Dependencies:** `resend`, `@react-email/components` — a conscious break from the 5-dependency
diet; justified because hand-writing cross-client HTML email is exactly the wheel these exist for.

**Recipient locale — the cookie gap.** `getT()` reads the *request's* cookie
([i18n-server.ts:5-14](../../../src/lib/i18n-server.ts)); when user A's action emails user B, or the
cron emails everyone, B's locale is unknowable from cookies. Design:
- Add `locale: text("locale").notNull().default("en")` to `users`.
- Capture it (i) in the `jwt`/`signIn` upsert in [src/auth.ts](../../../src/auth.ts) from the
  `locale` cookie present on the sign-in request, and (ii) on every locale toggle while signed in —
  extend the existing cookie-setting action (`locale-actions.ts`) to also `update users set locale`
  when a session exists. The cookie stays authoritative for the *UI*; the column is for email only.
- Emails render with `makeT(recipient.locale)` ([i18n.ts](../../../src/lib/i18n.ts)) — subject,
  preheader, body, and footer all localized; money via `formatCents`, dates via
  `formatDate(date, locale)`.

**Sending policy (the anti-Settle-Up core):**
- **Immediate** (sent inline from the server action, fire-and-forget `after()`/void promise, never
  blocking the response): `group.added_you`, `settle.reminder`. Nothing else. Both set `emailedAt`
  on their notification row.
- **Digest** (everything else): the daily cron collects, per user, all rows with
  `emailedAt is null and createdAt > now() - interval '14 days'` (window cap so an ancient backlog
  can't dump), groups them by group, renders one "Какво се случи" email — new expenses involving
  you, edits, payments, plus each group's *current* net balance line pulled live — and stamps
  `emailedAt` on every included row. **Empty digest ⇒ no email.** Catch-up semantics: a missed cron
  day heals on the next run (research §5).
- **Weekly option**: same run, gated on `date.getDay() === 1` for users whose pref is weekly.
- **Fan-out within limits**: process users ordered by oldest pending row; stop at ~90 sends/day
  (Resend free caps 100/day — leave headroom for immediates) and let the remainder roll to
  tomorrow. Log the deferral count. On Vercel Pro (mandatory once the app charges —
  [topic 09](../09-monetization/research.md)) raise/remove the cap and optionally split digest into
  its own cron slot; until then it runs as step 3 of the existing
  [/api/cron/daily/route.ts](../../../src/app/api/cron/daily/route.ts) after rates + invite expiry.
  If sub-daily batching is ever wanted pre-Pro, use Upstash QStash free (1k msgs/day) as the
  scheduler rather than more crons — noted, not planned.
- **Templates** (react-email, in `src/emails/`): `AddedToGroup`, `SettleReminder`, `Digest` — shared
  layout, plain-text part auto-generated, hidden preheader div, footer with preferences link +
  one-click unsubscribe (§3.5). Cyrillic subjects are plain UTF-8 (research §2). From:
  `Money Assistant <notify@mail.<domain>>` — dedicated subdomain, SPF/DKIM via Resend domain
  verification, DMARC `p=none` minimum at launch. Send failures: log + leave `emailedAt` null
  (digest will retry); never surface to the acting user.
- **Guard rails asserted in `sendEmail()` helper**: recipient must have a `users` row, be a current
  member (or owner) of `groupId`, have no `unsubscribedAt`, and not have the category muted —
  checked at send time, not enqueue time, so a preference change between event and digest is
  honored.

### 3.4 (d) User-initiated settle reminders — "напомни"

- UI: a small "Напомни" button on each debt row in
  [BalancesPanel.tsx](../../../src/components/BalancesPanel.tsx), shown only when (i) the signed-in
  user **is the creditor** of that row (their alias is the `to` side), and (ii) the debtor alias is
  **attached to a real user** (`aliases.userId != null`). For virtual debtors the button is absent —
  there is nobody to remind (G7).
- New server action `sendSettleReminder(groupId, debtorAliasId)`:
  1. `requireRole(db, groupId, user.id, "member")`; recompute the debt server-side from
     `loadGroupData`-equivalent math — refuse if no debt from debtor→creditor actually exists
     (client amounts are never trusted).
  2. **Rate limit** via the notifications table itself: refuse if a `settle.reminder` row from this
     creditor to this debtor in this group exists with `createdAt > now() - 7 days` (localized
     error: "Вече напомни наскоро"). No new infrastructure.
  3. Insert the notification row (in-app), send the immediate email (subject ~"Георги ти напомня за
     {group}", body: amount owed to the creditor in group currency, deep link to the group, neutral
     wording — no "overdue", no red), write `activity_log` action `reminder.sent` so the act is
     visible in the group's audit trail.
- **Recipient control**: the reminder email's unsubscribe link mutes the `settle.reminder` email
  category for that user (one click, no login, §3.5); the in-app row still appears. Muted recipient
  ⇒ the send is skipped silently (the creditor still sees "напомнянето е изпратено" — do not leak
  another user's preferences).

### 3.5 (e) Preferences — a section in RFC 06's account settings

Storage on `users` (no new table needed at this cardinality):

```ts
locale: text("locale").notNull().default("en"),
notifyPrefs: jsonb("notify_prefs").$type<NotifyPrefs>().notNull().default({}),
unsubscribedAt: timestamp("unsubscribed_at"),          // global email kill-switch
unsubscribeToken: text("unsubscribe_token").notNull(), // random, per-user, rotatable
```

`NotifyPrefs` (typed in [src/lib/types.ts](../../../src/lib/types.ts)):
`{ digest?: "daily" | "weekly" | "off"; emailAddedToGroup?: boolean; emailReminders?: boolean; pushEnabled?: boolean }`
— defaults (applied in code, not stored): digest `daily`, both immediates `true`, push `false`.

- **UI** (inside RFC 06's settings screen; if this RFC ships first, a minimal standalone
  `/settings/notifications` page is acceptable and RFC 06 absorbs it): rows per type with channel
  toggles; email column disabled entirely (with explanation) when `unsubscribedAt` is set, plus a
  "Получавай имейли отново" re-enable that clears it. In-app column is informational-only (always
  on — it is the product UI, not a communication).
- **Unsubscribe endpoint** `GET/POST /api/email/unsubscribe?token=<unsubscribeToken>&cat=<category|all>`:
  no auth required (the token is the auth), idempotent, sets the category pref to false or
  `unsubscribedAt` for `all`, renders a localized confirmation page with a re-subscribe link. Every
  outgoing email carries `List-Unsubscribe: <https://…/api/email/unsubscribe?…>` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058, Gmail/Yahoo requirement —
  research §2) and a visible footer link. Digest's unsubscribe targets `digest=off`; the footer also
  links "всички настройки".

### 3.6 (f) Web push — later, flag-gated, riding on RFC 05

- Once RFC 05 lands the service worker + manifest, add `push_subscriptions(userId, endpoint pk,
  p256dh, auth, userAgent, createdAt)`; a `NEXT_PUBLIC_PUSH_ENABLED` env flag gates the whole
  feature. Permission is requested only from an explicit toggle in the preferences section (never on
  load — research §3), which also flips `notifyPrefs.pushEnabled`.
- **Triggers reuse this RFC's rows**: in `notifyUsers`, after the insert, if the flag is on and the
  recipient has subscriptions + `pushEnabled`, send a push with the same localized string the bell
  would show (title = group name, body = describe(type, details), deep link URL). No new event
  source, no separate payload pipeline. Delete subscriptions on 404/410 responses.
- iOS reality (research §3): push reaches only installed-PWA users; the bell and digest remain the
  guaranteed paths. Do not build engagement flows that assume push delivery.

## 4. Implementation plan (ordered, independently shippable)

| Stage | Contents | Touches | Ships alone? |
|---|---|---|---|
| 1 | `notifications` + `group_reads` tables, `notifyUsers` helper, recipient computation at the §3.1 call sites | `schema.ts`, `drizzle/`, `action-helpers.ts`, `actions.ts`, `receipt-actions.ts` | yes (invisible) |
| 2 | Bell + unread count + panel + mark-read; dashboard "new activity" dot | `AppHeader.tsx`, new `NotificationsPanel.tsx`, `page.tsx`, `groups/[id]/page.tsx`, `actions.ts`, `i18n.ts` | **yes — the first user-visible win** |
| 3 | `users.locale` capture, `notifyPrefs`/`unsubscribedAt`/`unsubscribeToken` columns, minimal prefs UI (or RFC 06 section) | `schema.ts`, `auth.ts`, `locale-actions.ts`, settings screen | yes |
| 4 | Resend + react-email setup, DNS (subdomain SPF/DKIM/DMARC), `sendEmail()` guard-rail helper, immediate `group.added_you`, unsubscribe endpoint + headers | `package.json`, `src/emails/`, `src/lib/email.ts`, `api/email/unsubscribe/`, `.env.example` (`RESEND_API_KEY`, `EMAIL_FROM`) | yes |
| 5 | Daily/weekly digest in the existing cron (fan-out, 90/day cap, catch-up, empty-skip), notification-row retention cleanup | `api/cron/daily/route.ts`, `src/emails/Digest.tsx` | yes |
| 6 | "Напомни" button + `sendSettleReminder` (rate limit, mute honoring, activity-log entry) | `BalancesPanel.tsx`, `actions.ts`, `src/emails/SettleReminder.tsx`, `i18n.ts` | yes (needs 4) |
| 7 | Push: subscriptions table, opt-in toggle, `notifyUsers` push hook — **after RFC 05**, flag-gated | `schema.ts`, `action-helpers.ts`, prefs UI, SW (RFC 05's) | yes (flagged) |

Stages 1–2 are the recommended first shipment (pure in-app, no deps, no policy risk). 3–5 form the
email layer; 6 is the headline BG-market feature; 7 trails RFC 05.

## 5. Acceptance criteria

- **In-app:** acting user never sees their own action in the bell; a participant of a new expense
  sees exactly one unread row; opening the panel zeroes the count; a group where *someone else's*
  non-involving expense was added shows the dashboard dot but no bell row; virtual-member-only
  expenses produce zero notification rows.
- **Policy:** grep-level guarantee that the only `sendEmail` call sites with immediate semantics are
  `group.added_you` and `settle.reminder`; every other type reaches email exclusively through the
  digest query.
- **Digest:** running the cron twice in a row sends nothing the second time (`emailedAt`
  idempotency); a user with no un-emailed rows gets no email; a user with prefs `digest: "off"` or
  `unsubscribedAt` gets none regardless of pending rows; >90 pending recipients defers the excess
  without loss; the email renders fully in Bulgarian (subject included) for a `locale='bg'`
  recipient even when the cron request itself has no cookies.
- **Reminders:** a debtor-side or uninvolved member sees no "Напомни" button; a second reminder to
  the same person in the same group within 7 days is refused with a localized error; a muted
  recipient silently receives no email but does receive the in-app row; a reminder about a virtual
  member is impossible (button absent, action rejects `aliases.userId = null`).
- **Never-email-uninvolved:** attempting to send to a user who has left the group (detached alias,
  no `group_members` row, not owner) is blocked by the `sendEmail` guard; account deletion (topic
  08) cascades `notifications` and stops all sends.
- **Unsubscribe:** the link from a received email works without login, is one-click (POST honored
  per RFC 8058), takes effect on the very next send, and the headers are present on every outgoing
  message.
- **Locale capture:** signing in with a `bg` cookie stores `locale='bg'`; toggling the header
  switch while signed in updates the column; existing users default to `en` until their next visit.
- Existing suites still pass (`npm run test:math`, `scripts/receipt.test.ts`,
  `scripts/receipt-db.test.ts`, `scripts/db-smoke.ts`); new tests cover recipient computation
  (payers ∪ shares minus actor, virtual filtering), digest idempotency + window cap, and the
  reminder rate limit (PGlite, same pattern as `receipt-db.test.ts`).

## 6. Risks & alternatives considered

- **Spam-feel / reputational (the #1 product risk).** Mitigated structurally: digest-by-default,
  two immediate types only, user-initiated reminders with rate limit + mute, no marketing category
  in the schema at all. Settle Up's review record ([research §1](research.md)) is the counterfactual.
- **Deliverability.** New domain + Cyrillic content on a shared IP: keep the subdomain
  transactional-only, DMARC from day one, monitor Resend's bounce/complaint dashboard weekly at
  launch; complaint rate must stay ≪0.3% (Gmail/Yahoo threshold). Volume is tiny, so warm-up is
  organic.
- **Resend 100/day free cap.** Digest deferral (§3.3) degrades gracefully; the cap is monitored via
  the deferral log line. Cost path: Resend Pro $20 at ~1k MAU, aligned with the monetization
  timeline (topic 09).
- **Deriving notifications from `activity_log` rows instead of a new table** — rejected: log rows
  lack recipient targeting (details jsonb has no participant ids), have no per-user read/emailed
  state, and their `details.changes` fragments are English prose frozen at write time — exactly the
  localization mistake this RFC must not inherit.
- **A generic outbox/event-bus** (QStash queue per event, or a `webhooks`-style dispatcher) —
  rejected as over-engineering: two immediate types and one daily batch need no queue; the
  notifications table *is* the outbox (`emailedAt` null = pending). QStash stays the documented
  escape hatch for sub-daily needs on Hobby.
- **No transactions** (Neon HTTP driver): a crash between `logActivity` and `notifyUsers` can drop
  notifications for an action that succeeded. Accepted — notifications are best-effort by contract
  (same as the existing logging), and the digest's live balance line self-corrects the picture.
- **Emailing the group owner about virtual members' debts** — considered for "обща каса" trips where
  half the group is virtual; rejected on GDPR and social grounds ([research §6](research.md)): the
  owner already sees those balances in-app, and robot debt-mail about third parties is the exact
  anti-pattern this design exists to avoid.
- **Web push as the primary channel** — rejected: single-digit web opt-in and iOS installed-PWA-only
  reach (research §3) make it a complement; sequencing it last costs nothing since it reuses the
  same rows.
