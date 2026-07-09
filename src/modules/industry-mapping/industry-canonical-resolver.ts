// industry-canonical-resolver.ts — Pure Deterministic Industry Canonical
// Runtime Resolver (Q3F-5AL).
//
// PURE. DETERMINISTIC. NON-RANKED. Synchronous — no DB, no provider/AI call,
// no clock, no randomness, no cost logging, no side effect. Consumes an
// already-loaded LoadedIndustryCatalog and an already-loaded trusted
// IndustryProviderMappingSnapshot (Q3F-5AK) — never loads either itself.

import { normalizeClassificationValue } from '@/modules/prospect-batches/import-classification/catalog-normalization';
import type { IndustryProviderMappingSnapshot } from './mapping-snapshot-load-types';
import {
  IndustryCanonicalResolutionError,
  type CatalogIndustryResolutionMethod,
  type IndustryCanonicalResolutionCandidate,
  type IndustryCanonicalResolutionInput,
  type IndustryCanonicalResolutionResult,
  type LoadedIndustryCatalog,
  type LoadedIndustryReference,
} from './industry-canonical-resolution-types';

// ── Deterministic ordinal comparison (candidate.ref.id ASC, never
// localeCompare) ─────────────────────────────────────────────────────────────

function ordinalCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ── Candidate construction ───────────────────────────────────────────────────

function buildCatalogCandidate(
  industry: LoadedIndustryReference,
  catalogVersion: string,
  resolutionMethod: CatalogIndustryResolutionMethod,
): IndustryCanonicalResolutionCandidate {
  return {
    ref: { id: industry.id, name: industry.name, slug: industry.slug, catalogVersion },
    resolutionMethod,
  };
}

// ── Direct catalog resolution (STAGE 1 exact-name → STAGE 2 slug → STAGE 3
// normalized-name; first stage with a non-empty match set wins) ─────────────
// Stage 1/2 mirror the legacy resolveIndustry() trimmed/lowercased comparison
// semantics exactly (catalog-normalization.ts / import-catalog-normalizer.ts);
// stage 3 compares normalizeClassificationValue(industry.name) against the
// already-computed resolvedNormalizedLabel.

function resolveDirectCatalogCandidates(
  rawLabel: string,
  resolvedNormalizedLabel: string,
  catalog: LoadedIndustryCatalog,
): IndustryCanonicalResolutionCandidate[] {
  const trimmedLower = rawLabel.trim().toLowerCase();

  const exactNameMatches = catalog.industries.filter((industry) => industry.name.toLowerCase() === trimmedLower);
  if (exactNameMatches.length > 0) {
    return exactNameMatches.map((industry) => buildCatalogCandidate(industry, catalog.version, 'catalog_exact_name'));
  }

  const slugMatches = catalog.industries.filter((industry) => industry.slug === trimmedLower);
  if (slugMatches.length > 0) {
    return slugMatches.map((industry) => buildCatalogCandidate(industry, catalog.version, 'catalog_slug'));
  }

  const normalizedMatches = catalog.industries.filter(
    (industry) => normalizeClassificationValue(industry.name) === resolvedNormalizedLabel,
  );
  return normalizedMatches.map((industry) => buildCatalogCandidate(industry, catalog.version, 'catalog_normalized_name'));
}

// ── Provider mapping resolution ──────────────────────────────────────────────
// Exact normalized-key equality against the trusted concept's recomputed
// rawLabel key. COL1 (Q3F-5AK) guarantees at most one trusted concept can
// match, so `.find` never needs to detect a collision here.

function resolveProviderMappingCandidates(
  resolvedNormalizedLabel: string,
  mappingSnapshot: IndustryProviderMappingSnapshot,
): IndustryCanonicalResolutionCandidate[] {
  const matchingConcept = mappingSnapshot.conceptEntries.find(
    (concept) => normalizeClassificationValue(concept.rawLabel) === resolvedNormalizedLabel,
  );
  if (!matchingConcept) return [];

  return matchingConcept.associations.map((association) => ({
    ref: association.canonicalTarget,
    resolutionMethod: 'provider_mapping' as const,
    sourceRelation: { semantics: association.sourceRelation },
  }));
}

// ── Same-target dedup + different-target combination (order-independent) ────
// Final candidate identity is ref.id. Direct and mapping candidates for the
// same ref.id collapse into one candidate that preserves provider_mapping
// metadata (sourceRelation) regardless of which collection is processed
// first — mapping candidates are written into the map after direct
// candidates, so a same-id mapping entry always overwrites its direct
// counterpart. Candidates for different ref.id values are never dropped.

function combineAndDedup(
  directCandidates: readonly IndustryCanonicalResolutionCandidate[],
  mappingCandidates: readonly IndustryCanonicalResolutionCandidate[],
): IndustryCanonicalResolutionCandidate[] {
  const byCanonicalId = new Map<string, IndustryCanonicalResolutionCandidate>();

  for (const candidate of directCandidates) {
    byCanonicalId.set(candidate.ref.id, candidate);
  }
  for (const candidate of mappingCandidates) {
    byCanonicalId.set(candidate.ref.id, candidate);
  }

  return [...byCanonicalId.values()].sort((a, b) => ordinalCompare(a.ref.id, b.ref.id));
}

// ── Result assembly (frozen cardinality contract) ────────────────────────────

function assembleResult(
  resolvedNormalizedLabel: string,
  candidates: readonly IndustryCanonicalResolutionCandidate[],
): IndustryCanonicalResolutionResult {
  if (candidates.length === 0) {
    return { status: 'UNMAPPED', resolvedNormalizedLabel, candidates: [] };
  }
  if (candidates.length === 1) {
    return { status: 'RESOLVED', resolvedNormalizedLabel, candidates: [candidates[0]] };
  }
  const [first, second, ...rest] = candidates;
  return { status: 'AMBIGUOUS', resolvedNormalizedLabel, candidates: [first, second, ...rest] };
}

// ── Public resolver ───────────────────────────────────────────────────────────

export function resolveIndustryCanonical(
  input: IndustryCanonicalResolutionInput,
  catalog: LoadedIndustryCatalog,
): IndustryCanonicalResolutionResult {
  // Guard 1: input catalog version vs trusted mapping snapshot catalog version.
  if (input.catalogVersion !== input.mappingSnapshot.catalogVersion) {
    throw new IndustryCanonicalResolutionError(
      'INDUSTRY_RESOLUTION_CATALOG_VERSION_MISMATCH',
      'Requested catalog version does not match the trusted mapping snapshot catalog version.',
      {
        inputCatalogVersion: input.catalogVersion,
        snapshotCatalogVersion: input.mappingSnapshot.catalogVersion,
        mismatchTarget: 'mapping_snapshot',
      },
    );
  }

  // Guard 2: input catalog version vs loaded industry catalog version.
  if (input.catalogVersion !== catalog.version) {
    throw new IndustryCanonicalResolutionError(
      'INDUSTRY_RESOLUTION_CATALOG_VERSION_MISMATCH',
      'Requested catalog version does not match the loaded industry catalog version.',
      {
        inputCatalogVersion: input.catalogVersion,
        catalogVersion: catalog.version,
        mismatchTarget: 'loaded_catalog',
      },
    );
  }

  // Guard 3: source vocabulary key vs trusted mapping snapshot vocabulary key.
  if (input.sourceContext.sourceVocabularyKey !== input.mappingSnapshot.sourceVocabularyKey) {
    throw new IndustryCanonicalResolutionError(
      'INDUSTRY_RESOLUTION_SOURCE_VOCABULARY_MISMATCH',
      'Requested source vocabulary key does not match the trusted mapping snapshot source vocabulary key.',
      {
        inputSourceVocabularyKey: input.sourceContext.sourceVocabularyKey,
        snapshotSourceVocabularyKey: input.mappingSnapshot.sourceVocabularyKey,
      },
    );
  }

  // Guard 4: normalize the incoming raw label.
  const resolvedNormalizedLabel = normalizeClassificationValue(input.rawLabel);
  if (resolvedNormalizedLabel === '') {
    return { status: 'UNMAPPED', resolvedNormalizedLabel: '', candidates: [] };
  }

  const directCandidates = resolveDirectCatalogCandidates(input.rawLabel, resolvedNormalizedLabel, catalog);
  const mappingCandidates = resolveProviderMappingCandidates(resolvedNormalizedLabel, input.mappingSnapshot);
  const finalCandidates = combineAndDedup(directCandidates, mappingCandidates);

  return assembleResult(resolvedNormalizedLabel, finalCandidates);
}
