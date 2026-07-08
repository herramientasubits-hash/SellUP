// Tests — mapping-draft-guard.ts (Q3F-5AI)
// Verifies the shared DRAFT-author ownership guard (HA1) in isolation.
// Offline: no Supabase, no network. Uses the injectable fake DB client.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { requireOwnedDraft } from '../mapping-draft-guard';
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

describe('requireOwnedDraft', () => {
  it('allows the owning actor to mutate a DRAFT snapshot', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow()]),
    });

    const context = await requireOwnedDraft(db, { snapshotId: 'snap-0001', actorId: ACTOR_A });

    assert.equal(context.id, 'snap-0001');
    assert.equal(context.sourceVocabularyKey, 'apollo/organizations');
    assert.equal(context.catalogVersionId, 'catalog-v1');
  });

  it('rejects a non-owner actor', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow()]),
    });

    await assert.rejects(
      () => requireOwnedDraft(db, { snapshotId: 'snap-0001', actorId: ACTOR_B }),
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
      () => requireOwnedDraft(db, { snapshotId: 'snap-0001', actorId: ACTOR_A }),
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
      () => requireOwnedDraft(db, { snapshotId: 'snap-0001', actorId: ACTOR_A }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_SNAPSHOT_NOT_DRAFT');
        return true;
      },
    );
  });

  it('rejects a missing snapshot', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([]),
    });

    await assert.rejects(
      () => requireOwnedDraft(db, { snapshotId: 'does-not-exist', actorId: ACTOR_A }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_SNAPSHOT_NOT_FOUND');
        return true;
      },
    );
  });
});
