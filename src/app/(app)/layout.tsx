import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { brand, companyCode, otherBrand } from '@/lib/company';
import { Icon } from '@/components/Icons';
import { supabaseServer } from '@/lib/supabase-server';
import NavLinks from '@/components/NavLinks';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const b = brand();
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: ok } = await supabase.rpc('is_accountant');
  if (ok !== true) {
    return <main className="content"><div className="alert err" role="alert"><h1>No access</h1><p>This account is not an authorised accountant for {b.legalName}. Sign out and use this company&rsquo;s own credentials.</p><a href="/logout">Sign out</a></div></main>;
  }
  // Hard isolation guard: refuse to operate if the database belongs to a different company than this deployment.
  const { data: cs } = await supabase.from('company_settings').select('company_code, display_name, base_currency, ghana_payroll_compliance').limit(1).maybeSingle();
  if (!cs || cs.company_code !== companyCode()) {
    return <main className="content"><div className="alert err" role="alert"><h1>Configuration error</h1><p>This deployment is configured for <b>{companyCode()}</b> but its database is {cs ? <>bound to <b>{cs.company_code}</b></> : 'not initialised (run the seed script)'}. Nothing will be shown until the Supabase URL and keys are corrected, to prevent cross-company access.</p></div></main>;
  }
  return (
    <div className="shell">
      <aside className="nav" aria-label="Main navigation">
        <div className="logo"><img src={b.logo} alt={b.legalName} width={b.logoSize.w} height={b.logoSize.h} /></div>
        <NavLinks items={b.nav} />
        <div className="foot"><div>{user.email}</div><div style={{ opacity: .8 }}>Accountant</div><div className="foot-links"><a href="/logout?switch=1"><Icon name="switch" size={16} />Switch to {otherBrand().shortName}</a><a href="/logout"><Icon name="logout" size={16} />Log out</a></div></div>
      </aside>
      <div className="main">
        <header className="topbar"><span className="co">{cs.display_name}</span><span className="row"><span className="badge-co">{cs.base_currency}</span>{cs.ghana_payroll_compliance ? <span className="pill active">Ghana payroll compliance on</span> : <span className="pill draft">Ghana payroll compliance off</span>}</span></header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
