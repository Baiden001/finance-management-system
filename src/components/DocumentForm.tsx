'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { isoDate, num } from '@/lib/format';
import { Field } from './ui';
import type { FieldDef } from './types';

type L = { description: string; quantity: string; unit_price: string; tax_rate: string; account_id: string; cost_centre_id: string; product_id: string };
const blank = (): L => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0', account_id: '', cost_centre_id: '', product_id: '' });

export default function DocumentForm({ kind, company }: { kind: 'invoice' | 'bill'; company: 'resilience' | 'ashelite' }) {
  const router = useRouter(); const inv = kind === 'invoice';
  const [open, setOpen] = useState(false);
  const [party, setParty] = useState(''); const [issue, setIssue] = useState(isoDate()); const [due, setDue] = useState(isoDate(new Date(Date.now() + 14 * 864e5)));
  const [cur, setCur] = useState('GHS'); const [rate, setRate] = useState('1'); const [ref, setRef] = useState(''); const [retention, setRetention] = useState('0');
  const [lines, setLines] = useState<L[]>([blank()]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (i: number, k: keyof L, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  async function pickProduct(i: number, v: string) {
    set(i, 'product_id', v); if (!v || !party) return;
    const { data } = await supabaseBrowser().rpc('unit_price_for', { p_customer: party, p_product: v, p_date: issue });
    if (data !== null && data !== undefined) setLines((ls) => ls.map((l, j) => (j === i ? { ...l, product_id: v, unit_price: String(data), description: l.description || 'Block sales' } : l)));
  }
  const sub = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0); const tax = lines.reduce((s, l) => s + (Number(l.quantity || 0) * Number(l.unit_price || 0) * Number(l.tax_rate || 0)) / 100, 0);
  const partyF: FieldDef = { name: 'p', label: inv ? 'Customer' : 'Supplier', type: 'select', required: true, optionsFrom: { table: inv ? 'customers' : 'suppliers', value: 'id', label: 'name', order: 'name' } };
  const acctF = (name: string): FieldDef => ({ name, label: '', type: 'select', optionsFrom: { table: 'accounts', value: 'id', label: 'name', order: 'code', eq: { is_active: true, type: inv ? 'income' : 'expense' } } });
  const invAcctF = (name: string): FieldDef => ({ name, label: '', type: 'select', optionsFrom: { table: 'accounts', value: 'id', label: 'name', order: 'code', eq: { is_active: true } } });
  const ccF = (name: string): FieldDef => ({ name, label: '', type: 'select', optionsFrom: { table: 'cost_centres', value: 'id', label: 'name', order: 'code' } });
  const prodF = (name: string): FieldDef => ({ name, label: '', type: 'select', optionsFrom: { table: 'products', value: 'id', label: 'name', order: 'sku' } });
  async function save(issueNow: boolean) {
    setBusy(true); setErr(''); const sb = supabaseBrowser();
    const header: Record<string, unknown> = inv ? { customer_id: party, issue_date: issue, due_date: due, currency: cur, fx_rate: Number(rate || 1), notes: ref || null } : { supplier_id: party, supplier_ref: ref || null, issue_date: issue, due_date: due, currency: cur, fx_rate: Number(rate || 1), retention_pct: Number(retention || 0) };
    const { data: h, error } = await sb.from(inv ? 'invoices' : 'bills').insert(header).select('id').single();
    if (error || !h) { setErr(error?.message ?? 'Could not create'); setBusy(false); return; }
    const rows = lines.filter((l) => l.description).map((l) => ({ [inv ? 'invoice_id' : 'bill_id']: h.id, description: l.description, quantity: Number(l.quantity || 1), unit_price: Number(l.unit_price || 0), tax_rate: Number(l.tax_rate || 0), [inv ? 'revenue_account_id' : 'expense_account_id']: l.account_id, cost_centre_id: l.cost_centre_id || null, ...(inv && company === 'ashelite' ? { product_id: l.product_id || null } : {}) }));
    const li = await sb.from(inv ? 'invoice_lines' : 'bill_lines').insert(rows);
    if (li.error) { await sb.from(inv ? 'invoices' : 'bills').delete().eq('id', h.id); setErr(li.error.message); setBusy(false); return; }
    if (issueNow) { const r = await sb.rpc(inv ? 'issue_invoice' : 'approve_bill', { p_id: h.id }); if (r.error) { setErr(`Saved as draft, but posting failed: ${r.error.message}`); setBusy(false); router.refresh(); return; } }
    setBusy(false); setOpen(false); setLines([blank()]); router.refresh();
  }
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>{inv ? 'New invoice' : 'New supplier bill'}</button>;
  return (
    <div className="card" style={{ margin: '12px 0' }}>
      <div className="spread"><h2 style={{ margin: 0 }}>{inv ? 'New invoice' : 'New supplier bill'}</h2><button className="btn alt sm" onClick={() => setOpen(false)}>Close</button></div>
      <div className="form" style={{ marginBottom: 12 }}>
        <Field f={partyF} value={party} onChange={(v) => setParty(String(v))} />
        <label className="f">Issue date<input type="date" value={issue} onChange={(e) => setIssue(e.target.value)} /></label>
        <label className="f">Due date<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <label className="f">Currency<input value={cur} maxLength={3} onChange={(e) => setCur(e.target.value.toUpperCase())} /></label>
        <label className="f">FX rate to base (if foreign)<input type="number" step="any" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        <label className="f">{inv ? 'Notes' : 'Supplier invoice no.'}<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        {!inv && <label className="f">Retention % (held until released)<input type="number" step="any" min="0" max="99" value={retention} onChange={(e) => setRetention(e.target.value)} /></label>}
      </div>
      <div className="tablewrap"><table><thead><tr><th>Description</th>{inv && company === 'ashelite' && <th>Product (stock)</th>}<th className="r">Qty</th><th className="r">Unit price</th><th className="r">Tax %</th><th>{inv ? 'Revenue account' : 'Expense / inventory account'}</th><th>Cost centre</th><th /></tr></thead><tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td><input aria-label="Description" value={l.description} onChange={(e) => set(i, 'description', e.target.value)} /></td>
            {inv && company === 'ashelite' && <td style={{ minWidth: 140 }}><Field f={prodF(`p${i}`)} value={l.product_id} onChange={(v) => void pickProduct(i, String(v))} /></td>}
            <td><input aria-label="Quantity" className="r" style={{ width: 80 }} type="number" step="any" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} /></td>
            <td><input aria-label="Unit price" className="r" style={{ width: 110 }} type="number" step="any" value={l.unit_price} onChange={(e) => set(i, 'unit_price', e.target.value)} /></td>
            <td><input aria-label="Tax percent" className="r" style={{ width: 70 }} type="number" step="any" value={l.tax_rate} onChange={(e) => set(i, 'tax_rate', e.target.value)} /></td>
            <td style={{ minWidth: 180 }}><Field f={inv ? acctF(`a${i}`) : invAcctF(`a${i}`)} value={l.account_id} onChange={(v) => set(i, 'account_id', String(v))} /></td>
            <td style={{ minWidth: 140 }}><Field f={ccF(`c${i}`)} value={l.cost_centre_id} onChange={(v) => set(i, 'cost_centre_id', String(v))} /></td>
            <td>{lines.length > 1 && <button className="btn alt sm" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}>x</button>}</td>
          </tr>))}
      </tbody></table></div>
      <div className="spread" style={{ marginTop: 10 }}><button className="btn alt sm" onClick={() => setLines([...lines, blank()])}>Add line</button><span>Subtotal <b>{num(sub)}</b> &nbsp; Tax <b>{num(tax)}</b> &nbsp; Total <b>{num(sub + tax)}</b></span></div>
      {err && <div className="alert err" role="alert">{err}</div>}
      <div className="row"><button className="btn" disabled={busy || !party} onClick={() => save(true)}>{inv ? 'Save and issue' : 'Save and approve'}</button><button className="btn alt" disabled={busy || !party} onClick={() => save(false)}>Save as draft</button></div>
    </div>
  );
}
