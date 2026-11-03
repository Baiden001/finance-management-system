'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { money, num } from '@/lib/format';
import type { ColDef, FieldDef, Opt } from './types';

export const get = (row: Record<string, unknown>, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), row);

export function Cell({ col, row }: { col: ColDef; row: Record<string, unknown> }) {
  const v = get(row, col.key);
  if (v === null || v === undefined || v === '') return <td className={col.format === 'money' || col.format === 'number' ? 'r' : undefined}>-</td>;
  switch (col.format) {
    case 'money': return <td className="r">{money(v, '')}</td>;
    case 'number': return <td className="r">{num(v, 2)}</td>;
    case 'pill': return <td><span className={`pill ${String(v)}`}>{String(v)}</span></td>;
    case 'bool': return <td>{v ? 'Yes' : 'No'}</td>;
    default: return <td>{String(v)}</td>;
  }
}

export function DataTable({ cols, rows, empty, actions }: { cols: ColDef[]; rows: Record<string, unknown>[]; empty?: string; actions?: (row: Record<string, unknown>) => ReactNode }) {
  return (
    <div className="tablewrap">
      <table>
        <thead><tr>{cols.map((c) => <th key={c.key} className={c.format === 'money' || c.format === 'number' ? 'r' : undefined}>{c.label}</th>)}{actions && <th />}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={String(r.id ?? i)}>{cols.map((c) => <Cell key={c.key} col={c} row={r} />)}{actions && <td style={{ whiteSpace: 'nowrap' }}>{actions(r)}</td>}</tr>)}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty">{empty ?? 'Nothing here yet.'}</div>}
    </div>
  );
}

export function useOptions(f: FieldDef): Opt[] {
  const [opts, setOpts] = useState<Opt[]>(f.options ?? []);
  useEffect(() => {
    const o = f.optionsFrom; if (!o) return;
    let cancelled = false;
    (async () => {
      let q = supabaseBrowser().from(o.table).select(`${o.value}, ${o.label}`).order(o.order ?? o.label).limit(1000);
      for (const [k, v] of Object.entries(o.eq ?? {})) q = q.eq(k, v);
      const { data } = await q;
      if (!cancelled) setOpts(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ value: String(r[o.value]), label: String(r[o.label]) })));
    })();
    return () => { cancelled = true; };
  }, [f.optionsFrom?.table]);
  return opts;
}

export function Field({ f, value, onChange, disabled }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const opts = useOptions(f);
  const common = { id: `f-${f.name}`, disabled, required: f.required } as const;
  return (
    <label className="f" htmlFor={common.id}>
      {f.label}{f.required ? ' *' : ''}
      {f.type === 'select' ? (
        <select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}><option value="">{f.required ? 'Select' : 'None'}</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      ) : f.type === 'checkbox' ? (
        <input {...common} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      ) : f.type === 'textarea' ? (
        <textarea {...common} rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={f.type ?? 'text'} step={f.type === 'number' ? 'any' : undefined} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  return <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div><h2>{title}</h2>{children}</div></div>;
}

export function cleanPayload(fields: FieldDef[], values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === 'checkbox') out[f.name] = !!v;
    else if (v === '' || v === undefined) out[f.name] = null;
    else if (f.type === 'number') out[f.name] = Number(v);
    else out[f.name] = v;
  }
  return out;
}
export const initialValues = (fields: FieldDef[], row?: Record<string, unknown>) => Object.fromEntries(fields.map((f) => [f.name, row ? row[f.name] : f.default ?? (f.type === 'checkbox' ? false : '')]));
