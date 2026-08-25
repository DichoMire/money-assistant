# Database restore runbook (RFC 11 §h)

**Backups:** the `backup` GitHub Action dumps the hosted DB nightly
(`pg_dump --format=custom`, image bytes excluded) into a workflow artifact
kept 90 days. Neon's own PITR window on the free plan is only ~6h — the
nightly dump is what makes a next-morning discovery recoverable.

## Restore procedure

1. **Never restore over production.** Create a fresh Neon branch/database
   (Neon console → Branches → New branch, or a new database).
2. Download the newest `db-backup-*` artifact from the Actions tab, then:

   ```sh
   pg_restore --clean --if-exists -d "$NEW_DATABASE_URL" backup.pgdump
   ```

3. **Sanity checks** before touching Vercel:
   - row counts on `users`, `groups`, `expenses` vs expectations;
   - open one known group's balances against a screenshot/memory;
   - `DATABASE_URL="$NEW_DATABASE_URL" npx tsx scripts/db-smoke.ts` is NOT
     appropriate here (it seeds data) — instead run a read-only spot check:
     `psql "$NEW_DATABASE_URL" -c "select count(*) from expenses"`.
4. Point Vercel's `DATABASE_URL` env at the restored database, redeploy.
5. Receipt images are not in the dump: converted scans lost theirs by policy
   anyway; recent drafts lose the photo but keep their parsed items.
6. Note the incident in `docs/ROPA.md` (breach checklist step 8 applies if
   personal data was exposed rather than merely lost).

**Quarterly drill:** do steps 1–3 against a scratch branch and record the
date here:

| Date | Performed by | Outcome |
|---|---|---|
| _none yet_ | | |
