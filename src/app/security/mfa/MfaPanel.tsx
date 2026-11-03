'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function MfaPanel() {
  const r = useRouter(); const sb = supabaseBrowser();
  const [factorId, setFactorId] = useState(''); const [qr, setQr] = useState(''); const [secret, setSecret] = useState('');
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [enrolling, setEnrolling] = useState(false);
  useEffect(() => { (async () => {
    const { data } = await sb.auth.mfa.listFactors();
    const verified = data?.totp?.find((f) => f.status === 'verified');
    if (verified) { setFactorId(verified.id); return; }
    setEnrolling(true);
    const { data: e, error } = await sb.auth.mfa.enroll({ factorType: 'totp' });
    if (error || !e) { setErr(error?.message ?? 'Could not start enrolment'); return; }
    setFactorId(e.id); setQr(e.totp.qr_code); setSecret(e.totp.secret);
  })(); }, []);
  async function verify(ev: React.FormEvent) {
    ev.preventDefault(); setErr('');
    const ch = await sb.auth.mfa.challenge({ factorId });
    if (ch.error) { setErr(ch.error.message); return; }
    const v = await sb.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
    if (v.error) { setErr('Invalid code. Try again.'); return; }
    r.replace('/dashboard'); r.refresh();
  }
  return (
    <form onSubmit={verify} style={{ display: 'grid', gap: 12 }}>
      {enrolling && qr && <><p>Scan this QR code with your authenticator app, then enter the 6-digit code.</p><img src={qr} alt="Authenticator QR code" width={180} height={180} /><p className="muted" style={{ fontSize: 12 }}>Manual key: <code>{secret}</code></p></>}
      <label className="f">6-digit code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
      {err && <div className="alert err" role="alert">{err}</div>}
      <button className="btn" disabled={!factorId}>Verify</button>
      <a href="/logout">Cancel and log out</a>
    </form>
  );
}
