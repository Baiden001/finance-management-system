import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { brand } from '@/lib/company';
import { docPdf, type DocSpec } from '@/lib/docs-pdf';
import { amountInWords } from '@/lib/words';
import { rateLimit, requireAccountant } from '@/lib/guards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type R = Record<string, any>;
const f = (n: unknown) => Number(n ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addr = (p: R | null) => p ? [p.name, p.address, p.phone, p.tin ? `TIN: ${p.tin}` : ''] : [''];
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  let uid: string;
  try { uid = await requireAccountant(supabase); } catch (e) { return e as Response; }
  if (!rateLimit(`doc:${uid}`, 120, 60_000)) return new NextResponse('Too many requests', { status: 429 });
  const type = req.nextUrl.searchParams.get('type') ?? ''; const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!UUID.test(id)) return new NextResponse('Bad request', { status: 400 });
  const { data: cs } = await supabase.from('company_settings').select('legal_name, tin, address, phone, email, base_currency').limit(1).single();
  if (!cs) return new NextResponse('Company not configured', { status: 500 });
  const cur = cs.base_currency as string; const today = new Date().toISOString().slice(0, 10);
  let spec: DocSpec | null = null; let name = type;

  if (type === 'receipt') {
    const { data: p } = await supabase.from('payments').select('*, customers(name,address,phone,tin), suppliers(name,address,phone,tin), bank_accounts(name), payment_allocations(amount, invoice_id, bill_id, invoices(number,total), bills(number,total))').eq('id', id).maybeSingle();
    if (!p) return new NextResponse('Not found', { status: 404 });
    const inc = p.direction === 'in'; const docs = (p.payment_allocations ?? []) as R[];
    const ids = docs.map((a) => (inc ? a.invoice_id : a.bill_id)).filter(Boolean);
    const { data: allocs } = ids.length ? await supabase.from('payment_allocations').select('amount, invoice_id, bill_id, payments!inner(created_at)').in(inc ? 'invoice_id' : 'bill_id', ids).lte('payments.created_at', p.created_at) : { data: [] as R[] };
    const { data: credits } = ids.length ? await supabase.from('document_credits').select('amount, invoice_id, bill_id').in(inc ? 'invoice_id' : 'bill_id', ids).lte('credit_date', p.payment_date) : { data: [] as R[] };
    const settled = (docId: string) => ((allocs ?? []) as R[]).filter((a) => (inc ? a.invoice_id : a.bill_id) === docId).reduce((s, a) => s + Number(a.amount), 0) + ((credits ?? []) as R[]).filter((a) => (inc ? a.invoice_id : a.bill_id) === docId).reduce((s, a) => s + Number(a.amount), 0);
    const party = (inc ? p.customers : p.suppliers) as R | null; const cash = Number(p.amount) - Number(p.withholding);
    spec = { title: inc ? 'Official Receipt' : 'Payment Voucher', number: p.number, date: p.payment_date, company: cs,
      parties: [{ label: inc ? 'Received from' : 'Paid to', lines: addr(party) }],
      info: [['Method', String(p.method)], ['Account', p.bank_accounts?.name ?? ''], ['Reference', p.reference ?? '-']],
      columns: [{ label: inc ? 'Invoice' : 'Bill', w: 2 }, { label: 'Document total', w: 2, right: true }, { label: 'Applied now', w: 2, right: true }, { label: 'Balance after', w: 2, right: true }],
      rows: docs.length ? docs.map((a) => { const d = (inc ? a.invoices : a.bills) as R; const sid = inc ? a.invoice_id : a.bill_id; return [d.number, f(d.total), f(a.amount), f(Number(d.total) - settled(sid))]; }) : [['On account (not applied to a document)', '', f(p.amount), '']],
      totals: [['Amount settled', `${p.currency} ${f(p.amount)}`], ...(Number(p.withholding) > 0 ? [[inc ? 'Less tax withheld by payer' : 'Less withholding tax', `${p.currency} ${f(p.withholding)}`] as [string, string]] : []), [inc ? 'AMOUNT RECEIVED' : 'AMOUNT PAID', `${p.currency} ${f(cash)}`, true]],
      words: amountInWords(cash, p.currency),
      notes: [inc ? 'Thank you for your payment. Please keep this receipt for your records.' : 'This voucher records a payment made by the company.'],
      signatures: inc ? ['Received by (name, signature)', 'Customer (signature)'] : ['Prepared by', 'Approved by', 'Received by (supplier)'] };
    name = `${inc ? 'receipt' : 'voucher'}-${p.number}`;
  } else if (type === 'invoice') {
    const { data: i } = await supabase.from('invoices').select('*, customers(name,address,phone,tin), invoice_lines(*)').eq('id', id).maybeSingle();
    if (!i) return new NextResponse('Not found', { status: 404 });
    const { data: paid } = await supabase.rpc('invoice_paid', { p_invoice: id }); const lines = (i.invoice_lines ?? []) as R[];
    spec = { title: 'Invoice', number: i.number, date: i.issue_date, company: cs, parties: [{ label: 'Bill to', lines: addr(i.customers) }],
      info: [['Due date', i.due_date], ['Currency', i.currency], ['Status', i.status]],
      columns: [{ label: 'Description', w: 5 }, { label: 'Qty', w: 1, right: true }, { label: 'Unit price', w: 2, right: true }, { label: 'Tax %', w: 1, right: true }, { label: 'Amount', w: 2, right: true }],
      rows: lines.map((l) => [l.description, f(l.quantity), f(l.unit_price), f(l.tax_rate), f(l.line_total)]),
      totals: i.status === 'draft' ? [] : [['Subtotal', `${i.currency} ${f(i.subtotal)}`], ['Tax', `${i.currency} ${f(i.tax_total)}`], ['TOTAL', `${i.currency} ${f(i.total)}`, true], ['Settled to date', `${i.currency} ${f(paid)}`], ['Balance due', `${i.currency} ${f(Number(i.total) - Number(paid))}`]],
      words: i.status === 'draft' ? undefined : amountInWords(Number(i.total), i.currency), notes: [i.notes ?? '', 'Please quote the invoice number with your payment.'].filter(Boolean), watermark: i.status === 'draft' ? 'DRAFT' : i.status === 'void' ? 'VOID' : undefined };
    name = `invoice-${i.number}`;
  } else if (type === 'credit_note') {
    const { data: c } = await supabase.from('credit_notes').select('*, customers(name,address,phone,tin), suppliers(name,address,phone,tin), invoices(number), bills(number), credit_note_lines(*)').eq('id', id).maybeSingle();
    if (!c) return new NextResponse('Not found', { status: 404 });
    const sales = c.kind === 'sales'; const lines = (c.credit_note_lines ?? []) as R[];
    spec = { title: sales ? 'Credit Note' : 'Debit Note', number: c.number, date: c.issue_date, company: cs, parties: [{ label: sales ? 'Customer' : 'Supplier', lines: addr(sales ? c.customers : c.suppliers) }],
      info: [['Against', c.invoices?.number ?? c.bills?.number ?? 'Unapplied'], ['Reason', c.reason ?? '-'], ['Status', c.status]],
      columns: [{ label: 'Description', w: 5 }, { label: 'Qty', w: 1, right: true }, { label: 'Unit price', w: 2, right: true }, { label: 'Tax %', w: 1, right: true }, { label: 'Amount', w: 2, right: true }],
      rows: lines.map((l) => [l.description, f(l.quantity), f(l.unit_price), f(l.tax_rate), f(l.line_total)]),
      totals: [['Subtotal', `${c.currency} ${f(c.subtotal)}`], ['Tax', `${c.currency} ${f(c.tax_total)}`], ['TOTAL', `${c.currency} ${f(c.total)}`, true]], words: amountInWords(Number(c.total), c.currency), signatures: ['Authorised by'], watermark: c.status === 'draft' ? 'DRAFT' : undefined };
    name = `credit-note-${c.number}`;
  } else if (type === 'statement') {
    const asOf = req.nextUrl.searchParams.get('as_of') ?? today; if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return new NextResponse('Bad date', { status: 400 });
    const { data: cu } = await supabase.from('customers').select('name,address,phone,tin').eq('id', id).maybeSingle(); if (!cu) return new NextResponse('Not found', { status: 404 });
    const [inv, pay, cn] = await Promise.all([
      supabase.from('invoices').select('number, issue_date, currency, total').eq('customer_id', id).eq('status', 'issued').lte('issue_date', asOf),
      supabase.from('payments').select('number, payment_date, currency, amount, reference').eq('customer_id', id).eq('direction', 'in').lte('payment_date', asOf),
      supabase.from('credit_notes').select('number, issue_date, currency, total').eq('customer_id', id).eq('kind', 'sales').eq('status', 'issued').lte('issue_date', asOf)]);
    const ev = [...((inv.data ?? []) as R[]).map((x) => ({ d: x.issue_date, ref: x.number, desc: 'Invoice', cur: x.currency, debit: Number(x.total), credit: 0 })),
      ...((pay.data ?? []) as R[]).map((x) => ({ d: x.payment_date, ref: x.number, desc: `Receipt ${x.reference ?? ''}`, cur: x.currency, debit: 0, credit: Number(x.amount) })),
      ...((cn.data ?? []) as R[]).map((x) => ({ d: x.issue_date, ref: x.number, desc: 'Credit note', cur: x.currency, debit: 0, credit: Number(x.total) }))].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.ref < b.ref ? -1 : 1));
    const bal = new Map<string, number>();
    const rows = ev.map((e) => { const b = (bal.get(e.cur) ?? 0) + e.debit - e.credit; bal.set(e.cur, b); return [e.d, e.ref, e.desc, e.cur, e.debit ? f(e.debit) : '', e.credit ? f(e.credit) : '', f(b)]; });
    spec = { title: 'Statement of Account', number: asOf, date: today, company: cs, parties: [{ label: 'Customer', lines: addr(cu) }], info: [['Statement date', asOf]],
      columns: [{ label: 'Date', w: 2 }, { label: 'Reference', w: 2 }, { label: 'Description', w: 3 }, { label: 'Cur', w: 1 }, { label: 'Debit', w: 2, right: true }, { label: 'Credit', w: 2, right: true }, { label: 'Balance', w: 2, right: true }], rows,
      totals: [...bal.entries()].map(([c, b], i, a) => [i === a.length - 1 ? 'BALANCE DUE ' + c : 'Balance ' + c, `${c} ${f(b)}`, i === a.length - 1] as [string, string, boolean]), notes: ['Please settle any overdue balance promptly. Contact us if you find a discrepancy.'] };
    name = `statement-${asOf}`; void cur;
  } else if (type === 'delivery_note') {
    const { data: n } = await supabase.from('delivery_notes').select('*, customers(name,address,phone,tin), invoices(number), delivery_note_lines(quantity, products(name,sku,unit))').eq('id', id).maybeSingle();
    if (!n) return new NextResponse('Not found', { status: 404 });
    spec = { title: 'Delivery Note', number: n.number, date: n.delivery_date, company: cs, parties: [{ label: 'Deliver to', lines: [...addr(n.customers).slice(0, 1), n.delivery_address ?? n.customers?.address ?? '', n.customers?.phone ?? ''] }],
      info: [['Invoice', n.invoices?.number ?? '-'], ['Vehicle', n.vehicle ?? '-'], ['Driver', n.driver ?? '-']],
      columns: [{ label: 'Item', w: 5 }, { label: 'Code', w: 2 }, { label: 'Unit', w: 1 }, { label: 'Quantity', w: 2, right: true }],
      rows: ((n.delivery_note_lines ?? []) as R[]).map((l) => [l.products.name, l.products.sku, l.products.unit, f(l.quantity)]),
      notes: [n.notes ?? '', 'Goods received in good order unless noted below.'].filter(Boolean), signatures: ['Driver (name, signature)', 'Received by (name, signature, date)'] , watermark: n.status === 'draft' ? 'DRAFT' : undefined };
    name = `delivery-note-${n.number}`;
  }
  if (!spec) return new NextResponse('Unknown document type', { status: 400 });
  const b = brand();
  const pdf = await docPdf({ brandColor: b.pdf.brand, accentColor: b.pdf.accent, logoFile: b.logo, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }, spec);
  await supabase.rpc('log_export', { p_key: `doc_${type}`, p_format: 'pdf', p_params: { id }, p_rows: 1, p_sha: createHash('sha256').update(pdf).digest('hex'), p_sensitive: false });
  return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"`, 'Cache-Control': 'no-store' } });
}
