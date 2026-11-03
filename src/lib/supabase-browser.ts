import { createBrowserClient } from '@supabase/ssr';

// Anon key + the user's own session only. The service-role key is never referenced in application code.
export function supabaseBrowser() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
