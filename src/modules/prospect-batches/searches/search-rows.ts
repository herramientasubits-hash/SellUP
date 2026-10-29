import type { Tone } from '@/lib/tone';
import type { BatchSource, BatchStatus, ProspectBatchWithMeta } from '@/modules/prospect-batches/types';
import type { BulkSearchView } from '@/modules/prospect-batches/bulk-search/bulk-search-view';
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
  industry: string | null;
  found: number;
  needsReview: number;
  approved: number;
  /** Ya son empresas en SellUp: de estas se pueden buscar contactos en masa. */
  converted: number;
  createdAt: string;
  createdBy: string | null;
  /** `assigned`: no la lanzó; las cifras son sólo las empresas que le asignaron. */
  visibility: 'full' | 'assigned';
  /**
   * Sólo en un lote que es ronda de una búsqueda masiva (dueña 28-10: cada lote es
   * su propia fila, para revisarlo aparte; la fila dice de qué masiva salió).
   */
  bulkSearch: {
    id: string;
    label: string;
    /** 1, 2, 3… en el orden en que corrieron. */
    round: number;
    status: BulkSearchView['status'];
    deliveredCount: number;
    targetCount: number;
  } | null;
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

/**
 * Cómo se llama una búsqueda en pantalla (dueña 28-10): como la nombramos en Rumbo,
 * «forma · país · industria» —«Empresas por criterios · México · Seguros»—, no el
 * nombre interno del lote («Agente 1 · Pipeline · … · 28 de oct de 2026»). Sin país
 * ni industria, el nombre guardado sin esa jerga.
 */
export function searchDisplayName(input: {
  formLabel: string;
  country: string | null | undefined;
  industry: string | null | undefined;
  name: string;
}): string {
  const parts = [input.country, input.industry].map((part) => part?.trim()).filter(Boolean);
  if (parts.length > 0) return [input.formLabel, ...parts].join(' · ');
  return input.name
    .replace(/^(Agente 1 · Pipeline · |Agente 1 · |Empresas candidatas · )/, '')
    .replace(/ · \d{1,2} (de )?[a-záéíóú]+\.?( de)? \d{4}$/i, '')
    .trim();
}

/** El nombre de la forma de búsqueda: la de Rumbo si la guardó, si no, el origen. */
export function searchFormLabel(source: BatchSource, metadata: Record<string, unknown> | null | undefined): string {
  const mode = typeof metadata?.search_mode === 'string' ? metadata.search_mode : null;
  if ((source === 'agent_1' || source === 'apollo') && mode && AI_FORM_LABELS[mode]) return AI_FORM_LABELS[mode];
  return SOURCE_FORM_LABELS[source] ?? 'Otra';
}

export function toSearchRow(batch: ProspectBatchWithMeta & { visibility?: 'full' | 'assigned' }): SearchRow {
  const formLabel = searchFormLabel(batch.source, batch.metadata as Record<string, unknown> | null);
  return {
    id: batch.id,
    name: searchDisplayName({ formLabel, country: batch.country, industry: batch.industry, name: batch.name }),
    statusLabel: BATCH_STATUS_LABELS[batch.status] ?? batch.status,
    statusTone: SEARCH_STATUS_TONES[batch.status] ?? 'neutral',
    formLabel,
    country: batch.country ?? null,
    industry: batch.industry ?? null,
    found: batch.total_candidates ?? 0,
    needsReview: batch.needs_review_count ?? 0,
    approved: (batch.approved_count ?? 0) + (batch.converted_count ?? 0),
    converted: batch.converted_count ?? 0,
    createdAt: batch.created_at,
    createdBy: batch.created_by_user?.full_name ?? batch.owner?.full_name ?? null,
    visibility: batch.visibility ?? 'full',
    bulkSearch: null,
  };
}

/** El nombre de la forma de la búsqueda masiva, el mismo del selector de Rumbo. */
export const BULK_SEARCH_FORM_LABEL = 'Muchas empresas por criterios';

/**
 * Marca las filas que son rondas de una búsqueda masiva (dueña 28-10): siguen siendo
 * filas propias —se revisan aparte, no se mezclan—, con la forma «Muchas empresas
 * por criterios» y de qué masiva y en qué ronda salieron.
 */
export function markBulkRounds(rows: readonly SearchRow[], bulkSearches: readonly BulkSearchView[]): SearchRow[] {
  const byBatch = new Map<string, SearchRow['bulkSearch']>();
  for (const search of bulkSearches) {
    search.batchIds.forEach((batchId, index) =>
      byBatch.set(batchId, {
        id: search.id,
        label: search.label,
        round: index + 1,
        status: search.status,
        deliveredCount: search.deliveredCount,
        targetCount: search.targetCount,
      }),
    );
  }
  return rows.map((row) => {
    const bulkSearch = byBatch.get(row.id);
    if (!bulkSearch) return row;
    const base = searchDisplayName({ formLabel: BULK_SEARCH_FORM_LABEL, country: row.country, industry: row.industry, name: row.name });
    return { ...row, name: `${base} · Ronda ${bulkSearch.round}`, formLabel: BULK_SEARCH_FORM_LABEL, bulkSearch };
  });
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
