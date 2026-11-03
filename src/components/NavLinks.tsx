'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icons';
import { iconKeyFor } from '@/lib/icons';

export default function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <ul>
      {items.map((i) => (
        <li key={i.href}><Link href={i.href} aria-current={path === i.href || path.startsWith(i.href + '/') ? 'page' : undefined}><Icon name={iconKeyFor(i.href)} /><span>{i.label}</span></Link></li>
      ))}
    </ul>
  );
}
