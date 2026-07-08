// mapping-snapshot-load2.test.ts — LOAD2 (loadHistoricalIndustryMappingSnapshot)
// coverage (Q3F-5AK). Offline fake DB only — no live Supabase, no network.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadHistoricalIndustryMappingSnapshot } from '../mapping-snapshot-load2';
import { MappingSnapshotLoadError } from '../mapping-snapshot-load-types';
import { makeFakePublicationDb, makeFakePublicationTableState } from './fake-mapping-publication-db';

const VOCAB_KEY = 'apollo/organizations';
const CATALOG_VERSION_ID = 'catalog-version-1';
const CATALOG_VERSION = '2026.1';

function baseTables(overrides: Record<string, Record<string, unknown>[]> = {}) {
  return {
    provider_industry_source_vocabularies: makeFakePublicationTableState(
      overrides.provider_industry_source_vocabularies ?? [
        { source_vocabulary_key: VOCAB_KEY, lifecycle: 'deprecated' },
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

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'snapshot-1',
    source_vocabulary_key: VOCAB_KEY,
    catalog_version_id: CATALOG_VERSION_ID,
    status: 'archived',
    version_label: 'v1',
    change_reason: 'initial publication',
    content_revision: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: 'user-author',
    published_at: '2026-01-02T00:00:00.000Z',
    published_by: 'user-publisher',
    archived_at: '2026-01-03T00:00:00.000Z',
    archived_by: 'user-archiver',
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

test('LOAD2: missing snapshot is a typed failure', async () => {
  const db = makeDb({ provider_industry_mapping_snapshots: [] });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_NOT_FOUND',
  );
});

test('LOAD2: draft snapshot is forbidden', async () => {
  const db = makeDb({ provider_industry_mapping_snapshots: [snapshotRow({ status: 'draft' })] });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'DRAFT_SNAPSHOT_NOT_HISTORICALLY_LOADABLE',
  );
});

test('LOAD2: published snapshot is allowed', async () => {
  const db = makeDb({
    provider_industry_mapping_snapshots: [snapshotRow({ status: 'published', archived_at: null, archived_by: null })],
  });
  const result = await loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' });
  assert.equal(result.status, 'published');
});

test('LOAD2: archived snapshot is allowed', async () => {
  const db = makeDb({ provider_industry_mapping_snapshots: [snapshotRow({ status: 'archived' })] });
  const result = await loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' });
  assert.equal(result.status, 'archived');
});

test('LOAD2: deprecated vocabulary does not block loading an archived snapshot', async () => {
  const db = makeDb({
    provider_industry_source_vocabularies: [{ source_vocabulary_key: VOCAB_KEY, lifecycle: 'deprecated' }],
    provider_industry_mapping_snapshots: [snapshotRow({ status: 'archived' })],
  });
  const result = await loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' });
  assert.equal(result.mappingSnapshotId, 'snapshot-1');
});

test('LOAD2: unknown physical status is an integrity failure', async () => {
  const db = makeDb({ provider_industry_mapping_snapshots: [snapshotRow({ status: 'stale' })] });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('LOAD2: empty archived snapshot loads successfully', async () => {
  const db = makeDb({ provider_industry_mapping_snapshots: [snapshotRow({ status: 'archived' })] });
  const result = await loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' });
  assert.equal(result.conceptEntries.length, 0);
});

test('LOAD2: empty archived snapshot still contains the semantic catalog version', async () => {
  const db = makeDb({ provider_industry_mapping_snapshots: [snapshotRow({ status: 'archived' })] });
  const result = await loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' });
  assert.equal(result.catalogVersion, CATALOG_VERSION);
});
