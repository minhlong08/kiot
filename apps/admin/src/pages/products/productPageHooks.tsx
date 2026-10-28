import { useState, type ReactNode } from 'react';
import type { ProductType } from '@pd/shared';
import { api } from '../../lib/api';
import { toastError } from '../../components/toast';
import { Modal } from '../../components/Modal';
import { ProductForm, draftFromDetail } from './ProductForm';
import { QuickCreate } from './QuickCreate';
import { flattenGroups, useGroups } from './useLookups';
import type { ProductDraft } from './formTypes';
import type { ProductDetailData } from './ProductDetail';

type FormState = { type: ProductType; productId?: number; initial?: ProductDraft } | null;

export type ProductDialogs = {
  create: (type: ProductType) => void; edit: (id: number) => void; copy: (id: number) => void;
  openImport: () => void; openGroups: () => void; printLabels: (ids: number[]) => void;
  changeGroup: (ids: number[], apply: (groupId: number) => void) => void; elements: ReactNode;
};

/** Dialog wiring for the products page. Import and labels are registered by their own components via `extra`. */
export function useProductDialogs(extra: { openImport?: () => void; printLabels?: (ids: number[]) => void; elements?: ReactNode } = {}): ProductDialogs {
  const [form, setForm] = useState<FormState>(null);
  const [groupQuick, setGroupQuick] = useState(false);
  const [groupPick, setGroupPick] = useState<{ apply: (id: number) => void } | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const groups = useGroups();

  return {
    create: type => setForm({ type }),
    edit: id => api<ProductDetailData>(`/products/${id}`).then(p => setForm({ type: p.type, productId: p.parentId ?? id }), toastError),
    copy: id => api<ProductDetailData>(`/products/${id}/copy`, { method: 'POST', body: {} }).then(p => setForm({ type: p.type, initial: draftFromDetail(p) }), toastError),
    openImport: extra.openImport ?? (() => undefined),
    openGroups: () => setGroupQuick(true),
    printLabels: extra.printLabels ?? (() => undefined),
    changeGroup: (_ids, apply) => { setGroupId(null); setGroupPick({ apply }); },
    elements: (
      <>
        {form && <ProductForm open type={form.type} productId={form.productId} initial={form.initial} onClose={() => setForm(null)} onSaved={() => undefined} />}
        <QuickCreate kind={groupQuick ? 'group' : null} onClose={() => setGroupQuick(false)} onCreated={() => undefined} />
        <Modal open={!!groupPick} size="sm" title="Đổi nhóm hàng" onClose={() => setGroupPick(null)}
          footer={<button type="button" className="btn-primary" disabled={!groupId} onClick={() => { groupPick?.apply(groupId!); setGroupPick(null); }}>Lưu</button>}>
          <select className="input" value={groupId ?? ''} onChange={e => setGroupId(Number(e.target.value) || null)} aria-label="Nhóm hàng mới">
            <option value="">Chọn nhóm hàng</option>
            {flattenGroups(groups.data ?? []).map(g => <option key={g.id} value={g.id}>{' '.repeat(g.depth * 3)}{g.name}</option>)}
          </select>
        </Modal>
        {extra.elements}
      </>
    ),
  };
}
