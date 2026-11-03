'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { isoDate } from '@/lib/format';
export default function RunRecurring() {
  const r = useRouter(); const [d, setD] = useState(isoDate()); const [msg, setMsg] = useState<{ k: 'ok' | 'err'; t: string } | null>(null);
  async function go() {
    const { data, error } = await supabaseBrowser().rpc('run_recurring', { p_as_of: d });
    if (error) { setMsg({ k: 'err', t: error.message }); return; }
    const res = data as { posted: number; failed: { name: string; date: string; error: string }[] };
    setMsg(res.failed.length ? { k: 'err', t: `Posted ${res.posted}. Failed: ${res.failed.map((f) => `${f.name} (${f.date}): ${f.error}`).join('; ')}` } : { k: 'ok', t: `Posted ${res.posted} recurring entr${res.posted === 1 ? 'y' : 'ies'}.` }); r.refresh();
  }
  return <div className="card"><h2>Post due recurring entries</h2><div className="row"><label className="f">Post everything due up to<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label><button className="btn" onClick={go}>Run recurring entries</button></div>{msg && <div className={`alert ${msg.k}`} role={msg.k === 'err' ? 'alert' : 'status'}>{msg.t}</div>}</div>;
}
