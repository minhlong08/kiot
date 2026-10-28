import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput } from '../../components/Field';
import { FundSelect } from '../../components/FundSelect';
import { toast, toastError } from '../../components/toast';

export function PaymentDialog({ supplier, onClose }: { supplier: { id: number; name: string; debt: number } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(0);
  const [fundId, setFundId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { if (supplier) { setAmount(Math.max(0, supplier.debt)); setNote(''); } }, [supplier]);
  async function submit() {
    try {
      await api(`/suppliers/${supplier!.id}/payments`, { body: { amount, fundId, note } });
      await Promise.all(['suppliers', 'supplier', 'supplier-ledger'].map(k => qc.invalidateQueries({ queryKey: [k] })));
      toast('Đã tạo phiếu chi');
      onClose();
    } catch (e) { toastError(e); }
  }
  return (
    <Modal open={!!supplier} size="sm" title={`Thanh toán: ${supplier?.name ?? ''}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Bỏ qua</button><button type="button" className="btn-primary" disabled={amount <= 0} onClick={submit}>Tạo phiếu chi</button></>}>
      <div className="space-y-3">
        <div className="flex justify-between text-sm"><span>Nợ hiện tại</span><b>{formatVnd(supplier?.debt ?? 0)}</b></div>
        <Field label="Số tiền trả"><MoneyInput value={amount} onChange={setAmount} aria-label="Số tiền trả" /></Field>
        <Field label="Quỹ tiền"><FundSelect value={fundId} onChange={setFundId} /></Field>
        <Field label="Ghi chú"><input className="input" value={note} onChange={e => setNote(e.target.value)} /></Field>
        <div className="flex justify-between text-sm"><span>Nợ sau thanh toán</span><b>{formatVnd((supplier?.debt ?? 0) - amount)}</b></div>
      </div>
    </Modal>
  );
}
