import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Pencil, Plus } from 'lucide-react';
import { formatVnd, parseVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { Modal } from '../../components/Modal';
import { Field, NumberInput } from '../../components/Field';
import { FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, useListState } from '../../components/list';
import { GroupTreeFilter } from '../products/GroupTreeFilter';
import { useBranches, useGroups } from '../products/useLookups';

type Book = { id: number; name: string; isActive: boolean; startAt: string | null; endAt: string | null; branchIds: number[]; customerGroupIds: number[]; userIds: number[]; allowOutsideItems: boolean; itemCount: number };
type Item = { productId: number; code: string; name: string; basePrice: number; cost?: number; price: number | null };

function PriceCell({ label, value, onSave }: { label: string; value: number | null; onSave: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : formatVnd(value));
  useEffect(() => setText(value === null ? '' : formatVnd(value)), [value]);
  return (
    <input className="input w-32 text-right tabular-nums" aria-label={label} value={text} placeholder="—"
      onChange={e => setText(e.target.value)} onFocus={e => e.target.select()}
      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onBlur={() => {
        const next = text.trim() === '' ? null : parseVnd(text);
        if (next !== value) onSave(next);
      }} />
  );
}

const toLocalDate = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10) : '');
const fromLocalDate = (d: string, endOfDay = false) => (d ? new Date(`${d}T${endOfDay ? '23:59:59' : '00:00:00'}+07:00`).toISOString() : null);

function BookForm({ book, onClose }: { book: Partial<Book> | null; onClose: () => void }) {
  const qc = useQueryClient();
  const branches = useBranches();
  const [b, setB] = useState<Partial<Book>>({});
  useEffect(() => setB(book ?? {}), [book]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: b.name ?? '', isActive: b.isActive ?? true, startAt: b.startAt ?? null, endAt: b.endAt ?? null, branchIds: b.branchIds ?? [], customerGroupIds: b.customerGroupIds ?? [], userIds: b.userIds ?? [], allowOutsideItems: b.allowOutsideItems ?? true };
      return b.id ? api(`/price-books/${b.id}`, { method: 'PUT', body }) : api('/price-books', { body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-books'] }); toast('Đã lưu bảng giá'); onClose(); },
    onError: toastError,
  });
  const remove = useMutation({
    mutationFn: () => api(`/price-books/${b.id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-books'] }); onClose(); },
    onError: toastError,
  });
  return (
    <Modal open={!!book} title={b.id ? 'Sửa bảng giá' : 'Thêm bảng giá'} onClose={onClose}
      footer={<>{b.id && <button type="button" className="btn-danger mr-auto" onClick={() => remove.mutate()}>Xóa</button>}<button type="button" className="btn" onClick={onClose}>Bỏ qua</button><button type="button" className="btn-primary" disabled={!b.name} onClick={() => save.mutate()}>Lưu</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Tên bảng giá"><input className="input" value={b.name ?? ''} onChange={e => setB({ ...b, name: e.target.value })} /></Field></div>
        <Field label="Hiệu lực từ"><input type="date" className="input" value={toLocalDate(b.startAt ?? null)} onChange={e => setB({ ...b, startAt: fromLocalDate(e.target.value) })} /></Field>
        <Field label="Đến"><input type="date" className="input" value={toLocalDate(b.endAt ?? null)} onChange={e => setB({ ...b, endAt: fromLocalDate(e.target.value, true) })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.isActive ?? true} onChange={e => setB({ ...b, isActive: e.target.checked })} />Áp dụng</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.allowOutsideItems ?? true} onChange={e => setB({ ...b, allowOutsideItems: e.target.checked })} />Cho phép bán hàng không có trong bảng giá</label>
        <div className="sm:col-span-2">
          <span className="label">Chi nhánh áp dụng (để trống: toàn hệ thống)</span>
          <div className="flex flex-wrap gap-3">
            {branches.data?.items.map(br => (
              <label key={br.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(b.branchIds ?? []).includes(br.id)} onChange={() => setB({ ...b, branchIds: (b.branchIds ?? []).includes(br.id) ? (b.branchIds ?? []).filter(x => x !== br.id) : [...(b.branchIds ?? []), br.id] })} />{br.name}</label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function FormulaDialog({ book, books, open, onClose, scope }: { book: Book | undefined; books: Book[]; open: boolean; onClose: () => void; scope: { search: string; groupIds: number[] } }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ base: 'cost' as 'cost' | 'price' | 'book', baseBookId: 0, op: '+' as '+' | '-', value: 30, unit: '%' as '%' | 'VND', roundTo: 1000 as 0 | 100 | 1000 });
  const apply = useMutation({
    mutationFn: () => api<{ updated: number }>(`/price-books/${book!.id}/apply-formula`, { body: { ...f, baseBookId: f.base === 'book' ? f.baseBookId : undefined, search: scope.search || undefined, groupIds: scope.groupIds.length ? scope.groupIds : undefined } }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['price-book-items'] }); toast(`Đã cập nhật giá ${r.updated} hàng hóa`); onClose(); },
    onError: toastError,
  });
  return (
    <Modal open={open && !!book} size="sm" title={`Thiết lập công thức: ${book?.name ?? ''}`} onClose={onClose}
      footer={<button type="button" className="btn-primary" onClick={() => apply.mutate()}>Áp dụng</button>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-500">Áp dụng cho các hàng hóa đang lọc ở danh sách.</p>
        <Field label="Giá gốc">
          <select className="input" value={f.base} onChange={e => setF({ ...f, base: e.target.value as typeof f.base })}>
            <option value="cost">Giá vốn</option><option value="price">Bảng giá chung (giá bán)</option><option value="book">Bảng giá khác</option>
          </select>
        </Field>
        {f.base === 'book' && (
          <Field label="Bảng giá gốc">
            <select className="input" value={f.baseBookId} onChange={e => setF({ ...f, baseBookId: Number(e.target.value) })}>
              <option value={0}>Chọn bảng giá</option>{books.filter(x => x.id !== book?.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        )}
        <div className="flex gap-2">
          <select className="input w-16" value={f.op} onChange={e => setF({ ...f, op: e.target.value as '+' | '-' })} aria-label="Phép tính"><option>+</option><option>-</option></select>
          <NumberInput value={f.value} onChange={value => setF({ ...f, value: Math.max(0, value) })} />
          <select className="input w-20" value={f.unit} onChange={e => setF({ ...f, unit: e.target.value as '%' | 'VND' })} aria-label="Đơn vị"><option>%</option><option>VND</option></select>
        </div>
        <Field label="Làm tròn">
          <select className="input" value={f.roundTo} onChange={e => setF({ ...f, roundTo: Number(e.target.value) as 0 | 100 | 1000 })}>
            <option value={0}>Không làm tròn</option><option value={100}>Hàng trăm</option><option value={1000}>Hàng nghìn</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

export function PriceBooksPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const groups = useGroups();
  const books = useQuery({ queryKey: ['price-books'], queryFn: () => api<Book[]>('/price-books') });
  const { state, set } = useListState({ book: '', groupIds: [] as string[] });
  const [editing, setEditing] = useState<Partial<Book> | null>(null);
  const [formula, setFormula] = useState(false);
  const bookId = Number(state.book) || books.data?.[0]?.id;
  const book = books.data?.find(b => b.id === bookId);
  const query = { page: state.page, pageSize: state.pageSize, search: state.search, groupIds: state.groupIds as string[] };
  const items = useQuery({ queryKey: ['price-book-items', bookId, query], enabled: !!bookId, queryFn: () => api<{ items: Item[]; total: number }>(`/price-books/${bookId}/items`, { query }) });
  const savePrice = useMutation({
    mutationFn: (v: { productId: number; price: number | null }) => api(`/price-books/${bookId}/items`, { method: 'PUT', body: { items: [v] } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-book-items'] }); qc.invalidateQueries({ queryKey: ['price-books'] }); },
    onError: toastError,
  });

  return (
    <>
      <ListPage
        sidebar={
          <FilterSidebar title="Thiết lập giá">
            <FilterSection title="Bảng giá" action={can('priceBooks.create') ? <button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => setEditing({ isActive: true, allowOutsideItems: true })}><Plus size={14} className="inline" /> Tạo mới</button> : undefined}>
              {books.data?.map(b => (
                <div key={b.id} className={`flex items-center justify-between rounded px-2 py-1.5 text-sm ${b.id === bookId ? 'bg-brand-50 font-medium text-brand-800' : 'hover:bg-slate-50'}`}>
                  <button type="button" className="flex-1 text-left" onClick={() => set({ book: String(b.id) })}>{b.name} <span className="text-xs text-slate-400">({b.itemCount})</span>{!b.isActive && <span className="ml-1 text-xs text-rose-600">ngừng</span>}</button>
                  {can('priceBooks.edit') && <button type="button" aria-label={`Sửa ${b.name}`} className="text-slate-400 hover:text-brand-700" onClick={() => setEditing(b)}><Pencil size={13} /></button>}
                </div>
              ))}
              {!books.data?.length && <p className="text-sm text-slate-400">Chưa có bảng giá. Tạo bảng giá để bán với giá khác giá chung.</p>}
            </FilterSection>
            <FilterSection title="Nhóm hàng">
              <GroupTreeFilter groups={groups.data ?? []} value={(state.groupIds as string[]).map(Number)} onChange={ids => set({ groupIds: ids.map(String) })} />
            </FilterSection>
          </FilterSidebar>
        }
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã, tên hàng"
          extra={book && can('priceBooks.edit') ? <button type="button" className="btn" onClick={() => setFormula(true)}><Calculator size={16} />Thiết lập công thức</button> : undefined} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={items.data?.total ?? 0} noun="hàng hóa" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-slate-700">
            <tr><th className="px-3 py-2.5 text-left">Mã hàng</th><th className="px-3 py-2.5 text-left">Tên hàng</th>{can('cost.view') && <th className="px-3 py-2.5 text-right">Giá vốn</th>}<th className="px-3 py-2.5 text-right">Bảng giá chung</th>{book && <th className="px-3 py-2.5 text-right">{book.name}</th>}</tr>
          </thead>
          <tbody>
            {items.data?.items.map(it => (
              <tr key={it.productId} className="border-b border-slate-100 bg-white">
                <td className="px-3 py-1.5">{it.code}</td><td className="px-3 py-1.5">{it.name}</td>
                {can('cost.view') && <td className="num px-3 py-1.5">{formatVnd(it.cost ?? 0)}</td>}
                <td className="num px-3 py-1.5">{formatVnd(it.basePrice)}</td>
                {book && <td className="px-3 py-1 text-right"><PriceCell label={`Giá ${book.name} ${it.code}`} value={it.price} onSave={price => savePrice.mutate({ productId: it.productId, price })} /></td>}
              </tr>
            ))}
            {!book && <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400">Chọn hoặc tạo một bảng giá</td></tr>}
          </tbody>
        </table>
      </ListPage>
      <BookForm book={editing} onClose={() => setEditing(null)} />
      <FormulaDialog book={book} books={books.data ?? []} open={formula} onClose={() => setFormula(false)} scope={{ search: state.search, groupIds: (state.groupIds as string[]).map(Number) }} />
    </>
  );
}
