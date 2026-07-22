// Q3F-5AZ.2E-1 — Convert-approve eligibility (pure decision) tests.
//
// Exhaustively covers the safety policy the Prospectos convert wrapper enforces
// before delegating to the canonical approveAndConvertCandidateAction. No IO, no
// DB, no clients — pure function under test.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateConvertApproveEligibility,
  type ConvertCandidateSnapshot,
} from '../approve-and-convert-eligibility';

const BASE: ConvertCandidateSnapshot = {
  status: 'needs_review',
  recordOrigin: 'production',
  duplicateStatus: 'no_match',
  convertedAccountId: null,
  matchedHubspotCompanyId: null,
};

function snap(overrides: Partial<ConvertCandidateSnapshot>): ConvertCandidateSnapshot {
  return { ...BASE, ...overrides };
}

describe('evaluateConvertApproveEligibility — clean production gate', () => {
  it('rejects a non-production record with not_clean_production', () => {
    const d = evaluateConvertApproveEligibility(snap({ recordOrigin: 'sandbox' }));
    assert.deepEqual(d, { decision: 'reject', reason: 'not_clean_production' });
  });

  it('rejects a null record_origin with not_clean_production', () => {
    const d = evaluateConvertApproveEligibility(snap({ recordOrigin: null }));
    assert.deepEqual(d, { decision: 'reject', reason: 'not_clean_production' });
  });
});

describe('evaluateConvertApproveEligibility — idempotent (already converted)', () => {
  it('returns idempotent + accountId when converted_to_account with an account id', () => {
    const d = evaluateConvertApproveEligibility(
      snap({ status: 'converted_to_account', convertedAccountId: 'acc-123' }),
    );
    assert.deepEqual(d, { decision: 'idempotent', accountId: 'acc-123' });
  });

  it('does NOT treat converted status without an account id as idempotent (status_conflict)', () => {
    const d = evaluateConvertApproveEligibility(
      snap({ status: 'converted_to_account', convertedAccountId: null }),
    );
    assert.deepEqual(d, { decision: 'reject', reason: 'status_conflict' });
  });
});

describe('evaluateConvertApproveEligibility — approved-only backlog conflict', () => {
  it('rejects status approved + no converted account id with approved_only_requires_remediation', () => {
    const d = evaluateConvertApproveEligibility(
      snap({ status: 'approved', convertedAccountId: null }),
    );
    assert.deepEqual(d, { decision: 'reject', reason: 'approved_only_requires_remediation' });
  });

  it('an approved candidate WITH a converted account id is idempotent, not remediation', () => {
    const d = evaluateConvertApproveEligibility(
      snap({ status: 'approved', convertedAccountId: 'acc-9' }),
    );
    // approved + account id falls through the converted branch (status !== converted)
    // → status_conflict, NOT a silent convert. Never re-converts.
    assert.deepEqual(d, { decision: 'reject', reason: 'status_conflict' });
  });
});

describe('evaluateConvertApproveEligibility — status gate', () => {
  for (const status of ['generated', 'normalized', 'discarded', 'duplicate', 'enrichment_pending']) {
    it(`rejects status "${status}" with status_conflict`, () => {
      const d = evaluateConvertApproveEligibility(snap({ status }));
      assert.deepEqual(d, { decision: 'reject', reason: 'status_conflict' });
    });
  }
});

describe('evaluateConvertApproveEligibility — duplicate policy', () => {
  for (const dup of ['exact_duplicate', 'unchecked', 'insufficient_data']) {
    it(`hard-blocks duplicate_status "${dup}"`, () => {
      const d = evaluateConvertApproveEligibility(snap({ duplicateStatus: dup }));
      assert.deepEqual(d, { decision: 'reject', reason: 'duplicate_blocked' });
    });
  }

  it('requires explicit confirmation for possible_duplicate', () => {
    const d = evaluateConvertApproveEligibility(snap({ duplicateStatus: 'possible_duplicate' }));
    assert.deepEqual(d, { decision: 'reject', reason: 'needs_duplicate_confirmation' });
  });

  it('converts a possible_duplicate WITH explicit confirmation', () => {
    const d = evaluateConvertApproveEligibility(
      snap({ duplicateStatus: 'possible_duplicate' }),
      { confirmPossibleDuplicate: true },
    );
    assert.deepEqual(d, { decision: 'convert' });
  });
});

describe('evaluateConvertApproveEligibility — HubSpot-match confirmation', () => {
  it('requires explicit confirmation when matched_hubspot_company_id is present', () => {
    const d = evaluateConvertApproveEligibility(snap({ matchedHubspotCompanyId: 'hs-1' }));
    assert.deepEqual(d, { decision: 'reject', reason: 'needs_hubspot_match_confirmation' });
  });

  it('converts a HubSpot-matched candidate WITH explicit confirmation', () => {
    const d = evaluateConvertApproveEligibility(
      snap({ matchedHubspotCompanyId: 'hs-1' }),
      { confirmHubSpotMatch: true },
    );
    assert.deepEqual(d, { decision: 'convert' });
  });

  it('requires BOTH confirmations when possible_duplicate AND HubSpot match co-occur', () => {
    const onlyDup = evaluateConvertApproveEligibility(
      snap({ duplicateStatus: 'possible_duplicate', matchedHubspotCompanyId: 'hs-1' }),
      { confirmPossibleDuplicate: true },
    );
    assert.deepEqual(onlyDup, { decision: 'reject', reason: 'needs_hubspot_match_confirmation' });

    const both = evaluateConvertApproveEligibility(
      snap({ duplicateStatus: 'possible_duplicate', matchedHubspotCompanyId: 'hs-1' }),
      { confirmPossibleDuplicate: true, confirmHubSpotMatch: true },
    );
    assert.deepEqual(both, { decision: 'convert' });
  });
});

describe('evaluateConvertApproveEligibility — happy path', () => {
  it('converts a clean needs_review production candidate with no blocking signals', () => {
    const d = evaluateConvertApproveEligibility(snap({}));
    assert.deepEqual(d, { decision: 'convert' });
  });
});
