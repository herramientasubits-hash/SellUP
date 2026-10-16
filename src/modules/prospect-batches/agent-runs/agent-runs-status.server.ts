/**
 * agent-runs-status.server.ts — estado de MIS corridas del Agente IA por
 * `clientRequestId` (AGENT1-PARALLEL-RUNS-TRAY-1).
 *
 * Sólo lectura con la sesión de la persona: la RLS sólo deja ver sus lotes y su
 * fila de progreso (migración 143). Sin la 143 aplicada, el progreso llega `null`
 * y la bandeja dice «En curso» sin etapa. Nunca lanza.
 */

import { createClient } from '@/lib/supabase/server';
import {
  RUN_PROGRESS_STAGES,
  readClientRequestId,
  type RunProgressStage,
} from '@/modules/prospect-batches/chat-wizard-execution/run-progress';
import { AGENT_RUNS_MAX_KEPT } from './agent-runs-store';

export type AgentRunStatusSnapshot = {
  clientRequestId: string;
  progress: { stage: RunProgressStage; label: string } | null;
  batch: { id: string; status: string; candidateCount: number | null } | null;
};

/** Usuario interno ACTIVO de la sesión, o `null`. Nunca lanza. */
async function resolveInternalUserId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('internal_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .maybeSingle();
    if (error || !data) return null;
    return typeof (data as { id?: unknown }).id === 'string' ? (data as { id: string }).id : null;
  } catch {
    return null;
  }
}

export async function readAgentRunsStatus(rawIds: readonly string[]): Promise<AgentRunStatusSnapshot[]> {
  const ids = [...new Set(rawIds.map((id) => readClientRequestId({ clientRequestId: id.trim() })).filter((id): id is string => id !== null))].slice(
    0,
    AGENT_RUNS_MAX_KEPT,
  );
  if (ids.length === 0) return [];

  try {
    const supabase = await createClient();
    // AGENT1-AUDIT-WS2 (extra de WS1) — los lotes se leen SÓLO de esta persona
    // (`created_by` = usuario interno). Antes bastaba con conocer un
    // `client_request_id` para ver estado y conteo de un lote que la RLS dejara ver.
    // Sin usuario interno legible, ningún lote (fail-closed).
    const internalUserId = await resolveInternalUserId(supabase);
    const [progressRes, batchRes] = await Promise.all([
      supabase.from('agent1_run_progress').select('client_request_id, stage, label').in('client_request_id', ids),
      internalUserId === null
        ? Promise.resolve({ data: [] as unknown[], error: null })
        : supabase
            .from('prospect_batches')
            .select('id, status, client_request_id')
            .eq('created_by', internalUserId)
            .in('client_request_id', ids),
    ]);

    const progressById = new Map<string, AgentRunStatusSnapshot['progress']>();
    for (const row of (progressRes.error ? [] : progressRes.data ?? []) as Array<{ client_request_id: string; stage: string; label: unknown }>) {
      if ((RUN_PROGRESS_STAGES as readonly string[]).includes(row.stage) && typeof row.label === 'string') {
        progressById.set(row.client_request_id, { stage: row.stage as RunProgressStage, label: row.label });
      }
    }

    const batches = (batchRes.error ? [] : batchRes.data ?? []) as Array<{ id: string; status: string; client_request_id: string }>;
    const counts = new Map<string, number>();
    if (batches.length > 0) {
      const countRes = await supabase
        .from('prospect_candidates')
        .select('batch_id')
        .in('batch_id', batches.map((batch) => batch.id));
      for (const row of (countRes.error ? [] : countRes.data ?? []) as Array<{ batch_id: string }>) {
        counts.set(row.batch_id, (counts.get(row.batch_id) ?? 0) + 1);
      }
    }
    const batchById = new Map(
      batches.map((batch) => [
        batch.client_request_id,
        { id: batch.id, status: batch.status, candidateCount: counts.get(batch.id) ?? 0 },
      ]),
    );

    return ids.map((clientRequestId) => ({
      clientRequestId,
      progress: progressById.get(clientRequestId) ?? null,
      batch: batchById.get(clientRequestId) ?? null,
    }));
  } catch {
    return ids.map((clientRequestId) => ({ clientRequestId, progress: null, batch: null }));
  }
}
