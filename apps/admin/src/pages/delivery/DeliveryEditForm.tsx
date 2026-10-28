import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PROVINCES } from '@pd/shared';
import { api } from '../../lib/api';
import { Field, MoneyInput, NumberInput } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { usePartners } from './usePartners';
import type { DeliveryRow } from './types';

/** Receiver, carrier and fee of a waybill; editable only before the carrier picks the parcel up. */
export function DeliveryEditForm({ row }: { row: DeliveryRow }) {
  const qc = useQueryClient();
  const partners = usePartners();
  const [f, setF] = useState(row);
  useEffect(() => setF(row), [row]);
  const locked = !['pending', 'picked'].includes(row.status);
  async function save() {
    try {
      await api(`/deliveries/${row.invoiceId}`, { method: 'PUT', body: {
        receiverName: f.receiverName, receiverPhone: f.receiverPhone, address: f.address, ward: f.ward, province: f.province, partnerId: f.partnerId,
        fee: f.fee, weight: f.weight, note: f.note, feePayer: f.feePayer, trackingCode: f.trackingCode,
      } });
      await qc.invalidateQueries({ queryKey: ['deliveries'] });
      toast('Đã lưu vận đơn');
    } catch (e) { toastError(e); }
  }
  async function quote(partnerId: number | null) {
    setF(x => ({ ...x, partnerId }));
    if (!partnerId) return;
    const q = await api<{ fee: number }>(`/delivery-partners/${partnerId}/quote`, { body: { weight: f.weight } }).catch(() => null);
    if (q) setF(x => ({ ...x, fee: q.fee }));
  }
  return (
    <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-3">
      <Field label="Người nhận"><input className="input" value={f.receiverName} onChange={e => setF({ ...f, receiverName: e.target.value })} /></Field>
      <Field label="Điện thoại"><input className="input" value={f.receiverPhone} onChange={e => setF({ ...f, receiverPhone: e.target.value })} /></Field>
      <Field label="Tỉnh/Thành"><select className="input" value={f.province} onChange={e => setF({ ...f, province: e.target.value })}><option value="">—</option>{PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}</select></Field>
      <Field label="Địa chỉ" className="sm:col-span-2"><input className="input" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
      <Field label="Phường/Xã"><input className="input" value={f.ward} onChange={e => setF({ ...f, ward: e.target.value })} /></Field>
      <Field label="Đối tác giao hàng"><select className="input" value={f.partnerId ?? ''} onChange={e => quote(e.target.value ? Number(e.target.value) : null)}><option value="">Tự giao</option>{partners.data?.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Trọng lượng (gram)"><NumberInput value={f.weight} onChange={weight => setF({ ...f, weight })} /></Field>
      <Field label="Phí giao hàng"><MoneyInput value={f.fee} onChange={fee => setF({ ...f, fee })} /></Field>
      <Field label="Người trả phí"><select className="input" value={f.feePayer} onChange={e => setF({ ...f, feePayer: e.target.value as 'shop' | 'customer' })}><option value="shop">Cửa hàng trả</option><option value="customer">Người nhận trả</option></select></Field>
      <Field label="Mã vận đơn đối tác"><input className="input" value={f.trackingCode} onChange={e => setF({ ...f, trackingCode: e.target.value })} /></Field>
      <Field label="Ghi chú"><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      {!locked && <div className="sm:col-span-3 flex justify-end"><button type="button" className="btn-primary" onClick={save}>Lưu vận đơn</button></div>}
    </fieldset>
  );
}
