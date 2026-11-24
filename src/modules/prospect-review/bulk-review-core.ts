// Prod 24-11 — aprobar y descartar en masa en «Por revisar». Parte pura (sin IO): validar
// los ids que llegan del navegador y resumir lo que pasó con cada uno.

/** Como mucho, prospectos por descarte en masa. */
export const BULK_REVIEW_MAX_IDS = 50;
/** Aprobar crea cada empresa (y su ficha en HubSpot), de a una: menos por vez. */
export const BULK_APPROVE_MAX_IDS = 25;

export function bulkReviewMaxIds(mode: 'approve' | 'discard'): number {
  return mode === 'approve' ? BULK_APPROVE_MAX_IDS : BULK_REVIEW_MAX_IDS;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BulkReviewError = 'empty' | 'too_many' | 'invalid_ids' | 'invalid_reason';

export type BulkReviewItem = { id: string; ok: true } | { id: string; ok: false; reason: string };

export type BulkReviewResult =
  | { ok: true; done: number; failed: { id: string; reason: string }[] }
  | { ok: false; error: BulkReviewError };

/** Ids del navegador: dato no confiable. Únicos, con formato de id, con tope. */
export function normalizeBulkReviewIds(
  raw: unknown,
  max: number = BULK_REVIEW_MAX_IDS,
): { ok: true; ids: string[] } | { ok: false; error: BulkReviewError } {
  if (!Array.isArray(raw)) return { ok: false, error: 'invalid_ids' };
  if (raw.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) return { ok: false, error: 'invalid_ids' };
  const ids = [...new Set(raw as string[])];
  if (ids.length === 0) return { ok: false, error: 'empty' };
  if (ids.length > max) return { ok: false, error: 'too_many' };
  return { ok: true, ids };
}

export function summarizeBulkReview(items: readonly BulkReviewItem[]): BulkReviewResult {
  return {
    ok: true,
    done: items.filter((i) => i.ok).length,
    failed: items.flatMap((i) => (i.ok ? [] : [{ id: i.id, reason: i.reason }])),
  };
}

/** Por qué una no se pudo, en palabras del vendedor (agrupado en el aviso final). */
export function bulkReviewFailureLabel(reason: string): string {
  switch (reason) {
    case 'needs_duplicate_confirmation':
    case 'needs_hubspot_match_confirmation':
      return 'posible duplicado o ya en HubSpot: revísalas una por una';
    case 'duplicate_blocked':
      return 'duplicadas';
    case 'needs_growth_review':
      return 'las decide Growth (posible duplicado o ya en HubSpot)';
    case 'needs_assignee':
      return 'sin responsable asignado';
    case 'not_allowed':
      return 'sin permiso para decidirlas';
    case 'status_conflict':
    case 'not_clean_production':
      return 'ya no estaban por revisar';
    default:
      return 'no se pudieron procesar';
  }
}

/** «3 posible duplicado…; 1 sin permiso…». Vacío si no hubo fallas. */
export function bulkReviewFailureSummary(failed: readonly { reason: string }[]): string {
  const counts = new Map<string, number>();
  for (const f of failed) {
    const label = bulkReviewFailureLabel(f.reason);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, n]) => `${n} ${label}`).join('; ');
}

export const BULK_REVIEW_ERROR_MESSAGES: Record<BulkReviewError, string> = {
  empty: 'No hay prospectos marcados.',
  too_many: `Marca menos prospectos: como mucho ${BULK_APPROVE_MAX_IDS} para aprobar y ${BULK_REVIEW_MAX_IDS} para descartar.`,
  invalid_ids: 'No se pudo leer la selección. Vuelve a marcarlos.',
  invalid_reason: 'Elige un motivo de descarte.',
};
