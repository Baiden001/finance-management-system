'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { REPORTS, rpcArgs, type ParamName, type ReportDef } from '@/lib/reports';
import { isoDate, money, num, yearEnd, yearStart } from '@/lib/format';
import type { Opt } from './types';

const LABEL: Record<ParamName, string> = { from: 'From', to: 'To', as_of: 'As of', run: 'Payroll run', year: 'Year', month: 'Month', account: 'Account', bank: 'Bank account', statement_balance: 'Statement balance', method: 'Method', level: 'Level of detail', compare_as_of: 'Compare with (as of)', compare_from: 'Compare from', compare_to: 'Compare to' };
const LEVELS: Opt[] = [{ value: '1', label: 'Level 1 - Summary' }, { value: '2', label: 'Level 2 - Grouped' }, { value: '3', label: 'Level 3 - Detailed' }];
const METHODS: Opt[] = [{ value: 'indirect', label: 'Indirect (from profit)' }, { value: 'direct', label: 'Direct (cash receipts and payments)' }];
const shiftYear = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() + n); if (x.getUTCMonth() !== Number(d.slice(5, 7)) - 1) x.setUTCDate(0); return x.toISOString().slice(0, 10); };
const isNum = (t?: string) => t === 'money' || t === 'number' || t === 'pct';

export default function ReportsClient({ company, mfaNote }: { company: 'resilience' | 'ashelite'; mfaNote: boolean }) {
  const defs = useMemo(() => REPORTS.filter((r) => !r.company || r.company === company), [company]);
  const groups = [...new Set(defs.map((r) => r.group))];
  const now = new Date();
  const [key, setKey] = useState(defs[0].key); const def = (defs.find((r) => r.key === key) ?? defs[0]) as ReportDef;
  const [p, setP] = useState<Record<string, string>>({ from: yearStart(now), to: yearEnd(now), as_of: isoDate(now), year: String(now.getUTCFullYear()), month: String(now.getUTCMonth() + 1), level: '2', method: 'indirect' });
  const [compare, setCompare] = useState(false);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const [runs, setRuns] = useState<Opt[]>([]); const [accts, setAccts] = useState<Opt[]>([]); const [banks, setBanks] = useState<Opt[]>([]);
  useEffect(() => { (async () => {
    const sb = supabaseBrowser();
    const [r, a, b] = await Promise.all([sb.from('payroll_runs').select('id, period_year, period_month, kind, seq, status').order('period_year', { ascending: false }).order('period_month', { ascending: false }), sb.from('accounts').select('id, code, name').order('code'), sb.from('bank_accounts').select('id, name').order('name')]);
    setRuns((r.data ?? []).map((x) => ({ value: x.id as string, label: `${x.period_year}-${String(x.period_month).padStart(2, '0')} ${x.kind} #${x.seq} (${x.status})` })));
    setAccts((a.data ?? []).map((x) => ({ value: x.id as string, label: `${x.code} ${x.name}` }))); setBanks((b.data ?? []).map((x) => ({ value: x.id as string, label: x.name as string })));
  })(); }, []);
  // open a report from a link (drill-down from a statement line)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search); const k = sp.get('report'); if (!k || !defs.some((d) => d.key === k)) return;
    setKey(k); const next = { ...p }; sp.forEach((v, n) => { if (n !== 'report') next[n] = v; }); setP(next); const cmp = !!(sp.get('compare_from') || sp.get('compare_as_of')); setCompare(cmp);
    void run(defs.find((d) => d.key === k) as ReportDef, next, cmp);
  }, []);
  useEffect(() => { setRows(null); setErr(''); setNote(''); }, [key]);
  const set = (k: string, v: string) => setP({ ...p, [k]: v });
  const toggleCompare = (on: boolean) => {
    setCompare(on); const n = { ...p };
    if (on) { n.compare_as_of = shiftYear(p.as_of, -1); n.compare_from = shiftYear(p.from, -1); n.compare_to = shiftYear(p.to, -1); } else { delete n.compare_as_of; delete n.compare_from; delete n.compare_to; }
    setP(n);
  };
  const shown = def.params.filter((n) => !def.optional?.includes(n) || compare);
  const ready = def.params.filter((n) => !def.optional?.includes(n)).every((n) => p[n]);
  const effective = (v: Record<string, string>, cmp: boolean) => { const o = { ...v }; if (!cmp) { delete o.compare_as_of; delete o.compare_from; delete o.compare_to; } return o; };
  async function run(d: ReportDef = def, v: Record<string, string> = p, cmp: boolean = compare) {
    setBusy(true); setErr('');
    try {
      const sb = supabaseBrowser(); const { data, error } = await sb.rpc(d.rpc, rpcArgs(d, effective(v, cmp))); if (error) throw new Error(error.message);
      setRows((data ?? []) as Record<string, unknown>[]);
      if (d.statement) { const { data: nt } = await sb.from('report_notes').select('body').eq('report_key', d.key).maybeSingle(); setNote(nt?.body ?? ''); }
    } catch (e) { setErr((e as Error).message); setRows(null); }
    setBusy(false);
  }
  const qs = (f: string) => new URLSearchParams({ report: key, format: f, ...Object.fromEntries(def.params.filter((n) => shown.includes(n)).map((n) => [n, p[n] ?? ''])) }).toString();
  const cols = def.cols.filter((c) => c.key !== 'compare_amount' || (rows ?? []).some((r) => r[c.key] !== null && r[c.key] !== undefined));
  const drill = (r: Record<string, unknown>) => {
    const from = def.key === 'balance_sheet' ? yearStart(new Date((p.as_of ?? isoDate()) + 'T00:00:00Z')) : p.from; const to = def.key === 'balance_sheet' ? p.as_of : p.to;
    window.location.href = `/reports?${new URLSearchParams({ report: 'general_ledger', account: String(r.account_id), from, to })}`;
  };
  const sel = (n: ParamName, opts: Opt[], blank = true) => <label className="f" key={n}>{LABEL[n]}<select value={p[n] ?? ''} onChange={(e) => set(n, e.target.value)}>{blank && <option value="">Select</option>}{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
  return (
    <div className="grid">
      <div><h1>Reports</h1><p className="muted" style={{ margin: 0 }}>Preview on screen, then export branded PDF, Excel or CSV for management. Management has no system access; exports are logged.</p></div>
      <div className="card">
        <div className="form">
          <label className="f">Report<select value={key} onChange={(e) => setKey(e.target.value)}>{groups.map((g) => <optgroup key={g} label={g}>{defs.filter((r) => r.group === g).map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}</optgroup>)}</select></label>
          {shown.map((n) => n === 'run' ? sel(n, runs) : n === 'account' ? sel(n, accts) : n === 'bank' ? sel(n, banks) : n === 'level' ? sel(n, LEVELS, false) : n === 'method' && def.statement ? sel(n, METHODS, false)
            : <label className="f" key={n}>{LABEL[n]}<input type={n.includes('from') || n.includes('to') || n.includes('as_of') ? 'date' : 'number'} step="any" value={p[n] ?? ''} onChange={(e) => set(n, e.target.value)} /></label>)}
          {def.optional && <label className="row" style={{ alignSelf: 'end', minHeight: 36 }}><input type="checkbox" checked={compare} onChange={(e) => toggleCompare(e.target.checked)} /> Compare with a prior period</label>}
        </div>
        {def.statement && <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>Level 1 shows headline totals, level 2 adds group sub-totals, level 3 lists every account. At level 3, click an account to open its general ledger.</p>}
        {def.sensitive && <div className="alert warn">Restricted payroll report. {mfaNote ? 'Multi-factor authentication is required to export it.' : ''} Export events are audited.</div>}
        <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={() => run()} disabled={!ready || busy}>Preview</button>
          {(['pdf', 'xlsx', 'csv'] as const).map((f) => <a key={f} className="btn alt" aria-disabled={!ready} style={{ textDecoration: 'none', pointerEvents: ready ? 'auto' : 'none', opacity: ready ? 1 : 0.5 }} href={`/api/export?${qs(f)}`}>Export {f.toUpperCase()}</a>)}</div>
      </div>
      {err && <div className="alert err" role="alert">{err}</div>}
      {rows && (
        <div className="tablewrap"><table><thead><tr>{cols.map((c) => <th key={c.key} className={isNum(c.type) ? 'r' : undefined}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => {
            const lt = String(r.line_type ?? ''); const bold = ['total', 'group_total', 'header', 'check'].includes(lt); const bad = lt === 'check' && Math.abs(Number(r.amount)) > 0.005;
            return <tr key={i} style={{ fontWeight: bold ? 700 : 400, background: lt === 'total' ? '#f7f8f4' : undefined, color: bad ? 'var(--danger)' : undefined }}>
              {cols.map((c, ci) => <td key={c.key} className={isNum(c.type) ? 'r' : undefined} style={ci === 0 && lt ? { paddingLeft: 12 + Number(r.depth ?? 0) * 18, borderTop: lt === 'total' ? '1px solid #b8bdb0' : undefined } : lt === 'total' ? { borderTop: '1px solid #b8bdb0' } : undefined}>
                {r[c.key] === null || r[c.key] === undefined ? '' : ci === 0 && r.account_id ? <button className="btn alt sm" style={{ border: 0, background: 'none', color: 'var(--brand)', padding: 0, minHeight: 0, textDecoration: 'underline', fontWeight: 400 }} onClick={() => drill(r)}>{String(r[c.key])}</button> : c.type === 'money' ? money(r[c.key], '') : isNum(c.type) ? num(r[c.key]) : String(r[c.key])}</td>)}
            </tr>; })}</tbody></table>
          {rows.length === 0 && <div className="empty">No data for these parameters.</div>}</div>
      )}
      {rows && note && <div className="card"><h2>Notes</h2><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{note}</p></div>}
    </div>
  );
}
