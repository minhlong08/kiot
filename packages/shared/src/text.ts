export function normalizeVi(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keeps digits and a leading + so '0912 345.678' and '0912345678' compare equal. */
export function normalizePhone(s: string): string {
  const t = String(s ?? '').trim();
  return (t.startsWith('+') ? '+' : '') + t.replace(/\D/g, '');
}
