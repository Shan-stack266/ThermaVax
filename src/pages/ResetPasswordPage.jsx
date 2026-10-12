import { useMemo, useState } from 'react';
import { Brand } from '../components/Common';
import ThemeToggle from '../components/ThemeToggle';
import { api, clearSession } from '../services/api';

function resetCredentials() {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  return {
    code: query.get('code') || '',
    access_token: hash.get('access_token') || query.get('access_token') || ''
  };
}

export default function ResetPasswordPage({ theme, onToggleTheme, onDone }) {
  const credentials = useMemo(resetCredentials, []);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const validLink = Boolean(credentials.code || credentials.access_token);
  const submit = async event => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      clearSession();
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ ...credentials, password })
      });
      history.replaceState(null, '', location.pathname);
      setDone(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return <main className="login-page">
    <section className="login-brand"><Brand /><div className="login-copy"><span className="eyebrow">Account recovery</span><h1>Set a new password.</h1></div><p className="login-footer">ThermaVax logistics platform</p></section>
    <section className="login-panel"><ThemeToggle theme={theme} onToggle={onToggleTheme} className="login-theme-toggle" /><div className="login-form-wrap"><span className="eyebrow">Password reset</span>{done ? <><h2>Password updated</h2><button type="button" className="primary login-submit" onClick={onDone}>Back to sign in</button></> : <><h2>Create new password</h2>{error && <div className="form-message error">{error}</div>}{!validLink ? <><div className="form-message error">This password reset link is invalid or expired.</div><button type="button" className="text-button login-help" onClick={onDone}>Back to sign in</button></> : <form className="login-form" onSubmit={submit}><div className="field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength="8" value={password} onChange={event => setPassword(event.target.value)} required /></div><div className="field"><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" minLength="8" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required /></div><button className="primary login-submit" type="submit" disabled={busy}>{busy ? 'Updating...' : 'Update password'}</button></form>}</>}</div></section>
  </main>;
}
