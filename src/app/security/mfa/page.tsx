import { brand } from '@/lib/company';
import MfaPanel from './MfaPanel';
export const dynamic = 'force-dynamic';
export default function MfaPage() {
  return <main className="login" style={{ gridTemplateColumns: '1fr' }}><div className="pane"><div className="box card"><h1>Two-factor authentication</h1><p className="muted">{brand().legalName} requires a one-time code from your authenticator app.</p><MfaPanel /></div></div></main>;
}
