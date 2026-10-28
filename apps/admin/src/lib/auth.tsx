import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type Me = {
  user: { id: number; username: string; fullName: string; roleName: string; isAdmin: boolean; branchId: number; mustChangePassword: boolean; maxDiscountPercent: number };
  branches: { id: number; code: string; name: string }[];
  permissions: string[];
};

type AuthValue = {
  me: Me | null;
  loading: boolean;
  can: (perm: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  switchBranch: (id: number) => Promise<void>;
  branch: Me['branches'][number] | undefined;
};

const Ctx = createContext<AuthValue | null>(null);

/**
 * Auth lives in React state (not the query cache) so that `await refresh(); navigate(...)`
 * commits the new user and the new route in the same render; route guards never see a stale user.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setMe(await api<Me>('/auth/me').catch(() => null));
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const value: AuthValue = {
    me,
    loading,
    can: perm => !!me && (me.user.isAdmin || me.permissions.includes(perm)),
    refresh,
    logout: async () => {
      await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
      qc.clear();
      window.location.href = '/login';
    },
    switchBranch: async id => {
      await api('/auth/switch-branch', { body: { branchId: id } });
      qc.clear();
      window.location.reload();
    },
    branch: me?.branches.find(b => b.id === me.user.branchId),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
