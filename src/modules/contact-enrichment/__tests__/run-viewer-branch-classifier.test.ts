/**
 * Tests — classifyLushaRunViewerBranch (Hito 17B.4X.7C.3E.2)
 *
 * Pure unit tests. No network, no DOM. Mirrors the branch coverage of
 * lusha-empty-vs-unavailable-branch-17b4x7c3d.test.ts, adapted to the
 * historical read-model shape (contact_enrichment_runs status +
 * provider_usage_logs rows) instead of the live wizard's
 * LushaEnrichmentUiResult.
 *
 * Cases:
 *   A — SITECO reproduction: run.status='ready_for_review', a lusha
 *       provider_usage_logs row with status='success', 0 candidates →
 *       empty_after_filtering (never credentials_missing/provider_error)
 *   B — true missing-credentials outcome (status='failed',
 *       summaryError='missing_api_key', no usage row) → credentials_missing
 *   C — true provider error (status='failed', a usage row with
 *       status='error') → provider_error, even if summaryError happens to
 *       be unset or unrelated
 *   D — success with candidates → has_candidates
 *   E — non-Lusha run → not_lusha
 *   F — run not yet executed (no usage rows, not failed) → not_yet_executed
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLushaRunViewerBranch } from '../run-viewer-branch-classifier';
import type { ContactEnrichmentRunDetail, ContactEnrichmentRunProviderUsage } from '../run-viewer-types';

function baseRun(overrides: Partial<ContactEnrichmentRunDetail> = {}): Pick<
  ContactEnrichmentRunDetail,
  'intendedProvider' | 'status' | 'summaryError'
> {
  return {
    intendedProvider: 'lusha',
    status: 'ready_for_review',
    summaryError: null,
    ...overrides,
  };
}

function usageRow(overrides: Partial<ContactEnrichmentRunProviderUsage> = {}): ContactEnrichmentRunProviderUsage {
  return {
    providerKey: 'lusha',
    operationKey: 'lusha_contact_prospecting',
    status: 'success',
    creditsUsed: 1,
    resultsReturned: 0,
    rawResultsCount: 4,
    phoneRevealEnabled: false,
    errorMessage: null,
    createdAt: '2026-07-10T12:03:00.000Z',
    ...overrides,
  };
}

describe('A — SITECO reproduction (success, 0 candidates)', () => {
  it('resolves to empty_after_filtering', () => {
    const branch = classifyLushaRunViewerBranch({
      run: baseRun({ status: 'ready_for_review' }),
      lushaUsageRows: [usageRow({ status: 'success', creditsUsed: 1, rawResultsCount: 4 })],
      candidatesCount: 0,
    });
    assert.equal(branch, 'empty_after_filtering');
  });

  it('never resolves to credentials_missing or provider_error (the reported bug)', () => {
    const branch = classifyLushaRunViewerBranch({
      run: baseRun({ status: 'ready_for_review' }),
      lushaUsageRows: [usageRow({ status: 'success' })],
      candidatesCount: 0,
    });
    assert.notEqual(branch, 'credentials_missing');
    assert.notEqual(branch, 'provider_error');
  });
});

describe('B — true missing-credentials outcome', () => {
  it('failed run, no usage row, summaryError=missing_api_key → credentials_missing', () => {
    const branch = classifyLushaRunViewerBranch({
      run: baseRun({ status: 'failed', summaryError: 'missing_api_key' }),
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(branch, 'credentials_missing');
  });

  it('failed run, no usage row, summaryError=invalid_account → company_context_error', () => {
    const branch = classifyLushaRunViewerBranch({
      run: baseRun({ status: 'failed', summaryError: 'invalid_account' }),
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(branch, 'company_context_error');
  });
});

describe('C — true provider error always wins over summaryError', () => {
  it('failed run with a usage row status=error → provider_error', () => {
    const branch = classifyLushaRunViewerBranch({
      run: baseRun({ status: 'failed', summaryError: null }),
      lushaUsageRows: [usageRow({ status: 'error', errorMessage: 'Lusha search failed: 503' })],
      candidatesCount: 0,
    });
    assert.equal(branch, 'provider_error');
  });

  it('a logged error row overrides a stale/unrelated summaryError', () => {
    const branch = classifyLushaRunViewerBranch({
      run: baseRun({ status: 'failed', summaryError: 'missing_api_key' }),
      lushaUsageRows: [usageRow({ status: 'error' })],
      candidatesCount: 0,
    });
    assert.equal(branch, 'provider_error');
  });

  it('failed run with no distinguishing signal defaults to provider_error, never credentials_missing', () => {
    const branch = classifyLushaRunViewerBranch({
      run: baseRun({ status: 'failed', summaryError: null }),
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(branch, 'provider_error');
    assert.notEqual(branch, 'credentials_missing');
  });
});

describe('D — success with candidates', () => {
  it('resolves to has_candidates', () => {
    const branch = classifyLushaRunViewerBranch({
      run: baseRun({ status: 'ready_for_review' }),
      lushaUsageRows: [usageRow({ status: 'success' })],
      candidatesCount: 1,
    });
    assert.equal(branch, 'has_candidates');
  });
});

describe('E — non-Lusha run', () => {
  it('intendedProvider=apollo resolves to not_lusha', () => {
    const branch = classifyLushaRunViewerBranch({
      run: baseRun({ intendedProvider: 'apollo' }),
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(branch, 'not_lusha');
  });

  it('intendedProvider=null (legacy/bulk row) resolves to not_lusha', () => {
    const branch = classifyLushaRunViewerBranch({
      run: baseRun({ intendedProvider: null }),
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(branch, 'not_lusha');
  });
});

describe('F — run not yet executed', () => {
  it('no usage rows, not failed → not_yet_executed', () => {
    const branch = classifyLushaRunViewerBranch({
      run: baseRun({ status: 'ready_to_enrich' }),
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(branch, 'not_yet_executed');
  });
});
