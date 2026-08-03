/**
 * run-state.server.ts — Lectura y escritura del estado de corrida.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FIX · § 7.
 *
 * El estado vive en `prospect_batches.metadata`, que ya es JSONB y ya la escribe
 * el writer de candidatos. No hace falta ninguna migración: añadir una tabla
 * para esto sería crear esquema nuevo para un dato que sólo tiene sentido
 * mientras el lote existe.
 *
 * Nada aquí lanza: perder el estado degrada un reintento a una corrida nueva,
 * pero romper la ejecución por no poder guardar un dato de recuperación sería
 * peor que el problema que resuelve.
 *
 * Server-only. No importar desde componentes de cliente.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  APOLLO_TWO_ROUND_RUN_STATE_KEY,
  type ApolloTwoRoundPersistedRunState,
} from './run-state';

/** Cliente admin, o null cuando el entorno no lo permite. Nunca lanza. */
export function tryGetAdminClientForTwoRound(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    return createAdminClient(url, key);
  } catch {
    return null;
  }
}

export async function readTwoRoundRunState(
  batchId: string,
  clientOverride?: SupabaseClient,
): Promise<ApolloTwoRoundPersistedRunState | null> {
  const client = clientOverride ?? tryGetAdminClientForTwoRound();
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('prospect_batches')
      .select('metadata')
      .eq('id', batchId)
      .maybeSingle();
    if (error || !data) return null;
    const metadata = (data as { metadata?: unknown }).metadata;
    if (metadata === null || typeof metadata !== 'object') return null;
    const state = (metadata as Record<string, unknown>)[APOLLO_TWO_ROUND_RUN_STATE_KEY];
    return (state ?? null) as ApolloTwoRoundPersistedRunState | null;
  } catch {
    return null;
  }
}

/**
 * Escribe el estado sin pisar el resto del metadata.
 *
 * Lee-modifica-escribe: la columna es un documento entero, así que un UPDATE
 * directo del objeto borraría el routing, el presupuesto y los diagnósticos que
 * el writer ya dejó ahí.
 */
export async function writeTwoRoundRunState(
  batchId: string,
  state: ApolloTwoRoundPersistedRunState,
  clientOverride?: SupabaseClient,
): Promise<void> {
  const client = clientOverride ?? tryGetAdminClientForTwoRound();
  if (!client) return;
  try {
    const { data, error } = await client
      .from('prospect_batches')
      .select('metadata')
      .eq('id', batchId)
      .maybeSingle();
    if (error) return;

    const current =
      data && typeof (data as { metadata?: unknown }).metadata === 'object'
        ? ((data as { metadata?: Record<string, unknown> }).metadata ?? {})
        : {};

    await client
      .from('prospect_batches')
      .update({ metadata: { ...current, [APOLLO_TWO_ROUND_RUN_STATE_KEY]: state } })
      .eq('id', batchId);
  } catch {
    // Sin estado, un reintento vuelve a empezar. Nunca se rompe la corrida.
  }
}
