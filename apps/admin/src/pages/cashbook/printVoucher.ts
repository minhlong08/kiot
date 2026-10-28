import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';

type V = { code: string; kind: 'in' | 'out'; createdAt: string; amount: number; amountInWords: string; counterpartyName: string; categoryName: string; note: string; fundName: string; sourceCode: string | null; createdByName: string; store: { name: string; address: string } };

/** Phiếu thu / Phiếu chi on A5. */
export async function printVoucher(id: number) {
  const v = await api<V>(`/cash-vouchers/${id}/print`);
  const esc = (t: string) => String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const title = v.kind === 'in' ? 'PHIẾU THU' : 'PHIẾU CHI';
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A5 landscape;margin:10mm}body{font-family:system-ui;font-size:13px}h1{text-align:center;margin:6px 0}.r{display:flex;gap:6px;margin:6px 0}.r b{min-width:150px}.sig{display:flex;justify-content:space-around;margin-top:24px;text-align:center}</style></head><body>
  <div><b>${esc(v.store.name)}</b><br>${esc(v.store.address)}</div><h1>${title}</h1><div style="text-align:center">Số: ${esc(v.code)} · ${formatDateTime(v.createdAt)}</div>
  <div class="r"><b>${v.kind === 'in' ? 'Người nộp tiền' : 'Người nhận tiền'}:</b>${esc(v.counterpartyName)}</div>
  <div class="r"><b>Lý do:</b>${esc(v.categoryName)}${v.note ? ` - ${esc(v.note)}` : ''}${v.sourceCode && v.sourceCode !== v.code ? ` (${esc(v.sourceCode)})` : ''}</div>
  <div class="r"><b>Số tiền:</b>${formatVnd(v.amount)} đ</div><div class="r"><b>Bằng chữ:</b><i>${esc(v.amountInWords)}</i></div><div class="r"><b>Quỹ:</b>${esc(v.fundName)}</div>
  <div class="sig"><div>Người lập phiếu<br><br><br>${esc(v.createdByName)}</div><div>${v.kind === 'in' ? 'Người nộp tiền' : 'Người nhận tiền'}<br><br><br>${esc(v.counterpartyName)}</div><div>Thủ quỹ</div></div></body></html>`;
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  frame.contentDocument!.open(); frame.contentDocument!.write(html); frame.contentDocument!.close();
  setTimeout(() => { frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1500); }, 250);
}
