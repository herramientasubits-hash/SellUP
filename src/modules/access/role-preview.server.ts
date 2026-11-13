// «Ver como…» en el servidor: lee la cookie y la valida contra la identidad
// REAL (sesión + rol en la base, sin la vista previa). Sin 'use server': no es
// una acción. Cualquier fallo ⇒ sin vista previa (cada quien con su rol real).

import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { displayUserName } from './user-names';
import { canUseRolePreview, isPreviewableRole, parseRolePreviewCookie, ROLE_PREVIEW_COOKIE, type PreviewableRoleKey } from './role-preview';

export interface RealUser {
  id: string;
  email: string | null;
  roleKey: string | null;
}

/** Quién está conectado de verdad (sin vista previa). */
export const readRealUser = cache(async (): Promise<RealUser | null> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await createSupabaseAdminClient()
      .from('internal_users')
      .select('id, email, roles(key)')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .maybeSingle();
    if (!data) return null;
    const roles = (data as { roles?: unknown }).roles;
    const role = (Array.isArray(roles) ? roles[0] : roles) as { key?: string } | null | undefined;
    return { id: data.id as string, email: (data.email as string | null) ?? null, roleKey: role?.key ?? null };
  } catch {
    return null;
  }
});

export interface ActiveRolePreview {
  roleKey: PreviewableRoleKey;
  asUser: { id: string; name: string; email: string | null; groupId: string | null };
  realUserId: string;
}

/** La vista previa vigente, ya validada. `null` = cada quien con su rol real. */
export const readRolePreview = cache(async (): Promise<ActiveRolePreview | null> => {
  try {
    const asUserId = parseRolePreviewCookie((await cookies()).get(ROLE_PREVIEW_COOKIE)?.value);
    if (!asUserId) return null;
    const real = await readRealUser();
    if (!real || !canUseRolePreview(real)) return null;
    const { data } = await createSupabaseAdminClient()
      .from('internal_users')
      .select('id, full_name, email, group_id, access_status, roles(key)')
      .eq('id', asUserId)
      .maybeSingle();
    if (!data || data.access_status !== 'active') return null;
    const roles = (data as { roles?: unknown }).roles;
    const roleKey = ((Array.isArray(roles) ? roles[0] : roles) as { key?: string } | null | undefined)?.key ?? null;
    if (!isPreviewableRole(roleKey)) return null;
    return {
      roleKey,
      asUser: {
        id: data.id as string,
        name: displayUserName(data as { full_name: string | null; email: string | null }) ?? 'Sin nombre',
        email: (data.email as string | null) ?? null,
        groupId: (data.group_id as string | null) ?? null,
      },
      realUserId: real.id,
    };
  } catch {
    // Fuera de una petición (cron, Slack) no hay cookies: sin vista previa.
    return null;
  }
});
