import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('every kind/size has a default; a saved template overrides it and reset restores it', async () => {
  const list = (await req('GET', '/api/print-templates')).json();
  expect(list.map((x: { kind: string; size: string }) => `${x.kind}/${x.size}`)).toEqual(expect.arrayContaining(['invoice/58', 'invoice/80', 'invoice/A4', 'cashVoucher/A5']));
  const def = list.find((x: { kind: string; size: string }) => x.kind === 'invoice' && x.size === '80');
  expect([def.isDefault, def.body]).toEqual([true, expect.stringContaining('{{code}}')]);
  const saved = (await req('PUT', '/api/print-templates/invoice/80', { body: '<h1>{{store.name}}</h1>{{code}}' })).json();
  expect(saved.isDefault).toBe(false);
  expect((await req('GET', '/api/print-templates')).json().find((x: { kind: string; size: string }) => x.kind === 'invoice' && x.size === '80').body).toBe('<h1>{{store.name}}</h1>{{code}}');
  const preview = (await req('GET', '/api/print-templates/preview?kind=invoice&size=80')).json();
  expect(preview.html).toMatch(/<h1>.+<\/h1>HD\d{6}/);
  await req('DELETE', '/api/print-templates/invoice/80');
  expect((await req('GET', '/api/print-templates')).json().find((x: { kind: string; size: string }) => x.kind === 'invoice' && x.size === '80').isDefault).toBe(true);
  expect((await req('PUT', '/api/print-templates/invoice/99', { body: 'x' })).statusCode).toBe(400);
});
