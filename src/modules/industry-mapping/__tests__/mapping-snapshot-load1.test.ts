// mapping-snapshot-load1.test.ts — LOAD1 (loadPublishedIndustryMappingSnapshot)
// coverage (Q3F-5AK). Offline fake DB only — no live Supabase, no network.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadPublishedIndustryMappingSnapshot } from '../mapping-snapshot-load1';
import { MappingSnapshotLoadError } from '../mapping-snapshot-load-types';
import { makeFakePublicationDb, makeFakePublicationTableState } from './fake-mapping-publication-db';

const VOCAB_KEY = 'apollo/organizations';
const CATALOG_VERSION_ID = 'catalog-version-1';
const CATALOG_VERSION = '2026.1';

function baseTables(overrides: Record<string, Record<string, unknown>[]> = {}) {
  return {
    provider_industry_source_vocabularies: makeFakePublicationTableState(
      overrides.provider_industry_source_vocabularies ?? [
        { source_vocabulary_key: VOCAB_KEY, lifecycle: 'active' },
      ],
    ),
    industry_catalog_versions: makeFakePublicationTableState(
      overrides.industry_catalog_versions ?? [{ id: CATALOG_VERSION_ID, version: CATALOG_VERSION }],
    ),
    provider_industry_mapping_snapshots: makeFakePublicationTableState(
      overrides.provider_industry_mapping_snapshots ?? [],
    ),
    provider_industry_concept_entries: makeFakePublicationTableState(
      overrides.provider_industry_concept_entries ?? [],
    ),
    provider_industry_mapping_associations: makeFakePublicationTableState(
      overrides.provider_industry_mapping_associations ?? [],
    ),
    industries: makeFakePublicationTableState(overrides.industries ?? []),
  };
}

function makeDb(overrides: Record<string, Record<string, unknown>[]> = {}) {
  return makeFakePublicationDb(baseTables(overrides), () => ({ data: null, error: null }));
}

function publishedSnapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'snapshot-1',
    source_vocabulary_key: VOCAB_KEY,
    catalog_version_id: CATALOG_VERSION_ID,
    status: 'published',
    version_label: 'v1',
    change_reason: 'initial publication',
    content_revision: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: 'user-author',
    published_at: '2026-01-02T00:00:00.000Z',
    published_by: 'user-publisher',
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

async function assertRejectsWithCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof MappingSnapshotLoadError);
    assert.equal(error.code, code);
    return true;
  });
}

test('LOAD1: missing vocabulary is a typed failure', async () => {
  const db = makeDb({ provider_industry_source_vocabularies: [] });
  await assertRejectsWithCode(
    loadPublishedIndustryMappingSnapshot(db, { sourceVocabularyKey: VOCAB_KEY, catalogVersion: CATALOG_VERSION }),
    'VOCABULARY_NOT_REGISTERED',
  );
});

test('LOAD1: deprecated vocabulary is a typed failure', async () => {
  const db = makeDb({
    provider_industry_source_vocabularies: [{ source_vocabulary_key: VOCAB_KEY, lifecycle: 'deprecated' }],
  });
  await assertRejectsWithCode(
    loadPublishedIndustryMappingSnapshot(db, { sourceVocabularyKey: VOCAB_KEY, catalogVersion: CATALOG_VERSION }),
    'VOCABULARY_DEPRECATED',
  );
});

test('LOAD1: unknown vocabulary lifecycle value is a content-integrity failure', async () => {
  const db = makeDb({
    provider_industry_source_vocabularies: [{ source_vocabulary_key: VOCAB_KEY, lifecycle: 'weird' }],
  });
  await assertRejectsWithCode(
    loadPublishedIndustryMappingSnapshot(db, { sourceVocabularyKey: VOCAB_KEY, catalogVersion: CATALOG_VERSION }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('LOAD1: catalog version not found is a distinct typed failure', async () => {
  const db = makeDb({ industry_catalog_versions: [] });
  await assertRejectsWithCode(
    loadPublishedIndustryMappingSnapshot(db, { sourceVocabularyKey: VOCAB_KEY, catalogVersion: CATALOG_VERSION }),
    'CATALOG_VERSION_NOT_FOUND',
  );
});

test('LOAD1: valid catalog version but no published snapshot is a distinct typed failure', async () => {
  const db = makeDb({ provider_industry_mapping_snapshots: [] });
  await assertRejectsWithCode(
    loadPublishedIndustryMappingSnapshot(db, { sourceVocabularyKey: VOCAB_KEY, catalogVersion: CATALOG_VERSION }),
    'NO_PUBLISHED_SNAPSHOT_FOR_REQUESTED_SCOPE',
  );
});

test('LOAD1: two published snapshots for the same scope is an integrity failure', async () => {
  const db = makeDb({
    provider_industry_mapping_snapshots: [
      publishedSnapshotRow({ id: 'snapshot-1' }),
      publishedSnapshotRow({ id: 'snapshot-2' }),
    ],
  });
  await assertRejectsWithCode(
    loadPublishedIndustryMappingSnapshot(db, { sourceVocabularyKey: VOCAB_KEY, catalogVersion: CATALOG_VERSION }),
    'MULTIPLE_PUBLISHED_SNAPSHOTS_INTEGRITY_ERROR',
  );
});

test('LOAD1: one published empty snapshot loads successfully', async () => {
  const db = makeDb({ provider_industry_mapping_snapshots: [publishedSnapshotRow()] });
  const result = await loadPublishedIndustryMappingSnapshot(db, {
    sourceVocabularyKey: VOCAB_KEY,
    catalogVersion: CATALOG_VERSION,
  });
  assert.equal(result.conceptEntries.length, 0);
});

test('LOAD1: empty snapshot still contains the semantic catalog version', async () => {
  const db = makeDb({ provider_industry_mapping_snapshots: [publishedSnapshotRow()] });
  const result = await loadPublishedIndustryMappingSnapshot(db, {
    sourceVocabularyKey: VOCAB_KEY,
    catalogVersion: CATALOG_VERSION,
  });
  assert.equal(result.catalogVersion, CATALOG_VERSION);
});

test('LOAD1: known-but-unmapped concept (zero associations) is preserved', async () => {
  const db = makeDb({
    provider_industry_mapping_snapshots: [publishedSnapshotRow()],
    provider_industry_concept_entries: [
      { id: 'concept-banking', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
  });
  const result = await loadPublishedIndustryMappingSnapshot(db, {
    sourceVocabularyKey: VOCAB_KEY,
    catalogVersion: CATALOG_VERSION,
  });
  assert.equal(result.conceptEntries.length, 1);
  assert.equal(result.conceptEntries[0].rawLabel, 'banking');
  assert.deepEqual(result.conceptEntries[0].associations, []);
});

test('LOAD1: one association is assembled', async () => {
  const db = makeDb({
    provider_industry_mapping_snapshots: [publishedSnapshotRow()],
    provider_industry_concept_entries: [
      { id: 'concept-banking', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
    provider_industry_mapping_associations: [
      {
        id: 'assoc-1',
        concept_entry_id: 'concept-banking',
        snapshot_id: 'snapshot-1',
        industry_id: 'industry-finance',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
      },
    ],
    industries: [
      { id: 'industry-finance', catalog_version_id: CATALOG_VERSION_ID, name: 'Finance', slug: 'finance' },
    ],
  });
  const result = await loadPublishedIndustryMappingSnapshot(db, {
    sourceVocabularyKey: VOCAB_KEY,
    catalogVersion: CATALOG_VERSION,
  });
  assert.equal(result.conceptEntries[0].associations.length, 1);
  assert.equal(result.conceptEntries[0].associations[0].canonicalTarget.slug, 'finance');
  assert.equal(result.conceptEntries[0].associations[0].canonicalTarget.catalogVersion, CATALOG_VERSION);
  assert.equal(result.conceptEntries[0].associations[0].sourceRelation, 'SOURCE_EQUIVALENT_TO_CANONICAL');
});

test('LOAD1: two distinct targets for one concept assemble successfully (valid ambiguity)', async () => {
  const db = makeDb({
    provider_industry_mapping_snapshots: [publishedSnapshotRow()],
    provider_industry_concept_entries: [
      { id: 'concept-banking', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
    provider_industry_mapping_associations: [
      {
        id: 'assoc-1',
        concept_entry_id: 'concept-banking',
        snapshot_id: 'snapshot-1',
        industry_id: 'industry-finance',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
      },
      {
        id: 'assoc-2',
        concept_entry_id: 'concept-banking',
        snapshot_id: 'snapshot-1',
        industry_id: 'industry-insurance',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_BROADER_THAN_CANONICAL',
      },
    ],
    industries: [
      { id: 'industry-finance', catalog_version_id: CATALOG_VERSION_ID, name: 'Finance', slug: 'finance' },
      { id: 'industry-insurance', catalog_version_id: CATALOG_VERSION_ID, name: 'Insurance', slug: 'insurance' },
    ],
  });
  const result = await loadPublishedIndustryMappingSnapshot(db, {
    sourceVocabularyKey: VOCAB_KEY,
    catalogVersion: CATALOG_VERSION,
  });
  assert.equal(result.conceptEntries[0].associations.length, 2);
});

test('LOAD1: two catalog-version rows for the same requested semantic version is an integrity failure', async () => {
  const db = makeDb({
    industry_catalog_versions: [
      { id: CATALOG_VERSION_ID, version: CATALOG_VERSION },
      { id: 'catalog-version-2', version: CATALOG_VERSION },
    ],
  });
  await assertRejectsWithCode(
    loadPublishedIndustryMappingSnapshot(db, { sourceVocabularyKey: VOCAB_KEY, catalogVersion: CATALOG_VERSION }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('LOAD1: duplicate catalog-version integrity failure message does not leak raw DB detail', async () => {
  const db = makeDb({
    industry_catalog_versions: [
      { id: CATALOG_VERSION_ID, version: CATALOG_VERSION },
      { id: 'catalog-version-2', version: CATALOG_VERSION },
    ],
  });
  await assert.rejects(
    loadPublishedIndustryMappingSnapshot(db, { sourceVocabularyKey: VOCAB_KEY, catalogVersion: CATALOG_VERSION }),
    (error: unknown) => {
      assert.ok(error instanceof MappingSnapshotLoadError);
      assert.ok(!error.message.includes('SQLSTATE'));
      assert.ok(!error.message.includes('SELECT'));
      return true;
    },
  );
});

test('LOAD1: catalog-version query infrastructure error is a distinct typed failure', async () => {
  const db = makeDb();
  const failingDb = {
    ...db,
    from(table: string) {
      if (table !== 'industry_catalog_versions') return db.from(table);
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            async maybeSingle() {
              return { data: null, error: { message: 'FATAL: connection reset SQLSTATE 08006' } };
            },
            then(onfulfilled: (value: unknown) => unknown) {
              return Promise.resolve({
                data: null,
                error: { message: 'FATAL: connection reset SQLSTATE 08006' },
              }).then(onfulfilled);
            },
          };
          return chain;
        },
      };
    },
  };

  await assert.rejects(
    loadPublishedIndustryMappingSnapshot(failingDb as never, {
      sourceVocabularyKey: VOCAB_KEY,
      catalogVersion: CATALOG_VERSION,
    }),
    (error: unknown) => {
      assert.ok(error instanceof MappingSnapshotLoadError);
      assert.equal(error.code, 'SNAPSHOT_LOAD_FAILED');
      assert.notEqual(error.code, 'CATALOG_VERSION_NOT_FOUND');
      assert.ok(!error.message.includes('SQLSTATE'));
      assert.ok(!error.message.includes('connection reset'));
      return true;
    },
  );
});

test('LOAD1: reconstructed snapshot scope mismatch against requested catalog version is an integrity failure', async () => {
  // The single-PUBLISHED-scope query already filters by the resolved
  // catalog_version_id, so a mismatch cannot arise through LOAD1's own query
  // path — this exercises the defensive assembly-level check directly
  // (assembleTrustedSnapshot), the same function LOAD1 delegates to.
  const { assembleTrustedSnapshot } = await import('../mapping-snapshot-load-assembly');
  const db = makeDb({ provider_industry_mapping_snapshots: [publishedSnapshotRow()] });
  await assertRejectsWithCode(
    assembleTrustedSnapshot(
      db,
      publishedSnapshotRow() as unknown as import('../mapping-draft-types').SnapshotRow,
      { id: CATALOG_VERSION_ID, version: CATALOG_VERSION },
      { requestedCatalogVersion: 'a-different-requested-version' },
    ),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});
