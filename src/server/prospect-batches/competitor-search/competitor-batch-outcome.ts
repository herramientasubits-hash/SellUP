/**
 * Agente 1 · «Competidores de una empresa» — lo que quedó en el lote (puro).
 *
 * Auditoría 21-10: el resultado anunciaba las revisables ANTES de la revisión de
 * tamaño de Claude, que corre al terminar y descartaba varias (Grupo Caballero CO:
 * se anunciaron 10 y quedaron 4). Ahora también se cuenta cuántas esperan esa
 * revisión, con el MISMO criterio que la elige (`needsCandidateRescue`).
 */

import type { ClassifiableCandidateRow } from '@/server/agents/prospecting-toolkit/claude-classifier/classification-metadata';
import { needsCandidateRescue } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch';
import type { CompetitorBatchOutcome } from '@/modules/prospect-batches/chat-wizard-execution/wizard-competitor-run';

export type CompetitorBatchRow = Pick<ClassifiableCandidateRow, 'status' | 'website' | 'domain' | 'metadata' | 'source_primary'> & {
  /** `metadata.duplicate_check.status`. */
  duplicate_check: string | null;
};

/** El criterio del rescate sólo mira estado, sitio, fuente y metadata: el resto va vacío. */
function toClassifiableRow(row: CompetitorBatchRow): ClassifiableCandidateRow {
  return {
    id: '',
    industry_id: null,
    name: null,
    country_code: null,
    country: null,
    status: row.status,
    website: row.website,
    domain: row.domain,
    metadata: row.metadata,
    source_primary: row.source_primary ?? null,
  };
}

export function summarizeCompetitorBatchRows(
  rows: readonly CompetitorBatchRow[],
  options: { rescueEnabled: boolean; nowMs: number },
): CompetitorBatchOutcome {
  const reviewableRows = rows.filter((r) => r.status !== 'duplicate' && r.status !== 'discarded');
  const sizePending = options.rescueEnabled
    ? reviewableRows.filter((r) => needsCandidateRescue(toClassifiableRow(r), options.nowMs)).length
    : 0;
  return {
    reviewable: reviewableRows.length,
    hubspotDuplicates: rows.filter((r) => r.status === 'duplicate' && r.duplicate_check === 'existing_in_hubspot').length,
    sellupDuplicates: rows.filter((r) => r.status === 'duplicate' && r.duplicate_check !== 'existing_in_hubspot').length,
    sizePending,
  };
}
