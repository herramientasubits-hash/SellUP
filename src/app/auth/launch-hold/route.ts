import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { audienceForRole } from '@/modules/auth/launch-gate';

/**
 * LAUNCH-GATE-2026-11 — salida de una sesión que la puerta de lanzamiento no deja pasar.
 * Averigua a quién le habla (líder o resto del equipo), cierra la sesión y vuelve al login con
 * el aviso que le corresponde. Está bajo /auth: el proxy la deja pasar sin sesión.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();

  let roleKey: string | null = null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data } = await supabase.rpc('get_internal_user', { p_auth_user_id: user.id });
    roleKey = (data?.[0]?.role_key as string | null | undefined) ?? null;
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(`${origin}/login?hold=${audienceForRole(roleKey)}`);
}
