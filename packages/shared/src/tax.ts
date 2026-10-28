/** One VAT rate's share of VAT-inclusive amounts. */
export type VatRow = { rate: number; gross: number; net: number; vat: number };

/**
 * Retail prices include VAT, so tax is backed out per rate: vat = gross × r / (100 + r), rounded once per rate
 * (rounding each line would drift on large invoices). Negative amounts (returns) net off.
 */
export function vatBreakdown(lines: { amount: number; vatRate: number }[]): VatRow[] {
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + l.amount);
  return [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, gross]) => {
      const vat = Math.round((gross * rate) / (100 + rate));
      return { rate, gross, net: gross - vat, vat };
    });
}

/** Business-household (hộ kinh doanh) flat tax on revenue: VAT% and personal income tax% of revenue. */
export function householdTax(revenue: number, vatRate: number, pitRate: number) {
  const vat = Math.round((revenue * vatRate) / 100);
  const pit = Math.round((revenue * pitRate) / 100);
  return { revenue, vat, pit, total: vat + pit };
}
