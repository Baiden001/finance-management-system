'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

type A = { id: string; record_table: string; filename: string; storage_path: string; size_bytes: number | null; uploaded_at: string };
const TABLES = ['invoices', 'bills', 'journals', 'fixed_assets', 'payroll_runs', 'general'];
const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

export default function DocumentsClient() {
  const sb = supabaseBrowser(); const [rows, setRows] = useState<A[]>([]); const [table, setTable] = useState('general'); const [msg, setMsg] = useState<{ k: 'ok' | 'err'; t: string } | null>(null);
  const load = async () => { const { data } = await sb.from('attachments').select('*').order('uploaded_at', { ascending: false }).limit(200); setRows((data ?? []) as A[]); };
  useEffect(() => { void load(); }, []);
  async function upload(f: File) {
    if (f.size > 10 * 1024 * 1024) { setMsg({ k: 'err', t: 'Files must be 10 MB or smaller.' }); return; }
    if (!ALLOWED.includes(f.type)) { setMsg({ k: 'err', t: 'Allowed types: PDF, PNG, JPEG, CSV, XLSX.' }); return; }
    const id = crypto.randomUUID(); const path = `${table}/${id}/${f.name.replace(/[^\w.\-]+/g, '_')}`;
    const up = await sb.storage.from('documents').upload(path, f, { contentType: f.type, upsert: false });
    if (up.error) { setMsg({ k: 'err', t: up.error.message }); return; }
    const ins = await sb.from('attachments').insert({ record_table: table, record_id: id, storage_path: path, filename: f.name, mime_type: f.type, size_bytes: f.size });
    if (ins.error) { await sb.storage.from('documents').remove([path]); setMsg({ k: 'err', t: ins.error.message }); return; }
    setMsg({ k: 'ok', t: 'Uploaded.' }); await load();
  }
  async function open(a: A) { const { data, error } = await sb.storage.from('documents').createSignedUrl(a.storage_path, 60); if (error || !data) { setMsg({ k: 'err', t: error?.message ?? 'Link failed' }); return; } window.open(data.signedUrl, '_blank', 'noopener'); }
  return (
    <div className="grid"><div><h1>Documents</h1><p className="muted" style={{ margin: 0 }}>Private storage for receipts, contracts and supporting files. Download links expire after 60 seconds.</p></div>
      <div className="card row"><label className="f">Attach to<select value={table} onChange={(e) => setTable(e.target.value)}>{TABLES.map((t) => <option key={t}>{t}</option>)}</select></label><label className="f">File<input type="file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label></div>
      {msg && <div className={`alert ${msg.k}`} role={msg.k === 'err' ? 'alert' : 'status'}>{msg.t}</div>}
      <div className="tablewrap"><table><thead><tr><th>File</th><th>Attached to</th><th className="r">Size</th><th>Uploaded</th><th /></tr></thead><tbody>
        {rows.map((a) => <tr key={a.id}><td>{a.filename}</td><td>{a.record_table}</td><td className="r">{a.size_bytes ? `${Math.round(a.size_bytes / 1024)} KB` : ''}</td><td>{a.uploaded_at.slice(0, 16).replace('T', ' ')}</td><td><button className="btn alt sm" onClick={() => open(a)}>Open</button></td></tr>)}
      </tbody></table>{rows.length === 0 && <div className="empty">No documents uploaded yet.</div>}</div></div>
  );
}
