import { brand, otherBrand, otherCompanyUrl } from '@/lib/company';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const b = brand();
  return (
    <main className="login">
      <section className="hero" aria-label={b.legalName}>
        <img className="bg" src={b.loginBg.src} alt="" width={b.loginBg.w} height={b.loginBg.h} fetchPriority="high" style={{ objectPosition: b.loginBg.position }} />
        <div className="shade" />
        <div className="logo-card" style={{ position: "relative", zIndex: 2 }}><img src={b.logo} alt={`${b.legalName} logo`} width={b.logoSize.w > 400 ? 120 : 150} height={b.logoSize.w > 400 ? 135 : 104} fetchPriority="high" style={{ maxWidth: '100%', maxHeight: 100, width: 'auto', height: 'auto' }} /></div>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h1>Finance Management System</h1>
          <p style={{ fontSize: 18, margin: '0 0 6px' }}>{b.tagline}</p>
          <p>{b.loginSubtitle}</p>
        </div>
        <p style={{ fontSize: 12, opacity: .85, position: "relative", zIndex: 2 }}>Authorised accountant access only. Activity is audited.</p>
      </section>
      <section className="pane">
        <div className="box">
          <h1>Welcome back</h1>
          <p className="muted">Sign in to the {b.legalName} account. This system serves this company only.</p>
          <LoginForm />
          {otherCompanyUrl() && <p className="muted" style={{ fontSize: 13, marginTop: 18 }}>Working in {otherBrand().legalName} instead? <a href={`${otherCompanyUrl()}/login`}>Go to its sign-in</a></p>}
        </div>
      </section>
    </main>
  );
}
