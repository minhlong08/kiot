import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { ProductPicker } from '../../components/docs/ProductPicker';

/** Pick several products; shows code + name chips. */
export function ProductChips({ value, onChange, placeholder }: { value: number[]; onChange: (ids: number[]) => void; placeholder: string }) {
  const [names, setNames] = useState<Record<number, string>>({});
  useEffect(() => {
    const missing = value.filter(id => !names[id]);
    if (!missing.length) return;
    Promise.all(missing.map(id => api<{ id: number; code: string; name: string }>(`/products/${id}`).catch(() => null)))
      .then(ps => setNames(n => ({ ...n, ...Object.fromEntries(ps.filter(Boolean).map(p => [p!.id, `${p!.code} - ${p!.name}`])) })));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-1.5">
      <ProductPicker placeholder={placeholder} exclude={r => r.unitId !== null || value.includes(r.productId)}
        onPick={r => { setNames(n => ({ ...n, [r.productId]: `${r.code} - ${r.name}` })); onChange([...value, r.productId]); }} />
      <div className="flex flex-wrap gap-1">
        {value.map(id => (
          <span key={id} className="flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-800">
            {names[id] ?? `#${id}`}<button type="button" aria-label="Bỏ" onClick={() => onChange(value.filter(x => x !== id))}><X size={12} /></button>
          </span>
        ))}
      </div>
    </div>
  );
}
