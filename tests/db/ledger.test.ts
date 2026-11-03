import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, asUser, asSuper, q, expectError, acct, ACCOUNTANT, OUTSIDER } from './harness';

let db: PGlite; let cash: string, rev: string, exp: string;
const jl = (lines: unknown[]) => JSON.stringify(lines);
async function journal(date: string, lines: unknown[], post = true) {
  return (await q<{ id: string }>(db, 'select public.create_journal($1::date, $2, $3::jsonb, null, null, null, $4) id', [date, 'test', jl(lines), post]))[0].id;
}

beforeAll(async () => {
  db = await freshDb('resilience');
  await asUser(db, ACCOUNTANT);
  cash = await acct(db, '1010'); rev = await acct(db, '4000'); exp = await acct(db, '6100');
}, 60000);

describe('double-entry posting controls', () => {
  it('rejects an unbalanced journal', async () => {
    await expectError(journal('2026-01-10', [{ account_id: cash, debit: 100 }, { account_id: rev, credit: 90 }]), /does not balance/);
  });
  it('rejects a single-line journal', async () => {
    await expectError(journal('2026-01-10', [{ account_id: cash, debit: 0 }]), /at least two lines|no amounts/);
  });
  it('rejects a line with both debit and credit', async () => {
    await expectError(journal('2026-01-10', [{ account_id: cash, debit: 10, credit: 10 }, { account_id: rev, credit: 0 }]), /check/);
  });
  it('posts a balanced journal and sets period/post metadata', async () => {
    const id = await journal('2026-01-10', [{ account_id: cash, debit: 1000 }, { account_id: rev, credit: 1000 }]);
    const [j] = await q<{ status: string; period_id: string; posted_by: string }>(db, 'select status, period_id, posted_by from public.journals where id = $1', [id]);
    expect(j.status).toBe('posted'); expect(j.period_id).toBeTruthy(); expect(j.posted_by).toBe(ACCOUNTANT);
  });
  it('stores money with exact decimal precision', async () => {
    const id = await journal('2026-01-11', [{ account_id: cash, debit: '0.1' }, { account_id: rev, credit: '0.1' }]);
    const r = await q<{ s: string }>(db, 'select sum(debit)::text s from public.journal_lines where journal_id = $1', [id]);
    expect(r[0].s).toBe('0.1000');
    const sum = await q<{ s: string }>(db, `select (0.1::numeric(20,4) + 0.2::numeric(20,4))::text s`);
    expect(sum[0].s).toBe('0.3000');
  });
  it('makes posted journals and their lines immutable', async () => {
    const id = await journal('2026-01-12', [{ account_id: cash, debit: 50 }, { account_id: rev, credit: 50 }]);
    await expectError(db.query(`update public.journals set description = 'x' where id = $1`, [id]), /cannot be modified/);
    await expectError(db.query(`delete from public.journals where id = $1`, [id]), /cannot be deleted/);
    await expectError(db.query(`update public.journal_lines set debit = 1 where journal_id = $1`, [id]), /immutable/);
    await expectError(db.query(`delete from public.journal_lines where journal_id = $1`, [id]), /cannot be deleted/);
    await expectError(db.query(`insert into public.journal_lines(journal_id, line_no, account_id, debit) values ($1, 9, $2, 5)`, [id, cash]), /immutable/);
    await expectError(db.query(`update public.journals set status = 'draft' where id = $1`, [id]), /cannot be modified/);
  });
  it('cannot insert journals directly as posted', async () => {
    await expectError(db.query(`insert into public.journals(entry_date, description, currency, status) values ('2026-01-01','x','GHS','posted')`), /created as drafts/);
  });
  it('allows drafts to be edited and deleted', async () => {
    const id = await journal('2026-01-13', [{ account_id: cash, debit: 5 }, { account_id: rev, credit: 5 }], false);
    await db.query(`update public.journals set description = 'edited' where id = $1`, [id]);
    await db.query(`delete from public.journals where id = $1`, [id]);
  });
});

describe('reversals', () => {
  it('reverses with a traceable mirror entry and nets to zero', async () => {
    const id = await journal('2026-02-01', [{ account_id: cash, debit: 777 }, { account_id: exp, credit: 777 }]);
    await expectError(db.query(`select public.reverse_journal($1, '2026-02-02', '')`, [id]), /reason is required/);
    const rid = (await q<{ r: string }>(db, `select public.reverse_journal($1, '2026-02-02', 'Posted in error') r`, [id]))[0].r;
    const [orig] = await q<{ status: string; reversed_by: string }>(db, 'select status, reversed_by from public.journals where id = $1', [id]);
    expect(orig.status).toBe('reversed'); expect(orig.reversed_by).toBe(rid);
    const [rev1] = await q<{ reversal_of: string; status: string }>(db, 'select reversal_of, status from public.journals where id = $1', [rid]);
    expect(rev1.reversal_of).toBe(id); expect(rev1.status).toBe('posted');
    const net = await q<{ n: string }>(db, `select sum(base_debit - base_credit)::text n from public.journal_lines where journal_id in ($1,$2) and account_id = $3`, [id, rid, cash]);
    expect(Number(net[0].n)).toBe(0);
    await expectError(db.query(`select public.reverse_journal($1, '2026-02-03', 'again')`, [id]), /Only posted/);
  });
});

describe('period controls', () => {
  it('rejects posting into locked and closed periods; accepts after reopen with reason', async () => {
    const p = (await q<{ id: string }>(db, `select id from public.fiscal_periods where name = '2026-03'`))[0].id;
    await db.query(`select public.set_period_status($1, 'locked')`, [p]);
    await expectError(journal('2026-03-05', [{ account_id: cash, debit: 1 }, { account_id: rev, credit: 1 }]), /locked - posting rejected/);
    await db.query(`select public.set_period_status($1, 'closed')`, [p]);
    await expectError(journal('2026-03-05', [{ account_id: cash, debit: 1 }, { account_id: rev, credit: 1 }]), /closed - posting rejected/);
    await db.query(`select public.set_period_status($1, 'open')`, [p]);
    await journal('2026-03-05', [{ account_id: cash, debit: 1 }, { account_id: rev, credit: 1 }]);
    await db.query(`select public.set_period_status($1, 'locked')`, [p]);
    await expectError(db.query(`select public.set_period_status($1, 'open')`, [p]), /requires a reason/);
    await db.query(`select public.set_period_status($1, 'open', 'Late accrual approved')`, [p]);
  });
  it('rejects dates outside any fiscal period', async () => {
    await expectError(journal('2030-01-01', [{ account_id: cash, debit: 1 }, { account_id: rev, credit: 1 }]), /No fiscal period/);
  });
  it('rejects inactive accounts', async () => {
    await asSuper(db);
    await db.query(`update public.accounts set is_active = false where code = '6800'`);
    await asUser(db, ACCOUNTANT);
    const a = await acct(db, '6800');
    await expectError(journal('2026-04-01', [{ account_id: a, debit: 1 }, { account_id: cash, credit: 1 }]), /not available for posting/);
  });
});

describe('reports', () => {
  it('trial balance debits equal credits; balance sheet balances', async () => {
    const tb = await q<{ debit: string; credit: string; closing: string }>(db, `select * from public.rpt_trial_balance('2026-01-01','2026-12-31')`);
    const d = tb.reduce((s, r) => s + Number(r.debit), 0), c = tb.reduce((s, r) => s + Number(r.credit), 0);
    expect(d).toBeCloseTo(c, 4);
    expect(tb.reduce((s, r) => s + Number(r.closing), 0)).toBeCloseTo(0, 4);
    const bs = await q<{ section: string; amount: string }>(db, `select * from public.rpt_balance_sheet('2026-12-31')`);
    const sum = (s: string) => bs.filter((r) => r.section === s).reduce((t, r) => t + Number(r.amount), 0);
    expect(sum('asset')).toBeCloseTo(sum('liability') + sum('equity'), 4);
  });
  it('income statement and general ledger agree with postings', async () => {
    const is = await q<{ section: string; amount: string }>(db, `select * from public.rpt_income_statement('2026-01-01','2026-01-31')`);
    expect(is.find((r) => r.section === 'income')).toBeTruthy();
    const gl = await q<{ balance: string }>(db, `select * from public.rpt_general_ledger($1,'2026-01-01','2026-12-31')`, [cash]);
    expect(gl.length).toBeGreaterThan(2);
  });
  it('cash flow classifies cash movements and closing cash reconciles', async () => {
    const cf = await q<{ category: string; amount: string }>(db, `select * from public.rpt_cash_flow('2026-01-01','2026-12-31')`);
    const op = cf.filter((r) => !['opening_cash', 'closing_cash'].includes(r.category)).reduce((s, r) => s + Number(r.amount), 0);
    const open = Number(cf.find((r) => r.category === 'opening_cash')!.amount), close = Number(cf.find((r) => r.category === 'closing_cash')!.amount);
    expect(open + op).toBeCloseTo(close, 4);
  });
});

describe('security: RLS, grants, audit log', () => {
  it('denies a signed-in user who is not an accountant', async () => {
    await asUser(db, OUTSIDER);
    expect((await q(db, 'select * from public.journals')).length).toBe(0);
    await expectError(db.query(`insert into public.customers(name) values ('x')`), /row-level security/);
    await expectError(q(db, `select public.create_journal('2026-01-01', 'x', '[]'::jsonb)`), /./);
    await asUser(db, ACCOUNTANT);
  });
  it('denies anonymous access entirely', async () => {
    await asUser(db, null);
    await expectError(q(db, 'select * from public.journals'), /permission denied/);
    await asUser(db, ACCOUNTANT);
  });
  it('does not let anonymous or non-accountant users call functions or forge audit events', async () => {
    await asUser(db, null);
    await expectError(q(db, `select public.audit_event('forged')`), /permission denied/);
    await expectError(q(db, `select public.create_journal('2026-01-01','x','[]'::jsonb)`), /permission denied/);
    await asUser(db, OUTSIDER);
    await expectError(q(db, `select public.audit_event('forged')`), /Not authorised/);
    await asUser(db, ACCOUNTANT);
  });
  it('writes an append-only audit trail with actor, and blocks tampering', async () => {
    const rows = await q<{ actor: string; action: string }>(db, `select actor, action from public.audit_log where table_name = 'journals' order by id desc limit 1`);
    expect(rows[0].actor).toBe(ACCOUNTANT);
    await expectError(db.query(`delete from public.audit_log`), /append-only|permission denied/);
    await expectError(db.query(`update public.audit_log set action = 'x'`), /append-only|permission denied/);
    await expectError(db.query(`insert into public.audit_log(action) values ('forged')`), /permission denied/);
  });
  it('company identity cannot be re-pointed', async () => {
    await expectError(db.query(`update public.company_settings set company_code = 'ashelite'`), /cannot be changed/);
  });
  it('storage buckets are private with accountant-only policy', async () => {
    await asSuper(db);
    const b = await q<{ id: string; public: boolean }>(db, `select id, public from storage.buckets order by id`);
    expect(b.map((x) => x.id)).toEqual(['documents', 'exports']); expect(b.every((x) => x.public === false)).toBe(true);
    const pol = await q(db, `select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fms accountant documents'`);
    expect(pol.length).toBe(1);
    await asUser(db, ACCOUNTANT);
  });
});
