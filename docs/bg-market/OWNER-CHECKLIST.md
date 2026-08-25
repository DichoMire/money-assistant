# Owner checklist — what only you can do

> Written 2026-08-26 at the end of the release-prep implementation run (see
> [IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md) § release-prep batch). Every
> item below is either an external account, a dashboard setting, an on-device
> test, or a business decision — the code side is already built and waiting
> behind env vars. Ordered roughly by "needed before public exposure".

## 1. Deploy correctly (first deploy of this branch)

- [ ] **Apply migrations 0008–0013 to Neon.** `npm run db:push` syncs the
      schema but NEVER runs data statements. Two of the new migrations carry
      data backfills (0009: scrubs emails out of activity-log jsonb; 0012:
      backfills `email_verified`). Apply each new file once, in order:
      `psql "$DATABASE_URL" -f drizzle/0008_reliability.sql` … through
      `0013_signup-ref.sql`. (Local PGlite applies them automatically.)
- [ ] Run `npx tsx scripts/purge-receipt-images.ts` (dry-run), then with
      `--yes` against Neon — deletes photos of already-converted scans per the
      new retention policy.
- [ ] **Set `CRON_SECRET`** in Vercel env — production cron now refuses to
      run without it (fail-closed).
- [ ] Set `NEXT_PUBLIC_CONTACT_EMAIL` (shown as controller contact on
      /privacy) and `APP_URL` if the domain isn't the Vercel default.

## 2. Before anyone outside the friend group uploads receipts (launch blocker)

- [ ] **Switch the receipt LLM off `:free` endpoints** — env-only, recipe at
      the top of `.env.example` (fund OpenRouter → disable train-on-inputs →
      `OPENROUTER_MODEL=google/gemini-2.5-flash-lite` or re-verified current
      tier → paid fallbacks → `OPENROUTER_ZDR=true`).
- [ ] Collect ~30 real receipt fixtures into `scripts/receipt-fixtures/`
      (gitignored) and run `npm run eval:receipts` to baseline the model
      before/after the switch (target: recall ≥ 0.90, reconcile ≥ 0.80).
- [ ] If the vendor changes, update `NEXT_PUBLIC_RECEIPT_LLM_VENDOR`,
      `/privacy` (`src/app/privacy/page.tsx`) and `docs/ROPA.md` together.

## 3. Legal (gates any marketing push)

- [ ] **Lawyer review of `/privacy` and `/terms`** — complete drafts are live
      (bg+en, plain language per the RFC 08 outlines); they describe rights
      that genuinely work (export + deletion are shipped). One consultation.
- [ ] **Bulgarian accountant consultation** before any first payout —
      чл. 97а ЗДДС (limited VAT registration for EU B2B services like
      OpenRouter/Vercel — bites EARLY), trader-income treatment, ЕООД timing
      (~€500–1,000 MRR). (RFC 09 §3.5.)

## 4. Email (activates notifications digest, reminders, magic-link sign-in)

- [ ] Resend account → verify a **dedicated subdomain** (e.g. `mail.<domain>`,
      SPF/DKIM via Resend) → add DMARC (`p=none` minimum) → set
      `RESEND_API_KEY` + `EMAIL_FROM="Money Assistant <notify@mail.<domain>>"`.
      Everything email-shaped (digest, напомни emails, magic-link login) is
      dormant until both exist and lights up with no code change.
- [ ] After go-live: watch Resend's bounce/complaint dashboard weekly for the
      first month (complaints must stay ≪ 0.3%).

## 5. Observability (cheap, do with the next deploy)

- [ ] Sentry project (free) → set `SENTRY_DSN` (server errors report via the
      envelope API — no SDK).
- [ ] healthchecks.io (free) check with a ~26h grace → set `CRON_PING_URL`
      (silence alarm for the daily cron).
- [ ] Enable Web Analytics on the Vercel project (the `<Analytics/>` tag is
      already in the layout; cookieless).
- [ ] GitHub repo secret `DATABASE_URL` (read-only role if practical) so the
      nightly `backup` workflow starts producing dumps; skim
      `docs/ops/restore-runbook.md` once.

## 6. On-device tests (the ⚠️ empirical ledger, ~1 evening with two phones)

- [ ] **The flagship Viber test:** send an invite link in Viber → tap → the
      join preview renders → the amber "open in browser" hint shows on login →
      the Android `intent://` button opens the real browser → Google login
      completes → lands back on the join card. (RFC 05 §5.)
- [ ] Paste the production URL + a join link into Viber and Messenger — the
      branded OG card (public/og/card-bg.png) should unfurl.
- [ ] Revolut app (BG account): scan a generated SEPA QR from the settle
      modal ✅/❌; try `revolut.me/<tag>?amount=` parameters ✅/❌. Record the
      result in RFC 03's appendix.
- [ ] A real DSK/UBB transfer via the copied bank fields — no
      Verification-of-Payee warning when the account name is right.
- [ ] CSP: after a week of clean report-only operation across every flow
      (login → group → invite → expense → scan → settle), set `CSP_ENFORCE=1`.

## 7. Monetization (deliberately NOT built yet — metering is)

Scan metering + entitlements are live (recording only; `SCAN_QUOTA_ENFORCED`
is off). When you want to charge, per RFC 09: start **Paddle** individual
verification EARLY (needs the live /terms + /privacy + a refund policy;
say explicitly "the app never holds or moves money"), flip **Vercel Hobby →
Pro before the first live checkout** (Hobby prohibits commercial use), build
the `/upgrade` page + webhook (RFC 09 §3.3 — the entitlements columns and
grace logic already exist), run the 60-day grandfathering script idea, then
set `SCAN_QUOTA_ENFORCED=1`.

## 8. Launch playbook (RFC 10 §3.4 — no code involved)

- [ ] Verify the empty „разделяне на сметки" SERP from a Bulgarian IP /
      `gl=bg&hl=bg` BEFORE writing articles; screenshots into your notes.
- [ ] Google Search Console: verify the domain, submit `/sitemap.xml`.
- [ ] Write blog article #1 (registry + how-to in `src/lib/blog.ts`; the
      six-article queue and target keywords are listed there).
- [ ] Community posts in order (drafts in RFC 10 §3.4): r/bulgaria
      (`?ref=reddit`) → Kaldata (`?ref=kaldata`) → 2–3 FB groups with admin
      permission (`?ref=fb-org`) → BG-Mamma (`?ref=bgmamma`). Answer every
      comment for 48h.
- [ ] €150 Meta ads test only after the above (Traffic objective — NO Pixel;
      CPA from `select signup_ref, count(*) from users group by 1`; kill at
      CPA > €8 by €75 spent).
- [ ] Weekly 30-min review Mondays: Search Console → signup_ref counts →
      funnel → one written decision.

## 9. Small decisions to confirm (implementer's calls — cheap to reverse)

- The brand glyph moved **$ → €** everywhere (header/login/join/PWA icons/OG
  cards) per RFC 06's "wrong-currency signal" note. If you dislike it:
  change `BRAND_GLYPH` in `src/components/BrandMark.tsx` and rerun
  `powershell -File scripts/generate-brand-assets.ps1`.
- Deferred by scope decision (yours, from the planning round): service
  worker/offline/install-prompt/push (RFC 05 st. 3–5), dark mode (RFC 05
  st. 7), Paddle checkout code (RFC 09 st. 3–5).
- Deferred by my judgment (small): virtual-member payment details, per-group
  profile visibility, Viber `viber://forward` desktop link (unstable scheme),
  member.left/removed/alias.attached notification types (visible in the
  activity log instead), landing-page product screenshots (take real ones
  post-launch and drop into `public/screenshots/`).
