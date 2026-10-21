// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — pure eligibility for "Enviar a
// revisión". Mirrors `prospect-review/discard-eligibility.ts`, inverted: a
// discarded disposition may transition to needs_review; an already
// sent-to-review one is an idempotent no-op; anything else is a conflict.
//
// No IO, no DB, no clients — takes a minimal snapshot and returns a decision
// the server action turns into a write.

/** Minimal snapshot the decision needs, independent of the source table. */
export interface DiscardedItemSnapshot {
  /** 'discarded' | 'sent_to_review' for a disposition row, or the raw
   *  `prospect_candidates.status` for a candidate-row item. */
  status: string | null;
  /**
   * «Competidores de una empresa» — competidora con menos de 200 empleados
   * (`isCompetitorSmallCompany`): decisión de la dueña 21-10, se ve en su búsqueda
   * pero no vuelve a revisión (de ahí iría a HubSpot). Ausente = no lo es.
   */
  competitorSmallCompany?: boolean;
}

export type SendToReviewRejectReason = 'status_conflict' | 'competitor_small_company';

export type SendToReviewEligibility =
  | { decision: 'send' }
  | { decision: 'idempotent' }
  | { decision: 'reject'; reason: SendToReviewRejectReason };

/** Statuses that mean "already sent to review" — idempotent success. */
const ALREADY_SENT_STATUSES = new Set(['sent_to_review', 'needs_review']);

/** Statuses eligible to transition to needs_review. */
const DISCARDED_STATUSES = new Set(['discarded']);

export function evaluateSendToReviewEligibility(
  item: DiscardedItemSnapshot,
): SendToReviewEligibility {
  if (item.status != null && ALREADY_SENT_STATUSES.has(item.status)) {
    return { decision: 'idempotent' };
  }
  if (item.status != null && DISCARDED_STATUSES.has(item.status)) {
    if (item.competitorSmallCompany === true) return { decision: 'reject', reason: 'competitor_small_company' };
    return { decision: 'send' };
  }
  return { decision: 'reject', reason: 'status_conflict' };
}
