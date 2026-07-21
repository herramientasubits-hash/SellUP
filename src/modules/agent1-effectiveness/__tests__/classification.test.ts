// Q3F-5AY.2 — Record Origin Derivation Classifier pure tests (non-live).
//
// No DB, no fetch, no providers. Buckets pinned conceptually to the validated
// Q3F-5AY.1 findings, not queried.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveRecordOriginClassification,
  type ClassifiableCandidate,
  type ClassifiableBatch,
} from '../classification';

describe('deriveRecordOriginClassification — smoke (R1)', () => {
  it('1. source_primary=smoke_script → smoke_test / test_record when discarded', () => {
    const out = deriveRecordOriginClassification({ status: 'discarded', source_primary: 'smoke_script' });
    assert.equal(out.recordOrigin, 'smoke_test');
    assert.equal(out.rejectionReason, 'test_record');
    assert.equal(out.classificationSource, 'derived_source_primary');
    assert.equal(out.matchedRule, 'smoke_marker');
  });

  it('2. metadata.smoke_test=true → smoke_test', () => {
    const out = deriveRecordOriginClassification({ status: 'needs_review', metadata: { smoke_test: true } });
    assert.equal(out.recordOrigin, 'smoke_test');
    assert.equal(out.rejectionReason, null);
    assert.equal(out.classificationSource, 'derived_metadata');
  });

  it('3. review_notes "[SMOKE ... sintético]" → smoke_test (not synthetic) + fold warning', () => {
    const out = deriveRecordOriginClassification({
      status: 'discarded',
      review_notes: '[SMOKE] registro sintético generado por script',
    });
    assert.equal(out.recordOrigin, 'smoke_test');
    assert.equal(out.rejectionReason, 'test_record');
    assert.equal(out.classificationSource, 'derived_review_notes');
    assert.ok(out.warnings.includes('synthetic_folded_into_smoke_test'));
  });

  it('24. non-discarded smoke candidate → smoke_test but rejectionReason null', () => {
    const out = deriveRecordOriginClassification({ status: 'needs_review', source_primary: 'smoke_script' });
    assert.equal(out.recordOrigin, 'smoke_test');
    assert.equal(out.rejectionReason, null);
  });
});

describe('deriveRecordOriginClassification — QA (R2)', () => {
  it('4. metadata.qa_only=true → qa / test_record when discarded', () => {
    const out = deriveRecordOriginClassification({ status: 'discarded', metadata: { qa_only: true } });
    assert.equal(out.recordOrigin, 'qa');
    assert.equal(out.rejectionReason, 'test_record');
    assert.equal(out.classificationSource, 'derived_metadata');
    assert.equal(out.matchedRule, 'qa_marker');
  });

  it('5. review_notes "QA post-fix" → qa', () => {
    const out = deriveRecordOriginClassification({ status: 'needs_review', review_notes: 'QA post-fix revisión' });
    assert.equal(out.recordOrigin, 'qa');
    assert.equal(out.classificationSource, 'derived_review_notes');
  });

  it('22. metadata.do_not_convert=true → qa (novelty-checker QA/test grouping)', () => {
    const out = deriveRecordOriginClassification({ status: 'discarded', metadata: { do_not_convert: true } });
    assert.equal(out.recordOrigin, 'qa');
    assert.equal(out.rejectionReason, 'test_record');
  });
});

describe('deriveRecordOriginClassification — historical cleanup (R3)', () => {
  it('6. review_notes "limpieza histórica masiva" → historical_cleanup / cleanup_record', () => {
    const out = deriveRecordOriginClassification({
      status: 'discarded',
      review_notes: 'limpieza histórica masiva de datos viejos',
    });
    assert.equal(out.recordOrigin, 'historical_cleanup');
    assert.equal(out.rejectionReason, 'cleanup_record');
    assert.equal(out.matchedRule, 'historical_cleanup_note');
  });
});

describe('deriveRecordOriginClassification — import (R4)', () => {
  it('7. source_primary=external_import → import', () => {
    const out = deriveRecordOriginClassification({ status: 'needs_review', source_primary: 'external_import' });
    assert.equal(out.recordOrigin, 'import');
    assert.equal(out.rejectionReason, null);
    assert.equal(out.classificationSource, 'derived_source_primary');
  });

  it('8. batch.source=external_import → import (batch_origin_used)', () => {
    const out = deriveRecordOriginClassification({ status: 'discarded' }, { source: 'external_import' });
    assert.equal(out.recordOrigin, 'import');
    assert.equal(out.rejectionReason, 'unknown');
    assert.equal(out.classificationSource, 'derived_batch');
    assert.ok(out.warnings.includes('batch_origin_used'));
  });
});

describe('deriveRecordOriginClassification — duplicate (R5)', () => {
  it('9. status=duplicate → rejectionReason duplicate', () => {
    const out = deriveRecordOriginClassification({ status: 'duplicate' });
    assert.equal(out.rejectionReason, 'duplicate');
    assert.equal(out.matchedRule, 'duplicate_status');
    assert.equal(out.recordOrigin, 'production');
  });

  it('10. duplicate_status=exact_duplicate → rejectionReason duplicate', () => {
    const out = deriveRecordOriginClassification({ status: 'discarded', duplicate_status: 'exact_duplicate' });
    assert.equal(out.rejectionReason, 'duplicate');
    assert.equal(out.matchedRule, 'duplicate_status');
  });
});

describe('deriveRecordOriginClassification — outside ICP (R6)', () => {
  it('11. "fuera del segmento" note → outside_icp with low-confidence warning', () => {
    const out = deriveRecordOriginClassification({
      status: 'discarded',
      review_notes: 'La empresa está fuera del segmento objetivo',
    });
    assert.equal(out.rejectionReason, 'outside_icp');
    assert.equal(out.matchedRule, 'outside_icp_note');
    assert.ok(out.warnings.includes('commercial_reason_low_confidence'));
    assert.ok(out.classificationConfidence <= 50);
  });
});

describe('deriveRecordOriginClassification — production (R7)', () => {
  it('12. needs_review clean → production / null', () => {
    const out = deriveRecordOriginClassification({ status: 'needs_review' });
    assert.equal(out.recordOrigin, 'production');
    assert.equal(out.rejectionReason, null);
    assert.equal(out.matchedRule, 'production_status');
  });

  it('13. converted_to_account clean → production / null', () => {
    const out = deriveRecordOriginClassification({ status: 'converted_to_account' });
    assert.equal(out.recordOrigin, 'production');
    assert.equal(out.rejectionReason, null);
  });

  it('14. approved clean → production / null', () => {
    const out = deriveRecordOriginClassification({ status: 'approved' });
    assert.equal(out.recordOrigin, 'production');
    assert.equal(out.rejectionReason, null);
  });
});

describe('deriveRecordOriginClassification — unknown discarded (R8) & fallback (R9)', () => {
  it('15. discarded with no note/marker → unknown / unknown', () => {
    const out = deriveRecordOriginClassification({ status: 'discarded' });
    assert.equal(out.recordOrigin, 'unknown');
    assert.equal(out.rejectionReason, 'unknown');
    assert.equal(out.matchedRule, 'discarded_unknown');
    assert.ok(out.warnings.includes('unknown_discarded_reason'));
  });

  it('16. discarded with ambiguous free-text note → unknown / unknown + ambiguous warning', () => {
    const out = deriveRecordOriginClassification({
      status: 'discarded',
      review_notes: 'no aplica por ahora, revisar luego',
    });
    assert.equal(out.recordOrigin, 'unknown');
    assert.equal(out.rejectionReason, 'unknown');
    assert.ok(out.warnings.includes('ambiguous_review_note'));
  });

  it('R9. empty/unknown status → fallback unknown / null', () => {
    const out = deriveRecordOriginClassification({ status: null });
    assert.equal(out.recordOrigin, 'unknown');
    assert.equal(out.rejectionReason, null);
    assert.equal(out.matchedRule, 'fallback_unknown');
  });
});

describe('deriveRecordOriginClassification — batch fallback (R1/R2 via batch)', () => {
  it('17. batch smoke marker triggers smoke_test when candidate lacks marker', () => {
    const candidate: ClassifiableCandidate = { status: 'needs_review' };
    const batch: ClassifiableBatch = { name: 'SMOKE run 2026-07' };
    const out = deriveRecordOriginClassification(candidate, batch);
    assert.equal(out.recordOrigin, 'smoke_test');
    assert.equal(out.classificationSource, 'derived_batch');
    assert.ok(out.warnings.includes('batch_origin_used'));
  });

  it('18. batch QA marker triggers qa when candidate lacks marker', () => {
    const out = deriveRecordOriginClassification({ status: 'needs_review' }, { metadata: { qa_only: true } });
    assert.equal(out.recordOrigin, 'qa');
    assert.equal(out.classificationSource, 'derived_batch');
    assert.ok(out.warnings.includes('batch_origin_used'));
  });
});

describe('deriveRecordOriginClassification — priority & purity', () => {
  it('23. first-match priority: smoke beats QA when both present', () => {
    const out = deriveRecordOriginClassification({
      status: 'discarded',
      metadata: { smoke_test: true, qa_only: true },
      review_notes: 'QA smoke combo',
    });
    assert.equal(out.recordOrigin, 'smoke_test');
    assert.equal(out.matchedRule, 'smoke_marker');
  });

  it('23b. QA beats cleanup when both markers present', () => {
    const out = deriveRecordOriginClassification({
      status: 'discarded',
      metadata: { qa_only: true },
      review_notes: 'limpieza histórica pero es QA',
    });
    assert.equal(out.recordOrigin, 'qa');
    assert.equal(out.matchedRule, 'qa_marker');
  });

  it('19. does not mutate candidate or batch inputs', () => {
    const candidate: ClassifiableCandidate = {
      status: 'discarded',
      metadata: { smoke_test: true },
      review_notes: '[SMOKE]',
    };
    const batch: ClassifiableBatch = { source: 'external_import', metadata: { qa_only: true } };
    const candidateSnapshot = JSON.stringify(candidate);
    const batchSnapshot = JSON.stringify(batch);
    deriveRecordOriginClassification(candidate, batch);
    assert.equal(JSON.stringify(candidate), candidateSnapshot);
    assert.equal(JSON.stringify(batch), batchSnapshot);
  });

  it('20. null/undefined metadata and review_notes handled safely', () => {
    const out = deriveRecordOriginClassification({
      status: 'needs_review',
      metadata: null,
      review_notes: null,
      duplicate_status: null,
      source_primary: null,
    });
    assert.equal(out.recordOrigin, 'production');
    // Also tolerate a completely empty object and a non-object metadata.
    assert.doesNotThrow(() => deriveRecordOriginClassification({}));
    assert.doesNotThrow(() =>
      deriveRecordOriginClassification({ status: 'discarded', metadata: undefined }, undefined),
    );
  });

  it('21. case-insensitive Spanish pattern matching', () => {
    const upper = deriveRecordOriginClassification({
      status: 'discarded',
      review_notes: 'LIMPIEZA HISTÓRICA total',
    });
    assert.equal(upper.recordOrigin, 'historical_cleanup');
    const mixed = deriveRecordOriginClassification({
      status: 'discarded',
      review_notes: 'Fuera De Segmento comercial',
    });
    assert.equal(mixed.rejectionReason, 'outside_icp');
  });
});
