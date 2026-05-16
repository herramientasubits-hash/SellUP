import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Refresca la sesión SSR de Supabase en cada request.
 * Debe llamarse en el middleware antes de aplicar cualquier
 * lógica de protección de rutas.
 *
 * Usa getClaims() para validación rápida y eficiente del JWT
 * sin llamar a la API de Supabase.
 * Sigue el patrón oficial recomendado por Supabase para Next.js SSR.
 */
export async function updateSession(
  request: NextRequest
): Promise<{ supabaseResponse: NextResponse; isAuthenticated: boolean }> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims() decodifica y valida el JWT localmente sin llamar a la API
  // Patrón oficial SSR recomendado por Supabase
  const { data: claims } = await supabase.auth.getClaims();

  return { supabaseResponse, isAuthenticated: !!claims };
}
