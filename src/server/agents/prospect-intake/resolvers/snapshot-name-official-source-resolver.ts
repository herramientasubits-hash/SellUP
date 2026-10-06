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
import { normalizeCompanyNameCore } from '@/server/source-catalog/company-name-core';

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
  OfficialWorkforce,
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
  /**
   * SOURCES-BO-BRAND-SIGNAL-1 — fila cuyo núcleo NO es el del candidato pero que la
   * fuente propone porque la marca aparece dentro de su razón social («Mersur» →
   * AGENCIA DESPACHANTE DE ADUANA MERSUR S.R.L.). Nunca da un número fiscal fuerte:
   * sólo una pista (`low_confidence_match`), y sólo si no hubo coincidencia exacta.
   */
  brandSignal?: boolean;
  /** SOURCES-CL-SII-REGISTRY-1 — trabajadores del registro; sólo viajan si el match es fuerte. */
  workforce?: OfficialWorkforce | null;
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
  /**
   * SOURCES-CO-RUES-LIVE-NIT-1 — when true, a candidate whose name core is ONE
   * word («Almaviva», «Supersalud») never becomes strong: a bare brand often
   * coincides with a different, unrelated registered company. It stays a signal.
   * A one-word name that CARRIES its legal form («Altipal S.A.S») is a legal name,
   * not a bare brand, and can still be strong.
   */
  singleWordIsSignalOnly?: boolean;
  /**
   * SOURCES-DO-SIZE-SIGNAL-1 — when true, NO match of this source is ever strong:
   * a unique exact core is kept as a signal (`low_confidence_match`). For sources
   * keyed by something weaker than the legal name, e.g. the DGII trade name
   * («CODETEL»): many companies trade under a name that is not theirs alone.
   * Several companies with that core give `not_found`: no arbitrary number.
   */
  signalOnly?: boolean;
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
      if (distinct.length === 0) {
        // Sin coincidencia exacta: una marca dentro de UNA sola razón social es,
        // como mucho, una pista para revisar. Nunca llena las columnas fiscales.
        const brandIds = new Map<string, SnapshotNameRow>();
        for (const row of rows) {
          const taxId = row.taxId?.trim() ?? '';
          if (row.brandSignal !== true || !config.validTaxId.test(taxId)) continue;
          if (!brandIds.has(taxId)) brandIds.set(taxId, { ...row, taxId });
        }
        const brand = [...brandIds.values()];
        if (brand.length !== 1) return notFound(core);
        return {
          status: 'low_confidence_match',
          countryCode: country,
          sourceKey: config.sourceKey,
          confidence: SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
          matchMethod: 'normalized_name',
          taxIdentifier: brand[0].taxId,
          taxIdentifierType: config.taxIdentifierType,
          legalName: brand[0].legalName || null,
          warnings: [],
          issues: [],
          safeMetadata: { normalizedSearchName: core, brandInLegalName: true },
        };
      }

      // Una fuente sólo-pista con varias empresas posibles no apunta a ninguna:
      // el primer RNC de la lista sería arbitrario.
      if (config.signalOnly === true && distinct.length > 1) return notFound(core);

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
      const carriesLegalForm = normalizeCompanyNameCore(input.candidate.canonicalName, []) !== core;
      const singleWord =
        config.singleWordIsSignalOnly === true && tokens.length === 1 && !carriesLegalForm;
      if (distinct.length === 1 && !singleWord && config.signalOnly !== true) {
        return {
          ...base,
          status: 'matched',
          confidence: SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
          safeMetadata: { normalizedSearchName: core },
          ...(best.workforce ? { workforce: { ...best.workforce } } : {}),
        };
      }
      return {
        ...base,
        status: 'low_confidence_match',
        confidence: SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
        safeMetadata:
          distinct.length > 1
            ? { normalizedSearchName: core, ambiguous: true, candidateCount: distinct.length }
            : config.signalOnly === true
              ? { normalizedSearchName: core, signalOnlySource: true }
              : { normalizedSearchName: core, singleWordName: true },
      };
    },
  };
}
