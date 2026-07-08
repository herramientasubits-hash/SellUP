// Tests — mapping-draft-association-service.ts (Q3F-5AI)
// Offline: no Supabase, no network. Uses the injectable fake DB client.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  addMappingAssociation,
  updateMappingAssociation,
  removeMappingAssociation,
} from '../mapping-draft-association-service';
import {
  MappingDraftError,
  SNAPSHOTS_TABLE,
  CONCEPT_ENTRIES_TABLE,
  ASSOCIATIONS_TABLE,
  ASSOCIATION_CONCEPT_INDUSTRY_UNIQUE_CONSTRAINT,
} from '../mapping-draft-types';
import { makeFakeMappingDraftDb, makeFakeTableState } from './fake-mapping-draft-db';

const ACTOR_A = 'actor-aaaa-0000-0000-0000-000000000001';
const ACTOR_B = 'actor-bbbb-0000-0000-0000-000000000002';

function draftSnapshotRow(overrides: Record<string, unknown> = {}) {
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

function conceptEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'concept-0001',
    snapshot_id: 'snap-0001',
    raw_label: 'Fintech',
    normalized_lookup_key: 'fintech',
    created_at: new Date(0).toISOString(),
    ...overrides,
  };
}

function associationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assoc-0001',
    concept_entry_id: 'concept-0001',
    snapshot_id: 'snap-0001',
    industry_id: 'industry-0001',
    catalog_version_id: 'catalog-v1',
    relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
    created_at: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeDb(rows: {
  snapshots?: Record<string, unknown>[];
  conceptEntries?: Record<string, unknown>[];
  associations?: Record<string, unknown>[];
}) {
  return makeFakeMappingDraftDb({
    [SNAPSHOTS_TABLE]: makeFakeTableState(rows.snapshots ?? [draftSnapshotRow()]),
    [CONCEPT_ENTRIES_TABLE]: makeFakeTableState(rows.conceptEntries ?? [conceptEntryRow()]),
    [ASSOCIATIONS_TABLE]: makeFakeTableState(rows.associations ?? []),
  });
}

// ── addMappingAssociation ────────────────────────────────────────────────────

describe('addMappingAssociation', () => {
  it('rejects an unknown relation semantics literal', async () => {
    const db = makeDb({});

    await assert.rejects(
      () =>
        addMappingAssociation(db, {
          snapshotId: 'snap-0001',
          conceptEntryId: 'concept-0001',
          actorId: ACTOR_A,
          industryId: 'industry-0001',
          catalogVersionId: 'catalog-v1',
          relationSemantics: 'SOURCE_SAME_AS_CANONICAL',
        }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_RELATION_SEMANTICS_INVALID');
        return true;
      },
    );
  });

  it('rejects a concept entry that belongs to another snapshot', async () => {
    const db = makeDb({
      snapshots: [draftSnapshotRow()],
      conceptEntries: [conceptEntryRow({ snapshot_id: 'other-snapshot' })],
    });

    await assert.rejects(
      () =>
        addMappingAssociation(db, {
          snapshotId: 'snap-0001',
          conceptEntryId: 'concept-0001',
          actorId: ACTOR_A,
          industryId: 'industry-0001',
          catalogVersionId: 'catalog-v1',
          relationSemantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
        }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_CONCEPT_ENTRY_SNAPSHOT_MISMATCH');
        return true;
      },
    );
  });

  it('allows 2 distinct industry targets for the same concept entry', async () => {
    const db = makeDb({});

    const first = await addMappingAssociation(db, {
      snapshotId: 'snap-0001',
      conceptEntryId: 'concept-0001',
      actorId: ACTOR_A,
      industryId: 'industry-0001',
      catalogVersionId: 'catalog-v1',
      relationSemantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
    });
    const second = await addMappingAssociation(db, {
      snapshotId: 'snap-0001',
      conceptEntryId: 'concept-0001',
      actorId: ACTOR_A,
      industryId: 'industry-0002',
      catalogVersionId: 'catalog-v1',
      relationSemantics: 'SOURCE_BROADER_THAN_CANONICAL',
    });

    assert.notEqual(first.industryId, second.industryId);
    assert.equal(first.conceptEntryId, second.conceptEntryId);
  });

  it('maps a duplicate association DB violation to MAPPING_ASSOCIATION_ALREADY_EXISTS', async () => {
    const associations = makeFakeTableState([]);
    associations.insertError = () => ({
      code: '23505',
      message: `duplicate key value violates unique constraint "${ASSOCIATION_CONCEPT_INDUSTRY_UNIQUE_CONSTRAINT}"`,
    });
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([conceptEntryRow()]),
      [ASSOCIATIONS_TABLE]: associations,
    });

    await assert.rejects(
      () =>
        addMappingAssociation(db, {
          snapshotId: 'snap-0001',
          conceptEntryId: 'concept-0001',
          actorId: ACTOR_A,
          industryId: 'industry-0001',
          catalogVersionId: 'catalog-v1',
          relationSemantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
        }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_ASSOCIATION_ALREADY_EXISTS');
        return true;
      },
    );
  });

  it('requires DRAFT ownership before writing', async () => {
    const db = makeDb({});

    await assert.rejects(
      () =>
        addMappingAssociation(db, {
          snapshotId: 'snap-0001',
          conceptEntryId: 'concept-0001',
          actorId: ACTOR_B,
          industryId: 'industry-0001',
          catalogVersionId: 'catalog-v1',
          relationSemantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
        }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_DRAFT_AUTHOR_REQUIRED');
        return true;
      },
    );
  });
});

// ── updateMappingAssociation ──────────────────────────────────────────────────

describe('updateMappingAssociation', () => {
  it('restricts mutable fields to industry_id/catalog_version_id/relation_semantics', async () => {
    const associations = makeFakeTableState([associationRow()]);
    const capturedPatches: Record<string, unknown>[] = [];
    const originalUpdateError = associations.updateError;
    associations.updateError = (_id, patch) => {
      capturedPatches.push(patch);
      return originalUpdateError?.(_id, patch) ?? null;
    };
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([conceptEntryRow()]),
      [ASSOCIATIONS_TABLE]: associations,
    });

    const maliciousInput = {
      associationId: 'assoc-0001',
      actorId: ACTOR_A,
      industryId: 'industry-0002',
      snapshotId: 'other-snapshot',
      conceptEntryId: 'other-concept',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await updateMappingAssociation(db, maliciousInput);

    assert.equal(capturedPatches.length, 1);
    assert.deepEqual(Object.keys(capturedPatches[0]), ['industry_id']);
    assert.equal(result.industryId, 'industry-0002');
    assert.equal(result.snapshotId, 'snap-0001');
    assert.equal(result.conceptEntryId, 'concept-0001');
  });

  it('rejects when the association is missing', async () => {
    const db = makeDb({ associations: [] });

    await assert.rejects(
      () => updateMappingAssociation(db, { associationId: 'nope', actorId: ACTOR_A, industryId: 'x' }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_ASSOCIATION_NOT_FOUND');
        return true;
      },
    );
  });

  it('requires DRAFT ownership before writing', async () => {
    const db = makeDb({ associations: [associationRow()] });

    await assert.rejects(
      () =>
        updateMappingAssociation(db, {
          associationId: 'assoc-0001',
          actorId: ACTOR_B,
          industryId: 'industry-0002',
        }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_DRAFT_AUTHOR_REQUIRED');
        return true;
      },
    );
  });
});

// ── removeMappingAssociation ───────────────────────────────────────────────────

describe('removeMappingAssociation', () => {
  it('removes an owned-draft association', async () => {
    const db = makeDb({ associations: [associationRow()] });

    await removeMappingAssociation(db, { associationId: 'assoc-0001', actorId: ACTOR_A });
  });

  it('requires DRAFT author ownership', async () => {
    const db = makeDb({ associations: [associationRow()] });

    await assert.rejects(
      () => removeMappingAssociation(db, { associationId: 'assoc-0001', actorId: ACTOR_B }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_DRAFT_AUTHOR_REQUIRED');
        return true;
      },
    );
  });

  it('rejects when the association is missing', async () => {
    const db = makeDb({ associations: [] });

    await assert.rejects(
      () => removeMappingAssociation(db, { associationId: 'nope', actorId: ACTOR_A }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_ASSOCIATION_NOT_FOUND');
        return true;
      },
    );
  });
});
