type Option = { value: string; label: string };

export function CheckboxFilter({ options, value, onChange }: { options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <>
      {options.map(o => (
        <label key={o.value} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(o.value)}
            onChange={() => onChange(value.includes(o.value) ? value.filter(v => v !== o.value) : [...value, o.value])} />
          {o.label}
        </label>
      ))}
    </>
  );
}

export function RadioFilter({ options, value, onChange }: { options: Option[]; value: string; onChange: (v: string) => void }) {
  return (
    <>
      {options.map(o => (
        <label key={o.value} className="flex items-center gap-2 text-sm">
          <input type="radio" checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </>
  );
}
