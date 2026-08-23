# Money Assistant

A Splitwise-inspired money control app. You create groups, add people —
real accounts and/or **virtual members** (people without accounts whose share
you track for them) — log bills, and the app tells you who owes whom. A
per-group toggle switches between "everyone pays exactly what they owe" and a
**simplified** minimal set of payments.

## Features

- **Google sign-in** (Auth.js / NextAuth v5). Each account sees only groups it owns or joined.
- **Multi-user groups**: one **owner** (admin) plus members. Invite-link only —
  the app never sends email.
  - **Circle**: people you already share a group with are suggested as you
    type and join instantly, without an invite.
  - **Invite links** (owner only): shareable `/join/<token>` URLs, valid for 7
    days (the daily cron deactivates expired ones). Logged-out visitors are
    sent through login and back; logged-in ones get a Discord-style join card.
  - Owners can remove members; members can leave. Either way the person's
    expense history is preserved by converting their alias back to a virtual
    member.
  - **Virtual members** coexist with real ones — add people who don't want
    accounts, exactly like a single-user Splitwise.
  - **Attach**: once a person joins for real, the owner can attach their
    virtual member to the account (People → Attach). The virtual identity and
    its whole expense history become theirs; if their account already logged
    expenses under its own name, the two histories are merged.
- **Groups** with a base currency and a *simplify debts* toggle.
- **Bills** with description, amount, currency, date, **who paid** (one person
  or multiple people with exact amounts) and **who owes**, with five split
  methods, Splitwise-style:
  1. **Equally** — pick any subset of participants
  2. **Exact amounts** — must add up to the total
  3. **Percentages** — must add up to 100%
  4. **Shares** — proportional weights
  5. **Adjustment (+/-)** — equal split plus per-person adjustments from the mean
- **Settle up** — record "A paid B" payments that reduce outstanding balances.
- **Multi-currency**: every group has a currency, but each bill can be in its
  own currency. A **Vercel cron job** fetches daily ECB reference rates
  (Frankfurter API, free, no key) into the DB. Bills are converted at the rate
  of the transaction date, or the nearest available rate. If rates are more
  than **7 days** stale (cron not running) and a conversion is needed, a
  warning popup appears with an "Update rates now" button.
- **Debt simplification**: min-cash-flow algorithm producing at most n−1
  payments. Balances are *computed on the fly* from the stored transactions
  (pure integer-cent math, cheap and can never go stale) — only the toggle is
  persisted, never derived balances.

## Stack

- Next.js 15 (App Router, TypeScript, Tailwind v4) — deploys to Vercel as-is
- Postgres via [Neon](https://vercel.com/marketplace/neon) + Drizzle ORM
  (`@neondatabase/serverless` HTTP driver)
- Auth.js v5 with Google provider
- Local development runs with **zero setup**: an embedded Postgres
  ([PGlite](https://pglite.dev)) in `.pglite/` plus a passwordless dev login
  (only enabled in `NODE_ENV=development` when Google creds are absent)

## Local development

```bash
npm install
npm run dev          # http://localhost:3000, sign in with the dev login
```

Optional: seed demo data (run while the dev server is stopped, then log in with
the same email):

```bash
npx tsx scripts/seed-dev.ts you@example.com
```

To try the multi-user flows locally, sign in as two different emails via the
dev login (e.g. in a normal and a private browser window), create a group as
one, generate an invite link in People → Invite, and open it as the other.

Tests:

```bash
npm run test:math            # split/simplify/rates math
npx tsx scripts/db-smoke.ts  # end-to-end DB + balance pipeline (uses .pglite)
```

Delete the `.pglite/` folder to reset the local database.

## Deploying to Vercel

1. Push this repo to GitHub and import it in Vercel.
2. **Database**: in the Vercel project → *Storage* → add **Neon (Postgres)**
   from the Marketplace. This sets `DATABASE_URL` automatically.
3. **Create the tables** (one-time), from your machine against the Neon URL:
   ```powershell
   $env:DATABASE_URL = "<your Neon connection string>"; npm run db:push
   ```
4. **Google OAuth**: in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   create an *OAuth client ID* (Web application) with authorized redirect URI
   `https://<your-domain>/api/auth/callback/google`, then set the env vars
   `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in Vercel.
5. **Auth secret**: set `AUTH_SECRET` (generate with `npx auth secret` or
   `openssl rand -base64 32`).
6. **Cron protection** (recommended): set `CRON_SECRET` to any random string.
   Vercel automatically sends it as a Bearer token to the cron route.
7. Deploy. `vercel.json` schedules `GET /api/cron/daily` at 06:00 UTC (within
   the Hobby plan's once-per-day cron limit): it fetches the day's rates and
   deactivates invites older than 7 days. The first run backfills the last 90
   days of rates; you can also trigger rates manually with **Update rates now**
   in the stale-rates popup.

All env vars are listed in [.env.example](.env.example).

## Data model

| Table            | Purpose                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `users`          | Google accounts (upserted on sign-in)                                  |
| `groups`         | name, base currency, `simplify_debts` toggle, owner (`user_id`)        |
| `group_members`  | non-owner accounts that joined a group (the owner is implicit)         |
| `group_invites`  | shareable join links: token, status, 7-day expiry                      |
| `aliases`        | the participants in a group; `user_id` links one to a real account, null = virtual member |
| `expenses`       | bills **and** settlements (`kind`), amount in integer cents, currency, date, split method |
| `expense_payers` | who paid how much (supports multiple payers)                           |
| `expense_shares` | who owes how much (`owed_cents` canonical) + the raw split input (`split_value`) so the edit UI restores exactly what was typed |
| `fx_rates`       | one row per day of ECB rates (base EUR, jsonb)                         |

Settlements are stored as a transaction with one payer and one ower, so they
flow through the same balance math as bills. All amounts are integer minor
units; proportional splits use largest-remainder allocation so cents always sum
exactly.
