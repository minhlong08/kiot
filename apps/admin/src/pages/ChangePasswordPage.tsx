import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Logo } from '../components/Logo';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { t } from '../lib/i18n';

export function ChangePasswordPage() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setError(t('auth.mismatch'));
    try {
      await api('/auth/change-password', { body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      await refresh();
      navigate({ to: '/dashboard' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="text-center text-lg font-semibold">{t('auth.changeTitle')}</h1>
        {me?.user.mustChangePassword && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">{t('auth.changeHint')}</p>}
        {(['currentPassword', 'newPassword', 'confirm'] as const).map(k => (
          <div key={k}>
            <label className="label" htmlFor={k}>{t(k === 'currentPassword' ? 'auth.current' : k === 'newPassword' ? 'auth.new' : 'auth.confirm')}</label>
            <input id={k} type="password" className="input" value={form[k]} onChange={set(k)} />
          </div>
        ))}
        {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
        <button type="submit" className="btn-primary w-full py-2">{t('auth.save')}</button>
      </form>
    </div>
  );
}
