/** CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF), uppercase 4-hex as required by EMVCo QR. Payloads are ASCII. */
export function crc16ccitt(s: string): string {
  let crc = 0xffff;
  for (let k = 0; k < s.length; k++) {
    const byte = s.charCodeAt(k) & 0xff;
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** Removes Vietnamese accents and anything banks reject in a transfer description. */
function asciiDescription(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9 ]/g, ' ').trim().slice(0, 50);
}

/** VietQR (NAPAS 247) payload, generated locally; any banking app can scan it. */
export function buildVietQrPayload(p: { bankBin: string; accountNumber: string; amount?: number; description?: string }): string {
  const beneficiary = tlv('00', p.bankBin) + tlv('01', p.accountNumber);
  const merchant = tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');
  const desc = p.description ? asciiDescription(p.description) : '';
  const body = tlv('00', '01') + tlv('01', p.amount ? '12' : '11') + tlv('38', merchant) + tlv('53', '704')
    + (p.amount ? tlv('54', String(Math.round(p.amount))) : '') + tlv('58', 'VN') + (desc ? tlv('62', tlv('08', desc)) : '') + '6304';
  return body + crc16ccitt(body);
}
