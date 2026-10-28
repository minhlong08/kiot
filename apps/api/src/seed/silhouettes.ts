/** Simple generated product silhouettes (no stock photos). Each returns an SVG document. */
const wrap = (bg: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="16" fill="${bg}"/>${body}</svg>`;

const SHAPES: Record<string, (c: string) => string> = {
  vest: c => `<path d="M70 40 L100 60 L130 40 L160 60 L150 170 L50 170 L40 60 Z" fill="${c}"/><path d="M100 60 L85 120 L100 170 L115 120 Z" fill="#fff" opacity=".85"/><circle cx="100" cy="135" r="4" fill="#333"/>`,
  shirt: c => `<path d="M65 40 L100 55 L135 40 L170 70 L150 90 L140 80 L140 170 L60 170 L60 80 L50 90 L30 70 Z" fill="${c}"/><path d="M88 45 L100 62 L112 45" stroke="#fff" stroke-width="5" fill="none"/>`,
  trousers: c => `<path d="M60 30 L140 30 L150 175 L110 175 L100 80 L90 175 L50 175 Z" fill="${c}"/><rect x="60" y="30" width="80" height="12" fill="#000" opacity=".2"/>`,
  tie: c => `<path d="M88 30 L112 30 L106 50 L120 150 L100 175 L80 150 L94 50 Z" fill="${c}"/><path d="M94 50 L106 50" stroke="#000" opacity=".25" stroke-width="3"/>`,
  belt: c => `<rect x="20" y="85" width="160" height="30" rx="6" fill="${c}"/><rect x="120" y="78" width="36" height="44" rx="4" fill="none" stroke="#d4a017" stroke-width="7"/>`,
  shoe: c => `<path d="M30 130 Q35 90 70 95 L110 110 Q150 115 170 135 L170 150 L30 150 Z" fill="${c}"/><rect x="30" y="148" width="140" height="10" rx="4" fill="#333"/>`,
  bag: c => `<path d="M70 75 Q70 40 100 40 Q130 40 130 75" stroke="${c}" stroke-width="8" fill="none"/><rect x="45" y="75" width="110" height="95" rx="10" fill="${c}"/><rect x="92" y="95" width="16" height="10" rx="2" fill="#d4a017"/>`,
  wallet: c => `<rect x="40" y="60" width="120" height="85" rx="10" fill="${c}"/><rect x="110" y="88" width="50" height="28" rx="6" fill="#000" opacity=".2"/><circle cx="125" cy="102" r="4" fill="#d4a017"/>`,
};

export const COLORS: Record<string, string> = {
  'xám': '#6b7280', 'đen': '#1f2937', 'xanh dương': '#1d4ed8', 'xanh lá': '#15803d', 'xanh nhạt': '#7dd3fc', 'hồng': '#f472b6', 'nâu': '#92400e',
  'trắng': '#e5e7eb', 'kem': '#f5e6c8', 'vàng': '#eab308', 'tím': '#7c3aed', 'đỏ': '#b91c1c', 'be': '#d6c3a5', 'xanh than': '#1e3a5f',
};

export function silhouette(kind: keyof typeof SHAPES, color: string) {
  return wrap('#f1f5f9', SHAPES[kind](color));
}
export type SilhouetteKind = keyof typeof SHAPES;
