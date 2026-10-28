import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Fund = { id: number; name: string; type: 'cash' | 'bank' | 'ewallet'; bankName?: string; accountNumber?: string };
export type CashCategory = { id: number; kind: 'in' | 'out'; name: string; isSystem: boolean };

export const useFunds = () => useQuery({ queryKey: ['cash-funds'], queryFn: () => api<Fund[]>('/cash-funds') });
export const useCashCategories = () => useQuery({ queryKey: ['cash-categories'], queryFn: () => api<CashCategory[]>('/cash-categories') });
