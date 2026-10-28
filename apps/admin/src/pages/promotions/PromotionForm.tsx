import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput, NumberInput } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { useBranches, useGroups, flattenGroups } from '../products/useLookups';
import { useCustomerGroups } from '../customers/CustomerForm';
import { ProductChips } from './ProductChips';

type Tier = { minTotal: number; value: number; unit: '%' | 'VND'; maxDiscount?: number };
export type PromoDraft = {
  id?: number; code: string; name: string; type: 'invoiceDiscount' | 'productDiscount' | 'buyXGetY' | 'giftItem'; isActive: boolean; combinable: boolean; note: string;
  startAt: string | null; endAt: string | null; daysOfWeek: number[]; hours: [number, number][]; branchIds: number[]; customerGroupIds: number[];
  config: Record<string, unknown>;
};
const TYPES = [
  { value: 'invoiceDiscount', label: 'Hóa đơn - Giảm giá theo tổng tiền' },
  { value: 'productDiscount', label: 'Hàng hóa - Giảm giá hàng' },
  { value: 'buyXGetY', label: 'Hàng hóa - Mua hàng giảm giá/tặng hàng' },
  { value: 'giftItem', label: 'Hóa đơn - Tặng hàng khi đạt tổng tiền' },
] as const;
const DEFAULT_CONFIG: Record<PromoDraft['type'], Record<string, unknown>> = {
  invoiceDiscount: { tiers: [] },
  productDiscount: { productIds: [], groupIds: [], minQty: 1, value: 10, unit: '%' },
  buyXGetY: { buyProductIds: [], buyQty: 2, getProductIds: [], getQty: 1, getDiscountPercent: 100 },
  giftItem: { minTotal: 1_000_000, giftProductId: 0, giftQty: 1 },
};
const empty = (): PromoDraft => ({ code: '', name: '', type: 'invoiceDiscount', isActive: true, combinable: false, note: '', startAt: null, endAt: null, daysOfWeek: [], hours: [], branchIds: [], customerGroupIds: [], config: DEFAULT_CONFIG.invoiceDiscount });
const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const localDate = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10) : '');
const toIso = (d: string, end = false) => (d ? new Date(`${d}T${end ? '23:59:59' : '00:00:00'}+07:00`).toISOString() : null);

function TiersEditor({ tiers, onChange }: { tiers: Tier[]; onChange: (t: Tier[]) => void }) {
  const set = (i: number, p: Partial<Tier>) => onChange(tiers.map((t, j) => (j === i ? { ...t, ...p } : t)));
  return (
    <div className="space-y-2">
      {tiers.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <span>Tổng tiền hàng từ</span><MoneyInput className="w-36" value={t.minTotal} onChange={v => set(i, { minTotal: v })} aria-label={`Tổng tiền hàng từ ${i + 1}`} />
          <span>giảm</span><NumberInput className="w-24" value={t.value} onChange={v => set(i, { value: Math.max(0, Math.round(v)) })} aria-label={`Giảm ${i + 1}`} />
          <select className="input w-20" value={t.unit} onChange={e => set(i, { unit: e.target.value as Tier['unit'] })}><option>%</option><option>VND</option></select>
          {t.unit === '%' && <><span>tối đa</span><MoneyInput className="w-32" value={t.maxDiscount ?? 0} onChange={v => set(i, { maxDiscount: v || undefined })} /></>}
          <button type="button" className="btn-ghost" aria-label="Xóa mức" onClick={() => onChange(tiers.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => onChange([...tiers, { minTotal: 0, value: 0, unit: '%' }])}><Plus size={14} />Thêm mức</button>
    </div>
  );
}

export function PromotionForm({ value, onClose }: { value: Partial<PromoDraft> | null; onClose: () => void }) {
  const qc = useQueryClient();
  const branches = useBranches();
  const productGroups = useGroups();
  const customerGroups = useCustomerGroups();
  const [d, setD] = useState<PromoDraft>(empty());
  useEffect(() => { if (value) setD({ ...empty(), ...value }); }, [value]);
  const set = (p: Partial<PromoDraft>) => setD(cur => ({ ...cur, ...p }));
  const cfg = d.config as Record<string, never>;
  const setCfg = (p: Record<string, unknown>) => set({ config: { ...d.config, ...p } });
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  async function save() {
    try {
      const { id, code, ...body } = d;
      await api(id ? `/promotions/${id}` : '/promotions', { method: id ? 'PUT' : 'POST', body: { ...body, code: code || undefined } });
      await qc.invalidateQueries({ queryKey: ['promotions'] });
      toast('Đã lưu chương trình');
      onClose();
    } catch (e) { toastError(e); }
  }

  return (
    <Modal open={!!value} size="lg" title={d.id ? 'Sửa chương trình khuyến mại' : 'Tạo chương trình khuyến mại'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Bỏ qua</button><button type="button" className="btn-primary" disabled={!d.name} onClick={save}>Lưu</button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Mã chương trình"><input className="input" placeholder="Tự động" disabled={!!d.id} value={d.code} onChange={e => set({ code: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Tên chương trình"><input className="input" value={d.name} onChange={e => set({ name: e.target.value })} /></Field></div>
          <div className="sm:col-span-2">
            <Field label="Hình thức khuyến mại">
              <select className="input" value={d.type} disabled={!!d.id} onChange={e => { const type = e.target.value as PromoDraft['type']; set({ type, config: DEFAULT_CONFIG[type] }); }}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={d.isActive} onChange={e => set({ isActive: e.target.checked })} />Kích hoạt</label>
        </div>

        <section className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 font-semibold">Điều kiện và ưu đãi</div>
          {d.type === 'invoiceDiscount' && <TiersEditor tiers={(cfg.tiers ?? []) as Tier[]} onChange={tiers => setCfg({ tiers })} />}
          {d.type === 'productDiscount' && (
            <div className="space-y-2 text-sm">
              <ProductChips placeholder="Chọn hàng hóa áp dụng" value={(cfg.productIds ?? []) as number[]} onChange={productIds => setCfg({ productIds })} />
              <div><span className="label">Hoặc nhóm hàng</span>
                <div className="flex flex-wrap gap-3">{flattenGroups(productGroups.data ?? []).map(g => <label key={g.id} className="flex items-center gap-1"><input type="checkbox" checked={((cfg.groupIds ?? []) as number[]).includes(g.id)} onChange={() => setCfg({ groupIds: toggle((cfg.groupIds ?? []) as number[], g.id) })} />{g.name}</label>)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span>Mua từ</span><NumberInput className="w-20" value={Number(cfg.minQty ?? 1)} onChange={v => setCfg({ minQty: Math.max(1, Math.round(v)) })} /><span>sản phẩm, giảm mỗi sản phẩm</span>
                <NumberInput className="w-28" value={Number(cfg.value ?? 0)} onChange={v => setCfg({ value: Math.max(0, Math.round(v)) })} />
                <select className="input w-20" value={String(cfg.unit ?? '%')} onChange={e => setCfg({ unit: e.target.value })}><option>%</option><option>VND</option></select>
              </div>
            </div>
          )}
          {d.type === 'buyXGetY' && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2"><span>Mua</span><NumberInput className="w-20" value={Number(cfg.buyQty ?? 1)} onChange={v => setCfg({ buyQty: Math.max(1, Math.round(v)) })} /><span>sản phẩm trong:</span></div>
              <ProductChips placeholder="Hàng mua" value={(cfg.buyProductIds ?? []) as number[]} onChange={buyProductIds => setCfg({ buyProductIds })} />
              <div className="flex flex-wrap items-center gap-2"><span>Được</span><NumberInput className="w-20" value={Number(cfg.getQty ?? 1)} onChange={v => setCfg({ getQty: Math.max(1, Math.round(v)) })} /><span>sản phẩm giảm</span>
                <NumberInput className="w-20" value={Number(cfg.getDiscountPercent ?? 100)} onChange={v => setCfg({ getDiscountPercent: Math.min(100, Math.max(1, Math.round(v))) })} /><span>% (100% = tặng) trong:</span></div>
              <ProductChips placeholder="Hàng được giảm/tặng" value={(cfg.getProductIds ?? []) as number[]} onChange={getProductIds => setCfg({ getProductIds })} />
            </div>
          )}
          {d.type === 'giftItem' && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2"><span>Tổng tiền hàng từ</span><MoneyInput className="w-36" value={Number(cfg.minTotal ?? 0)} onChange={v => setCfg({ minTotal: v })} /><span>tặng</span><NumberInput className="w-20" value={Number(cfg.giftQty ?? 1)} onChange={v => setCfg({ giftQty: Math.max(1, Math.round(v)) })} /></div>
              <ProductChips placeholder="Chọn hàng tặng" value={cfg.giftProductId ? [Number(cfg.giftProductId)] : []} onChange={ids => setCfg({ giftProductId: ids[ids.length - 1] ?? 0 })} />
            </div>
          )}
        </section>

        <section className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
          <div className="font-semibold sm:col-span-2">Thời gian áp dụng</div>
          <Field label="Từ ngày"><input type="date" className="input" value={localDate(d.startAt)} onChange={e => set({ startAt: toIso(e.target.value) })} /></Field>
          <Field label="Đến ngày"><input type="date" className="input" value={localDate(d.endAt)} onChange={e => set({ endAt: toIso(e.target.value, true) })} /></Field>
          <div className="sm:col-span-2"><span className="label">Theo thứ (không chọn: mọi ngày)</span>
            <div className="flex gap-2">{DAYS.map((x, i) => <label key={x} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={d.daysOfWeek.includes(i)} onChange={() => set({ daysOfWeek: toggle(d.daysOfWeek, i) })} />{x}</label>)}</div>
          </div>
          <div className="sm:col-span-2"><span className="label">Khung giờ (không có: cả ngày)</span>
            {d.hours.map((h, i) => (
              <div key={i} className="mb-1 flex items-center gap-2 text-sm">
                <NumberInput className="w-20" value={h[0]} onChange={v => set({ hours: d.hours.map((x, j) => (j === i ? [Math.min(24, Math.max(0, v)), x[1]] : x)) as [number, number][] })} /><span>giờ đến</span>
                <NumberInput className="w-20" value={h[1]} onChange={v => set({ hours: d.hours.map((x, j) => (j === i ? [x[0], Math.min(24, Math.max(0, v))] : x)) as [number, number][] })} /><span>giờ</span>
                <button type="button" className="btn-ghost" aria-label="Xóa khung giờ" onClick={() => set({ hours: d.hours.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => set({ hours: [...d.hours, [8, 22]] })}><Plus size={14} />Thêm khung giờ</button>
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
          <div className="font-semibold sm:col-span-2">Phạm vi áp dụng</div>
          <div><span className="label">Chi nhánh (không chọn: toàn hệ thống)</span>{branches.data?.items.map(b => <label key={b.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.branchIds.includes(b.id)} onChange={() => set({ branchIds: toggle(d.branchIds, b.id) })} />{b.name}</label>)}</div>
          <div><span className="label">Nhóm khách hàng (không chọn: mọi khách)</span>{customerGroups.data?.map(g => <label key={g.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.customerGroupIds.includes(g.id)} onChange={() => set({ customerGroupIds: toggle(d.customerGroupIds, g.id) })} />{g.name}</label>)}</div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={d.combinable} onChange={e => set({ combinable: e.target.checked })} />Cho phép kết hợp với chương trình khác</label>
        </section>
      </div>
    </Modal>
  );
}
