import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { formatVnd, parseVnd } from '@pd/shared';

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()} className={`flex max-h-full w-full flex-col rounded-lg bg-white shadow-xl ${wide ? 'max-w-4xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" aria-label="Đóng" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function MoneyField({ value, onChange, className, ...rest }: { value: number; onChange: (v: number) => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input {...rest} inputMode="numeric" className={`input text-right tabular-nums ${className ?? ''}`} value={formatVnd(value)} onFocus={e => e.target.select()} onChange={e => onChange(Math.max(0, parseVnd(e.target.value)))} />;
}

export function Row({ label, children, strong, testId }: { label: ReactNode; children: ReactNode; strong?: boolean; testId?: string }) {
  return <div className={`flex items-center justify-between gap-2 py-1 ${strong ? 'text-base font-semibold' : 'text-sm'}`}><span>{label}</span><span data-testid={testId} className="tabular-nums">{children}</span></div>;
}
