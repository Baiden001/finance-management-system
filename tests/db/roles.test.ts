import { describe, it, expect } from 'vitest';
import { freshDb, asUser, asSuper, q, expectError, ACCOUNTANT, OUTSIDER } from './harness';

const CEO = '33333333-3333-3333-3333-333333333333';

async function withCeo(company: 'resilience' | 'ashelite') {
  const db = await freshDb(company);
  await db.exec(`insert into auth.users(id, email) values ('${CEO}','ceo@example.test')`);
  await db.exec(`insert into public.profiles(id, full_name, role) values ('${CEO}','Test CEO','ceo')`);
  return db;
}

describe('CEO role (view-only)', () => {
  it('reports the signed-in role; outsiders have none', async () => {
    const db = await withCeo('ashelite');
    await asUser(db, CEO); expect((await q<{ r: string }>(db, 'select public.app_role() r'))[0].r).toBe('ceo');
    expect((await q<{ a: boolean }>(db, 'select public.is_accountant() a'))[0].a).toBe(false);
    await asUser(db, ACCOUNTANT); expect((await q<{ r: string }>(db, 'select public.app_role() r'))[0].r).toBe('accountant');
    await asUser(db, OUTSIDER); expect((await q<{ r: string | null }>(db, 'select public.app_role() r'))[0].r).toBeNull();
  }, 90000);

  it('can read financial data and run financial reports, but cannot write anything', async () => {
    for (const company of ['ashelite', 'resilience'] as const) {
      const db = await withCeo(company);
      await asUser(db, CEO);
      expect((await q(db, 'select * from public.accounts')).length).toBeGreaterThan(0);
      expect((await q(db, 'select * from public.company_settings'))).toHaveLength(1);
      await q(db, `select * from public.rpt_income_statement('2026-01-01','2026-12-31')`);
      await q(db, `select * from public.rpt_balance_sheet_levels(2, '2026-12-31')`);
      await q(db, `select * from public.rpt_ar_aging('2026-12-31')`);
      if (company === 'ashelite') await q(db, 'select * from public.rpt_inventory_valuation()');
      else await q(db, `select * from public.rpt_rental_roll('2026-12-31')`);
      await expectError(db.query(`insert into public.customers(name) values ('x')`), /row-level security/);
      await expectError(db.query(`select public.create_fiscal_year(2031)`), /row-level security|not authorised|permission/i);
      // updates and deletes silently match nothing under RLS
      await db.query(`update public.accounts set name = 'hacked'`);
      await db.query(`delete from public.accounts`);
      await asSuper(db);
      expect(await q(db, `select 1 from public.accounts where name = 'hacked'`)).toHaveLength(0);
      expect((await q(db, 'select * from public.accounts')).length).toBeGreaterThan(0);
    }
  }, 180000);

  it('cannot see payroll, employees, audit log, attachments, bank statements or other profiles', async () => {
    const db = await withCeo('ashelite');
    await asUser(db, ACCOUNTANT);
    await db.query(`insert into public.employees(emp_no, full_name, employment_type) values ('E1','Kofi','permanent')`);
    expect(await q(db, 'select * from public.employees')).toHaveLength(1);
    await asUser(db, CEO);
    for (const t of ['employees', 'payroll_runs', 'payroll_lines', 'salary_structures', 'audit_log', 'attachments', 'bank_statement_lines', 'bank_reconciliations', 'recurring_journals', 'stock_counts'])
      expect(await q(db, `select * from public.${t}`), t).toHaveLength(0);
    const profiles = await q<{ id: string }>(db, 'select id from public.profiles');
    expect(profiles.map((p) => p.id)).toEqual([CEO]);
    // cannot promote themselves: the update matches no row they may write
    await db.query(`update public.profiles set role = 'accountant' where id = '${CEO}'`);
    expect((await q<{ r: string }>(db, 'select public.app_role() r'))[0].r).toBe('ceo');
  }, 90000);

  it('may log non-sensitive exports only', async () => {
    const db = await withCeo('ashelite');
    await asUser(db, CEO);
    await q(db, `select public.log_export('trial_balance','pdf','{}'::jsonb, 3, 'abc', false)`);
    await expectError(db.query(`select public.log_export('payroll_register','pdf','{}'::jsonb, 3, 'abc', true)`), /row-level security/);
  }, 90000);

  it('a disabled profile has no role', async () => {
    const db = await withCeo('resilience');
    await asSuper(db); await db.exec(`update public.profiles set role = 'disabled' where id = '${CEO}'`);
    await asUser(db, CEO);
    expect((await q<{ r: string | null }>(db, 'select public.app_role() r'))[0].r).toBeNull();
    expect(await q(db, 'select * from public.accounts')).toHaveLength(0);
  }, 90000);
});
