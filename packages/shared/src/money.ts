const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatVnd(n: number): string {
  return fmt.format(Math.round(n || 0));
}

export function parseVnd(s: string): number {
  const cleaned = String(s ?? '').replace(/[,\s]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
