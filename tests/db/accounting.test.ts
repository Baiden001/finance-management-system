import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, asUser, q, expectError, acct, ACCOUNTANT } from './harness';

let db: PGlite; let cust: string, supp: string, bankId: string, usdBankId: string, rev: string, exp: string, usdAcct: string;
const num = async (sql: string, p: unknown[] = []) => Number((await q<{ v: string }>(db, sql, p))[0].v);

beforeAll(async () => {
  db = await freshDb('resilience');
  await asUser(db, ACCOUNTANT);
  rev = await acct(db, '4000'); exp = await acct(db, '6200');
  cust = (await q<{ id: string }>(db, `insert into public.customers(name) values ('Kofi Mensah') returning id`))[0].id;
  supp = (await q<{ id: string }>(db, `insert into public.suppliers(name) values ('BuildCo') returning id`))[0].id;
  bankId = (await q<{ id: string }>(db, `select id from public.bank_accounts ba where account_id = (select id from public.accounts where code = '1010')`))[0].id;
  await db.exec(`insert into public.accounts(code, name, type, subtype, cash_flow_category, currency, is_bank) values ('1040','Bank - USD','asset','bank','cash','USD',true)`);
  usdAcct = await acct(db, '1040');
  usdBankId = (await q<{ id: string }>(db, `insert into public.bank_accounts(account_id, name, currency) values ($1,'USD account','USD') returning id`, [usdAcct]))[0].id;
  await db.exec(`insert into public.fx_rates(rate_date, from_currency, to_currency, rate) values ('2026-01-01','USD','GHS',12), ('2026-02-01','USD','GHS',13), ('2026-03-31','USD','GHS',14)`);
}, 60000);

async function invoice(amount: number, opts: { date?: string; due?: string; tax?: number; cur?: string; rate?: number } = {}) {
  const id = (await q<{ id: string }>(db, `insert into public.invoices(customer_id, issue_date, due_date, currency, fx_rate) values ($1,$2,$3,$4,$5) returning id`,
    [cust, opts.date ?? '2026-01-05', opts.due ?? '2026-02-05', opts.cur ?? 'GHS', opts.rate ?? 1]))[0].id;
  await db.query(`insert into public.invoice_lines(invoice_id, description, quantity, unit_price, tax_rate, revenue_account_id) values ($1,'Work',1,$2,$3,$4)`, [id, amount, opts.tax ?? 0, rev]);
  await db.query('select public.issue_invoice($1)', [id]);
  return id;
}

describe('AR', () => {
  it('issues an invoice with tax and posts DR AR / CR revenue / CR output tax', async () => {
    const id = await invoice(1000, { tax: 15 });
    const [i] = await q<{ total: string; tax_total: string; journal_id: string; status: string }>(db, 'select * from public.invoices where id = $1', [id]);
    expect(Number(i.total)).toBe(1150); expect(Number(i.tax_total)).toBe(150); expect(i.status).toBe('issued');
    const l = await q<{ code: string; d: string; c: string }>(db, `select a.code, l.base_debit d, l.base_credit c from public.journal_lines l join public.accounts a on a.id = l.account_id where journal_id = $1 order by a.code`, [i.journal_id]);
    expect(l.map((x) => x.code)).toEqual(['1100', '2100', '4000']);
    expect(Number(l[0].d)).toBe(1150);
  });
  it('locks issued invoices', async () => {
    const id = await invoice(10);
    await expectError(db.query(`update public.invoices set due_date = '2026-12-31' where id = $1`, [id]), /cannot be edited/);
    await expectError(db.query(`delete from public.invoices where id = $1`, [id]), /cannot be deleted/);
    await expectError(db.query(`update public.invoice_lines set unit_price = 1 where invoice_id = $1`, [id]), /cannot be changed/);
    await expectError(db.query('select public.issue_invoice($1)', [id]), /already issued/);
  });
  it('allocates part-payments, rejects over-allocation, and ages the balance', async () => {
    const id = await invoice(500, { date: '2026-01-01', due: '2026-01-10' });
    const p = (await q<{ record_payment: string }>(db, `select public.record_payment('in', $1, '2026-01-20', 200, 'GHS', $2, $3::jsonb, 'momo', 'MM-1') record_payment`, [cust, bankId, JSON.stringify([{ invoice_id: id, amount: 200 }])]))[0];
    expect(p.record_payment).toBeTruthy();
    expect(await num('select public.invoice_paid($1) v', [id])).toBe(200);
    await expectError(db.query(`select public.record_payment('in', $1, '2026-01-21', 400, 'GHS', $2, $3::jsonb)`, [cust, bankId, JSON.stringify([{ invoice_id: id, amount: 400 }])]), /exceeds the open balance/);
    const age = await q<{ customer: string; d1_30: string; d31_60: string; total: string }>(db, `select * from public.rpt_ar_aging('2026-01-31')`);
    const row = age.find((r) => r.customer === 'Kofi Mensah')!;
    expect(Number(row.d1_30)).toBeGreaterThan(0);
    const ledgerAr = await num(`select sum(base_debit - base_credit) v from public.journal_lines l join public.journals j on j.id = l.journal_id where l.account_id = (select id from public.accounts where code='1100') and j.entry_date <= '2026-01-31'`);
    expect(Number(row.total)).toBeCloseTo(ledgerAr, 2);   // sub-ledger = control account
  });
  it('payments are immutable', async () => {
    await expectError(db.query(`update public.payments set amount = 1`), /immutable/);
    await expectError(db.query(`delete from public.payment_allocations`), /immutable/);
  });
});

describe('AP', () => {
  it('approves a bill, pays it, and AP sub-ledger matches control account', async () => {
    const id = (await q<{ id: string }>(db, `insert into public.bills(supplier_id, issue_date, due_date) values ($1,'2026-01-10','2026-02-10') returning id`, [supp]))[0].id;
    await db.query(`insert into public.bill_lines(bill_id, description, quantity, unit_price, tax_rate, expense_account_id) values ($1,'Cement',10,100,15,$2)`, [id, exp]);
    await db.query('select public.approve_bill($1)', [id]);
    expect(await num('select total v from public.bills where id = $1', [id])).toBe(1150);
    await db.query(`select public.record_payment('out', $1, '2026-01-25', 600, 'GHS', $2, $3::jsonb, 'bank', 'CHQ-9')`, [supp, bankId, JSON.stringify([{ bill_id: id, amount: 600 }])]);
    const ap = await q<{ total: string }>(db, `select * from public.rpt_ap_aging('2026-01-31')`);
    expect(Number(ap[0].total)).toBe(550);
    const ctrl = await num(`select sum(base_credit - base_debit) v from public.journal_lines where account_id = (select id from public.accounts where code='2000')`);
    expect(ctrl).toBe(550);
  });
});

describe('multi-currency', () => {
  it('books realised FX gain on a USD invoice paid at a better rate', async () => {
    const id = await invoice(100, { date: '2026-01-15', due: '2026-02-15', cur: 'USD', rate: 12 });
    expect(await num(`select sum(base_debit) v from public.journal_lines where journal_id = (select journal_id from public.invoices where id = $1)`, [id])).toBe(1200);
    await db.query(`select public.record_payment('in', $1, '2026-02-10', 100, 'USD', $2, $3::jsonb, 'bank', 'USD-1')`, [cust, usdBankId, JSON.stringify([{ invoice_id: id, amount: 100 }])]);
    const gl = await q<{ d: string; c: string }>(db, `select sum(base_debit) d, sum(base_credit) c from public.journal_lines l join public.journals j on j.id = l.journal_id where j.source_type = 'payment' and j.reference = 'USD-1'`);
    expect(Number(gl[0].d)).toBe(Number(gl[0].c));
    const fx = await num(`select sum(base_credit - base_debit) v from public.journal_lines where account_id = (select id from public.accounts where code = '7900')`);
    expect(fx).toBe(100);   // 100 USD x (13 - 12)
    expect(await num('select public.invoice_paid($1) v', [id])).toBe(100);
  });
  it('rejects currency mismatch between payment and document', async () => {
    const id = await invoice(50, { cur: 'USD', rate: 12 });
    await expectError(db.query(`select public.record_payment('in', $1, '2026-02-11', 50, 'GHS', $2, $3::jsonb)`, [cust, bankId, JSON.stringify([{ invoice_id: id, amount: 50 }])]), /differs from payment currency/);
  });
  it('revalues foreign-currency accounts and the schedule reconciles to zero afterwards', async () => {
    const before = await q<{ difference: string }>(db, `select * from public.rpt_fx_schedule('2026-03-31')`);
    expect(Math.abs(Number(before[0].difference))).toBeGreaterThan(0);
    const jid = (await q<{ j: string }>(db, `select public.revalue_foreign_accounts('2026-03-31') j`))[0].j;
    expect(jid).toBeTruthy();
    const after = await q<{ difference: string; foreign_balance: string; revalued_base: string }>(db, `select * from public.rpt_fx_schedule('2026-03-31')`);
    expect(Number(after[0].difference)).toBe(0);
    expect(Number(after[0].foreign_balance)).toBe(100);
    expect(Number(after[0].revalued_base)).toBe(1400);
    expect(await q(db, `select public.revalue_foreign_accounts('2026-03-31') j`)).toEqual([{ j: null }]);
  });
});

describe('bank reconciliation', () => {
  it('matches statement lines, flags differences, and completes only at zero difference', async () => {
    const lines = await q<{ id: string; debit: string; credit: string; d: string }>(db, `select l.id, l.debit, l.credit, j.entry_date::text d from public.journal_lines l join public.journals j on j.id = l.journal_id
       where l.account_id = (select account_id from public.bank_accounts where id = $1) and j.status in ('posted','reversed') order by j.journal_no`, [bankId]);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const book = lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    for (const l of lines) {
      const s = (await q<{ id: string }>(db, `insert into public.bank_statement_lines(bank_account_id, line_date, description, amount) values ($1,$2,'stmt',$3) returning id`, [bankId, l.d, Number(l.debit) - Number(l.credit)]))[0].id;
      await db.query('select public.match_statement_line($1,$2)', [s, l.id]);
    }
    await expectError(db.query(`select public.complete_reconciliation($1,'2026-12-31',$2)`, [bankId, book + 5]), /unexplained difference/);
    await db.query(`select public.complete_reconciliation($1,'2026-12-31',$2)`, [bankId, book]);
    // wrong amount cannot be matched
    const s2 = (await q<{ id: string }>(db, `insert into public.bank_statement_lines(bank_account_id, line_date, description, amount) values ($1,'2026-02-01','bad',1) returning id`, [bankId]))[0].id;
    await expectError(db.query('select public.match_statement_line($1,$2)', [s2, lines[0].id]), /Amounts differ|already matched|different account/);
  });
});

describe('fixed assets', () => {
  it('depreciates straight-line monthly, caps at depreciable amount, is idempotent, locks terms, disposes', async () => {
    const a = (await q<{ id: string }>(db, `insert into public.fixed_assets(tag, name, category, acquisition_date, cost, residual_value, useful_life_months, cost_account_id, accum_account_id, expense_account_id)
      values ('FA-001','Generator','Equipment','2026-01-15',1200,0,12,(select id from public.accounts where code='1500'),(select id from public.accounts where code='1510'),(select id from public.accounts where code='6300')) returning id`))[0].id;
    await db.query(`select public.post_asset_acquisition($1, (select id from public.accounts where code = '3900'))`, [a]);
    await expectError(db.query(`select public.run_depreciation('2026-01-30')`), /month-end/);
    await db.query(`select public.run_depreciation('2026-01-31')`);
    expect(await num(`select count(*) v from public.depreciation_entries where asset_id = $1`, [a])).toBe(1);
    expect((await q(db, `select public.run_depreciation('2026-01-31') j`))[0]).toEqual({ j: null });
    await db.query(`select public.run_depreciation('2026-02-28')`);
    await expectError(db.query(`update public.fixed_assets set cost = 1 where id = $1`, [a]), /locked/);
    const s = await q<{ accumulated: string; net_book_value: string }>(db, `select * from public.rpt_asset_schedule('2026-02-28') where tag = 'FA-001'`);
    expect(Number(s[0].accumulated)).toBe(200); expect(Number(s[0].net_book_value)).toBe(1000);
    await db.query(`select public.dispose_asset($1,'2026-03-10',1100,(select id from public.accounts where code='1010'))`, [a]);
    expect(await num(`select sum(base_credit - base_debit) v from public.journal_lines where account_id = (select id from public.accounts where code='7000')`)).toBe(100);
    await expectError(db.query(`delete from public.fixed_assets where id = $1`, [a]), /cannot be deleted/);
  });
});

describe('budgets and misc reports', () => {
  it('budget vs actual, expense report, tax schedule and journal listing return data', async () => {
    const fy = (await q<{ id: string }>(db, `select id from public.fiscal_years limit 1`))[0].id;
    const per = (await q<{ id: string }>(db, `select id from public.fiscal_periods where name = '2026-01'`))[0].id;
    await db.query(`insert into public.budgets(fiscal_year_id, period_id, account_id, amount) values ($1,$2,$3,500)`, [fy, per, exp]);
    await expectError(db.query(`insert into public.budgets(fiscal_year_id, period_id, account_id, amount) values ($1,$2,$3,1)`, [fy, per, exp]), /duplicate key/);
    const b = await q<{ account_code: string; budget: string; actual: string; variance: string }>(db, `select * from public.rpt_budget_vs_actual('2026-01-01','2026-01-31') where account_code = '6200'`);
    expect(Number(b[0].budget)).toBe(500); expect(Number(b[0].actual)).toBe(1000); expect(Number(b[0].variance)).toBe(500);
    expect((await q(db, `select * from public.rpt_expense_report('2026-01-01','2026-12-31')`)).length).toBeGreaterThan(0);
    expect((await q(db, `select * from public.rpt_tax_schedule('2026-01-01','2026-12-31')`)).length).toBeGreaterThan(0);
    expect((await q(db, `select * from public.rpt_journal_listing('2026-01-01','2026-12-31')`)).length).toBeGreaterThan(10);
  });
  it('export log is append-only', async () => {
    await db.query(`select public.log_export('trial_balance','xlsx','{}'::jsonb, 10, 'abc', false)`);
    await expectError(db.query(`delete from public.report_exports`), /append-only/);
  });
});
