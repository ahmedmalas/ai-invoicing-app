import { useState, type FormEvent } from 'react';
import { PasswordField } from './PasswordField';
import { getSupabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

type Props = {
  onAuthed: () => void;
};

export function AuthPanel({ onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const supabase = getSupabase();
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in.');
          setMode('signin');
          return;
        }
      }
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="auth-heading">
      <p className="eyebrow">Shared Aleya platform</p>
      <h2 id="auth-heading">{mode === 'signin' ? 'Sign in' : 'Create account'}</h2>
      <p className="lede">
        One identity for Logo Creator, Aleya Invoicing, and ABoss brand sync.
      </p>

      <div className="segmented" role="tablist" aria-label="Authentication mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={mode === 'signin' ? 'is-active' : ''}
          onClick={() => setMode('signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={mode === 'signup' ? 'is-active' : ''}
          onClick={() => setMode('signup')}
        >
          Sign up
        </button>
      </div>

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <PasswordField
          name="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </section>
  );
}
