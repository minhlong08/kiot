import { useFunds } from '../lib/cash';

export function FundSelect({ value, onChange, id = 'fund' }: { value: number | null; onChange: (v: number | null) => void; id?: string }) {
  const funds = useFunds();
  return (
    <select id={id} className="input" aria-label="Quỹ tiền" value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Tiền mặt (mặc định)</option>
      {funds.data?.map(f => <option key={f.id} value={f.id}>{f.name}{f.accountNumber ? ` - ${f.accountNumber}` : ''}</option>)}
    </select>
  );
}
