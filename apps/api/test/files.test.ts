import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp, multipart } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const upload = (name: string, buf: Buffer, type: string, cookie: string | null = admin) => {
  const mp = multipart('file', name, buf, type);
  return t.app.inject({ method: 'POST', url: '/api/uploads', headers: { ...(cookie ? { cookie } : {}), ...mp.headers }, payload: mp.payload });
};

test('uploads a png and serves it publicly', async () => {
  const res = await upload('a.png', PNG, 'image/png');
  expect(res.statusCode).toBe(200);
  const { url } = res.json();
  expect(url).toMatch(/^\/files\/[\w-]+\.png$/);
  const got = await t.app.inject({ url });
  expect(got.statusCode).toBe(200);
  expect(got.headers['content-type']).toBe('image/png');
});

test('rejects non-image files', async () => {
  const res = await upload('a.txt', Buffer.from('hello'), 'text/plain');
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe('BAD_FILE');
});

test('rejects a png body that is not really a png', async () => {
  const res = await upload('fake.png', Buffer.from('<script>alert(1)</script>'), 'image/png');
  expect(res.statusCode).toBe(400);
});

test('rejects files over 2 MB', async () => {
  const res = await upload('big.png', Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]), 'image/png');
  expect(res.statusCode).toBe(413);
});

test('uploading requires a session', async () => {
  expect((await upload('a.png', PNG, 'image/png', null)).statusCode).toBe(401);
});

test('file names cannot escape the uploads folder', async () => {
  expect((await t.app.inject({ url: '/files/..%2F..%2Fpackage.json' })).statusCode).toBe(404);
});
