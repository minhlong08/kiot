import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

test('GET settings returns defaults', async () => {
  const res = await t.app.inject({ url: '/api/settings', headers: { cookie: admin } });
  expect(res.json().orders.codePrefixes.invoice).toBe('HD');
});

test('partial PUT keeps other defaults and is audited with a diff', async () => {
  const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie: admin }, payload: { products: { allowNegativeStock: true } } });
  expect(res.statusCode).toBe(200);
  const s = res.json();
  expect(s.products.allowNegativeStock).toBe(true);
  expect(s.products.costMethod).toBe('average');
  expect(s.customers.vndPerPoint).toBe(10000);
  const log = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'settings' } });
  expect(JSON.parse(log.diff).products).toBeDefined();
});

test('invalid settings are rejected', async () => {
  const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie: admin }, payload: { tax: { mode: 'weird' } } });
  expect(res.statusCode).toBe(400);
});

test('audit-logs filter by entity', async () => {
  const res = await t.app.inject({ url: '/api/audit-logs?entity=Setting', headers: { cookie: admin } });
  const items = res.json().items as { entity: string }[];
  expect(items.length).toBeGreaterThan(0);
  expect(items.every(i => i.entity === 'Setting')).toBe(true);
});

test('audit-logs export is an xlsx file', async () => {
  const res = await t.app.inject({ url: '/api/audit-logs/export', headers: { cookie: admin } });
  expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
