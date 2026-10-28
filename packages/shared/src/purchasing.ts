export type CostLine = { qty: number; conversion: number; unitCost: number; discount: number };

/** Splits `total` across weights proportionally; the last line takes the rounding remainder so shares sum exactly. */
function split(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wsum = sum > 0 ? sum : w.length;
  let given = 0;
  return w.map((x, i) => {
    if (i === w.length - 1) return total - given;
    const share = Math.round((total * x) / wsum);
    given += share;
    return share;
  });
}

/** Line amounts and the allocated cost per base unit after order discount and other costs. */
export function allocateReceiptCosts(lines: CostLine[], orderDiscount: number, otherCosts: number): { amount: number; baseCost: number }[] {
  const amounts = lines.map(l => l.qty * l.unitCost - l.discount);
  const disc = split(orderDiscount, amounts);
  const other = split(otherCosts, amounts);
  return lines.map((l, i) => {
    const baseQty = l.qty * l.conversion;
    return { amount: amounts[i], baseCost: baseQty > 0 ? Math.max(0, Math.round((amounts[i] - disc[i] + other[i]) / baseQty)) : 0 };
  });
}

export function receiptTotals(lines: CostLine[], discount: number, otherCosts: number) {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitCost - l.discount, 0);
  return { subtotal, total: Math.max(0, subtotal - discount + otherCosts) };
}
