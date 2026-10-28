import { formatDateTime, formatVnd, amountInWords } from '@pd/shared';
import { api } from '../../lib/api';

type P = {
  series: string; number: string | null; status: string; lookupCode: string; issuedAt: string | null; invoiceCode: string; buyerName: string; buyerTaxCode: string; buyerAddress: string;
  total: number; vatAmount: number; totalBeforeVat: number; rates: { rate: number; gross: number; net: number; vat: number }[];
  store: { name: string; address: string; phone: string; taxCode?: string }; lines: { productCode: string; productName: string; unit: string; qty: number; amount: number }[];
};

/** Printable copy of an e-invoice (prices include VAT; tax shown per rate). */
export async function printEInvoice(id: number) {
  const e = await api<P>(`/e-invoices/${id}/print`);
  const esc = (t: string) => String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const rows = e.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.productName)}</td><td>${esc(l.unit)}</td><td class="n">${l.qty}</td><td class="n">${formatVnd(l.amount)}</td></tr>`).join('');
  const rates = e.rates.map(r => `<tr><td>Thuế suất ${r.rate}%</td><td class="n">${formatVnd(r.net)}</td><td class="n">${formatVnd(r.vat)}</td><td class="n">${formatVnd(r.gross)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:12mm}body{font-family:system-ui;font-size:12px}h1{text-align:center;margin:4px 0;font-size:18px}table{width:100%;border-collapse:collapse;margin:8px 0}td,th{border:1px solid #999;padding:4px}.n{text-align:right}.muted{color:#666}.draft{color:#b45309;text-align:center;font-weight:bold}</style></head><body>
  <div><b>${esc(e.store.name)}</b><br>${esc(e.store.address)}${e.store.taxCode ? `<br>MST: ${esc(e.store.taxCode)}` : ''}</div>
  <h1>HÓA ĐƠN GIÁ TRỊ GIA TĂNG</h1>
  <div style="text-align:center">Ký hiệu: ${esc(e.series)} · Số: ${esc(e.number ?? '(chưa phát hành)')}${e.issuedAt ? ` · Ngày ${formatDateTime(e.issuedAt)}` : ''}</div>
  ${e.status !== 'issued' ? `<p class="draft">${e.status === 'cancelled' ? 'HÓA ĐƠN ĐÃ HỦY' : 'BẢN NHÁP - CHƯA CÓ GIÁ TRỊ'}</p>` : ''}
  <p>Người mua: <b>${esc(e.buyerName)}</b><br>Mã số thuế: ${esc(e.buyerTaxCode)}<br>Địa chỉ: ${esc(e.buyerAddress)}<br><span class="muted">Theo hóa đơn bán hàng ${esc(e.invoiceCode)}</span></p>
  <table><thead><tr><th>STT</th><th>Tên hàng hóa, dịch vụ</th><th>ĐVT</th><th>SL</th><th>Thành tiền (gồm thuế)</th></tr></thead><tbody>${rows}</tbody></table>
  <table><thead><tr><th>Tổng hợp</th><th>Chưa thuế</th><th>Thuế GTGT</th><th>Cộng</th></tr></thead><tbody>${rates}<tr><td><b>Tổng cộng</b></td><td class="n"><b>${formatVnd(e.totalBeforeVat)}</b></td><td class="n"><b>${formatVnd(e.vatAmount)}</b></td><td class="n"><b>${formatVnd(e.total)}</b></td></tr></tbody></table>
  <p>Số tiền bằng chữ: <i>${esc(amountInWords(e.total))}</i></p>
  ${e.lookupCode ? `<p class="muted">Mã tra cứu: ${esc(e.lookupCode)}</p>` : ''}</body></html>`;
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  frame.contentDocument!.open(); frame.contentDocument!.write(html); frame.contentDocument!.close();
  setTimeout(() => { frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1500); }, 250);
}
