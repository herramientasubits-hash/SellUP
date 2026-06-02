/**
 * Rehydrate Structured Candidate Enrichment — Hito 16AK.6B
 *
 * Helper puro para recalcular enrichment de candidatos RUES existentes.
 * Lee campos disponibles en la fila DB y calcula nuevos valores.
 *
 * GARANTÍAS:
 *   - No llama HubSpot.
 *   - No toca accounts ni converted_account_id.
 *   - No cambia status/review_status/duplicate_status.
 *   - No modifica commercial_trace ni hubspot_trace.
 *   - Preserva source_trace, duplicate_check, y metadata existente.
 */

import { getCiiuSectorDescription } from '../../source-catalog/connectors/socrata-colombia/normalizers';
import { buildInitialReviewFlags } from './structured-candidate-helpers';
import type { ReviewFlag } from './structured-candidate-types';

// ── Tipo de entrada: subconjunto de columnas DB ───────────────

export type CandidateForRehydration = {
  id: string;
  name: string;
  tax_identifier: string | null;
  website: string | null;
  city: string | null;
  region: string | null;
  review_flags: ReviewFlag[] | null;
  metadata: Record<string, unknown>;
  // Columnas estructuradas (en DB pero no en ProspectCandidate TS type)
  sector_code?: string | null;
  sector_description?: string | null;
  legal_status?: string | null;
};

// ── Resultado del helper ──────────────────────────────────────

export type RehydratedEnrichment = {
  sector_description: string | null;
  review_flags: ReviewFlag[];
  data_completeness_score: number;
  metadata_enrichment_patch: Record<string, unknown>;
};

// ── Cálculo de completitud ────────────────────────────────────

function calculateCompleteness(candidate: CandidateForRehydration, sectorDescription: string | null): {
  score: number;
  missingFields: string[];
} {
  const missingFields: string[] = [];
  let score = 0;

  if (candidate.tax_identifier) { score += 20; } else { missingFields.push('tax_id'); }
  if (candidate.website) { score += 20; } else { missingFields.push('website'); }
  if (candidate.sector_code || sectorDescription) { score += 20; } else { missingFields.push('sector'); }
  if (candidate.city || candidate.region) { score += 20; } else { missingFields.push('city_region'); }
  // employee_count siempre null para RUES
  missingFields.push('company_size');

  return { score, missingFields };
}

// ── Helper principal ──────────────────────────────────────────

/**
 * Recalcula enrichment para un candidato RUES existente usando los campos
 * disponibles en la fila DB. Función pura — sin I/O.
 */
export function rehydrateStructuredCandidateEnrichment(
  candidate: CandidateForRehydration,
): RehydratedEnrichment {
  // Recalcular sector description desde CIIU
  const sectorDescription = getCiiuSectorDescription(candidate.sector_code ?? null);

  // Recalcular review_flags desde los datos disponibles
  const baseFlags = buildInitialReviewFlags({
    taxId: candidate.tax_identifier,
    website: candidate.website,
    linkedinUrl: null,
    decisionMakerName: null,
    sectorCode: candidate.sector_code ?? null,
    legalStatus: candidate.legal_status ?? null,
    source: 'rues',
    email: null,
    phone: null,
    companyName: candidate.name,
  });

  // Preservar flags de tamaño y HubSpot existentes — no los pisar
  const existingFlags: ReviewFlag[] = candidate.review_flags ?? [];
  const sizeAndHubspotFlags: ReviewFlag[] = existingFlags.filter((f) =>
    f === 'size_unknown' ||
    f === 'size_confirmed' ||
    f === 'size_estimated' ||
    f === 'size_below_threshold' ||
    f === 'size_estimated_below_threshold' ||
    f === 'hubspot_existing_customer' ||
    f === 'hubspot_existing_prospect' ||
    f === 'hubspot_recyclable_prospect' ||
    f === 'possible_duplicate'
  );

  const mergedFlags: ReviewFlag[] = Array.from(
    new Set([...sizeAndHubspotFlags, 'size_unknown' as ReviewFlag, ...baseFlags])
  );

  // Calcular completitud
  const { score, missingFields } = calculateCompleteness(candidate, sectorDescription);

  // Construir patch de metadata.enrichment
  const existingEnrichment = (candidate.metadata?.enrichment as Record<string, unknown>) ?? {};
  const metadataEnrichmentPatch: Record<string, unknown> = {
    ...existingEnrichment,
    sector_description: sectorDescription,
    economic_activity: candidate.sector_code ?? null,
    legal_status: candidate.legal_status ?? null,
    data_completeness_score: score,
    missing_fields: missingFields,
    city: candidate.city ?? existingEnrichment.city ?? null,
    region: candidate.region ?? existingEnrichment.region ?? null,
    rehydrated_at: new Date().toISOString(),
  };

  return {
    sector_description: sectorDescription,
    review_flags: mergedFlags,
    data_completeness_score: score,
    metadata_enrichment_patch: metadataEnrichmentPatch,
  };
}
