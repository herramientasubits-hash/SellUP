// mapping-publication-service.ts — Provider Industry Mapping Publication
// Domain Service (Q3F-5AJ).
//
// Frozen trust model: DOMAIN_VALIDATOR + PV1_REVISION_PIN + PUBLICATION_RPC.
// This service proves that validateProviderIndustryMappingForPublication()
// executed against the exact loaded snapshot content, captures that
// snapshot's content_revision itself (never accepted from the public caller),
// and pins publication to it via the migration 082 publication RPC's
// p_expected_content_revision parameter. The RPC's own DB-owned revision
// check (STEP 3 of publish_provider_industry_mapping_snapshot) remains the
// physical proof that no concurrent DRAFT mutation slipped in between
// validation and publication — this service does not itself lock any row and
// does not, by itself, prove race safety (see report section on PV1
// interpretation).
//
// This service never UPDATEs snapshot.status, published_at, or published_by
// directly, and never archives a prior published snapshot directly — the
// publication RPC owns all of that lifecycle transition.

import {
  MappingDraftError,
  SNAPSHOTS_TABLE,
  CONCEPT_ENTRIES_TABLE,
  ASSOCIATIONS_TABLE,
  type SnapshotRow,
  type ConceptEntryRow,
  type AssociationRow,
} from './mapping-draft-types';
import {
  INDUSTRIES_TABLE,
  PUBLISH_MAPPING_SNAPSHOT_RPC,
  PUBLICATION_RPC_RAISE,
  MappingPublicationValidationError,
  type MappingPublicationDbClient,
} from './mapping-publication-types';
import {
  validateProviderIndustryMappingForPublication,
  type PublicationValidatorCanonicalIndustryInput,
} from './mapping-publication-validator';

// ── Narrow local row shape for the industries lookup (migration 057) ────────
// Only the two columns this service needs — not a duplicate of the full
// industry-catalog module's row types.

interface CanonicalIndustryRow {
  id: string;
  catalog_version_id: string;
}

// ── publishMappingSnapshot ───────────────────────────────────────────────────

export interface PublishMappingSnapshotInput {
  snapshotId: string;
  publisherActorId: string;
}

/**
 * Minimum grounded result: the migration 082 publication RPC returns `void`,
 * so this is not a fabricated snapshot payload — it is what this service
 * itself did and verified (the exact revision it validated and pinned).
 */
export interface PublishMappingSnapshotResult {
  snapshotId: string;
  publishedBy: string;
  validatedContentRevision: number;
}

async function loadSnapshotRow(
  db: MappingPublicationDbClient,
  snapshotId: string,
): Promise<SnapshotRow> {
  const { data, error } = await db
    .from(SNAPSHOTS_TABLE)
    .select('*')
    .eq('id', snapshotId)
    .maybeSingle();

  if (error) {
    throw new MappingDraftError(
      'MAPPING_PUBLICATION_FAILED',
      `Failed to load mapping snapshot for publication: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  if (!data) {
    throw new MappingDraftError('MAPPING_SNAPSHOT_NOT_FOUND', 'Mapping snapshot not found.');
  }
  return data as unknown as SnapshotRow;
}

async function loadConceptEntryRows(
  db: MappingPublicationDbClient,
  snapshotId: string,
): Promise<ConceptEntryRow[]> {
  const { data, error } = await db.from(CONCEPT_ENTRIES_TABLE).select('*').eq('snapshot_id', snapshotId);

  if (error) {
    throw new MappingDraftError(
      'MAPPING_PUBLICATION_FAILED',
      `Failed to load concept entries for publication: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  return (data ?? []) as unknown as ConceptEntryRow[];
}

async function loadAssociationRows(
  db: MappingPublicationDbClient,
  snapshotId: string,
): Promise<AssociationRow[]> {
  const { data, error } = await db.from(ASSOCIATIONS_TABLE).select('*').eq('snapshot_id', snapshotId);

  if (error) {
    throw new MappingDraftError(
      'MAPPING_PUBLICATION_FAILED',
      `Failed to load mapping associations for publication: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  return (data ?? []) as unknown as AssociationRow[];
}

async function loadCanonicalIndustries(
  db: MappingPublicationDbClient,
  catalogVersionId: string,
): Promise<PublicationValidatorCanonicalIndustryInput[]> {
  const { data, error } = await db
    .from(INDUSTRIES_TABLE)
    .select('id, catalog_version_id')
    .eq('catalog_version_id', catalogVersionId);

  if (error) {
    throw new MappingDraftError(
      'MAPPING_PUBLICATION_FAILED',
      `Failed to load canonical industries for publication: ${error.message ?? 'unknown'}`,
      error,
    );
  }
  return ((data ?? []) as unknown as CanonicalIndustryRow[]).map((row) => ({
    id: row.id,
    catalogVersionId: row.catalog_version_id,
  }));
}

/**
 * BIGINT3 (Q3F-5AJ section 33): content_revision is a monotonic per-snapshot
 * counter (migration 082, BIGINT column) bumped by exactly 1 per semantic
 * DRAFT mutation. The DRAFT service (Q3F-5AI) already represents it as a
 * JavaScript `number` end-to-end (SnapshotRow.content_revision) — this
 * service reuses that established representation rather than introducing a
 * second, inconsistent wire strategy for the same column. Number.isSafeInteger
 * defensively bounds the application contract: under real domain usage this
 * counter cannot approach 2^53, and if it ever did (DB corruption, typing
 * drift), publication fails closed instead of silently truncating precision.
 */
function requireSafeContentRevision(contentRevision: number, snapshotId: string): number {
  if (!Number.isSafeInteger(contentRevision)) {
    throw new MappingDraftError(
      'MAPPING_PUBLICATION_FAILED',
      `Snapshot content_revision (${String(contentRevision)}) exceeds the safe-integer bound for snapshot ${snapshotId}.`,
    );
  }
  return contentRevision;
}

function mapPublicationRpcError(error: { code?: string; message?: string }): MappingDraftError {
  const message = (error.message ?? '').trim();

  if (message.includes(PUBLICATION_RPC_RAISE.SNAPSHOT_NOT_FOUND)) {
    return new MappingDraftError('MAPPING_SNAPSHOT_NOT_FOUND', 'Mapping snapshot not found.', error);
  }
  if (message.includes(PUBLICATION_RPC_RAISE.SNAPSHOT_NOT_DRAFT)) {
    return new MappingDraftError(
      'MAPPING_SNAPSHOT_NOT_DRAFT',
      'Mapping snapshot is not in draft status.',
      error,
    );
  }
  if (message.includes(PUBLICATION_RPC_RAISE.SELF_APPROVAL_FORBIDDEN)) {
    return new MappingDraftError(
      'MAPPING_PUBLISHER_MUST_DIFFER_FROM_CREATOR',
      'The publisher must differ from the snapshot author.',
      error,
    );
  }
  if (message.includes(PUBLICATION_RPC_RAISE.DRAFT_CONTENT_CHANGED_AFTER_VALIDATION)) {
    return new MappingDraftError(
      'MAPPING_PUBLICATION_REVISION_STALE',
      'The draft content changed after validation; publication was rejected.',
      error,
    );
  }
  if (message.includes(PUBLICATION_RPC_RAISE.VOCABULARY_DEPRECATED)) {
    return new MappingDraftError(
      'MAPPING_PUBLICATION_VOCABULARY_DEPRECATED',
      'The source vocabulary was deprecated before publication completed.',
      error,
    );
  }
  if (message.includes(PUBLICATION_RPC_RAISE.VERSION_LABEL_REQUIRED)) {
    return new MappingDraftError(
      'MAPPING_PUBLICATION_VERSION_LABEL_REQUIRED',
      'versionLabel is required for publication.',
      error,
    );
  }
  if (message.includes(PUBLICATION_RPC_RAISE.CHANGE_REASON_REQUIRED)) {
    return new MappingDraftError(
      'MAPPING_PUBLICATION_CHANGE_REASON_REQUIRED',
      'changeReason is required for publication.',
      error,
    );
  }

  return new MappingDraftError(
    'MAPPING_PUBLICATION_FAILED',
    `Publication RPC failed: ${message || 'unknown error'}`,
    error,
  );
}

/**
 * Publishes a DRAFT provider industry mapping snapshot. The caller supplies
 * only `snapshotId` and `publisherActorId` — the expected content_revision is
 * never accepted as public input; this service loads and captures it itself
 * from the exact snapshot content it validates, then pins the physical
 * publication RPC to that captured value.
 */
export async function publishMappingSnapshot(
  db: MappingPublicationDbClient,
  input: PublishMappingSnapshotInput,
): Promise<PublishMappingSnapshotResult> {
  const { snapshotId, publisherActorId } = input;

  // STEP 1: load snapshot.
  const snapshotRow = await loadSnapshotRow(db, snapshotId);

  // STEP 2: verify draft state (application-level precheck; the RPC remains
  // DB lifecycle authority).
  if (snapshotRow.status !== 'draft') {
    throw new MappingDraftError(
      'MAPPING_SNAPSHOT_NOT_DRAFT',
      'Mapping snapshot is not in draft status.',
    );
  }

  // STEP 3: verify publisher != creator (application-level precheck; the RPC
  // owns the structural author-inequality guard too — no role override).
  if (publisherActorId === snapshotRow.created_by) {
    throw new MappingDraftError(
      'MAPPING_PUBLISHER_MUST_DIFFER_FROM_CREATOR',
      'The publisher must differ from the snapshot author.',
    );
  }

  // STEP 4: load exact snapshot content required by the validator.
  const [conceptEntryRows, associationRows, canonicalIndustries] = await Promise.all([
    loadConceptEntryRows(db, snapshotId),
    loadAssociationRows(db, snapshotId),
    loadCanonicalIndustries(db, snapshotRow.catalog_version_id),
  ]);

  // STEP 5: capture the exact revision being validated. Never sourced from
  // caller input.
  const validatedContentRevision = requireSafeContentRevision(snapshotRow.content_revision, snapshotId);

  // STEP 6: run the pure validator.
  const validationResult = validateProviderIndustryMappingForPublication({
    snapshot: {
      id: snapshotRow.id,
      sourceVocabularyKey: snapshotRow.source_vocabulary_key,
      catalogVersionId: snapshotRow.catalog_version_id,
      status: snapshotRow.status,
      contentRevision: validatedContentRevision,
      createdBy: snapshotRow.created_by,
      versionLabel: snapshotRow.version_label,
      changeReason: snapshotRow.change_reason,
    },
    conceptEntries: conceptEntryRows.map((row) => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      rawLabel: row.raw_label,
      normalizedLookupKey: row.normalized_lookup_key,
    })),
    associations: associationRows.map((row) => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      conceptEntryId: row.concept_entry_id,
      industryId: row.industry_id,
      catalogVersionId: row.catalog_version_id,
      relationSemantics: row.relation_semantics,
    })),
    canonicalIndustries,
  });

  // STEP 7: on invalid, never invoke the RPC.
  if (!validationResult.valid) {
    throw new MappingPublicationValidationError(
      'Pre-publication validation failed for this mapping snapshot.',
      validationResult.issues,
    );
  }

  // STEP 8-9: only if valid, invoke the exact physical publication RPC with
  // the captured, validated revision.
  const { error: rpcError } = await db.rpc(PUBLISH_MAPPING_SNAPSHOT_RPC, {
    p_snapshot_id: snapshotId,
    p_publisher_id: publisherActorId,
    p_expected_content_revision: validatedContentRevision,
  });

  if (rpcError) {
    throw mapPublicationRpcError(rpcError);
  }

  return {
    snapshotId,
    publishedBy: publisherActorId,
    validatedContentRevision,
  };
}
