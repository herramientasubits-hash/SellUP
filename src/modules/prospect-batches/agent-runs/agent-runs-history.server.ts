/**
 * agent-runs-history.server.ts — las corridas del Agente IA de la persona en los
 * últimos 7 días, para la página «Búsquedas» (AGENT1-PARALLEL-RUNS-PHASE2-1).
 *
 * Sólo lectura con la sesión de la persona (RLS): sus propios lotes del Agente 1.
 * Nunca lanza: una lectura rota se muestra como historial vacío con aviso.
 */

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/modules/access/actions';

export const AGENT_RUNS_HISTORY_DAYS = 7;
/** Tope de filas: una semana de corridas de una persona cabe de sobra. */
export const AGENT_RUNS_HISTORY_LIMIT = 200;

export type AgentRunHistoryRow = {
  batchId: string;
  createdAt: string;
  country: string | null;
  industry: string | null;
  status: string;
  candidateCount: number;
};

export type AgentRunsHistory = { rows: AgentRunHistoryRow[]; failed: boolean };

export async function readAgentRunsHistory(nowMs: number = Date.now()): Promise<AgentRunsHistory> {
  try {
    const me = await getCurrentUser();
    if (!me) return { rows: [], failed: false };
    const supabase = await createClient();
    const since = new Date(nowMs - AGENT_RUNS_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: batches, error } = await supabase
      .from('prospect_batches')
      .select('id, created_at, country, industry, status')
      .eq('source', 'agent_1')
      .eq('created_by', me.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(AGENT_RUNS_HISTORY_LIMIT);
    if (error || !batches) return { rows: [], failed: true };

    const ids = (batches as Array<{ id: string }>).map((batch) => batch.id);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: candidates } = await supabase.from('prospect_candidates').select('batch_id').in('batch_id', ids);
      for (const row of (candidates ?? []) as Array<{ batch_id: string }>) {
        counts.set(row.batch_id, (counts.get(row.batch_id) ?? 0) + 1);
      }
    }

    return {
      failed: false,
      rows: (batches as Array<{ id: string; created_at: string; country: string | null; industry: string | null; status: string }>).map(
        (batch) => ({
          batchId: batch.id,
          createdAt: batch.created_at,
          country: batch.country,
          industry: batch.industry,
          status: batch.status,
          candidateCount: counts.get(batch.id) ?? 0,
        }),
      ),
    };
  } catch {
    return { rows: [], failed: true };
  }
}
