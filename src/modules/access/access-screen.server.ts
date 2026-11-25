import 'server-only';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { accessScreenRedirect, type AccessStatus } from './access-status-routes';

/**
 * Guardia de las pantallas /access-*: sin sesión → /login; con un estado que
 * ya no es el de la pantalla (p. ej. activado por un admin) → su destino real.
 * Devuelve el usuario sólo cuando la pantalla sí corresponde.
 */
export async function requireAccessScreen(
  screen: Exclude<AccessStatus, 'active'>,
): Promise<{ user: User }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('access_status')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  const target = accessScreenRedirect(screen, internalUser?.access_status);
  if (target) redirect(target);

  return { user };
}
