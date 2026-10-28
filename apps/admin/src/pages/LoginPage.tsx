import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Logo } from '../components/Logo';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { t } from '../lib/i18n';

export function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ user: { mustChangePassword: boolean } }>('/auth/login', { body: { login, password } });
      await refresh();
      const next = new URLSearchParams(window.location.search).get('next');
      if (!res.user.mustChangePassword && next?.startsWith('/sale')) return window.location.assign(next);
      navigate({ to: res.user.mustChangePassword ? '/change-password' : '/dashboard' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-800 to-brand-600 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="text-center text-lg font-semibold">{t('auth.title')}</h1>
        <div>
          <label className="label" htmlFor="login">{t('auth.login')}</label>
          <input id="login" className="input" autoFocus value={login} onChange={e => setLogin(e.target.value)} autoComplete="username" />
        </div>
        <div>
          <label className="label" htmlFor="password">{t('auth.password')}</label>
          <input id="password" type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
        <button type="submit" className="btn-primary w-full py-2" disabled={busy || !login || !password}>{t('auth.submit')}</button>
      </form>
    </div>
  );
}
