export function money(v: unknown, currency = 'GHS'): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '';
  return `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function num(v: unknown, dp = 2): string {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toLocaleString('en-GH', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '';
}
export const isoDate = (d = new Date()): string => d.toISOString().slice(0, 10);
export const monthEnd = (y: number, m: number): string => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
export const yearStart = (d = new Date()): string => `${d.getUTCFullYear()}-01-01`;
export const yearEnd = (d = new Date()): string => `${d.getUTCFullYear()}-12-31`;
/** Neutralise spreadsheet formula injection in exported text cells. */
export function safeCell(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}
