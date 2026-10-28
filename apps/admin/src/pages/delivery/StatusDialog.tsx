import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { DELIVERY_STATUSES } from './types';

/** Moves one or many waybills to a new status; each waybill succeeds or fails on its own. */
export function StatusDialog({ ids, onClose }: { ids: number[]; onClose: (done: boolean) => void }) {
  const qc = useQueryClient();
  const [to, setTo] = useState('delivering');
  const [note, setNote] = useState('');
  useEffect(() => { if (ids.length) { setTo('delivering'); setNote(''); } }, [ids.length]);
  async function save() {
    try {
      const r = await api<{ results: { invoiceId: number; ok: boolean; error?: string }[] }>('/deliveries/bulk-status', { body: { invoiceIds: ids, to, ...(note ? { note } : {}) } });
      const failed = r.results.filter(x => !x.ok);
      await Promise.all(['deliveries', 'invoices', 'cash-vouchers'].map(k => qc.invalidateQueries({ queryKey: [k] })));
      if (failed.length) toastError(new Error(`${failed.length}/${ids.length} vận đơn không cập nhật được: ${failed[0].error ?? ''}`));
      else toast(`Đã cập nhật ${ids.length} vận đơn`);
      onClose(true);
    } catch (e) { toastError(e); }
  }
  return (
    <Modal open={ids.length > 0} size="sm" title={`Cập nhật trạng thái (${ids.length} vận đơn)`} onClose={() => onClose(false)} footer={<button type="button" className="btn-primary" onClick={save}>Lưu</button>}>
      <div className="space-y-3">
        <Field label="Trạng thái mới"><select className="input" aria-label="Trạng thái mới" value={to} onChange={e => setTo(e.target.value)}>{DELIVERY_STATUSES.filter(s => s.value !== 'pending' && s.value !== 'cancelled').map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
        <Field label="Ghi chú"><input className="input" value={note} onChange={e => setNote(e.target.value)} /></Field>
        {to === 'returned' && <p className="text-sm text-amber-700">Hóa đơn sẽ bị hủy, hàng nhập lại kho và tiền khách đã trả trước được hoàn.</p>}
      </div>
    </Modal>
  );
}
