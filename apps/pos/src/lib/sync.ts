import type { InvoiceInput } from '@pd/shared';
import { closeDb, db } from './db';

export type SaleDraft = Partial<InvoiceInput> & Pick<InvoiceInput, 'lines' | 'payments'>;
export type QueueItem = { clientUuid: string; label: string; createdAt: string; status: 'pending' | 'error'; error?: string; sale: SaleDraft & { clientUuid: string; createdAtClient: string } };

export async function resetDbForTests() { await closeDb(); }

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
}));

/** Saves a sale for sending; the uuid makes replays idempotent on the server. */
export async function enqueue(sale: SaleDraft, label: string): Promise<QueueItem> {
  const clientUuid = uuid();
  const createdAt = new Date().toISOString();
  const item: QueueItem = { clientUuid, label, createdAt, status: 'pending', sale: { ...sale, clientUuid, createdAtClient: createdAt } };
  await (await db()).put('queue', item);
  return item;
}

export async function listQueue(): Promise<QueueItem[]> {
  return ((await (await db()).getAll('queue')) as QueueItem[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export async function removeFromQueue(clientUuid: string) { await (await db()).delete('queue', clientUuid); }

let running: Promise<{ sent: number; failed: number }> | null = null;

/**
 * Sends queued sales in order. Network failures leave items pending (retry later);
 * server rejections mark them as errors for the cashier to fix or discard.
 */
export function syncQueue(send: (sale: QueueItem['sale']) => Promise<unknown>): Promise<{ sent: number; failed: number }> {
  running ??= (async () => {
    let sent = 0, failed = 0;
    for (const item of await listQueue()) {
      if (item.status === 'error') continue;
      try {
        await send(item.sale);
        await removeFromQueue(item.clientUuid);
        sent++;
      } catch (e) {
        const status = (e as { status?: number }).status;
        // Offline, server restarting, session expired or rate-limited: try again later, keep order.
        if (!status || status >= 500 || [401, 408, 429].includes(status)) break;
        failed++;
        await (await db()).put('queue', { ...item, status: 'error', error: (e as Error).message });
      }
    }
    return { sent, failed };
  })().finally(() => { running = null; });
  return running;
}

export async function retryItem(clientUuid: string) {
  const d = await db();
  const item = (await d.get('queue', clientUuid)) as QueueItem | undefined;
  if (item) await d.put('queue', { ...item, status: 'pending', error: undefined });
}

export async function getMeta<T>(key: string): Promise<T | undefined> { return (await (await db()).get('meta', key)) as T | undefined; }
export async function setMeta(key: string, value: unknown) { await (await db()).put('meta', value, key); }
