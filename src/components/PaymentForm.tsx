'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { isoDate, num } from '@/lib/format';
import { Field } from './ui';
import type { FieldDef } from './types';

type Open = { id: string; number: string; total: number; open: number; currency: string; due_date: string };

export default function PaymentForm({ direction }: { direction: 'in' | 'out' }) {
  const router = useRouter(); const inc = direction === 'in';
  const [open, setOpen] = useState(false);
  const [party, setParty] = useState(''); const [bank, setBank] = useState(''); const [date, setDate] = useState(isoDate()); const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank'); const [ref, setRef] = useState(''); const [rate, setRate] = useState(''); const [wht, setWht] = useState('');
  const [docs, setDocs] = useState<Open[]>([]); const [alloc, setAlloc] = useState<Record<string, string>>({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [cur, setCur] = useState('GHS');
  const partyF: FieldDef = { name: 'party', label: inc ? 'Customer' : 'Supplier', type: 'select', required: true, optionsFrom: { table: inc ? 'customers' : 'suppliers', value: 'id', label: 'name', order: 'name' } };
  const bankF: FieldDef = { name: 'bank', label: inc ? 'Received into' : 'Paid from', type: 'select', required: true, optionsFrom: { table: 'bank_accounts', value: 'id', label: 'name', order: 'name', eq: { is_active: true } } };
  useEffect(() => { (async () => {
    if (!party) { setDocs([]); return; }
    const sb = supabaseBrowser();
    const { data } = await sb.from(inc ? 'invoices' : 'bills').select('id, number, total, currency, due_date').eq(inc ? 'customer_id' : 'supplier_id', party).eq('status', inc ? 'issued' : 'approved').order('due_date');
    const ids = (data ?? []).map((d) => d.id as string);
    const { data: al } = ids.length ? await sb.from('payment_allocations').select('amount, invoice_id, bill_id').in(inc ? 'invoice_id' : 'bill_id', ids) : { data: [] as { amount: number; invoice_id: string | null; bill_id: string | null }[] };
    const paid = new Map<string, number>(); (al ?? []).forEach((a) => { const k = (inc ? a.invoice_id : a.bill_id) as string; paid.set(k, (paid.get(k) ?? 0) + Number(a.amount)); });
    setDocs((data ?? []).map((d) => ({ ...(d as unknown as Open), open: Number(d.total) - (paid.get(d.id as string) ?? 0) })).filter((d) => d.open > 0));
  })(); }, [party]);
  useEffect(() => { (async () => { if (!bank) return; const { data } = await supabaseBrowser().from('bank_accounts').select('currency').eq('id', bank).single(); if (data) setCur(data.currency as string); })(); }, [bank]);
  const allocated = Object.values(alloc).reduce((s, v) => s + Number(v || 0), 0);
  async function save() {
    setBusy(true); setErr('');
    const a = Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ [inc ? 'invoice_id' : 'bill_id']: id, amount: Number(v) }));
    const { error } = await supabaseBrowser().rpc('record_payment', { p_direction: direction, p_party: party, p_date: date, p_amount: Number(amount), p_currency: cur, p_bank_account: bank, p_allocations: a, p_method: method, p_reference: ref || null, p_fx_rate: rate ? Number(rate) : null, p_withholding: wht ? Number(wht) : 0 });
    setBusy(false); if (error) { setErr(error.message); return; }
    setOpen(false); setAlloc({}); setAmount(''); router.refresh();
  }
  if (!open) return <button className="btn gold" onClick={() => setOpen(true)}>{inc ? 'Record customer receipt' : 'Record supplier payment'}</button>;
  return (
    <div className="card" style={{ margin: '12px 0' }}>
      <div className="spread"><h2 style={{ margin: 0 }}>{inc ? 'Customer receipt' : 'Supplier payment'}</h2><button className="btn alt sm" onClick={() => setOpen(false)}>Close</button></div>
      <div className="form">
        <Field f={partyF} value={party} onChange={(v) => setParty(String(v))} /><Field f={bankF} value={bank} onChange={(v) => setBank(String(v))} />
        <label className="f">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f">Amount settled, gross ({cur})<input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="f">Method<select value={method} onChange={(e) => setMethod(e.target.value)}>{['bank', 'momo', 'cash', 'cheque'].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="f">Reference<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label className="f">{inc ? 'Tax withheld by customer' : 'Withholding tax deducted'}<input type="number" step="any" min="0" value={wht} onChange={(e) => setWht(e.target.value)} /></label>
        {cur !== 'GHS' && <label className="f">FX rate on payment date<input type="number" step="any" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
      </div>
      <h2 style={{ marginTop: 16 }}>Apply to open {inc ? 'invoices' : 'bills'}</h2>
      <div className="tablewrap"><table><thead><tr><th>Number</th><th>Due</th><th>Currency</th><th className="r">Open</th><th className="r">Apply</th></tr></thead><tbody>
        {docs.map((d) => <tr key={d.id}><td>{d.number}</td><td>{d.due_date}</td><td>{d.currency}</td><td className="r">{num(d.open)}</td><td className="r"><input aria-label={`Apply to ${d.number}`} style={{ width: 120 }} className="r" type="number" step="any" max={d.open} value={alloc[d.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [d.id]: e.target.value })} /></td></tr>)}
      </tbody></table>{docs.length === 0 && <div className="empty">{party ? 'No open documents for this party. Any amount entered is held as unapplied.' : 'Choose a party to see open documents.'}</div>}</div>
      <p className="muted">Applied {num(allocated)} of {num(Number(amount || 0))}. Cash {inc ? 'received' : 'paid'}: {num(Number(amount || 0) - Number(wht || 0))}. Allocation currency must match the payment currency.</p>
      {err && <div className="alert err" role="alert">{err}</div>}
      <button className="btn" disabled={busy || !party || !bank || !(Number(amount) > 0) || allocated > Number(amount)} onClick={save}>Post {inc ? 'receipt' : 'payment'}</button>
    </div>
  );
}
