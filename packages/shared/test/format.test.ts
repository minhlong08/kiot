import { describe, expect, test } from 'vitest';
import {
  formatVnd, parseVnd, formatDateTime, formatDate, dateRangePreset, normalizeVi, formatCode,
  settingsSchema, moneySchema, listQuerySchema, changePasswordSchema, MODULES, permKey,
} from '../src';

describe('money', () => {
  test('formats with comma thousands', () => expect(formatVnd(69128000)).toBe('69,128,000'));
  test('formats negatives', () => expect(formatVnd(-50000)).toBe('-50,000'));
  test('parses formatted text', () => expect(parseVnd('1,234,000')).toBe(1234000));
  test('parses empty as 0', () => expect(parseVnd('')).toBe(0));
  test('caps money at 2 billion', () => expect(() => moneySchema.parse(2_100_000_000)).toThrow('Giá trị quá lớn'));
});

describe('dates in Asia/Ho_Chi_Minh', () => {
  test('formatDateTime shifts to local time', () => expect(formatDateTime('2026-10-28T17:30:00Z')).toBe('29/10/2026 00:30'));
  test('formatDate', () => expect(formatDate('2026-10-28T17:30:00Z')).toBe('29/10/2026'));
  test('today near UTC midnight uses local day', () => {
    const r = dateRangePreset('today', new Date('2026-10-28T17:30:00Z'));
    expect(r.from!.toISOString()).toBe('2026-10-28T17:00:00.000Z');
    expect(r.to!.toISOString()).toBe('2026-10-29T17:00:00.000Z');
  });
  test('thisWeek starts Monday', () => {
    expect(dateRangePreset('thisWeek', new Date('2026-10-28T05:00:00Z')).from!.toISOString()).toBe('2026-10-25T17:00:00.000Z');
  });
  test('lastMonth', () => {
    const r = dateRangePreset('lastMonth', new Date('2026-10-28T05:00:00Z'));
    expect(r.from!.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(r.to!.toISOString()).toBe('2026-09-30T17:00:00.000Z');
  });
  test('all is unbounded', () => expect(dateRangePreset('all')).toEqual({ from: null, to: null }));
});

describe('text and codes', () => {
  test('normalizeVi strips diacritics and đ', () => expect(normalizeVi('  Áo  Vest ĐEN ')).toBe('ao vest den'));
  test('formatCode pads to 6', () => expect(formatCode('HD', 45)).toBe('HD000045'));
});

describe('schemas', () => {
  test('settings defaults', () => {
    const s = settingsSchema.parse({});
    expect(s.customers.vndPerPoint).toBe(10000);
    expect(s.orders.codePrefixes.invoice).toBe('HD');
    expect(s.products.allowNegativeStock).toBe(false);
  });
  test('settings partial keeps defaults', () => {
    const s = settingsSchema.parse({ products: { allowNegativeStock: true } });
    expect(s.products.costMethod).toBe('average');
  });
  test('list query defaults', () => expect(listQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 15 }));
  test('list query coerces strings', () => expect(listQuerySchema.parse({ page: '2', pageSize: '50' })).toMatchObject({ page: 2, pageSize: 50 }));
  test('new password cannot be admin123', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'admin123' }).success).toBe(false);
  });
  test('permissions', () => {
    expect(MODULES.map(m => m.key)).toContain('transfers');
    expect(permKey('products', 'view')).toBe('products.view');
  });
});
