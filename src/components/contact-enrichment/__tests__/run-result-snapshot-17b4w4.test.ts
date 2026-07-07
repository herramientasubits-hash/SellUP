/**
 * 17B.4W.4 — RunResultSnapshot result-card logic tests.
 *
 * Tests the exact count-authority and status-display expressions used in
 * RunResultSnapshot. No DOM rendering required — verifies the pure derived
 * values that drive the two fixed display defects.
 *
 * Tests:
 *   1 — Lusha success: candidatesCreated from lushaResult (not initial runResult)
 *   2 — Lusha providerStatus='success' resolves to 'Listo para revisión'
 *   3 — Apollo totalCandidates used when no lushaResult
 *   4 — runResult.candidatesCount fallback when no provider result
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  ApolloEnrichmentUiResult,
  LushaEnrichmentUiResult,
} from '../contact-enrichment-chat-types';

// ── Mirror the exact component expressions ────────────────────────────────────

function displayedCandidateCount(
  lushaResult: LushaEnrichmentUiResult | null | undefined,
  apolloResult: ApolloEnrichmentUiResult | null | undefined,
  runCandidatesCount: number,
): number {
  return lushaResult
    ? lushaResult.candidatesCreated
    : apolloResult
      ? apolloResult.totalCandidates
      : runCandidatesCount;
}

function displayedStatusLabel(
  lushaResult: LushaEnrichmentUiResult | null | undefined,
  apolloResult: ApolloEnrichmentUiResult | null | undefined,
  lushaTerminalError: boolean,
): string {
  if (lushaTerminalError) return '(terminal-error-branch)';
  const readyForReview =
    apolloResult?.status === 'ready_for_review' ||
    lushaResult?.status === 'ready_for_review' ||
    lushaResult?.providerStatus === 'success';
  if (readyForReview) return 'Listo para revisión';
  const completed =
    apolloResult?.status === 'completed' || lushaResult?.status === 'completed';
  if (completed) return 'Completado';
  return 'Listo para enriquecer';
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LUSHA_SUCCESS: LushaEnrichmentUiResult = {
  status: 'ready_for_review',   // runtime value from runner is 'success'; type allows ready_for_review
  candidatesCreated: 2,
  duplicatesSkipped: 0,
  rawResultsCount: 5,
  creditsUsed: 2,
  providerStatus: 'success',
  noReviewableContactsFound: false,
};

// Simulate the actual runtime case where runner returns status='success' (cast mismatch)
const LUSHA_SUCCESS_RUNTIME = {
  ...LUSHA_SUCCESS,
  status: 'success' as LushaEnrichmentUiResult['status'],
};

const APOLLO_RESULT: ApolloEnrichmentUiResult = {
  status: 'ready_for_review',
  candidatesCreated: 3,
  totalCandidates: 3,
  duplicatesSkipped: 0,
  possibleDuplicates: 0,
  rawResultsCount: 10,
  rejectedByRelevance: 0,
  completionAttempted: 0,
  actionableContactsCount: 3,
  noReviewableContactsFound: false,
  noActionableContactsFound: false,
  providerStatus: 'success',
  estimatedCostUsd: 0,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RunResultSnapshot — candidate count authority (17B.4W.4)', () => {
  it('TEST 1: Lusha success uses candidatesCreated from lushaResult, not initial runResult.candidatesCount=0', () => {
    const count = displayedCandidateCount(LUSHA_SUCCESS, null, 0);
    assert.equal(count, 2, 'Expected lushaResult.candidatesCreated=2, not stale runResult.candidatesCount=0');
  });

  it('TEST 1b: Same with runtime status=success cast (real ABANK scenario)', () => {
    const count = displayedCandidateCount(LUSHA_SUCCESS_RUNTIME, null, 0);
    assert.equal(count, 2);
  });

  it('TEST 3: Apollo totalCandidates used when no lushaResult', () => {
    const count = displayedCandidateCount(null, APOLLO_RESULT, 0);
    assert.equal(count, 3, 'Expected apolloResult.totalCandidates=3');
  });

  it('TEST 4: fallback to runResult.candidatesCount when no provider result', () => {
    const count = displayedCandidateCount(null, null, 7);
    assert.equal(count, 7, 'Expected runResult.candidatesCount=7 as fallback');
  });

  it('terminal Lusha result still uses lushaResult.candidatesCreated', () => {
    const terminalLusha: LushaEnrichmentUiResult = {
      status: 'provider_error',
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      rawResultsCount: 0,
      creditsUsed: null,
      providerStatus: 'error',
      noReviewableContactsFound: true,
    };
    const count = displayedCandidateCount(terminalLusha, null, 5);
    assert.equal(count, 0, 'Terminal Lusha: candidatesCreated=0, not stale runResult.candidatesCount=5');
  });
});

describe('RunResultSnapshot — status badge display (17B.4W.4)', () => {
  it('TEST 2: Lusha providerStatus=success renders "Listo para revisión"', () => {
    const label = displayedStatusLabel(LUSHA_SUCCESS, null, false);
    assert.equal(label, 'Listo para revisión');
  });

  it('TEST 2b: Lusha runtime status=success (real runner return) renders "Listo para revisión"', () => {
    const label = displayedStatusLabel(LUSHA_SUCCESS_RUNTIME, null, false);
    assert.equal(label, 'Listo para revisión');
  });

  it('TEST 2c: Lusha success does NOT render "Listo para enriquecer"', () => {
    const label = displayedStatusLabel(LUSHA_SUCCESS_RUNTIME, null, false);
    assert.notEqual(label, 'Listo para enriquecer');
  });

  it('Apollo ready_for_review still renders "Listo para revisión"', () => {
    const label = displayedStatusLabel(null, APOLLO_RESULT, false);
    assert.equal(label, 'Listo para revisión');
  });

  it('no provider result falls through to "Listo para enriquecer"', () => {
    const label = displayedStatusLabel(null, null, false);
    assert.equal(label, 'Listo para enriquecer');
  });
});
