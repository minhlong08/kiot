import { useEffect, useState } from 'react';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../lib/api';
import { Modal } from './ui';

type Inv = { id: number; code: string; createdAt: string; customerName: string; total: number; status: string };
type Order = { id: number; code: string; createdAt: string; customerName: string; total: number; deposit: number; status: string };

/** Today's invoices (reprint) and open customer orders (load into a tab for fulfilment). */
export function OrdersDialog({ open, onClose, onReprint, onLoadOrder }: { open: boolean; onClose: () => void; onReprint: (id: number) => void; onLoadOrder: (id: number) => void }) {
  const [tab, setTab] = useState<'invoices' | 'orders'>('invoices');
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    if (!open) return;
    const from = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    api<{ items: Inv[] }>('/invoices', { query: { from, pageSize: 50 } }).then(r => setInvoices(r.items), () => setInvoices([]));
    api<{ items: Order[] }>('/customer-orders', { query: { status: 'confirmed,partial', pageSize: 50 } }).then(r => setOrders(r.items), () => setOrders([]));
  }, [open]);
  return (
    <Modal open={open} wide title="Đơn hàng" onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <button type="button" className={tab === 'invoices' ? 'btn-primary' : 'btn'} onClick={() => setTab('invoices')}>Hóa đơn hôm nay</button>
        <button type="button" className={tab === 'orders' ? 'btn-primary' : 'btn'} onClick={() => setTab('orders')}>Đơn đặt hàng</button>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {(tab === 'invoices' ? invoices : orders).map(r => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="py-1.5 font-medium">{r.code}</td><td>{formatDateTime(r.createdAt)}</td><td>{r.customerName}</td><td className="num">{formatVnd(r.total)}</td>
              <td className="text-right">{tab === 'invoices'
                ? <button type="button" className="btn" onClick={() => onReprint(r.id)}>In lại</button>
                : <button type="button" className="btn-primary" onClick={() => { onLoadOrder(r.id); onClose(); }}>Lập hóa đơn</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
