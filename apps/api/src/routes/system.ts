import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, badRequest } from '../lib/errors';
import { user } from '../plugins/auth';
import { audit } from '../services/audit';
import { BACKUP_APP, BACKUP_VERSION, exportAll, importAll, wipeAll, type BackupDoc } from '../services/backup';
import { ensureDefaults, seedBase } from '../seed/base';
import { seedCatalog } from '../seed/catalog';
import { seedPurchasing } from '../seed/purchasing';
import { seedCustomers } from '../seed/customers';
import { seedSales } from '../seed/sales';
import { seedOnline } from '../seed/online';
import { seedStaff } from '../seed/staff';

const adminOnly = (req: FastifyRequest) => { if (!user(req).isAdmin) throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên được sao lưu / khôi phục dữ liệu'); };
const docSchema = z.object({ app: z.string(), version: z.string(), createdAt: z.string(), tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))) });

/** Full-database backup/restore (JSON, provider-independent) and demo reset. Uploaded images live in data/uploads and are not included. */
export async function systemRoutes(app: FastifyInstance) {
  const db = app.prisma;
  app.get('/api/system/backup', async (req, reply) => {
    adminOnly(req);
    const doc = await exportAll(db);
    await audit(db, req.auditCtx, { action: 'settings', entity: 'System', entityId: 0, entityCode: 'backup', summary: 'Tải bản sao lưu dữ liệu' });
    const stamp = doc.createdAt.slice(0, 16).replace(/[-:T]/g, '');
    return reply.header('content-disposition', `attachment; filename="phuongdong-backup-${stamp}.json"`).type('application/json').send(doc);
  });
  app.post('/api/system/restore', { bodyLimit: 200 * 1024 * 1024 }, async req => {
    adminOnly(req);
    const doc = docSchema.parse(req.body) as BackupDoc;
    if (doc.app !== BACKUP_APP || doc.version !== BACKUP_VERSION) throw new AppError(400, 'BACKUP_VERSION', 'Bản sao lưu không thuộc phiên bản dữ liệu này, không thể khôi phục');
    try {
      await importAll(db, doc);
    } catch (e) {
      throw badRequest('BACKUP_INVALID', `Bản sao lưu bị lỗi, dữ liệu chưa thay đổi (${(e as Error).message.split('\n').pop()?.slice(0, 160)})`);
    }
    // Everyone but the caller signs in again; the caller too if their account isn't in the restored data.
    const u = user(req);
    const stillThere = await db.user.findUnique({ where: { id: u.id } });
    await db.session.deleteMany({ where: stillThere ? { id: { not: u.sessionId } } : {} });
    await audit(db, req.auditCtx, { action: 'settings', entity: 'System', entityId: 0, entityCode: 'restore', summary: `Khôi phục dữ liệu từ bản sao lưu ${doc.createdAt}` });
    return { ok: true, tables: Object.keys(doc.tables).length };
  });
  app.post('/api/system/reset-demo', async req => {
    adminOnly(req);
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body);
    if (confirm !== 'XOA DU LIEU') throw badRequest('CONFIRM', 'Gõ đúng "XOA DU LIEU" để xác nhận');
    await wipeAll(db);
    await seedBase(db); await ensureDefaults(db);
    await seedCatalog(db); await seedPurchasing(db); await seedCustomers(db); await seedSales(db); await seedOnline(db); await seedStaff(db);
    return { ok: true };
  });
}
