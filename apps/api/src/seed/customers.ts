import { normalizeVi } from '@pd/shared';
import type { PrismaClient } from '../generated/prisma/client';
import { newVoucherCode } from '../services/promotions';

const CUSTOMERS = [
  { name: 'Nguyễn Thị Mai Anh', phone: '0903111222', gender: 'female', birthday: '1990-03-14', province: 'TP. Hồ Chí Minh', ward: 'Phường Bến Nghé' },
  { name: 'Trần Quốc Bảo', phone: '0912222333', gender: 'male', birthday: '1985-11-02', province: 'TP. Hồ Chí Minh', ward: 'Phường Tân Định' },
  { name: 'Lê Hoàng Phúc', phone: '0987333444', gender: 'male', birthday: '1993-10-20', province: 'Đồng Nai', ward: 'Phường Trấn Biên' },
  { name: 'Phạm Ngọc Hân', phone: '0935444555', gender: 'female', birthday: '1998-07-08', province: 'TP. Hồ Chí Minh', ward: 'Phường Sài Gòn' },
  { name: 'Võ Minh Khang', phone: '0978555666', gender: 'male', birthday: null, province: 'Tây Ninh', ward: '' },
  { name: 'Công ty TNHH Sự Kiện Ánh Dương', phone: '02839666777', gender: '', birthday: null, province: 'TP. Hồ Chí Minh', ward: 'Phường Bàn Cờ', type: 'company', taxCode: '0315999888' },
];

/** Demo customers, groups, promotions, a voucher batch and message templates (fresh installs only). */
export async function seedCustomers(prisma: PrismaClient) {
  if (await prisma.customer.count()) return;
  const vip = await prisma.customerGroup.create({ data: { name: 'Khách VIP', discountPercent: 5, minTotalSpent: 20_000_000 } });
  await prisma.customerGroup.create({ data: { name: 'Khách thân thiết', discountPercent: 2, minTotalSpent: 5_000_000 } });
  for (const [i, c] of CUSTOMERS.entries()) {
    const code = `KH${String(i + 1).padStart(6, '0')}`;
    const bday = c.birthday ? new Date(`${c.birthday}T00:00:00Z`) : null;
    await prisma.customer.create({
      data: {
        code, name: c.name, phone: c.phone, gender: c.gender, type: c.type ?? 'person', taxCode: c.taxCode ?? '', company: c.type === 'company' ? c.name : '',
        birthday: bday, birthMonth: bday ? bday.getUTCMonth() + 1 : null, province: c.province, ward: c.ward, address: `${10 + i * 7} Đường số ${i + 2}`,
        groupId: i === 5 ? vip.id : null, searchText: normalizeVi(`${code} ${c.name} ${c.phone}`),
      },
    });
  }
  await prisma.documentSequence.upsert({ where: { prefix: 'KH' }, create: { prefix: 'KH', next: CUSTOMERS.length + 1 }, update: { next: CUSTOMERS.length + 1 } });

  const accessoriesWomen = await prisma.productGroup.findFirst({ where: { name: 'Phụ kiện Nữ' } });
  const ties = await prisma.product.findMany({ where: { code: { in: ['NA010', 'NA011', 'NA012'] } } });
  const base = { daysOfWeek: '[]', hours: '[]', branchIds: '[]', customerGroupIds: '[]', combinable: false };
  await prisma.promotion.create({ data: { ...base, code: 'KM000001', name: 'Giảm theo giá trị hóa đơn', type: 'invoiceDiscount', config: JSON.stringify({ tiers: [{ minTotal: 2_000_000, value: 5, unit: '%' }, { minTotal: 5_000_000, value: 8, unit: '%', maxDiscount: 1_000_000 }] }) } });
  await prisma.promotion.create({ data: { ...base, code: 'KM000002', name: 'Phụ kiện nữ giảm 10%', type: 'productDiscount', config: JSON.stringify({ productIds: [], groupIds: accessoriesWomen ? [accessoriesWomen.id] : [], minQty: 1, value: 10, unit: '%' }) } });
  await prisma.promotion.create({ data: { ...base, code: 'KM000003', name: 'Mua 2 cà vạt tặng 1', type: 'buyXGetY', config: JSON.stringify({ buyProductIds: ties.map(t => t.id), buyQty: 2, getProductIds: ties.map(t => t.id), getQty: 1, getDiscountPercent: 100 }) } });
  await prisma.documentSequence.upsert({ where: { prefix: 'KM' }, create: { prefix: 'KM', next: 4 }, update: { next: 4 } });

  const campaign = await prisma.voucherCampaign.create({ data: { code: 'VC000001', name: 'Giảm 50K cho đơn từ 500K', value: 50_000, unit: 'VND', minOrder: 500_000 } });
  const codes = new Set<string>();
  while (codes.size < 20) codes.add(newVoucherCode());
  await prisma.voucher.createMany({ data: [...codes].map(code => ({ campaignId: campaign.id, code })) });
  await prisma.documentSequence.upsert({ where: { prefix: 'VC' }, create: { prefix: 'VC', next: 2 }, update: { next: 2 } });

  await prisma.messageTemplate.createMany({ data: [
    { name: 'Chúc mừng sinh nhật', channel: 'sms', body: '{TenCuaHang} chúc {TenKhachHang} sinh nhật vui vẻ! Tặng bạn ưu đãi 10% trong tháng sinh nhật.' },
    { name: 'Nhắc công nợ', channel: 'zalo', body: 'Chào {TenKhachHang}, công nợ hiện tại của bạn tại {TenCuaHang} là {CongNo}đ. Cảm ơn bạn!' },
  ] });
}
