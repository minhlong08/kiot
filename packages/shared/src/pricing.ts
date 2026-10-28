/** Moving weighted-average cost. Negative on-hand counts as zero so a receipt after overselling sets a sane cost. */
export function weightedAverageCost(onHand: number, cost: number, qtyIn: number, unitCost: number): number {
  if (qtyIn <= 0) return cost;
  const base = Math.max(onHand, 0);
  return Math.round((base * cost + qtyIn * unitCost) / (base + qtyIn));
}

export function roundMoney(n: number, roundTo: 0 | 100 | 1000 = 0): number {
  return roundTo ? Math.round(n / roundTo) * roundTo : Math.round(n);
}

export function applyPriceFormula(base: number, op: '+' | '-', value: number, unit: '%' | 'VND', roundTo: 0 | 100 | 1000 = 0): number {
  const delta = unit === '%' ? (base * value) / 100 : value;
  return Math.max(0, roundMoney(op === '+' ? base + delta : base - delta, roundTo));
}

export function variantCombos(attributes: { name: string; values: string[] }[]): string[][] {
  const attrs = attributes.filter(a => a.values.length);
  if (!attrs.length) return [];
  return attrs.reduce<string[][]>((acc, a) => acc.flatMap(prefix => a.values.map(v => [...prefix, v])), [[]]);
}
