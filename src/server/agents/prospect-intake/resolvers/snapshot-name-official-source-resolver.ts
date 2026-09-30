/**
 * SOURCES-GT-HN-BY-NAME-1 — generic official-source resolver over a loaded
 * snapshot: company name → tax identifier, inside the Agent 1 run.
 *
 * One configuration per country (source key, tax-id type, valid tax-id shape and
 * the name-core normalizer the snapshot was filled with). Same contract and the
 * same conservative rules as the Colombia, República Dominicana, Argentina and
 * Ecuador resolvers:
 *   - STRONG (`matched`, 0.85) only when exactly ONE distinct valid tax id has
 *     the candidate's name core.
 *   - Several ids with the same core → `low_confidence_match` (signal only).
 *   - No partial / fuzzy matching; generic names never query.
 *
 * SAFE CLIENT PATTERN: pure with respect to I/O. The read arrives through the
 * INJECTED `querySnapshots` (see `snapshot-name-query.ts`).
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
} from '../source-enrichment';

/** Confidence of a unique exact-core match — equals the strong threshold. */
export const SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE = 0.85 as const;
/** Confidence of a match kept only as a signal (homonyms). */
export const SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE = 0.6 as const;

/** One snapshot row, reduced to what the resolver needs. */
export interface SnapshotNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
}

/** Injected read-only query: rows whose stored core equals `core`. Fail-soft. */
export type SnapshotNameQuery = (core: string) => Promise<SnapshotNameRow[]>;

export interface SnapshotNameResolverConfig {
  countryCode: string;
  sourceKey: string;
  /** Must be accepted by the prospect_candidates `tax_identifier_type` CHECK. */
  taxIdentifierType: string;
  /** Shape a tax id must have to be offered (company ids only). */
  validTaxId: RegExp;
  /** The SAME normalizer the snapshot's `normalized_legal_name` was filled with. */
  normalizeCore: (name: string | null | undefined) => string;
  querySnapshots: SnapshotNameQuery;
}

/** Build a snapshot-backed `OfficialSourceResolver` for one country. */
export function createSnapshotNameOfficialSourceResolver(
  config: SnapshotNameResolverConfig,
): OfficialSourceResolver {
  const country = config.countryCode.toUpperCase();

  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: country,
    sourceKey: config.sourceKey,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: country,
    sourceKey: config.sourceKey,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== country) return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const core = config.normalizeCore(input.candidate.canonicalName);
      if (core.length < 2) return notFound(core || null);

      const tokens = core.toLowerCase().split(' ').filter((t) => t.length > 0);
      if (isNameTooGeneric(tokens, input.candidate.domain, input.candidate.websiteUrl)) {
        return notFound(core);
      }

      const rows = await config.querySnapshots(core);
      const byId = new Map<string, SnapshotNameRow>();
      for (const row of rows) {
        const taxId = row.taxId?.trim() ?? '';
        // Re-check the core: a looser read can never produce a strong identity.
        if (!config.validTaxId.test(taxId) || row.normalizedLegalName?.trim() !== core) continue;
        if (!byId.has(taxId)) byId.set(taxId, { ...row, taxId });
      }
      const distinct = [...byId.values()];
      if (distinct.length === 0) return notFound(core);

      const best = distinct[0];
      const base = {
        countryCode: country,
        sourceKey: config.sourceKey,
        matchMethod: 'normalized_name' as const,
        taxIdentifier: best.taxId,
        taxIdentifierType: config.taxIdentifierType,
        legalName: best.legalName || null,
        warnings: [],
        issues: [],
      };
      if (distinct.length === 1) {
        return {
          ...base,
          status: 'matched',
          confidence: SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
          safeMetadata: { normalizedSearchName: core },
        };
      }
      return {
        ...base,
        status: 'low_confidence_match',
        confidence: SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
        safeMetadata: { normalizedSearchName: core, ambiguous: true, candidateCount: distinct.length },
      };
    },
  };
}
