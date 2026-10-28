import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Partner } from './types';

export const usePartners = (status = 'active') =>
  useQuery({ queryKey: ['delivery-partners', status], queryFn: () => api<{ items: Partner[]; total: number }>('/delivery-partners', { query: { pageSize: 100, status } }) });
