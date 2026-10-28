import { getPrisma } from '../src/db';
import { seedBase } from '../src/seed/base';
import { seedCatalog } from '../src/seed/catalog';
import { seedPurchasing } from '../src/seed/purchasing';
import { seedCustomers } from '../src/seed/customers';

const prisma = getPrisma();
const fresh = await seedBase(prisma);
// Demo data only on a brand-new install, never on an existing database.
if (fresh) {
  await seedCatalog(prisma);
  await seedPurchasing(prisma);
  await seedCustomers(prisma);
}
console.log(fresh ? 'Seeded base + demo data (admin / admin123)' : 'Database already seeded');
await prisma.$disconnect();
