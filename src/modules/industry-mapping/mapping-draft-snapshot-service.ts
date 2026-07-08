// mapping-draft-snapshot-service.ts — Provider Industry Mapping DRAFT Domain
// Service (Q3F-5AI). Snapshot-level DRAFT mutations: createMappingDraft and
// updateMappingDraftMetadata. Publication, archival, and draft deletion are
// lifecycle-RPC territory and are explicitly out of scope for this service.

import {
  MappingDraftError,
  SNAPSHOTS_TABLE,
  type MappingDraftDbClient,
  type MappingSnapshot,
  type SnapshotRow,
} from './mapping-draft-types';
import { requireOwnedDraft } from './mapping-draft-guard';

function requireNonEmptyString(value: string, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error(`${field} is required and must be a non-empty string.`);
  }
  return trimmed;
}

function mapSnapshotRow(row: SnapshotRow): MappingSnapshot {
  return {
    id: row.id,
    sourceVocabularyKey: row.source_vocabulary_key,
    catalogVersionId: row.catalog_version_id,
    status: row.status,
    versionLabel: row.version_label,
    changeReason: row.change_reason,
    contentRevision: row.content_revision,
    createdAt: row.created_at,
    createdBy: row.created_by,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  };
}

// ── createMappingDraft ────────────────────────────────────────────────────────

export interface CreateMappingDraftInput {
  sourceVocabularyKey: string;
  catalogVersionId: string;
  createdByActorId: string;
  versionLabel?: string | null;
  changeReason?: string | null;
}

/**
 * Creates a new DRAFT mapping snapshot. Only ever constructs status='draft'
 * and content_revision=0 — publication/archive fields have no place in the
 * public input type and can never be set through this function.
 */
export async function createMappingDraft(
  db: MappingDraftDbClient,
  input: CreateMappingDraftInput,
): Promise<MappingSnapshot> {
  const sourceVocabularyKey = requireNonEmptyString(input.sourceVocabularyKey, 'sourceVocabularyKey');
  const catalogVersionId = requireNonEmptyString(input.catalogVersionId, 'catalogVersionId');
  const createdByActorId = requireNonEmptyString(input.createdByActorId, 'createdByActorId');

  const payload: Record<string, unknown> = {
    source_vocabulary_key: sourceVocabularyKey,
    catalog_version_id: catalogVersionId,
    created_by: createdByActorId,
    status: 'draft',
    content_revision: 0,
  };
  if (input.versionLabel !== undefined) payload.version_label = input.versionLabel;
  if (input.changeReason !== undefined) payload.change_reason = input.changeReason;

  const { data, error } = await db.from(SNAPSHOTS_TABLE).insert(payload).select('*').single();

  if (error) {
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to create mapping draft: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  if (!data) {
    throw new MappingDraftError('MAPPING_DRAFT_WRITE_FAILED', 'Insert succeeded but returned no row.');
  }

  return mapSnapshotRow(data as unknown as SnapshotRow);
}

// ── updateMappingDraftMetadata ────────────────────────────────────────────────

export interface UpdateMappingDraftMetadataInput {
  snapshotId: string;
  actorId: string;
  versionLabel?: string | null;
  changeReason?: string | null;
}

/**
 * Updates version_label and/or change_reason on an owned DRAFT snapshot.
 * Only fields explicitly present on the input object are written; an omitted
 * key leaves the existing column value untouched (it is never coerced to
 * null). No scope field (source_vocabulary_key, catalog_version_id,
 * created_by, status, content_revision, published/archived timestamps or
 * actors) is mutable through this function.
 */
export async function updateMappingDraftMetadata(
  db: MappingDraftDbClient,
  input: UpdateMappingDraftMetadataInput,
): Promise<MappingSnapshot> {
  const { snapshotId, actorId } = input;
  const ownedDraft = await requireOwnedDraft(db, { snapshotId, actorId });

  const patch: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(input, 'versionLabel')) {
    patch.version_label = input.versionLabel;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'changeReason')) {
    patch.change_reason = input.changeReason;
  }

  const { data, error } = await db
    .from(SNAPSHOTS_TABLE)
    .update(patch)
    .eq('id', ownedDraft.id)
    .select('*')
    .single();

  if (error) {
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to update mapping draft metadata: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  if (!data) {
    throw new MappingDraftError('MAPPING_DRAFT_WRITE_FAILED', 'Update succeeded but returned no row.');
  }

  return mapSnapshotRow(data as unknown as SnapshotRow);
}
