import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { ecosystemCookieOptions } from '@/lib/config/cookies';
import { cookies } from 'next/headers';
import { appUrl } from '@/lib/config/app-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) =>
          list.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, ecosystemCookieOptions(options as CookieOptions))
          ),
      },
    }
  );
  await supabase.auth.signOut();
  // 303 so the browser follows with GET after the POST.
  return NextResponse.redirect(appUrl('/auth/sign-in?signed_out=1'), { status: 303 });
}
