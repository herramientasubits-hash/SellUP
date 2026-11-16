/**
 * Agente 1 · Rescate con Claude — lanza el rescate sobre las búsquedas con descartadas
 * rescatables sin revisar. Lo usan el botón «Rescatar con IA» (administradores) y, como
 * red de seguridad, el cron diario (dueña 16-11: dos búsquedas largas con Apollo y Lusha
 * dejaron 27 descartadas sin revisar porque la segunda vuelta del rescate no corrió).
 *
 * Cada búsqueda corre en su propia función (la ruta de continuación) con sus topes de
 * gasto de siempre. Nunca lanza.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isAgent1ClaudeDomainFinderEnabled, isAgent1ClaudeRescueEnabled } from '@/lib/feature-flags.server';
import { RESCUABLE_DISPOSITION_REASON_CODES, needsDispositionRescue, type RescuableDispositionRow } from './rescue-dispositions';
import { WEBSITE_SEARCH_REASON_CODES, asWebsiteSearchRow } from './domain-search';
import { triggerRescueContinuation } from './rescue-chain.server';
import { RESCUE_BATCH_MAX_COST_USD } from './rescue-batch';
import { readBatchRescueSpentUsd } from './rescue-batch.server';
import { CLAUDE_RESCUE_METADATA_KEY, RESCUE_STALE_AFTER_MS } from './rescue-patch';

/** ¿Hay una revisión «en proceso» reciente en esta fila? */
function isFreshInProgress(evidence: Record<string, unknown> | null, nowMs: number): boolean {
  const rescue = evidence?.[CLAUDE_RESCUE_METADATA_KEY] as { decision?: unknown; started_at?: unknown } | undefined;
  if (rescue?.decision !== 'in_progress' || typeof rescue.started_at !== 'string') return false;
  const at = Date.parse(rescue.started_at);
  return Number.isFinite(at) && nowMs - at < RESCUE_STALE_AFTER_MS;
}

/** Tope de filas leídas por pasada. */
const MAX_ROWS = 2_000;

export type PendingRescueSweep = { batches: number; companies: number; scheduled: number };

export async function schedulePendingDiscardRescues(options: {
  triggeredBy: string | null;
  /** Sólo descartadas creadas en las últimas N horas (el cron); sin valor, todas. */
  sinceHours?: number;
}): Promise<PendingRescueSweep | null> {
  if (!isAgent1ClaudeRescueEnabled()) return null;
  try {
    const domainSearchEnabled = isAgent1ClaudeDomainFinderEnabled();
    const reasonCodes = domainSearchEnabled
      ? [...RESCUABLE_DISPOSITION_REASON_CODES, ...WEBSITE_SEARCH_REASON_CODES]
      : [...RESCUABLE_DISPOSITION_REASON_CODES];
    let query = createSupabaseAdminClient()
      .from('prospect_discarded_dispositions')
      .select('id, batch_id, candidate_id, status, name, domain, country_code, industry, reason_code, evidence, round_origin, provider_identifier')
      .eq('status', 'discarded')
      .in('reason_code', reasonCodes)
      // Lo más reciente primero: con más filas que el tope, lo nuevo no se queda fuera.
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);
    if (options.sinceHours) {
      query = query.gte('created_at', new Date(Date.now() - options.sinceHours * 3_600_000).toISOString());
    }
    const { data, error } = await query;
    if (error) {
      console.error('[claude-rescue] pending sweep read failed:', error.message);
      return null;
    }
    const now = Date.now();
    const perBatch = new Map<string, number>();
    const busy = new Set<string>();
    for (const raw of (data ?? []) as RescuableDispositionRow[]) {
      const row = asWebsiteSearchRow(raw);
      // Revisión 16-11 — una vuelta ya en curso en ese lote: no se lanza otra en paralelo
      // (gastaría el doble y podría pasar del tope de 10).
      if (isFreshInProgress(row.evidence, now)) busy.add(row.batch_id);
      if (!needsDispositionRescue(row, now, domainSearchEnabled)) continue;
      perBatch.set(row.batch_id, (perBatch.get(row.batch_id) ?? 0) + 1);
    }
    for (const batchId of busy) perBatch.delete(batchId);
    // Revisión 16-11 — sin el lote que ya gastó su tope (relanzarlo cada día no avanza nada).
    const admin = createSupabaseAdminClient();
    for (const batchId of [...perBatch.keys()]) {
      const spent = await readBatchRescueSpentUsd(admin, batchId).catch(() => null);
      if (spent !== null && spent >= RESCUE_BATCH_MAX_COST_USD) perBatch.delete(batchId);
    }
    // De a una: el barrido nunca abre decenas de funciones a la vez.
    const started: boolean[] = [];
    for (const batchId of perBatch.keys()) {
      started.push(
        await triggerRescueContinuation({ batchId, continuation: 1, spentUsd: 0, triggeredBy: options.triggeredBy }),
      );
    }
    return {
      batches: perBatch.size,
      companies: [...perBatch.values()].reduce((a, b) => a + b, 0),
      scheduled: started.filter(Boolean).length,
    };
  } catch (err) {
    console.error('[claude-rescue] pending sweep failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
