/**
 * Agente 3 · quién pide (sólo servidor): el usuario interno activo de la sesión, para
 * las rutas del agente. `null` si no hay sesión; `'forbidden'` si no tiene acceso.
 */

import { createClient } from '@/lib/supabase/server';

export async function resolveActiveInternalUserId(): Promise<string | null | 'forbidden'> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();
  return internalUser ? (internalUser.id as string) : 'forbidden';
}
