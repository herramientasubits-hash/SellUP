// Tests — mapping-draft-concept-service.ts (Q3F-5AI)
// Offline: no Supabase, no network. Uses the injectable fake DB client.
// Proves reuse of the existing normalizeClassificationValue() — the
// normalizer's own exhaustive suite lives in
// import-classification/__tests__/import-classification.test.ts and is not
// re-tested here.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeClassificationValue } from '@/modules/prospect-batches/import-classification/catalog-normalization';
import {
  addConceptEntry,
  updateConceptEntryRawLabel,
  removeConceptEntry,
} from '../mapping-draft-concept-service';
import {
  MappingDraftError,
  SNAPSHOTS_TABLE,
  CONCEPT_ENTRIES_TABLE,
  CONCEPT_ENTRY_NORMALIZED_KEY_UNIQUE_CONSTRAINT,
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
    raw_label: 'Technology, Information & Media',
    normalized_lookup_key: normalizeClassificationValue('Technology, Information & Media'),
    created_at: new Date(0).toISOString(),
    ...overrides,
  };
}

// ── Normalizer reuse (parity, not re-derivation) ────────────────────────────

describe('normalizeClassificationValue reuse', () => {
  it('matches the documented parity cases', () => {
    assert.equal(normalizeClassificationValue('A-B'), 'a b');
    assert.equal(normalizeClassificationValue('A B'), 'a b');
    assert.equal(
      normalizeClassificationValue('Technology, Information & Media'),
      'technology information media',
    );
  });
});

// ── addConceptEntry ──────────────────────────────────────────────────────────

describe('addConceptEntry', () => {
  it('computes normalized_lookup_key with the existing normalizeClassificationValue', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([]),
    });

    const result = await addConceptEntry(db, {
      snapshotId: 'snap-0001',
      actorId: ACTOR_A,
      rawLabel: 'Software & Cloud Services',
    });

    assert.equal(result.normalizedLookupKey, normalizeClassificationValue('Software & Cloud Services'));
    assert.equal(result.rawLabel, 'Software & Cloud Services');
  });

  it('rejects when the normalized key is empty', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([]),
    });

    await assert.rejects(
      () => addConceptEntry(db, { snapshotId: 'snap-0001', actorId: ACTOR_A, rawLabel: '!!!' }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_CONCEPT_NORMALIZED_KEY_EMPTY');
        return true;
      },
    );
  });

  it('maps a normalized-key DB collision to MAPPING_CONCEPT_NORMALIZED_KEY_COLLISION', async () => {
    const conceptEntries = makeFakeTableState([]);
    conceptEntries.insertError = () => ({
      code: '23505',
      message: `duplicate key value violates unique constraint "${CONCEPT_ENTRY_NORMALIZED_KEY_UNIQUE_CONSTRAINT}"`,
    });
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: conceptEntries,
    });

    await assert.rejects(
      () => addConceptEntry(db, { snapshotId: 'snap-0001', actorId: ACTOR_A, rawLabel: 'Fintech' }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_CONCEPT_NORMALIZED_KEY_COLLISION');
        return true;
      },
    );
  });

  it('requires DRAFT ownership before writing', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([]),
    });

    await assert.rejects(
      () => addConceptEntry(db, { snapshotId: 'snap-0001', actorId: ACTOR_B, rawLabel: 'Fintech' }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_DRAFT_AUTHOR_REQUIRED');
        return true;
      },
    );
  });
});

// ── updateConceptEntryRawLabel ──────────────────────────────────────────────

describe('updateConceptEntryRawLabel', () => {
  it('sends raw_label and normalized_lookup_key in one update payload', async () => {
    const conceptEntries = makeFakeTableState([conceptEntryRow()]);
    const capturedPatches: Record<string, unknown>[] = [];
    const originalUpdateError = conceptEntries.updateError;
    conceptEntries.updateError = (_id, patch) => {
      capturedPatches.push(patch);
      return originalUpdateError?.(_id, patch) ?? null;
    };
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: conceptEntries,
    });

    const result = await updateConceptEntryRawLabel(db, {
      conceptEntryId: 'concept-0001',
      actorId: ACTOR_A,
      newRawLabel: 'Cloud & DevOps',
    });

    assert.equal(capturedPatches.length, 1);
    assert.deepEqual(Object.keys(capturedPatches[0]).sort(), ['normalized_lookup_key', 'raw_label']);
    assert.equal(result.rawLabel, 'Cloud & DevOps');
    assert.equal(result.normalizedLookupKey, normalizeClassificationValue('Cloud & DevOps'));
  });

  it('rejects when the concept entry is missing', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([]),
    });

    await assert.rejects(
      () =>
        updateConceptEntryRawLabel(db, {
          conceptEntryId: 'does-not-exist',
          actorId: ACTOR_A,
          newRawLabel: 'Cloud & DevOps',
        }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_CONCEPT_ENTRY_NOT_FOUND');
        return true;
      },
    );
  });

  it('maps a normalized-key DB collision on update', async () => {
    const conceptEntries = makeFakeTableState([conceptEntryRow()]);
    conceptEntries.updateError = () => ({
      code: '23505',
      message: `duplicate key value violates unique constraint "${CONCEPT_ENTRY_NORMALIZED_KEY_UNIQUE_CONSTRAINT}"`,
    });
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: conceptEntries,
    });

    await assert.rejects(
      () =>
        updateConceptEntryRawLabel(db, {
          conceptEntryId: 'concept-0001',
          actorId: ACTOR_A,
          newRawLabel: 'Fintech',
        }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_CONCEPT_NORMALIZED_KEY_COLLISION');
        return true;
      },
    );
  });
});

// ── removeConceptEntry ───────────────────────────────────────────────────────

describe('removeConceptEntry', () => {
  it('removes an entry with no associations', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([conceptEntryRow()]),
    });

    await removeConceptEntry(db, { conceptEntryId: 'concept-0001', actorId: ACTOR_A });
  });

  it('maps a foreign_key_violation to MAPPING_CONCEPT_ENTRY_HAS_ASSOCIATIONS', async () => {
    const conceptEntries = makeFakeTableState([conceptEntryRow()]);
    conceptEntries.deleteError = () => ({
      code: '23503',
      message:
        'update or delete on table "provider_industry_concept_entries" violates foreign key constraint on table "provider_industry_mapping_associations"',
    });
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: conceptEntries,
    });

    await assert.rejects(
      () => removeConceptEntry(db, { conceptEntryId: 'concept-0001', actorId: ACTOR_A }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_CONCEPT_ENTRY_HAS_ASSOCIATIONS');
        return true;
      },
    );
  });

  it('requires DRAFT ownership before deleting', async () => {
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([draftSnapshotRow()]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([conceptEntryRow()]),
    });

    await assert.rejects(
      () => removeConceptEntry(db, { conceptEntryId: 'concept-0001', actorId: ACTOR_B }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_DRAFT_AUTHOR_REQUIRED');
        return true;
      },
    );
  });
});
