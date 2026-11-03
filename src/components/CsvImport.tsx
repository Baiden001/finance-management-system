'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

const KINDS: Record<string, { table: string; label: string; required: string[]; columns: string[]; numeric?: string[]; bool?: string[] }> = {
  customers: { table: 'customers', label: 'Customers', required: ['name'], columns: ['name', 'phone', 'email', 'address', 'tin'] },
  suppliers: { table: 'suppliers', label: 'Suppliers', required: ['name'], columns: ['name', 'phone', 'email', 'address', 'tin'] },
  accounts: { table: 'accounts', label: 'Chart of accounts', required: ['code', 'name', 'type'], columns: ['code', 'name', 'type', 'subtype', 'cash_flow_category', 'currency'] },
  employees: { table: 'employees', label: 'Employees', required: ['emp_no', 'full_name', 'employment_type'], columns: ['emp_no', 'full_name', 'employment_type', 'hire_date', 'tin', 'ssnit_no', 'payment_method', 'bank_name', 'bank_account_number', 'momo_provider', 'momo_number'] },
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export default function CsvImport() {
  const [kind, setKind] = useState('customers'); const [msg, setMsg] = useState<{ k: 'ok' | 'err'; t: string } | null>(null); const [busy, setBusy] = useState(false);
  const k = KINDS[kind];
  async function onFile(f: File) {
    setMsg(null); setBusy(true);
    const rows = parseCsv((await f.text()).replace(/^\uFEFF/, '')); const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
    const missing = k.required.filter((r) => !head.includes(r));
    if (missing.length) { setMsg({ k: 'err', t: `Missing required column(s): ${missing.join(', ')}. Expected columns: ${k.columns.join(', ')}.` }); setBusy(false); return; }
    const unknown = head.filter((h) => !k.columns.includes(h));
    const recs = rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]).filter(([h, v]) => k.columns.includes(h as string) && v !== '').map(([h, v]) => [h, v])));
    const bad = recs.findIndex((r) => k.required.some((c) => !r[c as string]));
    if (bad >= 0) { setMsg({ k: 'err', t: `Row ${bad + 2} is missing a required value (${k.required.join(', ')}).` }); setBusy(false); return; }
    const sb = supabaseBrowser(); let done = 0;
    for (let i = 0; i < recs.length; i += 100) {
      const { error } = await sb.from(k.table).insert(recs.slice(i, i + 100));
      if (error) { setMsg({ k: 'err', t: `Imported ${done} of ${recs.length} rows, then stopped: ${error.message}` }); setBusy(false); return; }
      done += Math.min(100, recs.length - i);
    }
    setMsg({ k: 'ok', t: `Imported ${done} ${k.label.toLowerCase()}.${unknown.length ? ` Ignored unknown column(s): ${unknown.join(', ')}.` : ''}` }); setBusy(false);
  }
  const sample = `data:text/csv;charset=utf-8,${encodeURIComponent(k.columns.join(',') + '\n')}`;
  return (
    <div className="card"><h2>2. Import from CSV</h2>
      <p className="muted" style={{ marginTop: 0 }}>Upload a CSV with a header row. Rows are added; existing records are not changed. Nothing is imported if a row is missing a required value.</p>
      <div className="row"><label className="f">What to import<select value={kind} onChange={(e) => { setKind(e.target.value); setMsg(null); }}>{Object.entries(KINDS).map(([id, x]) => <option key={id} value={id}>{x.label}</option>)}</select></label>
        <label className="f">CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
        <a className="btn alt sm" style={{ alignSelf: 'end', textDecoration: 'none' }} href={sample} download={`${kind}-template.csv`}>Download template</a></div>
      <p className="muted" style={{ fontSize: 12 }}>Columns: {k.columns.join(', ')} (required: {k.required.join(', ')}).</p>
      {msg && <div className={`alert ${msg.k}`} role={msg.k === 'err' ? 'alert' : 'status'}>{msg.t}</div>}
    </div>
  );
}
