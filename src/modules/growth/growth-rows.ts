// Cómo lee el equipo de Growth sus búsquedas: sin nombres internos de
// proveedores ni de agentes, con el estado en su color. Puro: se prueba solo.
import type { Tone } from '@/lib/tone';
import type { BatchSource, BatchStatus, BatchesSummary, ProspectBatchWithMeta } from '@/modules/prospect-batches/types';
import { BATCH_STATUS_LABELS } from '@/modules/prospect-batches/types';
import type { GrowthSearchRow, GrowthSummary } from '@/components/growth/growth-workspace';

export const GROWTH_ORIGIN_LABELS: Readonly<Record<BatchSource, string>> = {
  agent_1: 'Búsqueda con IA',
  apollo: 'Búsqueda con IA',
  imported: 'Archivo importado',
  external_import: 'Archivo importado',
  manual: 'Creada a mano',
  socrata_colombia: 'Fuente oficial',
  denue_mexico: 'Fuente oficial',
  datos_gob_cl: 'Fuente oficial',
  other: 'Otra',
};

export const GROWTH_STATUS_TONES: Readonly<Record<BatchStatus, Tone>> = {
  draft: 'neutral',
  generating: 'info',
  ready_for_review: 'warning',
  in_review: 'warning',
  completed: 'positive',
  cancelled: 'neutral',
  failed: 'negative',
};

export function toGrowthSearchRow(batch: ProspectBatchWithMeta): GrowthSearchRow {
  return {
    id: batch.id,
    name: batch.name,
    statusLabel: BATCH_STATUS_LABELS[batch.status] ?? batch.status,
    statusTone: GROWTH_STATUS_TONES[batch.status] ?? 'neutral',
    originLabel: GROWTH_ORIGIN_LABELS[batch.source] ?? 'Otra',
    country: batch.country ?? null,
    found: batch.total_candidates ?? 0,
    needsReview: batch.needs_review_count ?? 0,
    approved: (batch.approved_count ?? 0) + (batch.converted_count ?? 0),
    converted: batch.converted_count ?? 0,
    createdAt: batch.created_at,
    createdBy: batch.created_by_user?.full_name ?? batch.owner?.full_name ?? null,
  };
}

/** Los números de arriba salen de las mismas búsquedas de la tabla: siempre cuadran. */
export function toGrowthSummary(summary: BatchesSummary, rows: readonly GrowthSearchRow[]): GrowthSummary {
  return {
    searches: summary.total,
    needsReview: rows.reduce((acc, row) => acc + row.needsReview, 0),
    approved: summary.total_approved_candidates,
    inReview: summary.ready_for_review + summary.in_review,
  };
}
