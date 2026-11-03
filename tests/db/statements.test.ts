import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, asUser, q, acct, ACCOUNTANT } from './harness';

let db: PGlite;
type Row = { sort: string; line_type: string; label: string; code: string | null; amount: string; compare_amount: string | null; depth: number };
const lv = (fn: string, args: string) => q<Row>(db, `select * from public.${fn}(${args})`);
const find = (rows: Row[], label: string) => Number(rows.find((r) => r.label === label)?.amount);
const J = async (date: string, lines: [string, number, number][]) => db.query('select public.create_journal($1::date,$2,$3::jsonb)', [date, 'x', JSON.stringify(await Promise.all(lines.map(async ([c, d, cr]) => ({ account_id: await acct(db, c), debit: d, credit: cr }))))]);

beforeAll(async () => {
  db = await freshDb('resilience'); await asUser(db, ACCOUNTANT);
  await J('2026-01-02', [['1010', 1000000, 0], ['3000', 0, 1000000]]);
  await J('2026-01-10', [['1500', 200000, 0], ['1010', 0, 200000]]);                  // buy equipment for cash (investing)
  await J('2026-02-05', [['1100', 500000, 0], ['4100', 0, 500000]]);                  // credit sales
  await J('2026-02-20', [['1010', 300000, 0], ['1100', 0, 300000]]);                  // collect part
  await J('2026-03-01', [['5200', 120000, 0], ['2000', 0, 120000]]);                  // cost of sales on credit
  await J('2026-03-15', [['6200', 20000, 0], ['1010', 0, 20000]]);                    // utilities paid
  await J('2026-03-31', [['6300', 10000, 0], ['1510', 0, 10000]]);                    // depreciation (non-cash)
  await J('2026-04-02', [['2000', 50000, 0], ['1010', 0, 50000]]);                    // pay part of payable
  await J('2026-04-10', [['1010', 100000, 0], ['4900', 0, 100000]]);                  // other income in April
}, 60000);

describe('three-level statements', () => {
  it('balance sheet: level 1 summary, level 2 groups, level 3 accounts; balances; comparative', async () => {
    const l1 = await lv('rpt_balance_sheet_levels', `1,'2026-04-30'`), l2 = await lv('rpt_balance_sheet_levels', `2,'2026-04-30'`), l3 = await lv('rpt_balance_sheet_levels', `3,'2026-04-30'`);
    expect(l1.map((r) => r.label)).toEqual(['Total assets', 'Total liabilities', 'Total equity', 'Total liabilities and equity', 'Difference (assets less liabilities and equity)']);
    expect(find(l1, 'Difference (assets less liabilities and equity)')).toBe(0);
    expect(l2.length).toBeGreaterThan(l1.length); expect(l3.length).toBeGreaterThan(l2.length);
    expect(l2.filter((r) => r.label === 'Total equity').length).toBe(1);   // no duplicate equity line
    expect(l2.some((r) => r.label === 'Current assets')).toBe(true); expect(l2.some((r) => r.line_type === 'account')).toBe(false);
    expect(l3.some((r) => r.line_type === 'account' && r.code === '1010')).toBe(true); expect(l3.some((r) => r.label === 'Total current assets')).toBe(true);
    // totals agree across levels and with the ledger
    expect(find(l2, 'Total assets')).toBe(find(l3, 'Total assets'));
    const cash = 1000000 - 200000 + 300000 - 20000 - 50000 + 100000;
    expect(Number(l3.find((r) => r.code === '1010')!.amount)).toBe(cash);
    // retained earnings are derived: revenue 500000 + other 100000 - cos 120000 - util 20000 - dep 10000
    expect(Number(l3.find((r) => r.code === 'RE')!.amount)).toBe(450000);
    // comparative
    const cmp = await lv('rpt_balance_sheet_levels', `1,'2026-04-30','2026-02-28'`);
    expect(find(cmp, 'Total assets')).toBe(find(l1, 'Total assets'));
    expect(Number(cmp.find((r) => r.label === 'Total assets')!.compare_amount)).toBe(1500000);   // cash 1,100,000 + receivable 200,000 + equipment 200,000
  });
  it('income statement: gross / operating / net profit, levels and comparative', async () => {
    const l1 = await lv('rpt_income_statement_levels', `1,'2026-01-01','2026-04-30'`), l3 = await lv('rpt_income_statement_levels', `3,'2026-01-01','2026-04-30'`);
    expect(l1.map((r) => r.label)).toEqual(['Revenue', 'Gross profit', 'Operating profit', 'Net profit for the period']);
    expect(find(l1, 'Revenue')).toBe(500000); expect(find(l1, 'Gross profit')).toBe(380000); expect(find(l1, 'Operating profit')).toBe(450000);
    expect(find(l1, 'Net profit for the period')).toBe(450000);
    expect(l3.some((r) => r.label === 'Total revenue')).toBe(true); expect(l3.some((r) => r.code === '6300')).toBe(true);
    // agrees with the legacy flat report
    const flat = await q<{ section: string; amount: string }>(db, `select * from public.rpt_income_statement('2026-01-01','2026-04-30')`);
    const np = flat.filter((r) => r.section === 'income').reduce((s, r) => s + Number(r.amount), 0) - flat.filter((r) => r.section === 'expense').reduce((s, r) => s + Number(r.amount), 0);
    expect(np).toBe(450000);
    const cmp = await lv('rpt_income_statement_levels', `1,'2026-04-01','2026-04-30','2026-03-01','2026-03-31'`);
    expect(Number(cmp.find((r) => r.label === 'Net profit for the period')!.amount)).toBe(100000);
    expect(Number(cmp.find((r) => r.label === 'Net profit for the period')!.compare_amount)).toBe(-150000);   // March: -120000 -20000 -10000
  });
  it('cash flow: indirect and direct both reconcile to ledger cash and to each other', async () => {
    for (const m of ['indirect', 'direct']) {
      const l1 = await lv('rpt_cash_flow_levels', `1,'2026-01-01','2026-04-30',null,null,'${m}'`);
      expect(find(l1, 'Difference to ledger cash (should be nil)')).toBe(0);
      expect(find(l1, 'Net increase / (decrease) in cash and bank')).toBe(1000000 - 200000 + 300000 - 20000 - 50000 + 100000);
      expect(find(l1, 'Cash and bank at end of period')).toBe(1130000);
      expect(find(l1, 'Net cash from investing activities')).toBe(-200000);
      expect(find(l1, 'Net cash from financing activities')).toBe(1000000);
    }
    const ind = await lv('rpt_cash_flow_levels', `2,'2026-01-01','2026-04-30',null,null,'indirect'`);
    expect(ind.map((r) => r.label)).toContain('Net profit for the period'); expect(ind.map((r) => r.label)).toContain('Adjustments for non-cash items'); expect(ind.map((r) => r.label)).toContain('Changes in working capital');
    expect(find(ind, 'Net profit for the period')).toBe(450000); expect(find(ind, 'Adjustments for non-cash items')).toBe(10000);
    expect(find(ind, 'Net cash from operating activities')).toBe(330000);   // 450000 + 10000 - 200000 (receivable up) + 70000 (payable up)
    // presentation order: net profit first, then adjustments, working capital, and the section total last
    const lab3 = (await lv('rpt_cash_flow_levels', `3,'2026-01-01','2026-04-30',null,null,'indirect'`)).map((r) => r.label);
    const at = (l: string) => lab3.indexOf(l);
    expect(at('Net profit for the period')).toBe(0);
    expect(at('Depreciation and amortisation')).toBeLessThan(at('Adjustments for non-cash items'));
    expect(at('Adjustments for non-cash items')).toBeLessThan(at('Accounts Receivable'));
    expect(at('Accounts Payable')).toBeLessThan(at('Changes in working capital'));
    expect(at('Changes in working capital')).toBeLessThan(at('Net cash from operating activities'));
    expect(at('Net cash from operating activities')).toBeLessThan(at('Equipment') < 0 ? at('Fixed Assets - Cost') : at('Equipment'));
    expect(at('Net cash from financing activities')).toBeLessThan(at('Net increase / (decrease) in cash and bank'));
    const dir = await lv('rpt_cash_flow_levels', `3,'2026-01-01','2026-04-30',null,null,'direct'`);
    expect(dir.some((r) => r.line_type === 'account' && r.code === '6200')).toBe(true);
    const cmp = await lv('rpt_cash_flow_levels', `1,'2026-04-01','2026-04-30','2026-03-01','2026-03-31','indirect'`);
    expect(Number(cmp.find((r) => r.label === 'Cash and bank at end of period')!.compare_amount)).toBe(1000000 - 200000 + 300000 - 20000);
  });
  it('account groups can be overridden and level 3 rows carry account ids for drill-down', async () => {
    await db.query(`update public.accounts set statement_group = 'non_current_liabilities' where code = '2000'`);
    const l2 = await lv('rpt_balance_sheet_levels', `2,'2026-04-30'`);
    expect(l2.some((r) => r.label === 'Non-current liabilities')).toBe(true);
    const l3 = await q<{ account_id: string | null; line_type: string }>(db, `select * from public.rpt_balance_sheet_levels(3,'2026-04-30')`);
    expect(l3.filter((r) => r.line_type === 'account' && r.account_id).length).toBeGreaterThan(3);
    await db.query(`update public.accounts set statement_group = null where code = '2000'`);
  });
});
