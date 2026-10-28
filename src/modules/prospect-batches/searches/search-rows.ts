import type { Tone } from '@/lib/tone';
import type { BatchSource, BatchStatus, ProspectBatchWithMeta } from '@/modules/prospect-batches/types';
import { BATCH_STATUS_LABELS } from '@/modules/prospect-batches/types';

/**
 * Empresas › Búsquedas (dueña 28-10): lo que antes se llamaba «lotes» es una
 * búsqueda, venga de Rumbo, de un archivo o de una fuente oficial. Puro: arma la
 * fila de la tabla y el resumen de arriba a partir de lo que leyó el servidor.
 */

/** Una búsqueda tal como la lee quien mira. */
export interface SearchRow {
  id: string;
  name: string;
  statusLabel: string;
  statusTone: Tone;
  /** Cómo se buscó: «Empresas por criterios», «Árbol de una empresa», «Archivo importado»… */
  formLabel: string;
  country: string | null;
  found: number;
  needsReview: number;
  approved: number;
  /** Ya son empresas en SellUp: de estas se pueden buscar contactos en masa. */
  converted: number;
  createdAt: string;
  createdBy: string | null;
  /** `assigned`: no la lanzó; las cifras son sólo las empresas que le asignaron. */
  visibility: 'full' | 'assigned';
}

export interface SearchesSummary {
  searches: number;
  needsReview: number;
  approved: number;
  /** Búsquedas abiertas: todavía con empresas esperando una decisión. */
  open: number;
}

/** Cómo se buscó, con el nombre de la forma en el selector de Rumbo. */
const AI_FORM_LABELS: Readonly<Record<string, string>> = {
  exploratory: 'Empresas por criterios',
  corporate_tree: 'Árbol de una empresa',
  competitors: 'Competidores de una empresa',
  suppliers: 'Proveedores de una empresa',
};

const SOURCE_FORM_LABELS: Readonly<Record<BatchSource, string>> = {
  agent_1: 'Empresas por criterios',
  apollo: 'Empresas por criterios',
  imported: 'Archivo importado',
  external_import: 'Archivo importado',
  manual: 'Creada a mano',
  socrata_colombia: 'Fuente oficial',
  denue_mexico: 'Fuente oficial',
  datos_gob_cl: 'Fuente oficial',
  other: 'Otra',
};

export const SEARCH_STATUS_TONES: Readonly<Record<BatchStatus, Tone>> = {
  draft: 'neutral',
  generating: 'info',
  ready_for_review: 'warning',
  in_review: 'warning',
  completed: 'positive',
  cancelled: 'neutral',
  failed: 'negative',
};

/** El nombre de la forma de búsqueda: la de Rumbo si la guardó, si no, el origen. */
export function searchFormLabel(source: BatchSource, metadata: Record<string, unknown> | null | undefined): string {
  const mode = typeof metadata?.search_mode === 'string' ? metadata.search_mode : null;
  if ((source === 'agent_1' || source === 'apollo') && mode && AI_FORM_LABELS[mode]) return AI_FORM_LABELS[mode];
  return SOURCE_FORM_LABELS[source] ?? 'Otra';
}

export function toSearchRow(batch: ProspectBatchWithMeta & { visibility?: 'full' | 'assigned' }): SearchRow {
  return {
    id: batch.id,
    name: batch.name,
    statusLabel: BATCH_STATUS_LABELS[batch.status] ?? batch.status,
    statusTone: SEARCH_STATUS_TONES[batch.status] ?? 'neutral',
    formLabel: searchFormLabel(batch.source, batch.metadata as Record<string, unknown> | null),
    country: batch.country ?? null,
    found: batch.total_candidates ?? 0,
    needsReview: batch.needs_review_count ?? 0,
    approved: (batch.approved_count ?? 0) + (batch.converted_count ?? 0),
    converted: batch.converted_count ?? 0,
    createdAt: batch.created_at,
    createdBy: batch.created_by_user?.full_name ?? batch.owner?.full_name ?? null,
    visibility: batch.visibility ?? 'full',
  };
}

/** Las cifras de arriba salen de las mismas filas de la tabla: siempre cuadran. */
export function summarizeSearches(rows: readonly SearchRow[]): SearchesSummary {
  return {
    searches: rows.length,
    needsReview: rows.reduce((acc, row) => acc + row.needsReview, 0),
    approved: rows.reduce((acc, row) => acc + row.approved, 0),
    open: rows.filter((row) => row.needsReview > 0).length,
  };
}

/** Por revisar, filtrado por una búsqueda. */
export function searchReviewHref(searchId: string): string {
  return `/accounts?tab=prospectos&sourceId=${encodeURIComponent(searchId)}`;
}

/** La búsqueda dentro de Empresas › Búsquedas, resaltada. */
export function searchListHref(searchId: string): string {
  return `/accounts?tab=busquedas&focus=${encodeURIComponent(searchId)}`;
}
