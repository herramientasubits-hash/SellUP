/**
 * SOURCES-EC-RUC-BY-NAME-1 — Ecuador (ec_scvs) official-source resolver:
 * company name → RUC, inside the Agent 1 run.
 *
 * Adapts the Superintendencia de Compañías snapshot (`ec_scvs`, ≈340 k companies,
 * already loaded) into the provider-agnostic `OfficialSourceResolver` contract,
 * exactly as the Colombia, República Dominicana and Argentina resolvers do. It
 * reads the SNAPSHOT only: nothing here calls SCVS live.
 *
 * SAFE CLIENT PATTERN: pure with respect to I/O. The read arrives through the
 * INJECTED `querySnapshots` (see `ecuador-snapshot-query.ts`).
 *
 * `ec_scvs.normalized_legal_name` holds the company-name CORE computed by
 * `normalizeEcCompanyCore` (filled by a one-off data backfill, 30-09-2026). If
 * the snapshot is ever re-imported without re-running that backfill the column is
 * empty and this resolver simply finds nothing (fail-soft, never a wrong RUC).
 *
 * Conservative by design:
 *   - STRONG (`matched`, 0.85) only when exactly ONE distinct company RUC
 *     (13 digits ending in 001) has that core. SCVS can hold several expedientes
 *     for one RUC: they count once.
 *   - Several RUCs with the same core → `low_confidence_match` (signal only).
 *   - Companies «EN LIQUIDACIÓN» keep that text in their core and never match an
 *     active company name.
 *   - No partial / fuzzy matching; generic names never query.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import { normalizeEcCompanyCore } from '@/server/source-catalog/connectors/ec-scvs/ec-company-name-core';

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
} from '../source-enrichment';

/** Superintendencia de Compañías snapshot source key. */
export const ECUADOR_OFFICIAL_SOURCE_KEY = 'ec_scvs' as const;
/** ISO country this resolver serves. */
export const ECUADOR_COUNTRY_CODE = 'EC' as const;
/** Ecuadorian fiscal identifier type. Matches the prospect_candidates CHECK. */
export const ECUADOR_TAX_IDENTIFIER_TYPE = 'RUC' as const;
/** Confidence of a unique exact-core match — equals the strong threshold. */
export const ECUADOR_EXACT_MATCH_CONFIDENCE = 0.85 as const;
/** Confidence of a match kept only as a signal (homonyms). */
export const ECUADOR_SIGNAL_MATCH_CONFIDENCE = 0.6 as const;

/** Company RUC: 13 digits ending in 001 (principal establishment). */
const COMPANY_RUC = /^\d{10}001$/;

/** One registry row, reduced to what the resolver needs. */
export interface EcuadorSnapshotRow {
  ruc: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
}

/**
 * Injected read-only query: rows whose stored core equals `core`. MUST be
 * read-only and MUST degrade to `[]` on any failure.
 */
export type EcuadorSnapshotQuery = (core: string) => Promise<EcuadorSnapshotRow[]>;

export interface EcuadorOfficialSourceResolverDeps {
  querySnapshots: EcuadorSnapshotQuery;
}

function notFound(core: string | null): OfficialSourceEnrichmentResult {
  return {
    status: 'not_found',
    countryCode: ECUADOR_COUNTRY_CODE,
    sourceKey: ECUADOR_OFFICIAL_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  };
}

/** Build an Ecuador (ec_scvs) `OfficialSourceResolver`. */
export function createEcuadorOfficialSourceResolver(
  deps: EcuadorOfficialSourceResolverDeps,
): OfficialSourceResolver {
  return {
    countryCode: ECUADOR_COUNTRY_CODE,
    sourceKey: ECUADOR_OFFICIAL_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const country = (input.candidate.countryCode ?? input.criteria.countryCode ?? '')
        .toUpperCase();
      if (country !== ECUADOR_COUNTRY_CODE) return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(
      input: OfficialSourceResolverInput,
    ): Promise<OfficialSourceEnrichmentResult> {
      const core = normalizeEcCompanyCore(input.candidate.canonicalName);
      if (core.length < 2) return notFound(core || null);

      const tokens = core.toLowerCase().split(' ').filter((t) => t.length > 0);
      if (isNameTooGeneric(tokens, input.candidate.domain, input.candidate.websiteUrl)) {
        return notFound(core);
      }

      const rows = await deps.querySnapshots(core);
      const byRuc = new Map<string, EcuadorSnapshotRow>();
      for (const row of rows) {
        const ruc = row.ruc?.trim() ?? '';
        // Re-check the core: a looser read can never produce a strong identity.
        if (!COMPANY_RUC.test(ruc) || row.normalizedLegalName?.trim() !== core) continue;
        if (!byRuc.has(ruc)) byRuc.set(ruc, { ...row, ruc });
      }
      const distinct = [...byRuc.values()];
      if (distinct.length === 0) return notFound(core);

      const best = distinct[0];
      if (distinct.length === 1) {
        return {
          status: 'matched',
          countryCode: ECUADOR_COUNTRY_CODE,
          sourceKey: ECUADOR_OFFICIAL_SOURCE_KEY,
          confidence: ECUADOR_EXACT_MATCH_CONFIDENCE,
          matchMethod: 'normalized_name',
          taxIdentifier: best.ruc,
          taxIdentifierType: ECUADOR_TAX_IDENTIFIER_TYPE,
          legalName: best.legalName || null,
          warnings: [],
          issues: [],
          safeMetadata: { normalizedSearchName: core },
        };
      }

      return {
        status: 'low_confidence_match',
        countryCode: ECUADOR_COUNTRY_CODE,
        sourceKey: ECUADOR_OFFICIAL_SOURCE_KEY,
        confidence: ECUADOR_SIGNAL_MATCH_CONFIDENCE,
        matchMethod: 'normalized_name',
        taxIdentifier: best.ruc,
        taxIdentifierType: ECUADOR_TAX_IDENTIFIER_TYPE,
        legalName: best.legalName || null,
        warnings: [],
        issues: [],
        safeMetadata: { normalizedSearchName: core, ambiguous: true, candidateCount: distinct.length },
      };
    },
  };
}
