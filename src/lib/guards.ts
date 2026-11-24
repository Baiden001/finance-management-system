import type { SupabaseClient } from '@supabase/supabase-js';
import { asRole, type Role } from './roles';

const buckets = new Map<string, number[]>();
/** Small in-memory limiter (per server instance). Supabase Auth has its own server-side limits for sign-in. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now(); const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return false; }
  hits.push(now); buckets.set(key, hits); return true;
}

export async function mfaSatisfied(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.REQUIRE_MFA !== 'true') return true;
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === 'aal2';
}

/** Throws unless the signed-in user is an active accountant of THIS company database. */
export async function requireAccountant(supabase: SupabaseClient): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Response('Unauthorized', { status: 401 });
  const { data } = await supabase.rpc('is_accountant');
  if (data !== true) throw new Response('Forbidden', { status: 403 });
  return user.id;
}

/** Throws unless the signed-in user holds one of the given roles in THIS company database. */
export async function requireRole(supabase: SupabaseClient, allowed: Role[]): Promise<{ uid: string; role: Role }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Response('Unauthorized', { status: 401 });
  const { data } = await supabase.rpc('app_role');
  const role = asRole(data);
  if (!role || !allowed.includes(role)) throw new Response('Forbidden', { status: 403 });
  return { uid: user.id, role };
}
