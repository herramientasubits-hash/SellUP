/**
 * GET /api/debug/commercial-scope-config
 *
 * Dice si ENABLE_COMMERCIAL_SCOPE está encendida en el entorno que responde.
 * Existe porque en Vercel la variable es `type: sensitive` y su valor no se puede
 * leer: sin esta ruta no se distingue «no existe» de «existe pero apagada».
 *
 *   * `flag.configured` — ¿la variable EXISTE en este entorno?
 *   * `flag.enabled`    — ¿el código la lee como encendida (valor "true")?
 *   * `readiness`       — cómo quedaría cada usuario activo con la bandera
 *                         encendida, sólo en conteos (sin nombres ni correos).
 *
 * Sólo lectura, sin escrituras ni proveedores. Nunca devuelve el valor crudo.
 * Acceso: admin-only (sesión autenticada + RPC `is_admin`), igual que los demás
 * diagnósticos.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isEnvFlagConfigured } from '@/lib/env-flag-parser';
import { COMMERCIAL_SCOPE_FLAG, isCommercialScopeEnabled } from '@/lib/feature-flags.server';
import {
  computeCommercialScopeReadiness,
  type ReadinessUser,
} from '@/modules/access/commercial-scope-readiness';

const NO_STORE = { 'Cache-Control': 'no-store' };

async function loadActiveUsers(): Promise<ReadinessUser[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('internal_users')
    .select('id, group_id, manager_id, roles(key)')
    .eq('access_status', 'active')
    .is('archived_at', null);
  if (error) throw new Error(`loadActiveUsers: ${error.message}`);
  return (data ?? []).map((u) => ({
    id: u.id as string,
    roleKey: (u.roles as unknown as { key: string } | null)?.key ?? null,
    groupId: (u.group_id as string | null) ?? null,
    managerId: (u.manager_id as string | null) ?? null,
  }));
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: NO_STORE });
  }
  const { data: isAdmin } = await supabase.rpc('is_admin', { p_auth_user_id: user.id });
  if (!isAdmin) {
    return NextResponse.json(
      { error: 'Acceso restringido a administradores' },
      { status: 403, headers: NO_STORE },
    );
  }

  try {
    const readiness = computeCommercialScopeReadiness(await loadActiveUsers());
    return NextResponse.json(
      {
        config_version: 'commercial_scope_config_v1',
        flag: {
          name: COMMERCIAL_SCOPE_FLAG,
          configured: isEnvFlagConfigured(process.env[COMMERCIAL_SCOPE_FLAG]),
          enabled: isCommercialScopeEnabled(),
        },
        readiness,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error('[access] commercial scope config failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'El diagnóstico falló. Vuelve a intentarlo.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
