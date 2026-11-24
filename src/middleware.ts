import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { ceoMayOpen } from '@/lib/roles';

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

const PUBLIC = ['/login', '/forgot-password', '/reset-password', '/auth/callback', '/api/health'];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: CookieToSet[]) => { list.forEach(({ name, value }) => req.cookies.set(name, value)); res = NextResponse.next({ request: req }); list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  if (!user && !PUBLIC.includes(path)) { const u = req.nextUrl.clone(); u.pathname = '/login'; return NextResponse.redirect(u); }
  if (user && path === '/login') { const u = req.nextUrl.clone(); u.pathname = '/dashboard'; return NextResponse.redirect(u); }
  if (user && process.env.REQUIRE_MFA === 'true' && !PUBLIC.includes(path) && path !== '/security/mfa' && path !== '/logout') {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== 'aal2') { const u = req.nextUrl.clone(); u.pathname = '/security/mfa'; return NextResponse.redirect(u); }
  }
  // The CEO is view-only: keep them on the dashboard and reports. The database enforces the same limits via RLS.
  if (user && !PUBLIC.includes(path) && path !== '/security/mfa' && path !== '/logout' && path !== '/' && !ceoMayOpen(path)) {
    const { data: role } = await supabase.rpc('app_role');
    if (role === 'ceo') {
      if (path.startsWith('/api/')) return new NextResponse('Forbidden', { status: 403 });
      const u = req.nextUrl.clone(); u.pathname = '/dashboard'; u.search = ''; return NextResponse.redirect(u);
    }
  }
  return res;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/).*)'] };
