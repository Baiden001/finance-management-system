import { supabaseServer } from '@/lib/supabase-server';
import { DataTable } from '@/components/ui';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Audit Log' };
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; table?: string }> }) {
  const sp = await searchParams; const sb = await supabaseServer();
  let q = sb.from('audit_log').select('id, at, actor, action, table_name, record_id, meta').order('id', { ascending: false }).limit(300);
  if (sp.from) q = q.gte('at', sp.from); if (sp.to) q = q.lte('at', sp.to + 'T23:59:59Z'); if (sp.table) q = q.eq('table_name', sp.table);
  const { data, error } = await q;
  const { data: ex } = await sb.from('report_exports').select('id, exported_at, report_key, format, row_count, sensitive, exported_by').order('exported_at', { ascending: false }).limit(50);
  return (
    <div className="grid">
      <div><h1>Audit log</h1><p className="muted" style={{ margin: 0 }}>Append-only record of changes, postings, reversals, period changes and exports. Sensitive payment details are redacted.</p></div>
      <form className="row card" method="get"><label className="f">From<input type="date" name="from" defaultValue={sp.from} /></label><label className="f">To<input type="date" name="to" defaultValue={sp.to} /></label><label className="f">Table<input name="table" placeholder="e.g. journals" defaultValue={sp.table} /></label><button className="btn">Filter</button></form>
      {error && <div className="alert err">{error.message}</div>}
      <DataTable cols={[{ key: 'at', label: 'When' }, { key: 'actor', label: 'User' }, { key: 'action', label: 'Action' }, { key: 'table_name', label: 'Table' }, { key: 'record_id', label: 'Record' }]} rows={(data ?? []) as Record<string, unknown>[]} empty="No audit entries match." />
      <h2>Report and payslip exports</h2>
      <DataTable cols={[{ key: 'exported_at', label: 'When' }, { key: 'report_key', label: 'Report' }, { key: 'format', label: 'Format' }, { key: 'row_count', label: 'Rows', format: 'number' }, { key: 'sensitive', label: 'Payroll / restricted', format: 'bool' }, { key: 'exported_by', label: 'User' }]} rows={(ex ?? []) as Record<string, unknown>[]} empty="No exports yet." />
    </div>
  );
}
