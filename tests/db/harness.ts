import { PGlite } from '@electric-sql/pglite';
import { migrationFiles, seedFiles, read } from '../../scripts/lib-migrations.mjs';

export const ACCOUNTANT = '11111111-1111-1111-1111-111111111111';
export const OUTSIDER = '22222222-2222-2222-2222-222222222222';

const STUBS = `
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin; create role authenticated nologin;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
`;

export async function freshDb(company: 'resilience' | 'ashelite', opts: { seed?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(STUBS);
  for (const m of migrationFiles(company)) {
    try { await db.exec(read(m.file)); } catch (e) { throw new Error(`Migration ${m.name} failed: ${(e as Error).message}`); }
  }
  await db.exec(`insert into auth.users(id, email) values ('${ACCOUNTANT}','acc@example.test'), ('${OUTSIDER}','out@example.test')`);
  await db.exec(`insert into public.profiles(id, full_name, role) values ('${ACCOUNTANT}','Test Accountant','accountant')`);
  if (opts.seed !== false) for (const f of seedFiles(company)) await db.exec(read(f));
  return db;
}

export async function asUser(db: PGlite, sub: string | null) {
  await db.exec('reset role');
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub ?? ''}', false)`);
  if (sub) await db.exec('set role authenticated'); else await db.exec('set role anon');
}
export async function asSuper(db: PGlite) { await db.exec('reset role'); }

export async function q<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}
export async function expectError(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const m = (e as Error).message; if (!re.test(m)) throw new Error(`Expected error ${re} but got: ${m}`); return; }
  throw new Error(`Expected error ${re} but the call succeeded`);
}
export async function acct(db: PGlite, code: string): Promise<string> {
  return (await q<{ id: string }>(db, 'select id from public.accounts where code = $1', [code]))[0].id;
}
