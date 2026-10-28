import { expect, test } from 'vitest';
import { amountInWords } from '../src';

test('amounts in Vietnamese words', () => {
  expect(amountInWords(0)).toBe('Không đồng');
  expect(amountInWords(1_200_000)).toBe('Một triệu hai trăm nghìn đồng');
  expect(amountInWords(105_000)).toBe('Một trăm lẻ năm nghìn đồng');
  expect(amountInWords(21_500)).toBe('Hai mươi mốt nghìn năm trăm đồng');
  expect(amountInWords(15)).toBe('Mười lăm đồng');
  expect(amountInWords(2_000_000_000)).toBe('Hai tỷ đồng');
  expect(amountInWords(1_004_000)).toBe('Một triệu không trăm lẻ bốn nghìn đồng');
});
