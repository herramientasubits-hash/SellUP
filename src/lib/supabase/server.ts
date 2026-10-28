import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { currentSessionCookieJar } from './session-override';

export async function createClient() {
  // Una ronda masiva que corre sola en el servidor trae su propia sesión
  // (ver `session-override.ts`); fuera de ella, las cookies de la petición.
  const borrowed = currentSessionCookieJar();
  if (borrowed) {
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { cookies: { getAll: () => borrowed.getAll(), setAll: (next) => borrowed.setAll(next) } }
    );
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}
