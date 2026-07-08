// mapping-snapshot-load-types.ts — Provider Industry Mapping Trusted Snapshot
// Loaders (Q3F-5AK). Trusted snapshot model, narrow physical row shapes for
// tables not already covered by mapping-draft-types.ts /
// mapping-publication-types.ts, and the dedicated LOAD1/LOAD2 error taxonomy.
//
// NS1 (frozen): the trusted snapshot returned by LOAD1/LOAD2 is always
// non-null. Every load failure — missing configuration, missing scope,
// malformed physical content — is a typed MappingSnapshotLoadError, never a
// null/undefined return value and never a fabricated empty snapshot.

import type { RelationSemantics } from './mapping-draft-types';
import type { MappingPublicationDbClient } from './mapping-publication-types';

// ── Table identities (not already exported by sibling modules) ──────────────

export const SOURCE_VOCABULARIES_TABLE = 'provider_industry_source_vocabularies';
export const CATALOG_VERSIONS_TABLE = 'industry_catalog_versions';

// ── Injectable DB adapter ────────────────────────────────────────────────────
// Structurally identical to what the loaders need (select/eq chain resolving
// to a list when awaited directly, .maybeSingle() for single-row loads) — the
// existing MappingPublicationDbClient contract already models this shape
// exactly (TYPE1 convention), so it is reused rather than duplicated.

export type MappingSnapshotLoadDbClient = MappingPublicationDbClient;

// ── Narrow physical row shapes (hand-matched to migration 082 / 057 DDL) ────
// Only the columns the loaders actually read — not a duplicate of the full
// industry-catalog or provider-industry-mapping module row types.

export interface SourceVocabularyRow {
  source_vocabulary_key: string;
  lifecycle: string;
}

export interface CatalogVersionRow {
  id: string;
  version: string;
}

export interface IndustryTargetRow {
  id: string;
  catalog_version_id: string;
  name: string;
  slug: string;
}

// ── Trusted snapshot model (camelCase, returned to callers) ─────────────────
// Deliberately excludes confidence/score/rank/probability, DimensionState,
// provider/AI payloads, candidate/account/agent-run data, runtime
// resolutionMethod, review_status, and supersedes_mapping_id — none of that
// belongs to a trusted configuration snapshot.

export interface CanonicalIndustryReference {
  id: string;
  name: string;
  slug: string;
  catalogVersion: string;
}

export interface MappingSnapshotAssociation {
  canonicalTarget: CanonicalIndustryReference;
  sourceRelation: RelationSemantics;
}

export interface MappingSnapshotConceptEntry {
  conceptEntryId: string;
  rawLabel: string;
  associations: readonly MappingSnapshotAssociation[];
}

export interface IndustryProviderMappingSnapshot {
  mappingSnapshotId: string;
  sourceVocabularyKey: string;
  catalogVersion: string;
  status: 'published' | 'archived';
  createdBy: string;
  publishedBy: string | null;
  conceptEntries: readonly MappingSnapshotConceptEntry[];
}

// ── Error taxonomy ────────────────────────────────────────────────────────────
// Dedicated to LOAD1/LOAD2 — none of these conceptual failures share semantics
// with MappingDraftErrorCode (DRAFT mutation / publication lifecycle), so they
// are not folded into that union.

export type MappingSnapshotLoadErrorCode =
  | 'VOCABULARY_NOT_REGISTERED'
  | 'VOCABULARY_DEPRECATED'
  | 'CATALOG_VERSION_NOT_FOUND'
  | 'NO_PUBLISHED_SNAPSHOT_FOR_REQUESTED_SCOPE'
  | 'MULTIPLE_PUBLISHED_SNAPSHOTS_INTEGRITY_ERROR'
  | 'SNAPSHOT_NOT_FOUND'
  | 'DRAFT_SNAPSHOT_NOT_HISTORICALLY_LOADABLE'
  | 'SNAPSHOT_CONTENT_INTEGRITY_ERROR'
  | 'SNAPSHOT_LOAD_FAILED';

/**
 * Safe structured diagnostic context only — never raw SQL, credentials,
 * connection details, or provider/AI payloads.
 */
export interface MappingSnapshotLoadErrorContext {
  sourceVocabularyKey?: string;
  catalogVersion?: string;
  mappingSnapshotId?: string;
  conceptEntryId?: string;
  associationId?: string;
  industryId?: string;
  normalizedKey?: string;
}

/**
 * Stable domain error for the Provider Industry Mapping snapshot loaders.
 * `cause` holds the original infrastructure error (if any) for server-side
 * logging only — the public `message` never interpolates raw DB text.
 */
export class MappingSnapshotLoadError extends Error {
  constructor(
    public readonly code: MappingSnapshotLoadErrorCode,
    message: string,
    public readonly context?: MappingSnapshotLoadErrorContext,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MappingSnapshotLoadError';
  }
}
