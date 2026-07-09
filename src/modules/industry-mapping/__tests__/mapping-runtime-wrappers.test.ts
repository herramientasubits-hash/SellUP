// Tests — mapping-runtime-wrappers.ts (Q3F-5AN.1)
// Offline: no Supabase, no network. Uses hand-written fake auth/DB clients —
// same DI convention as the domain services' own test suites.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMappingDraftForActor,
  updateMappingDraftMetadataForActor,
  addConceptEntryForActor,
  updateConceptEntryRawLabelForActor,
  removeConceptEntryForActor,
  addMappingAssociationForActor,
  updateMappingAssociationForActor,
  removeMappingAssociationForActor,
  publishMappingSnapshotForActor,
  loadPublishedIndustryMappingSnapshotForRuntime,
  loadHistoricalIndustryMappingSnapshotForRuntime,
} from '../mapping-runtime-wrappers';
import { MappingDraftError, SNAPSHOTS_TABLE, CONCEPT_ENTRIES_TABLE, ASSOCIATIONS_TABLE } from '../mapping-draft-types';
import { INDUSTRIES_TABLE } from '../mapping-publication-types';
import { SOURCE_VOCABULARIES_TABLE, CATALOG_VERSIONS_TABLE } from '../mapping-snapshot-load-types';
import { makeFakeMappingDraftDb, makeFakeTableState } from './fake-mapping-draft-db';
import { makeFakePublicationDb, makeFakePublicationTableState } from './fake-mapping-publication-db';
import { makeFakeActiveAuthClient } from './fake-industry-mapping-auth-client';

const RESOLVED_ACTOR = 'internal-actor-0000-0000-0000-000000000001';
const OTHER_ACTOR = 'internal-actor-0000-0000-0000-000000000002';
const ATTACKER_ACTOR = 'attacker-actor-0000-0000-0000-000000000099';
const AUTH_USER_ID = 'auth-user-0000-0000-0000-000000000001';

function authClientResolvingTo(internalUserId: string) {
  return makeFakeActiveAuthClient(AUTH_USER_ID, internalUserId);
}

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
    created_by: RESOLVED_ACTOR,
    published_at: null,
    published_by: null,
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

describe('createMappingDraftForActor', () => {
  it('RB5: injects the resolved internal user id as createdByActorId', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakeMappingDraftDb({ [SNAPSHOTS_TABLE]: makeFakeTableState([]) });

    const result = await createMappingDraftForActor(authClient, db, {
      sourceVocabularyKey: 'apollo/organizations',
      catalogVersionId: 'catalog-v1',
    });

    assert.equal(result.createdBy, RESOLVED_ACTOR);
  });

  it('RB11: a malformed input containing createdByActorId cannot override the create actor identity', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakeMappingDraftDb({ [SNAPSHOTS_TABLE]: makeFakeTableState([]) });

    const maliciousInput = {
      sourceVocabularyKey: 'apollo/organizations',
      catalogVersionId: 'catalog-v1',
      createdByActorId: ATTACKER_ACTOR,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await createMappingDraftForActor(authClient, db, maliciousInput);

    assert.equal(result.createdBy, RESOLVED_ACTOR);
    assert.notEqual(result.createdBy, ATTACKER_ACTOR);
  });
});

describe('updateMappingDraftMetadataForActor', () => {
  it('RB6: injects the resolved internal user id as actorId (owner succeeds)', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ created_by: RESOLVED_ACTOR })]),
    });

    const result = await updateMappingDraftMetadataForActor(authClient, db, {
      snapshotId: 'snap-0001',
      versionLabel: 'v2',
    });

    assert.equal(result.versionLabel, 'v2');
  });

  it('RB6b: a non-owner resolved actor is rejected by the domain ownership guard', async () => {
    const authClient = authClientResolvingTo(OTHER_ACTOR);
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ created_by: RESOLVED_ACTOR })]),
    });

    await assert.rejects(
      () => updateMappingDraftMetadataForActor(authClient, db, { snapshotId: 'snap-0001', versionLabel: 'v2' }),
      (error: unknown) => {
        // RB18: existing domain typed errors propagate unchanged.
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_DRAFT_AUTHOR_REQUIRED');
        return true;
      },
    );
  });

  it('RB10: a malformed input containing actorId cannot override the trusted actor identity', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ created_by: RESOLVED_ACTOR })]),
    });

    // If the wrapper mistakenly read `actorId` off the raw input instead of
    // the resolved actor, this would be rejected as a non-owner (ATTACKER_ACTOR
    // does not own the snapshot). Success proves the malicious field was
    // never read.
    const maliciousInput = {
      snapshotId: 'snap-0001',
      actorId: ATTACKER_ACTOR,
      versionLabel: 'v2',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await updateMappingDraftMetadataForActor(authClient, db, maliciousInput);
    assert.equal(result.versionLabel, 'v2');
  });

  it('does not turn an omitted field into null (hasOwnProperty semantics preserved through the wrapper)', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([
        baseSnapshotRow({ created_by: RESOLVED_ACTOR, version_label: 'v1' }),
      ]),
    });

    const result = await updateMappingDraftMetadataForActor(authClient, db, {
      snapshotId: 'snap-0001',
      changeReason: 'Only reason changed',
    });

    assert.equal(result.versionLabel, 'v1');
    assert.equal(result.changeReason, 'Only reason changed');
  });
});

describe('concept-entry wrappers (RB7)', () => {
  it('addConceptEntryForActor injects the resolved actor id', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ created_by: RESOLVED_ACTOR })]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([]),
    });

    const result = await addConceptEntryForActor(authClient, db, {
      snapshotId: 'snap-0001',
      rawLabel: 'Financial Services',
    });

    assert.equal(result.rawLabel, 'Financial Services');
  });

  it('addConceptEntryForActor rejects a non-owner resolved actor (proves actorId flows from session, not caller)', async () => {
    const authClient = authClientResolvingTo(OTHER_ACTOR);
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ created_by: RESOLVED_ACTOR })]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([]),
    });

    await assert.rejects(
      () => addConceptEntryForActor(authClient, db, { snapshotId: 'snap-0001', rawLabel: 'X' }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_DRAFT_AUTHOR_REQUIRED');
        return true;
      },
    );
  });

  it('updateConceptEntryRawLabelForActor injects the resolved actor id', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ created_by: RESOLVED_ACTOR })]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([
        { id: 'concept-1', snapshot_id: 'snap-0001', raw_label: 'Old', normalized_lookup_key: 'old', created_at: new Date(0).toISOString() },
      ]),
    });

    const result = await updateConceptEntryRawLabelForActor(authClient, db, {
      conceptEntryId: 'concept-1',
      newRawLabel: 'New Label',
    });

    assert.equal(result.rawLabel, 'New Label');
  });

  it('removeConceptEntryForActor succeeds for the resolved owner', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ created_by: RESOLVED_ACTOR })]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([
        { id: 'concept-1', snapshot_id: 'snap-0001', raw_label: 'Old', normalized_lookup_key: 'old', created_at: new Date(0).toISOString() },
      ]),
    });

    await assert.doesNotReject(() =>
      removeConceptEntryForActor(authClient, db, { conceptEntryId: 'concept-1' }),
    );
  });
});

describe('association wrappers (RB8)', () => {
  function dbWithOwnedDraftAndConcept() {
    return makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ created_by: RESOLVED_ACTOR })]),
      [CONCEPT_ENTRIES_TABLE]: makeFakeTableState([
        { id: 'concept-1', snapshot_id: 'snap-0001', raw_label: 'Finance', normalized_lookup_key: 'finance', created_at: new Date(0).toISOString() },
      ]),
      [ASSOCIATIONS_TABLE]: makeFakeTableState([]),
    });
  }

  it('addMappingAssociationForActor injects the resolved actor id', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = dbWithOwnedDraftAndConcept();

    const result = await addMappingAssociationForActor(authClient, db, {
      snapshotId: 'snap-0001',
      conceptEntryId: 'concept-1',
      industryId: 'industry-1',
      catalogVersionId: 'catalog-v1',
      relationSemantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
    });

    assert.equal(result.industryId, 'industry-1');
  });

  it('updateMappingAssociationForActor injects the resolved actor id and preserves omitted-field semantics', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ created_by: RESOLVED_ACTOR })]),
      [ASSOCIATIONS_TABLE]: makeFakeTableState([
        {
          id: 'assoc-1',
          concept_entry_id: 'concept-1',
          snapshot_id: 'snap-0001',
          industry_id: 'industry-1',
          catalog_version_id: 'catalog-v1',
          relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
          created_at: new Date(0).toISOString(),
        },
      ]),
    });

    const result = await updateMappingAssociationForActor(authClient, db, {
      associationId: 'assoc-1',
      relationSemantics: 'SOURCE_BROADER_THAN_CANONICAL',
    });

    assert.equal(result.relationSemantics, 'SOURCE_BROADER_THAN_CANONICAL');
    assert.equal(result.industryId, 'industry-1');
  });

  it('removeMappingAssociationForActor succeeds for the resolved owner', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakeMappingDraftDb({
      [SNAPSHOTS_TABLE]: makeFakeTableState([baseSnapshotRow({ created_by: RESOLVED_ACTOR })]),
      [ASSOCIATIONS_TABLE]: makeFakeTableState([
        {
          id: 'assoc-1',
          concept_entry_id: 'concept-1',
          snapshot_id: 'snap-0001',
          industry_id: 'industry-1',
          catalog_version_id: 'catalog-v1',
          relation_semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
          created_at: new Date(0).toISOString(),
        },
      ]),
    });

    await assert.doesNotReject(() =>
      removeMappingAssociationForActor(authClient, db, { associationId: 'assoc-1' }),
    );
  });
});

describe('publishMappingSnapshotForActor (RB9, RB12)', () => {
  function publicationTables(overrides: Record<string, Record<string, unknown>[]> = {}) {
    return {
      [SNAPSHOTS_TABLE]: makeFakePublicationTableState(
        overrides[SNAPSHOTS_TABLE] ?? [
          baseSnapshotRow({ created_by: OTHER_ACTOR, version_label: 'v1', change_reason: 'initial publication' }),
        ],
      ),
      [CONCEPT_ENTRIES_TABLE]: makeFakePublicationTableState(overrides[CONCEPT_ENTRIES_TABLE] ?? []),
      [ASSOCIATIONS_TABLE]: makeFakePublicationTableState(overrides[ASSOCIATIONS_TABLE] ?? []),
      [INDUSTRIES_TABLE]: makeFakePublicationTableState(overrides[INDUSTRIES_TABLE] ?? []),
    };
  }

  it('RB9: injects the resolved internal user id as publisherActorId', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakePublicationDb(publicationTables(), () => ({ data: null, error: null }));

    const result = await publishMappingSnapshotForActor(authClient, db, { snapshotId: 'snap-0001' });

    assert.equal(result.publishedBy, RESOLVED_ACTOR);
  });

  it('RB12: a malformed input containing publisherActorId cannot override the publisher identity', async () => {
    const authClient = authClientResolvingTo(RESOLVED_ACTOR);
    const db = makeFakePublicationDb(publicationTables(), () => ({ data: null, error: null }));

    const maliciousInput = {
      snapshotId: 'snap-0001',
      publisherActorId: ATTACKER_ACTOR,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await publishMappingSnapshotForActor(authClient, db, maliciousInput);

    assert.equal(result.publishedBy, RESOLVED_ACTOR);
    assert.notEqual(result.publishedBy, ATTACKER_ACTOR);
  });
});

describe('loaders do not resolve actor identity (RB17)', () => {
  const VOCAB_KEY = 'apollo/organizations';
  const CATALOG_VERSION_ID = 'catalog-version-1';
  const CATALOG_VERSION = '2026.1';

  function loaderTables() {
    return {
      [SOURCE_VOCABULARIES_TABLE]: makeFakePublicationTableState([
        { source_vocabulary_key: VOCAB_KEY, lifecycle: 'active' },
      ]),
      [CATALOG_VERSIONS_TABLE]: makeFakePublicationTableState([
        { id: CATALOG_VERSION_ID, version: CATALOG_VERSION },
      ]),
      [SNAPSHOTS_TABLE]: makeFakePublicationTableState([
        baseSnapshotRow({
          id: 'snapshot-1',
          catalog_version_id: CATALOG_VERSION_ID,
          status: 'published',
          version_label: 'v1',
          change_reason: 'initial',
        }),
      ]),
      [CONCEPT_ENTRIES_TABLE]: makeFakePublicationTableState([]),
      [ASSOCIATIONS_TABLE]: makeFakePublicationTableState([]),
      [INDUSTRIES_TABLE]: makeFakePublicationTableState([]),
    };
  }

  it('loadPublishedIndustryMappingSnapshotForRuntime takes only (db, input) — no authClient parameter exists', async () => {
    const db = makeFakePublicationDb(loaderTables(), () => ({ data: null, error: null }));

    // Signature proof: this call compiles and succeeds with a db-only
    // argument list — there is no auth/session parameter to supply, so this
    // wrapper structurally cannot resolve actor identity.
    const result = await loadPublishedIndustryMappingSnapshotForRuntime(db, {
      sourceVocabularyKey: VOCAB_KEY,
      catalogVersion: CATALOG_VERSION,
    });

    assert.equal(result.mappingSnapshotId, 'snapshot-1');
  });

  it('loadHistoricalIndustryMappingSnapshotForRuntime takes only (db, input) — no authClient parameter exists', async () => {
    const db = makeFakePublicationDb(loaderTables(), () => ({ data: null, error: null }));

    const result = await loadHistoricalIndustryMappingSnapshotForRuntime(db, {
      mappingSnapshotId: 'snapshot-1',
    });

    assert.equal(result.mappingSnapshotId, 'snapshot-1');
  });
});
