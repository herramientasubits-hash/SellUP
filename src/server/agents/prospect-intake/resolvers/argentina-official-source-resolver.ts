/**
 * SOURCES-AR-CUIT-BY-NAME-1 — Argentina (ar_rns_registry) official-source
 * resolver: company name → CUIT, inside the Agent 1 run.
 *
 * Adapts the Registro Nacional de Sociedades (≈1,19 M sociedades with an ACTIVE
 * principal activity in ARCA, loaded as `ar_rns_registry`) into the
 * provider-agnostic `OfficialSourceResolver` contract, exactly as the Colombia
 * (NIT) and República Dominicana (RNC) resolvers do.
 *
 * SAFE CLIENT PATTERN: pure with respect to I/O. The read arrives through the
 * INJECTED `querySnapshots` (see `argentina-snapshot-query.ts`).
 *
 * The registry stores, in `normalized_legal_name`, the company-name CORE computed
 * by `normalizeArCompanyCore` at load time. The resolver computes the same core
 * for the candidate and asks for an exact match — one indexed lookup.
 *
 * Conservative by design (a wrong CUIT would merge two different companies into
 * one identity downstream):
 *   - STRONG (`matched`, 0.85) only when exactly ONE distinct legal-entity CUIT
 *     (prefix 30/33/34) has that core.
 *   - Several CUITs with the same core → `low_confidence_match` (signal only).
 *   - No partial / fuzzy matching; generic names never query.
 *
 * SOURCES-AR-E2E-1 — the lookup walks closed, exact-name TIERS
 * (`buildArRegistryLookupTiers`): the core as is; core + a composite legal form
 * the load-time core keeps («ARCOR» → «ARCOR S A I C»); with/without a trailing
 * «ARGENTINA»; two or three words joined («MERCADO LIBRE» → «MERCADOLIBRE»). The
 * FIRST tier that finds any CUIT decides, with the same one-CUIT rule; later
 * tiers are never read. Still exact names only — never a prefix or fuzzy read.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  buildArRegistryLookupTiers,
  normalizeArCompanyCore,
  type ArRegistryLookupTierKind,
} from '@/server/source-catalog/connectors/rns-argentina/ar-company-name-core';

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
} from '../source-enrichment';

/** Registro Nacional de Sociedades (activas) source key. */
export const ARGENTINA_OFFICIAL_SOURCE_KEY = 'ar_rns_registry' as const;
/** ISO country this resolver serves. */
export const ARGENTINA_COUNTRY_CODE = 'AR' as const;
/** Argentine fiscal identifier type. Matches the prospect_candidates CHECK. */
export const ARGENTINA_TAX_IDENTIFIER_TYPE = 'CUIT' as const;
/** Confidence of a unique exact-core match — equals the strong threshold. */
export const ARGENTINA_EXACT_MATCH_CONFIDENCE = 0.85 as const;
/** Confidence of a match kept only as a signal (homonyms). */
export const ARGENTINA_SIGNAL_MATCH_CONFIDENCE = 0.6 as const;

/** CUIT of a legal entity: 11 digits, prefix 30, 33 or 34. */
const LEGAL_ENTITY_CUIT = /^(30|33|34)\d{9}$/;

/** One registry row, reduced to what the resolver needs. */
export interface ArgentinaSnapshotRow {
  cuit: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
}

/**
 * Injected read-only query: rows whose stored name equals ONE of `names`
 * (exact). MUST be read-only and MUST degrade to `[]` on any failure.
 */
export type ArgentinaSnapshotQuery = (names: readonly string[]) => Promise<ArgentinaSnapshotRow[]>;

export interface ArgentinaOfficialSourceResolverDeps {
  querySnapshots: ArgentinaSnapshotQuery;
}

function notFound(core: string | null): OfficialSourceEnrichmentResult {
  return {
    status: 'not_found',
    countryCode: ARGENTINA_COUNTRY_CODE,
    sourceKey: ARGENTINA_OFFICIAL_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  };
}

/** Build an Argentina (ar_rns_registry) `OfficialSourceResolver`. */
export function createArgentinaOfficialSourceResolver(
  deps: ArgentinaOfficialSourceResolverDeps,
): OfficialSourceResolver {
  return {
    countryCode: ARGENTINA_COUNTRY_CODE,
    sourceKey: ARGENTINA_OFFICIAL_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const country = (input.candidate.countryCode ?? input.criteria.countryCode ?? '')
        .toUpperCase();
      if (country !== ARGENTINA_COUNTRY_CODE) return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(
      input: OfficialSourceResolverInput,
    ): Promise<OfficialSourceEnrichmentResult> {
      const core = normalizeArCompanyCore(input.candidate.canonicalName);
      if (core.length < 2) return notFound(core || null);

      const tokens = core.toLowerCase().split(' ').filter((t) => t.length > 0);
      if (isNameTooGeneric(tokens, input.candidate.domain, input.candidate.websiteUrl)) {
        return notFound(core);
      }

      for (const tier of buildArRegistryLookupTiers(core)) {
        // A variant core («CENCOSUD» from «CENCOSUD ARGENTINA») must pass the same
        // generic-name gate as the candidate's own core.
        if (tier.core !== core) {
          const variantTokens = tier.core.toLowerCase().split(' ').filter((t) => t.length > 0);
          if (isNameTooGeneric(variantTokens, input.candidate.domain, input.candidate.websiteUrl)) {
            continue;
          }
        }
        const asked = new Set(tier.names);
        const rows = await deps.querySnapshots(tier.names);
        const byCuit = new Map<string, ArgentinaSnapshotRow>();
        for (const row of rows) {
          const cuit = row.cuit?.trim() ?? '';
          // Re-check the name: a looser read can never produce a strong identity.
          const stored = row.normalizedLegalName?.trim() ?? '';
          if (!LEGAL_ENTITY_CUIT.test(cuit) || !asked.has(stored)) continue;
          if (!byCuit.has(cuit)) byCuit.set(cuit, { ...row, cuit });
        }
        const distinct = [...byCuit.values()];
        if (distinct.length > 0) return decide(core, tier.kind, distinct);
      }
      return notFound(core);
    },
  };
}

function decide(
  core: string,
  lookupTier: ArRegistryLookupTierKind,
  distinct: ArgentinaSnapshotRow[],
): OfficialSourceEnrichmentResult {
  const best = distinct[0];
  if (distinct.length === 1) {
    return {
      status: 'matched',
      countryCode: ARGENTINA_COUNTRY_CODE,
      sourceKey: ARGENTINA_OFFICIAL_SOURCE_KEY,
      confidence: ARGENTINA_EXACT_MATCH_CONFIDENCE,
      matchMethod: 'normalized_name',
      taxIdentifier: best.cuit,
      taxIdentifierType: ARGENTINA_TAX_IDENTIFIER_TYPE,
      legalName: best.legalName || null,
      warnings: [],
      issues: [],
      safeMetadata: { normalizedSearchName: core, lookupTier },
    };
  }

  return {
    status: 'low_confidence_match',
    countryCode: ARGENTINA_COUNTRY_CODE,
    sourceKey: ARGENTINA_OFFICIAL_SOURCE_KEY,
    confidence: ARGENTINA_SIGNAL_MATCH_CONFIDENCE,
    matchMethod: 'normalized_name',
    taxIdentifier: best.cuit,
    taxIdentifierType: ARGENTINA_TAX_IDENTIFIER_TYPE,
    legalName: best.legalName || null,
    warnings: [],
    issues: [],
    safeMetadata: {
      normalizedSearchName: core,
      lookupTier,
      ambiguous: true,
      candidateCount: distinct.length,
    },
  };
}
