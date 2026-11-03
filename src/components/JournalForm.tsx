'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { isoDate, num } from '@/lib/format';
import { Field } from './ui';
import type { FieldDef } from './types';

const acctF: FieldDef = { name: 'a', label: 'Account', type: 'select', optionsFrom: { table: 'accounts', value: 'id', label: 'name', order: 'code', eq: { is_active: true, allow_posting: true } } };
const ccF: FieldDef = { name: 'c', label: 'Cost centre', type: 'select', optionsFrom: { table: 'cost_centres', value: 'id', label: 'name', order: 'code' } };
type Line = { account_id: string; cost_centre_id: string; description: string; debit: string; credit: string };
const blank = (): Line => ({ account_id: '', cost_centre_id: '', description: '', debit: '', credit: '' });

export default function JournalForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(isoDate()); const [desc, setDesc] = useState(''); const [ref, setRef] = useState('');
  const [cur, setCur] = useState(''); const [rate, setRate] = useState('');
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ok, setOk] = useState('');
  const td = lines.reduce((s, l) => s + Number(l.debit || 0), 0); const tc = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(td - tc) < 0.00005 && td > 0;
  const set = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  async function save(post: boolean) {
    setBusy(true); setErr(''); setOk('');
    const payload = lines.filter((l) => l.account_id).map((l) => ({ account_id: l.account_id, cost_centre_id: l.cost_centre_id || null, description: l.description || null, debit: Number(l.debit || 0), credit: Number(l.credit || 0) }));
    const { error } = await supabaseBrowser().rpc('create_journal', { p_date: date, p_description: desc, p_lines: payload, p_reference: ref || null, p_currency: cur || null, p_fx_rate: rate ? Number(rate) : null, p_post: post });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk(post ? 'Journal posted.' : 'Draft saved.'); setLines([blank(), blank()]); setDesc(''); setRef(''); router.refresh();
  }
  if (!open) return <div className="spread"><div><h1>Transactions</h1><p className="muted" style={{ margin: 0 }}>Double-entry journals. Posted entries cannot be edited; correct them by reversal.</p></div><button className="btn" onClick={() => setOpen(true)}>New journal entry</button></div>;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="spread"><h2 style={{ margin: 0 }}>New journal entry</h2><button className="btn alt sm" onClick={() => setOpen(false)}>Close</button></div>
      <div className="form" style={{ marginBottom: 12 }}>
        <label className="f">Date *<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f">Description *<input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <label className="f">Reference<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label className="f">Currency (blank = base)<input value={cur} maxLength={3} onChange={(e) => setCur(e.target.value.toUpperCase())} /></label>
        <label className="f">FX rate (blank = rate table)<input type="number" step="any" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
      </div>
      <div className="tablewrap"><table><thead><tr><th>Account</th><th>Cost centre</th><th>Line description</th><th className="r">Debit</th><th className="r">Credit</th><th /></tr></thead><tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td style={{ minWidth: 200 }}><Field f={{ ...acctF, name: `a${i}`, label: '' }} value={l.account_id} onChange={(v) => set(i, 'account_id', String(v))} /></td>
            <td style={{ minWidth: 150 }}><Field f={{ ...ccF, name: `c${i}`, label: '' }} value={l.cost_centre_id} onChange={(v) => set(i, 'cost_centre_id', String(v))} /></td>
            <td><input aria-label="Line description" value={l.description} onChange={(e) => set(i, 'description', e.target.value)} /></td>
            <td style={{ minWidth: 120 }}><input aria-label="Debit" className="r" type="number" step="any" min="0" value={l.debit} onChange={(e) => set(i, 'debit', e.target.value)} /></td>
            <td style={{ minWidth: 120 }}><input aria-label="Credit" className="r" type="number" step="any" min="0" value={l.credit} onChange={(e) => set(i, 'credit', e.target.value)} /></td>
            <td>{lines.length > 2 && <button className="btn alt sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">x</button>}</td>
          </tr>))}
        <tr><td colSpan={3}><button className="btn alt sm" onClick={() => setLines([...lines, blank()])}>Add line</button></td><td className="r"><b>{num(td)}</b></td><td className="r"><b>{num(tc)}</b></td><td /></tr>
      </tbody></table></div>
      <div className={`alert ${balanced ? 'ok' : 'warn'}`} role="status">{balanced ? 'Balanced.' : `Out of balance by ${num(Math.abs(td - tc))}. Debits must equal credits.`}</div>
      {err && <div className="alert err" role="alert">{err}</div>}{ok && <div className="alert ok" role="status">{ok}</div>}
      <div className="row"><button className="btn" disabled={busy || !balanced || !desc} onClick={() => save(true)}>Post journal</button><button className="btn alt" disabled={busy || !desc} onClick={() => save(false)}>Save as draft</button></div>
    </div>
  );
}
