import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { brand } from '@/lib/company';

export function generateMetadata(): Metadata {
  const b = brand();
return {
  title: {
    default: `${b.shortName} Finance`,
    template: `%s | ${b.shortName} Finance`,
  },
  description: `${b.legalName} finance management system`,
  robots: { index: false, follow: false },
  icons: {
    icon: `/brand/favicons/${b.code}-icon.png`,
    shortcut: `/brand/favicons/${b.code}-icon.png`,
    apple: `/brand/favicons/${b.code}-icon.png`,
  },
};
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const b = brand(); const c = b.colors;
  const vars = `:root{--brand:${c.brand};--brand-dark:${c.brandDark};--accent:${c.accent};--ink:${c.ink};--bg:${c.bg};--surface:${c.surface}}`;
  return (
    <html lang="en" data-company={b.code}>
      <head><style dangerouslySetInnerHTML={{ __html: vars }} /></head>
      <body>{children}</body>
    </html>
  );
}
