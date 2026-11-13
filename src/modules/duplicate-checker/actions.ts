'use server';

import { getCurrentUser, isCurrentUserAdmin } from '@/modules/access/actions';
import { redirect } from 'next/navigation';
import { checkCompanyDuplicate } from '@/server/agents/prospecting-toolkit';
import type { DuplicateCheckInput, DuplicateCheckResult } from '@/server/agents/prospecting-toolkit';

// ============================================================
// Auth — solo admins pueden invocar esta tool de diagnóstico
// ============================================================

// Respeta «Ver como…» (getCurrentUser / isCurrentUserAdmin).
async function requireAdmin(): Promise<{ internalUserId: string }> {
  const me = await getCurrentUser();
  if (!me || me.access_status !== 'active') redirect('/login');
  if (!(await isCurrentUserAdmin())) redirect('/');
  return { internalUserId: me.id };
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
