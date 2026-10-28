import type { Promotion, Settings } from '@pd/shared';

export type Bootstrap = {
  settings: Settings;
  branch: { id: number; name: string; address: string; phone: string };
  funds: { id: number; name: string; type: 'cash' | 'bank' | 'ewallet'; accountNumber: string; bankName: string }[];
  channels: { id: number; code: string; name: string }[];
  groups: { id: number; name: string; parentId: number | null }[];
  users: { id: number; fullName: string }[];
  priceBooks: { id: number; name: string; customerGroupIds: number[]; allowOutsideItems: boolean }[];
  promotions: Promotion[];
  user: { id: number; fullName: string; isAdmin: boolean; maxDiscountPercent: number; canEditPrice: boolean; canSeeCost: boolean; permissions: string[] };
  serverTime: string;
};
export type PosCustomer = { id: number; code: string; name: string; phone: string; searchText?: string; groupId: number | null; groupName: string; discountPercent: number; debt: number; points: number };
