import { describe, it, expect } from 'vitest';
import { freshDb, asUser, q, ACCOUNTANT, acct } from './harness';

describe('two-company isolation (separate databases)', () => {
  it('data written to one company database is invisible to the other; identities are bound', async () => {
    const a = await freshDb('resilience'); const b = await freshDb('ashelite');
    await asUser(a, ACCOUNTANT); await asUser(b, ACCOUNTANT);
    await a.query(`insert into public.customers(name) values ('Resilience-only customer')`);
    await b.query(`insert into public.customers(name) values ('AshElite-only customer')`);
    expect((await q<{ name: string }>(a, 'select name from public.customers')).map((r) => r.name)).toEqual(['Resilience-only customer']);
    expect((await q<{ name: string }>(b, 'select name from public.customers')).map((r) => r.name)).toEqual(['AshElite-only customer']);
    expect((await q<{ company_code: string }>(a, 'select company_code from public.company_settings'))[0].company_code).toBe('resilience');
    expect((await q<{ company_code: string }>(b, 'select company_code from public.company_settings'))[0].company_code).toBe('ashelite');
    // schemas carry only their own company's operational tables
    const tables = async (d: typeof a) => (await q<{ table_name: string }>(d, `select table_name from information_schema.tables where table_schema = 'public'`)).map((r) => r.table_name);
    const ta = await tables(a), tb = await tables(b);
    expect(ta).toContain('projects'); expect(ta).not.toContain('production_batches');
    expect(tb).toContain('production_batches'); expect(tb).not.toContain('projects');
    // no company_id column is used as the isolation mechanism anywhere
    for (const d of [a, b]) expect(await q(d, `select 1 from information_schema.columns where table_schema = 'public' and column_name = 'company_id'`)).toHaveLength(0);
  }, 90000);
  it('an accountant profile in one database grants nothing in the other', async () => {
    const a = await freshDb('resilience'); const b = await freshDb('ashelite');
    await b.exec(`delete from public.profiles`);
    await asUser(b, ACCOUNTANT);
    expect(await q(b, 'select * from public.accounts')).toHaveLength(0);          // RLS: no profile here => no access
    await asUser(a, ACCOUNTANT);
    expect((await q(a, 'select * from public.accounts')).length).toBeGreaterThan(0);
    void acct;
  }, 90000);
});
