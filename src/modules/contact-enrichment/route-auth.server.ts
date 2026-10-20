import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * El usuario interno activo de la sesión (o `null`), para las rutas de la búsqueda de
 * contactos. Sin atajos de desarrollo: una ruta sin sesión responde 401.
 */
export async function activeInternalUserIdForRoute(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
