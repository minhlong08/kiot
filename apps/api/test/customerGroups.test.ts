import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeCustomer } from './factories';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('auto assignment picks the highest tier reached; manual groups stay', async () => {
  const vip = (await req('POST', '/api/customer-groups', { name: 'VIP', discountPercent: 5, minTotalSpent: 20_000_000 })).json();
  const loyal = (await req('POST', '/api/customer-groups', { name: 'Thân thiết', discountPercent: 2, minTotalSpent: 5_000_000 })).json();
  const manual = (await req('POST', '/api/customer-groups', { name: 'Sỉ' })).json();
  const a = await makeCustomer(t.prisma, { totalSpent: 25_000_000 });
  const b = await makeCustomer(t.prisma, { totalSpent: 6_000_000 });
  const c = await makeCustomer(t.prisma, { totalSpent: 30_000_000, groupId: manual.id });
  await req('POST', '/api/customer-groups/apply-auto', {});
  const group = async (id: number) => (await t.prisma.customer.findUniqueOrThrow({ where: { id } })).groupId;
  expect(await group(a.id)).toBe(vip.id);
  expect(await group(b.id)).toBe(loyal.id);
  expect(await group(c.id)).toBe(manual.id);
  const list = (await req('GET', '/api/customer-groups')).json();
  expect(list.find((g: { id: number }) => g.id === vip.id).customerCount).toBe(1);
});

test('a group in use cannot be deleted', async () => {
  const g = (await req('POST', '/api/customer-groups', { name: 'Đang dùng' })).json();
  await makeCustomer(t.prisma, { groupId: g.id });
  expect((await req('DELETE', `/api/customer-groups/${g.id}`)).json().error.code).toBe('IN_USE');
});
