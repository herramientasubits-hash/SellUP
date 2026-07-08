// mapping-snapshot-load-integrity.test.ts — CP1 defensive normalization
// parity, content-integrity checks, deterministic assembly, and the
// query/infrastructure error boundary for LOAD1/LOAD2 (Q3F-5AK). Offline fake
// DB only — no live Supabase, no network.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeClassificationValue } from '@/modules/prospect-batches/import-classification/catalog-normalization';
import { loadHistoricalIndustryMappingSnapshot } from '../mapping-snapshot-load2';
import { MappingSnapshotLoadError } from '../mapping-snapshot-load-types';
import { makeFakePublicationDb, makeFakePublicationTableState } from './fake-mapping-publication-db';

const CATALOG_VERSION_ID = 'catalog-version-1';
const CATALOG_VERSION = '2026.1';
const OTHER_CATALOG_VERSION_ID = 'catalog-version-2';

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'snapshot-1',
    source_vocabulary_key: 'apollo/organizations',
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

function makeDb(tableOverrides: Record<string, Record<string, unknown>[]>, rpcHandler?: () => unknown) {
  const tables = {
    provider_industry_source_vocabularies: makeFakePublicationTableState([
      { source_vocabulary_key: 'apollo/organizations', lifecycle: 'active' },
    ]),
    industry_catalog_versions: makeFakePublicationTableState([
      { id: CATALOG_VERSION_ID, version: CATALOG_VERSION },
    ]),
    provider_industry_mapping_snapshots: makeFakePublicationTableState([snapshotRow()]),
    provider_industry_concept_entries: makeFakePublicationTableState([]),
    provider_industry_mapping_associations: makeFakePublicationTableState([]),
    industries: makeFakePublicationTableState([]),
    ...Object.fromEntries(
      Object.entries(tableOverrides).map(([table, rows]) => [table, makeFakePublicationTableState(rows)]),
    ),
  };
  return makeFakePublicationDb(tables, (rpcHandler as never) ?? (() => ({ data: null, error: null })));
}

async function assertRejectsWithCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof MappingSnapshotLoadError);
    assert.equal(error.code, code);
    return true;
  });
}

async function load() {
  const db = makeDb({});
  return loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' });
}

test('CP1: persisted normalized key mismatch rejects the whole load', async () => {
  const db = makeDb({
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'snapshot-1', raw_label: 'Banking', normalized_lookup_key: 'wrong-key' },
    ],
  });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('CP1: empty recomputed key rejects the whole load', async () => {
  const db = makeDb({
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'snapshot-1', raw_label: '***', normalized_lookup_key: '' },
    ],
  });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('CP1: two raw labels that recompute to the same key collide and reject', async () => {
  assert.equal(normalizeClassificationValue('A-B'), normalizeClassificationValue('A B'));
  const key = normalizeClassificationValue('A-B');
  const db = makeDb({
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'snapshot-1', raw_label: 'A-B', normalized_lookup_key: key },
      { id: 'c2', snapshot_id: 'snapshot-1', raw_label: 'A B', normalized_lookup_key: key },
    ],
  });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

// The loader's own physical queries filter concept/association reads by
// `.eq('snapshot_id', ...)`, so a foreign-snapshot row can never survive a
// correctly-filtering adapter. These two tests use a deliberately "leaky"
// fake adapter (one table ignores its eq() filter, as a buggy view or a real
// query-layer defect might) to prove the assembly layer itself — not just the
// query shape — rejects cross-snapshot content it did not ask for.
function makeLeakyDb(leakyTable: string, tableOverrides: Record<string, Record<string, unknown>[]>) {
  const db = makeDb(tableOverrides);
  return {
    ...db,
    from(table: string) {
      if (table !== leakyTable) return db.from(table);
      const rows = tableOverrides[leakyTable] ?? [];
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
            then(onfulfilled: (value: unknown) => unknown) {
              return Promise.resolve({ data: rows, error: null }).then(onfulfilled);
            },
          };
          return chain;
        },
      };
    },
  };
}

test('integrity: concept parent snapshot mismatch rejects', async () => {
  const db = makeLeakyDb('provider_industry_concept_entries', {
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'other-snapshot', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
  });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db as never, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('integrity: association parent snapshot mismatch rejects', async () => {
  const db = makeLeakyDb('provider_industry_mapping_associations', {
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
    provider_industry_mapping_associations: [
      {
        id: 'a1',
        concept_entry_id: 'c1',
        snapshot_id: 'other-snapshot',
        industry_id: 'i1',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
      },
    ],
    industries: [{ id: 'i1', catalog_version_id: CATALOG_VERSION_ID, name: 'Finance', slug: 'finance' }],
  });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db as never, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('integrity: association missing concept rejects', async () => {
  const db = makeDb({
    provider_industry_mapping_associations: [
      {
        id: 'a1',
        concept_entry_id: 'missing-concept',
        snapshot_id: 'snapshot-1',
        industry_id: 'i1',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
      },
    ],
    industries: [{ id: 'i1', catalog_version_id: CATALOG_VERSION_ID, name: 'Finance', slug: 'finance' }],
  });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('integrity: association catalog-version mismatch rejects', async () => {
  const db = makeDb({
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
    provider_industry_mapping_associations: [
      {
        id: 'a1',
        concept_entry_id: 'c1',
        snapshot_id: 'snapshot-1',
        industry_id: 'i1',
        catalog_version_id: OTHER_CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
      },
    ],
    industries: [{ id: 'i1', catalog_version_id: CATALOG_VERSION_ID, name: 'Finance', slug: 'finance' }],
  });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('integrity: invalid lowercase relation semantics rejects', async () => {
  const db = makeDb({
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
    provider_industry_mapping_associations: [
      {
        id: 'a1',
        concept_entry_id: 'c1',
        snapshot_id: 'snapshot-1',
        industry_id: 'i1',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'source_equivalent_to_canonical',
      },
    ],
    industries: [{ id: 'i1', catalog_version_id: CATALOG_VERSION_ID, name: 'Finance', slug: 'finance' }],
  });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('integrity: target industry missing rejects', async () => {
  const db = makeDb({
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
    provider_industry_mapping_associations: [
      {
        id: 'a1',
        concept_entry_id: 'c1',
        snapshot_id: 'snapshot-1',
        industry_id: 'missing-industry',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
      },
    ],
    industries: [],
  });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('integrity: target industry belonging to a different catalog version rejects', async () => {
  const db = makeDb({
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
    provider_industry_mapping_associations: [
      {
        id: 'a1',
        concept_entry_id: 'c1',
        snapshot_id: 'snapshot-1',
        industry_id: 'i1',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
      },
    ],
    // Industry exists, but scoped to a different catalog version — the loader
    // filters industries by the snapshot's own catalog_version_id, so this
    // target is indistinguishable from "not found" at the loaded-scope level.
    industries: [{ id: 'i1', catalog_version_id: OTHER_CATALOG_VERSION_ID, name: 'Finance', slug: 'finance' }],
  });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('integrity: duplicate association for the same concept+target rejects', async () => {
  const db = makeDb({
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
    provider_industry_mapping_associations: [
      {
        id: 'a1',
        concept_entry_id: 'c1',
        snapshot_id: 'snapshot-1',
        industry_id: 'i1',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
      },
      {
        id: 'a2',
        concept_entry_id: 'c1',
        snapshot_id: 'snapshot-1',
        industry_id: 'i1',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_NARROWER_THAN_CANONICAL',
      },
    ],
    industries: [{ id: 'i1', catalog_version_id: CATALOG_VERSION_ID, name: 'Finance', slug: 'finance' }],
  });
  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_CONTENT_INTEGRITY_ERROR',
  );
});

test('integrity: two distinct targets for one concept do NOT reject (valid ambiguity)', async () => {
  const db = makeDb({
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
    provider_industry_mapping_associations: [
      {
        id: 'a1',
        concept_entry_id: 'c1',
        snapshot_id: 'snapshot-1',
        industry_id: 'i1',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
      },
      {
        id: 'a2',
        concept_entry_id: 'c1',
        snapshot_id: 'snapshot-1',
        industry_id: 'i2',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_NARROWER_THAN_CANONICAL',
      },
    ],
    industries: [
      { id: 'i1', catalog_version_id: CATALOG_VERSION_ID, name: 'Finance', slug: 'finance' },
      { id: 'i2', catalog_version_id: CATALOG_VERSION_ID, name: 'Insurance', slug: 'insurance' },
    ],
  });
  const result = await loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' });
  assert.equal(result.conceptEntries[0].associations.length, 2);
});

test('determinism: input physical row order does not change trusted output', async () => {
  const concepts = [
    { id: 'c2', snapshot_id: 'snapshot-1', raw_label: 'insurance', normalized_lookup_key: 'insurance' },
    { id: 'c1', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
  ];
  const associations = [
    {
      id: 'a2',
      concept_entry_id: 'c2',
      snapshot_id: 'snapshot-1',
      industry_id: 'i2',
      catalog_version_id: CATALOG_VERSION_ID,
      relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
    },
    {
      id: 'a1',
      concept_entry_id: 'c1',
      snapshot_id: 'snapshot-1',
      industry_id: 'i1',
      catalog_version_id: CATALOG_VERSION_ID,
      relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
    },
  ];
  const industries = [
    { id: 'i2', catalog_version_id: CATALOG_VERSION_ID, name: 'Insurance', slug: 'insurance' },
    { id: 'i1', catalog_version_id: CATALOG_VERSION_ID, name: 'Finance', slug: 'finance' },
  ];

  const dbForward = makeDb({
    provider_industry_concept_entries: concepts,
    provider_industry_mapping_associations: associations,
    industries,
  });
  const dbReversed = makeDb({
    provider_industry_concept_entries: [...concepts].reverse(),
    provider_industry_mapping_associations: [...associations].reverse(),
    industries: [...industries].reverse(),
  });

  const forward = await loadHistoricalIndustryMappingSnapshot(dbForward, { mappingSnapshotId: 'snapshot-1' });
  const reversed = await loadHistoricalIndustryMappingSnapshot(dbReversed, { mappingSnapshotId: 'snapshot-1' });

  assert.deepEqual(forward, reversed);
  assert.deepEqual(
    forward.conceptEntries.map((c) => c.conceptEntryId),
    ['c1', 'c2'],
  );
});

test('determinism: concept output order is stable ascending by id', async () => {
  const result = await (async () => {
    const db = makeDb({
      provider_industry_concept_entries: [
        { id: 'zzz', snapshot_id: 'snapshot-1', raw_label: 'zzz', normalized_lookup_key: 'zzz' },
        { id: 'aaa', snapshot_id: 'snapshot-1', raw_label: 'aaa', normalized_lookup_key: 'aaa' },
      ],
    });
    return loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' });
  })();
  assert.deepEqual(
    result.conceptEntries.map((c) => c.conceptEntryId),
    ['aaa', 'zzz'],
  );
});

test('determinism: association output order is stable ascending by canonical target id', async () => {
  const db = makeDb({
    provider_industry_concept_entries: [
      { id: 'c1', snapshot_id: 'snapshot-1', raw_label: 'banking', normalized_lookup_key: 'banking' },
    ],
    provider_industry_mapping_associations: [
      {
        id: 'a1',
        concept_entry_id: 'c1',
        snapshot_id: 'snapshot-1',
        industry_id: 'zzz-industry',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
      },
      {
        id: 'a2',
        concept_entry_id: 'c1',
        snapshot_id: 'snapshot-1',
        industry_id: 'aaa-industry',
        catalog_version_id: CATALOG_VERSION_ID,
        relation_semantics: 'SOURCE_NARROWER_THAN_CANONICAL',
      },
    ],
    industries: [
      { id: 'zzz-industry', catalog_version_id: CATALOG_VERSION_ID, name: 'Zzz', slug: 'zzz' },
      { id: 'aaa-industry', catalog_version_id: CATALOG_VERSION_ID, name: 'Aaa', slug: 'aaa' },
    ],
  });
  const result = await loadHistoricalIndustryMappingSnapshot(db, { mappingSnapshotId: 'snapshot-1' });
  assert.deepEqual(
    result.conceptEntries[0].associations.map((a) => a.canonicalTarget.id),
    ['aaa-industry', 'zzz-industry'],
  );
});

test('error boundary: an infrastructure query error does not become not-found', async () => {
  const db = makeFakePublicationDb(
    {
      provider_industry_mapping_snapshots: {
        rows: [],
      },
    },
    () => ({ data: null, error: null }),
  );
  // Override the snapshots table's select to simulate an infrastructure error
  // by monkey-patching the returned chain's resolution.
  const originalFrom = db.from.bind(db);
  const failingDb = {
    ...db,
    from(table: string) {
      if (table !== 'provider_industry_mapping_snapshots') return originalFrom(table);
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            async maybeSingle() {
              return { data: null, error: { message: 'connection reset' } };
            },
            then(onfulfilled: (value: unknown) => unknown) {
              return Promise.resolve({ data: null, error: { message: 'connection reset' } }).then(onfulfilled);
            },
          };
          return chain;
        },
      };
    },
  };

  await assertRejectsWithCode(
    loadHistoricalIndustryMappingSnapshot(failingDb as never, { mappingSnapshotId: 'snapshot-1' }),
    'SNAPSHOT_LOAD_FAILED',
  );
});

test('error boundary: the generic loader error public message does not leak raw DB text', async () => {
  const db = makeFakePublicationDb({ provider_industry_mapping_snapshots: { rows: [] } }, () => ({
    data: null,
    error: null,
  }));
  const failingDb = {
    ...db,
    from(table: string) {
      if (table !== 'provider_industry_mapping_snapshots') return db.from(table);
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            async maybeSingle() {
              return { data: null, error: { message: 'FATAL: relation "x" does not exist SQLSTATE 42P01' } };
            },
            then(onfulfilled: (value: unknown) => unknown) {
              return Promise.resolve({
                data: null,
                error: { message: 'FATAL: relation "x" does not exist SQLSTATE 42P01' },
              }).then(onfulfilled);
            },
          };
          return chain;
        },
      };
    },
  };

  await assert.rejects(
    loadHistoricalIndustryMappingSnapshot(failingDb as never, { mappingSnapshotId: 'snapshot-1' }),
    (error: unknown) => {
      assert.ok(error instanceof MappingSnapshotLoadError);
      assert.ok(!error.message.includes('SQLSTATE'));
      assert.ok(!error.message.includes('relation'));
      return true;
    },
  );
});

test('no loader success ever returns null', async () => {
  const result = await load();
  assert.notEqual(result, null);
  assert.notEqual(result, undefined);
});

test('normalizer is imported and reused, not duplicated', async () => {
  const assemblySource = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../mapping-snapshot-load-assembly.ts', import.meta.url), 'utf8'),
  );
  assert.ok(assemblySource.includes("from '@/modules/prospect-batches/import-classification/catalog-normalization'"));
  assert.ok(!/function normalizeClassificationValue/.test(assemblySource));
});
