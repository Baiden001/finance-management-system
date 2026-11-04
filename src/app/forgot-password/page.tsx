'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');

    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) setError(error.message);
    else setMessage('If the account exists, a password recovery email has been sent.');

    setBusy(false);
  }

  return (
    <main className="login">
      <section className="pane">
        <div className="box">
          <h1>Reset your password</h1>
          <p className="muted">Enter your accountant email address. We will send a recovery link.</p>
          <form onSubmit={submit} style={{ display: 'grid', gap: 14, marginTop: 18 }}>
            <label className="f">Email address
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </label>
            {message && <div className="alert">{message}</div>}
            {error && <div className="alert err">{error}</div>}
            <button className="btn" disabled={busy}>{busy ? 'Sending' : 'Send recovery email'}</button>
          </form>
          <p className="muted" style={{ marginTop: 18 }}><a href="/login">Return to sign in</a></p>
        </div>
      </section>
    </main>
  );
}
