# Topic 07 — Notifications & Engagement: Research

> Part of the [Bulgarian market improvement guide](../README.md).
> Research date: **2026-08-24**. Companion implementation plan: [rfc.md](rfc.md).
> Current state: [00-current-state-audit.md §7](../00-current-state-audit.md) — **the app has zero
> notification infrastructure**: no email, no push, no in-app badges; the only outbound channel is
> a manually copied invite link. The activity log ([audit §1.9](../00-current-state-audit.md)) is
> pull-only. Unverified claims flagged ⚠️.

---

## 1. What retains users vs what annoys them

Expense splitting is a **weekly-use utility at best** (a trip, a flatshare month, a dinner). The
retention problem is not "bring them back daily" — it is (a) *the group must trust the ledger is
current*, and (b) *debts must eventually get settled*. Notification design follows from that split.

### Prior art — Splitwise
- Splitwise's notification settings distinguish **Groups and Friends** (someone adds you to a group /
  friends you), **Expenses** (added / edited / deleted / commented, someone pays you), and **News and
  Updates** (marketing), each individually toggleable per channel (push envelope / email).
- **Per-expense email is OFF by default** — Splitwise's own stated reason: "to avoid having people
  feel like they are being spammed by the system." Push for "someone added a bill with you" is on by
  default; tapping it deep-links to the group.
- **Settle-up reminders are user-initiated**: a "Send reminder" button on the friend page emails that
  friend their balance. Automatic *scheduled* debt reminders do not exist; years-old feedback threads
  requesting them remain open. The only automatic recurring email is a **monthly summary of all
  balances** to the account holder themself.
- Pattern to copy: **automatic messages go to *me about my own money*; messages *to my friends about
  their debt* only happen when I explicitly press a button.**

### Prior art — Tricount
- Real-time **push** (optional) when an expense is added or edited, with the amount in the
  notification body, deep-linking to the expense. Positioned as a transparency feature ("everyone
  stays in the loop"), not a re-engagement lever. No unsolicited emails to group members.

### Cautionary tale — Settle Up
- Per [topic 10 §1](../10-growth-marketing/research.md): Settle Up's review pain points include
  **unsolicited "settle up" emails to friends**, alongside un-closeable ads — both read as the app
  spamming people who never chose it. ⚠️ The email complaints are sourced from the review aggregation
  cited in topic 10 (justuseapp.com); the page now blocks re-verification (HTTP 403), so treat the
  specific wording as second-hand — but the design lesson stands independently: **a person who was
  added to a group by a friend has a *social* relationship with the friend, not with the app.** An
  automatic "you owe X" email from a robot, about money, to someone who never signed up for emails,
  converts a friendly ledger into a debt collector. One-star reviews follow.

### What the evidence supports (synthesis)
| Notification | Verdict |
|---|---|
| **Added to a group** (by someone else's action) | High value, expected, send immediately — it is the invitation itself. |
| **Expense added involving you** | High value **in-app/push**; as *email* it is spam at any frequency above digest. Splitwise defaults it off for email. |
| **Expense edited/deleted involving you** | Trust-critical (someone changed money you owe) — in-app always; email only inside a digest. |
| **Someone paid you / marked settled** | Pleasant, low frequency — in-app + digest. |
| **Automatic "you owe N" reminders** | The Settle Up trap. Never automatic. |
| **User-initiated reminder** ("remind Georgi") | The socially correct version: the *creditor* presses the button, the app is only the messenger, the recipient can mute. Splitwise's model. Must be rate-limited. |
| **Weekly/monthly digest** | The workhorse for a weekly-use app: one email summarizing *your* groups' activity and *your* balances. Splitwise sends monthly. Skip when empty. |
| **Streaks / re-engagement / "we miss you"** | Marketing, not service. Out (see §6 and topic 10's trust findings). |

## 2. Email infrastructure for Next.js/Vercel in 2026

### Resend — the fit for this stack
- **Free: 3,000 emails/month, hard-capped at 100/day**, 1 verified domain; sending *pauses* at the
  cap (no overage billing). Pro $20/month = 50k emails. Matches the cost model already in
  [topic 09 §4](../09-monetization/research.md) (~2 emails/MAU/month → free tier covers ~1,000 MAU).
- **react-email** (JSX → deliverable HTML) is Resend's template layer, free on every tier, and fits
  this codebase (React 19, no template engine). Note: it adds 2 runtime dependencies to a deliberately
  5-dependency app — a real decision, flagged in the [RFC](rfc.md).
- The 100/**day** cap, not just the monthly cap, is the binding constraint: a digest to >100
  recipients must spill to the next day or the tier must be upgraded.
- ⚠️ Resend advertises GDPR compliance/DPA; verify the DPA + SCC status and sending-infrastructure
  region before launch and add Resend to the processor list in
  [topic 08](../08-privacy-gdpr/research.md).

### Deliverability for a brand-new domain
Since February 2024 Gmail and Yahoo enforce sender requirements (formally on 5k+/day "bulk senders",
in practice the compliance bar for everyone):
- **SPF + DKIM + DMARC** (minimum `p=none`) on the sending domain — Resend provisions the DNS records
  on domain verification; DMARC is yours to add.
- **One-click unsubscribe** (RFC 8058: `List-Unsubscribe` HTTPS URL + `List-Unsubscribe-Post`
  headers) on anything non-transactional, honored within 2 days.
- **Spam-complaint rate < 0.3%** (Google's guidance: stay under 0.1%). For a transactional-only
  sender this is easily met — *unless* you send Settle-Up-style unsolicited debt mail, which is
  precisely the complaint generator.
- Practice: send from a **subdomain** (e.g. `mail.` or `notify.`), keep it transactional-only so its
  reputation is never diluted by marketing, and warm up gradually — at this app's volumes (tens/day)
  warm-up is a non-issue; volume grows organically with users.

### Bulgarian-language email rendering
- **Cyrillic subjects/bodies are a solved problem in 2026** — UTF-8 everywhere; providers handle
  RFC 2047 subject encoding transparently. No special work needed.
- What still matters: keep subjects ~30–50 chars (mobile truncation of Cyrillic is same as Latin);
  set an explicit **preheader** (hidden preview `<div>` first in the body) so clients don't preview
  raw template text; avoid ALL-CAPS/emoji-heavy subjects (spam heuristics); localize *both* subject
  and body from the **recipient's** stored locale — not the actor's request cookie (see the
  server-side locale gap in the [RFC §3.3](rfc.md)).

## 3. Web push on the open web, 2026

- **Mechanics**: service worker + `PushManager.subscribe()` with a **VAPID** application-server key
  → per-browser subscription endpoint → server sends encrypted payloads (RFC 8291/8292) to that
  endpoint → SW `push` event shows the notification. Requires the SW foundation that
  RFC 05 (PWA topic) owns; **this topic only defines the triggers and reuses its plumbing**.
- **iOS constraint** (per topic 05 / [audit §4](../00-current-state-audit.md)): Safari supports web
  push **only for PWAs added to the Home Screen** (iOS 16.4+, March 2023), permission promptable only
  after a user gesture. Safari 18.4 added **Declarative Web Push** (no-SW variant) but the
  installed-only constraint stands. Since the app currently has no manifest/SW/icons, iOS push is
  gated behind RFC 05 shipping *and* the user installing.
- **Realistic opt-in**: industry averages for *web* push run **~5–10% of unique visitors** (≈6%
  typical; long-term steady state ~5% e-commerce, 6–8% media), vs ~68% for native app push
  (~91% Android / ~44% iOS). ~75% of web-push subscribers subscribe on mobile browsers.
- **Assessment for a weekly-use utility**: push is a *complement*, not the backbone — expect a
  single-digit-percent subscriber base on the open web plus whatever fraction installs the PWA.
  The right uses are exactly Tricount's: "expense added involving you", "you were added", "Georgi
  sent you a reminder" — real-time transparency for already-engaged users. Retention for everyone
  else must come from email digests (§2) and in-app signals (§4). Never prompt for permission on
  page load; ask after a moment of value (e.g. right after joining a group), which is also what
  keeps opt-in rates at the top of the range.

## 4. In-app notification patterns — the cheap wins

The app already has the event stream: **every mutation writes `activity_log`**
(`src/db/schema.ts:149-159`, written via `logActivity` in `src/lib/action-helpers.ts:50-68` from
~22 call sites in `src/app/actions.ts` and `receipt-actions.ts`). Two standard patterns sit almost
free on top of it:

1. **Unread badge (header bell)** — a per-user notification feed with `read_at`, surfaced as a
   count. Needs a real `notifications` table rather than querying `activity_log` directly, because
   (a) a log row doesn't identify *who is affected* — `expense.added` details store only
   description/amount/currency/date (`actions.ts:682-687`), participant alias ids are **not** in the
   jsonb, so recipients must be computed in the same server action where `input.payers`/`split.shares`
   are in scope; and (b) read-state is per-user.
2. **"New since last visit" watermark per group** — store `last_seen_at` per (user, group), compare
   against `max(activity_log.created_at)` per group on the dashboard; render a dot on the group card.
   No fan-out rows at all; one grouped query. This catches *all* group activity (including events
   that don't target you personally) and is the cheapest possible "something happened here" signal.

Both work offline-free, cost nothing external, ship without email/push, and give the retention
baseline: a user who opens the app sees immediately whether anything needs their attention.
(Related dashboard gap already noted in [audit §1.1](../00-current-state-audit.md): no recent-activity
preview on group cards.)

## 5. Scheduling constraints on Vercel Hobby

- **Hobby: 2 cron jobs/project, each at most once per day**; timing is best-effort (can fire late).
  Pro ($20/seat): 40 crons, any frequency ([topic 09 §4](../09-monetization/research.md)). The app
  currently uses **one** slot: `vercel.json` → `GET /api/cron/daily` at 06:00 UTC (= 08:00/09:00
  Sofia), doing FX refresh + invite expiry (`src/app/api/cron/daily/route.ts`).
- Consequences for notifications on Hobby:
  - **Daily digest**: piggyback on the existing daily cron — one fan-out pass at a fixed morning
    hour is exactly what a digest wants. Weekly digests are the same run gated on the weekday.
    Timezone nuance is moot: the user base is one timezone (Sofia).
  - **Anything sub-daily** (e.g. "batch expense emails within 15 minutes") is impossible on Hobby
    crons. Options: (a) don't — the digest-by-default policy (see [rfc.md](rfc.md)) makes sub-daily
    batching unnecessary; immediate-class emails are sent inline from the triggering server action;
    (b) **Upstash QStash free tier — 1,000 messages/day, 10 schedules,** then $1/100k — gives
    delayed/queued HTTP calls and retries without a server; (c) Vercel Pro, which
    [topic 09](../09-monetization/research.md) mandates the moment the app charges money anyway.
  - **Idempotency over reliability**: Hobby crons are fire-and-forget with no alerting
    ([audit §9](../00-current-state-audit.md)); a digest run must therefore be a catch-up ("send
    everything not yet emailed"), not a "send yesterday's window", so a missed day heals itself.

## 6. GDPR / ePrivacy for notifications

- **Transactional vs marketing is the load-bearing distinction.** Service messages necessary in the
  context the user signed up for (you were added to a group; a summary of activity in *your* groups;
  a reminder your friend explicitly triggered) rest on **contract necessity / legitimate interest —
  no prior consent needed**. Promotional content (upsells, feature marketing, "come back!" mail)
  requires **opt-in consent** under the ePrivacy Directive + GDPR, full stop. Mixing promotion into a
  service email forfeits the transactional exemption — keep them strictly factual.
- **Unsubscribe**: legally required for marketing; best practice (and Gmail/Yahoo-enforced, §2) for
  *everything non-essential* — i.e. every notification email except perhaps security/account mail.
  One-click (RFC 8058 headers + a no-login unsubscribe URL), effective within 2 days. Since this app
  should send **no marketing at all**, the practical rule is: every email carries one-click
  unsubscribe for its category, and a global "no email ever" switch is honored server-side before any
  send (`unsubscribed_at`).
- **Preferences as a data-subject surface**: a notification-preferences screen is simultaneously the
  UX feature and the Art. 21 objection mechanism — per-type, per-channel toggles double as granular
  opt-out, which is the regulator-friendly posture. It belongs on the account-settings screen that
  RFC 06 introduces ([audit §1.10](../00-current-state-audit.md): no such screen exists today).
- **Virtual members**: they have **no account and no email address** — only a name typed by the group
  owner (`aliases.userId = null`). The app must never contact anyone *about* a virtual member's debt
  except real members inside their own group context, and must never treat the owner as the virtual
  member's proxy inbox for reminders ("email the owner because Georgi-the-alias owes money" is an
  unsolicited debt email about a third party — double GDPR trouble: processing a non-user's data to
  nag a user). Rule: **email real, signed-in members about their own involvement only.** A virtual
  member's debts appear in other members' digests as ordinary balance lines, nothing more.
- Group emails inevitably contain **other members' personal data** (names, amounts) — fine within the
  group context the members joined, but it reinforces: never email anyone who is not (or no longer) a
  member of that group, and stop all sends on account deletion (topic 08's erasure work).
- Consent/processor hygiene: adding an email provider adds a **processor** — update the privacy
  policy ([topic 08](../08-privacy-gdpr/research.md)) with Resend, purpose, and retention of email
  logs (Resend free keeps logs 30 days ⚠️ retention configurable — verify on setup).
- **Web push has its own consent moment**: the browser permission prompt *is* the consent record for
  the channel; still honor the same per-type preferences, and treat subscription endpoints as
  personal data (deletable, per-device).

## Implications for the app

1. **In-app first** — a `notifications` table fed by the same server actions that call
   `logActivity`, a header bell with unread count, and a per-group "new since last visit" dot. Zero
   external dependencies, ships alone, fixes the "is anything new?" gap today.
2. **Digest-by-default email policy (the anti-Settle-Up stance)**: immediate email for exactly two
   things — *you were added to a group* and *a user pressed the reminder button*. Everything else
   batches into a daily (default) or weekly digest of the recipient's own groups. No marketing email
   category exists at all.
3. **Reminders are user-initiated only** ("напомни" on a debt row), creditor→debtor, rate-limited,
   mutable by the recipient — Splitwise's socially-correct model, the exact opposite of Settle Up's.
4. **Resend free tier + react-email** fits budget and stack; respect the 100/day cap in the digest
   fan-out; SPF/DKIM/DMARC on a dedicated subdomain from day one; transactional-only reputation.
5. **Recipient locale must be stored** (`users.locale` captured at login/toggle) — the request
   cookie can't localize email for *other* users; Cyrillic subjects are otherwise a non-issue.
6. **One daily cron slot is enough** for the digest given policy #2; QStash free tier is the
   pressure valve if sub-daily scheduling is ever needed before Vercel Pro.
7. **Web push waits for RFC 05's service-worker foundation** and reuses the same notifications
   table as triggers; expect single-digit opt-in on the open web and installed-PWA-only on iOS —
   plan it as a complement, never the backbone.
8. **Preferences screen = compliance surface**: per-type/per-channel toggles + one-click
   unsubscribe + `unsubscribed_at` kill-switch, living in RFC 06's account settings.

## Sources

<details><summary>Full source list (URLs)</summary>

**Prior art:** https://www.hardreset.info/devices/apps/apps-splitwise/change-email-notifications/ · https://blog.splitwise.com/2014/03/31/splitwise-notifications-now-on-steroids/ · https://feedback.splitwise.com/forums/162446-general/suggestions/6697481-change-the-way-you-notify-users-of-new-expenses · https://feedback.splitwise.com/forums/162446-general/suggestions/18524023-make-a-button-to-notify-people-about-how-much-they · https://feedback.splitwise.com/forums/162446-general/suggestions/8719948-payment-reminder · https://money.com/getting-friends-to-repay-debts/ · https://tricount.com/en-us/expense-tracker-features · https://help.tricount.com/articles/tricount-faqs · https://justuseapp.com/en/app/737534985/settle-up-group-expenses/reviews (⚠️ 403 on re-check; via topic 10)
**Email infra:** https://www.stackscored.com/pricing/transactional-email/resend/ · https://automationatlas.io/answers/resend-pricing-explained-2026/ · https://wpmailsmtp.com/resend-review/ · https://resend.com/blog/gmail-and-yahoo-bulk-sending-requirements-for-2024 · https://www.mailgun.com/state-of-email-deliverability/chapter/yahoogle-bulk-senders/ · https://dmarcian.com/yahoo-and-google-dmarc-required/ · https://emailwarmup.com/blog/email-deliverability/gmail-and-yahoo-bulk-sender-requirements/
**Web push:** https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications · https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide · https://dev.to/arshtechpro/wwdc-2025-declarative-web-push-dn4 · https://www.mobiloud.com/blog/progressive-web-apps-ios · https://gravitec.net/blog/15-must-know-web-push-notification-statistics/ · https://www.mobiloud.com/blog/push-notification-statistics · https://www.businessofapps.com/marketplace/push-notifications/research/push-notifications-statistics/
**Scheduling:** https://upstash.com/pricing/qstash · https://vercel.com/docs/limits · https://crontap.com/blog/vercel-cron-hourly-limit-and-how-to-beat-it (via topic 09)
**GDPR/ePrivacy:** https://www.socketlabs.com/blog/transactional-email-gdpr/ · https://www.termsfeed.com/blog/gdpr-transactional-emails/ · https://sendcheckit.com/blog/gdpr-email-compliance-guide · https://dreamlit.ai/blog/transactional-vs-marketing-email

</details>

**Key unverified items (⚠️):** Settle Up email-complaint review texts (source now 403s); Resend DPA/SCC + log-retention details; exact current Splitwise default-on/off matrix per channel (help-center pages are behind app UI).
