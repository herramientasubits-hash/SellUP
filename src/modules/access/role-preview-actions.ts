'use server';

// «Ver como…» — acciones del menú del avatar. Cada una revisa la identidad REAL
// (no la de la vista previa): sólo la persona autorizada, y admin de verdad.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { displayUserName } from './user-names';
import { ROLE_LABELS } from './role-labels';
import { readRealUser } from './role-preview.server';
import {
  canUseRolePreview,
  isPreviewableRole,
  parseRolePreviewCookie,
  PREVIEWABLE_ROLE_KEYS,
  ROLE_PREVIEW_COOKIE,
  ROLE_PREVIEW_MAX_AGE_SECONDS,
  type PreviewableRoleKey,
} from './role-preview';

export interface RolePreviewOption {
  roleKey: PreviewableRoleKey;
  roleLabel: string;
  people: Array<{ id: string; name: string; group: string | null }>;
}

async function allowedRealUser() {
  const real = await readRealUser();
  return real && canUseRolePreview(real) ? real : null;
}

/** Las personas activas de cada rol, para elegir como quién mirar. */
export async function getRolePreviewOptions(): Promise<RolePreviewOption[] | null> {
  if (!(await allowedRealUser())) return null;
  const { data, error } = await createSupabaseAdminClient()
    .from('internal_users')
    .select('id, full_name, email, roles(key), group:organization_groups(name)')
    .eq('access_status', 'active')
    .order('full_name', { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  const byRole = new Map<PreviewableRoleKey, RolePreviewOption['people']>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const roles = row.roles;
    const roleKey = ((Array.isArray(roles) ? roles[0] : roles) as { key?: string } | null | undefined)?.key ?? null;
    if (!isPreviewableRole(roleKey)) continue;
    const group = (Array.isArray(row.group) ? row.group[0] : row.group) as { name?: string } | null | undefined;
    byRole.set(roleKey, [
      ...(byRole.get(roleKey) ?? []),
      {
        id: row.id as string,
        name: displayUserName(row as { full_name: string | null; email: string | null }) ?? 'Sin nombre',
        group: group?.name ?? null,
      },
    ]);
  }
  return PREVIEWABLE_ROLE_KEYS.map((roleKey) => ({ roleKey, roleLabel: ROLE_LABELS[roleKey] ?? roleKey, people: byRole.get(roleKey) ?? [] }));
}

/** Empieza a mirar como esta persona (su rol y su equipo). */
export async function startRolePreview(asUserId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await allowedRealUser())) return { ok: false, error: 'No tienes acceso a esta opción.' };
  const id = parseRolePreviewCookie(asUserId);
  if (!id) return { ok: false, error: 'Elige una persona.' };
  const { data } = await createSupabaseAdminClient()
    .from('internal_users')
    .select('id, access_status, roles(key)')
    .eq('id', id)
    .maybeSingle();
  const roles = (data as { roles?: unknown } | null)?.roles;
  const roleKey = ((Array.isArray(roles) ? roles[0] : roles) as { key?: string } | null | undefined)?.key ?? null;
  if (!data || data.access_status !== 'active' || !isPreviewableRole(roleKey)) {
    return { ok: false, error: 'Esa persona no está activa o no tiene un rol que se pueda probar.' };
  }
  (await cookies()).set(ROLE_PREVIEW_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ROLE_PREVIEW_MAX_AGE_SECONDS,
  });
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Vuelve a su rol real. Siempre se puede (también si la vista previa ya no vale). */
export async function stopRolePreview(): Promise<{ ok: true }> {
  (await cookies()).delete(ROLE_PREVIEW_COOKIE);
  revalidatePath('/', 'layout');
  return { ok: true };
}
