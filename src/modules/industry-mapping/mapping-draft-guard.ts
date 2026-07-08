// mapping-draft-guard.ts — Provider Industry Mapping DRAFT Domain Service (Q3F-5AI)
//
// Shared DRAFT-author ownership guard (frozen HA1): snapshot.created_by is the
// sole semantic author of the DRAFT. This is the DOMAIN_DRAFT_AUTHOR_GUARD
// layer only — it does not, by itself, prove DB lifecycle integrity. The full
// HA1 guarantee is layered with DB_DRAFT_STATUS_AND_LOCK_GUARDS (migration 082
// triggers, not yet activated) and DB_PUBLICATION_AUTHOR_INEQUALITY.

import {
  MappingDraftError,
  SNAPSHOTS_TABLE,
  type MappingDraftDbClient,
  type OwnedDraftContext,
  type SnapshotRow,
} from './mapping-draft-types';

export interface RequireOwnedDraftInput {
  snapshotId: string;
  actorId: string;
}

/**
 * Requires that `actorId` is the sole semantic author of the DRAFT snapshot
 * identified by `snapshotId`, throwing a typed MappingDraftError otherwise.
 * Returns the minimum trusted snapshot context needed by the calling mutation.
 */
export async function requireOwnedDraft(
  db: MappingDraftDbClient,
  input: RequireOwnedDraftInput,
): Promise<OwnedDraftContext> {
  const { snapshotId, actorId } = input;

  const { data, error } = await db
    .from(SNAPSHOTS_TABLE)
    .select('id, status, created_by, source_vocabulary_key, catalog_version_id')
    .eq('id', snapshotId)
    .maybeSingle();

  if (error) {
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to load mapping snapshot for ownership check: ${error.message ?? 'unknown'}`,
      error,
    );
  }

  if (!data) {
    throw new MappingDraftError('MAPPING_SNAPSHOT_NOT_FOUND', 'Mapping snapshot not found.');
  }

  const snapshot = data as Pick<
    SnapshotRow,
    'id' | 'status' | 'created_by' | 'source_vocabulary_key' | 'catalog_version_id'
  >;

  if (snapshot.status !== 'draft') {
    throw new MappingDraftError(
      'MAPPING_SNAPSHOT_NOT_DRAFT',
      'Mapping snapshot is not in draft status.',
    );
  }

  if (snapshot.created_by !== actorId) {
    throw new MappingDraftError(
      'MAPPING_DRAFT_AUTHOR_REQUIRED',
      'Only the snapshot author may perform this mutation.',
    );
  }

  return {
    id: snapshot.id,
    sourceVocabularyKey: snapshot.source_vocabulary_key,
    catalogVersionId: snapshot.catalog_version_id,
  };
}
