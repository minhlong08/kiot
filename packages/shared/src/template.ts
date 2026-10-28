import { formatVnd } from './money';
import { formatDate, formatDateTime } from './dates';
import { amountInWords } from './words';

/**
 * Tiny print-template language (Mustache-like, no dependencies):
 * {{path}} escaped · {{{path}}} raw · {{money path}} {{date path}} {{day path}} {{words path}} · {{#list}}…{{/list}} loops
 * (or a truthy section), {{^x}}…{{/x}} when falsy, {{@index}} (1-based) inside loops. Missing values render empty.
 */
type Data = Record<string, unknown>;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const FORMATTERS: Record<string, (v: unknown) => string> = {
  money: v => formatVnd(Number(v) || 0),
  date: v => (v ? formatDateTime(String(v)) : ''),
  day: v => (v ? formatDate(String(v)) : ''),
  words: v => amountInWords(Number(v) || 0),
};

function lookup(stack: Data[], path: string): unknown {
  if (path === '.') return stack[0];
  const [head, ...rest] = path.split('.');
  const scope = stack.find(s => s && typeof s === 'object' && head in s);
  let v: unknown = scope?.[head];
  for (const k of rest) v = v && typeof v === 'object' ? (v as Data)[k] : undefined;
  return v;
}
const show = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function render(tpl: string, stack: Data[]): string {
  let out = '';
  let i = 0;
  while (i < tpl.length) {
    const open = tpl.indexOf('{{', i);
    if (open < 0) { out += tpl.slice(i); break; }
    out += tpl.slice(i, open);
    const triple = tpl.startsWith('{{{', open);
    const close = tpl.indexOf(triple ? '}}}' : '}}', open);
    if (close < 0) break;
    const tag = tpl.slice(open + (triple ? 3 : 2), close).trim();
    i = close + (triple ? 3 : 2);
    if (triple) { out += show(lookup(stack, tag)); continue; }
    const kind = tag[0];
    if (kind === '#' || kind === '^') {
      const name = tag.slice(1).trim();
      const end = findClose(tpl, i, name);
      if (end < 0) break; // unclosed section: drop the rest
      const inner = tpl.slice(i, end);
      i = end + `{{/${name}}}`.length;
      const v = lookup(stack, name);
      const truthy = Array.isArray(v) ? v.length > 0 : !!v;
      if (kind === '^') { if (!truthy) out += render(inner, stack); continue; }
      if (Array.isArray(v)) v.forEach((item, k) => { out += render(inner, [{ '@index': k + 1 }, ...(item && typeof item === 'object' ? [item as Data] : [{ '.': item }]), ...stack]); });
      else if (truthy) out += render(inner, [...(typeof v === 'object' ? [v as Data] : []), ...stack]);
      continue;
    }
    if (kind === '/') continue;
    const [fn, arg] = tag.split(/\s+/);
    out += arg && FORMATTERS[fn] ? esc(FORMATTERS[fn](lookup(stack, arg))) : esc(show(lookup(stack, tag)));
  }
  return out;
}
/** Position of the matching {{/name}} after `from`, honouring nested sections of the same name. */
function findClose(tpl: string, from: number, name: string): number {
  let depth = 1;
  const re = new RegExp(`\\{\\{\\s*([#^/])\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g');
  re.lastIndex = from;
  for (let m = re.exec(tpl); m; m = re.exec(tpl)) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return -1;
}

export function renderTemplate(body: string, data: Data): string {
  try { return render(body, [data]); } catch { return ''; }
}
