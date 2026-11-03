'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
export default function NewProjectForm() {
  const r = useRouter(); const [code, setCode] = useState(''); const [name, setName] = useState(''); const [budget, setBudget] = useState(''); const [start, setStart] = useState(''); const [err, setErr] = useState('');
  async function go(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const { error } = await supabaseBrowser().rpc('create_project', { p_code: code, p_name: name, p_budget: budget ? Number(budget) : 0, p_start: start || null });
    if (error) setErr(error.message); else { setCode(''); setName(''); setBudget(''); setStart(''); r.refresh(); }
  }
  return <form className="card" onSubmit={go}><h2>New project</h2><div className="form"><label className="f">Code *<input required value={code} onChange={(e) => setCode(e.target.value)} /></label><label className="f">Name *<input required value={name} onChange={(e) => setName(e.target.value)} /></label><label className="f">Budget<input type="number" step="any" value={budget} onChange={(e) => setBudget(e.target.value)} /></label><label className="f">Start date<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label><button className="btn">Create project</button></div>{err && <div className="alert err" role="alert">{err}</div>}<p className="muted" style={{ fontSize: 12 }}>Creates the project and its cost centre together.</p></form>;
}
