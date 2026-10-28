import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { productInputSchema, type ProductType } from '@pd/shared';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSettings } from '../../lib/settings';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput, NumberInput } from '../../components/Field';
import { Tabs } from '../../components/Tabs';
import { toast } from '../../components/toast';
import { emptyDraft, toPayload, type ProductDraft } from './formTypes';
import { ImagesEditor } from './ImagesEditor';
import { UnitsEditor } from './UnitsEditor';
import { VariantsEditor } from './VariantsEditor';
import { ComboEditor } from './ComboEditor';
import { WarrantyEditor } from './WarrantyEditor';
import { QuickCreate, type QuickKind } from './QuickCreate';
import { flattenGroups, useBranches, useBrands, useGroups, useLocations } from './useLookups';
import type { ProductDetailData } from './ProductDetail';

const TITLES: Record<ProductType, [string, string]> = { goods: ['Tạo hàng hóa', 'Cập nhật hàng hóa'], service: ['Tạo dịch vụ', 'Cập nhật dịch vụ'], combo: ['Tạo combo - đóng gói', 'Cập nhật combo - đóng gói'] };

/** Detail (from GET /products/:id or /copy) → editable draft. */
export function draftFromDetail(d: Partial<ProductDetailData> & { type: ProductType }): ProductDraft {
  const base = emptyDraft(d.type);
  return {
    ...base, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined)) as Partial<ProductDraft>,
    code: d.code ?? '', barcode: d.barcode ?? '', vatRate: d.vatRate ?? null, points: d.points ?? null, groupId: d.groupId ?? null, brandId: d.brandId ?? null, locationId: d.locationId ?? null,
    cost: d.cost ?? 0, onHand: 0, weightUnit: 'g',
    units: (d.units ?? []).map(u => ({ ...u, code: u.code ?? '', barcode: u.barcode ?? '' })),
    attributes: (d.attributes ?? []).map(a => ({ name: a.name, valuesText: a.values.join(', ') })),
    variants: (d.variants ?? []).filter(v => v.isActive !== false).map(v => ({ id: v.id, values: v.values, code: v.code ?? '', barcode: v.barcode ?? '', price: v.price, cost: v.cost ?? 0, onHand: v.onHand ?? 0 })),
    comboItems: (d.comboItems ?? []).map(c => ({ ...c, cost: c.cost ?? 0 })),
    warranties: d.warranties ?? [], images: d.images ?? [], branchIds: d.branchIds ?? [],
  };
}

function Section({ title, hint, children, defaultOpen = true }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border border-slate-200">
      <button type="button" className="flex w-full items-center justify-between px-4 py-2.5 text-left" onClick={() => setOpen(o => !o)}>
        <span><span className="font-semibold">{title}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
        <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
      </button>
      {open && <div className="border-t border-slate-100 px-4 py-3">{children}</div>}
    </section>
  );
}

type Props = { open: boolean; type: ProductType; productId?: number; initial?: ProductDraft; onClose: () => void; onSaved: (p: { id: number; code: string }) => void };

export function ProductForm({ open, type, productId, initial, onClose, onSaved }: Props) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const settings = useSettings();
  const groups = useGroups();
  const brands = useBrands();
  const locations = useLocations();
  const branches = useBranches();
  const [d, setD] = useState<ProductDraft>(() => initial ?? emptyDraft(type));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [quick, setQuick] = useState<QuickKind | null>(null);
  const isEdit = !!productId;
  const showCost = can('cost.view');

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (productId) api<ProductDetailData>(`/products/${productId}`).then(p => setD(draftFromDetail(p)));
    else setD(initial ?? emptyDraft(type));
  }, [open, productId, initial, type]);

  const set = (patch: Partial<ProductDraft>) => setD(cur => ({ ...cur, ...patch }));
  const err = (k: string) => errors[k] && <span className="mt-0.5 block text-xs text-rose-600">{errors[k]}</span>;

  async function save(after: 'close' | 'new' | 'copy') {
    const payload = toPayload(d, isEdit);
    const parsed = productInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0]), i.message])));
      return;
    }
    setSaving(true);
    try {
      const p = await api<{ id: number; code: string }>(isEdit ? `/products/${productId}` : '/products', { method: isEdit ? 'PUT' : 'POST', body: payload });
      await qc.invalidateQueries({ queryKey: ['products'] });
      await qc.invalidateQueries({ queryKey: ['product'] });
      toast(`Đã lưu ${p.code}`);
      onSaved(p);
      if (after === 'new') setD(emptyDraft(d.type));
      else if (after === 'copy') setD({ ...d, code: '', barcode: '', variants: d.variants.map(v => ({ ...v, id: undefined, code: '', barcode: '' })) });
      else onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VALIDATION') {
        const issues = (e as ApiError & { details?: { path: (string | number)[]; message: string }[] }).details ?? [];
        setErrors(Object.fromEntries(issues.map(i => [String(i.path[0]), i.message])));
      }
      setErrors(cur => ({ ...cur, _form: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  }

  const groupOptions = flattenGroups(groups.data ?? []);
  const infoTab = (
    <div className="space-y-4 py-3">
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mã hàng"><input className="input" placeholder="Tự động" value={d.code} onChange={e => set({ code: e.target.value })} />{err('code')}</Field>
          <Field label="Mã vạch"><input className="input" placeholder="Nhập mã vạch" value={d.barcode} onChange={e => set({ barcode: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Tên hàng"><input className="input" placeholder="Bắt buộc" value={d.name} onChange={e => set({ name: e.target.value })} />{err('name')}</Field></div>
          <div>
            <div className="flex items-end justify-between"><label className="label" htmlFor="pf-group">Nhóm hàng</label><button type="button" className="mb-1 text-xs text-brand-700 hover:underline" onClick={() => setQuick('group')}>Tạo mới</button></div>
            <select id="pf-group" className="input" value={d.groupId ?? ''} onChange={e => set({ groupId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{d.type === 'service' ? 'Chọn nhóm hàng' : 'Chọn nhóm hàng (Bắt buộc)'}</option>
              {groupOptions.map(g => <option key={g.id} value={g.id}>{' '.repeat(g.depth * 3)}{g.name}</option>)}
            </select>
            {err('groupId')}
          </div>
          <div>
            <div className="flex items-end justify-between"><label className="label" htmlFor="pf-brand">Thương hiệu</label><button type="button" className="mb-1 text-xs text-brand-700 hover:underline" onClick={() => setQuick('brand')}>Tạo mới</button></div>
            <select id="pf-brand" className="input" value={d.brandId ?? ''} onChange={e => set({ brandId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Chọn thương hiệu</option>
              {brands.data?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <ImagesEditor value={d.images} onChange={images => set({ images })} />
      </div>

      {d.type === 'combo' && (
        <Section title="Hàng thành phần"><ComboEditor items={d.comboItems} showCost={showCost} onChange={comboItems => set({ comboItems })} />{err('comboItems')}</Section>
      )}

      <Section title="Giá vốn, giá bán">
        <div className="grid gap-3 sm:grid-cols-3">
          {showCost && d.type !== 'combo' && <Field label="Giá vốn"><MoneyInput value={d.cost} onChange={cost => set({ cost })} disabled={isEdit && d.type === 'goods'} /></Field>}
          <Field label="Giá bán"><MoneyInput value={d.price} onChange={price => set({ price })} /></Field>
          <Field label="Thuế VAT (%)" hint="Để trống: dùng mức mặc định"><input className="input" inputMode="numeric" value={d.vatRate ?? ''} onChange={e => set({ vatRate: e.target.value === '' ? null : Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
        </div>
      </Section>

      {d.type === 'goods' && (
        <Section title="Tồn kho" hint="Quản lý số lượng tồn kho và định mức tồn. Khi tồn kho chạm đến định mức, bạn sẽ nhận được cảnh báo.">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tồn kho" hint={isEdit ? 'Thay đổi tồn kho qua Nhập hàng hoặc Kiểm kho' : undefined}><NumberInput value={d.onHand} disabled={isEdit || d.variants.length > 0} onChange={v => set({ onHand: Math.max(0, Math.round(v)) })} /></Field>
            <Field label="Định mức tồn thấp nhất"><NumberInput value={d.minStock} onChange={v => set({ minStock: Math.max(0, Math.round(v)) })} /></Field>
            <Field label="Định mức tồn cao nhất"><NumberInput value={d.maxStock} onChange={v => set({ maxStock: Math.max(0, Math.round(v)) })} />{err('maxStock')}</Field>
          </div>
        </Section>
      )}

      <Section title="Tích điểm" defaultOpen={false}>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.loyaltyEnabled} onChange={e => set({ loyaltyEnabled: e.target.checked })} />Tích điểm khi bán</label>
          <label className="flex items-center gap-2 text-sm">Điểm cố định / đơn vị
            <input className="input w-24" inputMode="numeric" placeholder="Theo tỷ lệ" value={d.points ?? ''} disabled={!d.loyaltyEnabled} onChange={e => set({ points: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
          </label>
          <span className="text-xs text-slate-500">Tỷ lệ quy đổi {settings.data?.customers?.vndPerPoint?.toLocaleString('en-US') ?? '10,000'} VND = 1 điểm</span>
        </div>
      </Section>

      {d.type !== 'service' && (
        <Section title="Vị trí, trọng lượng" hint="Quản lý việc sắp xếp kho, vị trí bán hàng hoặc trọng lượng hàng hóa" defaultOpen={false}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="flex items-end justify-between"><label className="label" htmlFor="pf-loc">Vị trí</label><button type="button" className="mb-1 text-xs text-brand-700 hover:underline" onClick={() => setQuick('location')}>Tạo mới</button></div>
              <select id="pf-loc" className="input" value={d.locationId ?? ''} onChange={e => set({ locationId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Chọn vị trí</option>
                {locations.data?.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <Field label="Trọng lượng">
              <div className="flex gap-2"><NumberInput value={d.weight} onChange={weight => set({ weight: Math.max(0, weight) })} />
                <select className="input w-20" value={d.weightUnit} onChange={e => set({ weightUnit: e.target.value as 'g' | 'kg' })}><option value="g">g</option><option value="kg">kg</option></select></div>
            </Field>
          </div>
        </Section>
      )}

      {d.type === 'goods' && (
        <Section title="Quản lý theo đơn vị tính và thuộc tính">
          <div className="space-y-5">
            <UnitsEditor baseUnit={d.unit} onBaseUnit={unit => set({ unit })} units={d.units} onChange={units => set({ units })} basePrice={d.price} />
            <div className="border-t border-slate-100 pt-4">
              <div className="mb-1 text-sm font-semibold">Thuộc tính</div>
              <VariantsEditor attributes={d.attributes} variants={d.variants} isEdit={isEdit} showCost={showCost} defaults={{ price: d.price, cost: d.cost }}
                onChange={(attributes, variants) => set({ attributes, variants })} />
            </div>
          </div>
        </Section>
      )}
      {d.type !== 'goods' && (
        <Field label="Đơn vị tính" className="max-w-xs"><input className="input" value={d.unit} onChange={e => set({ unit: e.target.value })} /></Field>
      )}
    </div>
  );

  return (
    <>
      <Modal open={open} size="xl" title={TITLES[d.type][isEdit ? 1 : 0]} onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            <label className="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={d.isDirectSale} onChange={e => set({ isDirectSale: e.target.checked })} />Bán trực tiếp</label>
            {errors._form && <span className="text-sm text-rose-600">{errors._form}</span>}
            <button type="button" className="btn" onClick={onClose}>Bỏ qua</button>
            {!isEdit && <button type="button" className="btn" disabled={saving} onClick={() => save('new')}>Lưu & Tạo thêm hàng</button>}
            {!isEdit && <button type="button" className="btn" disabled={saving} onClick={() => save('copy')}>Lưu & Sao chép</button>}
            <button type="button" className="btn-primary" disabled={saving} onClick={() => save('close')}>Lưu</button>
          </div>
        }>
        <Tabs tabs={[
          { key: 'info', label: 'Thông tin', content: () => infoTab },
          {
            key: 'desc', label: 'Mô tả', content: () => (
              <div className="space-y-3 py-3">
                <Field label="Mô tả"><textarea className="input min-h-40" value={d.description} onChange={e => set({ description: e.target.value })} /></Field>
                <Field label="Ghi chú"><textarea className="input" rows={2} placeholder="Ghi chú" value={d.note} onChange={e => set({ note: e.target.value })} /></Field>
                <Field label="Mẫu ghi chú (hóa đơn, đặt hàng)" hint="Tự động điền vào ghi chú dòng hàng khi bán"><input className="input" value={d.orderNoteTemplate} onChange={e => set({ orderNoteTemplate: e.target.value })} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.sellOnline} onChange={e => set({ sellOnline: e.target.checked })} />Bán trên website</label>
              </div>
            ),
          },
          { key: 'warranty', label: 'Bảo hành, bảo trì', content: () => <div className="py-3"><WarrantyEditor value={d.warranties} onChange={warranties => set({ warranties })} /></div> },
          {
            key: 'branches', label: 'Chi nhánh kinh doanh', content: () => (
              <div className="space-y-2 py-3">
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={d.allBranches} onChange={() => set({ allBranches: true })} />Toàn hệ thống</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={!d.allBranches} onChange={() => set({ allBranches: false })} />Chi nhánh</label>
                {!d.allBranches && (
                  <div className="flex flex-wrap gap-3 pl-6">
                    {branches.data?.items.filter(b => b.isActive).map(b => (
                      <label key={b.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.branchIds.includes(b.id)} onChange={() => set({ branchIds: d.branchIds.includes(b.id) ? d.branchIds.filter(x => x !== b.id) : [...d.branchIds, b.id] })} />{b.name}</label>
                    ))}
                  </div>
                )}
                {err('branchIds')}
              </div>
            ),
          },
        ]} />
      </Modal>
      <QuickCreate kind={quick} onClose={() => setQuick(null)} onCreated={id => set(quick === 'group' ? { groupId: id } : quick === 'brand' ? { brandId: id } : { locationId: id })} />
    </>
  );
}
