import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId } from './factories';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('salary templates validate and round-trip allowances/deductions; an in-use template is deactivated on delete', async () => {
  expect((await req('POST', '/api/salary-templates', { name: 'Theo giờ', mode: 'perHour', amount: 0 })).statusCode).toBe(400);
  const tpl = (await req('POST', '/api/salary-templates', { name: 'Bán hàng theo ca', mode: 'perShift', amount: 220_000, allowances: [{ name: 'Ăn trưa', amount: 30_000, per: 'shift' }], deductions: [{ name: 'Đi muộn', amount: 50_000, per: 'late' }] })).json();
  expect(tpl.allowances).toEqual([{ name: 'Ăn trưa', amount: 30_000, per: 'shift' }]);
  expect((await req('GET', '/api/salary-templates')).json().find((x: { id: number }) => x.id === tpl.id).deductions[0].per).toBe('late');
  await req('POST', '/api/employees', { name: 'Dùng mẫu', branchId: await mainBranchId(t.prisma), salaryTemplateId: tpl.id });
  expect((await req('DELETE', `/api/salary-templates/${tpl.id}`)).json()).toEqual({ deactivated: true });
  const unused = (await req('POST', '/api/salary-templates', { name: 'Cố định', mode: 'monthly', amount: 7_500_000 })).json();
  expect((await req('DELETE', `/api/salary-templates/${unused.id}`)).json()).toEqual({ deleted: true });
});

test('commission tables keep their rules; invalid rules are refused', async () => {
  const rules = [{ scope: 'all', refId: null, type: 'percent', value: 2 }, { scope: 'group', refId: 3, type: 'percent', value: 5 }, { scope: 'product', refId: 9, type: 'fixed', value: 20_000 }];
  const c = (await req('POST', '/api/commission-tables', { name: 'Hoa hồng bán hàng', rules })).json();
  expect(c.rules).toEqual(rules);
  expect((await req('PUT', `/api/commission-tables/${c.id}`, { name: 'Hoa hồng 2', rules: [{ scope: 'group', refId: null, type: 'percent', value: 5 }] })).statusCode).toBe(400);
  expect((await req('POST', '/api/commission-tables', { name: 'Sai', rules: [{ scope: 'all', refId: null, type: 'percent', value: 150 }] })).statusCode).toBe(400);
});
