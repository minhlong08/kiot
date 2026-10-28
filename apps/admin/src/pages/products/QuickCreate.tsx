import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toastError } from '../../components/toast';
import { flattenGroups, useGroups } from './useLookups';

export type QuickKind = 'group' | 'brand' | 'location';
const META: Record<QuickKind, { title: string; path: string; key: string }> = {
  group: { title: 'Thêm nhóm hàng', path: '/product-groups', key: 'product-groups' },
  brand: { title: 'Thêm thương hiệu', path: '/brands', key: 'brands' },
  location: { title: 'Thêm vị trí', path: '/locations', key: 'locations' },
};

export function QuickCreate({ kind, onClose, onCreated }: { kind: QuickKind | null; onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<number | null>(null);
  const groups = useGroups();
  const qc = useQueryClient();
  if (!kind) return null;
  const meta = META[kind];
  async function save() {
    try {
      const row = await api<{ id: number }>(meta.path, { body: kind === 'group' ? { name, parentId } : { name } });
      await qc.invalidateQueries({ queryKey: [meta.key] });
      onCreated(row.id);
      setName('');
      onClose();
    } catch (e) { toastError(e); }
  }
  return (
    <Modal open title={meta.title} size="sm" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Bỏ qua</button><button type="button" className="btn-primary" disabled={!name.trim()} onClick={save}>Lưu</button></>}>
      <div className="space-y-3">
        <Field label="Tên"><input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && name.trim() && save()} /></Field>
        {kind === 'group' && (
          <Field label="Nhóm cha">
            <select className="input" value={parentId ?? ''} onChange={e => setParentId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Không có —</option>
              {flattenGroups(groups.data ?? []).map(g => <option key={g.id} value={g.id}>{' '.repeat(g.depth * 3)}{g.name}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
