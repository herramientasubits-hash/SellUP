import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';

/**
 * AGENT2A-CONTACTOS-RECHAZADOS — motivo y fecha del rechazo. Viven en
 * `enrichment_metadata.review` (los escribe `runDiscardCandidate`); se leen con
 * guardas porque el bloque es `unknown` para el tipo de la proyección.
 */
export function rejectionInfo(candidate: Pick<PendingContactCandidate, 'enrichment_metadata'>): {
  reason: string | null;
  reviewedAt: string | null;
} {
  const review = candidate.enrichment_metadata?.review;
  if (!review || typeof review !== 'object') return { reason: null, reviewedAt: null };
  const { reason, reviewed_at: reviewedAt } = review as Record<string, unknown>;
  return {
    reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
    reviewedAt: typeof reviewedAt === 'string' && reviewedAt ? reviewedAt : null,
  };
}
