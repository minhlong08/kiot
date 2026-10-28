import { normalizeVi } from '@pd/shared';
import type { PrismaClient } from '../src/generated/prisma/client';

let seq = 0;

export async function makeProduct(prisma: PrismaClient, o: Partial<{ code: string; name: string; type: string; price: number; cost: number; groupId: number | null; isDirectSale: boolean; barcode: string | null; minStock: number; maxStock: number; loyaltyEnabled: boolean }> = {}) {
  seq += 1;
  const code = o.code ?? `T${String(seq).padStart(5, '0')}`;
  const name = o.name ?? `Sản phẩm ${seq}`;
  return prisma.product.create({
    data: { code, name, searchText: normalizeVi(`${code} ${o.barcode ?? ''} ${name}`), type: o.type ?? 'goods', price: o.price ?? 100_000, cost: o.cost ?? 50_000, groupId: o.groupId ?? null, isDirectSale: o.isDirectSale ?? true, barcode: o.barcode ?? null, minStock: o.minStock ?? 0, maxStock: o.maxStock ?? 999_999_999, loyaltyEnabled: o.loyaltyEnabled ?? true },
  });
}

export async function mainBranchId(prisma: PrismaClient) {
  return (await prisma.branch.findFirstOrThrow({ where: { code: 'CN01' } })).id;
}

export async function makeSupplier(prisma: PrismaClient, name = `NCC ${++seq}`) {
  return prisma.supplier.create({ data: { code: `S${String(++seq).padStart(5, '0')}`, name, searchText: normalizeVi(name) } });
}

export async function makeCustomer(prisma: PrismaClient, o: Partial<{ name: string; phone: string; groupId: number | null; totalSpent: number }> = {}) {
  const name = o.name ?? `Khách ${++seq}`;
  const code = `C${String(++seq).padStart(5, '0')}`;
  return prisma.customer.create({ data: { code, name, phone: o.phone ?? '', groupId: o.groupId ?? null, totalSpent: o.totalSpent ?? 0, searchText: normalizeVi(`${code} ${name} ${o.phone ?? ''}`) } });
}

/** An AuthUser-shaped object for calling services directly. */
export function fakeUser(o: Partial<{ id: number; isAdmin: boolean; permissions: string[]; maxDiscountPercent: number; branchId: number }> = {}) {
  return {
    id: o.id ?? 1, username: 'u', fullName: 'Thu ngân', roleId: 1, roleName: 'r', isAdmin: o.isAdmin ?? false,
    permissions: new Set(o.permissions ?? ['pos.access', 'invoices.create']), maxDiscountPercent: o.maxDiscountPercent ?? 10,
    branchId: o.branchId ?? 1, mustChangePassword: false, sessionId: 's',
  };
}
