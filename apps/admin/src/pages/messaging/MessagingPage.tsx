import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Plus } from 'lucide-react';
import { formatDateTime } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { DataTable, Pagination, type Column } from '../../components/list';
import { useCustomerGroups } from '../customers/CustomerForm';

type Template = { id: number; name: string; channel: 'sms' | 'zalo' | 'email'; body: string };
type Log = { id: number; createdAt: string; customerName: string; phone: string; channel: string; body: string; status: string; provider: string };
const PLACEHOLDERS = ['{TenKhachHang}', '{MaKhachHang}', '{DiemHienTai}', '{CongNo}', '{TenCuaHang}'];
const CHANNELS = { sms: 'SMS', zalo: 'Zalo', email: 'Email' } as const;

export function MessagingPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const groups = useCustomerGroups();
  const templates = useQuery({ queryKey: ['message-templates'], queryFn: () => api<Template[]>('/message-templates') });
  const [page, setPage] = useState({ page: 1, pageSize: 15 });
  const logs = useQuery({ queryKey: ['messages', page], queryFn: () => api<{ items: Log[]; total: number }>('/messages', { query: page }) });
  const [tpl, setTpl] = useState<Partial<Template> | null>(null);
  const [send, setSend] = useState<{ templateId: number; channel: Template['channel']; groupIds: number[]; search: string } | null>(null);
  const [confirm, setConfirm] = useState<{ recipients: number; skipped: number } | null>(null);
  const sendBody = () => ({ templateId: send!.templateId, channel: send!.channel, filter: { groupIds: send!.groupIds.join(','), search: send!.search, status: 'active' } });
  const run = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['message-templates'] }); qc.invalidateQueries({ queryKey: ['messages'] }); const s = r as { sent?: number; skipped?: number }; toast(s?.sent !== undefined ? `Đã gửi ${s.sent} tin, bỏ qua ${s.skipped}` : 'Đã lưu'); },
    onError: toastError,
  });
  const columns: Column<Log>[] = [
    { key: 'createdAt', header: 'Thời gian', render: l => formatDateTime(l.createdAt) }, { key: 'customerName', header: 'Khách hàng' }, { key: 'phone', header: 'Gửi tới' },
    { key: 'channel', header: 'Kênh', render: l => CHANNELS[l.channel as keyof typeof CHANNELS] ?? l.channel }, { key: 'body', header: 'Nội dung' },
    { key: 'status', header: 'Trạng thái', render: l => (l.status === 'sent' ? 'Đã gửi' : 'Lỗi') },
  ];
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Kênh tiếp cận khách hàng</h1>
      <div className="flex items-center gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900"><Info size={16} />Đang dùng nhà cung cấp mô phỏng — tin nhắn được ghi nhận nhưng không thực sự được gửi. Xem README để kết nối nhà cung cấp SMS/Zalo thật.</div>
      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Mẫu tin nhắn</h2>{can('customers.edit') && <button type="button" className="btn" onClick={() => setTpl({ channel: 'sms', body: '' })}><Plus size={14} />Thêm mẫu</button>}</div>
        <div className="grid gap-2 md:grid-cols-2">
          {templates.data?.map(t => (
            <div key={t.id} className="rounded border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between"><b>{t.name}</b><span className="text-xs text-slate-500">{CHANNELS[t.channel]}</span></div>
              <p className="my-2 text-slate-600">{t.body}</p>
              <div className="flex justify-end gap-2">
                {can('customers.edit') && <button type="button" className="btn" onClick={() => setTpl(t)}>Sửa</button>}
                {can('customers.message') && <button type="button" className="btn-primary" onClick={() => setSend({ templateId: t.id, channel: t.channel, groupIds: [], search: '' })}>Gửi tin</button>}
              </div>
            </div>
          ))}
          {templates.data && !templates.data.length && <p className="text-sm text-slate-400">Chưa có mẫu tin nhắn.</p>}
        </div>
      </section>
      <section className="card overflow-hidden">
        <h2 className="p-4 pb-2 font-semibold">Lịch sử gửi tin</h2>
        <DataTable tableId="messages" columns={columns} rows={logs.data?.items ?? []} getRowId={l => l.id} loading={logs.isLoading} />
        <Pagination page={page.page} pageSize={page.pageSize} total={logs.data?.total ?? 0} noun="tin" onChange={(p, s) => setPage({ page: p, pageSize: s })} />
      </section>
      <Modal open={!!tpl} title={tpl?.id ? 'Sửa mẫu tin nhắn' : 'Thêm mẫu tin nhắn'} onClose={() => setTpl(null)}
        footer={<button type="button" className="btn-primary" disabled={!tpl?.name || !tpl?.body} onClick={() => { const { id, ...body } = tpl!; setTpl(null); run.mutate(() => api(id ? `/message-templates/${id}` : '/message-templates', { method: id ? 'PUT' : 'POST', body })); }}>Lưu</button>}>
        {tpl && (
          <div className="space-y-3">
            <Field label="Tên mẫu"><input className="input" value={tpl.name ?? ''} onChange={e => setTpl({ ...tpl, name: e.target.value })} /></Field>
            <Field label="Kênh"><select className="input" value={tpl.channel} onChange={e => setTpl({ ...tpl, channel: e.target.value as Template['channel'] })}>{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Nội dung"><textarea className="input" rows={4} value={tpl.body ?? ''} onChange={e => setTpl({ ...tpl, body: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-1">{PLACEHOLDERS.map(p => <button key={p} type="button" className="rounded bg-slate-100 px-2 py-0.5 text-xs hover:bg-brand-50" onClick={() => setTpl({ ...tpl, body: `${tpl.body ?? ''}${p}` })}>{p}</button>)}</div>
          </div>
        )}
      </Modal>
      <Modal open={!!send} size="sm" title="Gửi tin nhắn" onClose={() => setSend(null)}
        footer={confirm
          ? <><span className="mr-auto text-sm">Gửi tới <b>{confirm.recipients}</b> khách hàng{confirm.skipped ? `, bỏ qua ${confirm.skipped} khách không có số` : ''}?</span><button type="button" className="btn" onClick={() => setConfirm(null)}>Quay lại</button><button type="button" className="btn-primary" disabled={!confirm.recipients} onClick={() => { const body = sendBody(); setSend(null); setConfirm(null); run.mutate(() => api('/messages/send', { body })); }}>Xác nhận gửi</button></>
          : <button type="button" className="btn-primary" onClick={() => api<{ recipients: number; skipped: number }>('/messages/send', { body: { ...sendBody(), dryRun: true } }).then(setConfirm, toastError)}>Tiếp tục</button>}>
        {send && (
          <div className="space-y-3 text-sm">
            <p>Gửi tới khách hàng đang hoạt động theo điều kiện:</p>
            <div><span className="label">Nhóm khách hàng (không chọn: tất cả)</span>{groups.data?.map(g => <label key={g.id} className="flex items-center gap-2"><input type="checkbox" checked={send.groupIds.includes(g.id)} onChange={() => setSend({ ...send, groupIds: send.groupIds.includes(g.id) ? send.groupIds.filter(x => x !== g.id) : [...send.groupIds, g.id] })} />{g.name}</label>)}</div>
            <Field label="Tìm theo tên / số điện thoại"><input className="input" value={send.search} onChange={e => setSend({ ...send, search: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
