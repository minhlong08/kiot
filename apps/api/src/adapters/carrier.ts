/** Partner fee settings a carrier adapter quotes from. */
export type CarrierPartner = { id: number; code: string; feeMode: string; flatFee: number; feePerKg: number };
export type ShipmentInput = { invoiceCode: string; receiverName: string; receiverPhone: string; address: string; province: string; cod: number; weight: number };

/** A pluggable carrier (shipping company) integration. Register a real one per partner code in `adapters` below. */
export interface CarrierAdapter {
  readonly name: string;
  /** Shipping fee for a parcel; weight in grams. */
  quote(partner: CarrierPartner, input: { weight: number }): Promise<{ fee: number }>;
  /** Books the pickup; returns the carrier's tracking code. */
  createShipment(partner: CarrierPartner, input: ShipmentInput): Promise<{ trackingCode: string }>;
}

/** No external calls: fee from the partner's own settings, tracking code = invoice code. Statuses are updated by hand. */
export class ManualCarrier implements CarrierAdapter {
  readonly name = 'manual';
  async quote(p: CarrierPartner, { weight }: { weight: number }) {
    if (p.feeMode !== 'byWeight') return { fee: p.flatFee };
    return { fee: p.flatFee + Math.ceil(Math.max(0, weight) / 1000) * p.feePerKg };
  }
  async createShipment(_p: CarrierPartner, input: ShipmentInput) {
    return { trackingCode: input.invoiceCode };
  }
}

const manual = new ManualCarrier();
const adapters: Record<string, CarrierAdapter> = {};

export function getCarrierAdapter(partnerCode: string): CarrierAdapter {
  return adapters[partnerCode] ?? manual;
}

export function registerCarrierAdapter(partnerCode: string, adapter: CarrierAdapter) {
  adapters[partnerCode] = adapter;
}
