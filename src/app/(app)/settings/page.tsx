import Link from 'next/link';
import ResourcePage from '@/components/ResourcePage';
import CompanySettings from '@/components/CompanySettings';
import { supabaseServer } from '@/lib/supabase-server';
import { periods, fxRates, accountsCfg, costCentres, reportNotes } from '@/lib/configs';
import type { ResourceConfig } from '@/components/types';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Settings' };
const mappings: ResourceConfig = { title: 'Account mappings', table: 'account_mappings', order: 'key', ascending: true, select: '*, accounts(code,name)', description: 'System accounts used by invoices, bills, payroll, depreciation, FX and operations postings.', columns: [{ key: 'key', label: 'Key' }, { key: 'accounts.code', label: 'Code' }, { key: 'accounts.name', label: 'Account' }], fields: [{ name: 'key', label: 'Key', required: true, readOnlyOnEdit: true }, { name: 'account_id', label: 'Account', type: 'select', required: true, optionsFrom: { table: 'accounts', value: 'id', label: 'name', order: 'code' } }], editable: true, createLabel: 'Add mapping' };
const TABS: [string, string, ResourceConfig | null][] = [['company', 'Company', null], ['periods', 'Fiscal periods', periods], ['fx', 'Exchange rates', fxRates], ['accounts', 'Chart of accounts', accountsCfg], ['costcentres', 'Cost centres', costCentres], ['mappings', 'Account mappings', mappings], ['notes', 'Statement notes', reportNotes], ['security', 'Security', null]];
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = 'company' } = await searchParams; const t = TABS.find((x) => x[0] === tab) ?? TABS[0];
  const sb = await supabaseServer(); const { data: cs } = await sb.from('company_settings').select('*').limit(1).single(); const { data: { user } } = await sb.auth.getUser();
  return (
    <div className="grid"><div><h1>Settings</h1></div>
      <nav className="tabs" aria-label="Settings sections">{TABS.map(([k, l]) => <Link key={k} href={`/settings?tab=${k}`} aria-current={t[0] === k}>{l}</Link>)}</nav>
      {t[0] === 'company' && cs && <CompanySettings initial={cs} />}
      {t[0] === 'security' && <div className="card"><h2>Security</h2><p>Signed in as <b>{user?.email}</b> (accountant). Last sign-in: {user?.last_sign_in_at?.slice(0, 16).replace('T', ' ')} UTC.</p><p>Multi-factor authentication: {process.env.REQUIRE_MFA === 'true' ? 'required for every session on this deployment.' : 'not enforced on this deployment (set REQUIRE_MFA=true).'} <Link href="/security/mfa">Set up or verify authenticator</Link></p><p className="muted">Passwords are changed in the Supabase Auth dashboard for this company&rsquo;s project. Sessions end when you log out.</p></div>}
      {t[2] && <ResourcePage config={t[2]} />}
    </div>
  );
}
