import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeVi } from '@pd/shared';
import type { PrismaClient } from '../generated/prisma/client';
import { UPLOAD_DIR } from '../routes/files';
import { COLORS, silhouette, type SilhouetteKind } from './silhouettes';

/** [code, name, kind, colorKey, price, cost, group, brand?] — fictional demo catalogue. */
type Row = [string, string, SilhouetteKind, string, number, number, string, string?];

const MEN: Row[] = [
  ['NA001', 'Áo vest nam Lịch Lãm màu xám', 'vest', 'xám', 1_890_000, 820_000, 'Thời trang Nam', 'Phương Đông'],
  ['NA002', 'Áo vest nam slim fit màu đen', 'vest', 'đen', 2_150_000, 960_000, 'Thời trang Nam', 'Phương Đông'],
  ['NA003', 'Áo vest nam kẻ caro xanh than', 'vest', 'xanh than', 2_390_000, 1_050_000, 'Thời trang Nam'],
  ['NA004', 'Áo sơ mi nam trắng công sở', 'shirt', 'trắng', 450_000, 180_000, 'Thời trang Nam', 'Phương Đông'],
  ['NA005', 'Áo sơ mi nam xanh nhạt', 'shirt', 'xanh nhạt', 420_000, 170_000, 'Thời trang Nam'],
  ['NA006', 'Áo sơ mi nam hồng pastel', 'shirt', 'hồng', 430_000, 175_000, 'Thời trang Nam'],
  ['NA007', 'Quần âu nam đen ống đứng', 'trousers', 'đen', 590_000, 240_000, 'Thời trang Nam', 'Phương Đông'],
  ['NA008', 'Quần âu nam xám chì', 'trousers', 'xám', 560_000, 230_000, 'Thời trang Nam'],
  ['NA009', 'Quần kaki nam màu be', 'trousers', 'be', 490_000, 200_000, 'Thời trang Nam'],
  ['NA010', 'Cà vạt lụa xanh than', 'tie', 'xanh than', 290_000, 95_000, 'Phụ kiện Nam'],
  ['NA011', 'Cà vạt đỏ đô chấm bi', 'tie', 'đỏ', 270_000, 90_000, 'Phụ kiện Nam'],
  ['NA012', 'Cà vạt bản nhỏ màu tím', 'tie', 'tím', 250_000, 85_000, 'Phụ kiện Nam'],
  ['NA013', 'Thắt lưng da nam màu đen', 'belt', 'đen', 650_000, 260_000, 'Phụ kiện Nam', 'Da Việt'],
  ['NA014', 'Thắt lưng da nam màu nâu', 'belt', 'nâu', 620_000, 250_000, 'Phụ kiện Nam', 'Da Việt'],
  ['NA015', 'Giày tây nam da bò đen', 'shoe', 'đen', 1_450_000, 640_000, 'Phụ kiện Nam', 'Da Việt'],
  ['NA016', 'Giày tây nam màu nâu bò', 'shoe', 'nâu', 1_390_000, 610_000, 'Phụ kiện Nam', 'Da Việt'],
  ['NA017', 'Giày lười nam da lộn xanh than', 'shoe', 'xanh than', 1_190_000, 520_000, 'Phụ kiện Nam'],
  ['NA018', 'Ví da nam gập đôi đen', 'wallet', 'đen', 390_000, 140_000, 'Phụ kiện Nam', 'Da Việt'],
  ['NA019', 'Ví da nam dáng đứng nâu', 'wallet', 'nâu', 420_000, 150_000, 'Phụ kiện Nam', 'Da Việt'],
  ['NA020', 'Cặp da công sở nam đen', 'bag', 'đen', 1_690_000, 720_000, 'Phụ kiện Nam', 'Da Việt'],
  ['NA021', 'Cặp da nam màu nâu', 'bag', 'nâu', 1_590_000, 690_000, 'Phụ kiện Nam'],
  ['NA022', 'Áo vest nam cưới màu kem', 'vest', 'kem', 2_690_000, 1_200_000, 'Thời trang Nam', 'Phương Đông'],
  ['NA023', 'Áo sơ mi nam đen lụa', 'shirt', 'đen', 520_000, 210_000, 'Thời trang Nam'],
  ['NA024', 'Quần âu nam xanh than', 'trousers', 'xanh than', 580_000, 235_000, 'Thời trang Nam'],
];

const WOMEN: Row[] = [
  ['NU001', 'Áo vest nữ công sở màu đen', 'vest', 'đen', 1_490_000, 640_000, 'Thời trang Nữ', 'Phương Đông'],
  ['NU002', 'Áo vest nữ màu ghi xám', 'vest', 'xám', 1_390_000, 600_000, 'Thời trang Nữ'],
  ['NU003', 'Áo vest nữ hồng phấn', 'vest', 'hồng', 1_290_000, 560_000, 'Thời trang Nữ'],
  ['NU004', 'Áo vest nữ xanh dương', 'vest', 'xanh dương', 1_590_000, 690_000, 'Thời trang Nữ', 'Phương Đông'],
  ['NU005', 'Ví nữ cầm tay màu tím', 'wallet', 'tím', 290_000, 95_000, 'Phụ kiện Nữ'],
  ['NU006', 'Ví nữ dài xanh nhạt', 'wallet', 'xanh nhạt', 350_000, 120_000, 'Phụ kiện Nữ'],
  ['NU007', 'Ví nữ mini xanh lá', 'wallet', 'xanh lá', 320_000, 110_000, 'Phụ kiện Nữ'],
  ['NU008', 'Túi xách nữ công sở xanh dương', 'bag', 'xanh dương', 1_290_000, 540_000, 'Phụ kiện Nữ', 'Da Việt'],
  ['NU009', 'Giày cao gót nữ mũi nhọn đen', 'shoe', 'đen', 890_000, 380_000, 'Phụ kiện Nữ'],
  ['NU010', 'Giày búp bê nữ màu trắng', 'shoe', 'trắng', 690_000, 290_000, 'Phụ kiện Nữ'],
  ['NU011', 'Giày cao gót nữ xanh ánh kim', 'shoe', 'xanh dương', 950_000, 410_000, 'Phụ kiện Nữ'],
  ['NU012', 'Giày sandal nữ màu kem', 'shoe', 'kem', 790_000, 330_000, 'Phụ kiện Nữ'],
  ['NU013', 'Thắt lưng nữ bản nhỏ nâu', 'belt', 'nâu', 290_000, 110_000, 'Phụ kiện Nữ'],
  ['NU014', 'Thắt lưng nữ khóa vàng xanh than', 'belt', 'xanh than', 390_000, 150_000, 'Phụ kiện Nữ', 'Da Việt'],
  ['NU015', 'Thắt lưng nữ da mềm xanh lá', 'belt', 'xanh lá', 260_000, 95_000, 'Phụ kiện Nữ'],
  ['NU016', 'Thắt lưng nữ màu vàng nghệ', 'belt', 'vàng', 310_000, 120_000, 'Phụ kiện Nữ'],
];

/** Demo catalogue for a fresh install. Products start at zero stock; demo purchase receipts add stock later. */
export async function seedCatalog(prisma: PrismaClient) {
  if (await prisma.product.count()) return;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const groups = new Map<string, number>();
  for (const name of ['Thời trang Nam', 'Thời trang Nữ', 'Phụ kiện Nam', 'Phụ kiện Nữ']) groups.set(name, (await prisma.productGroup.create({ data: { name } })).id);
  const brands = new Map<string, number>();
  for (const name of ['Phương Đông', 'Da Việt']) brands.set(name, (await prisma.brand.create({ data: { name } })).id);
  const shelf = await prisma.location.create({ data: { name: 'Kệ trưng bày 1' } });

  for (const [code, name, kind, color, price, cost, group, brand] of [...MEN, ...WOMEN]) {
    const file = `seed-${kind}-${normalizeVi(color).replace(/\s+/g, '-')}.svg`;
    await fs.writeFile(path.join(UPLOAD_DIR, file), silhouette(kind, COLORS[color]));
    const p = await prisma.product.create({
      data: {
        code, name, searchText: normalizeVi(`${code}  ${name}`), type: 'goods', groupId: groups.get(group)!, brandId: brand ? brands.get(brand)! : null,
        locationId: shelf.id, unit: kind === 'shoe' ? 'đôi' : 'cái', price, cost, minStock: 1, maxStock: 50, loyaltyEnabled: true, sellOnline: true,
        weight: kind === 'vest' ? 900 : kind === 'shoe' ? 1000 : 300,
        description: `${name}. Chất liệu cao cấp, đường may tỉ mỉ.`,
      },
    });
    await prisma.productImage.create({ data: { productId: p.id, url: `/files/${file}`, sort: 0 } });
  }
  // A service and a combo so every product type exists in the demo.
  await prisma.product.create({ data: { code: 'DV001', name: 'Sửa đồ, lên gấu quần', searchText: normalizeVi('DV001 Sửa đồ, lên gấu quần'), type: 'service', unit: 'lần', price: 50_000, cost: 0, loyaltyEnabled: false } });
  const tie = await prisma.product.findUniqueOrThrow({ where: { code: 'NA010' } });
  const shirt = await prisma.product.findUniqueOrThrow({ where: { code: 'NA004' } });
  const combo = await prisma.product.create({ data: { code: 'CB001', name: 'Combo sơ mi trắng + cà vạt', searchText: normalizeVi('CB001 Combo sơ mi trắng + cà vạt'), type: 'combo', groupId: groups.get('Thời trang Nam')!, unit: 'bộ', price: 650_000, cost: 0 } });
  await prisma.comboItem.createMany({ data: [{ comboId: combo.id, itemId: shirt.id, qty: 1 }, { comboId: combo.id, itemId: tie.id, qty: 1 }] });
}
