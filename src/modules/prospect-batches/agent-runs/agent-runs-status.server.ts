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

export async function readAgentRunsStatus(rawIds: readonly string[]): Promise<AgentRunStatusSnapshot[]> {
  const ids = [...new Set(rawIds.map((id) => readClientRequestId({ clientRequestId: id.trim() })).filter((id): id is string => id !== null))].slice(
    0,
    AGENT_RUNS_MAX_KEPT,
  );
  if (ids.length === 0) return [];

  try {
    const supabase = await createClient();
    const [progressRes, batchRes] = await Promise.all([
      supabase.from('agent1_run_progress').select('client_request_id, stage, label').in('client_request_id', ids),
      supabase.from('prospect_batches').select('id, status, client_request_id').in('client_request_id', ids),
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
