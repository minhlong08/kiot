import { getPrisma } from '../src/db';
import { seedBase } from '../src/seed/base';

const prisma = getPrisma();
const created = await seedBase(prisma);
console.log(created ? 'Seeded base data (admin / admin123)' : 'Database already seeded');
await prisma.$disconnect();
