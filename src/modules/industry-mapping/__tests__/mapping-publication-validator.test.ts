// Tests — mapping-publication-validator.ts (Q3F-5AJ)
// Offline: pure function, no Supabase, no network, no DB.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateProviderIndustryMappingForPublication,
  type MappingPublicationValidatorInput,
  type PublicationValidatorAssociationInput,
  type PublicationValidatorCanonicalIndustryInput,
  type PublicationValidatorConceptEntryInput,
  type PublicationValidatorSnapshotInput,
} from '../mapping-publication-validator';

const SNAPSHOT_ID = 'snap-0001';
const CATALOG_VERSION_ID = 'catalog-v1';
const CREATED_BY = 'actor-aaaa';

function baseSnapshot(overrides: Partial<PublicationValidatorSnapshotInput> = {}): PublicationValidatorSnapshotInput {
  return {
    id: SNAPSHOT_ID,
    sourceVocabularyKey: 'apollo/organizations',
    catalogVersionId: CATALOG_VERSION_ID,
    status: 'draft',
    contentRevision: 3,
    createdBy: CREATED_BY,
    versionLabel: 'v1',
    changeReason: 'initial mapping',
    ...overrides,
  };
}

function baseInput(overrides: Partial<MappingPublicationValidatorInput> = {}): MappingPublicationValidatorInput {
  return {
    snapshot: baseSnapshot(),
    conceptEntries: [],
    associations: [],
    canonicalIndustries: [],
    ...overrides,
  };
}

function concept(overrides: Partial<PublicationValidatorConceptEntryInput>): PublicationValidatorConceptEntryInput {
  return {
    id: 'concept-1',
    snapshotId: SNAPSHOT_ID,
    rawLabel: 'Software',
    normalizedLookupKey: 'software',
    ...overrides,
  };
}

function association(overrides: Partial<PublicationValidatorAssociationInput>): PublicationValidatorAssociationInput {
  return {
    id: 'assoc-1',
    snapshotId: SNAPSHOT_ID,
    conceptEntryId: 'concept-1',
    industryId: 'industry-1',
    catalogVersionId: CATALOG_VERSION_ID,
    relationSemantics: 'SOURCE_EQUIVALENT_TO_CANONICAL',
    ...overrides,
  };
}

function industry(overrides: Partial<PublicationValidatorCanonicalIndustryInput>): PublicationValidatorCanonicalIndustryInput {
  return { id: 'industry-1', catalogVersionId: CATALOG_VERSION_ID, ...overrides };
}

describe('validateProviderIndustryMappingForPublication — empty / 0-1-N cardinality', () => {
  it('1. empty draft snapshot is valid when publication metadata satisfies contract', () => {
    const result = validateProviderIndustryMappingForPublication(baseInput());
    assert.equal(result.valid, true);
    assert.deepEqual(result.issues, []);
  });

  it('2. concept with zero associations is valid', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({ conceptEntries: [concept({})] }),
    );
    assert.equal(result.valid, true);
  });

  it('3. one association is valid', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({})],
        associations: [association({})],
        canonicalIndustries: [industry({})],
      }),
    );
    assert.equal(result.valid, true);
  });

  it('4. two distinct target associations for one concept are valid (AMBIGUOUS)', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({})],
        associations: [
          association({ id: 'assoc-1', industryId: 'industry-1' }),
          association({ id: 'assoc-2', industryId: 'industry-2' }),
        ],
        canonicalIndustries: [industry({ id: 'industry-1' }), industry({ id: 'industry-2' })],
      }),
    );
    assert.equal(result.valid, true);
  });
});

describe('validateProviderIndustryMappingForPublication — snapshot rules', () => {
  it('5. snapshot not draft issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({ snapshot: baseSnapshot({ status: 'published' }) }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'SNAPSHOT_NOT_DRAFT'));
  });

  it('6. missing required publication metadata issue (null and blank)', () => {
    const nullResult = validateProviderIndustryMappingForPublication(
      baseInput({ snapshot: baseSnapshot({ versionLabel: null, changeReason: null }) }),
    );
    assert.equal(nullResult.valid, false);
    assert.ok(nullResult.issues.some((i) => i.code === 'SNAPSHOT_VERSION_LABEL_MISSING'));
    assert.ok(nullResult.issues.some((i) => i.code === 'SNAPSHOT_CHANGE_REASON_MISSING'));

    const blankResult = validateProviderIndustryMappingForPublication(
      baseInput({ snapshot: baseSnapshot({ versionLabel: '   ', changeReason: '' }) }),
    );
    assert.equal(blankResult.valid, false);
    assert.ok(blankResult.issues.some((i) => i.code === 'SNAPSHOT_VERSION_LABEL_MISSING'));
    assert.ok(blankResult.issues.some((i) => i.code === 'SNAPSHOT_CHANGE_REASON_MISSING'));
  });
});

describe('validateProviderIndustryMappingForPublication — concept rules', () => {
  it('7. concept snapshot mismatch issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({ conceptEntries: [concept({ snapshotId: 'other-snapshot' })] }),
    );
    assert.equal(result.valid, false);
    const issue = result.issues.find((i) => i.code === 'CONCEPT_SNAPSHOT_MISMATCH');
    assert.ok(issue);
    assert.deepEqual(issue?.conceptEntryIds, ['concept-1']);
  });

  it('8. normalized key recomputed with existing normalizer ("A-B" and "A B" → "a b")', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({ id: 'concept-1', rawLabel: 'A-B', normalizedLookupKey: 'a b' })],
      }),
    );
    assert.equal(result.valid, true);
  });

  it('9. stored normalized key mismatch issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({ rawLabel: 'Software', normalizedLookupKey: 'wrong-key' })],
      }),
    );
    assert.equal(result.valid, false);
    const issue = result.issues.find((i) => i.code === 'CONCEPT_NORMALIZED_KEY_MISMATCH');
    assert.ok(issue);
    assert.equal(issue?.normalizedKey, 'software');
  });

  it('10. empty recomputed normalized key issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({ rawLabel: '!!!', normalizedLookupKey: '' })],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'CONCEPT_NORMALIZED_KEY_EMPTY'));
  });

  it('11. two raw labels normalizing to same key produce collision ("A-B" and "A B")', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [
          concept({ id: 'concept-x', rawLabel: 'A-B', normalizedLookupKey: 'a b' }),
          concept({ id: 'concept-y', rawLabel: 'A B', normalizedLookupKey: 'a b' }),
        ],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'CONCEPT_NORMALIZED_KEY_COLLISION'));
  });

  it('12. collision groups concept IDs lexically', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [
          concept({ id: 'concept-z', rawLabel: 'A-B', normalizedLookupKey: 'a b' }),
          concept({ id: 'concept-a', rawLabel: 'A B', normalizedLookupKey: 'a b' }),
        ],
      }),
    );
    const issue = result.issues.find((i) => i.code === 'CONCEPT_NORMALIZED_KEY_COLLISION');
    assert.deepEqual(issue?.conceptEntryIds, ['concept-a', 'concept-z']);
  });
});

describe('validateProviderIndustryMappingForPublication — association rules', () => {
  it('13. association snapshot mismatch issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({})],
        associations: [association({ snapshotId: 'other-snapshot' })],
        canonicalIndustries: [industry({})],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'ASSOCIATION_SNAPSHOT_MISMATCH'));
  });

  it('14. association concept missing issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        associations: [association({ conceptEntryId: 'ghost-concept' })],
        canonicalIndustries: [industry({})],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'ASSOCIATION_CONCEPT_NOT_FOUND'));
  });

  it('15. association concept/snapshot mismatch issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({ id: 'concept-1', snapshotId: SNAPSHOT_ID })],
        associations: [association({ conceptEntryId: 'concept-1', snapshotId: 'other-snapshot' })],
        canonicalIndustries: [industry({})],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'ASSOCIATION_CONCEPT_SNAPSHOT_MISMATCH'));
  });

  it('16. invalid relation semantics issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({})],
        associations: [association({ relationSemantics: 'source_equivalent_to_canonical' })],
        canonicalIndustries: [industry({})],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'ASSOCIATION_RELATION_SEMANTICS_INVALID'));
  });

  it('17. association catalog version mismatch issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({})],
        associations: [association({ catalogVersionId: 'other-catalog-version' })],
        canonicalIndustries: [industry({})],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'ASSOCIATION_CATALOG_VERSION_MISMATCH'));
  });

  it('18. industry target missing issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({})],
        associations: [association({ industryId: 'ghost-industry' })],
        canonicalIndustries: [],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'ASSOCIATION_INDUSTRY_NOT_FOUND'));
  });

  it('19. industry belongs to wrong catalog version issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({})],
        associations: [association({})],
        canonicalIndustries: [industry({ catalogVersionId: 'other-catalog-version' })],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'ASSOCIATION_INDUSTRY_CATALOG_VERSION_MISMATCH'));
  });

  it('20. duplicate same concept+industry target issue', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        conceptEntries: [concept({})],
        associations: [
          association({ id: 'assoc-1' }),
          association({ id: 'assoc-2' }),
        ],
        canonicalIndustries: [industry({})],
      }),
    );
    assert.equal(result.valid, false);
    const issue = result.issues.find((i) => i.code === 'ASSOCIATION_DUPLICATE_TARGET');
    assert.ok(issue);
    assert.deepEqual(issue?.associationIds, ['assoc-1', 'assoc-2']);
  });
});

describe('validateProviderIndustryMappingForPublication — multi-error and determinism', () => {
  it('21. multiple simultaneous validation errors are all returned', () => {
    const result = validateProviderIndustryMappingForPublication(
      baseInput({
        snapshot: baseSnapshot({ versionLabel: null }),
        conceptEntries: [concept({ snapshotId: 'other-snapshot' })],
        associations: [association({ relationSemantics: 'bogus' })],
        canonicalIndustries: [],
      }),
    );
    assert.equal(result.valid, false);
    const codes = new Set(result.issues.map((i) => i.code));
    assert.ok(codes.has('SNAPSHOT_VERSION_LABEL_MISSING'));
    assert.ok(codes.has('CONCEPT_SNAPSHOT_MISMATCH'));
    assert.ok(codes.has('ASSOCIATION_RELATION_SEMANTICS_INVALID'));
    assert.ok(codes.has('ASSOCIATION_INDUSTRY_NOT_FOUND'));
  });

  it('22. issue ordering is deterministic regardless of concept input order', () => {
    const conceptA = concept({ id: 'concept-a', snapshotId: 'other-snapshot' });
    const conceptB = concept({ id: 'concept-b', snapshotId: 'other-snapshot' });

    const forward = validateProviderIndustryMappingForPublication(
      baseInput({ conceptEntries: [conceptA, conceptB] }),
    );
    const reversed = validateProviderIndustryMappingForPublication(
      baseInput({ conceptEntries: [conceptB, conceptA] }),
    );
    assert.deepEqual(forward.issues, reversed.issues);
  });

  it('23. issue ordering is deterministic regardless of association input order', () => {
    const concepts = [concept({ id: 'concept-1' })];
    const industries = [industry({})];
    const assocA = association({ id: 'assoc-a', conceptEntryId: 'ghost' });
    const assocB = association({ id: 'assoc-b', conceptEntryId: 'ghost' });

    const forward = validateProviderIndustryMappingForPublication(
      baseInput({ conceptEntries: concepts, associations: [assocA, assocB], canonicalIndustries: industries }),
    );
    const reversed = validateProviderIndustryMappingForPublication(
      baseInput({ conceptEntries: concepts, associations: [assocB, assocA], canonicalIndustries: industries }),
    );
    assert.deepEqual(forward.issues, reversed.issues);
  });

  it('24. validator input is not mutated', () => {
    const input = baseInput({
      conceptEntries: [concept({})],
      associations: [association({})],
      canonicalIndustries: [industry({})],
    });
    const snapshotBefore = JSON.parse(JSON.stringify(input));

    validateProviderIndustryMappingForPublication(input);

    assert.deepEqual(input, snapshotBefore);
  });

  it('25. same input produces deep-equal result', () => {
    const input = baseInput({
      conceptEntries: [concept({ rawLabel: 'Bad Key', normalizedLookupKey: 'wrong' })],
      associations: [association({})],
      canonicalIndustries: [industry({})],
    });

    const first = validateProviderIndustryMappingForPublication(input);
    const second = validateProviderIndustryMappingForPublication(input);
    assert.deepEqual(first, second);
  });
});
