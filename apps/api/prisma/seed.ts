import { getPrisma } from '../src/db';
import { ensureDefaults, seedBase } from '../src/seed/base';
import { seedCatalog } from '../src/seed/catalog';
import { seedPurchasing } from '../src/seed/purchasing';
import { seedCustomers } from '../src/seed/customers';
import { seedSales } from '../src/seed/sales';
import '../src/services/customerOrders';

const prisma = getPrisma();
const fresh = await seedBase(prisma);
if (!fresh) await ensureDefaults(prisma);
// Demo data only on a brand-new install, never on an existing database.
if (fresh) {
  await seedCatalog(prisma);
  await seedPurchasing(prisma);
  await seedCustomers(prisma);
  await seedSales(prisma);
}
console.log(fresh ? 'Seeded base + demo data (admin / admin123)' : 'Database already seeded');
await prisma.$disconnect();
