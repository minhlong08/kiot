import bcrypt from 'bcryptjs';
import type { PrismaClient } from '../generated/prisma/client';

export const CASHIER_PERMS = ['pos.access', 'invoices.view', 'invoices.create', 'returns.view', 'returns.create', 'customers.view', 'customers.create', 'products.view', 'customerOrders.view', 'customerOrders.create'];

/** Minimum data for a working install. Idempotent: does nothing when a user exists. */
export async function seedBase(prisma: PrismaClient): Promise<boolean> {
  if (await prisma.user.count()) return false;
  const branch = await prisma.branch.create({ data: { code: 'CN01', name: 'Chi nhánh trung tâm', address: '' } });
  const admin = await prisma.role.create({ data: { name: 'Quản trị', isAdmin: true } });
  await prisma.role.create({
    data: { name: 'Nhân viên bán hàng', maxDiscountPercent: 10, permissions: { create: CASHIER_PERMS.map(key => ({ key })) } },
  });
  await prisma.user.create({
    data: {
      username: 'admin', fullName: 'Quản trị viên', passwordHash: await bcrypt.hash('admin123', 10),
      mustChangePassword: true, roleId: admin.id, defaultBranchId: branch.id, branchAccess: { create: [{ branchId: branch.id }] },
    },
  });
  return true;
}
