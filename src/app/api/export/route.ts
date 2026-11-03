import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { brand, companyCode } from '@/lib/company';
import { findReport, rpcArgs } from '@/lib/reports';
import { toCsv, toPdf, toXlsx, type ExportMeta } from '@/lib/export';
import { mfaSatisfied, rateLimit, requireAccountant } from '@/lib/guards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8' } as const;

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  let uid: string;
  try { uid = await requireAccountant(supabase); } catch (e) { return e as Response; }
  if (!rateLimit(`export:${uid}`, 30, 60_000)) return new NextResponse('Too many exports; wait a minute.', { status: 429 });
  const sp = req.nextUrl.searchParams;
  const def = findReport(sp.get('report') ?? '');
  const format = (sp.get('format') ?? 'pdf') as keyof typeof MIME;
  if (!def || (def.company && def.company !== companyCode()) || !(format in MIME)) return new NextResponse('Unknown report or format', { status: 400 });
  if (def.sensitive && !(await mfaSatisfied(supabase))) return new NextResponse('Multi-factor authentication required for payroll reports', { status: 403 });
  const params = Object.fromEntries(sp.entries());
  let args: Record<string, string | number | null>;
  try { args = rpcArgs(def, params); } catch (e) { return new NextResponse((e as Error).message, { status: 400 }); }
  const { data, error } = await supabase.rpc(def.rpc, args);
  if (error) return new NextResponse(`Report failed: ${error.message}`, { status: 400 });
  const rows = (data ?? []) as Record<string, unknown>[];
  const b = brand();
  const { data: cs } = await supabase.from('company_settings').select('legal_name, base_currency').limit(1).single();
  const PL: Record<string, string> = { level: 'Level', from: 'From', to: 'To', as_of: 'As of', method: 'Method', compare_from: 'Compared with', compare_to: 'to', compare_as_of: 'Compared with', year: 'Year', month: 'Month' };
  const period = ['level', 'from', 'to', 'as_of', 'method', 'compare_as_of', 'compare_from', 'compare_to', 'year', 'month'].filter((k) => params[k]).map((k) => `${PL[k]} ${params[k]}`).join('  ') || 'All dates';
  const meta: ExportMeta = {
    legalName: cs?.legal_name ?? b.legalName, title: def.title, period, currency: cs?.base_currency ?? 'GHS', generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    brandColor: b.pdf.brand, accentColor: b.pdf.accent, logoFile: b.logo, restricted: def.sensitive,
  };
  if (def.statement) { const { data: nt } = await supabase.from('report_notes').select('body').eq('report_key', def.key).maybeSingle(); meta.notes = nt?.body ?? undefined; }
  const file = format === 'csv' ? toCsv(def.cols, rows) : format === 'xlsx' ? await toXlsx(meta, def.cols, rows) : await toPdf(meta, def.cols, rows, def.landscape);
  const sha = createHash('sha256').update(file).digest('hex');
  await supabase.rpc('log_export', { p_key: def.key, p_format: format, p_params: params, p_rows: rows.length, p_sha: sha, p_sensitive: !!def.sensitive });
  const name = `${b.code}-${def.key}-${new Date().toISOString().slice(0, 10)}.${format}`;
  return new NextResponse(new Uint8Array(file), { headers: { 'Content-Type': MIME[format], 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
}
