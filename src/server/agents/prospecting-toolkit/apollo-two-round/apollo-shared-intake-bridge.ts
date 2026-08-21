/**
 * AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1
 *
 * Wires the Apollo macro-v2 runtime into the EXISTING shared, provider-neutral
 * intake seam (`@/server/agents/prospect-intake`) instead of a parallel
 * Apollo-specific reimplementation. Apollo query planning, pagination,
 * bootstrap, purchase authorization, organization enrichment, macro evidence,
 * macro admission, caps, and budget are UNCHANGED — this module only adds the
 * missing leg AFTER a candidate is built and BEFORE the canonical writer:
 *
 *   ProspectingPipelineCandidate (already built by buildProspectingPipelineCandidate)
 *     → mapApolloCompanyToProviderDiscoveredCompany   (existing adapter)
 *     → normalizeProviderDiscoveredCompany            (existing normalizer)
 *     → enrichNormalizedProspectWithOfficialSources   (existing enrichment)
 *     → (strong identity) → checkCompanyDuplicate again with taxIdentifier
 *                            (existing tax-aware SellUp/HubSpot dedup — see
 *                            sellup-duplicate-checker.ts § 2 and
 *                            hubspot-duplicate-checker.ts, both already read
 *                            `taxIdentifier`/`taxIdentifierCandidate`)
 *
 * TWO-LAYER DEDUPE PRESERVED (§ 13 of the adoption brief): the cheap pre-spend
 * dedupe (domain/country/platform/ownership/SellUp/HubSpot/cooldown) already
 * ran during round processing, BEFORE any paid Apollo enrichment. This module
 * runs strictly AFTER that — on candidates already selected to persist — and
 * only RE-CHECKS with the stronger tax signal. It never replaces the cheap
 * layer and never runs before it.
 *
 * SAFE CLIENT PATTERN (§ 8): resolvers come from the SAME provider-neutral
 * factory the Lusha flow also calls (`@/server/prospect-batches/
 * official-source-resolvers.ts` — `buildColombiaOfficialSourceResolvers`,
 * shared, not duplicated) — the co_siis Supabase read is injected via
 * `createColombiaOfficialSourceResolver` + the approved service-role factory,
 * never inlined here. This module never imports the Apollo runtime, never
 * calls Apollo/Lusha/Tavily, and never writes.
 *
 * NO new duplicate-check implementation, NO new official-source resolver
 * implementation, NO new identity-key builder — every piece is reused as-is.
 */

import { mapApolloCompanyToProviderDiscoveredCompany } from '@/server/agents/prospect-intake/adapters/apollo';
import type { ApolloRawOrganization } from '@/server/agents/prospect-intake/adapters/apollo';
import { normalizeProviderDiscoveredCompany } from '@/server/agents/prospect-intake/normalize';
import {
  enrichNormalizedProspectWithOfficialSources,
  buildOfficialSourceEnrichmentMetadata,
  buildOfficialSourceTypedColumns,
  type OfficialSourceResolver,
  type EnrichedProspectCandidateIdentity,
} from '@/server/agents/prospect-intake/source-enrichment';
import type { ProspectSearchCriteria } from '@/server/agents/prospect-intake/types';
import { checkCompanyDuplicate } from '../duplicate-checker';
import type { DuplicateCheckResult, ProspectingPipelineCandidate, WebSearchResult } from '../types';

// ============================================================
// Apollo WebSearchResult → ApolloRawOrganization (pure, no runtime import)
// ============================================================

/**
 * The shape the Apollo organizations search provider already stamps onto every
 * `WebSearchResult.metadata.apollo_profile`
 * (see `web-search-providers/apollo-organizations-search-provider.ts`
 * `ApolloProfileMetadata`). Read defensively — never throws on a missing or
 * malformed field.
 */
interface ApolloProfileMetadataShape {
  organization_id?: unknown;
  website_url?: unknown;
  primary_domain?: unknown;
  linkedin_url?: unknown;
  industry?: unknown;
  estimated_num_employees?: unknown;
  city?: unknown;
  country?: unknown;
  short_description?: unknown;
}

function readApolloProfile(result: WebSearchResult): ApolloProfileMetadataShape | null {
  const metadata = result.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const profile = (metadata as Record<string, unknown>)['apollo_profile'];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  return profile as ApolloProfileMetadataShape;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Maps the Apollo `WebSearchResult` the runner already has (title/url + the
 * `apollo_profile` metadata the search provider stamped) into the
 * `ApolloRawOrganization` shape the EXISTING adapter expects. Pure, no fetch,
 * no Apollo runtime import — reads only what the provider already captured.
 *
 * `organization_naics_codes` / `organization_sic_codes` / `state` /
 * `organization_num_employees_ranges` are not part of `ApolloProfileMetadata`
 * today, so they are intentionally omitted (never invented) — the adapter and
 * normalizer both treat every one of these as optional.
 */
export function mapApolloWebSearchResultToRawOrganization(
  result: WebSearchResult,
): ApolloRawOrganization {
  const profile = readApolloProfile(result);
  return {
    id: str(profile?.organization_id),
    organization_id: str(profile?.organization_id),
    name: str(result.title),
    website_url: str(profile?.website_url) ?? (str(result.url) ? result.url : null),
    domain: str(profile?.primary_domain),
    primary_domain: str(profile?.primary_domain),
    linkedin_url: str(profile?.linkedin_url),
    industry: str(profile?.industry),
    estimated_num_employees: num(profile?.estimated_num_employees),
    country: str(profile?.country),
    city: str(profile?.city),
    short_description: str(profile?.short_description),
  };
}

// ============================================================
// Outcome
// ============================================================

export interface ApolloOfficialIdentityOutcome {
  /** Bounded, PII-safe projection for `prospect_candidates.metadata`. */
  officialSourceMetadata: ReturnType<typeof buildOfficialSourceEnrichmentMetadata>;
  /** Bounded typed columns — `null` unless a STRONG match was found. */
  typedColumns: ReturnType<typeof buildOfficialSourceTypedColumns>;
  strongIdentityAvailable: boolean;
  /**
   * Present only when a strong identity was found: the EXISTING canonical
   * duplicate checker re-run with the tax identifier now available. `null`
   * when no strong identity was found — the original cheap-layer
   * `duplicateCheck` on the candidate stays authoritative.
   */
  strongDuplicateRecheck: DuplicateCheckResult | null;
}

const EMPTY_OUTCOME_TEMPLATE = (
  enriched: EnrichedProspectCandidateIdentity,
): ApolloOfficialIdentityOutcome => ({
  officialSourceMetadata: buildOfficialSourceEnrichmentMetadata(enriched),
  typedColumns: buildOfficialSourceTypedColumns(enriched),
  strongIdentityAvailable: enriched.strongIdentityAvailable,
  strongDuplicateRecheck: null,
});

/**
 * Runs the shared official-source seam for one already-built Apollo candidate
 * and, when a strong identity is found, re-runs the EXISTING tax-aware
 * duplicate checker (`checkCompanyDuplicate` already reads `taxIdentifier` /
 * `taxIdentifierCandidate` in both `sellup-duplicate-checker.ts` and
 * `hubspot-duplicate-checker.ts` — see § 12 of the adoption brief). Never
 * throws: official-source resolver errors are fail-soft by the shared
 * enrichment orchestrator's default policy.
 */
export async function deriveOfficialIdentityForApolloCandidate(params: {
  candidate: ProspectingPipelineCandidate;
  webSearchResult: WebSearchResult | null;
  criteria: ProspectSearchCriteria;
  resolvers: OfficialSourceResolver[];
}): Promise<ApolloOfficialIdentityOutcome> {
  const { candidate, webSearchResult, criteria, resolvers } = params;

  const rawOrganization = webSearchResult
    ? mapApolloWebSearchResultToRawOrganization(webSearchResult)
    : {
        name: candidate.name,
        website_url: candidate.website,
        domain: candidate.domain,
        country: candidate.country,
      };

  const discovered = mapApolloCompanyToProviderDiscoveredCompany(rawOrganization, {
    searchCriteria: criteria,
  });
  const normalized = normalizeProviderDiscoveredCompany(discovered, criteria);
  const enriched = await enrichNormalizedProspectWithOfficialSources(
    normalized,
    criteria,
    resolvers,
  );

  if (!enriched.strongIdentityAvailable || !enriched.taxIdentifier) {
    return EMPTY_OUTCOME_TEMPLATE(enriched);
  }

  // § 12 / § 22 / § 23 — strong post-identity duplicate recheck. The cheap
  // pre-spend layer already ran (name/domain/website) before any paid
  // enrichment; this is the SECOND, stronger layer that only a tax identifier
  // can unlock, reusing the exact same canonical duplicate checker.
  const strongDuplicateRecheck = await checkCompanyDuplicate({
    name: candidate.name,
    legalName: enriched.legalName ?? undefined,
    website: candidate.website ?? undefined,
    domain: candidate.domain ?? undefined,
    country: candidate.country,
    countryCode: candidate.countryCode,
    taxIdentifier: enriched.taxIdentifier,
  });

  return {
    officialSourceMetadata: buildOfficialSourceEnrichmentMetadata(enriched),
    typedColumns: buildOfficialSourceTypedColumns(enriched),
    strongIdentityAvailable: true,
    strongDuplicateRecheck,
  };
}
