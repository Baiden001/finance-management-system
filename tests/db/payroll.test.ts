import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, asUser, asSuper, q, expectError, ACCOUNTANT } from './harness';

let db: PGlite; let perm: string, casual: string, bankId: string, cc1: string, cc2: string;
const num = async (sql: string, p: unknown[] = []) => Number((await q<{ v: string }>(db, sql, p))[0].v);
const setCompliance = async (on: boolean) => { await db.query('update public.company_settings set ghana_payroll_compliance = $1', [on]); };
async function run(y: number, m: number) { return (await q<{ id: string }>(db, 'select public.payroll_create_run($1,$2) id', [y, m]))[0].id; }
async function approveAll(r: string) { await db.query('update public.payroll_inputs set approved = true where run_id = $1', [r]); }
const lineOf = async (r: string, emp: string) => (await q<Record<string, string>>(db, 'select * from public.payroll_lines where run_id = $1 and emp_no = $2', [r, emp]))[0];

beforeAll(async () => {
  db = await freshDb('ashelite');
  await asUser(db, ACCOUNTANT);
  cc1 = (await q<{ id: string }>(db, `insert into public.cost_centres(code, name) values ('PROD','Production') returning id`))[0].id;
  cc2 = (await q<{ id: string }>(db, `insert into public.cost_centres(code, name) values ('ADMIN','Administration') returning id`))[0].id;
  bankId = (await q<{ id: string }>(db, `select id from public.bank_accounts limit 1`))[0].id;
  perm = (await q<{ id: string }>(db, `insert into public.employees(emp_no, full_name, employment_type, hire_date, payment_method, bank_name, bank_account_number, cost_centre_id)
     values ('E001','Ama Owusu','permanent','2025-01-01','bank','GCB','0123456789',$1) returning id`, [cc2]))[0].id;
  casual = (await q<{ id: string }>(db, `insert into public.employees(emp_no, full_name, employment_type, hire_date, payment_method, momo_provider, momo_number, cost_centre_id, paye_applicable, ssnit_applicable)
     values ('E002','Yaw Boateng','casual','2025-01-01','momo','MTN','0240000000',$1,false,false) returning id`, [cc1]))[0].id;
  const s1 = (await q<{ id: string }>(db, `insert into public.salary_structures(employee_id, effective_from, pay_basis, basic_amount) values ($1,'2025-01-01','monthly',5000) returning id`, [perm]))[0].id;
  await db.query(`insert into public.structure_components(structure_id, component_id, amount) values ($1,(select id from public.pay_components where code='ALLOW_TRANSPORT'),500), ($1,(select id from public.pay_components where code='DED_UNION'),20)`, [s1]);
  await db.query(`insert into public.salary_structures(employee_id, effective_from, pay_basis, basic_amount) values ($1,'2025-01-01','daily',100)`, [casual]);
}, 60000);

describe('payroll with Ghana compliance DISABLED', () => {
  let r: string;
  it('calculates ordinary payroll without PAYE or pension', async () => {
    r = await run(2026, 1);
    await db.query(`update public.payroll_inputs set days_worked = 20, approved = true, bonus = 0 where run_id = $1 and employee_id = $2`, [r, casual]);
    await db.query(`update public.payroll_inputs set approved = true, bonus = 200 where run_id = $1 and employee_id = $2`, [r, perm]);
    expect(await num('select public.payroll_calculate($1) v', [r])).toBe(2);
    const p = await lineOf(r, 'E001'); const c = await lineOf(r, 'E002');
    expect(Number(p.gross_pay)).toBe(5700); expect(Number(p.paye)).toBe(0); expect(Number(p.employee_pension)).toBe(0); expect(Number(p.employer_pension)).toBe(0);
    expect(Number(p.net_pay)).toBe(5680);          // gross 5700 - union dues 20
    expect(Number(c.basic_pay)).toBe(2000); expect(Number(c.net_pay)).toBe(2000);
    const run1 = (await q<{ ghana_compliance_applied: boolean; paye_rule_id: string | null }>(db, 'select ghana_compliance_applied, paye_rule_id from public.payroll_runs where id = $1', [r]))[0];
    expect(run1.ghana_compliance_applied).toBe(false); expect(run1.paye_rule_id).toBeNull();
  });
  it('statutory schedule is empty when compliance is off', async () => {
    expect((await q(db, 'select * from public.rpt_payroll_statutory($1)', [r])).length).toBe(0);
  });
  it('finalizes, freezes, posts a balanced journal that reconciles to the register', async () => {
    await db.query('select public.payroll_finalize($1)', [r]);
    await expectError(db.query('select public.payroll_calculate($1)', [r]), /cannot be recalculated/);
    await expectError(db.query(`update public.payroll_lines set net_pay = 1 where run_id = $1`, [r]), /frozen/);
    await expectError(db.query(`delete from public.payroll_lines where run_id = $1`, [r]), /frozen/);
    await expectError(db.query(`update public.payroll_inputs set bonus = 1 where run_id = $1`, [r]), /frozen/);
    await expectError(db.query(`update public.payroll_runs set notes = 'x' where id = $1`, [r]), /cannot be edited/);
    await expectError(db.query(`delete from public.payroll_runs where id = $1`, [r]), /Only draft/);
    await db.query('select public.payroll_post_journal($1)', [r]);
    const rec = await q<{ item: string; difference: string }>(db, 'select * from public.rpt_payroll_ledger_reconciliation($1)', [r]);
    expect(rec.every((x) => Number(x.difference) === 0)).toBe(true);
    expect(await num(`select sum(base_debit) - sum(base_credit) v from public.journal_lines where journal_id = (select journal_id from public.payroll_runs where id = $1)`, [r])).toBe(0);
    expect(await num(`select sum(base_debit) v from public.journal_lines where journal_id = (select journal_id from public.payroll_runs where id = $1) and cost_centre_id = $2`, [r, cc1])).toBe(2000);
  });
  it('tracks payment statuses and posts cash payments; schedules split by method', async () => {
    const lines = await q<{ id: string; emp_no: string }>(db, 'select id, emp_no from public.payroll_lines where run_id = $1 order by emp_no', [r]);
    await expectError(db.query(`select public.payroll_record_payment($1,'paid','')`, [lines[0].id]), /reference is required/);
    await db.query(`select public.payroll_record_payment($1,'paid','TRX-1')`, [lines[0].id]);
    await db.query(`select public.payroll_record_payment($1,'failed','MoMo timeout')`, [lines[1].id]);
    expect((await q(db, 'select * from public.rpt_payroll_failed_payments($1)', [r])).length).toBe(1);
    expect((await q(db, `select * from public.rpt_payroll_payment_schedule($1,'bank')`, [r])).length).toBe(1);
    expect((await q(db, `select * from public.rpt_payroll_payment_schedule($1,'momo')`, [r])).length).toBe(1);
    await db.query('select public.payroll_post_payments($1,$2,$3)', [r, bankId, '2026-01-31']);
    expect(await num(`select sum(base_credit - base_debit) v from public.journal_lines where account_id = (select id from public.accounts where code = '2220')`)).toBe(2000);
    await expectError(db.query('select public.payroll_post_payments($1,$2,$3)', [r, bankId, '2026-01-31']), /No paid, unposted/);
    await expectError(db.query(`select public.payroll_record_payment($1,'failed','x')`, [lines[0].id]), /already posted/);
  });
  it('payslip data and employer-cost / temp-worker / register reports work', async () => {
    const l = (await q<{ id: string }>(db, `select id from public.payroll_lines where run_id = $1 and emp_no = 'E001'`, [r]))[0].id;
    const ps = (await q<{ payslip: { net_pay: number; compliance_applied: boolean } }>(db, 'select public.payslip($1) payslip', [l]))[0].payslip;
    expect(ps.net_pay).toBe(5680); expect(ps.compliance_applied).toBe(false);
    expect((await q(db, 'select * from public.rpt_payroll_employer_cost($1)', [r])).length).toBe(2);
    expect((await q(db, 'select * from public.rpt_payroll_temp_workers(2026,1)')).length).toBe(1);
    expect((await q(db, 'select * from public.rpt_payroll_register($1)', [r])).length).toBe(2);
    expect((await q(db, 'select * from public.rpt_payroll_earnings_deductions($1)', [r])).length).toBe(11);
  });
  it('does not leak bank/momo numbers into the audit log', async () => {
    const leaks = await q(db, `select 1 from public.audit_log where new_data::text like '%0123456789%' or new_data::text like '%0240000000%' or old_data::text like '%0123456789%'`);
    expect(leaks.length).toBe(0);
    expect((await q(db, `select 1 from public.audit_log where table_name = 'employees'`)).length).toBeGreaterThan(0);
  });
  it('only one regular run per month', async () => {
    await expectError(run(2026, 1), /already exists/);
  });
});

describe('payroll with Ghana compliance ENABLED', () => {
  let r: string;
  it('applies effective-dated SSNIT and PAYE, snapshots rule ids, warns about unverified rules', async () => {
    await setCompliance(true);
    r = await run(2026, 2);
    await approveAll(r);
    await db.query(`update public.payroll_inputs set days_worked = 10 where run_id = $1 and employee_id = $2`, [r, casual]);
    await db.query('select public.payroll_calculate($1)', [r]);
    const p = await lineOf(r, 'E001');
    expect(Number(p.gross_pay)).toBe(5500); expect(Number(p.employee_pension)).toBe(275); expect(Number(p.employer_pension)).toBe(650);
    expect(Number(p.taxable_pay)).toBe(5225); expect(Number(p.paye)).toBe(904.75);
    expect(Number(p.net_pay)).toBe(5500 - 904.75 - 275 - 20);
    expect(Number(p.employer_cost)).toBe(6150);
    const c = await lineOf(r, 'E002');                       // casual flagged not subject to PAYE / SSNIT
    expect(Number(c.paye)).toBe(0); expect(Number(c.employee_pension)).toBe(0);
    const run2 = (await q<{ ghana_compliance_applied: boolean; paye_rule_id: string }>(db, 'select ghana_compliance_applied, paye_rule_id from public.payroll_runs where id = $1', [r]))[0];
    expect(run2.ghana_compliance_applied).toBe(true); expect(run2.paye_rule_id).toBeTruthy();
    expect((await q(db, 'select * from public.payroll_exceptions($1) where code = $2', [r, 'statutory_rule_unverified'])).length).toBeGreaterThan(0);
    expect((await q(db, 'select * from public.rpt_payroll_statutory($1)', [r])).length).toBe(2);
  });
  it('blocks finalizing with unverified rules unless acknowledged; then posts and reconciles', async () => {
    await expectError(db.query('select public.payroll_finalize($1)', [r]), /unverified/);
    await db.query('select public.payroll_finalize($1, true)', [r]);
    await db.query('select public.payroll_post_journal($1)', [r]);
    const rec = await q<{ difference: string }>(db, 'select * from public.rpt_payroll_ledger_reconciliation($1)', [r]);
    expect(rec.every((x) => Number(x.difference) === 0)).toBe(true);
    expect(await num(`select sum(base_credit) v from public.journal_lines where journal_id = (select journal_id from public.payroll_runs where id = $1) and account_id = (select id from public.accounts where code = '2200')`, [r])).toBe(904.75);
  });
  it('keeps finalized history stable when rules change; used rule versions are immutable', async () => {
    const used = (await q<{ id: string }>(db, `select paye_rule_id id from public.payroll_runs where id = $1`, [r]))[0].id;
    await expectError(db.query(`update public.statutory_rule_sets set params = '{"bands":[{"upto":null,"rate":0.5}]}' where id = $1`, [used]), /immutable/);
    await expectError(db.query(`delete from public.statutory_rule_sets where id = $1`, [used]), /cannot be deleted/);
    await db.query(`update public.statutory_rule_sets set effective_to = '2026-02-28' where id = $1`, [used]);
    await db.query(`insert into public.statutory_rule_sets(rule_code, effective_from, params, source_note, verified_by, verified_at) values ('GH_PAYE','2026-03-01','{"pension_deductible":true,"bands":[{"upto":null,"rate":0.10}]}','test','tester', now())`);
    await db.query(`update public.statutory_rule_sets set effective_to = '2026-02-28' where rule_code = 'GH_SSNIT' and effective_from = '2024-01-01'`);
    await db.query(`insert into public.statutory_rule_sets(rule_code, effective_from, params, source_note, verified_by, verified_at) values ('GH_SSNIT','2026-03-01','{"employee_rate":0.06,"employer_rate":0.12}','test','tester', now())`);
    const feb = await lineOf(r, 'E001');
    expect(Number(feb.paye)).toBe(904.75);
    await expectError(db.query('select public.payroll_calculate($1)', [r]), /cannot be recalculated/);
    const r3 = await run(2026, 3); await approveAll(r3);
    await db.query('select public.payroll_calculate($1)', [r3]);
    const mar = await lineOf(r3, 'E001');
    expect(Number(mar.employee_pension)).toBe(300);          // new 6% rule
    expect(Number(mar.paye)).toBeCloseTo((5500 - 300) * 0.1, 2);
    expect((await q(db, 'select * from public.payroll_exceptions($1) where code = $2', [r3, 'statutory_rule_unverified'])).length).toBe(0);
    expect(Number((await lineOf(r, 'E001')).paye)).toBe(904.75);   // February untouched
  });
  it('errors if compliance is on but no rule set covers the month', async () => {
    const r4 = await run(2023, 6).catch(() => null);
    expect(r4).toBeTruthy();
    await expectError(db.query('select public.payroll_calculate($1)', [r4]), /no effective PAYE\/SSNIT rule set/);
  });
  it('compliance toggle is timestamped and audited', async () => {
    const s = (await q<{ ghana_compliance_changed_at: string }>(db, 'select ghana_compliance_changed_at from public.company_settings'))[0];
    expect(s.ghana_compliance_changed_at).toBeTruthy();
    expect((await q(db, `select 1 from public.audit_log where table_name = 'company_settings' and action = 'UPDATE'`)).length).toBeGreaterThan(0);
  });
});

describe('exceptions, corrections, allocations, salary history', () => {
  it('blocks finalization on unapproved work-based input and negative net pay', async () => {
    await setCompliance(false);
    const r = await run(2026, 4);
    await db.query(`update public.payroll_inputs set days_worked = 5 where run_id = $1 and employee_id = $2`, [r, casual]);
    await db.query(`update public.payroll_inputs set advance_repayment = 99999 where run_id = $1 and employee_id = $2`, [r, perm]);
    await db.query('select public.payroll_calculate($1)', [r]);
    const codes = (await q<{ code: string }>(db, 'select code from public.payroll_exceptions($1)', [r])).map((x) => x.code);
    expect(codes).toContain('input_not_approved'); expect(codes).toContain('negative_net');
    await expectError(db.query('select public.payroll_finalize($1)', [r]), /blocking payroll exception/);
    await db.query(`update public.payroll_inputs set approved = true, advance_repayment = 100 where run_id = $1`, [r]);
    await db.query('select public.payroll_calculate($1)', [r]);          // recalculation before finalization is allowed
    await db.query('select public.payroll_finalize($1)', [r]);
  });
  it('corrects a posted run by reversal and a supplementary run', async () => {
    const r = (await q<{ id: string }>(db, `select id from public.payroll_runs where period_year = 2026 and period_month = 4`))[0].id;
    await db.query('select public.payroll_post_journal($1)', [r]);
    await expectError(db.query(`select public.payroll_reverse($1,'2026-04-30','')`, [r]), /reason is required/);
    await db.query(`select public.payroll_reverse($1,'2026-04-30','Wrong attendance')`, [r]);
    expect((await q<{ status: string }>(db, 'select status from public.payroll_runs where id = $1', [r]))[0].status).toBe('reversed');
    expect(await num(`select sum(base_debit - base_credit) v from public.journal_lines l join public.journals j on j.id = l.journal_id where j.source_type in ('payroll','reversal') and j.entry_date = '2026-04-30'
      and l.account_id = (select id from public.accounts where code = '2220')`)).toBe(0);
    await expectError(db.query(`select public.payroll_create_run(2026,4,'supplementary')`), /must reference/);
    const supp = (await q<{ id: string }>(db, `select public.payroll_create_run(2026,4,'supplementary',$1) id`, [r]))[0].id;
    expect(supp).toBeTruthy();
    const reg = await q(db, `select public.payroll_create_run(2026,4) id`);           // regular run allowed again after reversal
    expect(reg.length).toBe(1);
  });
  it('splits payroll cost across cost centres by allocation and still balances', async () => {
    await db.query(`insert into public.employee_cost_allocations(employee_id, cost_centre_id, percent) values ($1,$2,60), ($1,$3,40)`, [perm, cc1, cc2]);
    const r = await run(2026, 5); await approveAll(r);
    await db.query(`update public.payroll_inputs set days_worked = 3 where run_id = $1 and employee_id = $2`, [r, casual]);
    await db.query('select public.payroll_calculate($1)', [r]); await db.query('select public.payroll_finalize($1)', [r]);
    await db.query('select public.payroll_post_journal($1)', [r]);
    const jid = (await q<{ journal_id: string }>(db, 'select journal_id from public.payroll_runs where id = $1', [r]))[0].journal_id;
    expect(await num(`select sum(base_debit) v from public.journal_lines where journal_id = $1 and cost_centre_id = $2 and account_id = (select id from public.accounts where code='6000')`, [jid, cc1])).toBe(0.6 * 5500 + 300);
    expect((await q<{ difference: string }>(db, 'select * from public.rpt_payroll_ledger_reconciliation($1)', [r])).every((x) => Number(x.difference) === 0)).toBe(true);
    await db.query(`update public.employee_cost_allocations set percent = 30 where employee_id = $1 and cost_centre_id = $2`, [perm, cc2]);
    const r6 = await run(2026, 6); await approveAll(r6);
    await db.query('select public.payroll_calculate($1)', [r6]);
    await db.query(`update public.payroll_inputs set days_worked = 1 where run_id = $1 and employee_id = $2`, [r6, casual]);
    await db.query('select public.payroll_finalize($1)', [r6]);
    await expectError(db.query('select public.payroll_post_journal($1)', [r6]), /total 100/);
  });
  it('salary structure history is immutable and effective-dated', async () => {
    await expectError(db.query(`update public.salary_structures set basic_amount = 9 where employee_id = $1`, [perm]), /immutable/);
    await expectError(db.query(`delete from public.salary_structures where employee_id = $1`, [perm]), /cannot be deleted/);
    await db.query(`insert into public.salary_structures(employee_id, effective_from, pay_basis, basic_amount) values ($1,'2026-07-01','monthly',6000)`, [perm]);
    const hist = await q<{ effective_from: string; effective_to: string | null }>(db, `select effective_from::text, effective_to::text from public.salary_structures where employee_id = $1 order by effective_from`, [perm]);
    expect(hist[0].effective_to).toBe('2026-06-30'); expect(hist[1].effective_to).toBeNull();
    await asSuper(db); await asUser(db, ACCOUNTANT);
  });
});
