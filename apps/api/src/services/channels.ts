import type { Tx } from '../db';

/** Labels only: marketplace/social integrations would plug in behind these codes. */
export const DEFAULT_CHANNELS = [
  { code: 'store', name: 'Cửa hàng' }, { code: 'facebook', name: 'Facebook' }, { code: 'zalo', name: 'Zalo' }, { code: 'phone', name: 'Điện thoại' },
  { code: 'website', name: 'Website' }, { code: 'marketplace', name: 'Sàn TMĐT' },
];

export async function ensureSalesChannels(tx: Tx) {
  for (const c of DEFAULT_CHANNELS) await tx.salesChannel.upsert({ where: { code: c.code }, create: c, update: {} });
}
