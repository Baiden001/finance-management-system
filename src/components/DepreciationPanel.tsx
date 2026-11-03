'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { monthEnd } from '@/lib/format';
export default function DepreciationPanel() {
  const now = new Date(); const [d, setD] = useState(monthEnd(now.getUTCFullYear(), now.getUTCMonth() + 1)); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  async function run() {
    setMsg(''); setErr('');
    const { data, error } = await supabaseBrowser().rpc('run_depreciation', { p_month_end: d });
    if (error) setErr(error.message); else setMsg(data ? 'Depreciation journal posted.' : 'Nothing to depreciate for that month (already run, or no eligible assets).');
  }
  return (
    <div className="card"><h2>Run monthly depreciation</h2>
      <div className="row"><label className="f">Month-end date<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label><button className="btn" onClick={run}>Run depreciation</button></div>
      {msg && <div className="alert ok" role="status">{msg}</div>}{err && <div className="alert err" role="alert">{err}</div>}
      <p className="muted" style={{ fontSize: 12 }}>Straight-line, starting in the month of acquisition, capped at cost less residual. Re-running a month is safe: assets already depreciated are skipped.</p>
    </div>
  );
}
