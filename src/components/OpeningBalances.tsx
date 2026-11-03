'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { num } from '@/lib/format';

type A = { id: string; code: string; name: string; type: string };
export default function OpeningBalances() {
  const sb = supabaseBrowser(); const [accts, setAccts] = useState<A[]>([]); const [v, setV] = useState<Record<string, { d: string; c: string }>>({});
  const [date, setDate] = useState('2026-01-01'); const [plug, setPlug] = useState(true); const [msg, setMsg] = useState<{ k: 'ok' | 'err'; t: string } | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => { const { data } = await sb.from('accounts').select('id, code, name, type').in('type', ['asset', 'liability', 'equity']).eq('is_active', true).eq('allow_posting', true).order('code'); setAccts((data ?? []) as A[]); })(); }, []);
  const td = Object.values(v).reduce((s, x) => s + Number(x.d || 0), 0), tc = Object.values(v).reduce((s, x) => s + Number(x.c || 0), 0);
  async function post() {
    setBusy(true); setMsg(null);
    const lines = Object.entries(v).filter(([, x]) => Number(x.d || 0) || Number(x.c || 0)).map(([id, x]) => ({ account_id: id, debit: Number(x.d || 0), credit: Number(x.c || 0) }));
    const { error } = await sb.rpc('post_opening_balances', { p_date: date, p_lines: lines, p_plug: plug });
    setBusy(false); setMsg(error ? { k: 'err', t: error.message } : { k: 'ok', t: 'Opening balances posted.' }); if (!error) setV({});
  }
  return (
    <div className="card"><h2>1. Opening balances</h2>
      <p className="muted" style={{ marginTop: 0 }}>Enter the closing balances from your previous books as at the day before you start using the system: assets as debits, liabilities and equity as credits. Posted as one journal.</p>
      <div className="row"><label className="f">Balances as at<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label className="row" style={{ alignSelf: 'end', minHeight: 36 }}><input type="checkbox" checked={plug} onChange={(e) => setPlug(e.target.checked)} /> Post any difference to Opening Balance Equity</label></div>
      <div className="tablewrap" style={{ maxHeight: 420, overflow: 'auto', marginTop: 10 }}><table><thead><tr><th>Code</th><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead><tbody>
        {accts.map((a) => <tr key={a.id}><td>{a.code}</td><td>{a.name}<div className="muted" style={{ fontSize: 11 }}>{a.type}</div></td>
          <td style={{ width: 150 }}><input aria-label={`Debit ${a.name}`} className="r" type="number" step="any" min="0" value={v[a.id]?.d ?? ''} onChange={(e) => setV({ ...v, [a.id]: { c: v[a.id]?.c ?? '', d: e.target.value } })} /></td>
          <td style={{ width: 150 }}><input aria-label={`Credit ${a.name}`} className="r" type="number" step="any" min="0" value={v[a.id]?.c ?? ''} onChange={(e) => setV({ ...v, [a.id]: { d: v[a.id]?.d ?? '', c: e.target.value } })} /></td></tr>)}
      </tbody></table></div>
      <div className={`alert ${Math.abs(td - tc) < 0.005 ? 'ok' : 'warn'}`} role="status">Debits {num(td)}  |  Credits {num(tc)}  |  Difference {num(td - tc)}{Math.abs(td - tc) >= 0.005 && (plug ? ' (will go to Opening Balance Equity)' : ' (must be nil to post)')}</div>
      {msg && <div className={`alert ${msg.k}`} role={msg.k === 'err' ? 'alert' : 'status'}>{msg.t}</div>}
      <button className="btn" disabled={busy || (td === 0 && tc === 0)} onClick={post}>Post opening balances</button>
    </div>
  );
}
