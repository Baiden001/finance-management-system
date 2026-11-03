import { supabaseServer } from '@/lib/supabase-server';
import ResourceManager from './ResourceManager';
import type { ResourceConfig } from './types';

/** Server component: fetches the first page of rows on the server so the table is meaningful before hydration. */
export default async function ResourcePage({ config }: { config: ResourceConfig }) {
  const sb = await supabaseServer();
  let q = sb.from(config.table).select(config.select ?? '*').order(config.order ?? 'created_at', { ascending: config.ascending ?? false }).limit(config.limit ?? 500);
  for (const [k, v] of Object.entries(config.filter ?? {})) q = q.eq(k, v);
  const { data, error } = await q;
  return (
    <>
      {error && <div className="alert err" role="alert">{error.message}</div>}
      <ResourceManager config={config} initialRows={(data ?? []) as unknown as Record<string, unknown>[]} />
    </>
  );
}
