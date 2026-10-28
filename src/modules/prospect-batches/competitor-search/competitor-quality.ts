/**
 * Agente 1 · «Competidores de una empresa» — calidad por referencia y por fuente
 * (Fase D de la auditoría del 21-10; puro).
 *
 * Para decidir qué fuente rinde y cuál apagar: de lo que cada una trajo, cuánto
 * aprobó el vendedor y cuánto descartó como «no es competidor» (QA Prod 21-10: la
 * bolsa libre de HubSpot metió a Pfizer y Novo Nordisk; la web trajo laboratorios
 * veterinarios reales).
 */

import { isCompetitorSmallCompany } from './competitor-small-companies';
import { isNotCompetitorDiscard } from '@/server/prospect-batches/competitor-search/competitor-not-competitors';

export type CompetitorQualitySource = 'web' | 'official_registry' | 'hubspot_free_pool' | 'apollo' | 'other';

export const COMPETITOR_QUALITY_SOURCE_LABELS: Record<CompetitorQualitySource, string> = {
  web: 'Rumbo en la web',
  official_registry: 'Registro oficial',
  hubspot_free_pool: 'HubSpot libre',
  apollo: 'Apollo',
  other: 'Otras',
};

export type CompetitorQualityBatch = { id: string; reference_name: string | null };

export type CompetitorQualityCandidate = {
  batch_id: string;
  status: string | null;
  source_primary: string | null;
  review_notes: string | null;
  metadata: unknown;
};

export type CompetitorQualityCounts = {
  found: number;
  approved: number;
  notCompetitor: number;
  small: number;
  inReview: number;
};

export type CompetitorQualityReferenceRow = CompetitorQualityCounts & { referenceName: string; searches: number };
export type CompetitorQualitySourceRow = CompetitorQualityCounts & { source: CompetitorQualitySource };

const EMPTY: CompetitorQualityCounts = { found: 0, approved: 0, notCompetitor: 0, small: 0, inReview: 0 };

/** Rastro que deja el escritor de Apollo («Más como esta» y último recurso). */
export const COMPETITOR_APOLLO_QUERY_TEXT = 'competitor_apollo';

function isCompetitorApolloCandidate(metadata: Record<string, unknown>): boolean {
  const trace = metadata.search_trace as Record<string, unknown> | null | undefined;
  return trace?.query_text === COMPETITOR_APOLLO_QUERY_TEXT;
}

function sourceOf(candidate: CompetitorQualityCandidate): CompetitorQualitySource {
  const metadata = (candidate.metadata ?? {}) as Record<string, unknown>;
  if (metadata.hubspot_free_pool) return 'hubspot_free_pool';
  // QA Prod 22-10: las de Apollo se guardan con source_primary='web_ai'; el rastro dice la verdad.
  if (isCompetitorApolloCandidate(metadata)) return 'apollo';
  switch (candidate.source_primary) {
    case 'web_ai':
      return 'web';
    case 'public_source':
      return 'official_registry';
    case 'apollo':
      return 'apollo';
    default:
      return 'other';
  }
}

function add(counts: CompetitorQualityCounts, candidate: CompetitorQualityCandidate): CompetitorQualityCounts {
  // Las duplicadas (ya en HubSpot o SellUp) no dicen nada de la calidad de la fuente.
  if (candidate.status === 'duplicate') return counts;
  const next = { ...counts, found: counts.found + 1 };
  if (candidate.status === 'approved' || candidate.status === 'converted') next.approved += 1;
  else if (candidate.status === 'needs_review') next.inReview += 1;
  else if (candidate.status === 'discarded') {
    if (isCompetitorSmallCompany(candidate.metadata)) next.small += 1;
    else if (isNotCompetitorDiscard(candidate.review_notes)) next.notCompetitor += 1;
  }
  return next;
}

/** Aprobadas sobre lo ya decidido (aprobadas + «no es competidor»); `null` sin decisiones. */
export function competitorApprovalRate(counts: CompetitorQualityCounts): number | null {
  const decided = counts.approved + counts.notCompetitor;
  return decided === 0 ? null : counts.approved / decided;
}

export function buildCompetitorQuality(
  batches: readonly CompetitorQualityBatch[],
  candidates: readonly CompetitorQualityCandidate[],
): { byReference: CompetitorQualityReferenceRow[]; bySource: CompetitorQualitySourceRow[] } {
  const referenceOfBatch = new Map(batches.map((b) => [b.id, b.reference_name?.trim() || 'Sin referencia']));
  const references = new Map<string, CompetitorQualityReferenceRow>();
  for (const batch of batches) {
    const name = referenceOfBatch.get(batch.id) ?? 'Sin referencia';
    const row = references.get(name) ?? { ...EMPTY, referenceName: name, searches: 0 };
    references.set(name, { ...row, searches: row.searches + 1 });
  }
  const sources = new Map<CompetitorQualitySource, CompetitorQualitySourceRow>();
  for (const candidate of candidates) {
    const name = referenceOfBatch.get(candidate.batch_id);
    if (!name) continue;
    const ref = references.get(name);
    if (ref) references.set(name, { ...ref, ...add(ref, candidate) });
    const source = sourceOf(candidate);
    const row = sources.get(source) ?? { ...EMPTY, source };
    sources.set(source, { ...row, ...add(row, candidate) });
  }
  return {
    byReference: [...references.values()].sort((a, b) => b.found - a.found || a.referenceName.localeCompare(b.referenceName)),
    bySource: [...sources.values()].sort((a, b) => b.found - a.found),
  };
}
