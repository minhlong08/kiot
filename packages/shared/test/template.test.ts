import { expect, test } from 'vitest';
import { renderTemplate } from '../src/template';

test('escapes by default; triple braces render raw', () => {
  expect(renderTemplate('<b>{{name}}</b>{{{logo}}}', { name: '<script>alert(1)</script>', logo: '<img src="x.png">' }))
    .toBe('<b>&lt;script&gt;alert(1)&lt;/script&gt;</b><img src="x.png">');
});

test('loops lines with nested fields and the index', () => {
  expect(renderTemplate('{{#lines}}[{{@index}}:{{name}}x{{qty}}]{{/lines}}', { lines: [{ name: 'Áo', qty: 2 }, { name: 'Cà vạt', qty: 1 }] })).toBe('[1:Áox2][2:Cà vạtx1]');
});

test('formatters and dotted paths; conditional sections', () => {
  const out = renderTemplate('{{money total}} · {{date createdAt}} · {{store.name}}{{#customer}} · {{customer.name}}{{/customer}}{{^customer}} · Khách lẻ{{/customer}}', {
    total: 1234000, createdAt: '2026-10-28T03:05:00Z', store: { name: 'Phương Đông' }, customer: null,
  });
  expect(out).toBe('1,234,000 · 28/10/2026 10:05 · Phương Đông · Khách lẻ');
  expect(renderTemplate('{{words total}}', { total: 1_200_000 })).toBe('Một triệu hai trăm nghìn đồng');
});

test('unknown placeholders and broken sections render empty, never throw', () => {
  expect(renderTemplate('a{{nope}}b{{money nope}}c{{#x}}d', {})).toBe('ab0c');
});
