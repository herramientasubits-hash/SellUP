// mapping-snapshot-load1.ts — LOAD1: current runtime scope loader (Q3F-5AK).
//
// Resolves the exact PUBLISHED snapshot for a (sourceVocabularyKey,
// catalogVersion) scope, defensively validates it, and returns a trusted
// non-null IndustryProviderMappingSnapshot (NS1). Never invokes the canonical
// resolver. Never returns null for missing configuration — every failure is a
// typed MappingSnapshotLoadError.

import {
  assembleTrustedSnapshot,
  loadCatalogVersionByVersionString,
  loadPublishedSnapshotRows,
  loadVocabularyRow,
} from './mapping-snapshot-load-assembly';
import {
  MappingSnapshotLoadError,
  type IndustryProviderMappingSnapshot,
  type MappingSnapshotLoadDbClient,
} from './mapping-snapshot-load-types';

export interface LoadPublishedIndustryMappingSnapshotInput {
  sourceVocabularyKey: string;
  /** Semantic industry_catalog_versions.version string (not the UUID). */
  catalogVersion: string;
}

export async function loadPublishedIndustryMappingSnapshot(
  db: MappingSnapshotLoadDbClient,
  input: LoadPublishedIndustryMappingSnapshotInput,
): Promise<IndustryProviderMappingSnapshot> {
  const { sourceVocabularyKey, catalogVersion } = input;

  if (sourceVocabularyKey.trim() === '') {
    throw new MappingSnapshotLoadError(
      'VOCABULARY_NOT_REGISTERED',
      'sourceVocabularyKey must be a non-empty string.',
      { sourceVocabularyKey },
    );
  }

  // STEP 2-3: vocabulary registration + lifecycle.
  const vocabularyRow = await loadVocabularyRow(db, sourceVocabularyKey);
  if (!vocabularyRow) {
    throw new MappingSnapshotLoadError(
      'VOCABULARY_NOT_REGISTERED',
      'Provider industry source vocabulary is not registered.',
      { sourceVocabularyKey },
    );
  }
  if (vocabularyRow.lifecycle === 'deprecated') {
    throw new MappingSnapshotLoadError(
      'VOCABULARY_DEPRECATED',
      'Provider industry source vocabulary has been deprecated.',
      { sourceVocabularyKey },
    );
  }
  if (vocabularyRow.lifecycle !== 'active') {
    throw new MappingSnapshotLoadError(
      'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
      'Provider industry source vocabulary lifecycle value is not recognized.',
      { sourceVocabularyKey },
    );
  }

  // STEP 4: resolve requested semantic catalog version string.
  const catalogVersionRow = await loadCatalogVersionByVersionString(db, catalogVersion);
  if (!catalogVersionRow) {
    throw new MappingSnapshotLoadError(
      'CATALOG_VERSION_NOT_FOUND',
      'Requested industry catalog version was not found.',
      { catalogVersion },
    );
  }

  // STEP 5-7: exact single-PUBLISHED-snapshot scope resolution.
  const publishedSnapshotRows = await loadPublishedSnapshotRows(
    db,
    sourceVocabularyKey,
    catalogVersionRow.id,
  );

  if (publishedSnapshotRows.length === 0) {
    throw new MappingSnapshotLoadError(
      'NO_PUBLISHED_SNAPSHOT_FOR_REQUESTED_SCOPE',
      'No published mapping snapshot exists for the requested scope.',
      { sourceVocabularyKey, catalogVersion },
    );
  }
  if (publishedSnapshotRows.length > 1) {
    throw new MappingSnapshotLoadError(
      'MULTIPLE_PUBLISHED_SNAPSHOTS_INTEGRITY_ERROR',
      'More than one published mapping snapshot exists for the requested scope.',
      { sourceVocabularyKey, catalogVersion },
    );
  }

  // STEP 8: trusted assembly.
  return assembleTrustedSnapshot(db, publishedSnapshotRows[0], catalogVersionRow, {
    requestedCatalogVersion: catalogVersion,
  });
}
