// Minimalist line icons (24x24, 1.75 stroke, currentColor). Static, trusted markup rendered by components/Icons.tsx.
const c = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const r = (x: number, y: number, w: number, h: number, rx = 1.5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
const p = (d: string) => `<path d="${d}"/>`;

export const ICONS: Record<string, string> = {
  dot: c(12, 12, 2),
  dashboard: r(3, 3, 7, 9) + r(14, 3, 7, 5) + r(14, 12, 7, 9) + r(3, 16, 7, 5),
  transactions: p('M7 8h13M16 4l4 4-4 4M17 16H4M8 12l-4 4 4 4'),
  bank: p('M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18'),
  receivables: p('M12 3v12M7 10l5 5 5-5M4 17v3h16v-3'),
  payables: p('M12 15V3M7 8l5-5 5 5M4 17v3h16v-3'),
  projects: p('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  properties: p('M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10'),
  plans: r(3, 5, 18, 16, 2) + p('M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4'),
  rentals: c(8, 15, 4) + p('M11 12l9-9M16 7l3 3M14 9l2 2'),
  deposits: p('M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2M16 14.5h2'),
  commissions: p('M19 5L5 19') + c(7, 7, 2) + c(17, 17, 2),
  materials: p('M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8'),
  production: p('M2 21h20M4 21V11l5 3v-3l5 3V5h5v16'),
  products: p('M4 14h7v6H4zM13 14h7v6h-7zM8.5 8h7v6h-7z'),
  equipment: p('M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z'),
  delivery: p('M2 6h11v10H2zM13 9h4l4 4v3h-8') + c(6.5, 18.5, 1.5) + c(17.5, 18.5, 1.5),
  pricing: p('M3 12V4h8l10 10-8 8z') + c(7.5, 8.5, 1),
  recipes: p('M9 3h6M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4A1.5 1.5 0 0 0 20 19l-6-10V3M7.5 15h9'),
  stock: r(6, 4, 12, 17, 2) + p('M9 4h6v3H9zM9 14l2 2 4-4'),
  assets: r(5, 3, 14, 18, 1) + p('M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4'),
  budgets: p('M21 12A9 9 0 1 1 12 3M12 3v9h9'),
  payroll: c(9, 8, 3) + p('M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M18 20a6 6 0 0 0-3-5'),
  reports: p('M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3'),
  documents: p('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6'),
  audit: p('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4'),
  setup: p('M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2') + c(14, 6, 2) + c(8, 12, 2) + c(16, 18, 2),
  settings: c(12, 12, 3) + p('M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1'),
  switch: p('M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7'),
  logout: p('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'),
};

const TOP: Record<string, string> = { '/dashboard': 'dashboard', '/journals': 'transactions', '/bank': 'bank', '/receivables': 'receivables', '/payables': 'payables', '/assets': 'assets', '/budgets': 'budgets', '/payroll': 'payroll', '/reports': 'reports', '/documents': 'documents', '/audit': 'audit', '/setup': 'setup', '/settings': 'settings' };

/** Icon key for a navigation href (operations pages are keyed by their section name). */
export function iconKeyFor(href: string): string {
  if (TOP[href]) return TOP[href];
  const m = href.match(/^\/operations\/(\w+)/);
  return m && ICONS[m[1]] ? m[1] : 'dot';
}
