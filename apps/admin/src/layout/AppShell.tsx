import type { ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { MainNav } from './MainNav';
import { TopBar } from './TopBar';
import { NoticeBar } from './NoticeBar';
import { useAuth } from '../lib/auth';
import { Toaster } from '../components/toast';

export function AppShell({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const path = useRouterState({ select: s => s.location.pathname });
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <MainNav can={can} currentPath={path} renderLink={(to, label, className) => <Link to={to} className={className}>{label}</Link>} />
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      <NoticeBar />
      <Toaster />
    </div>
  );
}
