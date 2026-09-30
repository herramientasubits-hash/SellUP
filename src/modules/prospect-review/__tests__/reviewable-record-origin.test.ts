/**
 * Tests — AGENT1-IMPORT-PARITY-4: un prospecto importado se revisa igual que
 * uno de IA, sin cambiar su procedencia (`import`).
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isReviewableRecordOrigin, REVIEWABLE_RECORD_ORIGINS } from '../reviewable-record-origin';
import { evaluateApproveEligibility } from '../approve-eligibility';
import { evaluateConvertApproveEligibility } from '../approve-and-convert-eligibility';
import { evaluateDiscardEligibility } from '../discard-eligibility';
import { evaluateDuplicateEligibility } from '../duplicate-eligibility';

describe('isReviewableRecordOrigin', () => {
  it('production e import son revisables', () => {
    assert.deepEqual([...REVIEWABLE_RECORD_ORIGINS], ['production', 'import']);
    assert.equal(isReviewableRecordOrigin('production'), true);
    assert.equal(isReviewableRecordOrigin('import'), true);
  });

  for (const origin of ['smoke_test', 'qa', 'synthetic', 'historical_cleanup', 'unknown', null, undefined, '']) {
    it(`${String(origin)} sigue fuera (fail-closed)`, () => {
      assert.equal(isReviewableRecordOrigin(origin), false);
    });
  }
});

describe('las cuatro reglas de elegibilidad aceptan import igual que production', () => {
  for (const recordOrigin of ['production', 'import']) {
    it(`${recordOrigin}: aprobar, aprobar y convertir, descartar y marcar duplicado`, () => {
      const base = { status: 'needs_review', recordOrigin, duplicateStatus: 'no_match' };
      assert.deepEqual(evaluateApproveEligibility(base), { decision: 'approve' });
      assert.equal(
        evaluateConvertApproveEligibility({ ...base, convertedAccountId: null, matchedHubspotCompanyId: null } as never).decision,
        evaluateConvertApproveEligibility({ ...base, recordOrigin: 'production', convertedAccountId: null, matchedHubspotCompanyId: null } as never).decision,
      );
      assert.deepEqual(evaluateDiscardEligibility(base), { decision: 'discard' });
      assert.deepEqual(evaluateDuplicateEligibility(base), { decision: 'mark_duplicate' });
    });
  }

  it('smoke_test sigue rechazado en las cuatro', () => {
    const smoke = { status: 'needs_review', recordOrigin: 'smoke_test', duplicateStatus: 'no_match' };
    assert.deepEqual(evaluateApproveEligibility(smoke), { decision: 'reject', reason: 'not_clean_production' });
    assert.deepEqual(evaluateDiscardEligibility(smoke), { decision: 'reject', reason: 'not_clean_production' });
    assert.deepEqual(evaluateDuplicateEligibility(smoke), { decision: 'reject', reason: 'not_clean_production' });
    assert.equal(
      evaluateConvertApproveEligibility({ ...smoke, convertedAccountId: null, matchedHubspotCompanyId: null } as never).decision,
      'reject',
    );
  });
});
