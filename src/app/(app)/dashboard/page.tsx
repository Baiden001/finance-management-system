import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import { money } from '@/lib/format';
import { BarChart, Donut } from '@/components/Charts';
import { DataTable } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

const sum = (rows: { amount: number | string }[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);

export default async function Dashboard() {
  const sb = await supabaseServer();
  const now = new Date(); const y = now.getUTCFullYear(); const today = now.toISOString().slice(0, 10);
  const { data: cs } = await sb.from('company_settings').select('base_currency').limit(1).single();
  const cur = cs?.base_currency ?? 'GHS';
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)); return { label: d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }), from: d.toISOString().slice(0, 10), to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) }; });
  const [ytd, bs, exp, recent, ...monthly] = await Promise.all([
    sb.rpc('rpt_income_statement', { p_from: `${y}-01-01`, p_to: today }),
    sb.rpc('rpt_balance_sheet', { p_as_of: today }),
    sb.rpc('rpt_expense_report', { p_from: `${y}-01-01`, p_to: today }),
    sb.from('journals').select('id, journal_no, entry_date, description, status, source_type').order('journal_no', { ascending: false }).limit(6),
    ...months.map((m) => sb.rpc('rpt_income_statement', { p_from: m.from, p_to: m.to })),
  ]);
  const rows = (ytd.data ?? []) as { section: string; amount: number }[];
  const revenue = sum(rows.filter((r) => r.section === 'income')); const expenses = sum(rows.filter((r) => r.section === 'expense'));
  const assets = (bs.data ?? []) as { section: string; code: string; amount: number }[];
  const totalAssets = sum(assets.filter((r) => r.section === 'asset'));
  const { data: cash } = await sb.rpc('rpt_trial_balance', { p_from: `${y}-01-01`, p_to: today });
  const bank = ((cash ?? []) as { code: string; closing: number }[]).filter((r) => ['1010', '1020', '1030'].includes(r.code) || /^104/.test(r.code)).reduce((s, r) => s + Number(r.closing), 0);
  const byMonth = monthly.map((r) => (r.data ?? []) as { section: string; amount: number }[]);
  const byExp = new Map<string, number>(); ((exp.data ?? []) as { account_name: string; amount: number }[]).forEach((r) => byExp.set(r.account_name, (byExp.get(r.account_name) ?? 0) + Number(r.amount)));
  const top = [...byExp.entries()].sort((a, b) => b[1] - a[1]); const shown = top.slice(0, 5).map(([label, value]) => ({ label, value })); const other = top.slice(5).reduce((s, [, v]) => s + v, 0); if (other > 0) shown.push({ label: 'Other', value: other });
  const empty = (recent.data ?? []).length === 0;
  return (
    <div className="grid">
      <div><h1>Dashboard</h1><p className="muted" style={{ margin: 0 }}>Live position from posted journals, year to date.</p></div>
      <div className="grid kpis">
        <div className="card kpi"><div className="label">Revenue (YTD)</div><div className="value">{money(revenue, cur)}</div></div>
        <div className="card kpi"><div className="label">Expenses (YTD)</div><div className="value">{money(expenses, cur)}</div></div>
        <div className="card kpi"><div className="label">Net profit (YTD)</div><div className="value">{money(revenue - expenses, cur)}</div></div>
        <div className="card kpi"><div className="label">Cash and bank</div><div className="value">{money(bank, cur)}</div></div>
        <div className="card kpi"><div className="label">Total assets</div><div className="value">{money(totalAssets, cur)}</div></div>
      </div>
      {empty && <div className="alert warn">No journals have been posted yet. Start with <Link href="/journals">Transactions</Link>, or record opening balances.</div>}
      <div className="grid two">
        <div className="card"><h2>Revenue vs expenses, last 6 months</h2><BarChart labels={months.map((m) => m.label)} nameA="Revenue" nameB="Expenses" a={byMonth.map((r) => sum(r.filter((x) => x.section === 'income')))} b={byMonth.map((r) => sum(r.filter((x) => x.section === 'expense')))} /></div>
        <div className="card"><h2>Expense breakdown</h2>{shown.length ? <Donut items={shown} total={money(expenses, '')} /> : <p className="muted">No expenses posted this year.</p>}</div>
      </div>
      <div className="card">
        <div className="spread" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>Recent transactions</h2><span className="row"><Link className="btn alt sm" href="/journals">New journal</Link><Link className="btn alt sm" href="/receivables">Receivables</Link><Link className="btn alt sm" href="/bank">Reconcile bank</Link><Link className="btn alt sm" href="/reports">Generate report</Link></span></div>
        <DataTable cols={[{ key: 'entry_date', label: 'Date', format: 'date' }, { key: 'journal_no', label: 'JE #' }, { key: 'description', label: 'Description' }, { key: 'source_type', label: 'Source' }, { key: 'status', label: 'Status', format: 'pill' }]} rows={(recent.data ?? []) as Record<string, unknown>[]} empty="No transactions yet." />
      </div>
    </div>
  );
}
