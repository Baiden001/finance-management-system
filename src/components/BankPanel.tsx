'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { isoDate, num } from '@/lib/format';

type BA = { id: string; account_id: string; name: string; currency: string };
type Stmt = { id: string; line_date: string; description: string | null; amount: number; status: string };
type JL = { id: string; debit: number; credit: number; description: string | null; journals: { entry_date: string; description: string; currency: string; status: string } };
type Rec = { section: string; item_date: string; description: string; amount: number };

function parseCsv(text: string): { date: string; description: string; amount: number }[] {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
  const out: { date: string; description: string; amount: number }[] = [];
  for (const r of rows) { const amt = Number((r[r.length - 1] ?? '').replace(/,/g, '')); if (/^\d{4}-\d{2}-\d{2}$/.test(r[0]) && Number.isFinite(amt)) out.push({ date: r[0], description: r.slice(1, -1).join(' '), amount: amt }); }
  return out;
}

export default function BankPanel() {
  const sb = supabaseBrowser();
  const [banks, setBanks] = useState<BA[]>([]); const [bank, setBank] = useState(''); const [stmts, setStmts] = useState<Stmt[]>([]); const [ledger, setLedger] = useState<JL[]>([]);
  const [asOf, setAsOf] = useState(isoDate()); const [bal, setBal] = useState(''); const [rec, setRec] = useState<Rec[]>([]); const [pick, setPick] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ k: 'ok' | 'err'; t: string } | null>(null);
  useEffect(() => { (async () => { const { data } = await sb.from('bank_accounts').select('id, account_id, name, currency').eq('is_active', true).order('name'); setBanks((data ?? []) as BA[]); if (data?.[0]) setBank(data[0].id as string); })(); }, []);
  const cur = banks.find((b) => b.id === bank);
  async function load() {
    if (!cur) return;
    const [s, l, m] = await Promise.all([
      sb.from('bank_statement_lines').select('id, line_date, description, amount, status').eq('bank_account_id', bank).order('line_date'),
      sb.from('journal_lines').select('id, debit, credit, description, journals!inner(entry_date, description, currency, status)').eq('account_id', cur.account_id).in('journals.status', ['posted', 'reversed']),
      sb.from('bank_statement_lines').select('matched_line_id').eq('bank_account_id', bank).not('matched_line_id', 'is', null),
    ]);
    const matched = new Set((m.data ?? []).map((x) => x.matched_line_id as string));
    setStmts((s.data ?? []) as Stmt[]); setLedger(((l.data ?? []) as unknown as JL[]).filter((x) => !matched.has(x.id) && x.journals.currency === cur.currency));
    if (bal !== '') { const r = await sb.rpc('rpt_bank_reconciliation', { p_bank: bank, p_as_of: asOf, p_statement_balance: Number(bal) }); setRec((r.data ?? []) as Rec[]); }
  }
  useEffect(() => { void load(); }, [bank]);
  const wrap = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => { const { error } = await fn(); setMsg(error ? { k: 'err', t: error.message } : { k: 'ok', t: ok }); await load(); };
  async function importCsv(file: File) {
    const rows = parseCsv(await file.text());
    if (!rows.length) { setMsg({ k: 'err', t: 'No valid rows. Expected columns: date (YYYY-MM-DD), description, amount (positive = money in, negative = money out).' }); return; }
    await wrap(() => sb.from('bank_statement_lines').insert(rows.map((r) => ({ bank_account_id: bank, line_date: r.date, description: r.description, amount: r.amount, import_batch: file.name }))), `Imported ${rows.length} statement lines.`);
  }
  const summary = rec.filter((r) => r.section === 'summary');
  const diff = summary.find((r) => r.description.startsWith('Unexplained'));
  return (
    <div className="grid">
      <div className="spread"><div><h1>Bank & Cash</h1><p className="muted" style={{ margin: 0 }}>Import statements, match them to ledger entries, and reconcile to the statement balance.</p></div>
        <label className="f">Account<select value={bank} onChange={(e) => setBank(e.target.value)}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</select></label></div>
      {msg && <div className={`alert ${msg.k}`} role={msg.k === 'err' ? 'alert' : 'status'}>{msg.t}</div>}
      <div className="card"><h2>1. Import statement (CSV)</h2><input type="file" accept=".csv,text/csv" aria-label="Statement CSV" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} /><p className="muted" style={{ fontSize: 12 }}>Columns: date (YYYY-MM-DD), description, amount. Money in is positive, money out negative.</p></div>
      <div className="card"><h2>2. Match statement lines to ledger entries</h2>
        <div className="tablewrap"><table><thead><tr><th>Date</th><th>Statement description</th><th className="r">Amount</th><th>Status</th><th>Ledger entry</th><th /></tr></thead><tbody>
          {stmts.map((s) => { const cands = ledger.filter((l) => Number(l.debit) - Number(l.credit) === Number(s.amount)); return (
            <tr key={s.id}><td>{s.line_date}</td><td>{s.description}</td><td className="r">{num(s.amount)}</td><td><span className={`pill ${s.status}`}>{s.status}</span></td>
              <td>{s.status === 'unmatched' && <select aria-label="Candidate ledger entry" value={pick[s.id] ?? ''} onChange={(e) => setPick({ ...pick, [s.id]: e.target.value })}><option value="">{cands.length ? 'Select entry' : 'No matching entry'}</option>{cands.map((c) => <option key={c.id} value={c.id}>{c.journals.entry_date} {c.journals.description}</option>)}</select>}</td>
              <td>{s.status === 'unmatched' ? <button className="btn sm" disabled={!pick[s.id]} onClick={() => wrap(() => sb.rpc('match_statement_line', { p_stmt: s.id, p_journal_line: pick[s.id] }), 'Matched.')}>Match</button> : s.status === 'matched' ? <button className="btn alt sm" onClick={() => wrap(() => sb.rpc('unmatch_statement_line', { p_stmt: s.id }), 'Unmatched.')}>Unmatch</button> : null}</td></tr>); })}
        </tbody></table>{stmts.length === 0 && <div className="empty">No statement lines imported for this account.</div>}</div></div>
      <div className="card"><h2>3. Reconcile</h2>
        <div className="row"><label className="f">As of<input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label><label className="f">Statement closing balance<input type="number" step="any" value={bal} onChange={(e) => setBal(e.target.value)} /></label><button className="btn alt" onClick={load} disabled={bal === ''}>Check</button>
          <button className="btn" disabled={!diff || Number(diff.amount) !== 0} onClick={() => wrap(() => sb.rpc('complete_reconciliation', { p_bank: bank, p_as_of: asOf, p_statement_balance: Number(bal) }), 'Reconciliation completed and recorded.')}>Complete reconciliation</button></div>
        {summary.length > 0 && <div className="tablewrap" style={{ marginTop: 10 }}><table><tbody>{rec.map((r, i) => <tr key={i}><td>{r.section === 'summary' ? <b>{r.description}</b> : `${r.section.replace('_', ' ')}: ${r.item_date} ${r.description ?? ''}`}</td><td className="r">{num(r.amount)}</td></tr>)}</tbody></table></div>}
      </div>
    </div>
  );
}
