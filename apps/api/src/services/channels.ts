import type { Tx } from '../db';

/** Labels only: marketplace/social integrations would plug in behind these codes. */
export const DEFAULT_CHANNELS = [
  { code: 'store', name: 'Cửa hàng' }, { code: 'website', name: 'Website bán hàng' }, { code: 'facebook', name: 'Facebook' },
  { code: 'zalo', name: 'Zalo' }, { code: 'shopee', name: 'Shopee' },
];

export async function ensureSalesChannels(tx: Tx) {
  for (const c of DEFAULT_CHANNELS) await tx.salesChannel.upsert({ where: { code: c.code }, create: c, update: {} });
}
