/**
 * Agente 1 · «Competidores de una empresa» — «Más como esta» y «Sus competidores»
 * (Fase C de la auditoría del 21-10; puro).
 *
 *   - «Más como esta»: desde una competidora que el vendedor considera buena, Apollo
 *     busca empresas parecidas usando como semillas la referencia, esa competidora y
 *     las ya aprobadas del lote (hasta 5). Botón manual: ~2 créditos por clic
 *     (decisión de la dueña 21-10: el gasto de Apollo sólo a demanda).
 *   - «Sus competidores»: la competidora pasa a ser la nueva referencia (expansión
 *     de un salto; la corrida es la de siempre).
 */

import type { CompetitorReference } from './competitor-reference';

/** Estados desde los que tiene sentido usar una competidora como semilla. */
export const MORE_LIKE_THIS_CANDIDATE_STATUSES = ['needs_review', 'approved', 'converted'] as const;

/** Las aprobadas del lote que acompañan a la elegida como semilla (más la referencia = 5). */
export const MORE_LIKE_THIS_EXTRA_APPROVED_SEEDS = 3;

/** Entre dos clics del mismo lote: evita pagar dos veces por un doble clic. */
export const MORE_LIKE_THIS_COOLDOWN_MS = 2 * 60 * 1000;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

export type MoreLikeThisCandidate = {
  id: string;
  name: string;
  domain: string | null;
  status: string | null;
  metadata: unknown;
};

function cleanDomain(value: string | null): string | null {
  const domain = value?.trim().toLowerCase().replace(/^www\./, '') ?? '';
  return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

export function isCompetitorCandidate(metadata: unknown): boolean {
  return asRecord(asRecord(metadata)?.relationship)?.kind === 'competitor_of';
}

export type MoreLikeThisEligibility = { ok: true; domain: string } | { ok: false; reason: 'not_competitor' | 'no_domain' | 'status' };

export function moreLikeThisEligibility(candidate: MoreLikeThisCandidate): MoreLikeThisEligibility {
  if (!isCompetitorCandidate(candidate.metadata)) return { ok: false, reason: 'not_competitor' };
  if (!(MORE_LIKE_THIS_CANDIDATE_STATUSES as readonly string[]).includes(candidate.status ?? '')) {
    return { ok: false, reason: 'status' };
  }
  const domain = cleanDomain(candidate.domain);
  return domain ? { ok: true, domain } : { ok: false, reason: 'no_domain' };
}

/** La elegida primero y luego hasta 3 aprobadas o convertidas del lote, sin repetir. */
export function pickMoreLikeThisSeedDomains(
  chosen: MoreLikeThisCandidate,
  batchCandidates: readonly MoreLikeThisCandidate[],
): string[] {
  const first = cleanDomain(chosen.domain);
  const seeds = first ? [first] : [];
  for (const candidate of batchCandidates) {
    if (seeds.length >= 1 + MORE_LIKE_THIS_EXTRA_APPROVED_SEEDS) break;
    if (candidate.id === chosen.id) continue;
    if (candidate.status !== 'approved' && candidate.status !== 'converted') continue;
    if (!isCompetitorCandidate(candidate.metadata)) continue;
    const domain = cleanDomain(candidate.domain);
    if (domain && !seeds.includes(domain)) seeds.push(domain);
  }
  return seeds;
}

/** «Sus competidores»: la competidora como nueva referencia (lo que el juez y la web necesitan). */
export function toCompetitorOfCompetitorReference(candidate: MoreLikeThisCandidate): CompetitorReference | null {
  const domain = cleanDomain(candidate.domain);
  const name = candidate.name?.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) return null;
  const evidence = asRecord(asRecord(candidate.metadata)?.relationship)?.evidence;
  const description = typeof evidence === 'string' && evidence.trim() ? evidence.trim().slice(0, 300) : null;
  return { name, domain, description, accountId: null };
}

/** Lo que ve el vendedor al terminar (una línea). */
export function describeMoreLikeThisOutcome(outcome: {
  status: string;
  persistedCount: number;
  reason: string | null;
}): string {
  if (outcome.persistedCount > 0) {
    return outcome.persistedCount === 1
      ? 'Apollo encontró 1 competidora nueva: ya está en este lote.'
      : `Apollo encontró ${outcome.persistedCount} competidoras nuevas: ya están en este lote.`;
  }
  switch (outcome.reason) {
    case 'apollo_disabled':
      return 'Apollo no está activo en este momento.';
    case 'apollo_quota_unavailable':
      return 'Se agotó la cuota de Apollo de este mes.';
    case 'country_not_supported':
      return 'Apollo no busca en este país.';
    default:
      return 'Apollo no encontró competidoras nuevas parecidas a esta.';
  }
}
