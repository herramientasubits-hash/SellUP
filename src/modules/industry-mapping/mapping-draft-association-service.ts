// mapping-draft-association-service.ts — Provider Industry Mapping DRAFT
// Domain Service (Q3F-5AI). Association DRAFT mutations: addMappingAssociation,
// updateMappingAssociation, removeMappingAssociation. Catalog semantic
// resolution (CAT-FK2) remains physical/DB authority — this service does not
// implement it.

import {
  MappingDraftError,
  ASSOCIATIONS_TABLE,
  CONCEPT_ENTRIES_TABLE,
  PG_UNIQUE_VIOLATION,
  ASSOCIATION_CONCEPT_INDUSTRY_UNIQUE_CONSTRAINT,
  RELATION_SEMANTICS_VALUES,
  type MappingDraftDbClient,
  type MappingDraftDbError,
  type MappingAssociation,
  type AssociationRow,
  type RelationSemantics,
} from './mapping-draft-types';
import { requireOwnedDraft } from './mapping-draft-guard';

function isRelationSemantics(value: unknown): value is RelationSemantics {
  return typeof value === 'string' && (RELATION_SEMANTICS_VALUES as readonly string[]).includes(value);
}

function requireValidRelationSemantics(value: string): RelationSemantics {
  if (!isRelationSemantics(value)) {
    throw new MappingDraftError(
      'MAPPING_RELATION_SEMANTICS_INVALID',
      `Unknown relation semantics literal: ${value}`,
    );
  }
  return value;
}

function mapAssociationRow(row: AssociationRow): MappingAssociation {
  return {
    id: row.id,
    conceptEntryId: row.concept_entry_id,
    snapshotId: row.snapshot_id,
    industryId: row.industry_id,
    catalogVersionId: row.catalog_version_id,
    relationSemantics: row.relation_semantics as RelationSemantics,
    createdAt: row.created_at,
  };
}

function mapAssociationCollision(error: MappingDraftDbError): MappingDraftError | null {
  if (error.code === PG_UNIQUE_VIOLATION && error.message?.includes(ASSOCIATION_CONCEPT_INDUSTRY_UNIQUE_CONSTRAINT)) {
    return new MappingDraftError(
      'MAPPING_ASSOCIATION_ALREADY_EXISTS',
      'An association between this concept entry and industry already exists.',
      error,
    );
  }
  return null;
}

// Narrow local shape for the concept-entry lookup performed by
// addMappingAssociation below (avoids a cross-file import of ConceptEntryRow
// just for one field).
interface ConceptEntryLike {
  snapshot_id: string;
}

/** Resolves an association's parent snapshot id, throwing if not found. */
async function loadAssociationSnapshotId(
  db: MappingDraftDbClient,
  associationId: string,
): Promise<string> {
  const { data, error } = await db
    .from(ASSOCIATIONS_TABLE)
    .select('id, snapshot_id')
    .eq('id', associationId)
    .maybeSingle();

  if (error) {
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to load mapping association: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  if (!data) {
    throw new MappingDraftError('MAPPING_ASSOCIATION_NOT_FOUND', 'Mapping association not found.');
  }
  return (data as Pick<AssociationRow, 'id' | 'snapshot_id'>).snapshot_id;
}

// ── addMappingAssociation ────────────────────────────────────────────────────────

export interface AddMappingAssociationInput {
  snapshotId: string;
  conceptEntryId: string;
  actorId: string;
  industryId: string;
  catalogVersionId: string;
  relationSemantics: string;
}

/**
 * Adds an association from a concept entry to a canonical industry. Does not
 * block 2+ distinct industry targets per concept entry (AMBIGUOUS remains
 * valid) — only exact (concept_entry_id, industry_id) duplicates are rejected.
 */
export async function addMappingAssociation(
  db: MappingDraftDbClient,
  input: AddMappingAssociationInput,
): Promise<MappingAssociation> {
  const { snapshotId, conceptEntryId, actorId, industryId, catalogVersionId } = input;

  await requireOwnedDraft(db, { snapshotId, actorId });
  const relationSemantics = requireValidRelationSemantics(input.relationSemantics);

  const { data: conceptEntryData, error: conceptEntryError } = await db
    .from(CONCEPT_ENTRIES_TABLE)
    .select('id, snapshot_id')
    .eq('id', conceptEntryId)
    .maybeSingle();

  if (conceptEntryError) {
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to load concept entry: ${conceptEntryError.message ?? 'unknown'}`,
      conceptEntryError,
    );
  }
  if (!conceptEntryData) {
    throw new MappingDraftError('MAPPING_CONCEPT_ENTRY_NOT_FOUND', 'Concept entry not found.');
  }

  const conceptEntrySnapshotId = (conceptEntryData as Pick<ConceptEntryLike, 'snapshot_id'>).snapshot_id;
  if (conceptEntrySnapshotId !== snapshotId) {
    throw new MappingDraftError(
      'MAPPING_CONCEPT_ENTRY_SNAPSHOT_MISMATCH',
      'The concept entry does not belong to the target snapshot.',
    );
  }

  const { data, error } = await db
    .from(ASSOCIATIONS_TABLE)
    .insert({
      concept_entry_id: conceptEntryId,
      snapshot_id: snapshotId,
      industry_id: industryId,
      catalog_version_id: catalogVersionId,
      relation_semantics: relationSemantics,
    })
    .select('*')
    .single();

  if (error) {
    const collision = mapAssociationCollision(error);
    if (collision) throw collision;
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to add mapping association: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  if (!data) {
    throw new MappingDraftError('MAPPING_DRAFT_WRITE_FAILED', 'Insert succeeded but returned no row.');
  }

  return mapAssociationRow(data as unknown as AssociationRow);
}

// ── updateMappingAssociation ──────────────────────────────────────────────────────

export interface UpdateMappingAssociationInput {
  associationId: string;
  actorId: string;
  industryId?: string;
  catalogVersionId?: string;
  relationSemantics?: string;
}

/**
 * Updates the mutable fields of an owned-draft association: industry_id,
 * catalog_version_id, relation_semantics. snapshot_id and concept_entry_id
 * are never mutable through this function.
 */
export async function updateMappingAssociation(
  db: MappingDraftDbClient,
  input: UpdateMappingAssociationInput,
): Promise<MappingAssociation> {
  const { associationId, actorId } = input;

  const snapshotId = await loadAssociationSnapshotId(db, associationId);
  await requireOwnedDraft(db, { snapshotId, actorId });

  const patch: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(input, 'industryId')) {
    patch.industry_id = input.industryId;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'catalogVersionId')) {
    patch.catalog_version_id = input.catalogVersionId;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'relationSemantics')) {
    patch.relation_semantics = requireValidRelationSemantics(input.relationSemantics as string);
  }

  const { data, error } = await db
    .from(ASSOCIATIONS_TABLE)
    .update(patch)
    .eq('id', associationId)
    .select('*')
    .single();

  if (error) {
    const collision = mapAssociationCollision(error);
    if (collision) throw collision;
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to update mapping association: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  if (!data) {
    throw new MappingDraftError('MAPPING_DRAFT_WRITE_FAILED', 'Update succeeded but returned no row.');
  }

  return mapAssociationRow(data as unknown as AssociationRow);
}

// ── removeMappingAssociation ───────────────────────────────────────────────────────

export interface RemoveMappingAssociationInput {
  associationId: string;
  actorId: string;
}

export async function removeMappingAssociation(
  db: MappingDraftDbClient,
  input: RemoveMappingAssociationInput,
): Promise<void> {
  const { associationId, actorId } = input;

  const snapshotId = await loadAssociationSnapshotId(db, associationId);
  await requireOwnedDraft(db, { snapshotId, actorId });

  const { error } = await db.from(ASSOCIATIONS_TABLE).delete().eq('id', associationId);

  if (error) {
    throw new MappingDraftError(
      'MAPPING_DRAFT_WRITE_FAILED',
      `Failed to remove mapping association: ${error.message ?? 'unknown'}`,
      error,
    );
  }
}
