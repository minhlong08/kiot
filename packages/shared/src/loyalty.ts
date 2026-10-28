export type PointsLine = { amount: number; loyaltyEnabled: boolean; fixedPoints?: number | null; qty: number };

/**
 * Points earned on the amount actually paid: the invoice discount and the part paid with points are spread
 * over all lines by value, and only loyalty-eligible lines earn. Lines with fixed points earn points × qty.
 */
export function pointsEarned(lines: PointsLine[], invoiceDiscount: number, pointsPaid: number, vndPerPoint: number): number {
  if (vndPerPoint <= 0) return 0;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const rateLines = lines.filter(l => l.loyaltyEnabled && (l.fixedPoints === null || l.fixedPoints === undefined));
  const eligible = rateLines.reduce((s, l) => s + l.amount, 0);
  const share = total > 0 ? ((invoiceDiscount + pointsPaid) * eligible) / total : 0;
  const fixed = lines.filter(l => l.loyaltyEnabled && l.fixedPoints != null).reduce((s, l) => s + (l.fixedPoints ?? 0) * l.qty, 0);
  return Math.max(0, Math.floor(Math.max(0, eligible - share) / vndPerPoint)) + fixed;
}
