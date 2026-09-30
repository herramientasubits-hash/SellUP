/**
 * AGENT1-TAVILY-QUERY-SPACE-1 — el historial de búsquedas de Tavily de un país ×
 * industria, leído de lo que ya existe (sólo lectura, sin tablas nuevas).
 *
 *   · `prospect_batches` guarda país, industria y las celdas/consultas de cada
 *     corrida (`metadata.incremental_search`);
 *   · `prospect_candidates` guarda qué consulta trajo cada empresa
 *     (`metadata.search_trace.query_text`).
 *
 * Fail-open: cualquier error devuelve un historial vacío y el plan se comporta
 * como en un segmento nuevo (nunca bloquea una corrida).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  TAVILY_QUERY_HISTORY_LOOKBACK_DAYS,
  buildTavilyQueryHistory,
  type TavilyHistoryBatch,
  type TavilyHistoryCandidate,
  type TavilyQueryHistory,
} from './tavily-query-space';

/** Tope de lotes leídos: 20 vendedores × 1 corrida/día × 180 días ≈ 3.600, pero por país × industria son muchos menos. */
export const TAVILY_QUERY_HISTORY_MAX_BATCHES = 1000;
const CANDIDATE_BATCH_CHUNK = 100;

type BatchRow = {
  id: string;
  created_at: string;
  plan: unknown;
  rounds: unknown;
};

type CandidateRow = {
  batch_id: string;
  status: string | null;
  domain: string | null;
  query_text: string | null;
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Qué buscó un lote. Desde v2 el plan publica `cells_used` (clave de celda +
 * consulta emitida); los lotes anteriores sólo tienen `rounds[].queriesUsed`.
 */
export function readTavilyHistoryBatch(row: BatchRow): TavilyHistoryBatch | null {
  const createdAtMs = Date.parse(row.created_at);
  if (!row.id || !Number.isFinite(createdAtMs)) return null;

  const cells = asArray((row.plan as { cells_used?: unknown } | null)?.cells_used);
  if (cells.length > 0) {
    const queries: string[] = [];
    const emittedToKey: Record<string, string> = {};
    for (const cell of cells) {
      const { key, query } = (cell ?? {}) as { key?: unknown; query?: unknown };
      if (typeof key !== 'string' || key.length === 0) continue;
      queries.push(key);
      if (typeof query === 'string' && query.length > 0) emittedToKey[query] = key;
    }
    return { id: row.id, createdAtMs, queries, emittedToKey };
  }

  const queries = asArray(row.rounds).flatMap((round) =>
    asArray((round as { queriesUsed?: unknown } | null)?.queriesUsed).filter(
      (q): q is string => typeof q === 'string' && q.length > 0,
    ),
  );
  return queries.length > 0 ? { id: row.id, createdAtMs, queries } : null;
}

export async function loadTavilyQueryHistory(
  supabase: SupabaseClient,
  scope: { countryCode: string; industry: string; nowMs: number; excludeBatchId?: string | null },
): Promise<{ history: TavilyQueryHistory; batchesRead: number }> {
  const since = new Date(scope.nowMs - TAVILY_QUERY_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: batchRows, error: batchError } = await supabase
    .from('prospect_batches')
    .select(
      'id, created_at, plan:metadata->incremental_search->tavily_query_plan, rounds:metadata->incremental_search->rounds',
    )
    .eq('country_code', scope.countryCode)
    .eq('industry', scope.industry)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(TAVILY_QUERY_HISTORY_MAX_BATCHES);
  if (batchError || !batchRows) throw new Error(batchError?.message ?? 'tavily_query_history_batches_unavailable');

  // Sólo lotes de Tavily: son los únicos que publican `tavily_query_plan`.
  const batches = (batchRows as BatchRow[])
    .filter((row) => row.plan && row.id !== scope.excludeBatchId)
    .map(readTavilyHistoryBatch)
    .filter((batch): batch is TavilyHistoryBatch => batch !== null);
  if (batches.length === 0) return { history: new Map(), batchesRead: 0 };

  const candidates: TavilyHistoryCandidate[] = [];
  const ids = batches.map((batch) => batch.id);
  for (let start = 0; start < ids.length; start += CANDIDATE_BATCH_CHUNK) {
    const { data, error } = await supabase
      .from('prospect_candidates')
      .select('batch_id, status, domain, query_text:metadata->search_trace->>query_text')
      .in('batch_id', ids.slice(start, start + CANDIDATE_BATCH_CHUNK));
    if (error || !data) throw new Error(error?.message ?? 'tavily_query_history_candidates_unavailable');
    for (const row of data as CandidateRow[]) {
      candidates.push({ batchId: row.batch_id, status: row.status, domain: row.domain, queryText: row.query_text });
    }
  }

  return { history: buildTavilyQueryHistory({ batches, candidates }), batchesRead: batches.length };
}
