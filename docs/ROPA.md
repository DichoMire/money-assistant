# Record of Processing Activities (Art. 30 GDPR) — Money Assistant

> **This file is the single source of truth** for processors and retention.
> When a vendor or retention rule changes (e.g. the receipt-LLM provider),
> update this table **and** `/privacy` (`src/app/privacy/page.tsx`) together.
> Last reviewed: 2026-08-26.

Controller: the operator of Money Assistant (solo developer, Bulgaria).
Contact: set via `NEXT_PUBLIC_CONTACT_EMAIL` (also shown in `/privacy`).

## Processing activities

| Activity | Purpose | Legal basis | Data categories | Data subjects | Processors / recipients | Transfers (mechanism) | Retention | Security measures |
|---|---|---|---|---|---|---|---|---|
| Accounts & auth | Sign-in, identity, invite matching | Contract (Art. 6(1)(b)) | Email, name, Google avatar URL | Users | Google (sign-in), Vercel (hosting), Neon (DB) | SCCs / EU-US DPF per vendor | Until account deletion (self-serve, immediate) | OAuth-verified emails only; JWT sessions; HTTPS/HSTS |
| Group ledgers | Shared expense tracking, balance math | Contract | Group/participant names, descriptions, amounts, dates, who-owes-whom | Users + virtual members (names only) | Vercel, Neon | as above | Life of the group; on account deletion the person is detached, shared records remain (Art. 17(3) balancing) | Membership-checked server actions; transactions; rate limits |
| Receipt scanning | Extract line items from receipt photos | Contract | Receipt photo (may incl. card last-4, loyalty IDs), merchant, items incl. verbatim lines, totals | Users (uploader; incidentally other shoppers) | OpenRouter + selected model provider; Vercel, Neon | SCCs / DPF; ⚠️ free model endpoints may permit training — switch to paid/ZDR before public launch (owner checklist) | Photo: deleted on conversion (unless "keep photo"), drafts ≤ 30 days; parsed items: life of the group | Client-side re-encode strips EXIF; photos deleted on account deletion; membership-checked image route |
| Activity log | Group-visible audit trail ("who did what") | Contract + legitimate interest (trust/abuse) | Actor names, action details (names, amounts; **no emails** since migration 0009) | Users | Vercel, Neon | as above | Life of the group; actor names tombstoned ("__deleted__") on account deletion | Names-only policy enforced in code; log rendered per-viewer locale |
| Cookies | Session + language | Contract (strictly necessary) | Session token, locale choice | Users | — | — | Session lifetime / 1 year | Both cookies essential — no consent banner required; keep it that way (no tracking cookies) |
| FX rates | Currency conversion | — (no personal data) | ECB reference rates | — | Frankfurter API (fetch only) | — | Indefinite | n/a |

## Breach response checklist (72-hour КЗЛД duty)

1. **Detect & timestamp** — note when and how the breach was discovered.
2. **Contain** — revoke exposed credentials, rotate secrets (`AUTH_SECRET`, DB password, API keys), disable the affected path.
3. **Snapshot evidence** — logs, affected rows, deploy IDs, before any cleanup.
4. **Assess scope** — whose data, which tables, what time window.
5. **Risk-assess** — is there a high risk to individuals (financial patterns, receipt photos)?
6. **Notify КЗЛД within 72 h** if reportable — cpdp.bg portal.
7. **Notify affected users** without undue delay if the risk is high.
8. **Document everything in this file** regardless of whether notification was required.
9. **Fix the root cause** before restoring the affected path.
10. **Post-mortem** — review this checklist and update it with what was learned.
