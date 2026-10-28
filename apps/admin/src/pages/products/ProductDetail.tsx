import { useQuery } from '@tanstack/react-query';
import { ImageIcon } from 'lucide-react';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { PRODUCT_TYPE_LABELS } from '../../lib/labels';
import { Tabs } from '../../components/Tabs';
import { StockCard } from './StockCard';

export type ProductDetailData = {
  id: number; code: string; barcode: string | null; name: string; type: string; price: number; cost?: number; unit: string; minStock: number; maxStock: number;
  weight: number; description: string; note: string; orderNoteTemplate: string; isActive: boolean; isDirectSale: boolean; loyaltyEnabled: boolean;
  groupId: number | null; brandId: number | null; locationId: number | null; vatRate: number | null; points: number | null; sellOnline: boolean; allBranches: boolean; branchIds: number[];
  images: string[]; attributes: { name: string; values: string[] }[];
  units: { id: number; name: string; conversion: number; code: string; barcode: string | null; price: number; isDirectSale: boolean }[];
  comboItems: { itemId: number; qty: number; code: string; name: string; price: number; cost?: number }[];
  variants: { id: number; code: string; barcode: string | null; price: number; cost?: number; values: string[]; onHand: number; isActive: boolean }[];
  warranties: { kind: 'warranty' | 'maintenance'; name: string; duration: number; durationUnit: 'day' | 'month' | 'year' }[];
  stocks: { branchId: number; branchName: string; onHand: number; reserved: number; incoming: number; cost?: number }[];
};

export type ProductActions = { onEdit: () => void; onCopy: () => void; onToggleActive: () => void; onDelete: () => void; onPrint: () => void };

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-slate-100 py-1.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm">{value === '' || value === null || value === undefined ? <span className="text-slate-400">Chưa có</span> : value}</div>
    </div>
  );
}

export function ProductDetail({ id, actions, groupName, brandName }: { id: number; actions: ProductActions; groupName: string; brandName?: string }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api<ProductDetailData>(`/products/${id}`) });
  const p = q.data;
  if (!p) return <div className="p-4 text-slate-400">Đang tải...</div>;
  const total = p.stocks.reduce((s, x) => s + x.onHand, 0);
  return (
    <Tabs tabs={[
      {
        key: 'info', label: 'Thông tin', content: () => (
          <div className="space-y-3 p-4">
            <div className="flex gap-4">
              <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                {p.images[0] ? <img src={p.images[0]} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="text-slate-300" size={40} />}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <div className="text-sm text-slate-500">Nhóm hàng: {groupName || '—'}</div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded bg-slate-100 px-2 py-0.5">{PRODUCT_TYPE_LABELS[p.type]}</span>
                  {p.isDirectSale && <span className="rounded bg-slate-100 px-2 py-0.5">Bán trực tiếp</span>}
                  <span className={`rounded px-2 py-0.5 ${p.loyaltyEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{p.loyaltyEnabled ? 'Tích điểm' : 'Không tích điểm'}</span>
                  {!p.isActive && <span className="rounded bg-rose-50 px-2 py-0.5 text-rose-700">Ngừng kinh doanh</span>}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 md:grid-cols-4">
              <Info label="Mã hàng" value={p.code} />
              <Info label="Mã vạch" value={p.barcode} />
              <Info label="Tồn kho" value={formatVnd(total)} />
              <Info label="Định mức tồn" value={`${formatVnd(p.minStock)} - ${formatVnd(p.maxStock)}`} />
              {can('cost.view') && <Info label="Giá vốn" value={formatVnd(p.cost ?? 0)} />}
              <Info label="Giá bán" value={formatVnd(p.price)} />
              <Info label="Thương hiệu" value={brandName} />
              <Info label="Trọng lượng" value={p.weight ? `${formatVnd(p.weight)} g` : ''} />
              <Info label="Đơn vị tính" value={p.unit} />
            </div>
            {p.units.length > 0 && (
              <div className="text-sm"><span className="font-medium">Đơn vị khác: </span>{p.units.map(u => `${u.name} (=${u.conversion} ${p.unit || 'ĐVCB'}, ${formatVnd(u.price)})`).join(', ')}</div>
            )}
            {p.comboItems.length > 0 && (
              <div className="text-sm"><span className="font-medium">Thành phần: </span>{p.comboItems.map(c => `${c.qty} × ${c.name}`).join(', ')}</div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {can('products.edit') && <button type="button" className="btn-primary" onClick={actions.onEdit}>Cập nhật</button>}
              <button type="button" className="btn" onClick={actions.onPrint}>In tem mã</button>
              {can('products.create') && <button type="button" className="btn" onClick={actions.onCopy}>Sao chép</button>}
              {can('products.edit') && <button type="button" className="btn" onClick={actions.onToggleActive}>{p.isActive ? 'Ngừng kinh doanh' : 'Cho phép kinh doanh'}</button>}
              {can('products.delete') && <button type="button" className="btn text-rose-600" onClick={actions.onDelete}>Xóa</button>}
            </div>
          </div>
        ),
      },
      {
        key: 'desc', label: 'Mô tả, ghi chú', content: () => (
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div><div className="label">Mô tả</div><div className="whitespace-pre-wrap text-sm">{p.description || <span className="text-slate-400">Chưa có mô tả</span>}</div></div>
            <div><div className="label">Ghi chú</div><div className="whitespace-pre-wrap text-sm">{p.note || <span className="text-slate-400">Chưa có ghi chú</span>}</div>
              {p.orderNoteTemplate && <><div className="label mt-3">Mẫu ghi chú (hóa đơn, đặt hàng)</div><div className="text-sm">{p.orderNoteTemplate}</div></>}</div>
          </div>
        ),
      },
      { key: 'card', label: 'Thẻ kho', content: () => <StockCard productId={p.id} /> },
      {
        key: 'stock', label: 'Tồn kho', content: () => (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-2 text-left">Chi nhánh</th><th className="px-3 py-2 text-right">Tồn kho</th><th className="px-3 py-2 text-right">Khách đặt</th><th className="px-3 py-2 text-right">Đang về</th>{can('cost.view') && <th className="px-3 py-2 text-right">Giá vốn</th>}</tr></thead>
            <tbody>
              {p.stocks.map(s => (
                <tr key={s.branchId} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{s.branchName}</td><td className="num px-3 py-1.5">{formatVnd(s.onHand)}</td><td className="num px-3 py-1.5">{formatVnd(s.reserved)}</td>
                  <td className="num px-3 py-1.5">{formatVnd(s.incoming)}</td>{can('cost.view') && <td className="num px-3 py-1.5">{formatVnd(s.cost ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        ),
      },
    ]} />
  );
}
