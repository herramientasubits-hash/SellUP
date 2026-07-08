// Tests — mapping-publication-service.ts (Q3F-5AJ)
// Offline: no Supabase, no network, no live DB. Uses the injectable fake
// publication DB/RPC client. Proves the PV1 revision-pin sequence and
// physical-to-domain RPC error mapping — it does NOT prove DB row locking or
// live concurrency (see report PV1 interpretation section).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { publishMappingSnapshot } from '../mapping-publication-service';
import { MappingDraftError, SNAPSHOTS_TABLE, CONCEPT_ENTRIES_TABLE, ASSOCIATIONS_TABLE } from '../mapping-draft-types';
import { INDUSTRIES_TABLE, PUBLISH_MAPPING_SNAPSHOT_RPC, MappingPublicationValidationError } from '../mapping-publication-types';
import { makeFakePublicationDb, makeFakePublicationTableState, type FakeRpcHandler } from './fake-mapping-publication-db';

const CREATOR = 'actor-aaaa-0000-0000-0000-000000000001';
const PUBLISHER = 'actor-bbbb-0000-0000-0000-000000000002';
const SNAPSHOT_ID = 'snap-0001';
const CATALOG_VERSION_ID = 'catalog-v1';

function baseSnapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SNAPSHOT_ID,
    source_vocabulary_key: 'apollo/organizations',
    catalog_version_id: CATALOG_VERSION_ID,
    status: 'draft',
    version_label: 'v1',
    change_reason: 'initial mapping',
    content_revision: 5,
    created_at: new Date(0).toISOString(),
    created_by: CREATOR,
    published_at: null,
    published_by: null,
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

const NEVER_CALLED_RPC: FakeRpcHandler = () => {
  throw new Error('RPC should not have been called for this test.');
};

function successRpc(): FakeRpcHandler {
  return () => ({ data: null, error: null });
}

function recordingRpc(sink: { calls: Array<{ fn: string; params: Record<string, unknown> }> }): FakeRpcHandler {
  return (fn, params) => {
    sink.calls.push({ fn, params });
    return { data: null, error: null };
  };
}

function failingRpc(message: string): FakeRpcHandler {
  return () => ({ data: null, error: { code: 'P0001', message } });
}

function makeDb(options: {
  snapshotRows?: Record<string, unknown>[];
  conceptEntryRows?: Record<string, unknown>[];
  associationRows?: Record<string, unknown>[];
  industryRows?: Record<string, unknown>[];
  rpc: FakeRpcHandler;
}) {
  return makeFakePublicationDb(
    {
      [SNAPSHOTS_TABLE]: makeFakePublicationTableState(options.snapshotRows ?? [baseSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: makeFakePublicationTableState(options.conceptEntryRows ?? []),
      [ASSOCIATIONS_TABLE]: makeFakePublicationTableState(options.associationRows ?? []),
      [INDUSTRIES_TABLE]: makeFakePublicationTableState(options.industryRows ?? []),
    },
    options.rpc,
  );
}

describe('publishMappingSnapshot — snapshot/publisher guards', () => {
  it('1. missing snapshot mapped', async () => {
    const db = makeDb({ snapshotRows: [], rpc: NEVER_CALLED_RPC });
    await assert.rejects(
      () => publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER }),
      (error: unknown) => error instanceof MappingDraftError && error.code === 'MAPPING_SNAPSHOT_NOT_FOUND',
    );
  });

  it('2. published snapshot rejected', async () => {
    const db = makeDb({ snapshotRows: [baseSnapshotRow({ status: 'published' })], rpc: NEVER_CALLED_RPC });
    await assert.rejects(
      () => publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER }),
      (error: unknown) => error instanceof MappingDraftError && error.code === 'MAPPING_SNAPSHOT_NOT_DRAFT',
    );
  });

  it('3. archived snapshot rejected', async () => {
    const db = makeDb({ snapshotRows: [baseSnapshotRow({ status: 'archived' })], rpc: NEVER_CALLED_RPC });
    await assert.rejects(
      () => publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER }),
      (error: unknown) => error instanceof MappingDraftError && error.code === 'MAPPING_SNAPSHOT_NOT_DRAFT',
    );
  });

  it('4. publisher equal creator rejected', async () => {
    const db = makeDb({ rpc: NEVER_CALLED_RPC });
    await assert.rejects(
      () => publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: CREATOR }),
      (error: unknown) =>
        error instanceof MappingDraftError && error.code === 'MAPPING_PUBLISHER_MUST_DIFFER_FROM_CREATOR',
    );
  });

  it('5. publisher inequality accepts another actor without role checks', async () => {
    const db = makeDb({ rpc: successRpc() });
    const result = await publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER });
    assert.equal(result.publishedBy, PUBLISHER);
  });
});

describe('publishMappingSnapshot — validation execution order', () => {
  it('6-7. validator executes before RPC; invalid validation result prevents RPC', async () => {
    const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
    const db = makeDb({
      snapshotRows: [baseSnapshotRow({ version_label: null })], // fails SNAPSHOT_VERSION_LABEL_MISSING
      rpc: recordingRpc({ calls }),
    });

    await assert.rejects(
      () => publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER }),
      MappingPublicationValidationError,
    );
    assert.equal(calls.length, 0);
  });

  it('8. validation failure preserves structured issue result', async () => {
    const db = makeDb({ snapshotRows: [baseSnapshotRow({ change_reason: null })], rpc: NEVER_CALLED_RPC });

    try {
      await publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER });
      assert.fail('expected publishMappingSnapshot to throw');
    } catch (error) {
      assert.ok(error instanceof MappingPublicationValidationError);
      assert.ok(Array.isArray(error.issues));
      assert.ok(error.issues.some((issue) => issue.code === 'SNAPSHOT_CHANGE_REASON_MISSING'));
    }
  });

  it('9. caller cannot provide expected revision through public TypeScript API', async () => {
    const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
    const db = makeDb({ rpc: recordingRpc({ calls }) });

    // Even if a caller forges an extra property at the JS boundary, the
    // service never reads it — the pin always comes from the loaded row.
    const maliciousInput = {
      snapshotId: SNAPSHOT_ID,
      publisherActorId: PUBLISHER,
      expectedContentRevision: 999999,
    };
    await publishMappingSnapshot(db, maliciousInput as Parameters<typeof publishMappingSnapshot>[1]);

    assert.equal(calls[0]?.params.p_expected_content_revision, 5);
  });
});

describe('publishMappingSnapshot — PV1 revision pin', () => {
  it('10-11. service captures snapshot.contentRevision and passes exact value to RPC', async () => {
    const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
    const db = makeDb({ snapshotRows: [baseSnapshotRow({ content_revision: 42 })], rpc: recordingRpc({ calls }) });

    const result = await publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER });

    assert.equal(result.validatedContentRevision, 42);
    assert.equal(calls[0]?.fn, PUBLISH_MAPPING_SNAPSHOT_RPC);
    assert.equal(calls[0]?.params.p_expected_content_revision, 42);
  });

  it('12. revision 0 is passed as 0', async () => {
    const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
    const db = makeDb({ snapshotRows: [baseSnapshotRow({ content_revision: 0 })], rpc: recordingRpc({ calls }) });

    await publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER });

    assert.equal(calls[0]?.params.p_expected_content_revision, 0);
  });

  it('13. BIGINT-safe revision representation: safe integer passes, unsafe integer fails closed', async () => {
    const safeDb = makeDb({
      snapshotRows: [baseSnapshotRow({ content_revision: Number.MAX_SAFE_INTEGER })],
      rpc: successRpc(),
    });
    const safeResult = await publishMappingSnapshot(safeDb, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER });
    assert.equal(safeResult.validatedContentRevision, Number.MAX_SAFE_INTEGER);

    const unsafeDb = makeDb({
      snapshotRows: [baseSnapshotRow({ content_revision: Number.MAX_SAFE_INTEGER + 2 })],
      rpc: NEVER_CALLED_RPC,
    });
    await assert.rejects(
      () => publishMappingSnapshot(unsafeDb, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER }),
      (error: unknown) => error instanceof MappingDraftError && error.code === 'MAPPING_PUBLICATION_FAILED',
    );
  });
});

describe('publishMappingSnapshot — RPC error mapping', () => {
  it('14. stale revision RPC failure mapped', async () => {
    const db = makeDb({ rpc: failingRpc('DRAFT_CONTENT_CHANGED_AFTER_VALIDATION') });
    await assert.rejects(
      () => publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER }),
      (error: unknown) => error instanceof MappingDraftError && error.code === 'MAPPING_PUBLICATION_REVISION_STALE',
    );
  });

  it('15. same creator/publisher RPC failure mapped defensively', async () => {
    const db = makeDb({ rpc: failingRpc('SELF_APPROVAL_FORBIDDEN') });
    await assert.rejects(
      () => publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER }),
      (error: unknown) =>
        error instanceof MappingDraftError && error.code === 'MAPPING_PUBLISHER_MUST_DIFFER_FROM_CREATOR',
    );
  });

  it('16. inactive/deprecated vocabulary RPC failure mapped', async () => {
    const db = makeDb({ rpc: failingRpc('VOCABULARY_DEPRECATED') });
    await assert.rejects(
      () => publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER }),
      (error: unknown) =>
        error instanceof MappingDraftError && error.code === 'MAPPING_PUBLICATION_VOCABULARY_DEPRECATED',
    );
  });

  it('17. unexpected RPC failure mapped', async () => {
    const db = makeDb({ rpc: failingRpc('connection reset by peer') });
    await assert.rejects(
      () => publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER }),
      (error: unknown) => error instanceof MappingDraftError && error.code === 'MAPPING_PUBLICATION_FAILED',
    );
  });
});

describe('publishMappingSnapshot — happy path and lifecycle boundary', () => {
  it('18. valid mapping invokes RPC once', async () => {
    const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
    const db = makeDb({ rpc: recordingRpc({ calls }) });

    await publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER });

    assert.equal(calls.length, 1);
  });

  it('19. service never directly updates snapshot status (fake table client has no update/mutation path)', async () => {
    const snapshotRows = [baseSnapshotRow()];
    const db = makeDb({ snapshotRows, rpc: successRpc() });

    await publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER });

    // The fake publication table client exposes select() only (no update()).
    // If the service ever attempted a direct UPDATE it would throw a
    // TypeError before reaching this assertion. The underlying row is also
    // provably untouched by the service itself.
    assert.equal(snapshotRows[0].status, 'draft');
  });

  it('20. service returns actual grounded RPC result shape', async () => {
    const db = makeDb({ rpc: successRpc() });
    const result = await publishMappingSnapshot(db, { snapshotId: SNAPSHOT_ID, publisherActorId: PUBLISHER });

    assert.deepEqual(Object.keys(result).sort(), ['publishedBy', 'snapshotId', 'validatedContentRevision']);
    assert.equal(result.snapshotId, SNAPSHOT_ID);
    assert.equal(result.publishedBy, PUBLISHER);
    assert.equal(result.validatedContentRevision, 5);
  });
});
