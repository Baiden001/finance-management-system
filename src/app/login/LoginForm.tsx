'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [show, setShow] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    if (error) { setErr('Sign-in failed. Check your email and password for this company.'); setBusy(false); return; }
    router.replace('/dashboard'); router.refresh();
  }
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14, marginTop: 18 }}>
      <label className="f">Email address<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="f">Password
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <input style={{ flex: 1 }} type={show ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="btn alt sm" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
        </span>
      </label>
      {err && <div className="alert err" role="alert">{err}</div>}
      <button className="btn" disabled={busy}>{busy ? 'Signing in' : 'Sign in'}</button>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        <a href="/forgot-password">Forgot your password?</a>
      </p>
      <p className="muted" style={{ fontSize: 12 }}>To work in the other company, sign out first and sign in with that company&rsquo;s own credentials.</p>
    </form>
  );
}
