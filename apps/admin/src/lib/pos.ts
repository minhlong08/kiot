/** Hands a cart request to the POS app (read once on its next load) and opens it. */
export function openInPos(request: { type: 'copy'; invoiceId: number } | { type: 'order'; orderId: number }) {
  try { localStorage.setItem('pd.pos.load', JSON.stringify(request)); } catch { /* storage unavailable: POS opens empty */ }
  window.open('/sale/', '_blank');
}
