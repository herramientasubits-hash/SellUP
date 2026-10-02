/**
 * AGENT1-TAVILY-OFFICIAL-IDENTITY-1 — identificador fiscal oficial para las
 * empresas de Tavily (`web_ai`), con la MISMA costura que ya usa Apollo.
 *
 * Prod 02-10 (Bolivia, 26c12524): 9 empresas de Tavily, 0 con NIT, mientras el
 * registro oficial en vivo (SEPREC) sí lo devolvía. El camino de Tavily nunca
 * pasaba por el enriquecimiento de fuentes oficiales; Apollo sí
 * (`withOfficialSourceIdentity` en `production-runner.server.ts`).
 *
 * Adaptador web_ai → normalización → fuentes oficiales → columnas tipadas y,
 * con identidad fuerte, el chequeo de duplicado por identificador fiscal. El
 * escritor ya sabe leer `officialSourceIdentity` y `duplicateCheck`: no cambia.
 *
 * Nunca falla la corrida: un tropiezo deja la empresa como estaba. Con plazo:
 * las fuentes en vivo tardan (Bolivia 4–8 s por empresa) y Tavily-primero
 * comparte los 300 s de Vercel con Claude y Apollo.
 */

import { mapWebAiCompanyToProviderDiscoveredCompany } from '@/server/agents/prospect-intake/adapters/tavily';
import { normalizeProviderDiscoveredCompany } from '@/server/agents/prospect-intake/normalize';
import {
  enrichNormalizedProspectWithOfficialSources,
  buildOfficialSourceEnrichmentMetadata,
  buildOfficialSourceTypedColumns,
  type OfficialSourceResolver,
} from '@/server/agents/prospect-intake/source-enrichment';
import type { ProspectSearchCriteria } from '@/server/agents/prospect-intake/types';
import type { DuplicateCheckInput, DuplicateCheckResult, ProspectingPipelineCandidate } from './types';

/** Plazo total para EMPEZAR búsquedas nuevas dentro de la corrida. */
export const TAVILY_OFFICIAL_IDENTITY_DEADLINE_MS = 25_000;
/** Búsquedas simultáneas (las fuentes en vivo ya ponen sus propios topes). */
export const TAVILY_OFFICIAL_IDENTITY_CONCURRENCY = 3;

export type TavilyOfficialIdentityDeps = {
  /** Construidos UNA vez por corrida: ahí viven los topes de las fuentes en vivo. */
  resolvers: OfficialSourceResolver[];
  checkDuplicate: (input: DuplicateCheckInput) => Promise<DuplicateCheckResult>;
  nowMs?: () => number;
  deadlineMs?: number;
  concurrency?: number;
};

/** Sólo vale la pena buscar el identificador de lo que el vendedor va a ver. */
export function shouldLookUpOfficialIdentity(candidate: ProspectingPipelineCandidate): boolean {
  if (candidate.officialSourceIdentity) return false;
  const dup = candidate.duplicateCheck?.status;
  if (dup === 'existing_in_sellup' || dup === 'existing_in_hubspot') return false;
  if (candidate.scoring?.recommendedAction === 'discard') return false;
  return candidate.name.trim().length > 0;
}

export async function withTavilyOfficialIdentity(
  candidate: ProspectingPipelineCandidate,
  criteria: ProspectSearchCriteria,
  deps: Pick<TavilyOfficialIdentityDeps, 'resolvers' | 'checkDuplicate'>,
): Promise<ProspectingPipelineCandidate> {
  const discovered = mapWebAiCompanyToProviderDiscoveredCompany(
    {
      name: candidate.name,
      website: candidate.website,
      domain: candidate.domain,
      country: candidate.country,
      countryCode: candidate.countryCode,
      industry: candidate.industry,
      sourceUrl: candidate.sourceUrl,
      snippet: candidate.sourceSnippet,
    },
    { provider: 'tavily', searchCriteria: criteria },
  );
  const normalized = normalizeProviderDiscoveredCompany(discovered, criteria);
  const enriched = await enrichNormalizedProspectWithOfficialSources(normalized, criteria, deps.resolvers);

  const officialSourceIdentity = {
    officialSourceMetadata: buildOfficialSourceEnrichmentMetadata(enriched),
    typedColumns: buildOfficialSourceTypedColumns(enriched),
    strongIdentityAvailable: enriched.strongIdentityAvailable,
  };
  if (!enriched.strongIdentityAvailable || !enriched.taxIdentifier) {
    return { ...candidate, officialSourceIdentity };
  }
  // Con identificador fiscal, el MISMO chequeo de duplicado que Apollo: una
  // empresa ya en SellUp/HubSpot con ese NIT deja de verse como nueva.
  const recheck = await deps
    .checkDuplicate({
      name: candidate.name,
      legalName: enriched.legalName ?? undefined,
      website: candidate.website ?? undefined,
      domain: candidate.domain ?? undefined,
      country: candidate.country,
      countryCode: candidate.countryCode,
      taxIdentifier: enriched.taxIdentifier,
    })
    .catch(() => null);
  return { ...candidate, officialSourceIdentity, ...(recheck ? { duplicateCheck: recheck } : {}) };
}

/**
 * Enriquece las empresas en su orden, con `concurrency` a la vez, y deja de
 * EMPEZAR búsquedas al vencer el plazo (las que no alcanzaron quedan igual).
 */
export async function enrichTavilyCandidatesWithOfficialIdentity(
  candidates: readonly ProspectingPipelineCandidate[],
  criteria: ProspectSearchCriteria,
  deps: TavilyOfficialIdentityDeps,
): Promise<ProspectingPipelineCandidate[]> {
  if (deps.resolvers.length === 0) return [...candidates];
  const now = deps.nowMs ?? Date.now;
  const deadline = now() + (deps.deadlineMs ?? TAVILY_OFFICIAL_IDENTITY_DEADLINE_MS);
  const concurrency = Math.max(1, deps.concurrency ?? TAVILY_OFFICIAL_IDENTITY_CONCURRENCY);
  const out = [...candidates];
  const pending = out
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => shouldLookUpOfficialIdentity(candidate));

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < pending.length && now() < deadline) {
      const { candidate, index } = pending[next++];
      out[index] = await withTavilyOfficialIdentity(candidate, criteria, deps).catch(() => candidate);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  return out;
}
