import type { ReportDef } from './reports';

export type Role = 'accountant' | 'ceo';

export const ROLE_LABEL: Record<Role, string> = { accountant: 'Accountant', ceo: 'CEO (view only)' };

/** Pages a CEO may open. Everything else in the app is accountant-only. */
export const CEO_PAGES = ['/dashboard', '/reports'];
/** API routes a CEO may call (exports are further limited to CEO reports in the route itself). */
export const CEO_APIS = ['/api/export'];
/** Reports that stay accountant-only besides every restricted (payroll) report. */
const ACCOUNTANT_ONLY_REPORTS = new Set(['bank_reconciliation']);

const under = (path: string, base: string) => path === base || path.startsWith(base + '/');

export function ceoMayOpen(path: string): boolean {
  return [...CEO_PAGES, ...CEO_APIS].some((b) => under(path, b));
}

export function navFor<T extends { href: string }>(role: Role, nav: T[]): T[] {
  return role === 'ceo' ? nav.filter((n) => CEO_PAGES.some((b) => under(n.href, b))) : nav;
}

export function reportAllowed(role: Role, def: Pick<ReportDef, 'key' | 'sensitive'>): boolean {
  return role === 'accountant' || (!def.sensitive && !ACCOUNTANT_ONLY_REPORTS.has(def.key));
}

export const asRole = (v: unknown): Role | null => (v === 'accountant' || v === 'ceo' ? v : null);
