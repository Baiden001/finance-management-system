# Backup and recovery (per company, never shared)

## Layers
1. **Supabase managed backups / PITR** in each project (dashboard step; enable PITR on a paid plan). Primary recovery path.
2. **Logical dumps** with `scripts/backup.sh <company>` (custom-format `pg_dump` of `public` and `fms_admin`, plus SHA-256). Run daily from a scheduler, encrypt (age/gpg) and store **separately per company** (different bucket/keys). Auth users are not included: recreate with `create-accountant.mjs` or restore from the managed backup.
3. **Storage** files (`documents`) are backed up separately (Supabase storage replication, or `supabase storage cp` to your own bucket).

## Restore drill (do this before go-live and quarterly)
```bash
SUPABASE_DB_URL=... ./scripts/backup.sh resilience backups
SCRATCH_DB_URL=postgresql://.../scratch ./scripts/restore-test.sh backups/resilience-<stamp>.dump
```
`restore-test.sh` verifies the checksum, restores into an empty scratch database, then checks the restored ledger balances (sum of base debits = credits) and prints the bound company. Record the date, duration and result.

## Disaster recovery
1. Create/identify the target project (same company only). 2. Restore via managed backup/PITR, or `pg_restore` of the latest verified dump after `apply-migrations.mjs <company>` has created roles/schemas as needed. 3. Run `npm run db:apply -- <company>` (no-op if complete) and `create-accountant.mjs` if Auth users were lost. 4. Re-point the deployment's env vars. 5. Sign in, run Trial Balance and the payroll-to-ledger reconciliation for the latest run, and compare with the last exported management reports.

Never restore one company's dump into the other company's project; `apply-migrations` and the app binding guard will refuse, but do not rely on that alone.
