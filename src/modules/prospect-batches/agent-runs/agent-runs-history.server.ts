/**
 * agent-runs-history.server.ts — las corridas del Agente IA de la persona en los
 * últimos 7 días, para la página «Búsquedas» (AGENT1-PARALLEL-RUNS-PHASE2-1).
 *
 * Sólo lectura con la sesión de la persona (RLS): sus propios lotes del Agente 1.
 * Nunca lanza: una lectura rota se muestra como historial vacío con aviso.
 */

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/modules/access/actions';
import { competitorSearchTitle } from '@/modules/prospect-batches/competitor-search/competitor-reference';

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
  /**
   * AGENT1-CORPORATE-TREE-2 — el nombre del lote cuando la búsqueda no es «país ·
   * industria» («Árbol · Cencosud»). `null` = búsqueda por criterios.
   */
  title?: string | null;
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
      .select(
        'id, created_at, country, industry, status, name, search_mode:metadata->>search_mode, competitor_name:metadata->competitor_search->reference->>name, supplier_reference:metadata->supplier_search->>reference_company_name',
      )
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
      rows: (batches as unknown as Array<{ id: string; created_at: string; country: string | null; industry: string | null; status: string; name: string | null; search_mode: string | null; competitor_name: string | null; supplier_reference: string | null }>).map(
        (batch) => ({
          title:
            batch.search_mode === 'corporate_tree'
              ? batch.name
              : // «Competidores» y «Proveedores»: por la referencia guardada en el lote, no
                // por `search_mode` (el escritor lo pisaba al adoptar el lote antes de #699).
                batch.competitor_name
                ? competitorSearchTitle(batch.competitor_name)
                : batch.supplier_reference
                ? `Proveedores de ${batch.supplier_reference}`
                : null,
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
