/**
 * Q3F-5BB.10C2 — Colombia (co_siis) official-source resolver.
 *
 * Adapts the existing SIIS name→NIT matchers into the provider-agnostic
 * `OfficialSourceResolver` contract consumed by
 * `enrichNormalizedProspectWithOfficialSources`. The discovery provider (Lusha,
 * Apollo, …) is irrelevant here — this resolver only sees the common
 * `NormalizedProspectCandidate`.
 *
 * SAFE CLIENT PATTERN: this module is PURE with respect to I/O. It never builds a
 * Supabase client and never reads `process.env`. The read against
 * `source_company_snapshots` (co_siis / CO) arrives through the INJECTED
 * `querySnapshots` function (see `colombia-snapshot-query.ts`, which wraps an
 * approved service-role factory read-only). This keeps env / service-role access
 * OUT of the pure enrichment layer, exactly as required by 10C1.
 *
 * READ-ONLY: the injected query performs SELECTs only. Nothing here can write.
 *
 * Reuses the battle-tested SIIS matchers (`findExactMatch`, `findPartialMatches`,
 * `isNameTooGeneric`, and the Colombia name normalizers) so name→NIT semantics
 * stay identical to `resolveCandidateTaxIdentifierForColombia`.
 */

import {
  normalizeColombiaCompanyName,
  normalizeColombiaCompanyNameExact,
} from '@/server/source-catalog/enrichment/tax-identifier-resolution/normalize-name';
import {
  findExactMatch,
  findPartialMatches,
  isNameTooGeneric,
} from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
} from '../source-enrichment';

/** Colombia official source key (SIIS snapshot). */
export const COLOMBIA_OFFICIAL_SOURCE_KEY = 'co_siis' as const;
/** ISO country this resolver serves. */
export const COLOMBIA_COUNTRY_CODE = 'CO' as const;
/** Colombia fiscal identifier type. Matches the accounts/prospect_candidates CHECK. */
export const COLOMBIA_TAX_IDENTIFIER_TYPE = 'NIT' as const;
/** Confidence of an exact normalized-name match — equals the strong threshold. */
export const COLOMBIA_EXACT_MATCH_CONFIDENCE = 0.85 as const;

/**
 * Injected read-only snapshot query. Returns the raw SIIS rows for a normalized
 * name (exact vs partial). MUST be read-only and MUST degrade to `[]` on any
 * failure so the resolver can fail soft. Never receives or returns secrets.
 */
export type ColombiaSnapshotQuery = (
  normalizedName: string,
  exact: boolean,
) => Promise<Record<string, unknown>[]>;

export interface ColombiaOfficialSourceResolverDeps {
  querySnapshots: ColombiaSnapshotQuery;
}

function notFound(normalizedSearchName: string | null): OfficialSourceEnrichmentResult {
  return {
    status: 'not_found',
    countryCode: COLOMBIA_COUNTRY_CODE,
    sourceKey: COLOMBIA_OFFICIAL_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(normalizedSearchName ? { safeMetadata: { normalizedSearchName } } : {}),
  };
}

/**
 * Build a Colombia (co_siis) `OfficialSourceResolver`. The resolver only attempts
 * candidates whose target country is CO and that carry a usable name; everything
 * else it declines via `canResolve` (the orchestrator then records an
 * unsupported/unavailable result). All work is delegated to the injected,
 * read-only `querySnapshots`.
 */
export function createColombiaOfficialSourceResolver(
  deps: ColombiaOfficialSourceResolverDeps,
): OfficialSourceResolver {
  return {
    countryCode: COLOMBIA_COUNTRY_CODE,
    sourceKey: COLOMBIA_OFFICIAL_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const country = (input.candidate.countryCode ?? input.criteria.countryCode ?? '')
        .toUpperCase();
      if (country !== COLOMBIA_COUNTRY_CODE) return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(
      input: OfficialSourceResolverInput,
    ): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName?.trim() ?? '';
      const domain = input.candidate.domain;
      const website = input.candidate.websiteUrl;

      const exactNormalized = normalizeColombiaCompanyNameExact(name);
      const searchNormalized = normalizeColombiaCompanyName(name);
      if (!exactNormalized || exactNormalized.length < 2) {
        return notFound(searchNormalized || null);
      }

      const searchTokens = searchNormalized.split(' ').filter((t) => t.length > 0);
      if (isNameTooGeneric(searchTokens, domain, website)) {
        // Too generic to resolve reliably — treat as not found (no false NIT).
        return notFound(searchNormalized);
      }

      // ── Exact normalized-name match → STRONG identity (>= 0.85) ──
      const exactRows = await deps.querySnapshots(exactNormalized, true);
      const exact = findExactMatch(exactRows, exactNormalized);
      if (exact && exact.taxIdentifier) {
        return {
          status: 'matched',
          countryCode: COLOMBIA_COUNTRY_CODE,
          sourceKey: COLOMBIA_OFFICIAL_SOURCE_KEY,
          confidence: COLOMBIA_EXACT_MATCH_CONFIDENCE,
          matchMethod: 'normalized_name',
          taxIdentifier: exact.taxIdentifier,
          taxIdentifierType: COLOMBIA_TAX_IDENTIFIER_TYPE,
          legalName: exact.legalName || null,
          warnings: [],
          issues: [],
          safeMetadata: { normalizedSearchName: searchNormalized },
        };
      }

      // ── Partial / ambiguous → keep as a low-confidence SIGNAL (never strong) ──
      const partialRows = await deps.querySnapshots(searchNormalized, false);
      const partial = findPartialMatches(partialRows, searchNormalized);
      const best = partial[0] ?? null;
      const isAmbiguous = exactRows.length > 1 || partial.length > 1;
      if (best && best.taxIdentifier) {
        return {
          status: 'low_confidence_match',
          countryCode: COLOMBIA_COUNTRY_CODE,
          sourceKey: COLOMBIA_OFFICIAL_SOURCE_KEY,
          confidence: best.confidence,
          matchMethod: 'normalized_name',
          taxIdentifier: best.taxIdentifier,
          taxIdentifierType: COLOMBIA_TAX_IDENTIFIER_TYPE,
          legalName: best.legalName || null,
          warnings: [],
          issues: [],
          safeMetadata: {
            normalizedSearchName: searchNormalized,
            ...(isAmbiguous ? { ambiguous: true, candidateCount: partial.length } : {}),
          },
        };
      }

      return notFound(searchNormalized);
    },
  };
}
