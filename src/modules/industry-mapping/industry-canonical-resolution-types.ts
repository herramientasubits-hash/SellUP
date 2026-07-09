// industry-canonical-resolution-types.ts — Pure Deterministic Industry
// Canonical Runtime Resolver (Q3F-5AL). Result contract, resolver-owned
// loaded-catalog structural type, and the resolver-scope error taxonomy.
//
// This module contains only types and the resolver-scope error class — no
// Supabase, no provider/AI, no DB row shapes. The trusted mapping snapshot
// model (IndustryProviderMappingSnapshot, CanonicalIndustryReference) is
// reused as-is from mapping-snapshot-load-types.ts (Q3F-5AK) — not
// redefined here.

import type { RelationSemantics } from './mapping-draft-types';
import type { CanonicalIndustryReference } from './mapping-snapshot-load-types';

// ── Resolver-owned loaded-catalog structural type ────────────────────────────
// Narrowest structural read model the resolver needs from the loaded industry
// catalog (migration 057: industries.id/name/slug are unique per
// catalog_version_id). Structurally compatible with the existing
// ActiveIndustryCatalog / CatalogIndustryOption shape — extra fields on a
// caller's real catalog value are ignored, not duplicated here.

export interface LoadedIndustryReference {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface LoadedIndustryCatalog {
  readonly version: string;
  readonly industries: readonly LoadedIndustryReference[];
}

// ── Source vocabulary context ────────────────────────────────────────────────

export interface IndustrySourceVocabularyContext {
  readonly sourceVocabularyKey: string;
}

// ── Resolution methods ───────────────────────────────────────────────────────

export type CatalogIndustryResolutionMethod =
  | 'catalog_exact_name'
  | 'catalog_slug'
  | 'catalog_normalized_name';

export type IndustryResolutionMethod = CatalogIndustryResolutionMethod | 'provider_mapping';

// ── Source relation (wraps the trusted plain RelationSemantics string per the
// frozen candidate contract — the trusted snapshot's sourceRelation is not
// already an object, so this is not a double-wrap) ──────────────────────────

export interface IndustrySourceRelation {
  readonly semantics: RelationSemantics;
}

// ── Candidate union (frozen) ─────────────────────────────────────────────────

export type IndustryCanonicalResolutionCandidate =
  | {
      readonly ref: CanonicalIndustryReference;
      readonly resolutionMethod: CatalogIndustryResolutionMethod;
      readonly sourceRelation?: never;
    }
  | {
      readonly ref: CanonicalIndustryReference;
      readonly resolutionMethod: 'provider_mapping';
      readonly sourceRelation: IndustrySourceRelation;
    };

// ── Resolver input ────────────────────────────────────────────────────────────

export type IndustryCanonicalResolutionInput = {
  readonly rawLabel: string;
  readonly sourceContext: IndustrySourceVocabularyContext;
  readonly catalogVersion: string;
  readonly mappingSnapshot: import('./mapping-snapshot-load-types').IndustryProviderMappingSnapshot;
};

// ── Resolver result (frozen cardinality contract) ────────────────────────────

export type IndustryCanonicalResolutionResult =
  | {
      readonly status: 'RESOLVED';
      readonly resolvedNormalizedLabel: string;
      readonly candidates: readonly [IndustryCanonicalResolutionCandidate];
    }
  | {
      readonly status: 'AMBIGUOUS';
      readonly resolvedNormalizedLabel: string;
      readonly candidates: readonly [
        IndustryCanonicalResolutionCandidate,
        IndustryCanonicalResolutionCandidate,
        ...IndustryCanonicalResolutionCandidate[],
      ];
    }
  | {
      readonly status: 'UNMAPPED';
      readonly resolvedNormalizedLabel: string;
      readonly candidates: readonly [];
    };

// ── Resolver-scope error taxonomy ────────────────────────────────────────────
// Caller/dependency scope errors at the resolver boundary only — distinct
// from MappingSnapshotLoadError (LOAD1/LOAD2) and MappingDraftErrorCode
// (DRAFT/publication lifecycle). Never thrown for a malformed trusted
// snapshot — the trusted loader already owns that guarantee (NS1/COL1).

export type IndustryCanonicalResolutionErrorCode =
  | 'INDUSTRY_RESOLUTION_CATALOG_VERSION_MISMATCH'
  | 'INDUSTRY_RESOLUTION_SOURCE_VOCABULARY_MISMATCH';

export type IndustryCanonicalResolutionMismatchTarget = 'mapping_snapshot' | 'loaded_catalog';

/**
 * Safe structured diagnostic context only — never provider/AI payloads,
 * candidate/account data, or raw infrastructure text.
 */
export interface IndustryCanonicalResolutionErrorContext {
  inputCatalogVersion?: string;
  snapshotCatalogVersion?: string;
  catalogVersion?: string;
  inputSourceVocabularyKey?: string;
  snapshotSourceVocabularyKey?: string;
  mismatchTarget?: IndustryCanonicalResolutionMismatchTarget;
}

export class IndustryCanonicalResolutionError extends Error {
  constructor(
    public readonly code: IndustryCanonicalResolutionErrorCode,
    message: string,
    public readonly context?: IndustryCanonicalResolutionErrorContext,
  ) {
    super(message);
    this.name = 'IndustryCanonicalResolutionError';
  }
}
