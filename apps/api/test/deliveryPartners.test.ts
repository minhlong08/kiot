import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { postPartnerLedger } from '../src/services/partnerLedger';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('create a partner with a flat fee and quote it; by-weight partners charge per started kg', async () => {
  const flat = (await req('POST', '/api/delivery-partners', { name: 'Giao Nhanh Phố', phone: '0901000001', feeMode: 'flat', flatFee: 30_000 })).json();
  expect(flat.code).toMatch(/^DT\d{6}$/);
  expect((await req('POST', `/api/delivery-partners/${flat.id}/quote`, { weight: 2500 })).json()).toEqual({ fee: 30_000 });
  const kg = (await req('POST', '/api/delivery-partners', { name: 'Vận Tải Sông Hồng', feeMode: 'byWeight', flatFee: 15_000, feePerKg: 5_000 })).json();
  expect((await req('POST', `/api/delivery-partners/${kg.id}/quote`, { weight: 2500 })).json()).toEqual({ fee: 15_000 + 3 * 5_000 });
  const list = (await req('GET', '/api/delivery-partners?search=song hong')).json();
  expect(list.items.map((p: { id: number }) => p.id)).toEqual([kg.id]);
});

test('a deliveryPartner ledger keeps the cached debt; a partner with history is deactivated, not deleted', async () => {
  const p = (await req('POST', '/api/delivery-partners', { name: 'Đối tác sổ nợ', feeMode: 'flat', flatFee: 0 })).json();
  await postPartnerLedger(t.prisma, { partnerType: 'deliveryPartner', partnerId: p.id, amount: 500_000, docType: 'deliveryCod', docId: 1, docCode: 'HD000001' });
  await postPartnerLedger(t.prisma, { partnerType: 'deliveryPartner', partnerId: p.id, amount: -30_000, docType: 'deliveryFee', docId: 1, docCode: 'HD000001' });
  expect((await req('GET', `/api/delivery-partners/${p.id}`)).json().debt).toBe(470_000);
  expect((await req('GET', `/api/delivery-partners/${p.id}/ledger`)).json().items.map((r: { balanceAfter: number }) => r.balanceAfter)).toEqual([470_000, 500_000]);
  expect((await req('DELETE', `/api/delivery-partners/${p.id}`)).json()).toEqual({ deactivated: true });
  const unused = (await req('POST', '/api/delivery-partners', { name: 'Chưa dùng', feeMode: 'flat', flatFee: 0 })).json();
  expect((await req('DELETE', `/api/delivery-partners/${unused.id}`)).json()).toEqual({ deleted: true });
});
