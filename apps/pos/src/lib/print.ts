import { DEFAULT_TEMPLATES, invoiceTemplateData, renderTemplate } from '@pd/shared';

export type ReceiptData = {
  code: string; createdAt: string; customerName: string; sellerName?: string; store: { name: string; phone: string; address: string };
  lines: { productName: string; unit: string; qty: number; price: number; discount: number; promoDiscount: number; amount: number; isGift?: boolean }[];
  subtotal: number; promoDiscount: number; invoiceDiscount: number; voucherDiscount: number; pointsValue: number; otherIncome: number; total: number; paid: number; change: number; debt: number;
  payments: { method: string; amount: number }[]; qrDataUrl?: string | null; note?: string; offline?: boolean;
};
/** Receipt HTML for 58 mm / 80 mm thermal paper or A4, from the store's template (built-in default when none is saved). */
export function receiptHtml(d: ReceiptData, size: '58' | '80' | 'A4', body?: string) {
  return renderTemplate(body ?? DEFAULT_TEMPLATES.invoice[size], invoiceTemplateData(d));
}

export function printHtml(html: string) {
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  frame.contentDocument!.open();
  frame.contentDocument!.write(html);
  frame.contentDocument!.close();
  setTimeout(() => { frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1500); }, 250);
}
