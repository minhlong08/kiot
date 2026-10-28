import { voucherTemplateData } from '@pd/shared';
import { api } from '../../lib/api';
import { printWithTemplate } from '../../lib/print';

type V = { code: string; kind: 'in' | 'out'; sourceCode: string | null } & Record<string, unknown>;

/** Phiếu thu / Phiếu chi on A5 (template "Phiếu thu / chi"). */
export async function printVoucher(id: number) {
  const v = await api<V>(`/cash-vouchers/${id}/print`);
  await printWithTemplate('cashVoucher', 'A5', voucherTemplateData(v));
}
