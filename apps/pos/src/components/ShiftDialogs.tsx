import { useState } from 'react';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../lib/api';
import { printHtml } from '../lib/print';
import { Modal, MoneyField, Row } from './ui';

export type Shift = { id: number; openedAt: string; openingCash: number };
type Report = Shift & { userName: string; invoiceCount: number; salesTotal: number; byMethod: Record<string, number>; returnCount: number; returnsTotal: number; expectedCash: number; countedCash: number | null; difference: number | null; closedAt: string | null; settingsStore: { name: string } };
const METHOD: Record<string, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ', ewallet: 'Ví điện tử', points: 'Điểm', deposit: 'Tiền cọc', exchange: 'Hàng trả' };

export function OpenShiftDialog({ open, onOpened, onSkip }: { open: boolean; onOpened: (s: Shift) => void; onSkip: () => void }) {
  const [cash, setCash] = useState(0);
  const [err, setErr] = useState('');
  return (
    <Modal open={open} title="Mở ca làm việc" onClose={onSkip}
      footer={<><button type="button" className="btn" onClick={onSkip}>Để sau</button><button type="button" className="btn-primary" onClick={() => api<Shift>('/shifts/open', { body: { openingCash: cash } }).then(onOpened, e => setErr((e as Error).message))}>Mở ca</button></>}>
      <Row label="Tiền mặt đầu ca"><MoneyField className="w-40" value={cash} onChange={setCash} aria-label="Tiền đầu ca" /></Row>
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </Modal>
  );
}

function slipHtml(r: Report) {
  const line = (l: string, v: string) => `<tr><td>${l}</td><td style="text-align:right">${v}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui;font-size:12px;width:72mm;margin:0 auto}table{width:100%}h1{font-size:15px;text-align:center}</style></head><body>
  <h1>${r.settingsStore.name}<br>PHIẾU KẾT CA</h1><div>Nhân viên: ${r.userName}</div><div>Mở ca: ${formatDateTime(r.openedAt)}</div><div>Đóng ca: ${r.closedAt ? formatDateTime(r.closedAt) : ''}</div><hr>
  <table>${line('Số hóa đơn', String(r.invoiceCount))}${line('Doanh số', formatVnd(r.salesTotal))}${Object.entries(r.byMethod).map(([m, v]) => line(`· ${METHOD[m] ?? m}`, formatVnd(v))).join('')}
  ${line('Trả hàng', `${r.returnCount} / ${formatVnd(r.returnsTotal)}`)}${line('Tiền đầu ca', formatVnd(r.openingCash))}${line('Tiền mặt dự kiến', formatVnd(r.expectedCash))}${line('Tiền mặt thực đếm', formatVnd(r.countedCash ?? 0))}${line('Chênh lệch', formatVnd(r.difference ?? 0))}</table>
  <hr><div style="display:flex;justify-content:space-between;margin-top:30px"><span>Nhân viên</span><span>Quản lý</span></div></body></html>`;
}

export function CloseShiftDialog({ shift, onClose, onClosed }: { shift: Shift | null; onClose: () => void; onClosed: () => void }) {
  const [counted, setCounted] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  async function load() { if (shift) setReport(await api<Report>(`/shifts/${shift.id}/report`)); }
  async function close() {
    try {
      await api(`/shifts/${shift!.id}/close`, { body: { countedCash: counted } });
      const r = await api<Report>(`/shifts/${shift!.id}/report`);
      printHtml(slipHtml(r));
      onClosed();
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal open={!!shift} title="Kết ca" onClose={onClose} footer={<button type="button" className="btn-primary" onClick={close}>Kết ca & in phiếu</button>}>
      {!report ? <button type="button" className="btn" onClick={load}>Xem số liệu ca</button> : (
        <div>
          <Row label="Số hóa đơn">{report.invoiceCount}</Row><Row label="Doanh số">{formatVnd(report.salesTotal)}</Row>
          {Object.entries(report.byMethod).map(([m, v]) => <Row key={m} label={METHOD[m] ?? m}>{formatVnd(v)}</Row>)}
          <Row label="Tiền mặt dự kiến" strong>{formatVnd(report.expectedCash)}</Row>
        </div>
      )}
      <Row label="Tiền mặt thực đếm"><MoneyField className="w-40" value={counted} onChange={setCounted} aria-label="Tiền thực đếm" /></Row>
      {report && <Row label="Chênh lệch">{formatVnd(counted - report.expectedCash)}</Row>}
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </Modal>
  );
}
