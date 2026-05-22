'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { checkCompanyDuplicate } from '@/server/agents/prospecting-toolkit';
import type { DuplicateCheckInput, DuplicateCheckResult } from '@/server/agents/prospecting-toolkit';

// ============================================================
// Auth — solo admins pueden invocar esta tool de diagnóstico
// ============================================================

async function requireAdmin(): Promise<{ internalUserId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();

  if (role?.key !== 'admin') {
    redirect('/');
  }

  return { internalUserId: internalUser.id };
}

// ============================================================
// testCompanyDuplicateCheck — Server Action de diagnóstico
// ============================================================

/**
 * Ejecuta el orquestador de deduplicación para una empresa candidata.
 *
 * Uso exclusivo para validación interna y diagnóstico.
 * Requiere rol admin.
 *
 * No modifica ningún dato. Solo lectura.
 */
export async function testCompanyDuplicateCheck(
  input: DuplicateCheckInput
): Promise<{ success: true; result: DuplicateCheckResult } | { success: false; error: string }> {
  try {
    await requireAdmin();

    if (!input.name && !input.domain && !input.website) {
      return {
        success: false,
        error: 'Se requiere al menos name, domain o website',
      };
    }

    const result = await checkCompanyDuplicate(input);

    return { success: true, result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return { success: false, error: msg };
  }
}
