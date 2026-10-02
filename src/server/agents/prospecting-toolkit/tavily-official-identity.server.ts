/**
 * AGENT1-TAVILY-OFFICIAL-IDENTITY-1 — cableado de producción: las fuentes
 * oficiales se construyen UNA vez por corrida (ahí viven los topes de las
 * fuentes en vivo) y el duplicado por identificador fiscal es el canónico.
 */
import { buildColombiaOfficialSourceResolvers } from '@/server/prospect-batches/official-source-resolvers';
import { checkCompanyDuplicate } from './duplicate-checker';
import { enrichTavilyCandidatesWithOfficialIdentity } from './tavily-official-identity';
import type { ProspectSearchCriteria } from '@/server/agents/prospect-intake/types';
import type { ProspectingPipelineCandidate } from './types';

export type TavilyCandidatesEnricher = (
  candidates: readonly ProspectingPipelineCandidate[],
) => Promise<ProspectingPipelineCandidate[]>;

export function buildTavilyOfficialIdentityEnricher(criteria: ProspectSearchCriteria): TavilyCandidatesEnricher {
  const resolvers = buildColombiaOfficialSourceResolvers();
  return (candidates) =>
    enrichTavilyCandidatesWithOfficialIdentity(candidates, criteria, {
      resolvers,
      checkDuplicate: checkCompanyDuplicate,
    });
}
