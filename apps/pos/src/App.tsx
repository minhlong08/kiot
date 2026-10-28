import { useEffect, useState } from 'react';
import { APP_NAME } from '@pd/shared';

type Me = { user: { fullName: string; branchId: number }; branches: { id: number; name: string }[] };

/** Placeholder until milestone 5 builds the cashier screen. */
export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).then(setMe, () => setMe(null));
  }, []);
  if (me === undefined) return null;
  if (!me) {
    return (
      <div className="flex h-full items-center justify-center">
        <a href="/login" className="rounded-md bg-brand-700 px-4 py-2 text-white">Đăng nhập để bán hàng</a>
      </div>
    );
  }
  const branch = me.branches.find(b => b.id === me.user.branchId);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 bg-brand-700 px-4 py-2 text-white">
        <span className="font-semibold">{APP_NAME}</span>
        <span className="flex-1" />
        <span>{me.user.fullName}</span>
        <span className="opacity-80">{branch?.name}</span>
      </header>
      <main className="flex flex-1 items-center justify-center text-slate-500">Màn hình bán hàng (sẽ hoàn thiện ở giai đoạn 5)</main>
    </div>
  );
}
