import { Trash2 } from 'lucide-react';
import { formatVnd, parseVnd } from '@pd/shared';
import { ProductPicker, type LookupRow } from './ProductPicker';

export type DocLine = { productId: number; unitId?: number | null; code: string; name: string; unit: string; conversion?: number } & Record<string, unknown>;

export type LineColumn = {
  key: string;
  header: string;
  /** qty/money are editable integers; readonly shows a number; text is an editable string. */
  kind: 'qty' | 'money' | 'readonly' | 'readonlyMoney' | 'text';
  value?: (line: DocLine) => number | string;
  disabled?: (line: DocLine) => boolean;
  className?: string;
};

type Props = {
  lines: DocLine[];
  onChange: (lines: DocLine[]) => void;
  columns: LineColumn[];
  /** Key incremented when the same product is scanned again. */
  qtyKey: string;
  /** Extra fields for a new line from the picked product. */
  newLine: (row: LookupRow) => Record<string, unknown>;
  readOnly?: boolean;
  pos?: boolean;
  allowUnits?: boolean;
  emptyHint?: React.ReactNode;
};

/** Lines table for stock / purchase documents with a scanner-friendly picker. */
export function DocumentLinesEditor({ lines, onChange, columns, qtyKey, newLine, readOnly, pos, allowUnits, emptyHint }: Props) {
  const key = (l: { productId: number; unitId?: number | null }) => `${l.productId}:${l.unitId ?? 0}`;
  function add(r: LookupRow) {
    const k = key(r);
    const found = lines.find(l => key(l) === k);
    if (found) onChange(lines.map(l => (key(l) === k ? { ...l, [qtyKey]: Number(l[qtyKey] ?? 0) + 1 } : l)));
    else onChange([...lines, { productId: r.productId, unitId: r.unitId, code: r.code, name: r.name, unit: r.unitName, conversion: r.conversion, ...newLine(r) }]);
  }
  const set = (i: number, k: string, v: unknown) => onChange(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  return (
    <div className="flex h-full flex-col">
      {!readOnly && <div className="p-3"><ProductPicker hotkey pos={pos} onPick={add} exclude={allowUnits ? undefined : r => r.unitId !== null || r.type === 'service' || r.type === 'combo'} /></div>}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-brand-50 text-slate-700">
            <tr>
              {!readOnly && <th className="w-8" />}
              <th className="w-10 px-2 py-2 text-left">STT</th><th className="px-2 py-2 text-left">Mã hàng</th><th className="px-2 py-2 text-left">Tên hàng</th><th className="px-2 py-2 text-left">ĐVT</th>
              {columns.map(c => <th key={c.key} className={`px-2 py-2 ${c.kind === 'text' ? 'text-left' : 'text-right'}`}>{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={key(l)} className="border-b border-slate-100 bg-white">
                {!readOnly && <td className="text-center"><button type="button" className="btn-ghost px-1" aria-label={`Xóa ${l.code}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>}
                <td className="px-2 py-1.5">{i + 1}</td>
                <td className="px-2 py-1.5">{l.code}</td>
                <td className="px-2 py-1.5">{l.name}</td>
                <td className="px-2 py-1.5">{l.unit}</td>
                {columns.map(c => {
                  const raw = c.value ? c.value(l) : l[c.key];
                  if (readOnly || c.kind === 'readonly' || c.kind === 'readonlyMoney' || c.disabled?.(l)) {
                    return <td key={c.key} className={`num px-2 py-1.5 ${c.className ?? ''}`}>{typeof raw === 'number' ? formatVnd(raw) : String(raw ?? '')}</td>;
                  }
                  if (c.kind === 'text') {
                    return <td key={c.key} className="px-2 py-1"><input className="input" value={String(raw ?? '')} onChange={e => set(i, c.key, e.target.value)} aria-label={`${c.header} ${l.code}`} /></td>;
                  }
                  return (
                    <td key={c.key} className="w-32 px-2 py-1">
                      <input className="input text-right tabular-nums" inputMode="numeric" aria-label={`${c.header} ${l.code}`}
                        value={formatVnd(Number(raw ?? 0))} onFocus={e => e.target.select()}
                        onChange={e => set(i, c.key, Math.max(0, parseVnd(e.target.value)))} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!lines.length && <div className="p-10 text-center text-slate-400">{emptyHint ?? 'Chưa có hàng hóa. Tìm hoặc quét mã vạch để thêm.'}</div>}
      </div>
    </div>
  );
}
