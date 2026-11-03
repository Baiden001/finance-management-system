import { ICONS } from '@/lib/icons';

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: ICONS[name] ?? ICONS.dot }} />;
}
