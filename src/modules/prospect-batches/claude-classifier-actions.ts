'use server';

/**
 * Agente 1 · Clasificador Claude — acción del lote (AGENT1-CLAUDE-CLASSIFIER-1).
 *
 * Detrás de `ENABLE_AGENT1_CLAUDE_CLASSIFIER` (apagada) y sólo para admin, igual
 * que «Reprocesar enrichment». Sólo SUGIERE sector y tamaño con fuente: nunca
 * cambia el estado de un candidato.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  isAgent1ClaudeClassifierEnabled,
  isAgent1ClaudeCompanySearchEnabled,
  isAgent1ClaudeRescueEnabled,
} from '@/lib/feature-flags.server';
import type { ClassifyBatchSummary } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates';
import type { RescueBatchSummary } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch';
import type { ClaudeCompanySearchSummary } from '@/server/agents/prospecting-toolkit/claude-classifier/company-search-run';

const UUID_PATTERN = /^[0-9a-f-]{36}$/;

export type ClaudeClassifierActionResult =
  | ClassifyBatchSummary
  | { ok: false; error: 'disabled' | 'unauthorized' | 'invalid_batch'; detail?: string };

async function resolveAdminInternalUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: internalUser } = await supabase
      .from('internal_users')
      .select('id, role_id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .single();
    if (!internalUser) return null;
    const { data: role } = await supabase.from('roles').select('key').eq('id', internalUser.role_id).single();
    return role?.key === 'admin' ? internalUser.id : null;
  } catch {
    return null;
  }
}

export async function classifyBatchCandidatesWithClaudeAction(
  batchId: string,
): Promise<ClaudeClassifierActionResult> {
  if (!isAgent1ClaudeClassifierEnabled()) return { ok: false, error: 'disabled' };
  if (!batchId || !UUID_PATTERN.test(batchId)) return { ok: false, error: 'invalid_batch' };

  const internalUserId = await resolveAdminInternalUserId();
  if (!internalUserId) return { ok: false, error: 'unauthorized' };

  const [{ classifyBatchCandidates }, { buildLiveClassifyBatchDeps }] = await Promise.all([
    import('@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates'),
    import('@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates.server'),
  ]);

  const summary = await classifyBatchCandidates(
    { batchId, triggeredBy: internalUserId },
    buildLiveClassifyBatchDeps(),
  );
  if (summary.ok) revalidatePath(`/prospect-batches/${batchId}`);
  return summary;
}

export type ClaudeRescueActionResult =
  | RescueBatchSummary
  | { ok: false; error: 'disabled' | 'unauthorized' | 'invalid_batch' };

/**
 * AGENT1-CLAUDE-RESCUE-1 — el MISMO rescate que corre solo al terminar una
 * búsqueda, lanzado a mano desde el lote. Sirve para lo que no alcanzó a hacerse
 * en segundo plano (la búsqueda usó casi todo el tiempo) y para lo que agregue
 * después la continuación de Apollo. Esta ruta tiene 300 s propios.
 */
export async function rescueBatchWithClaudeAction(batchId: string): Promise<ClaudeRescueActionResult> {
  if (!isAgent1ClaudeRescueEnabled()) return { ok: false, error: 'disabled' };
  if (!batchId || !UUID_PATTERN.test(batchId)) return { ok: false, error: 'invalid_batch' };

  const internalUserId = await resolveAdminInternalUserId();
  if (!internalUserId) return { ok: false, error: 'unauthorized' };

  const [{ rescueBatchWithClaude }, { buildLiveRescueBatchDeps }] = await Promise.all([
    import('@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch'),
    import('@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.server'),
  ]);
  const summary = await rescueBatchWithClaude(
    { batchId, triggeredBy: internalUserId },
    buildLiveRescueBatchDeps(internalUserId),
  );
  if (summary.ok) revalidatePath(`/prospect-batches/${batchId}`);
  return summary;
}

export type ClaudeCompanySearchActionResult =
  | ClaudeCompanySearchSummary
  | { ok: false; error: 'disabled' | 'unauthorized' | 'invalid_batch' };

/**
 * AGENT1-CLAUDE-COMPANY-SEARCH-1 — piloto: Claude busca MÁS empresas del mismo país e
 * industria que este lote y las deja en un lote NUEVO (para medirlo aparte). Al
 * terminar, el rescate de siempre completa sector y tamaño en segundo plano.
 */
export async function searchCompaniesWithClaudeAction(batchId: string): Promise<ClaudeCompanySearchActionResult> {
  const startedAtMs = Date.now();
  if (!isAgent1ClaudeCompanySearchEnabled()) return { ok: false, error: 'disabled' };
  if (!batchId || !UUID_PATTERN.test(batchId)) return { ok: false, error: 'invalid_batch' };

  const internalUserId = await resolveAdminInternalUserId();
  if (!internalUserId) return { ok: false, error: 'unauthorized' };

  const [{ runClaudeCompanySearch }, { buildLiveClaudeCompanySearchDeps }, { scheduleClaudeRescueAfterWizardRun }] =
    await Promise.all([
      import('@/server/agents/prospecting-toolkit/claude-classifier/company-search-run'),
      import('@/server/agents/prospecting-toolkit/claude-classifier/company-search-run.server'),
      import('@/server/agents/prospecting-toolkit/claude-classifier/rescue/schedule-rescue.server'),
    ]);
  const summary = await runClaudeCompanySearch(
    { sourceBatchId: batchId, triggeredBy: internalUserId },
    buildLiveClaudeCompanySearchDeps(internalUserId),
  );
  // Lote creado pero sin empresas (todas cayeron en las compuertas): nada que completar.
  if (summary.ok && summary.batchId && summary.candidatesCreated > 0) {
    // Las de Claude llegan sin tamaño confirmado: el rescate lo completa (o descarta) con fuente.
    scheduleClaudeRescueAfterWizardRun({ ok: true, batchId: summary.batchId }, async () => internalUserId, startedAtMs);
    revalidatePath('/prospect-batches');
  }
  return summary;
}
