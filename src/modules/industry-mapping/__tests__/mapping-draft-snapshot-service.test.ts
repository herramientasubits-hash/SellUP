// Tests — mapping-draft-snapshot-service.ts (Q3F-5AI)
// Offline: no Supabase, no network. Uses the injectable fake DB client.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createMappingDraft, updateMappingDraftMetadata } from '../mapping-draft-snapshot-service';
import { MappingDraftError, SNAPSHOTS_TABLE } from '../mapping-draft-types';
import { makeFakeMappingDraftDb, makeFakeTableState } from './fake-mapping-draft-db';

const ACTOR_A = 'actor-aaaa-0000-0000-0000-000000000001';
const ACTOR_B = 'actor-bbbb-0000-0000-0000-000000000002';

function baseSnapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'snap-0001',
    source_vocabulary_key: 'apollo/organizations',
    catalog_version_id: 'catalog-v1',
    status: 'draft',
    version_label: null,
    change_reason: null,
    content_revision: 0,
    created_at: new Date(0).toISOString(),
    created_by: ACTOR_A,
    published_at: null,
    published_by: null,
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

describe('createMappingDraft', () => {
  it('always sends status=draft', async () => {
    const db = makeFakeMappingDraftDb({ [SNAPSHOTS_TABLE]: makeFakeTableState([]) });

    const result = await createMappingDraft(db, {
      sourceVocabularyKey: 'apollo/organizations',
      catalogVersionId: 'catalog-v1',
      createdByActorId: ACTOR_A,
    });

    assert.equal(result.status, 'draft');
  });

  it('always sends content_revision=0', async () => {
    const db = makeFakeMappingDraftDb({ [SNAPSHOTS_TABLE]: makeFakeTableState([]) });

    const result = await createMappingDraft(db, {
      sourceVocabularyKey: 'apollo/organizations',
      catalogVersionId: 'catalog-v1',
      createdByActorId: ACTOR_A,
    });

    assert.equal(result.contentRevision, 0);
  });

  it('cannot accept publication/archive fields through the public TypeScript API', async () => {
    const snapshots = makeFakeTableState([]);
    const capturedPayloads: Record<string, unknown>[] = [];
    snapshots.insertError = (row) => {
      capturedPayloads.push(row);
      return null;
    };
    const db = makeFakeMappingDraftDb({ [SNAPSHOTS_TABLE]: snapshots });

    // CreateMappingDraftInput has no status/publishedAt/publishedBy/archivedAt/
    // archivedBy/contentRevision fields — this is enforced at compile time.
    // At runtime, even a caller that bypasses the type system (`as any`) with
    // those extra keys must not have them reach the DB write, because the
    // function only ever reads sourceVocabularyKey/catalogVersionId/
    // createdByActorId/versionLabel/changeReason off the input.
    const maliciousInput = {
      sourceVocabularyKey: 'apollo/organizations',
      catalogVersionId: 'catalog-v1',
      createdByActorId: ACTOR_A,
      status: 'published',
      contentRevision: 99,
      publishedAt: '2026-01-01T00:00:00.000Z',
      publishedBy: ACTOR_B,
      archivedAt: '2026-01-01T00:00:00.000Z',
      archivedBy: ACTOR_B,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await createMappingDraft(db, maliciousInput);

    assert.equal(capturedPayloads.length, 1);
    const sentPayload = capturedPayloads[0];
    assert.equal(sentPayload.status, 'draft');
    assert.equal(sentPayload.content_revision, 0);
    assert.equal('published_at' in sentPayload, false);
    assert.equal('published_by' in sentPayload, false);
    assert.equal('archived_at' in sentPayload, false);
    assert.equal('archived_by' in sentPayload, false);
    assert.equal(result.status, 'draft');
    assert.equal(result.contentRevision, 0);
  });

  it('rejects an empty sourceVocabularyKey', async () => {
    const db = makeFakeMappingDraftDb({ [SNAPSHOTS_TABLE]: makeFakeTableState([]) });

    await assert.rejects(() =>
      createMappingDraft(db, {
        sourceVocabularyKey: '   ',
        catalogVersionId: 'catalog-v1',
        createdByActorId: ACTOR_A,
      }),
    );
  });
});

describe('updateMappingDraftMetadata', () => {
  it('allows the owning actor to update version_label/change_reason', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow()]),
    });

    const result = await updateMappingDraftMetadata(db, {
      snapshotId: 'snap-0001',
      actorId: ACTOR_A,
      versionLabel: 'v2',
      changeReason: 'Quarterly refresh',
    });

    assert.equal(result.versionLabel, 'v2');
    assert.equal(result.changeReason, 'Quarterly refresh');
  });

  it('rejects a non-owner actor', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow()]),
    });

    await assert.rejects(
      () =>
        updateMappingDraftMetadata(db, {
          snapshotId: 'snap-0001',
          actorId: ACTOR_B,
          versionLabel: 'v2',
        }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_DRAFT_AUTHOR_REQUIRED');
        return true;
      },
    );
  });

  it('rejects a published snapshot', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ status: 'published' })]),
    });

    await assert.rejects(
      () => updateMappingDraftMetadata(db, { snapshotId: 'snap-0001', actorId: ACTOR_A, versionLabel: 'v2' }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_SNAPSHOT_NOT_DRAFT');
        return true;
      },
    );
  });

  it('rejects an archived snapshot', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ status: 'archived' })]),
    });

    await assert.rejects(
      () => updateMappingDraftMetadata(db, { snapshotId: 'snap-0001', actorId: ACTOR_A, versionLabel: 'v2' }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_SNAPSHOT_NOT_DRAFT');
        return true;
      },
    );
  });

  it('rejects a missing snapshot', async () => {
    const db = makeFakeMappingDraftDb({ [SNAPSHOTS_TABLE]: makeFakeTableState([]) });

    await assert.rejects(
      () => updateMappingDraftMetadata(db, { snapshotId: 'nope', actorId: ACTOR_A, versionLabel: 'v2' }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_SNAPSHOT_NOT_FOUND');
        return true;
      },
    );
  });

  it('does not turn an omitted field into null', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ version_label: 'v1' })]),
    });

    const result = await updateMappingDraftMetadata(db, {
      snapshotId: 'snap-0001',
      actorId: ACTOR_A,
      changeReason: 'Only reason changed',
    });

    assert.equal(result.versionLabel, 'v1');
    assert.equal(result.changeReason, 'Only reason changed');
  });
});
