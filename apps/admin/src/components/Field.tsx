import type { ReactNode } from 'react';
import { formatVnd, parseVnd } from '@pd/shared';

export function Field({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/** Integer VND input that shows thousands separators while typing. */
export function MoneyInput({ value, onChange, className, ...rest }: { value: number; onChange: (v: number) => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <input {...rest} inputMode="numeric" className={`input text-right tabular-nums ${className ?? ''}`} value={value ? formatVnd(value) : value === 0 ? '0' : ''}
      onChange={e => onChange(parseVnd(e.target.value))} onFocus={e => e.target.select()} />
  );
}

export function NumberInput({ value, onChange, className, ...rest }: { value: number; onChange: (v: number) => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <input {...rest} inputMode="decimal" className={`input text-right tabular-nums ${className ?? ''}`} value={Number.isFinite(value) ? String(value) : ''}
      onChange={e => { const n = Number(e.target.value.replace(',', '.')); onChange(Number.isFinite(n) ? n : 0); }} onFocus={e => e.target.select()} />
  );
}
