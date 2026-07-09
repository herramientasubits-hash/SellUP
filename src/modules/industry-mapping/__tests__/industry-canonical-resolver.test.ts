// industry-canonical-resolver.test.ts — Pure Deterministic Industry
// Canonical Runtime Resolver coverage (Q3F-5AL). Synchronous, in-memory
// fixtures only — no Supabase, no network, no provider/AI call.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveIndustryCanonical } from '../industry-canonical-resolver';
import { IndustryCanonicalResolutionError } from '../industry-canonical-resolution-types';
import type {
  IndustryCanonicalResolutionCandidate,
  IndustryCanonicalResolutionInput,
  LoadedIndustryCatalog,
} from '../industry-canonical-resolution-types';
import type {
  CanonicalIndustryReference,
  IndustryProviderMappingSnapshot,
  MappingSnapshotAssociation,
  MappingSnapshotConceptEntry,
} from '../mapping-snapshot-load-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VOCAB_KEY = 'apollo/organizations';
const CATALOG_VERSION = '2026.1';

function ref(id: string, name: string, slug: string): CanonicalIndustryReference {
  return { id, name, slug, catalogVersion: CATALOG_VERSION };
}

function catalog(industries: CanonicalIndustryReference[]): LoadedIndustryCatalog {
  return {
    version: CATALOG_VERSION,
    industries: industries.map((i) => ({ id: i.id, name: i.name, slug: i.slug })),
  };
}

function association(target: CanonicalIndustryReference, semantics: MappingSnapshotAssociation['sourceRelation']): MappingSnapshotAssociation {
  return { canonicalTarget: target, sourceRelation: semantics };
}

function concept(rawLabel: string, associations: MappingSnapshotAssociation[] = [], conceptEntryId = `concept-${rawLabel}`): MappingSnapshotConceptEntry {
  return { conceptEntryId, rawLabel, associations };
}

function snapshot(conceptEntries: MappingSnapshotConceptEntry[] = []): IndustryProviderMappingSnapshot {
  return {
    mappingSnapshotId: 'snapshot-1',
    sourceVocabularyKey: VOCAB_KEY,
    catalogVersion: CATALOG_VERSION,
    status: 'published',
    createdBy: 'user-author',
    publishedBy: 'user-publisher',
    conceptEntries,
  };
}

function input(overrides: Partial<IndustryCanonicalResolutionInput> = {}): IndustryCanonicalResolutionInput {
  return {
    rawLabel: 'Banking',
    sourceContext: { sourceVocabularyKey: VOCAB_KEY },
    catalogVersion: CATALOG_VERSION,
    mappingSnapshot: snapshot(),
    ...overrides,
  };
}

const bankingRef = ref('industry-banking', 'Banking', 'banking');
const financeRef = ref('industry-finance', 'Financial Services', 'financial-services');
const insuranceRef = ref('industry-insurance', 'Insurance', 'insurance');

// ── Section 18: direct catalog precedence ────────────────────────────────────

test('exact name match resolves via catalog_exact_name', () => {
  const result = resolveIndustryCanonical(input({ rawLabel: 'Banking' }), catalog([bankingRef, financeRef]));
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates[0].resolutionMethod, 'catalog_exact_name');
  assert.equal(result.candidates[0].ref.id, bankingRef.id);
});

test('exact name wins over a slug opportunity', () => {
  const trickyRef = ref('industry-tricky', 'banking', 'other-slug');
  const slugLookAlike = ref('industry-slug-lookalike', 'Something Else', 'banking');
  const result = resolveIndustryCanonical(
    input({ rawLabel: 'banking' }),
    catalog([trickyRef, slugLookAlike]),
  );
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates[0].ref.id, trickyRef.id);
  assert.equal(result.candidates[0].resolutionMethod, 'catalog_exact_name');
});

test('slug match resolves via catalog_slug when no exact name exists', () => {
  const result = resolveIndustryCanonical(input({ rawLabel: 'banking' }), catalog([bankingRef]));
  const withoutExact = catalog([ref('industry-banking', 'Bank Sector', 'banking')]);
  const result2 = resolveIndustryCanonical(input({ rawLabel: 'banking' }), withoutExact);
  assert.equal(result2.status, 'RESOLVED');
  assert.equal(result2.candidates[0].resolutionMethod, 'catalog_slug');
  void result;
});

test('slug wins over a normalized-name opportunity', () => {
  const slugTarget = ref('industry-slug-target', 'Something Unrelated', 'ban king');
  // "Bán King!" normalizes to "ban king" but does not lowercase-exact-match it,
  // so it only surfaces at the normalized-name stage — never reached because
  // the slug stage already produced a definitive match.
  const normalizedLookAlike = ref('industry-normalized-lookalike', 'Bán King!', 'other-slug');
  const cat = catalog([slugTarget, normalizedLookAlike]);
  const result = resolveIndustryCanonical(input({ rawLabel: 'ban king' }), cat);
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates[0].ref.id, slugTarget.id);
  assert.equal(result.candidates[0].resolutionMethod, 'catalog_slug');
});

test('normalized-name match resolves via catalog_normalized_name (single match)', () => {
  const target = ref('industry-banking', 'Banca', 'banca');
  const cat = catalog([target]);
  const result = resolveIndustryCanonical(input({ rawLabel: 'BÁNCA!!' }), cat);
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates[0].resolutionMethod, 'catalog_normalized_name');
  assert.equal(result.candidates[0].ref.id, target.id);
});

test('normalized-name match with two distinct catalog targets is AMBIGUOUS with both refs', () => {
  const a = ref('industry-b', 'Bánca', 'banca-a');
  const b = ref('industry-a', 'Banca!!', 'banca-b');
  const cat = catalog([a, b]);
  const result = resolveIndustryCanonical(input({ rawLabel: 'banca' }), cat);
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((c) => c.ref.id), ['industry-a', 'industry-b']);
});

test('normalized-name multi-match candidate order is ref.id ASC regardless of catalog order', () => {
  const a = ref('industry-zzz', 'Banca Z', 'banca-z');
  const b = ref('industry-aaa', 'Banca A', 'banca-a');
  const cat1 = catalog([a, b]);
  const cat2 = catalog([b, a]);
  const inputWithSameNormalized = (label: string) =>
    input({ rawLabel: label });
  // force both to normalize identically by using the same normalized comparison target
  const sameNormA = ref('industry-zzz', 'Banca', 'banca-z2');
  const sameNormB = ref('industry-aaa', 'Banca', 'banca-a2');
  const result1 = resolveIndustryCanonical(inputWithSameNormalized('Banca'), catalog([sameNormA, sameNormB]));
  const result2 = resolveIndustryCanonical(inputWithSameNormalized('Banca'), catalog([sameNormB, sameNormA]));
  assert.deepEqual(result1, result2);
  assert.deepEqual(result1.candidates.map((c) => c.ref.id), ['industry-aaa', 'industry-zzz']);
  void cat1;
  void cat2;
});

test('no direct match produces no direct candidates (UNMAPPED without mapping)', () => {
  const result = resolveIndustryCanonical(input({ rawLabel: 'Nonexistent Sector' }), catalog([bankingRef]));
  assert.equal(result.status, 'UNMAPPED');
  assert.deepEqual(result.candidates, []);
});

// ── Section 19: provider mapping ─────────────────────────────────────────────

test('source concept absent produces no mapping candidate', () => {
  const result = resolveIndustryCanonical(
    input({ rawLabel: 'Nonexistent Sector', mappingSnapshot: snapshot([concept('banking', [association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL')])]) }),
    catalog([]),
  );
  assert.equal(result.status, 'UNMAPPED');
});

test('known concept with zero associations produces no mapping candidate', () => {
  const result = resolveIndustryCanonical(
    input({ rawLabel: 'Banking', mappingSnapshot: snapshot([concept('banking', [])]) }),
    catalog([]),
  );
  assert.equal(result.status, 'UNMAPPED');
});

test('one mapping association resolves via provider_mapping', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([concept('banking', [association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL')])]),
    }),
    catalog([]),
  );
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates[0].resolutionMethod, 'provider_mapping');
  assert.equal(result.candidates[0].ref.id, bankingRef.id);
});

test('mapping candidate preserves the exact sourceRelation', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([concept('banking', [association(bankingRef, 'SOURCE_BROADER_THAN_CANONICAL')])]),
    }),
    catalog([]),
  );
  assert.equal(result.status, 'RESOLVED');
  const candidate = result.candidates[0];
  assert.equal(candidate.resolutionMethod, 'provider_mapping');
  assert.deepEqual((candidate as { sourceRelation: { semantics: string } }).sourceRelation, {
    semantics: 'SOURCE_BROADER_THAN_CANONICAL',
  });
});

test('two distinct mapping targets are AMBIGUOUS', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([
        concept('banking', [
          association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL'),
          association(financeRef, 'SOURCE_BROADER_THAN_CANONICAL'),
        ]),
      ]),
    }),
    catalog([]),
  );
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.candidates.length, 2);
});

test('mapping ambiguous candidates sorted ref.id ASC regardless of association input order', () => {
  const resultForward = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([
        concept('banking', [
          association(financeRef, 'SOURCE_BROADER_THAN_CANONICAL'),
          association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL'),
        ]),
      ]),
    }),
    catalog([]),
  );
  const resultReversed = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([
        concept('banking', [
          association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL'),
          association(financeRef, 'SOURCE_BROADER_THAN_CANONICAL'),
        ]),
      ]),
    }),
    catalog([]),
  );
  assert.deepEqual(resultForward, resultReversed);
  assert.deepEqual(
    resultForward.candidates.map((c) => c.ref.id),
    [financeRef.id, bankingRef.id].sort(),
  );
});

test('concept lookup uses normalized equality', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'BÁNKING!!',
      mappingSnapshot: snapshot([concept('banking', [association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL')])]),
    }),
    catalog([]),
  );
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates[0].ref.id, bankingRef.id);
});

test('"A-B" incoming matches trusted concept rawLabel "A B" via normalization', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'A-B',
      mappingSnapshot: snapshot([concept('A B', [association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL')])]),
    }),
    catalog([]),
  );
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates[0].ref.id, bankingRef.id);
});

// ── Section 20: combination matrix C1–C10 ────────────────────────────────────

test('C1: DIRECT none, MAPPING concept absent -> UNMAPPED', () => {
  const result = resolveIndustryCanonical(input({ rawLabel: 'Unrelated' }), catalog([]));
  assert.equal(result.status, 'UNMAPPED');
});

test('C2: DIRECT none, MAPPING concept with 0 targets -> UNMAPPED', () => {
  const result = resolveIndustryCanonical(
    input({ rawLabel: 'Banking', mappingSnapshot: snapshot([concept('banking', [])]) }),
    catalog([]),
  );
  assert.equal(result.status, 'UNMAPPED');
});

test('C3: DIRECT none, MAPPING A -> RESOLVED A / provider_mapping', () => {
  const result = resolveIndustryCanonical(
    input({ rawLabel: 'Banking', mappingSnapshot: snapshot([concept('banking', [association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL')])]) }),
    catalog([]),
  );
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates[0].ref.id, bankingRef.id);
  assert.equal(result.candidates[0].resolutionMethod, 'provider_mapping');
});

test('C4: DIRECT none, MAPPING A+B -> AMBIGUOUS A+B', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([
        concept('banking', [
          association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL'),
          association(financeRef, 'SOURCE_BROADER_THAN_CANONICAL'),
        ]),
      ]),
    }),
    catalog([]),
  );
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.candidates.length, 2);
});

test('C5: DIRECT A, MAPPING concept absent -> RESOLVED A / catalog method', () => {
  const result = resolveIndustryCanonical(input({ rawLabel: 'Banking' }), catalog([bankingRef]));
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates[0].ref.id, bankingRef.id);
  assert.equal(result.candidates[0].resolutionMethod, 'catalog_exact_name');
});

test('C6: DIRECT A, MAPPING concept with 0 targets -> RESOLVED A / catalog method', () => {
  const result = resolveIndustryCanonical(
    input({ rawLabel: 'Banking', mappingSnapshot: snapshot([concept('banking', [])]) }),
    catalog([bankingRef]),
  );
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates[0].ref.id, bankingRef.id);
  assert.equal(result.candidates[0].resolutionMethod, 'catalog_exact_name');
});

test('C7: DIRECT A, MAPPING A -> RESOLVED A, exactly 1 candidate, provider_mapping metadata, sourceRelation preserved', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([concept('banking', [association(bankingRef, 'SOURCE_NARROWER_THAN_CANONICAL')])]),
    }),
    catalog([bankingRef]),
  );
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.ref.id, bankingRef.id);
  assert.equal(candidate.resolutionMethod, 'provider_mapping');
  assert.deepEqual((candidate as { sourceRelation: { semantics: string } }).sourceRelation, {
    semantics: 'SOURCE_NARROWER_THAN_CANONICAL',
  });
});

test('C8: DIRECT A, MAPPING B -> AMBIGUOUS A+B', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([concept('banking', [association(financeRef, 'SOURCE_EQUIVALENT_TO_CANONICAL')])]),
    }),
    catalog([bankingRef]),
  );
  assert.equal(result.status, 'AMBIGUOUS');
  assert.deepEqual(result.candidates.map((c) => c.ref.id), [bankingRef.id, financeRef.id].sort());
});

test('C9: DIRECT A, MAPPING A+B -> AMBIGUOUS A+B, A represented once with provider_mapping metadata', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([
        concept('banking', [
          association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL'),
          association(financeRef, 'SOURCE_BROADER_THAN_CANONICAL'),
        ]),
      ]),
    }),
    catalog([bankingRef]),
  );
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.candidates.length, 2);
  const aCandidate = result.candidates.find((c) => c.ref.id === bankingRef.id) as IndustryCanonicalResolutionCandidate;
  assert.equal(aCandidate.resolutionMethod, 'provider_mapping');
});

test('C10: DIRECT A, MAPPING B+C -> AMBIGUOUS A+B+C', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([
        concept('banking', [
          association(financeRef, 'SOURCE_EQUIVALENT_TO_CANONICAL'),
          association(insuranceRef, 'SOURCE_BROADER_THAN_CANONICAL'),
        ]),
      ]),
    }),
    catalog([bankingRef]),
  );
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(
    result.candidates.map((c) => c.ref.id),
    [bankingRef.id, financeRef.id, insuranceRef.id].sort(),
  );
});

// ── Section 21: scope guard tests ────────────────────────────────────────────

test('input catalogVersion vs snapshot catalogVersion mismatch throws typed error (mapping_snapshot)', () => {
  assert.throws(
    () =>
      resolveIndustryCanonical(
        input({ catalogVersion: '2026.2', mappingSnapshot: snapshot() }),
        catalog([bankingRef]),
      ),
    (error: unknown) => {
      assert.ok(error instanceof IndustryCanonicalResolutionError);
      assert.equal(error.code, 'INDUSTRY_RESOLUTION_CATALOG_VERSION_MISMATCH');
      assert.equal(error.context?.mismatchTarget, 'mapping_snapshot');
      return true;
    },
  );
});

test('input catalogVersion matches snapshot but differs from loaded catalog version -> typed error (loaded_catalog)', () => {
  const mismatchedCatalog: LoadedIndustryCatalog = { version: '2026.9', industries: [] };
  assert.throws(
    () => resolveIndustryCanonical(input({ catalogVersion: CATALOG_VERSION }), mismatchedCatalog),
    (error: unknown) => {
      assert.ok(error instanceof IndustryCanonicalResolutionError);
      assert.equal(error.code, 'INDUSTRY_RESOLUTION_CATALOG_VERSION_MISMATCH');
      assert.equal(error.context?.mismatchTarget, 'loaded_catalog');
      return true;
    },
  );
});

test('catalog versions match but sourceVocabularyKey differs -> typed source vocabulary mismatch error', () => {
  assert.throws(
    () =>
      resolveIndustryCanonical(
        input({ sourceContext: { sourceVocabularyKey: 'other/vocab' } }),
        catalog([bankingRef]),
      ),
    (error: unknown) => {
      assert.ok(error instanceof IndustryCanonicalResolutionError);
      assert.equal(error.code, 'INDUSTRY_RESOLUTION_SOURCE_VOCABULARY_MISMATCH');
      return true;
    },
  );
});

test('when all three mismatches exist, the snapshot-version guard fires first', () => {
  const mismatchedCatalog: LoadedIndustryCatalog = { version: '2026.9', industries: [] };
  assert.throws(
    () =>
      resolveIndustryCanonical(
        input({
          catalogVersion: '2026.2',
          sourceContext: { sourceVocabularyKey: 'other/vocab' },
          mappingSnapshot: snapshot(),
        }),
        mismatchedCatalog,
      ),
    (error: unknown) => {
      assert.ok(error instanceof IndustryCanonicalResolutionError);
      assert.equal(error.context?.mismatchTarget, 'mapping_snapshot');
      return true;
    },
  );
});

test('when catalog mismatch + vocabulary mismatch exist, loaded-catalog version guard fires first', () => {
  const mismatchedCatalog: LoadedIndustryCatalog = { version: '2026.9', industries: [] };
  assert.throws(
    () =>
      resolveIndustryCanonical(
        input({
          catalogVersion: CATALOG_VERSION,
          sourceContext: { sourceVocabularyKey: 'other/vocab' },
        }),
        mismatchedCatalog,
      ),
    (error: unknown) => {
      assert.ok(error instanceof IndustryCanonicalResolutionError);
      assert.equal(error.context?.mismatchTarget, 'loaded_catalog');
      return true;
    },
  );
});

// ── Section 22: empty normalized input ───────────────────────────────────────

test('rawLabel = whitespace only -> UNMAPPED, empty normalized label, no candidates, no error', () => {
  const result = resolveIndustryCanonical(input({ rawLabel: '   ' }), catalog([bankingRef]));
  assert.equal(result.status, 'UNMAPPED');
  assert.equal(result.resolvedNormalizedLabel, '');
  assert.deepEqual(result.candidates, []);
});

test('rawLabel reduces to empty after normalization (punctuation only) -> UNMAPPED', () => {
  const result = resolveIndustryCanonical(input({ rawLabel: '!!!---///' }), catalog([bankingRef]));
  assert.equal(result.status, 'UNMAPPED');
  assert.equal(result.resolvedNormalizedLabel, '');
  assert.deepEqual(result.candidates, []);
});

// ── Section 23: dedup / determinism ──────────────────────────────────────────

test('same target direct + mapping dedupes by ref.id, preserves provider_mapping metadata', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([concept('banking', [association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL')])]),
    }),
    catalog([bankingRef]),
  );
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].resolutionMethod, 'provider_mapping');
});

test('resolver result is independent of catalog industry input order', () => {
  const catA = catalog([bankingRef, financeRef]);
  const catB = catalog([financeRef, bankingRef]);
  const resultA = resolveIndustryCanonical(input({ rawLabel: 'Banking' }), catA);
  const resultB = resolveIndustryCanonical(input({ rawLabel: 'Banking' }), catB);
  assert.deepEqual(resultA, resultB);
});

test('resolver result is independent of mapping association input order', () => {
  const snapA = snapshot([
    concept('banking', [
      association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL'),
      association(financeRef, 'SOURCE_BROADER_THAN_CANONICAL'),
    ]),
  ]);
  const snapB = snapshot([
    concept('banking', [
      association(financeRef, 'SOURCE_BROADER_THAN_CANONICAL'),
      association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL'),
    ]),
  ]);
  const resultA = resolveIndustryCanonical(input({ rawLabel: 'Banking', mappingSnapshot: snapA }), catalog([]));
  const resultB = resolveIndustryCanonical(input({ rawLabel: 'Banking', mappingSnapshot: snapB }), catalog([]));
  assert.deepEqual(resultA, resultB);
});

test('repeat same input produces deepEqual result', () => {
  const theInput = input({ rawLabel: 'Banking' });
  const theCatalog = catalog([bankingRef]);
  const result1 = resolveIndustryCanonical(theInput, theCatalog);
  const result2 = resolveIndustryCanonical(theInput, theCatalog);
  assert.deepEqual(result1, result2);
});

test('input object is not mutated', () => {
  const theInput = input({ rawLabel: 'Banking' });
  const snapshotBefore = JSON.parse(JSON.stringify(theInput));
  resolveIndustryCanonical(theInput, catalog([bankingRef]));
  assert.deepEqual(theInput, snapshotBefore);
});

test('mapping snapshot is not mutated', () => {
  const theSnapshot = snapshot([concept('banking', [association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL')])]);
  const before = JSON.parse(JSON.stringify(theSnapshot));
  resolveIndustryCanonical(input({ rawLabel: 'Banking', mappingSnapshot: theSnapshot }), catalog([bankingRef]));
  assert.deepEqual(theSnapshot, before);
});

test('loaded catalog is not mutated', () => {
  const theCatalog = catalog([bankingRef, financeRef]);
  const before = JSON.parse(JSON.stringify(theCatalog));
  resolveIndustryCanonical(input({ rawLabel: 'Banking' }), theCatalog);
  assert.deepEqual(theCatalog, before);
});

// ── Section 24: result cardinality ───────────────────────────────────────────

test('0 final candidates -> UNMAPPED', () => {
  const result = resolveIndustryCanonical(input({ rawLabel: 'Nowhere' }), catalog([]));
  assert.equal(result.status, 'UNMAPPED');
});

test('1 final unique canonical id -> RESOLVED', () => {
  const result = resolveIndustryCanonical(input({ rawLabel: 'Banking' }), catalog([bankingRef]));
  assert.equal(result.status, 'RESOLVED');
});

test('2 final unique canonical ids -> AMBIGUOUS', () => {
  const a = ref('industry-b', 'Banca', 'banca-a');
  const b = ref('industry-a', 'Banca', 'banca-b');
  const result = resolveIndustryCanonical(input({ rawLabel: 'Banca' }), catalog([a, b]));
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.candidates.length, 2);
});

test('3+ final unique canonical ids -> AMBIGUOUS', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([
        concept('banking', [
          association(financeRef, 'SOURCE_EQUIVALENT_TO_CANONICAL'),
          association(insuranceRef, 'SOURCE_BROADER_THAN_CANONICAL'),
        ]),
      ]),
    }),
    catalog([bankingRef]),
  );
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.candidates.length, 3);
});

test('two raw candidate objects for the same canonical id do not cause AMBIGUOUS after dedup', () => {
  const result = resolveIndustryCanonical(
    input({
      rawLabel: 'Banking',
      mappingSnapshot: snapshot([concept('banking', [association(bankingRef, 'SOURCE_EQUIVALENT_TO_CANONICAL')])]),
    }),
    catalog([bankingRef]),
  );
  assert.equal(result.status, 'RESOLVED');
});

// ── Section 25: type contract static assertions (compile-time only) ─────────

test('provider_mapping candidate requires sourceRelation; catalog candidate does not expose it (type-level)', () => {
  const catalogCandidate: IndustryCanonicalResolutionCandidate = {
    ref: bankingRef,
    resolutionMethod: 'catalog_exact_name',
  };
  const mappingCandidate: IndustryCanonicalResolutionCandidate = {
    ref: bankingRef,
    resolutionMethod: 'provider_mapping',
    sourceRelation: { semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL' },
  };
  assert.equal(catalogCandidate.sourceRelation, undefined);
  assert.deepEqual(mappingCandidate.sourceRelation, { semantics: 'SOURCE_EQUIVALENT_TO_CANONICAL' });
});
