import { expect, test } from 'vitest';
import { buildVietQrPayload, crc16ccitt } from '../src';

test('CRC16-CCITT-FALSE check value', () => expect(crc16ccitt('123456789')).toBe('29B1'));

test('payload carries currency, country, amount, account and a valid CRC', () => {
  const p = buildVietQrPayload({ bankBin: '970436', accountNumber: '0011001234567', amount: 1_500_000, description: 'HD000045' });
  expect(p.startsWith('000201010212')).toBe(true);
  expect(p).toContain('0010A000000727');
  expect(p).toContain('5303704');
  expect(p).toContain('54071500000');
  expect(p).toContain('5802VN');
  expect(p).toContain('0808HD000045');
  expect(p.slice(-8, -4)).toBe('6304');
  expect(crc16ccitt(p.slice(0, -4))).toBe(p.slice(-4));
});
