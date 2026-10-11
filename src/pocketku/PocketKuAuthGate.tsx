import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import './pocketkuAuth.css';

type AuthState = 'checking' | 'signed-out' | 'signed-in' | 'setup-error';

export default function PocketKuAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('checking');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' }).then(async response => {
      if (!active) return;
      if (response.status === 503) { setState('setup-error'); return; }
      if (!response.ok) throw new Error('Cannot reach login service.');
      const data = await response.json() as { authenticated?: boolean };
      if (active) setState(data.authenticated ? 'signed-in' : 'signed-out');
    }).catch(error => { if (active) { setState('setup-error'); setNotice(String(error)); } });
    return () => { active = false; };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true); setNotice('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      const result = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not sign in.');
      setPassword('');
      // Start a clean authenticated React tree and fetch financial data only after sign-in.
      window.location.reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not sign in.');
    } finally { setSubmitting(false); }
  }

  if (state === 'signed-in') return <>{children}</>;
  return <div className="pk-auth-page">
    <div className="pk-auth-card">
      <div className="pk-auth-icon">◈</div>
      <h1>PocketKu<span>.</span></h1>
      <p className="pk-auth-tagline">Your money. Your plan.</p>
      {state === 'checking' && <p role="status">Checking your session…</p>}
      {state === 'setup-error' && <div className="pk-auth-error" role="alert">
        The login service isn't ready. Apply migration 0010 and configure your local login credentials.
        {notice && <p>{notice}</p>}
      </div>}
      {state === 'signed-out' && <form onSubmit={signIn}>
        <h2>Personal sign in</h2>
        <label htmlFor="pk-login-id">Login email (can be an alias)</label>
        <input id="pk-login-id" autoComplete="username" type="text" value={login} onChange={e => setLogin(e.target.value)} required />
        <label htmlFor="pk-login-password">Password</label>
        <input id="pk-login-password" autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        {notice && <p className="pk-auth-error" role="alert">{notice}</p>}
        <button disabled={submitting} type="submit">{submitting ? 'Signing in…' : 'Sign in'}</button>
        <p className="pk-auth-help">Private account · No sign-up or email verification</p>
      </form>}
    </div>
  </div>;
}
