// mapping-draft-concept-service.ts — Provider Industry Mapping DRAFT Domain
// Service (Q3F-5AI). Concept-entry DRAFT mutations: addConceptEntry,
// updateConceptEntryRawLabel, removeConceptEntry.
//
// TypeScript normalization parity: normalized_lookup_key is always computed
// from raw_label via the existing, proven normalizeClassificationValue() —
// never supplied by the caller, never duplicated here. No AI, no translation,
// no stemming, no alias-expansion, no fuzzy matching.

import { normalizeClassificationValue } from '@/modules/prospect-batches/import-classification/catalog-normalization';
import {
  MappingDraftError,
  CONCEPT_ENTRIES_TABLE,
  PG_UNIQUE_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  CONCEPT_ENTRY_NORMALIZED_KEY_UNIQUE_CONSTRAINT,
  type MappingDraftDbClient,
  type MappingDraftDbError,
  type MappingConceptEntry,
  type ConceptEntryRow,
} from './mapping-draft-types';
import { requireOwnedDraft } from './mapping-draft-guard';

function mapConceptEntryRow(row: ConceptEntryRow): MappingConceptEntry {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    rawLabel: row.raw_label,
    normalizedLookupKey: row.normalized_lookup_key,
    createdAt: row.created_at,
  };
}

function mapNormalizedKeyCollision(error: MappingDraftDbError): MappingDraftError | null {
  if (error.code === PG_UNIQUE_VIOLATION && error.message?.includes(CONCEPT_ENTRY_NORMALIZED_KEY_UNIQUE_CONSTRAINT)) {
    return new MappingDraftError(
      'MAPPING_CONCEPT_NORMALIZED_KEY_COLLISION',
      'A concept entry with this normalized lookup key already exists in the snapshot.',
      error,
    );
  }
  return null;
}

/** Resolves a concept entry's parent snapshot id, throwing if not found. */
async function loadConceptEntrySnapshotId(
  db: MappingDraftDbClient,
  conceptEntryId: string,
): Promise<string> {
  const { data, error } = await db
    .from(CONCEPT_ENTRIES_TABLE)
    .select('id, snapshot_id')
    .eq('id', conceptEntryId)
    .maybeSingle();

  if (error) {
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to load concept entry: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  if (!data) {
    throw new MappingDraftError('MAPPING_CONCEPT_ENTRY_NOT_FOUND', 'Concept entry not found.');
  }
  return (data as Pick<ConceptEntryRow, 'id' | 'snapshot_id'>).snapshot_id;
}

// ── addConceptEntry ────────────────────────────────────────────────────────────

export interface AddConceptEntryInput {
  snapshotId: string;
  actorId: string;
  rawLabel: string;
}

export async function addConceptEntry(
  db: MappingDraftDbClient,
  input: AddConceptEntryInput,
): Promise<MappingConceptEntry> {
  const { snapshotId, actorId, rawLabel } = input;
  await requireOwnedDraft(db, { snapshotId, actorId });

  if (typeof rawLabel !== 'string' || !rawLabel.trim()) {
    throw new Error('rawLabel is required and must be a non-empty string.');
  }

  const normalizedLookupKey = normalizeClassificationValue(rawLabel);
  if (!normalizedLookupKey) {
    throw new MappingDraftError(
      'MAPPING_CONCEPT_NORMALIZED_KEY_EMPTY',
      'The normalized lookup key computed from rawLabel is empty.',
    );
  }

  const { data, error } = await db
    .from(CONCEPT_ENTRIES_TABLE)
    .insert({
      snapshot_id: snapshotId,
      raw_label: rawLabel,
      normalized_lookup_key: normalizedLookupKey,
    })
    .select('*')
    .single();

  if (error) {
    const collision = mapNormalizedKeyCollision(error);
    if (collision) throw collision;
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to add concept entry: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  if (!data) {
    throw new MappingDraftError('MAPPING_DRAFT_WRITE_FAILED', 'Insert succeeded but returned no row.');
  }

  return mapConceptEntryRow(data as unknown as ConceptEntryRow);
}

// ── updateConceptEntryRawLabel ──────────────────────────────────────────────────

export interface UpdateConceptEntryRawLabelInput {
  conceptEntryId: string;
  actorId: string;
  newRawLabel: string;
}

export async function updateConceptEntryRawLabel(
  db: MappingDraftDbClient,
  input: UpdateConceptEntryRawLabelInput,
): Promise<MappingConceptEntry> {
  const { conceptEntryId, actorId, newRawLabel } = input;

  const snapshotId = await loadConceptEntrySnapshotId(db, conceptEntryId);
  await requireOwnedDraft(db, { snapshotId, actorId });

  if (typeof newRawLabel !== 'string' || !newRawLabel.trim()) {
    throw new Error('newRawLabel is required and must be a non-empty string.');
  }

  const newNormalizedLookupKey = normalizeClassificationValue(newRawLabel);
  if (!newNormalizedLookupKey) {
    throw new MappingDraftError(
      'MAPPING_CONCEPT_NORMALIZED_KEY_EMPTY',
      'The normalized lookup key computed from newRawLabel is empty.',
    );
  }

  // raw_label and normalized_lookup_key are written in a single UPDATE request.
  const { data, error } = await db
    .from(CONCEPT_ENTRIES_TABLE)
    .update({ raw_label: newRawLabel, normalized_lookup_key: newNormalizedLookupKey })
    .eq('id', conceptEntryId)
    .select('*')
    .single();

  if (error) {
    const collision = mapNormalizedKeyCollision(error);
    if (collision) throw collision;
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to update concept entry raw label: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  if (!data) {
    throw new MappingDraftError('MAPPING_DRAFT_WRITE_FAILED', 'Update succeeded but returned no row.');
  }

  return mapConceptEntryRow(data as unknown as ConceptEntryRow);
}

// ── removeConceptEntry ───────────────────────────────────────────────────────────

export interface RemoveConceptEntryInput {
  conceptEntryId: string;
  actorId: string;
}

/**
 * Removes a concept entry from an owned DRAFT snapshot. The association FK
 * uses ON DELETE RESTRICT, so a concept entry with associations cannot be
 * deleted directly — no cascade is invented here; the caller must remove
 * associations first.
 */
export async function removeConceptEntry(
  db: MappingDraftDbClient,
  input: RemoveConceptEntryInput,
): Promise<void> {
  const { conceptEntryId, actorId } = input;

  const snapshotId = await loadConceptEntrySnapshotId(db, conceptEntryId);
  await requireOwnedDraft(db, { snapshotId, actorId });

  const { error } = await db.from(CONCEPT_ENTRIES_TABLE).delete().eq('id', conceptEntryId);

  if (error) {
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      throw new MappingDraftError(
        'MAPPING_CONCEPT_ENTRY_HAS_ASSOCIATIONS',
        'This concept entry has associations and cannot be removed until they are removed first.',
        error,
      );
    }
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to remove concept entry: ${error.message ?? 'unknown'}`,
      error,
    );
  }
}
