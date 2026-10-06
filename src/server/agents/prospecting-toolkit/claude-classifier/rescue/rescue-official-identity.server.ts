/**
 * Cableado de producción del número fiscal oficial para el rescate con Claude:
 * los MISMOS resolvedores que Apollo, Tavily y Claude-busca-empresas (SII → RES
 * en Chile, etc.), construidos UNA vez por rescate.
 */
import { buildColombiaOfficialSourceResolvers } from '@/server/prospect-batches/official-source-resolvers';
import { mapWebAiCompanyToProviderDiscoveredCompany } from '@/server/agents/prospect-intake/adapters/tavily';
import { normalizeProviderDiscoveredCompany } from '@/server/agents/prospect-intake/normalize';
import {
  buildOfficialSourceEnrichmentMetadata,
  buildOfficialSourceTypedColumns,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import type { RescueOfficialIdentityResolver } from './rescue-official-identity';

export function buildLiveRescueOfficialIdentityResolver(): RescueOfficialIdentityResolver {
  const resolvers = buildColombiaOfficialSourceResolvers();
  return async (input) => {
    const criteria = { country: input.country ?? input.countryCode ?? '', countryCode: input.countryCode ?? undefined };
    const discovered = mapWebAiCompanyToProviderDiscoveredCompany(
      {
        name: input.name,
        website: input.website,
        domain: input.domain,
        country: input.country,
        countryCode: input.countryCode,
      },
      { provider: 'tavily', searchCriteria: criteria },
    );
    const normalized = normalizeProviderDiscoveredCompany(discovered, criteria);
    const enriched = await enrichNormalizedProspectWithOfficialSources(normalized, criteria, resolvers);
    const columns = buildOfficialSourceTypedColumns(enriched);
    if (!enriched.strongIdentityAvailable || !columns.tax_identifier) return null;
    return {
      columns: { ...columns, tax_identifier: columns.tax_identifier },
      metadata: buildOfficialSourceEnrichmentMetadata(enriched) as unknown as Record<string, unknown>,
    };
  };
}
