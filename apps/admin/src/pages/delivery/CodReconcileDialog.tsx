import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useFunds } from '../../lib/cash';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { usePartners } from './usePartners';
import type { DeliveryList } from './types';

/** Settles a carrier's delivered, unreconciled waybills: COD collected minus the fees the shop pays. */
export function CodReconcileDialog({ open, onClose, partnerId: initial }: { open: boolean; onClose: () => void; partnerId?: number }) {
  const qc = useQueryClient();
  const partners = usePartners();
  const funds = useFunds();
  const [partnerId, setPartnerId] = useState(initial ?? 0);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [fundId, setFundId] = useState(0);
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setPartnerId(initial ?? 0); setExcluded([]); setFundId(0); setNote(''); } }, [open, initial]);
  const rows = useQuery({
    queryKey: ['deliveries', 'reconcilable', partnerId], enabled: open && !!partnerId,
    queryFn: () => api<DeliveryList>('/deliveries', { query: { status: 'delivered', reconciled: 'false', partnerIds: String(partnerId), pageSize: 500 } }),
  });
  const items = rows.data?.items ?? [];
  const chosen = items.filter(r => !excluded.includes(r.invoiceId));
  const cod = chosen.reduce((s, r) => s + r.cod, 0);
  const fee = chosen.filter(r => r.feePayer === 'shop').reduce((s, r) => s + r.fee, 0);
  const fund = fundId || funds.data?.find(f => f.type === 'cash')?.id || 0;
  async function save() {
    try {
      const r = await api<{ code: string }>('/cod-reconciliations', { body: { partnerId, invoiceIds: chosen.map(c => c.invoiceId), fundId: fund, note } });
      await Promise.all(['deliveries', 'cod-reconciliations', 'cash-vouchers', 'delivery-partners'].map(k => qc.invalidateQueries({ queryKey: [k] })));
      toast(`Đã tạo phiếu đối soát ${r.code}`);
      onClose();
    } catch (e) { toastError(e); }
  }
  return (
    <Modal open={open} size="lg" title="Đối soát COD" onClose={onClose}
      footer={<><span className="mr-auto text-sm">Thực nhận: <b data-testid="reconcile-amount" className="tabular-nums">{formatVnd(cod - fee)}</b></span><button type="button" className="btn-primary" disabled={!chosen.length} onClick={save}>Đối soát</button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Đối tác"><select className="input" aria-label="Đối tác" value={partnerId} onChange={e => { setPartnerId(Number(e.target.value)); setExcluded([]); }}><option value={0}>Chọn đối tác</option>{partners.data?.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Quỹ nhận tiền"><select className="input" value={fund} onChange={e => setFundId(Number(e.target.value))}>{funds.data?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
        <Field label="Ghi chú"><input className="input" value={note} onChange={e => setNote(e.target.value)} /></Field>
      </div>
      {partnerId > 0 && (
        <div className="mt-4 max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-slate-500"><tr><th className="p-2" /><th className="p-2">Mã vận đơn</th><th className="p-2">Giao lúc</th><th className="p-2">Người nhận</th><th className="p-2 text-right">COD</th><th className="p-2 text-right">Phí (shop trả)</th></tr></thead>
            <tbody>
              {items.map(r => (
                <tr key={r.invoiceId} className="border-t border-slate-100">
                  <td className="p-2"><input type="checkbox" aria-label="Chọn vận đơn" checked={!excluded.includes(r.invoiceId)} onChange={() => setExcluded(x => x.includes(r.invoiceId) ? x.filter(i => i !== r.invoiceId) : [...x, r.invoiceId])} /></td>
                  <td className="p-2">{r.invoiceCode}</td><td className="p-2">{r.deliveredAt ? formatDateTime(r.deliveredAt) : ''}</td><td className="p-2">{r.receiverName}</td>
                  <td className="p-2 text-right tabular-nums">{formatVnd(r.cod)}</td><td className="p-2 text-right tabular-nums">{r.feePayer === 'shop' ? formatVnd(r.fee) : '—'}</td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">{rows.isLoading ? 'Đang tải…' : 'Không có vận đơn chờ đối soát'}</td></tr>}
            </tbody>
          </table>
          <div className="mt-2 flex justify-end gap-6 text-sm"><span>Tổng COD: <b className="tabular-nums">{formatVnd(cod)}</b></span><span>Tổng phí: <b className="tabular-nums">{formatVnd(fee)}</b></span></div>
        </div>
      )}
    </Modal>
  );
}
