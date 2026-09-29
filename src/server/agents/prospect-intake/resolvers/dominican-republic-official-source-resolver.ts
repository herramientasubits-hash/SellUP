/**
 * SOURCES-DO-INRUN-RNC-1 — República Dominicana (rd_dgii_bulk) official-source
 * resolver: company name → RNC, inside the Agent 1 run.
 *
 * Adapts the DGII RNC registry snapshot (≈493k legal entities, already loaded in
 * `source_company_snapshots`) into the provider-agnostic `OfficialSourceResolver`
 * contract consumed by `enrichNormalizedProspectWithOfficialSources`, exactly as
 * the Colombia (co_siis) resolver does for NIT.
 *
 * SAFE CLIENT PATTERN: this module is PURE with respect to I/O. It never builds a
 * Supabase client and never reads env. The read arrives through the INJECTED
 * `querySnapshots` (see `dominican-republic-snapshot-query.ts`).
 *
 * How DGII stores names: `normalized_legal_name` is the registry legal name
 * upper-cased and trimmed, KEEPING the legal-form suffix ("GRUPO RAMOS ARIAS SRL",
 * "INVERSIONES CLARO VELO S A", "… C POR A"). So the lookup reduces the
 * candidate name to its core (no accents, no punctuation, no legal suffix), asks
 * the index for the core plus each common Dominican suffix spelling, and then
 * keeps only rows whose OWN core equals the candidate core.
 *
 * Conservative by design (a wrong RNC would merge two different companies into
 * one identity downstream):
 *   - STRONG (`matched`, 0.85) only when exactly ONE distinct RNC among the
 *     matching rows is an ACTIVE taxpayer.
 *   - Several active RNCs, or only inactive/suspended ones → `low_confidence_match`
 *     (kept as a signal, never promoted to a strong identity).
 *   - No partial / fuzzy matching: a `%name%` scan over ~493k rows cannot use the
 *     index, and a fuzzy RNC is worse than none.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
} from '../source-enrichment';

/** DGII RNC registry snapshot source key. */
export const DOMINICAN_OFFICIAL_SOURCE_KEY = 'rd_dgii_bulk' as const;
/** ISO country this resolver serves. */
export const DOMINICAN_COUNTRY_CODE = 'DO' as const;
/** Dominican fiscal identifier type. Matches the prospect_candidates CHECK. */
export const DOMINICAN_TAX_IDENTIFIER_TYPE = 'RNC' as const;
/** Confidence of a unique active exact-core match — equals the strong threshold. */
export const DOMINICAN_EXACT_MATCH_CONFIDENCE = 0.85 as const;
/** Confidence of a match that is kept only as a signal (ambiguous or inactive). */
export const DOMINICAN_SIGNAL_MATCH_CONFIDENCE = 0.6 as const;

/**
 * Legal-form suffixes as DGII spells them (after punctuation → space). Longest
 * first so "S A S" is stripped before "S A".
 */
const DOMINICAN_LEGAL_SUFFIXES: readonly string[] = [
  'C POR A',
  'E I R L',
  'S A S',
  'S R L',
  'S A',
  'EIRL',
  'SAS',
  'SRL',
  'SA',
  'INC',
  'CORP',
  'LTD',
  'LLC',
];

/** Suffix spellings appended to the core when asking the index. */
const DOMINICAN_LOOKUP_SUFFIXES: readonly string[] = [
  'SRL',
  'S R L',
  'SA',
  'S A',
  'SAS',
  'S A S',
  'C POR A',
  'EIRL',
  'E I R L',
];

/** DGII business RNC: exactly 9 digits. */
const DOMINICAN_BUSINESS_RNC = /^\d{9}$/;

/** One DGII snapshot row, reduced to the fields the resolver needs. */
export interface DominicanSnapshotRow {
  rnc: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  taxpayerStatus: string | null;
  isActiveTaxpayer: boolean;
}

/**
 * Injected read-only snapshot query: returns the DGII rows whose stored
 * `normalized_legal_name` is one of the given names. MUST be read-only and MUST
 * degrade to `[]` on any failure.
 */
export type DominicanSnapshotQuery = (
  normalizedLegalNames: string[],
) => Promise<DominicanSnapshotRow[]>;

export interface DominicanOfficialSourceResolverDeps {
  querySnapshots: DominicanSnapshotQuery;
}

/**
 * Reduce a company name to its comparable core: upper case, no accents, only
 * letters/digits/&, single spaces, and trailing legal-form suffixes removed.
 */
export function normalizeDominicanCompanyCore(name: string): string {
  if (!name || name.trim().length === 0) return '';

  let core = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let stripped = true;
  while (stripped && core.length > 0) {
    stripped = false;
    for (const suffix of DOMINICAN_LEGAL_SUFFIXES) {
      if (core === suffix) continue;
      if (core.endsWith(` ${suffix}`)) {
        core = core.slice(0, core.length - suffix.length - 1).trim();
        stripped = true;
        break;
      }
    }
  }
  return core;
}

/** The stored-name spellings to ask the index for, given a core. */
export function buildDominicanLookupNames(core: string): string[] {
  if (!core) return [];
  return [core, ...DOMINICAN_LOOKUP_SUFFIXES.map((suffix) => `${core} ${suffix}`)];
}

function notFound(core: string | null): OfficialSourceEnrichmentResult {
  return {
    status: 'not_found',
    countryCode: DOMINICAN_COUNTRY_CODE,
    sourceKey: DOMINICAN_OFFICIAL_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  };
}

/** Distinct rows by RNC, keeping only valid 9-digit business RNCs. */
function distinctByRnc(rows: DominicanSnapshotRow[]): DominicanSnapshotRow[] {
  const byRnc = new Map<string, DominicanSnapshotRow>();
  for (const row of rows) {
    const rnc = row.rnc?.trim() ?? '';
    if (!DOMINICAN_BUSINESS_RNC.test(rnc)) continue;
    const previous = byRnc.get(rnc);
    // Prefer the active version of a duplicated RNC row.
    if (!previous || (!previous.isActiveTaxpayer && row.isActiveTaxpayer)) {
      byRnc.set(rnc, { ...row, rnc });
    }
  }
  return [...byRnc.values()];
}

/**
 * Build a República Dominicana (rd_dgii_bulk) `OfficialSourceResolver`. It only
 * attempts candidates whose target country is DO and that carry a usable name.
 */
export function createDominicanOfficialSourceResolver(
  deps: DominicanOfficialSourceResolverDeps,
): OfficialSourceResolver {
  return {
    countryCode: DOMINICAN_COUNTRY_CODE,
    sourceKey: DOMINICAN_OFFICIAL_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const country = (input.candidate.countryCode ?? input.criteria.countryCode ?? '')
        .toUpperCase();
      if (country !== DOMINICAN_COUNTRY_CODE) return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(
      input: OfficialSourceResolverInput,
    ): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName?.trim() ?? '';
      const core = normalizeDominicanCompanyCore(name);
      if (core.length < 2) return notFound(core || null);

      const tokens = core.toLowerCase().split(' ').filter((t) => t.length > 0);
      if (isNameTooGeneric(tokens, input.candidate.domain, input.candidate.websiteUrl)) {
        // Too generic to resolve reliably — no RNC rather than a wrong one.
        return notFound(core);
      }

      const rows = await deps.querySnapshots(buildDominicanLookupNames(core));
      const sameCore = rows.filter(
        (row) => normalizeDominicanCompanyCore(row.normalizedLegalName ?? '') === core,
      );
      const distinct = distinctByRnc(sameCore);
      if (distinct.length === 0) return notFound(core);

      const active = distinct.filter((row) => row.isActiveTaxpayer);
      if (active.length === 1) {
        const match = active[0];
        return {
          status: 'matched',
          countryCode: DOMINICAN_COUNTRY_CODE,
          sourceKey: DOMINICAN_OFFICIAL_SOURCE_KEY,
          confidence: DOMINICAN_EXACT_MATCH_CONFIDENCE,
          matchMethod: 'normalized_name',
          taxIdentifier: match.rnc,
          taxIdentifierType: DOMINICAN_TAX_IDENTIFIER_TYPE,
          legalName: match.legalName || null,
          warnings: [],
          issues: [],
          safeMetadata: {
            normalizedSearchName: core,
            taxpayerStatus: match.taxpayerStatus ?? null,
            ...(distinct.length > 1 ? { inactiveHomonyms: distinct.length - 1 } : {}),
          },
        };
      }

      // Several active homonyms, or only inactive/suspended taxpayers: keep the
      // best row as a SIGNAL, never as a strong identity.
      const best = active[0] ?? distinct[0];
      return {
        status: 'low_confidence_match',
        countryCode: DOMINICAN_COUNTRY_CODE,
        sourceKey: DOMINICAN_OFFICIAL_SOURCE_KEY,
        confidence: DOMINICAN_SIGNAL_MATCH_CONFIDENCE,
        matchMethod: 'normalized_name',
        taxIdentifier: best.rnc,
        taxIdentifierType: DOMINICAN_TAX_IDENTIFIER_TYPE,
        legalName: best.legalName || null,
        warnings: [],
        issues: [],
        safeMetadata: {
          normalizedSearchName: core,
          taxpayerStatus: best.taxpayerStatus ?? null,
          candidateCount: distinct.length,
          activeCount: active.length,
          ...(active.length > 1 ? { ambiguous: true } : { noActiveTaxpayer: true }),
        },
      };
    },
  };
}
