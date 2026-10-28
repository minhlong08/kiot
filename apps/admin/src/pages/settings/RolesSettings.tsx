import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ACTIONS, MODULES, SPECIAL_PERMS, permKey } from '@pd/shared';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { Field, NumberInput } from '../../components/Field';
import { toast, toastError } from '../../components/toast';

type Role = { id: number; name: string; isAdmin: boolean; maxDiscountPercent: number; permissions: string[]; userCount: number };
const ACTION_LABELS: Record<string, string> = { view: 'Xem', create: 'Thêm', edit: 'Sửa', delete: 'Xóa', export: 'Xuất file' };
const SPECIAL_LABELS: Record<string, string> = { 'cost.view': 'Xem giá vốn', 'pos.editPrice': 'Sửa giá bán khi bán hàng', 'pos.access': 'Truy cập màn hình bán hàng' };

export function RolesSettings() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<{ items: Role[] }>('/roles') });
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Omit<Role, 'id' | 'userCount' | 'isAdmin'>>({ name: '', maxDiscountPercent: 0, permissions: [] });

  useEffect(() => {
    if (selectedId === null && roles.data?.items.length) setSelectedId(roles.data.items[0].id);
  }, [roles.data, selectedId]);
  const selected = roles.data?.items.find(r => r.id === selectedId);
  useEffect(() => {
    if (selected) setDraft({ name: selected.name, maxDiscountPercent: selected.maxDiscountPercent, permissions: selected.permissions });
    if (selectedId === 'new') setDraft({ name: '', maxDiscountPercent: 0, permissions: [] });
  }, [selected, selectedId]);

  const save = useMutation({
    mutationFn: () => (selectedId === 'new' ? api<Role>('/roles', { body: draft }) : api<Role>(`/roles/${selectedId}`, { method: 'PUT', body: draft })),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['roles'] }); setSelectedId(r.id); toast('Đã lưu vai trò'); },
    onError: toastError,
  });
  const remove = useMutation({
    mutationFn: () => api(`/roles/${selectedId}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); setSelectedId(null); toast('Đã xóa vai trò'); },
    onError: toastError,
  });

  const has = (k: string) => draft.permissions.includes(k);
  const toggle = (k: string) => setDraft(d => ({ ...d, permissions: has(k) ? d.permissions.filter(p => p !== k) : [...d.permissions, k] }));
  const toggleRow = (m: string) => {
    const keys = ACTIONS.map(a => permKey(m, a));
    const all = keys.every(has);
    setDraft(d => ({ ...d, permissions: all ? d.permissions.filter(p => !keys.includes(p)) : [...new Set([...d.permissions, ...keys])] }));
  };
  const isAdmin = selected?.isAdmin ?? false;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="w-full space-y-1 lg:w-56">
        {roles.data?.items.map(r => (
          <button key={r.id} type="button" onClick={() => setSelectedId(r.id)}
            className={`block w-full rounded px-3 py-2 text-left text-sm ${r.id === selectedId ? 'bg-brand-700 text-white' : 'hover:bg-white'}`}>
            {r.name} <span className="opacity-70">({r.userCount})</span>
          </button>
        ))}
        <button type="button" className="btn mt-2 w-full" onClick={() => setSelectedId('new')}><Plus size={16} />Thêm vai trò</button>
      </div>
      <div className="card min-w-0 flex-1 space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tên vai trò"><input className="input" value={draft.name} disabled={isAdmin} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Giảm giá tối đa khi bán hàng (%)"><NumberInput value={draft.maxDiscountPercent} disabled={isAdmin} onChange={v => setDraft({ ...draft, maxDiscountPercent: Math.min(100, Math.max(0, Math.round(v))) })} /></Field>
        </div>
        {isAdmin ? (
          <p className="rounded bg-brand-50 p-3 text-sm text-brand-800">Vai trò quản trị có toàn quyền trên hệ thống.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-brand-50 text-left"><th className="px-3 py-2">Chức năng</th>{ACTIONS.map(a => <th key={a} className="px-3 py-2 text-center">{ACTION_LABELS[a]}</th>)}</tr></thead>
                <tbody>
                  {MODULES.map(m => (
                    <tr key={m.key} className="border-b border-slate-100">
                      <td className="px-3 py-1.5"><button type="button" className="hover:text-brand-700" onClick={() => toggleRow(m.key)}>{t(m.labelKey)}</button></td>
                      {ACTIONS.map(a => (
                        <td key={a} className="text-center"><input type="checkbox" aria-label={`${t(m.labelKey)} ${ACTION_LABELS[a]}`} checked={has(permKey(m.key, a))} onChange={() => toggle(permKey(m.key, a))} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-4">
              {SPECIAL_PERMS.map(k => (
                <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={has(k)} onChange={() => toggle(k)} />{SPECIAL_LABELS[k]}</label>
              ))}
            </div>
          </>
        )}
        {!isAdmin && (
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={save.isPending || !draft.name} onClick={() => save.mutate()}>Lưu</button>
            {selectedId !== 'new' && <button type="button" className="btn-danger" onClick={() => remove.mutate()}>Xóa</button>}
          </div>
        )}
      </div>
    </div>
  );
}
