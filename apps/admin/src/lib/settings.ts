import { useQuery } from '@tanstack/react-query';
import type { Settings } from '@pd/shared';
import { api } from './api';

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings'), staleTime: 5 * 60_000 });
}
