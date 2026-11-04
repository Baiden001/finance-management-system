import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

const PUBLIC = ['/login', '/forgot-password', '/reset-password', '/api/health'];

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
  return res;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/).*)'] };
