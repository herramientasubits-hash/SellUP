// Agente 2A — Apollo Phone Reveal: LECTURA del monitoreo de supresiones no
// evaluables (APOLLO-PHONE-CACHE-1b, FIX 5)
//
// Wrapper server-only del core puro `phone-suppression-monitoring-core.ts`. Aquí
// vive lo único que el core no puede tener: el cliente de Supabase, el reloj y la
// comprobación de rol.
//
// Es una LECTURA y nada más: un SELECT sobre `provider_usage_logs`. No hay
// INSERT/UPDATE/DELETE, ni llamada a Apollo o Lusha, ni sincronización con
// HubSpot, ni dependencia de `ENABLE_APOLLO_PHONE_CACHE` (los eventos que cuenta
// se registran con el flag encendido o apagado).
//
// No es un server action a propósito: el consumidor es un server component de
// /ai-usage, así que un módulo de consulta —el mismo patrón que
// `src/modules/ai-usage/queries.ts`— evita exponer un endpoint nuevo.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { PHONE_CACHE_PROVIDER } from './phone-cache-core';
import {
  loadPhoneSuppressionNotEvaluableSummary,
  NOT_EVALUABLE_ROW_LIMIT,
  type PhoneSuppressionNotEvaluableLogRow,
  type PhoneSuppressionNotEvaluableSummary,
} from './phone-suppression-monitoring-core';

/**
 * `provider_usage_logs` está restringida a admins por RLS, así que la lectura usa
 * el cliente service-role — igual que `ai-usage/queries.ts` y
 * `run-viewer-actions.ts`. La autorización la decide `isCurrentUserAdmin()` ANTES
 * de leer; el cliente admin no relaja ese control, solo evita que RLS convierta
 * una lectura autorizada en cero filas.
 */
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

/**
 * Resumen agregado y PII-free de las comprobaciones de supresión que NO se
 * pudieron evaluar (FIX 4), para las últimas 24 h y los últimos 7 días.
 *
 * Devuelve null cuando quien mira no es admin: el panel dice "sin permisos" en
 * vez de mostrar un cero que se leería como "no hay casos".
 */
export async function getPhoneSuppressionNotEvaluableSummary(): Promise<PhoneSuppressionNotEvaluableSummary | null> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return null;

  const admin = getAdminClient();

  return loadPhoneSuppressionNotEvaluableSummary({
    nowIso: new Date().toISOString(),
    isAllowed: true,
    rowLimit: NOT_EVALUABLE_ROW_LIMIT,
    fetchRows: async ({ sinceIso, states, rowLimit }) => {
      // Filtro por JSON path (`metadata->>clave`), el mismo mecanismo que ya usa
      // `phone-reveal-recovery-actions.ts`. La allowlist cerrada de estados evita
      // un `LIKE 'not_evaluable%'` que podría arrastrar etiquetas futuras sin
      // revisar. `provider_key` se acota a Apollo porque el vocabulario de
      // supresión de v1 es exclusivamente Apollo.
      const { data, error } = await admin
        .from('provider_usage_logs')
        .select('created_at, metadata')
        .eq('provider_key', PHONE_CACHE_PROVIDER)
        .in('metadata->>suppression_state', states as unknown as string[])
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(rowLimit);
      if (error) {
        // Se propaga: "no pude leer" NO puede presentarse como "no hay eventos".
        throw new Error(
          `getPhoneSuppressionNotEvaluableSummary: ${error.message}`,
        );
      }

      // Proyección inmediata a la forma mínima. La metadata completa lleva
      // candidato, cuenta, request_id y la traza de Apollo; nada de eso hace
      // falta para contar, así que se descarta aquí y no entra al agregador.
      return (data ?? []).map((row): PhoneSuppressionNotEvaluableLogRow => {
        const metadata =
          (row.metadata as Record<string, unknown> | null) ?? null;
        const state = metadata?.suppression_state;
        const phase = metadata?.reveal_phase;
        return {
          created_at:
            typeof row.created_at === 'string' ? row.created_at : null,
          suppression_state: typeof state === 'string' ? state : null,
          reveal_phase: typeof phase === 'string' ? phase : null,
        };
      });
    },
  });
}
