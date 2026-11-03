import Link from 'next/link';
import ResourcePage from '@/components/ResourcePage';
import NewRunForm from '@/components/NewRunForm';
import { employees, structures, structureComponents, allocations, rules } from '@/lib/configs';
import type { ResourceConfig } from '@/components/types';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Payroll' };
const runs: ResourceConfig = { title: 'Payroll runs', table: 'payroll_runs', order: 'created_at', columns: [{ key: 'period_year', label: 'Year' }, { key: 'period_month', label: 'Month' }, { key: 'kind', label: 'Kind' }, { key: 'seq', label: '#' }, { key: 'status', label: 'Status', format: 'pill' }, { key: 'ghana_compliance_applied', label: 'Ghana compliance', format: 'bool' }, { key: 'finalized_at', label: 'Finalized', format: 'date' }] };
const TABS: [string, string, ResourceConfig][] = [['employees', 'Employees', employees], ['structures', 'Salary structures', structures], ['components', 'Allowances & deductions', structureComponents], ['allocations', 'Cost allocations', allocations], ['rules', 'Statutory rules', rules]];
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = 'runs' } = await searchParams; const t = TABS.find((x) => x[0] === tab);
  return (
    <div className="grid">
      <div><h1>Payroll</h1><p className="muted" style={{ margin: 0 }}>Monthly payroll. Workflow: review employees and structures, enter approved variable pay, calculate, review exceptions, finalize, post, pay, export.</p></div>
      <nav className="tabs" aria-label="Payroll sections"><Link href="/payroll" aria-current={tab === 'runs'}>Runs</Link>{TABS.map(([k, l]) => <Link key={k} href={`/payroll?tab=${k}`} aria-current={tab === k}>{l}</Link>)}</nav>
      {t ? <ResourcePage config={t[2]} /> : <><NewRunForm /><div className="tablewrap"><RunsList /></div></>}
    </div>
  );
}
async function RunsList() {
  const { supabaseServer } = await import('@/lib/supabase-server'); const sb = await supabaseServer();
  const { data } = await sb.from('payroll_runs').select('*').order('period_year', { ascending: false }).order('period_month', { ascending: false }).order('seq', { ascending: false });
  return (
    <table><thead><tr><th>Period</th><th>Kind</th><th>Status</th><th>Ghana compliance</th><th /></tr></thead><tbody>
      {(data ?? []).map((r) => <tr key={r.id}><td>{r.period_year}-{String(r.period_month).padStart(2, '0')}</td><td>{r.kind} #{r.seq}</td><td><span className={`pill ${r.status}`}>{r.status}</span></td><td>{r.ghana_compliance_applied === null ? '-' : r.ghana_compliance_applied ? 'Applied' : 'Not applied'}</td><td><Link className="btn alt sm" href={`/payroll/runs/${r.id}`}>Open</Link></td></tr>)}
    </tbody></table>
  );
}
void runs;
