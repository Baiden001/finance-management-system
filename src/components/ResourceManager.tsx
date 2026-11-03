'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { DataTable, Field, Modal, cleanPayload, get, initialValues } from './ui';
import type { ActionDef, FieldDef, ResourceConfig } from './types';

type Row = Record<string, unknown>;

function resolveArgs(spec: Record<string, string>, row: Row, prompt: Record<string, unknown>, fields: FieldDef[]) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) {
    if (v === '$id') out[k] = row.id;
    else if (v.startsWith('$row.')) out[k] = get(row, v.slice(5));
    else if (v.startsWith('$prompt.')) { const name = v.slice(8); const f = fields.find((x) => x.name === name); const raw = prompt[name]; out[k] = raw === '' || raw === undefined ? null : f?.type === 'number' ? Number(raw) : raw; }
    else out[k] = v;
  }
  return out;
}

export default function ResourceManager({ config, initialRows }: { config: ResourceConfig; initialRows: Row[] }) {
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [action, setAction] = useState<{ def: ActionDef; row: Row } | null>(null);
  const [prompt, setPrompt] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = config.fields ?? [];

  async function reload() {
    let q = sb.from(config.table).select(config.select ?? '*').order(config.order ?? 'created_at', { ascending: config.ascending ?? false }).limit(config.limit ?? 500);
    for (const [k, v] of Object.entries(config.filter ?? {})) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    setRows((data ?? []) as unknown as Row[]);
  }
  function openForm(row: Row | 'new') { setEditing(row); setValues(initialValues(fields, row === 'new' ? undefined : row)); setMsg(null); }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const payload = cleanPayload(fields.filter((f) => editing === 'new' || !f.readOnlyOnEdit), values);
    const res = editing === 'new' && config.createRpc ? await sb.rpc(config.createRpc, Object.fromEntries(Object.entries(payload).map(([k, v]) => [`p_${k}`, v]))) : editing === 'new' ? await sb.from(config.table).insert(payload) : await sb.from(config.table).update(payload).eq('id', (editing as Row).id as string);
    setBusy(false);
    if (res.error) { setMsg({ kind: 'err', text: res.error.message }); return; }
    setEditing(null); setMsg({ kind: 'ok', text: 'Saved.' }); await reload();
  }
  async function runAction(def: ActionDef, row: Row, p: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const { error } = await sb.rpc(def.rpc!, resolveArgs(def.args ?? {}, row, p, def.prompts ?? []));
    setBusy(false); setAction(null);
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    setMsg({ kind: 'ok', text: `${def.label}: done.` }); await reload();
  }
  function start(def: ActionDef, row: Row) {
    if (def.prompts?.length) { setAction({ def, row }); setPrompt(initialValues(def.prompts)); return; }
    if (def.confirm && !window.confirm(def.confirm)) return;
    void runAction(def, row, {});
  }
  const rowActions = (config.actions?.length || config.editable) ? (row: Row) => (
    <span className="row" style={{ gap: 6 }}>
      {config.editable && <button className="btn alt sm" onClick={() => openForm(row)}>Edit</button>}
      {(config.actions ?? []).filter((a) => !a.when || a.when.in.includes(String(get(row, a.when.field)))).map((a) => a.href ? <a key={a.label} className={`btn sm ${a.variant ?? 'alt'}`} style={{ textDecoration: 'none' }} href={a.href.replace('$id', String(row.id))} target="_blank" rel="noopener">{a.label}</a> : <button key={a.label} className={`btn sm ${a.variant ?? ''}`} disabled={busy} onClick={() => start(a, row)}>{a.label}</button>)}
    </span>
  ) : undefined;

  return (
    <section>
      <div className="spread"><div><h1>{config.title}</h1>{config.description && <p className="muted" style={{ margin: 0 }}>{config.description}</p>}</div>
        {fields.length > 0 && !config.noCreate && <button className="btn" onClick={() => openForm('new')}>{config.createLabel ?? 'Add new'}</button>}</div>
      {msg && <div className={`alert ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
      <DataTable cols={config.columns} rows={rows} empty={config.empty} actions={rowActions} />
      {editing && (
        <Modal title={editing === 'new' ? (config.createLabel ?? 'Add new') : 'Edit'} onClose={() => setEditing(null)}>
          <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
            {fields.map((f) => <Field key={f.name} f={f} value={values[f.name]} disabled={editing !== 'new' && f.readOnlyOnEdit} onChange={(v) => setValues({ ...values, [f.name]: v })} />)}
            {msg?.kind === 'err' && <div className="alert err" role="alert">{msg.text}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn alt" onClick={() => setEditing(null)}>Cancel</button><button className="btn" disabled={busy}>Save</button></div>
          </form>
        </Modal>
      )}
      {action && (
        <Modal title={action.def.label} onClose={() => setAction(null)}>
          <form onSubmit={(e) => { e.preventDefault(); void runAction(action.def, action.row, prompt); }} style={{ display: 'grid', gap: 12 }}>
            {action.def.confirm && <p>{action.def.confirm}</p>}
            {(action.def.prompts ?? []).map((f) => <Field key={f.name} f={f} value={prompt[f.name]} onChange={(v) => setPrompt({ ...prompt, [f.name]: v })} />)}
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn alt" onClick={() => setAction(null)}>Cancel</button><button className={`btn ${action.def.variant ?? ''}`} disabled={busy}>{action.def.label}</button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}
