import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, asUser, q, expectError, acct, ACCOUNTANT } from './harness';

let db: PGlite; let cust: string, supp: string, bank: string, rev: string, exp: string;
const num = async (sql: string, p: unknown[] = []) => Number((await q<{ v: string }>(db, sql, p))[0].v);
const ctl = (code: string, sign: 1 | -1) => num(`select coalesce(sum((base_debit - base_credit) * ${sign}),0) v from public.journal_lines where account_id = (select id from public.accounts where code = '${code}')`);
async function invoice(amount: number, tax = 0, date = '2026-05-05') {
  const id = (await q<{ id: string }>(db, `insert into public.invoices(customer_id, issue_date, due_date) values ($1,$2::date,$2::date + 30) returning id`, [cust, date]))[0].id;
  await db.query(`insert into public.invoice_lines(invoice_id, description, quantity, unit_price, tax_rate, revenue_account_id) values ($1,'Work',1,$2,$3,$4)`, [id, amount, tax, rev]);
  await db.query('select public.issue_invoice($1)', [id]); return id;
}
async function bill(amount: number, ret = 0, date = '2026-05-06') {
  const id = (await q<{ id: string }>(db, `insert into public.bills(supplier_id, issue_date, due_date, retention_pct) values ($1,$2::date,$2::date + 30,$3) returning id`, [supp, date, ret]))[0].id;
  await db.query(`insert into public.bill_lines(bill_id, description, quantity, unit_price, tax_rate, expense_account_id) values ($1,'Works',1,$2,0,$3)`, [id, amount, exp]);
  await db.query('select public.approve_bill($1)', [id]); return id;
}
const arAging = async () => Number((await q<{ total: string }>(db, `select coalesce(sum(total),0) total from public.rpt_ar_aging('2026-06-30')`))[0].total);
const apAging = async () => Number((await q<{ total: string }>(db, `select coalesce(sum(total),0) total from public.rpt_ap_aging('2026-06-30')`))[0].total);

beforeAll(async () => {
  db = await freshDb('resilience'); await asUser(db, ACCOUNTANT);
  rev = await acct(db, '4000'); exp = await acct(db, '6200');
  cust = (await q<{ id: string }>(db, `insert into public.customers(name) values ('Kofi') returning id`))[0].id;
  supp = (await q<{ id: string }>(db, `insert into public.suppliers(name) values ('BuildCo') returning id`))[0].id;
  bank = (await q<{ id: string }>(db, `select id from public.bank_accounts limit 1`))[0].id;
}, 60000);

describe('credit notes and voids', () => {
  it('credits part of an invoice with pro-rata tax; open balance, aging and AR control all agree', async () => {
    const inv = await invoice(1000, 15);                      // total 1150
    const cn = (await q<{ credit_invoice: string }>(db, `select public.credit_invoice($1, 200, 'Price adjustment', '2026-05-20') credit_invoice`, [inv]))[0].credit_invoice;
    expect(await num('select total v from public.credit_notes where id = $1', [cn])).toBe(230);       // 200 + 15%
    expect(await num('select total - public.invoice_paid(id) v from public.invoices where id = $1', [inv])).toBe(920);
    expect(await arAging()).toBe(await ctl('1100', 1));
    await expectError(db.query(`select public.credit_invoice($1, 5000, 'too much')`, [inv]), /exceeds the open balance/);
    await expectError(db.query(`update public.credit_notes set total = 1 where id = $1`, [cn]), /cannot be edited/);
    const vat = await q<{ section: string; tax_amount: string }>(db, `select * from public.rpt_vat_return('2026-05-01','2026-05-31')`);
    expect(Number(vat.find((r) => r.section === 'Net VAT payable / (refundable)')!.tax_amount)).toBe(150 - 30);
  });
  it('unapplied credit notes sit on the customer account and can be applied later', async () => {
    const inv = await invoice(500, 0, '2026-05-10');
    const cn = (await q<{ id: string }>(db, `insert into public.credit_notes(kind, customer_id, issue_date) values ('sales',$1,'2026-05-25') returning id`, [cust]))[0].id;
    await db.query(`insert into public.credit_note_lines(credit_note_id, description, quantity, unit_price, account_id) values ($1,'Goodwill',1,100,$2)`, [cn, rev]);
    await db.query('select public.issue_credit_note($1)', [cn]);
    expect(await arAging()).toBe(await ctl('1100', 1));
    await db.query(`select public.apply_credit_note($1,$2,60,'2026-05-26')`, [cn, inv]);
    await expectError(db.query(`select public.apply_credit_note($1,$2,60,'2026-05-26')`, [cn, inv]), /unapplied balance 40/);
    expect(await arAging()).toBe(await ctl('1100', 1));
  });
  it('voids an unsettled invoice by reversal; blocks voiding a paid one', async () => {
    const before = await ctl('1100', 1);
    const inv = await invoice(300, 0, '2026-05-12');
    await db.query(`select public.void_invoice($1,'Raised in error','2026-05-13')`, [inv]);
    expect((await q<{ status: string }>(db, 'select status from public.invoices where id = $1', [inv]))[0].status).toBe('void');
    expect(await ctl('1100', 1)).toBe(before);
    const paid = await invoice(100, 0, '2026-05-14');
    await db.query(`select public.record_payment('in',$1,'2026-05-15',100,'GHS',$2,$3::jsonb)`, [cust, bank, JSON.stringify([{ invoice_id: paid, amount: 100 }])]);
    await expectError(db.query(`select public.void_invoice($1,'x')`, [paid]), /credit note instead/);
  });
});

describe('retention, withholding tax and debit notes', () => {
  it('holds retention on a bill, pays the rest, then releases; AP sub-ledger equals control throughout', async () => {
    const b = await bill(1000, 10);
    expect(await num('select retention_amount v from public.bills where id = $1', [b])).toBe(100);
    expect(await ctl('2400', -1)).toBe(100);
    const apBefore = await apAging(); expect(apBefore).toBe(await ctl('2000', -1));
    await expectError(db.query(`select public.record_payment('out',$1,'2026-05-20',1000,'GHS',$2,$3::jsonb)`, [supp, bank, JSON.stringify([{ bill_id: b, amount: 1000 }])]), /exceeds the open balance 900/);
    await db.query(`select public.record_payment('out',$1,'2026-05-20',900,'GHS',$2,$3::jsonb,'bank','CHQ-1')`, [supp, bank, JSON.stringify([{ bill_id: b, amount: 900 }])]);
    await db.query(`select public.release_retention($1,'2026-06-10')`, [b]);
    expect(await ctl('2400', -1)).toBe(0);
    expect(await num('select public.bill_open($1) v', [b])).toBe(100);
    expect(await apAging()).toBe(await ctl('2000', -1));
    await expectError(db.query(`select public.void_bill($1,'x')`, [b]), /payments or credits/);
  });
  it('books withholding tax on supplier payments and customer receipts and reports it', async () => {
    const b = await bill(2000, 0, '2026-06-02');
    await db.query(`select public.record_payment('out',$1,'2026-06-10',2000,'GHS',$2,$3::jsonb,'bank','WHT-OUT',null,100)`, [supp, bank, JSON.stringify([{ bill_id: b, amount: 2000 }])]);
    expect(await ctl('2240', -1)).toBe(100);
    const inv = await invoice(1000, 0, '2026-06-03');
    await db.query(`select public.record_payment('in',$1,'2026-06-12',1000,'GHS',$2,$3::jsonb,'bank','WHT-IN',null,50)`, [cust, bank, JSON.stringify([{ invoice_id: inv, amount: 1000 }])]);
    expect(await ctl('1170', 1)).toBe(50);
    expect(await num(`select sum(base_debit - base_credit) v from public.journal_lines l join public.journals j on j.id = l.journal_id where j.source_type = 'payment' and j.reference in ('WHT-IN','WHT-OUT')`)).toBe(0);
    const s = await q<{ direction: string; tax_withheld: string }>(db, `select * from public.rpt_wht_schedule('2026-06-01','2026-06-30')`);
    expect(s.length).toBe(2); expect(s.map((r) => Number(r.tax_withheld)).sort((a, b) => a - b)).toEqual([50, 100]);
    await expectError(db.query(`select public.record_payment('in',$1,'2026-06-12',100,'GHS',$2,'[]'::jsonb,'bank','x',null,100)`, [cust, bank]), /Withholding must be/);
    expect(await arAging()).toBe(await ctl('1100', 1));
  });
  it('issues a supplier debit note that reduces the bill', async () => {
    const b = await bill(400, 0, '2026-06-05');
    await db.query(`select public.credit_bill($1, 100, 'Damaged goods', '2026-06-08')`, [b]);
    expect(await num('select public.bill_open($1) v', [b])).toBe(300);
    expect(await apAging()).toBe(await ctl('2000', -1));
  });
});

describe('recurring entries, opening balances, year-end', () => {
  it('creates a recurring journal from a posted one and catches up due periods', async () => {
    const jid = (await q<{ id: string }>(db, `select public.create_journal('2026-01-31','Office rent',$1::jsonb) id`, [JSON.stringify([{ account_id: await acct(db, '6100'), debit: 800 }, { account_id: await acct(db, '1010'), credit: 800 }])]))[0].id;
    await db.query(`select public.recurring_from_journal($1,'Rent','monthly','2026-02-28')`, [jid]);
    const r = (await q<{ run_recurring: { posted: number; failed: unknown[] } }>(db, `select public.run_recurring('2026-04-30') run_recurring`))[0].run_recurring;
    expect(r.posted).toBe(3); expect(r.failed).toEqual([]);
    expect(await num(`select runs v from public.recurring_journals where name = 'Rent'`)).toBe(3);
    expect((await q<{ run_recurring: { posted: number } }>(db, `select public.run_recurring('2026-04-30') run_recurring`))[0].run_recurring.posted).toBe(0);
    // a locked period is reported, not silently skipped, and does not stop the run
    const p = (await q<{ id: string }>(db, `select id from public.fiscal_periods where name = '2026-05'`))[0].id;
    await db.query(`select public.set_period_status($1,'locked')`, [p]);
    const r2 = (await q<{ run_recurring: { posted: number; failed: { error: string }[] } }>(db, `select public.run_recurring('2026-05-31') run_recurring`))[0].run_recurring;
    expect(r2.failed[0].error).toMatch(/locked/); await db.query(`select public.set_period_status($1,'open','test')`, [p]);
  });
  it('posts opening balances, optionally plugging the difference to Opening Balance Equity', async () => {
    const lines = JSON.stringify([{ account_id: await acct(db, '1020'), debit: 5000 }]);
    await expectError(db.query(`select public.post_opening_balances('2026-01-01',$1::jsonb)`, [lines]), /do not balance/);
    await db.query(`select public.post_opening_balances('2026-01-01',$1::jsonb,true)`, [lines]);
    expect(await ctl('3900', -1)).toBe(5000);
  });
  it('closes a fiscal year: blocks with drafts, then locks periods and opens the next year', async () => {
    const fy = (await q<{ id: string }>(db, `select id from public.fiscal_years where name = 'FY2026'`))[0].id;
    const d = (await q<{ id: string }>(db, `select public.create_journal('2026-12-01','draft',$1::jsonb,null,null,null,false) id`, [JSON.stringify([{ account_id: await acct(db, '1010'), debit: 1 }, { account_id: await acct(db, '4000'), credit: 1 }])]))[0].id;
    await expectError(db.query('select public.close_fiscal_year($1)', [fy]), /draft journal/);
    await db.query('delete from public.journals where id = $1', [d]);
    const next = (await q<{ close_fiscal_year: string }>(db, 'select public.close_fiscal_year($1)', [fy]))[0].close_fiscal_year;
    expect(next).toBeTruthy();
    expect(await num(`select count(*) v from public.fiscal_periods where fiscal_year_id = $1 and status = 'locked'`, [fy])).toBe(12);
    expect((await q<{ name: string }>(db, 'select name from public.fiscal_years where id = $1', [next]))[0].name).toBe('FY2027');
    await expectError(db.query('select public.close_fiscal_year($1)', [fy]), /already closed/);
  });
});
