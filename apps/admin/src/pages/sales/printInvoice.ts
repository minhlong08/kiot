import { invoiceTemplateData } from '@pd/shared';
import { api } from '../../lib/api';
import { printWithTemplate } from '../../lib/print';

type PrintData = Parameters<typeof invoiceTemplateData>[0] & Record<string, unknown>;

/** A4 invoice print from the admin screens (template "Hóa đơn bán hàng", A4). */
export async function printInvoice(id: number) {
  const d = await api<PrintData>(`/invoices/${id}/print`);
  await printWithTemplate('invoice', 'A4', invoiceTemplateData(d));
}
