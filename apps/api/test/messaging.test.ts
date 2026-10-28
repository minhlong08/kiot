import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeCustomer } from './factories';
import { renderTemplate } from '../src/routes/messaging';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('placeholders are rendered', () => {
  expect(renderTemplate('Chào {TenKhachHang} ({MaKhachHang}), bạn có {DiemHienTai} điểm, nợ {CongNo}đ tại {TenCuaHang}', { code: 'KH1', name: 'Lan', points: 120, debt: 50000 }, { storeName: 'PD' }))
    .toBe('Chào Lan (KH1), bạn có 120 điểm, nợ 50,000đ tại PD');
});

test('sending to a filter writes one log per customer and skips those without a phone', async () => {
  const g = await t.prisma.customerGroup.create({ data: { name: 'Gửi tin' } });
  for (const phone of ['0901', '0902', '']) await makeCustomer(t.prisma, { phone, groupId: g.id });
  const tpl = (await req('POST', '/api/message-templates', { name: 'Sinh nhật', channel: 'sms', body: 'Chúc mừng {TenKhachHang}' })).json();
  const res = (await req('POST', '/api/messages/send', { templateId: tpl.id, channel: 'sms', filter: { groupIds: String(g.id) } })).json();
  expect(res).toMatchObject({ sent: 2, skipped: 1, failed: 0 });
  const logs = (await req('GET', '/api/messages')).json();
  expect(logs.items).toHaveLength(2);
  expect(logs.items[0]).toMatchObject({ status: 'sent', provider: 'stub' });
});
