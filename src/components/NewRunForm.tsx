'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
export default function NewRunForm() {
  const r = useRouter(); const now = new Date(); const [y, setY] = useState(String(now.getUTCFullYear())); const [m, setM] = useState(String(now.getUTCMonth() + 1)); const [err, setErr] = useState('');
  async function go() { setErr(''); const { data, error } = await supabaseBrowser().rpc('payroll_create_run', { p_year: Number(y), p_month: Number(m) }); if (error) setErr(error.message); else r.push(`/payroll/runs/${data}`); }
  return <div className="card"><h2>Start a monthly payroll run</h2><div className="row"><label className="f">Year<input type="number" value={y} onChange={(e) => setY(e.target.value)} /></label><label className="f">Month<select value={m} onChange={(e) => setM(e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2000, i, 1).toLocaleString('en-GB', { month: 'long' })}</option>)}</select></label><button className="btn" onClick={go}>Create run</button></div>{err && <div className="alert err" role="alert">{err}</div>}<p className="muted" style={{ fontSize: 12 }}>Active employees are added automatically. Corrections to a finalized run use reversal or a supplementary run.</p></div>;
}
