// mapping-draft-types.ts — Provider Industry Mapping DRAFT Domain Service (Q3F-5AI)
//
// Physical row shapes, injectable DB client contract, and error taxonomy for
// semantic DRAFT mutations of provider industry mapping snapshots. Migration
// 082 (supabase/migrations/082_provider_industry_mapping_schema.sql) is
// implemented and statically audited but NOT applied to any live database and
// generated Supabase types do not include these tables — row shapes here are
// small local types at the domain boundary, matched by hand against the
// migration DDL, per the repo's existing untyped-table convention (see
// wizard-idempotency.ts / candidate-review-core.ts).

// ── Table identities ────────────────────────────────────────────────────────

export const SNAPSHOTS_TABLE = 'provider_industry_mapping_snapshots';
export const CONCEPT_ENTRIES_TABLE = 'provider_industry_concept_entries';
export const ASSOCIATIONS_TABLE = 'provider_industry_mapping_associations';

// ── Postgres error identities (SQLSTATE + constraint names from migration 082) ──

/** SQLSTATE for unique_violation. */
export const PG_UNIQUE_VIOLATION = '23505';
/** SQLSTATE for foreign_key_violation. */
export const PG_FOREIGN_KEY_VIOLATION = '23503';

/** UNIQUE(snapshot_id, normalized_lookup_key) on provider_industry_concept_entries. */
export const CONCEPT_ENTRY_NORMALIZED_KEY_UNIQUE_CONSTRAINT = 'pice_snapshot_normalized_key_uniq';
/** UNIQUE(concept_entry_id, industry_id) on provider_industry_mapping_associations. */
export const ASSOCIATION_CONCEPT_INDUSTRY_UNIQUE_CONSTRAINT = 'pima_concept_industry_uniq';

// ── Relation semantics ───────────────────────────────────────────────────────

export const RELATION_SEMANTICS_VALUES = [
  'SOURCE_EQUIVALENT_TO_CANONICAL',
  'SOURCE_BROADER_THAN_CANONICAL',
  'SOURCE_NARROWER_THAN_CANONICAL',
] as const;

export type RelationSemantics = (typeof RELATION_SEMANTICS_VALUES)[number];

// ── Physical row shapes (hand-matched to migration 082 DDL) ─────────────────

export type SnapshotStatus = 'draft' | 'published' | 'archived';

export interface SnapshotRow {
  id: string;
  source_vocabulary_key: string;
  catalog_version_id: string;
  status: SnapshotStatus;
  version_label: string | null;
  change_reason: string | null;
  content_revision: number;
  created_at: string;
  created_by: string;
  published_at: string | null;
  published_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
}

export interface ConceptEntryRow {
  id: string;
  snapshot_id: string;
  raw_label: string;
  normalized_lookup_key: string;
  created_at: string;
}

export interface AssociationRow {
  id: string;
  concept_entry_id: string;
  snapshot_id: string;
  industry_id: string;
  catalog_version_id: string;
  relation_semantics: string;
  created_at: string;
}

// ── Domain-shaped results (camelCase, returned to callers) ──────────────────

export interface MappingSnapshot {
  id: string;
  sourceVocabularyKey: string;
  catalogVersionId: string;
  status: SnapshotStatus;
  versionLabel: string | null;
  changeReason: string | null;
  contentRevision: number;
  createdAt: string;
  createdBy: string;
  publishedAt: string | null;
  publishedBy: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
}

export interface MappingConceptEntry {
  id: string;
  snapshotId: string;
  rawLabel: string;
  normalizedLookupKey: string;
  createdAt: string;
}

export interface MappingAssociation {
  id: string;
  conceptEntryId: string;
  snapshotId: string;
  industryId: string;
  catalogVersionId: string;
  relationSemantics: RelationSemantics;
  createdAt: string;
}

/** Minimum trusted snapshot context returned by the shared DRAFT-author guard. */
export interface OwnedDraftContext {
  id: string;
  sourceVocabularyKey: string;
  catalogVersionId: string;
}

// ── Error taxonomy ────────────────────────────────────────────────────────────

export type MappingDraftErrorCode =
  | 'MAPPING_SNAPSHOT_NOT_FOUND'
  | 'MAPPING_SNAPSHOT_NOT_DRAFT'
  | 'MAPPING_DRAFT_AUTHOR_REQUIRED'
  | 'MAPPING_CONCEPT_ENTRY_NOT_FOUND'
  | 'MAPPING_CONCEPT_NORMALIZED_KEY_EMPTY'
  | 'MAPPING_CONCEPT_NORMALIZED_KEY_COLLISION'
  | 'MAPPING_CONCEPT_ENTRY_HAS_ASSOCIATIONS'
  | 'MAPPING_RELATION_SEMANTICS_INVALID'
  | 'MAPPING_CONCEPT_ENTRY_SNAPSHOT_MISMATCH'
  | 'MAPPING_ASSOCIATION_NOT_FOUND'
  | 'MAPPING_ASSOCIATION_ALREADY_EXISTS'
  | 'MAPPING_DRAFT_WRITE_FAILED'
  // ── Publication Domain Service error codes (Q3F-5AJ) ──────────────────────
  | 'MAPPING_PUBLISHER_MUST_DIFFER_FROM_CREATOR'
  | 'MAPPING_PUBLICATION_VALIDATION_FAILED'
  | 'MAPPING_PUBLICATION_REVISION_STALE'
  | 'MAPPING_PUBLICATION_VOCABULARY_DEPRECATED'
  | 'MAPPING_PUBLICATION_VERSION_LABEL_REQUIRED'
  | 'MAPPING_PUBLICATION_CHANGE_REASON_REQUIRED'
  | 'MAPPING_PUBLICATION_FAILED';

/**
 * Stable domain error for the Provider Industry Mapping DRAFT service. Never
 * carries the service-role key, raw connection details, or full SQL — `cause`
 * holds the original Supabase/Postgres error for server-side logging only.
 */
export class MappingDraftError extends Error {
  constructor(
    public readonly code: MappingDraftErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MappingDraftError';
  }
}

// ── Injectable DB client contract ────────────────────────────────────────────
// Minimal structural surface actually used by this service (select/eq/
// maybeSingle, insert/select/single, update/eq/select/single, delete/eq).
// The real Supabase client satisfies this structurally — call sites outside
// this module cast it with `as unknown as MappingDraftDbClient` (same pattern
// as IdempotencyDbClient in wizard-idempotency.ts). Tests inject hand-written
// fakes; no Supabase network is ever used here.

export type MappingDraftDbError = {
  code?: string;
  message?: string;
  details?: string;
};

export type MappingDraftRowResult = {
  data: Record<string, unknown> | null;
  error: MappingDraftDbError | null;
};

export interface MappingDraftSelectChain {
  eq(column: string, value: string): MappingDraftSelectChain;
  maybeSingle(): Promise<MappingDraftRowResult>;
}

export interface MappingDraftInsertOrUpdateChain {
  select(columns: string): {
    single(): Promise<MappingDraftRowResult>;
  };
}

export interface MappingDraftUpdateChain {
  eq(column: string, value: string): MappingDraftInsertOrUpdateChain;
}

export interface MappingDraftDeleteChain {
  eq(column: string, value: string): Promise<{ error: MappingDraftDbError | null }>;
}

export interface MappingDraftTableClient {
  select(columns: string): MappingDraftSelectChain;
  insert(row: Record<string, unknown>): MappingDraftInsertOrUpdateChain;
  update(patch: Record<string, unknown>): MappingDraftUpdateChain;
  delete(): MappingDraftDeleteChain;
}

export interface MappingDraftDbClient {
  from(table: string): MappingDraftTableClient;
}
