/**
 * lusha-page-history-store.ts — qué páginas pagó YA una búsqueda de Lusha, en
 * cualquier corrida anterior.
 *
 * AGENT1-LUSHA-PAGE-CURSOR-1. Alimenta a `resolveLushaBranchStartPages`.
 *
 * La fuente es la valla durable de peticiones (migraciones 135/136): cada página
 * pagada deja una fila con su rama, su índice, su estado y cuántas filas
 * volvieron, colgada de una OPERACIÓN cuya firma es el SHA-256 de los criterios
 * normalizados de la búsqueda —país, macro, subindustria, tamaño, texto—. Nada
 * efímero entra en esa firma, así que la MISMA búsqueda tiene la MISMA firma en
 * todas sus corridas. Sin migración nueva.
 *
 * 🔴 La firma NO incluye al actor, y aquí se lee sin filtrar por él: la página 0
 * que pagó una usuaria es la misma página 0 que pagaría otra. La memoria de
 * proveedor (`provider_seen_entities`) ya es global por la misma razón.
 *
 * 🔴 Sólo lectura. Un fallo se PROPAGA: quien llama decide degradar a la página 0,
 * que es el comportamiento anterior al cursor y nunca gasta de más.
 *
 * Server-only.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LushaPageHistoryRow } from './lusha-page-cursor';
import { createLushaRequestFenceServiceClient } from './lusha-request-fence-store';

const OPERATIONS_TABLE = 'lusha_prospecting_operations';
const FENCE_TABLE = 'lusha_prospecting_request_fence';
/**
 * Acota la lectura. Se leen las operaciones y las filas MÁS RECIENTES: si una
 * búsqueda tuviera más historial que esto, lo que se pierde es lo más viejo, que
 * es justo lo que el cursor ya dejó atrás.
 */
const MAX_OPERATIONS = 200;
const MAX_FENCE_ROWS = 2000;

export type LushaPageHistoryQuery = {
  signatureVersion: string;
  signatureHash: string;
  /** La operación EN CURSO: sus páginas aún no son historia. */
  excludeOperationId: string | null;
};

type FenceRow = {
  branch_index: number;
  page_index: number;
  state: string;
  results_returned: number | null;
};

export async function loadLushaPageHistory(
  query: LushaPageHistoryQuery,
  client: SupabaseClient = createLushaRequestFenceServiceClient(),
): Promise<LushaPageHistoryRow[]> {
  let operations = client
    .from(OPERATIONS_TABLE)
    .select('operation_id')
    .eq('request_signature_version', query.signatureVersion)
    .eq('request_signature_hash', query.signatureHash);
  if (query.excludeOperationId)
    operations = operations.neq('operation_id', query.excludeOperationId);
  const { data: ops, error: opsError } = await operations
    .order('created_at', { ascending: false })
    .limit(MAX_OPERATIONS);
  if (opsError) throw new Error(`lusha-page-history: ${OPERATIONS_TABLE}: ${opsError.message}`);

  const operationIds = ((ops ?? []) as { operation_id: string }[]).map((o) => o.operation_id);
  if (operationIds.length === 0) return [];

  const { data: fence, error: fenceError } = await client
    .from(FENCE_TABLE)
    .select('branch_index, page_index, state, results_returned')
    .in('operation_id', operationIds)
    // Las más recientes primero, para que el tope corte lo viejo…
    .order('claimed_at', { ascending: false })
    .limit(MAX_FENCE_ROWS);
  if (fenceError) throw new Error(`lusha-page-history: ${FENCE_TABLE}: ${fenceError.message}`);

  // …y de vuelta a orden cronológico. 🔴 El cursor deja que el conteo MÁS
  // RECIENTE de una página mande, porque el universo de una búsqueda puede
  // encogerse: el orden de salida es parte del contrato.
  return [...((fence ?? []) as FenceRow[])].reverse().map((row) => ({
    branchIndex: row.branch_index,
    pageIndex: row.page_index,
    state: row.state,
    resultsReturned: row.results_returned,
  }));
}
