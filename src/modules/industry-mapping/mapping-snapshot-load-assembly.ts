// mapping-snapshot-load-assembly.ts — Provider Industry Mapping Trusted
// Snapshot Loaders (Q3F-5AK). Shared physical row loading and defensive
// integrity assembly used by both LOAD1 (loadPublishedIndustryMappingSnapshot)
// and LOAD2 (loadHistoricalIndustryMappingSnapshot).
//
// This module never invokes the canonical resolver, never mutates anything,
// and never returns null — every failure path throws a typed
// MappingSnapshotLoadError (NS1).

import { normalizeClassificationValue } from '@/modules/prospect-batches/import-classification/catalog-normalization';
import {
  ASSOCIATIONS_TABLE,
  CONCEPT_ENTRIES_TABLE,
  RELATION_SEMANTICS_VALUES,
  SNAPSHOTS_TABLE,
  type AssociationRow,
  type ConceptEntryRow,
  type MappingDraftDbError,
  type RelationSemantics,
  type SnapshotRow,
} from './mapping-draft-types';
import { INDUSTRIES_TABLE } from './mapping-publication-types';
import {
  CATALOG_VERSIONS_TABLE,
  SOURCE_VOCABULARIES_TABLE,
  MappingSnapshotLoadError,
  type CatalogVersionRow,
  type IndustryProviderMappingSnapshot,
  type IndustryTargetRow,
  type MappingSnapshotAssociation,
  type MappingSnapshotConceptEntry,
  type MappingSnapshotLoadDbClient,
  type SourceVocabularyRow,
} from './mapping-snapshot-load-types';

// ── Generic infrastructure-error boundary ────────────────────────────────────
// Distinguishes "query succeeded, zero/some rows" (legitimate absence, handled
// by call sites) from "the query itself failed" (generic, stable,
// non-retrying infrastructure failure). The original error is preserved only
// as `cause` — its text is never interpolated into the public message.

function infrastructureFailure(cause: MappingDraftDbError): MappingSnapshotLoadError {
  return new MappingSnapshotLoadError(
    'SNAPSHOT_LOAD_FAILED',
    'Failed to load provider industry mapping data due to an infrastructure error.',
    undefined,
    cause,
  );
}

function integrityError(
  message: string,
  context: MappingSnapshotLoadError['context'],
): MappingSnapshotLoadError {
  return new MappingSnapshotLoadError('SNAPSHOT_CONTENT_INTEGRITY_ERROR', message, context);
}

// ── Physical row loaders ──────────────────────────────────────────────────────

export async function loadVocabularyRow(
  db: MappingSnapshotLoadDbClient,
  sourceVocabularyKey: string,
): Promise<SourceVocabularyRow | null> {
  const { data, error } = await db
    .from(SOURCE_VOCABULARIES_TABLE)
    .select('*')
    .eq('source_vocabulary_key', sourceVocabularyKey)
    .maybeSingle();
  if (error) throw infrastructureFailure(error);
  return (data as unknown as SourceVocabularyRow | null) ?? null;
}

export async function loadCatalogVersionByVersionString(
  db: MappingSnapshotLoadDbClient,
  version: string,
): Promise<CatalogVersionRow | null> {
  const { data, error } = await db
    .from(CATALOG_VERSIONS_TABLE)
    .select('*')
    .eq('version', version)
    .maybeSingle();
  if (error) throw infrastructureFailure(error);
  return (data as unknown as CatalogVersionRow | null) ?? null;
}

export async function loadCatalogVersionById(
  db: MappingSnapshotLoadDbClient,
  catalogVersionId: string,
): Promise<CatalogVersionRow | null> {
  const { data, error } = await db
    .from(CATALOG_VERSIONS_TABLE)
    .select('*')
    .eq('id', catalogVersionId)
    .maybeSingle();
  if (error) throw infrastructureFailure(error);
  return (data as unknown as CatalogVersionRow | null) ?? null;
}

export async function loadSnapshotById(
  db: MappingSnapshotLoadDbClient,
  snapshotId: string,
): Promise<SnapshotRow | null> {
  const { data, error } = await db
    .from(SNAPSHOTS_TABLE)
    .select('*')
    .eq('id', snapshotId)
    .maybeSingle();
  if (error) throw infrastructureFailure(error);
  return (data as unknown as SnapshotRow | null) ?? null;
}

export async function loadPublishedSnapshotRows(
  db: MappingSnapshotLoadDbClient,
  sourceVocabularyKey: string,
  catalogVersionId: string,
): Promise<SnapshotRow[]> {
  const { data, error } = await db
    .from(SNAPSHOTS_TABLE)
    .select('*')
    .eq('source_vocabulary_key', sourceVocabularyKey)
    .eq('catalog_version_id', catalogVersionId)
    .eq('status', 'published');
  if (error) throw infrastructureFailure(error);
  return (data as unknown as SnapshotRow[] | null) ?? [];
}

async function loadConceptEntryRowsForSnapshot(
  db: MappingSnapshotLoadDbClient,
  snapshotId: string,
): Promise<ConceptEntryRow[]> {
  const { data, error } = await db.from(CONCEPT_ENTRIES_TABLE).select('*').eq('snapshot_id', snapshotId);
  if (error) throw infrastructureFailure(error);
  return (data as unknown as ConceptEntryRow[] | null) ?? [];
}

async function loadAssociationRowsForSnapshot(
  db: MappingSnapshotLoadDbClient,
  snapshotId: string,
): Promise<AssociationRow[]> {
  const { data, error } = await db.from(ASSOCIATIONS_TABLE).select('*').eq('snapshot_id', snapshotId);
  if (error) throw infrastructureFailure(error);
  return (data as unknown as AssociationRow[] | null) ?? [];
}

async function loadIndustryRowsForCatalogVersion(
  db: MappingSnapshotLoadDbClient,
  catalogVersionId: string,
): Promise<IndustryTargetRow[]> {
  const { data, error } = await db
    .from(INDUSTRIES_TABLE)
    .select('id, catalog_version_id, name, slug')
    .eq('catalog_version_id', catalogVersionId);
  if (error) throw infrastructureFailure(error);
  return (data as unknown as IndustryTargetRow[] | null) ?? [];
}

// ── Deterministic ordinal comparison (structural stability only — never a
// substitute for the canonical resolver's own contractual candidate order) ──

function ordinalCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ── Trusted assembly ──────────────────────────────────────────────────────────

export interface AssembleTrustedSnapshotOptions {
  /** LOAD1 only: the caller-requested semantic catalog version string. */
  requestedCatalogVersion?: string;
}

/**
 * Loads full snapshot content (concept entries, associations, canonical
 * industry targets) for an already-selected snapshot/catalog-version-scope
 * pair, defensively validates it (CP1 normalization parity + content
 * integrity checks), and assembles the trusted, deterministically-ordered
 * IndustryProviderMappingSnapshot. Any violation rejects the entire load with
 * SNAPSHOT_CONTENT_INTEGRITY_ERROR — never a partial or repaired snapshot.
 */
export async function assembleTrustedSnapshot(
  db: MappingSnapshotLoadDbClient,
  snapshotRow: SnapshotRow,
  catalogVersionRow: CatalogVersionRow,
  options: AssembleTrustedSnapshotOptions,
): Promise<IndustryProviderMappingSnapshot> {
  if (snapshotRow.catalog_version_id !== catalogVersionRow.id) {
    throw integrityError('Snapshot catalog_version_id does not match the loaded catalog version row.', {
      mappingSnapshotId: snapshotRow.id,
    });
  }

  if (
    options.requestedCatalogVersion !== undefined &&
    catalogVersionRow.version !== options.requestedCatalogVersion
  ) {
    throw integrityError('Resolved catalog version does not match the requested catalog version.', {
      mappingSnapshotId: snapshotRow.id,
      catalogVersion: options.requestedCatalogVersion,
    });
  }

  const [conceptEntryRows, associationRows, industryRows] = await Promise.all([
    loadConceptEntryRowsForSnapshot(db, snapshotRow.id),
    loadAssociationRowsForSnapshot(db, snapshotRow.id),
    loadIndustryRowsForCatalogVersion(db, snapshotRow.catalog_version_id),
  ]);

  // ── Concept entries: snapshot ownership (A) + CP1 normalization parity ────
  const conceptEntryById = new Map<string, ConceptEntryRow>();
  const conceptIdsByRecomputedKey = new Map<string, string[]>();

  for (const concept of conceptEntryRows) {
    if (concept.snapshot_id !== snapshotRow.id) {
      throw integrityError('Concept entry does not belong to the loaded snapshot.', {
        mappingSnapshotId: snapshotRow.id,
        conceptEntryId: concept.id,
      });
    }

    const expectedNormalizedKey = normalizeClassificationValue(concept.raw_label);

    if (expectedNormalizedKey === '') {
      throw integrityError('Recomputed normalized lookup key is empty.', {
        mappingSnapshotId: snapshotRow.id,
        conceptEntryId: concept.id,
      });
    }

    if (expectedNormalizedKey !== concept.normalized_lookup_key) {
      throw integrityError('Persisted normalized lookup key does not match the recomputed value.', {
        mappingSnapshotId: snapshotRow.id,
        conceptEntryId: concept.id,
        normalizedKey: expectedNormalizedKey,
      });
    }

    const bucket = conceptIdsByRecomputedKey.get(expectedNormalizedKey);
    if (bucket) {
      bucket.push(concept.id);
    } else {
      conceptIdsByRecomputedKey.set(expectedNormalizedKey, [concept.id]);
    }

    conceptEntryById.set(concept.id, concept);
  }

  // ── Normalized collision (COL1, section 18) ──────────────────────────────
  for (const [normalizedKey, conceptIds] of conceptIdsByRecomputedKey) {
    if (conceptIds.length > 1) {
      throw integrityError('Two or more concept entries normalize to the same lookup key.', {
        mappingSnapshotId: snapshotRow.id,
        normalizedKey,
      });
    }
  }

  // ── Associations: ownership, references, semantics, targets, duplicates ──
  const industryById = new Map<string, IndustryTargetRow>();
  for (const industry of industryRows) {
    industryById.set(industry.id, industry);
  }

  const relationSemanticsSet: ReadonlySet<string> = new Set(RELATION_SEMANTICS_VALUES);
  const associationsByConceptId = new Map<string, MappingSnapshotAssociation[]>();
  const seenTargets = new Set<string>();

  for (const association of associationRows) {
    if (association.snapshot_id !== snapshotRow.id) {
      throw integrityError('Association does not belong to the loaded snapshot.', {
        mappingSnapshotId: snapshotRow.id,
        associationId: association.id,
      });
    }

    const parentConcept = conceptEntryById.get(association.concept_entry_id);
    if (!parentConcept) {
      throw integrityError('Association references a concept entry that was not loaded for this snapshot.', {
        mappingSnapshotId: snapshotRow.id,
        associationId: association.id,
      });
    }
    if (parentConcept.snapshot_id !== association.snapshot_id) {
      throw integrityError("Association's parent concept entry does not belong to the association's snapshot.", {
        mappingSnapshotId: snapshotRow.id,
        associationId: association.id,
      });
    }

    if (association.catalog_version_id !== snapshotRow.catalog_version_id) {
      throw integrityError("Association's catalog_version_id does not match the snapshot's catalog_version_id.", {
        mappingSnapshotId: snapshotRow.id,
        associationId: association.id,
      });
    }

    if (!relationSemanticsSet.has(association.relation_semantics)) {
      throw integrityError('Association has an unrecognized relation_semantics literal.', {
        mappingSnapshotId: snapshotRow.id,
        associationId: association.id,
      });
    }

    const targetIndustry = industryById.get(association.industry_id);
    if (!targetIndustry) {
      throw integrityError(
        'Association targets a canonical industry that was not found within the snapshot catalog version.',
        {
          mappingSnapshotId: snapshotRow.id,
          associationId: association.id,
          industryId: association.industry_id,
        },
      );
    }

    const targetKey = `${association.concept_entry_id}::${association.industry_id}`;
    if (seenTargets.has(targetKey)) {
      throw integrityError('Two or more associations target the same concept entry and industry.', {
        mappingSnapshotId: snapshotRow.id,
        associationId: association.id,
      });
    }
    seenTargets.add(targetKey);

    const bucket = associationsByConceptId.get(association.concept_entry_id) ?? [];
    bucket.push({
      canonicalTarget: {
        id: targetIndustry.id,
        name: targetIndustry.name,
        slug: targetIndustry.slug,
        catalogVersion: catalogVersionRow.version,
      },
      sourceRelation: association.relation_semantics as RelationSemantics,
    });
    associationsByConceptId.set(association.concept_entry_id, bucket);
  }

  // ── Deterministic trusted assembly order (structural stability only) ────
  const conceptEntries: MappingSnapshotConceptEntry[] = [...conceptEntryById.values()]
    .sort((a, b) => ordinalCompare(a.id, b.id))
    .map((concept) => {
      const associations = [...(associationsByConceptId.get(concept.id) ?? [])].sort((a, b) => {
        const targetDelta = ordinalCompare(a.canonicalTarget.id, b.canonicalTarget.id);
        if (targetDelta !== 0) return targetDelta;
        return ordinalCompare(a.sourceRelation, b.sourceRelation);
      });

      return {
        conceptEntryId: concept.id,
        rawLabel: concept.raw_label,
        associations,
      };
    });

  return {
    mappingSnapshotId: snapshotRow.id,
    sourceVocabularyKey: snapshotRow.source_vocabulary_key,
    catalogVersion: catalogVersionRow.version,
    status: snapshotRow.status as 'published' | 'archived',
    createdBy: snapshotRow.created_by,
    publishedBy: snapshotRow.published_by,
    conceptEntries,
  };
}
