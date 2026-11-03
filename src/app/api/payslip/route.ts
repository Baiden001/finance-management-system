import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { brand } from '@/lib/company';
import { payslipPdf, type ExportMeta, type Payslip } from '@/lib/export';
import { mfaSatisfied, rateLimit, requireAccountant } from '@/lib/guards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  let uid: string;
  try { uid = await requireAccountant(supabase); } catch (e) { return e as Response; }
  if (!rateLimit(`payslip:${uid}`, 120, 60_000)) return new NextResponse('Too many requests', { status: 429 });
  if (!(await mfaSatisfied(supabase))) return new NextResponse('Multi-factor authentication required', { status: 403 });
  const line = req.nextUrl.searchParams.get('line') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(line)) return new NextResponse('Bad request', { status: 400 });
  const { data, error } = await supabase.rpc('payslip', { p_line: line });
  if (error || !data) return new NextResponse('Payslip not found', { status: 404 });
  const slip = { ...(data as Record<string, unknown>) } as unknown as Payslip & { company: Payslip['company'] };
  const b = brand();
  const meta: ExportMeta = { legalName: slip.company.legal_name, title: 'Payslip', period: slip.period, currency: slip.company.currency, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', brandColor: b.pdf.brand, accentColor: b.pdf.accent, logoFile: b.logo, restricted: true };
  const pdf = await payslipPdf(meta, slip);
  await supabase.rpc('log_export', { p_key: 'payslip', p_format: 'pdf', p_params: { line }, p_rows: 1, p_sha: createHash('sha256').update(pdf).digest('hex'), p_sensitive: true });
  return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="payslip-${slip.employee.emp_no}-${slip.period}.pdf"`, 'Cache-Control': 'no-store' } });
}
