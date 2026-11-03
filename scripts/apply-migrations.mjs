#!/usr/bin/env node
// Applies ordered migrations (common + company-specific) and optional seed to ONE company's Supabase Postgres.
// Usage: SUPABASE_DB_URL=postgresql://... node scripts/apply-migrations.mjs <resilience|ashelite> [--seed] [--seed-only] [--dry-run]
// Safe to re-run: applied migrations are tracked in fms_admin.migrations and skipped.
import pg from 'pg';
import { migrationFiles, seedFiles, read, COMPANIES } from './lib-migrations.mjs';

const args = process.argv.slice(2);
const company = args.find((a) => COMPANIES.includes(a));
const flag = (f) => args.includes(f);
if (!company) { console.error(`Usage: node scripts/apply-migrations.mjs <${COMPANIES.join('|')}> [--seed] [--seed-only] [--dry-run]`); process.exit(2); }
const files = migrationFiles(company);
if (flag('--dry-run')) { console.log(`Plan for ${company}:`); files.forEach((f, i) => console.log(`${String(i + 1).padStart(2)}. ${f.name}`)); if (flag('--seed') || flag('--seed-only')) seedFiles(company).forEach((f) => console.log(`seed: ${f}`)); process.exit(0); }
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('Set SUPABASE_DB_URL to THIS company\'s database connection string.'); process.exit(2); }

const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  // Isolation guard: never apply one company's schema/seed onto the other company's database.
  const has = await client.query(`select to_regclass('public.company_settings') as t`);
  if (has.rows[0].t) {
    const r = await client.query('select company_code from public.company_settings limit 1');
    if (r.rows[0] && r.rows[0].company_code !== company) throw new Error(`This database belongs to "${r.rows[0].company_code}", refusing to apply "${company}".`);
  }
  await client.query('create schema if not exists fms_admin');
  await client.query('create table if not exists fms_admin.migrations (name text primary key, applied_at timestamptz not null default now())');
  if (!flag('--seed-only')) {
    const done = new Set((await client.query('select name from fms_admin.migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f.name)) { console.log(`skip   ${f.name}`); continue; }
      process.stdout.write(`apply  ${f.name} ... `);
      try { await client.query('begin'); await client.query(read(f.file)); await client.query('insert into fms_admin.migrations(name) values ($1)', [f.name]); await client.query('commit'); console.log('ok'); }
      catch (e) { await client.query('rollback'); throw new Error(`Migration ${f.name} failed: ${e.message}`); }
    }
  }
  if (flag('--seed') || flag('--seed-only')) {
    for (const f of seedFiles(company)) { process.stdout.write(`seed   ${f.split('/').slice(-2).join('/')} ... `); await client.query('begin'); try { await client.query(read(f)); await client.query('commit'); console.log('ok'); } catch (e) { await client.query('rollback'); throw e; } }
    const cs = await client.query('select company_code from public.company_settings limit 1');
    if (cs.rows[0]?.company_code !== company) throw new Error('Seed finished but company_settings does not match the requested company.');
  }
  console.log(`Done: ${company}`);
} finally { await client.end(); }
