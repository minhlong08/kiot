const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const UNITS = ['', 'nghìn', 'triệu', 'tỷ'];

/** Reads a 0–999 group; `full` forces "không trăm" for groups after the leading one. */
function readGroup(n: number, full: boolean): string {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  const out: string[] = [];
  if (h > 0 || full) out.push(`${DIGITS[h]} trăm`);
  if (t === 0 && u > 0) out.push(out.length ? `lẻ ${DIGITS[u]}` : DIGITS[u]);
  else if (t === 1) out.push(u === 0 ? 'mười' : `mười ${u === 5 ? 'lăm' : DIGITS[u]}`);
  else if (t > 1) out.push(`${DIGITS[t]} mươi${u === 0 ? '' : ` ${u === 1 ? 'mốt' : u === 5 ? 'lăm' : DIGITS[u]}`}`);
  return out.join(' ');
}

/** "1.200.000" → "Một triệu hai trăm nghìn đồng" (printed on cash vouchers and invoices). */
export function amountInWords(amount: number): string {
  let n = Math.abs(Math.round(amount));
  if (n === 0) return 'Không đồng';
  const groups: number[] = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const unit = UNITS[i % 4] || (i >= 4 ? 'tỷ' : '');
    parts.push(`${readGroup(groups[i], i < groups.length - 1)}${unit ? ` ${unit}` : ''}`);
  }
  const s = `${amount < 0 ? 'âm ' : ''}${parts.join(' ')} đồng`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
