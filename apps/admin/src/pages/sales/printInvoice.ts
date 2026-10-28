import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';

type PrintData = { code: string; createdAt: string; customerName: string; store: { name: string; address: string; phone: string; taxCode: string }; lines: { productName: string; unit: string; qty: number; price: number; amount: number }[]; subtotal: number; total: number; paid: number; debt: number; change: number; invoiceDiscount: number; promoDiscount: number; voucherDiscount: number };

/** A4 invoice print from the admin screens. */
export async function printInvoice(id: number) {
  const d = await api<PrintData>(`/invoices/${id}/print`);
  const esc = (t: string) => String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui;font-size:13px;margin:15mm}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:4px}th{text-align:left}.r{text-align:right}</style></head><body>
  <h2>${esc(d.store.name)}</h2><div>${esc(d.store.address)} ${esc(d.store.phone)}</div><h1 style="text-align:center">HÓA ĐƠN BÁN HÀNG</h1>
  <div>Số: <b>${esc(d.code)}</b> · ${formatDateTime(d.createdAt)}</div><div>Khách hàng: ${esc(d.customerName)}</div><br>
  <table><tr><th>Hàng hóa</th><th>ĐVT</th><th class="r">SL</th><th class="r">Đơn giá</th><th class="r">Thành tiền</th></tr>
  ${d.lines.map(l => `<tr><td>${esc(l.productName)}</td><td>${esc(l.unit)}</td><td class="r">${l.qty}</td><td class="r">${formatVnd(l.price)}</td><td class="r">${formatVnd(l.amount)}</td></tr>`).join('')}</table>
  <table style="width:50%;margin-left:auto"><tr><td>Tổng tiền hàng</td><td class="r">${formatVnd(d.subtotal)}</td></tr><tr><td>Giảm giá</td><td class="r">${formatVnd(d.subtotal - d.total)}</td></tr><tr><td><b>Khách cần trả</b></td><td class="r"><b>${formatVnd(d.total)}</b></td></tr><tr><td>Khách đã trả</td><td class="r">${formatVnd(d.paid)}</td></tr>${d.debt ? `<tr><td>Còn nợ</td><td class="r">${formatVnd(d.debt)}</td></tr>` : ''}</table>
  </body></html>`;
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  frame.contentDocument!.open(); frame.contentDocument!.write(html); frame.contentDocument!.close();
  setTimeout(() => { frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1500); }, 250);
}
