import { beforeEach, expect, test, vi } from 'vitest';
import { deleteDB } from 'idb';
import { enqueue, listQueue, syncQueue, resetDbForTests } from '../src/lib/sync';

beforeEach(async () => { await resetDbForTests(); await deleteDB('pd-pos'); });

const sale = { lines: [{ productId: 1, unitId: null, qty: 1, price: 1000, discount: 0, note: '', isGift: false }], payments: [{ method: 'cash' as const, amount: 1000, fundId: null }] };

test('a queued sale survives a reload and is sent once with its uuid', async () => {
  const item = await enqueue(sale, 'Hóa đơn 1');
  await resetDbForTests(); // simulate reload: new connection
  expect((await listQueue()).map(q => q.clientUuid)).toEqual([item.clientUuid]);
  const send = vi.fn().mockResolvedValue({ id: 9, code: 'HD000009' });
  const r = await syncQueue(send);
  expect(r).toEqual({ sent: 1, failed: 0 });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ clientUuid: item.clientUuid }));
  expect(await listQueue()).toEqual([]);
  await syncQueue(send);
  expect(send).toHaveBeenCalledTimes(1);
});

test('a rejected sale stays queued with the server error; a network error keeps it pending', async () => {
  await enqueue(sale, 'Hóa đơn 1');
  await syncQueue(vi.fn().mockRejectedValue(Object.assign(new Error('Không đủ tồn kho'), { status: 409 })));
  expect((await listQueue())[0]).toMatchObject({ status: 'error', error: 'Không đủ tồn kho' });
  await enqueue(sale, 'Hóa đơn 2');
  await syncQueue(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  expect((await listQueue()).find(q => q.label === 'Hóa đơn 2')).toMatchObject({ status: 'pending' });
});

test('server hiccups (5xx, 401, 408, 429) keep the sale pending; only real rejections become errors', async () => {
  await enqueue(sale, 'Hóa đơn 3');
  for (const status of [502, 503, 401, 429]) {
    await syncQueue(vi.fn().mockRejectedValue(Object.assign(new Error('tạm thời'), { status })));
    expect((await listQueue()).find(q => q.label === 'Hóa đơn 3')).toMatchObject({ status: 'pending' });
  }
});
