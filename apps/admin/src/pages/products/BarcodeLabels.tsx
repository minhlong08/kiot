import { useEffect, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { NumberInput } from '../../components/Field';
import { toastError } from '../../components/toast';

type Item = { id: number; code: string; barcode: string | null; name: string; price: number; qty: number };
const SIZES = {
  '50x30': { label: 'Tem 50 × 30 mm (máy in nhiệt)', w: 50, h: 30, perRow: 1 },
  '40x25': { label: 'Tem 40 × 25 mm (máy in nhiệt)', w: 40, h: 25, perRow: 1 },
  a4: { label: 'Giấy A4 (3 × 10 tem)', w: 70, h: 29.7, perRow: 3 },
} as const;
type Size = keyof typeof SIZES;

function svgFor(value: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, value, { format: 'CODE128', displayValue: true, fontSize: 12, height: 36, margin: 0, width: 1.4 });
  } catch { return ''; }
  return svg.outerHTML;
}

/** Builds a print document in a hidden iframe so the admin page is untouched. */
function printLabels(items: Item[], size: Size, storeName: string) {
  const s = SIZES[size];
  const labels = items.flatMap(i => Array.from({ length: i.qty }, () => i));
  const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${size === 'a4' ? 'A4' : `${s.w}mm ${s.h}mm`}; margin: ${size === 'a4' ? '0' : '0'}; }
    body { margin: 0; font-family: system-ui, sans-serif; }
    .sheet { display: grid; grid-template-columns: repeat(${s.perRow}, ${s.w}mm); }
    .label { width: ${s.w}mm; height: ${s.h}mm; box-sizing: border-box; padding: 1.5mm; overflow: hidden; text-align: center; page-break-inside: avoid; }
    .store { font-size: 7pt; color: #444; } .name { font-size: 8pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .price { font-size: 9pt; font-weight: 700; } svg { max-width: 100%; height: ${Math.max(8, s.h - 14)}mm; }
  </style></head><body><div class="sheet">${labels.map(l => `<div class="label"><div class="store">${esc(storeName)}</div><div class="name">${esc(l.name)}</div>${svgFor(l.barcode || l.code)}<div class="price">${formatVnd(l.price)} đ</div></div>`).join('')}</div></body></html>`;
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  document.body.appendChild(frame);
  frame.contentDocument!.open();
  frame.contentDocument!.write(html);
  frame.contentDocument!.close();
  setTimeout(() => { frame.contentWindow!.print(); setTimeout(() => frame.remove(), 1000); }, 200);
}

export function BarcodeLabels({ ids, onClose, storeName }: { ids: number[] | null; onClose: () => void; storeName: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [size, setSize] = useState<Size>('50x30');
  useEffect(() => {
    if (!ids?.length) return;
    Promise.all(ids.map(id => api<{ id: number; code: string; barcode: string | null; name: string; price: number; stocks: { onHand: number }[] }>(`/products/${id}`)))
      .then(ps => setItems(ps.map(p => ({ id: p.id, code: p.code, barcode: p.barcode, name: p.name, price: p.price, qty: Math.max(1, p.stocks.reduce((s, x) => s + x.onHand, 0)) }))), toastError);
  }, [ids]);
  return (
    <Modal open={!!ids?.length} title="In tem mã" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Bỏ qua</button><button type="button" className="btn-primary" disabled={!items.length} onClick={() => printLabels(items, size, storeName)}>In tem</button></>}>
      <div className="space-y-3">
        <select className="input max-w-sm" value={size} onChange={e => setSize(e.target.value as Size)} aria-label="Khổ giấy">
          {Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500"><tr><th className="py-1 text-left">Mã hàng</th><th className="text-left">Tên hàng</th><th className="text-right">Giá bán</th><th className="text-right">Số tem</th></tr></thead>
          <tbody>
            {items.map(i => (
              <tr key={i.id} className="border-t border-slate-100">
                <td className="py-1">{i.barcode || i.code}</td><td>{i.name}</td><td className="num">{formatVnd(i.price)}</td>
                <td className="w-24"><NumberInput value={i.qty} onChange={v => setItems(items.map(x => (x.id === i.id ? { ...x, qty: Math.max(0, Math.round(v)) } : x)))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
