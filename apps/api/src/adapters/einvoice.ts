export type EInvoiceDraft = { series: string; buyerName: string; buyerTaxCode: string; total: number; vatAmount: number; invoiceCode: string };

/** A pluggable e-invoice provider (hóa đơn điện tử). Register a real one with `registerEInvoiceProvider`. */
export interface EInvoiceProvider {
  readonly name: string;
  /** `sequence` is the next local number for the series; real providers may return their own. */
  issue(draft: EInvoiceDraft, sequence: number): Promise<{ number: string; lookupCode: string }>;
  cancel(ref: { series: string; number: string }, reason: string): Promise<void>;
}

/** Issues locally numbered invoices with a random lookup code; nothing is sent to the tax authority. */
export class StubEInvoiceProvider implements EInvoiceProvider {
  readonly name = 'stub';
  async issue(_d: EInvoiceDraft, sequence: number) {
    return { number: String(sequence).padStart(7, '0'), lookupCode: Math.random().toString(36).slice(2, 10).toUpperCase() };
  }
  async cancel() { /* nothing to notify */ }
}

let provider: EInvoiceProvider = new StubEInvoiceProvider();
export const getEInvoiceProvider = () => provider;
export function registerEInvoiceProvider(p: EInvoiceProvider) { provider = p; }
