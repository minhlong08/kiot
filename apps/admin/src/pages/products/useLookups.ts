import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export type Group = { id: number; name: string; parentId: number | null; productCount: number };
export type Named = { id: number; name: string };

export const useGroups = () => useQuery({ queryKey: ['product-groups'], queryFn: () => api<Group[]>('/product-groups') });
export const useBrands = () => useQuery({ queryKey: ['brands'], queryFn: () => api<Named[]>('/brands') });
export const useLocations = () => useQuery({ queryKey: ['locations'], queryFn: () => api<Named[]>('/locations') });
export const useBranches = () => useQuery({ queryKey: ['branches'], queryFn: () => api<{ items: (Named & { code: string; isActive: boolean })[] }>('/branches', { query: { pageSize: 100 } }) });

/** Group rows ordered depth-first with their depth, for indented pickers. */
export function flattenGroups(groups: Group[]): (Group & { depth: number })[] {
  const out: (Group & { depth: number })[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const g of groups.filter(x => x.parentId === parentId)) {
      out.push({ ...g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
