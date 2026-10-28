import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon } from 'lucide-react';
import { formatDate, formatDateTime } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { ConfirmModal } from '../../components/Modal';
import {
  BulkBar, CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, RadioFilter,
  resolveDateRange, useListState, type Column,
} from '../../components/list';
import { GroupTreeFilter } from './GroupTreeFilter';
import { ProductDetail } from './ProductDetail';
import { useBrands, useGroups } from './useLookups';
import { useProductDialogs } from './productPageHooks';
import { ImportDialog } from './ImportDialog';
import { BarcodeLabels } from './BarcodeLabels';
import { useSettings } from '../../lib/settings';

export type ProductRow = {
  id: number; code: string; name: string; type: string; price: number; cost?: number; onHand: number; reserved: number; createdAt: string;
  expectedOutDate: string | null; imageUrl: string | null; isActive: boolean; groupName: string; brandName?: string; unit: string;
};

const STOCK_OPTIONS = [
  { value: 'all', label: 'Tất cả' }, { value: 'inStock', label: 'Còn hàng trong kho' }, { value: 'outOfStock', label: 'Hết hàng trong kho' },
  { value: 'belowMin', label: 'Dưới định mức tồn' }, { value: 'aboveMax', label: 'Vượt định mức tồn' },
];

export function ProductsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const groups = useGroups();
  const brands = useBrands();
  const { state, set } = useListState({
    groupIds: [] as string[], stock: 'all', created: 'all', types: [] as string[], brandIds: [] as string[],
    isDirectSale: '', loyalty: '', status: 'active',
  });
  const [selected, setSelected] = useState<(string | number)[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<number[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [labelIds, setLabelIds] = useState<number[] | null>(null);
  const settings = useSettings();
  const hooks = useProductDialogs({
    openImport: () => setImportOpen(true),
    printLabels: ids => setLabelIds(ids),
    elements: <>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <BarcodeLabels ids={labelIds} onClose={() => setLabelIds(null)} storeName={settings.data?.store.name ?? ''} />
    </>,
  });

  const created = resolveDateRange(state.created as string);
  const query = {
    page: state.page, pageSize: state.pageSize, search: state.search, sort: state.sort,
    groupIds: state.groupIds as string[], stock: state.stock as string, types: state.types as string[], brandIds: state.brandIds as string[],
    isDirectSale: state.isDirectSale as string, loyalty: state.loyalty as string, status: state.status as string,
    createdFrom: created.from, createdTo: created.to,
  };
  const list = useQuery({ queryKey: ['products', query], queryFn: () => api<{ items: ProductRow[]; total: number; totals: Record<string, number> }>('/products', { query }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['product'] }); };

  const bulk = useMutation({
    mutationFn: (b: { ids: number[]; action: string; groupId?: number }) => api<{ deleted?: number; deactivated?: number }>('/products/bulk', { body: b }),
    onSuccess: (r, b) => {
      refresh();
      setSelected([]);
      toast(b.action === 'delete' ? `Đã xóa ${r.deleted ?? 0}, ngừng kinh doanh ${r.deactivated ?? 0} hàng hóa` : 'Đã cập nhật');
    },
    onError: toastError,
  });

  const columns: Column<ProductRow>[] = [
    { key: 'code', header: 'Mã hàng', sortable: true, width: 120 },
    {
      key: 'image', header: 'Ảnh', width: 48, render: r => (
        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded bg-slate-100">
          {r.imageUrl ? <img src={r.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageIcon size={16} className="text-slate-300" />}
        </div>
      ),
    },
    { key: 'name', header: 'Tên hàng', sortable: true, render: r => <span className={r.isActive ? '' : 'text-slate-400 line-through'}>{r.name}</span> },
    { key: 'groupName', header: 'Nhóm hàng', hiddenByDefault: true },
    { key: 'price', header: 'Giá bán', money: true, sortable: true },
    ...(can('cost.view') ? [{ key: 'cost', header: 'Giá vốn', money: true, sortable: true } as Column<ProductRow>] : []),
    { key: 'onHand', header: 'Tồn kho', money: true, total: true },
    { key: 'reserved', header: 'Khách đặt', money: true, total: true },
    { key: 'createdAt', header: 'Thời gian tạo', render: r => formatDateTime(r.createdAt), sortable: true },
    { key: 'expectedOutDate', header: 'Dự kiến hết hàng', render: r => (r.expectedOutDate ? formatDate(r.expectedOutDate) : '---') },
  ];

  const groupName = (id: number) => list.data?.items.find(r => r.id === id)?.groupName ?? '';

  return (
    <>
      <ListPage
        sidebar={
          <FilterSidebar title="Hàng hóa">
            <FilterSection title="Nhóm hàng" action={can('products.create') ? <button type="button" className="text-sm text-brand-700 hover:underline" onClick={hooks.openGroups}>Tạo mới</button> : undefined}>
              <GroupTreeFilter groups={groups.data ?? []} value={(state.groupIds as string[]).map(Number)} onChange={ids => set({ groupIds: ids.map(String) })} />
            </FilterSection>
            <FilterSection title="Tồn kho">
              <select className="input" value={state.stock as string} onChange={e => set({ stock: e.target.value })} aria-label="Tiêu chí tồn">
                {STOCK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </FilterSection>
            <FilterSection title="Thời gian tạo" defaultOpen={false}>
              <DateRangeFilter value={state.created as string} onChange={v => set({ created: v })} presets={['today', 'thisWeek', 'thisMonth', 'lastMonth', 'all']} />
            </FilterSection>
            <FilterSection title="Loại hàng" defaultOpen={false}>
              <CheckboxFilter options={[{ value: 'goods', label: 'Hàng hóa' }, { value: 'service', label: 'Dịch vụ' }, { value: 'combo', label: 'Combo - đóng gói' }]} value={state.types as string[]} onChange={v => set({ types: v })} />
            </FilterSection>
            <FilterSection title="Thương hiệu" defaultOpen={false}>
              <CheckboxFilter options={(brands.data ?? []).map(b => ({ value: String(b.id), label: b.name }))} value={state.brandIds as string[]} onChange={v => set({ brandIds: v })} />
            </FilterSection>
            <FilterSection title="Bán trực tiếp" defaultOpen={false}>
              <RadioFilter options={[{ value: '', label: 'Tất cả' }, { value: 'true', label: 'Được bán trực tiếp' }, { value: 'false', label: 'Không bán trực tiếp' }]} value={state.isDirectSale as string} onChange={v => set({ isDirectSale: v })} />
            </FilterSection>
            <FilterSection title="Tích điểm" defaultOpen={false}>
              <RadioFilter options={[{ value: '', label: 'Tất cả' }, { value: 'true', label: 'Có tích điểm' }, { value: 'false', label: 'Không tích điểm' }]} value={state.loyalty as string} onChange={v => set({ loyalty: v })} />
            </FilterSection>
            <FilterSection title="Trạng thái hàng hóa" defaultOpen={false}>
              <RadioFilter options={[{ value: 'active', label: 'Hàng đang kinh doanh' }, { value: 'inactive', label: 'Hàng ngừng kinh doanh' }, { value: 'all', label: 'Tất cả' }]} value={state.status as string} onChange={v => set({ status: v })} />
            </FilterSection>
          </FilterSidebar>
        }
        toolbar={
          <div className="space-y-2">
            <ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã, tên hàng"
              createMenu={can('products.create') ? [
                { label: 'Hàng hóa', onClick: () => hooks.create('goods') },
                { label: 'Dịch vụ', onClick: () => hooks.create('service') },
                { label: 'Combo - đóng gói', onClick: () => hooks.create('combo') },
              ] : undefined}
              onImport={can('products.create') ? hooks.openImport : undefined}
              onExport={() => download('/products/export', query, 'danh-sach-hang-hoa.xlsx')} />
            <BulkBar count={selected.length} onClear={() => setSelected([])} actions={[
              ...(can('products.edit') ? [
                { label: 'Ngừng kinh doanh', onClick: () => bulk.mutate({ ids: selected.map(Number), action: 'deactivate' }) },
                { label: 'Cho phép kinh doanh', onClick: () => bulk.mutate({ ids: selected.map(Number), action: 'activate' }) },
                { label: 'Đổi nhóm hàng', onClick: () => hooks.changeGroup(selected.map(Number), groupId => bulk.mutate({ ids: selected.map(Number), action: 'setGroup', groupId })) },
              ] : []),
              { label: 'In tem mã', onClick: () => hooks.printLabels(selected.map(Number)) },
              ...(can('products.delete') ? [{ label: 'Xóa', danger: true, onClick: () => setConfirmDelete(selected.map(Number)) }] : []),
            ]} />
          </div>
        }
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="hàng hóa" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="products" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} loading={list.isLoading}
          totals={list.data?.totals} sort={state.sort} onSortChange={sort => set({ sort })}
          selected={selected} onSelectedChange={setSelected}
          renderExpanded={r => (
            <ProductDetail id={r.id} groupName={groupName(r.id)} brandName={r.brandName} actions={{
              onEdit: () => hooks.edit(r.id),
              onCopy: () => hooks.copy(r.id),
              onToggleActive: () => bulk.mutate({ ids: [r.id], action: r.isActive ? 'deactivate' : 'activate' }),
              onDelete: () => setConfirmDelete([r.id]),
              onPrint: () => hooks.printLabels([r.id]),
            }} />
          )} />
      </ListPage>
      {hooks.elements}
      <ConfirmModal open={!!confirmDelete} title="Xóa hàng hóa" danger confirmLabel="Xóa" onClose={() => setConfirmDelete(null)}
        message="Hàng hóa đã có giao dịch sẽ được chuyển sang ngừng kinh doanh thay vì xóa. Bạn có chắc chắn?"
        onConfirm={() => confirmDelete && bulk.mutate({ ids: confirmDelete, action: 'delete' })} />
    </>
  );
}
