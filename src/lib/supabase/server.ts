/**
 * Supabase Server Client - Cliente para el servidor (Server Components, API Routes)
 *
 * Este archivo está preparado para conectar con Supabase desde el backend de Next.js.
 * Utiliza cookies para manejar la sesión del usuario.
 *
 * La implementación real se realizará en una fase posterior cuando:
 * - Se inicialice el proyecto de Supabase
 * - Se configuren las tablas del modelo de datos
 * - Se implementen las políticas de autenticación
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set(name, value, options);
          } catch {
            // Handle error silently
          }
        },
        remove(name: string) {
          try {
            cookieStore.delete(name);
          } catch {
            // Handle error silently
          }
        },
      },
    },
  );
}
