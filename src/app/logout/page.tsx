import { brand, otherBrand, otherCompanyUrl } from '@/lib/company';
import LogoutButtons from './LogoutButtons';
export const dynamic = 'force-dynamic';
export default async function LogoutPage({ searchParams }: { searchParams: Promise<{ switch?: string }> }) {
  const b = brand(); const o = otherBrand(); const url = otherCompanyUrl(); const sw = !!(await searchParams).switch;
  return (
    <main className="login" style={{ gridTemplateColumns: '1fr' }}>
      <div className="pane"><div className="box card" style={{ textAlign: 'center' }}>
        {sw ? (
          <>
            <h1>Switch company</h1>
            <div className="switch-note"><img src={b.logo} alt={b.legalName} width={b.logoSize.w} height={b.logoSize.h} /><span aria-hidden="true">&rarr;</span><img src={o.logo} alt={o.legalName} width={o.logoSize.w} height={o.logoSize.h} /></div>
            <p>You are signed in to <b>{b.legalName}</b>. To work in <b>{o.legalName}</b>, log out here, then sign in there with that company&rsquo;s own credentials.</p>
            <p className="muted" style={{ fontSize: 12 }}>The two companies are completely separate systems. Nothing is shared, so you always sign in again.{url ? '' : ' Open the other company\u2019s address after logging out.'}</p>
          </>
        ) : (
          <>
            <h1>Log out</h1>
            <p>Are you sure you want to log out of {b.legalName}?</p>
            <p className="muted" style={{ fontSize: 12 }}>Your session will end. To work in the other company, sign in there with its own credentials.</p>
          </>
        )}
        <LogoutButtons nextUrl={sw ? url : null} label={sw ? `Log out and go to ${o.shortName}` : 'Log out'} />
      </div></div>
    </main>
  );
}
