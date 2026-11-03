#!/usr/bin/env bash
# Restores a backup into a SCRATCH database and checks that ledgers balance. Never point this at production.
# Usage: SCRATCH_DB_URL=postgresql://.../scratch ./scripts/restore-test.sh backups/resilience-XXXX.dump
set -euo pipefail
file="${1:?dump file}"; : "${SCRATCH_DB_URL:?Set SCRATCH_DB_URL to an empty scratch database}"
sha256sum -c "$file.sha256"
psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -c "create schema if not exists auth; create table if not exists auth.users(id uuid primary key, email text); create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';" >/dev/null
pg_restore --no-owner --dbname "$SCRATCH_DB_URL" "$file"
psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
select 'journals: ' || count(*) from public.journals;
select case when coalesce(sum(base_debit),0) = coalesce(sum(base_credit),0) then 'PASS ledger balances' else 'FAIL ledger out of balance' end from public.journal_lines;
select 'company: ' || company_code from public.company_settings;
SQL
