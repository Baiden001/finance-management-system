import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');

  const nextPath =
    next?.startsWith('/') && !next.startsWith('//')
      ? next
      : '/reset-password';

  if (!code) {
    return NextResponse.redirect(
      new URL('/forgot-password?error=invalid_link', url.origin)
    );
  }

  const response = NextResponse.redirect(new URL(nextPath, url.origin));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies: CookieToSet[]) => {
          cookies.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL('/forgot-password?error=invalid_link', url.origin)
    );
  }

  return response;
}
