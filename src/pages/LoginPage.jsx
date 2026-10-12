import { useState } from 'react';
import { Brand } from '../components/Common';
import ThemeToggle from '../components/ThemeToggle';
import { api, login } from '../services/api';

export default function LoginPage({ onLogin, notify, theme, onToggleTheme }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try { onLogin(await login(email, password)); }
    catch (requestError) { setError(requestError.message); setBusy(false); }
  };
  const resend = async () => {
    if (!email.trim()) return notify('Enter the staff email address first');
    try {
      await api('/api/auth/resend-confirmation', { method: 'POST', body: JSON.stringify({ email }) });
      notify('If confirmation is pending, a new email has been sent');
    } catch (requestError) { notify(requestError.message); }
  };
  const requestReset = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setSent(true);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const showLogin = () => {
    setMode('login');
    setSent(false);
    setError('');
  };
  return <main className="login-page">
    <section className="login-brand"><Brand /><div className="login-copy"><span className="eyebrow">Cold-chain logistics</span><h1>Keep every shipment on course.</h1></div><p className="login-footer">ThermaVax logistics platform</p></section>
    <section className="login-panel"><ThemeToggle theme={theme} onToggle={onToggleTheme} className="login-theme-toggle" /><div className="login-form-wrap"><span className="eyebrow">Workspace access</span>{mode === 'login' ? <><h2>Welcome back</h2>{error && <div className="form-message error">{error}</div>}<form className="login-form" onSubmit={submit}><div className="field"><label htmlFor="login-email">Email address</label><input id="login-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></div><div className="field"><label htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" minLength="8" value={password} onChange={event => setPassword(event.target.value)} required /></div><button className="primary login-submit" type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button></form><div className="login-link-row"><button type="button" className="text-button" onClick={() => { setMode('forgot'); setError(''); }}>Forgot password?</button><button type="button" className="text-button" onClick={resend}>Resend confirmation email</button></div></> : <><h2>Reset password</h2>{error && <div className="form-message error">{error}</div>}{sent ? <div className="form-message success">If an account exists for this email, a password reset link has been sent.</div> : <form className="login-form" onSubmit={requestReset}><div className="field"><label htmlFor="reset-email">Email address</label><input id="reset-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></div><button className="primary login-submit" type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button></form>}<button type="button" className="text-button login-help" onClick={showLogin}>Back to sign in</button></>}</div></section>
  </main>;
}
