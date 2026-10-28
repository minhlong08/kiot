/** Default print layouts (editable in Thiết lập › Mẫu in). Bodies use the template language in template.ts. */
export const TEMPLATE_SIZES = { invoice: ['58', '80', 'A4'], cashVoucher: ['A5'] } as const;
export type TemplateKind = keyof typeof TEMPLATE_SIZES;
export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = { invoice: 'Hóa đơn bán hàng', cashVoucher: 'Phiếu thu / chi' };

const PAYMENT_LABELS: Record<string, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ', ewallet: 'Ví điện tử', points: 'Điểm', deposit: 'Tiền cọc', exchange: 'Hàng trả' };

const thermal = (width: string, font: string, page: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${page}; margin: 2mm; } body { font-family: system-ui, sans-serif; font-size: ${font}; width: ${width}; margin: 0 auto; color: #000; }
h1 { font-size: 1.3em; text-align: center; margin: 4px 0; } .c { text-align: center; } .r { text-align: right; } table { width: 100%; border-collapse: collapse; }
td { padding: 2px 0; vertical-align: top; } hr { border: 0; border-top: 1px dashed #000; } .b { font-weight: 700; }
</style></head><body>
{{#store.logoUrl}}<div class="c"><img src="{{{store.logoUrl}}}" style="max-height:14mm"></div>{{/store.logoUrl}}
<h1>{{store.name}}</h1><div class="c">{{store.address}}{{#store.phone}} · {{store.phone}}{{/store.phone}}</div>
<div class="c b" style="margin-top:6px">HÓA ĐƠN BÁN HÀNG</div>
<div class="c">{{code}} · {{date createdAt}}{{#offline}} · (chờ đồng bộ){{/offline}}</div>
<div>Khách hàng: {{customerName}}</div>{{#sellerName}}<div>Thu ngân: {{sellerName}}</div>{{/sellerName}}<hr>
<table>{{#lines}}<tr><td colspan="2">{{productName}}{{#isGift}} (quà tặng){{/isGift}}</td></tr><tr><td>{{qty}} {{unit}} × {{money price}}{{#lineDiscount}} - {{money lineDiscount}}{{/lineDiscount}}</td><td class="r">{{money amount}}</td></tr>{{/lines}}</table><hr>
<table><tr><td>Tổng tiền hàng</td><td class="r">{{money subtotal}}</td></tr>
{{#discount}}<tr><td>Giảm giá</td><td class="r">{{money discount}}</td></tr>{{/discount}}
{{#voucherDiscount}}<tr><td>Voucher</td><td class="r">{{money voucherDiscount}}</td></tr>{{/voucherDiscount}}
{{#otherIncome}}<tr><td>Thu khác</td><td class="r">{{money otherIncome}}</td></tr>{{/otherIncome}}
<tr class="b"><td>Khách cần trả</td><td class="r">{{money total}}</td></tr>
{{#pointsValue}}<tr><td>Thanh toán bằng điểm</td><td class="r">{{money pointsValue}}</td></tr>{{/pointsValue}}
{{#cashPayments}}<tr><td>{{label}}</td><td class="r">{{money amount}}</td></tr>{{/cashPayments}}
{{#change}}<tr><td>Tiền thừa trả khách</td><td class="r">{{money change}}</td></tr>{{/change}}
{{#debt}}<tr class="b"><td>Còn nợ</td><td class="r">{{money debt}}</td></tr>{{/debt}}</table>
{{#qrDataUrl}}<div class="c"><img src="{{{qrDataUrl}}}" style="width:45mm"><div>Quét mã để chuyển khoản</div></div>{{/qrDataUrl}}
{{#note}}<hr><div>{{note}}</div>{{/note}}<hr><div class="c">Cảm ơn quý khách và hẹn gặp lại!</div>
</body></html>`;

const A4_INVOICE = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 15mm; } body { font-family: system-ui, sans-serif; font-size: 13px; } table { width: 100%; border-collapse: collapse; }
td, th { border-bottom: 1px solid #ddd; padding: 4px; } th { text-align: left; } .r { text-align: right; }
</style></head><body>
<h2>{{store.name}}</h2><div>{{store.address}} {{store.phone}}{{#store.taxCode}} · MST {{store.taxCode}}{{/store.taxCode}}</div>
<h1 style="text-align:center">HÓA ĐƠN BÁN HÀNG</h1>
<div>Số: <b>{{code}}</b> · {{date createdAt}}</div><div>Khách hàng: {{customerName}}</div><br>
<table><tr><th>STT</th><th>Hàng hóa</th><th>ĐVT</th><th class="r">SL</th><th class="r">Đơn giá</th><th class="r">Thành tiền</th></tr>
{{#lines}}<tr><td>{{@index}}</td><td>{{productName}}</td><td>{{unit}}</td><td class="r">{{qty}}</td><td class="r">{{money price}}</td><td class="r">{{money amount}}</td></tr>{{/lines}}</table>
<table style="width:50%;margin-left:auto"><tr><td>Tổng tiền hàng</td><td class="r">{{money subtotal}}</td></tr>
<tr><td>Giảm giá</td><td class="r">{{money allDiscounts}}</td></tr><tr><td><b>Khách cần trả</b></td><td class="r"><b>{{money total}}</b></td></tr>
<tr><td>Khách đã trả</td><td class="r">{{money paid}}</td></tr>{{#debt}}<tr><td>Còn nợ</td><td class="r">{{money debt}}</td></tr>{{/debt}}</table>
<p><i>Bằng chữ: {{words total}}</i></p>
</body></html>`;

const VOUCHER_A5 = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A5 landscape; margin: 10mm; } body { font-family: system-ui; font-size: 13px; } h1 { text-align: center; margin: 6px 0; }
.r { display: flex; gap: 6px; margin: 6px 0; } .r b { min-width: 150px; } .sig { display: flex; justify-content: space-around; margin-top: 24px; text-align: center; }
</style></head><body>
<div><b>{{store.name}}</b><br>{{store.address}}</div><h1>{{title}}</h1><div style="text-align:center">Số: {{code}} · {{date createdAt}}</div>
<div class="r"><b>{{partyLabel}}:</b>{{counterpartyName}}</div>
<div class="r"><b>Lý do:</b>{{categoryName}}{{#note}} - {{note}}{{/note}}{{#sourceRef}} ({{sourceRef}}){{/sourceRef}}</div>
<div class="r"><b>Số tiền:</b>{{money amount}} đ</div><div class="r"><b>Bằng chữ:</b><i>{{amountInWords}}</i></div><div class="r"><b>Quỹ:</b>{{fundName}}</div>
<div class="sig"><div>Người lập phiếu<br><br><br>{{createdByName}}</div><div>{{partyLabel}}<br><br><br>{{counterpartyName}}</div><div>Thủ quỹ</div></div>
</body></html>`;

export const DEFAULT_TEMPLATES: Record<TemplateKind, Record<string, string>> = {
  invoice: { '58': thermal('48mm', '10px', '58mm auto'), '80': thermal('72mm', '12px', '80mm auto'), A4: A4_INVOICE },
  cashVoucher: { A5: VOUCHER_A5 },
};

type InvoiceLine = { productName: string; unit: string; qty: number; price: number; discount?: number; promoDiscount?: number; amount: number; isGift?: boolean };
/** Derived fields the invoice templates use (line discount, payment labels, discounts total). */
export function invoiceTemplateData<T extends { lines: InvoiceLine[]; subtotal: number; total: number; promoDiscount?: number; invoiceDiscount?: number; otherIncome?: number; payments?: { method: string; amount: number }[] }>(d: T) {
  const linePromo = d.lines.reduce((s, l) => s + (l.promoDiscount ?? 0), 0);
  return {
    ...d,
    lines: d.lines.map(l => ({ ...l, lineDiscount: (l.discount ?? 0) + (l.promoDiscount ?? 0) })),
    discount: (d.invoiceDiscount ?? 0) + (d.promoDiscount ?? 0) - linePromo,
    allDiscounts: d.subtotal + (d.otherIncome ?? 0) - d.total,
    cashPayments: (d.payments ?? []).filter(p => p.method !== 'points').map(p => ({ ...p, label: PAYMENT_LABELS[p.method] ?? p.method })),
  };
}
/** Derived fields for Phiếu thu / Phiếu chi. */
export function voucherTemplateData<T extends { kind: 'in' | 'out'; code: string; sourceCode: string | null }>(v: T) {
  return { ...v, title: v.kind === 'in' ? 'PHIẾU THU' : 'PHIẾU CHI', partyLabel: v.kind === 'in' ? 'Người nộp tiền' : 'Người nhận tiền', sourceRef: v.sourceCode && v.sourceCode !== v.code ? v.sourceCode : '' };
}

/** Sample data for previews in the template editor. */
export function templateSample(kind: TemplateKind, store: { name: string; address: string; phone: string; logoUrl?: string; taxCode?: string }) {
  const now = new Date().toISOString();
  if (kind === 'invoice') return invoiceTemplateData({
    code: 'HD000123', createdAt: now, customerName: 'Nguyễn Thị Mai Anh', sellerName: 'Thu ngân', store, subtotal: 1_550_000, promoDiscount: 0, invoiceDiscount: 50_000, voucherDiscount: 0, pointsValue: 0, otherIncome: 0,
    total: 1_500_000, paid: 1_500_000, change: 0, debt: 0, note: '', qrDataUrl: null,
    lines: [{ productName: 'Áo sơ mi trắng dài tay', unit: 'cái', qty: 2, price: 450_000, discount: 0, promoDiscount: 0, amount: 900_000 }, { productName: 'Cà vạt lụa xanh than', unit: 'cái', qty: 1, price: 650_000, discount: 0, promoDiscount: 0, amount: 650_000 }],
    payments: [{ method: 'cash', amount: 1_000_000 }, { method: 'transfer', amount: 500_000 }],
  });
  return { ...voucherTemplateData({ kind: 'out' as const, code: 'PC000045', sourceCode: null }), createdAt: now, store, amount: 1_200_000, amountInWords: 'Một triệu hai trăm nghìn đồng', counterpartyName: 'Điện lực Hoàn Kiếm', categoryName: 'Chi phí điện nước', note: 'Tiền điện tháng 10', fundName: 'Tiền mặt', createdByName: 'Quản trị viên' };
}

/** Placeholders offered by the editor, per kind. */
export const TEMPLATE_PLACEHOLDERS: Record<TemplateKind, [string, string][]> = {
  invoice: [['{{store.name}}', 'Tên cửa hàng'], ['{{store.address}}', 'Địa chỉ'], ['{{store.phone}}', 'Điện thoại'], ['{{code}}', 'Mã hóa đơn'], ['{{date createdAt}}', 'Thời gian'], ['{{customerName}}', 'Khách hàng'], ['{{sellerName}}', 'Thu ngân'],
    ['{{#lines}}…{{/lines}}', 'Lặp dòng hàng'], ['{{productName}}', 'Tên hàng (trong dòng)'], ['{{qty}}', 'Số lượng'], ['{{money price}}', 'Đơn giá'], ['{{money amount}}', 'Thành tiền'],
    ['{{money subtotal}}', 'Tổng tiền hàng'], ['{{money discount}}', 'Giảm giá'], ['{{money total}}', 'Khách cần trả'], ['{{money paid}}', 'Khách đã trả'], ['{{money change}}', 'Tiền thừa'], ['{{money debt}}', 'Còn nợ'], ['{{words total}}', 'Số tiền bằng chữ'], ['{{note}}', 'Ghi chú']],
  cashVoucher: [['{{store.name}}', 'Tên cửa hàng'], ['{{title}}', 'PHIẾU THU / PHIẾU CHI'], ['{{code}}', 'Mã phiếu'], ['{{date createdAt}}', 'Thời gian'], ['{{partyLabel}}', 'Người nộp/nhận (nhãn)'], ['{{counterpartyName}}', 'Tên người nộp/nhận'],
    ['{{categoryName}}', 'Loại thu chi'], ['{{money amount}}', 'Số tiền'], ['{{amountInWords}}', 'Bằng chữ'], ['{{fundName}}', 'Quỹ'], ['{{note}}', 'Ghi chú'], ['{{createdByName}}', 'Người lập']],
};
