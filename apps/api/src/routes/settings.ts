import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../plugins/auth';
import { getSettings, updateSettings } from '../services/settings';

export async function settingsRoutes(app: FastifyInstance) {
  // Every signed-in screen needs settings (prefixes, loyalty rates), so reading is open to all users.
  app.get('/api/settings', async () => getSettings(app.prisma));

  app.put('/api/settings', { preHandler: requirePermission('settings.edit') }, async req =>
    app.prisma.$transaction(tx => updateSettings(tx, req.auditCtx, req.body)));
}
