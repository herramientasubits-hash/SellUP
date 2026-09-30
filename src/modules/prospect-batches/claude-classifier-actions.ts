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
import { isAgent1ClaudeClassifierEnabled } from '@/lib/feature-flags.server';
import type { ClassifyBatchSummary } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates';

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
