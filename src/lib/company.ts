export type CompanyCode = 'resilience' | 'ashelite';

export interface Brand {
  code: CompanyCode;
  legalName: string;
  shortName: string;
  tagline: string;
  loginSubtitle: string;
  logo: string;
  logoSize: { w: number; h: number };
  loginBg: { src: string; w: number; h: number; position: string };
  colors: { brand: string; brandDark: string; accent: string; ink: string; bg: string; surface: string };
  pdf: { brand: string; accent: string };
  nav: { href: string; label: string }[];
}

const common = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/journals', label: 'Transactions' },
  { href: '/bank', label: 'Bank & Cash' },
  { href: '/receivables', label: 'Receivables' },
  { href: '/payables', label: 'Payables' },
];
const tail = [
  { href: '/assets', label: 'Fixed Assets' },
  { href: '/budgets', label: 'Budgets' },
  { href: '/payroll', label: 'Payroll' },
  { href: '/reports', label: 'Reports' },
  { href: '/documents', label: 'Documents' },
  { href: '/audit', label: 'Audit Log' },
  { href: '/setup', label: 'Setup' },
  { href: '/settings', label: 'Settings' },
];

export const BRANDS: Record<CompanyCode, Brand> = {
  resilience: {
    code: 'resilience',
    legalName: 'Resilience Estate Ltd',
    shortName: 'Resilience Estate',
    tagline: 'Real Estate',
    loginSubtitle: 'Financial clarity for sustainable growth.',
    logo: '/brand/resilience-logo.png',
    logoSize: { w: 292, h: 202 },
    loginBg: { src: '/brand/login-resilience.webp', w: 896, h: 1280, position: '50% 60%' },
    colors: { brand: '#0F3D2E', brandDark: '#0A2A20', accent: '#B8913F', ink: '#18211d', bg: '#f3f4ef', surface: '#ffffff' },
    pdf: { brand: '#0F3D2E', accent: '#B8913F' },
    nav: [...common, { href: '/operations/projects', label: 'Projects' }, { href: '/operations/properties', label: 'Properties & Sales' }, { href: '/operations/rentals', label: 'Rentals' }, { href: '/operations/plans', label: 'Payment Plans' }, { href: '/operations/deposits', label: 'Deposits' }, { href: '/operations/commissions', label: 'Commissions' }, ...tail],
  },
  ashelite: {
    code: 'ashelite',
    legalName: 'Ash Elite Enterprise',
    shortName: 'Ash Elite',
    tagline: 'Block Factory',
    loginSubtitle: 'Accurate records. Better decisions.',
    logo: '/brand/ashelite-logo.png',
    logoSize: { w: 700, h: 787 },
    loginBg: { src: '/brand/login-ashelite.webp', w: 1199, h: 900, position: '30% 55%' },
    colors: { brand: '#6B0F2A', brandDark: '#4A0A1D', accent: '#C2994A', ink: '#252224', bg: '#f5f3f3', surface: '#ffffff' },
    pdf: { brand: '#6B0F2A', accent: '#C2994A' },
    nav: [...common, { href: '/operations/materials', label: 'Raw Materials' }, { href: '/operations/production', label: 'Production' }, { href: '/operations/products', label: 'Finished Blocks' }, { href: '/operations/equipment', label: 'Equipment' }, { href: '/operations/delivery', label: 'Delivery Notes' }, { href: '/operations/pricing', label: 'Pricing' }, { href: '/operations/recipes', label: 'Recipes' }, { href: '/operations/stock', label: 'Stock Counts' }, ...tail],
  },
};

export function companyCode(): CompanyCode {
  const c = process.env.NEXT_PUBLIC_COMPANY;
  if (c !== 'resilience' && c !== 'ashelite') {
    throw new Error('NEXT_PUBLIC_COMPANY must be "resilience" or "ashelite". Each deployment serves exactly one company.');
  }
  return c;
}
export const brand = (): Brand => BRANDS[companyCode()];
export const otherBrand = (): Brand => BRANDS[companyCode() === 'resilience' ? 'ashelite' : 'resilience'];
/** Address of the OTHER company's own deployment (optional, build-time). Only a link: nothing is shared between the two. */
export function otherCompanyUrl(): string | null {
  const u = process.env.NEXT_PUBLIC_OTHER_COMPANY_URL;
  return u && /^https?:\/\//.test(u) ? u.replace(/\/+$/, '') : null;
}
