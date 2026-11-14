'use server';

// Dueña 14-11 — «Claude tiene que revisar siempre todo lo que pueda para rescatarlo».
// Lanza el mismo rescate de siempre sobre TODAS las búsquedas que tienen descartadas
// rescatables sin revisar (p. ej. Chile × Agroindustria f2f36ff3: 46 que quedaron
// fuera porque la búsqueda ya tenía sus 10). Cada búsqueda corre en su propia función
// (la ruta de continuación) con sus topes de gasto de siempre. Lo que pasa vuelve a
// revisión en el MISMO lote (de quien hizo la búsqueda) hasta 10 por búsqueda; el resto
// va al banco gratuito para búsquedas futuras. Sólo administradores.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser, isCurrentUserAdmin } from '@/modules/access/actions';
import { isAgent1ClaudeDomainFinderEnabled, isAgent1ClaudeRescueEnabled } from '@/lib/feature-flags.server';
import {
  RESCUABLE_DISPOSITION_REASON_CODES,
  needsDispositionRescue,
  type RescuableDispositionRow,
} from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-dispositions';
import { DOMAIN_SEARCH_REASON_CODE } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/domain-search';
import { triggerRescueContinuation } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-chain.server';

/** Tope de filas leídas por pulsación (Descartadas en Prod: ~170 el 14-11). */
const MAX_ROWS = 2_000;

export type RescueDiscardedResult =
  | { ok: true; batches: number; companies: number; scheduled: number }
  | { ok: false; error: string };

export async function rescueDiscardedWithClaudeAction(): Promise<RescueDiscardedResult> {
  if (!isAgent1ClaudeRescueEnabled()) {
    return { ok: false, error: 'El rescate con IA está apagado.' };
  }
  const [me, isAdmin] = await Promise.all([getCurrentUser(), isCurrentUserAdmin()]).catch(() => [null, false] as const);
  if (!me || me.access_status !== 'active' || !isAdmin) {
    return { ok: false, error: 'Sólo un administrador puede lanzar el rescate.' };
  }

  const domainSearchEnabled = isAgent1ClaudeDomainFinderEnabled();
  const reasonCodes = domainSearchEnabled
    ? [...RESCUABLE_DISPOSITION_REASON_CODES, DOMAIN_SEARCH_REASON_CODE]
    : [...RESCUABLE_DISPOSITION_REASON_CODES];
  const { data, error } = await createSupabaseAdminClient()
    .from('prospect_discarded_dispositions')
    .select('id, batch_id, candidate_id, status, name, domain, country_code, industry, reason_code, evidence, round_origin, provider_identifier')
    .eq('status', 'discarded')
    .in('reason_code', reasonCodes)
    .limit(MAX_ROWS);
  if (error) {
    console.error('[claude-rescue] discarded read failed:', error.message);
    return { ok: false, error: 'No se pudieron leer las descartadas. Intenta de nuevo.' };
  }

  const now = Date.now();
  const perBatch = new Map<string, number>();
  for (const row of (data ?? []) as RescuableDispositionRow[]) {
    if (!needsDispositionRescue(row, now, domainSearchEnabled)) continue;
    perBatch.set(row.batch_id, (perBatch.get(row.batch_id) ?? 0) + 1);
  }

  const started = await Promise.all(
    [...perBatch.keys()].map((batchId) =>
      triggerRescueContinuation({ batchId, continuation: 1, spentUsd: 0, triggeredBy: me.id }),
    ),
  );
  return {
    ok: true,
    batches: perBatch.size,
    companies: [...perBatch.values()].reduce((a, b) => a + b, 0),
    scheduled: started.filter(Boolean).length,
  };
}
