// mapping-snapshot-load2.ts — LOAD2: exact historical snapshot loader
// (Q3F-5AK).
//
// Loads an exact snapshot by id, status-first (no status predicate in the
// physical query), and returns it as a trusted non-null
// IndustryProviderMappingSnapshot (NS1) when its status is PUBLISHED or
// ARCHIVED. Does NOT gate on source vocabulary lifecycle — historical access
// to an ARCHIVED snapshot is permitted even for a DEPRECATED vocabulary. Never
// invents STALE/SUPERSEDED/REQUIRES_REVALIDATION or any other synthetic
// lifecycle status.

import { assembleTrustedSnapshot, loadCatalogVersionById, loadSnapshotById } from './mapping-snapshot-load-assembly';
import {
  MappingSnapshotLoadError,
  type IndustryProviderMappingSnapshot,
  type MappingSnapshotLoadDbClient,
} from './mapping-snapshot-load-types';

export interface LoadHistoricalIndustryMappingSnapshotInput {
  mappingSnapshotId: string;
}

export async function loadHistoricalIndustryMappingSnapshot(
  db: MappingSnapshotLoadDbClient,
  input: LoadHistoricalIndustryMappingSnapshotInput,
): Promise<IndustryProviderMappingSnapshot> {
  const { mappingSnapshotId } = input;

  // STEP 1-2: exact snapshot lookup by id, no status predicate.
  const snapshotRow = await loadSnapshotById(db, mappingSnapshotId);
  if (!snapshotRow) {
    throw new MappingSnapshotLoadError('SNAPSHOT_NOT_FOUND', 'Mapping snapshot was not found.', {
      mappingSnapshotId,
    });
  }

  // STEP 3-5: status-first gate.
  if (snapshotRow.status === 'draft') {
    throw new MappingSnapshotLoadError(
      'DRAFT_SNAPSHOT_NOT_HISTORICALLY_LOADABLE',
      'Draft mapping snapshots cannot be loaded as historical snapshots.',
      { mappingSnapshotId },
    );
  }
  if (snapshotRow.status !== 'published' && snapshotRow.status !== 'archived') {
    throw new MappingSnapshotLoadError(
      'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
      'Mapping snapshot has an unrecognized physical status.',
      { mappingSnapshotId },
    );
  }

  // STEP 6: no vocabulary lifecycle gate — historical access is exact-ID only.

  // STEP 7: snapshot-scope catalog version, loaded independently of associations.
  const catalogVersionRow = await loadCatalogVersionById(db, snapshotRow.catalog_version_id);
  if (!catalogVersionRow) {
    throw new MappingSnapshotLoadError(
      'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
      'Mapping snapshot references a catalog version that was not found.',
      { mappingSnapshotId },
    );
  }

  // STEP 8: trusted assembly.
  return assembleTrustedSnapshot(db, snapshotRow, catalogVersionRow, {});
}
