'use server';

import { isCurrentUserAdmin } from '@/modules/access/actions';
import { checkSupabaseConnection } from './storage-usage.server';

export interface TestSupabaseConnectionResult {
  ok: boolean;
  message: string;
}

/** «Probar conexión» de Integraciones › Supabase. Sólo administradores; sólo lee. */
export async function testSupabaseConnectionAction(): Promise<TestSupabaseConnectionResult> {
  if (!(await isCurrentUserAdmin())) {
    return { ok: false, message: 'Sólo un administrador puede probar la conexión.' };
  }

  const check = await checkSupabaseConnection();
  if (check.ok) {
    return { ok: true, message: `Supabase responde (${check.latencyMs ?? '—'} ms).` };
  }
  return { ok: false, message: check.message ?? 'Supabase no respondió.' };
}
