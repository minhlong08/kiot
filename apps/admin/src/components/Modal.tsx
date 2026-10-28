import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

type Props = { title: ReactNode; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' };

export function Modal({ title, open, onClose, children, footer, size = 'md' }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}
        className={clsx('card flex max-h-full w-full flex-col', { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }[size])}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Two-step confirmation inside the page (no browser dialogs). */
export function ConfirmModal({ open, title, message, onConfirm, onClose, danger, confirmLabel = 'Đồng ý' }: {
  open: boolean; title: string; message: ReactNode; onConfirm: () => void; onClose: () => void; danger?: boolean; confirmLabel?: string;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose} size="sm"
      footer={<><button type="button" className="btn" onClick={onClose}>Bỏ qua</button><button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button></>}>
      <div className="text-sm">{message}</div>
    </Modal>
  );
}
