'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (password.length < 12) {
      setError('Use at least 12 characters.');
      return;
    }

    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }

    setBusy(true);
    const supabase = supabaseBrowser();
    const { data } = await supabase.auth.getSession();

    if (!data.session) {
      setError('This recovery link is invalid or expired. Request a new one.');
      setBusy(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    await supabase.auth.signOut();
    setMessage('Password updated. Sign in with your new password.');
    setBusy(false);
    setTimeout(() => router.replace('/login'), 1500);
  }

  return (
    <main className="login">
      <section className="pane">
        <div className="box">
          <h1>Choose a new password</h1>
          <p className="muted">Use at least 12 characters and meet the company password requirements.</p>
          <form onSubmit={submit} style={{ display: 'grid', gap: 14, marginTop: 18 }}>
            <label className="f">New password
              <input type="password" required minLength={12} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
            </label>
            <label className="f">Confirm new password
              <input type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
            </label>
            {message && <div className="alert">{message}</div>}
            {error && <div className="alert err">{error}</div>}
            <button className="btn" disabled={busy}>{busy ? 'Updating' : 'Update password'}</button>
          </form>
          <p className="muted" style={{ marginTop: 18 }}><a href="/login">Return to sign in</a></p>
        </div>
      </section>
    </main>
  );
}
