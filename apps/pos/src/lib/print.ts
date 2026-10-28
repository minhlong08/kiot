import { formatDateTime, formatVnd } from '@pd/shared';

export type ReceiptData = {
  code: string; createdAt: string; customerName: string; sellerName?: string; store: { name: string; phone: string; address: string };
  lines: { productName: string; unit: string; qty: number; price: number; discount: number; promoDiscount: number; amount: number; isGift?: boolean }[];
  subtotal: number; promoDiscount: number; invoiceDiscount: number; voucherDiscount: number; pointsValue: number; otherIncome: number; total: number; paid: number; change: number; debt: number;
  payments: { method: string; amount: number }[]; qrDataUrl?: string | null; note?: string; offline?: boolean;
};
const METHOD: Record<string, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ', ewallet: 'Ví điện tử', points: 'Điểm', deposit: 'Tiền cọc', exchange: 'Hàng trả' };
const esc = (t: string) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Receipt HTML for 58 mm / 80 mm thermal paper or A4. */
export function receiptHtml(d: ReceiptData, size: '58' | '80' | 'A4') {
  const width = size === 'A4' ? '190mm' : size === '58' ? '48mm' : '72mm';
  const fs = size === '58' ? '10px' : '12px';
  const row = (l: string, r: string, bold = false) => `<tr${bold ? ' style="font-weight:700"' : ''}><td>${l}</td><td style="text-align:right">${r}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${size === 'A4' ? 'A4' : `${size}mm auto`}; margin: ${size === 'A4' ? '10mm' : '2mm'}; }
    body { font-family: system-ui, sans-serif; font-size: ${fs}; width: ${width}; margin: 0 auto; color: #000; }
    h1 { font-size: 1.3em; text-align: center; margin: 4px 0; } .c { text-align: center; } table { width: 100%; border-collapse: collapse; }
    .lines td { padding: 2px 0; vertical-align: top; } hr { border: 0; border-top: 1px dashed #000; }
  </style></head><body>
    <h1>${esc(d.store.name)}</h1><div class="c">${esc(d.store.address)}${d.store.phone ? ` · ${esc(d.store.phone)}` : ''}</div>
    <div class="c" style="font-weight:700;margin-top:6px">HÓA ĐƠN BÁN HÀNG</div>
    <div class="c">${esc(d.code)} · ${formatDateTime(d.createdAt)}${d.offline ? ' · (chờ đồng bộ)' : ''}</div>
    <div>Khách hàng: ${esc(d.customerName)}</div>${d.sellerName ? `<div>Thu ngân: ${esc(d.sellerName)}</div>` : ''}<hr>
    <table class="lines">${d.lines.map(l => `<tr><td colspan="2">${esc(l.productName)}${l.isGift ? ' (quà tặng)' : ''}</td></tr><tr><td>${l.qty} ${esc(l.unit)} × ${formatVnd(l.price)}${l.discount + l.promoDiscount ? ` - ${formatVnd(l.discount + l.promoDiscount)}` : ''}</td><td style="text-align:right">${formatVnd(l.amount)}</td></tr>`).join('')}</table><hr>
    <table>${row('Tổng tiền hàng', formatVnd(d.subtotal))}${d.promoDiscount + d.invoiceDiscount ? row('Giảm giá', formatVnd(d.invoiceDiscount + (d.promoDiscount - d.lines.reduce((s, l) => s + l.promoDiscount, 0)))) : ''}${d.voucherDiscount ? row('Voucher', formatVnd(d.voucherDiscount)) : ''}${d.otherIncome ? row('Thu khác', formatVnd(d.otherIncome)) : ''}${row('Khách cần trả', formatVnd(d.total), true)}${d.pointsValue ? row('Thanh toán bằng điểm', formatVnd(d.pointsValue)) : ''}
    ${d.payments.filter(p => p.method !== 'points').map(p => row(METHOD[p.method] ?? p.method, formatVnd(p.amount))).join('')}${d.change ? row('Tiền thừa trả khách', formatVnd(d.change)) : ''}${d.debt ? row('Còn nợ', formatVnd(d.debt), true) : ''}</table>
    ${d.qrDataUrl ? `<div class="c"><img src="${d.qrDataUrl}" style="width:45mm"><div>Quét mã để chuyển khoản</div></div>` : ''}
    ${d.note ? `<hr><div>${esc(d.note)}</div>` : ''}<hr><div class="c">Cảm ơn quý khách và hẹn gặp lại!</div>
  </body></html>`;
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
