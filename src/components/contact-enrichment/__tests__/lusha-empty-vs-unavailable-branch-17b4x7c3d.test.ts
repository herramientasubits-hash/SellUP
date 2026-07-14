/**
 * 17B.4X.7C.3D — RunResultSnapshot Lusha detail-branch selection tests.
 *
 * Reproduces the SITECO false-message bug: a Lusha run that executed
 * correctly (1 credit consumed, 4 raw results) but ended with 0 reviewable
 * candidates after relevance/company-consistency filtering was rendered
 * with the "Lusha no está disponible o no tiene credenciales configuradas"
 * message. That message must only appear for a genuine
 * unavailable/no-credentials/provider-error outcome.
 *
 * No DOM rendering required — mirrors the exact derived-branch logic used
 * in RunResultSnapshot (contact-enrichment-chat-result.tsx), following the
 * pattern established in run-result-snapshot-17b4w4.test.ts.
 *
 * Tests:
 *   A — success with 0 candidates after filtering → empty_after_filtering
 *       (never credentials_missing/provider_error)
 *   B — true unavailable/no credentials → credentials_missing
 *   C — true provider error → provider_error
 *   D — success with candidates → pending_review
 *   E — Apollo empty-state branch is untouched (regression guard)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  ApolloEnrichmentUiResult,
  ContactEnrichmentProvider,
  LushaEnrichmentUiResult,
} from '../contact-enrichment-chat-types';

// ── Mirror the exact derived expressions from RunResultSnapshot ───────────────

type LushaDetailBranch =
  | 'apollo'
  | 'credentials_missing'
  | 'company_context_error'
  | 'provider_error'
  | 'empty_after_filtering'
  | 'pending_review'
  | 'preflight_instructions';

function selectLushaDetailBranch(
  provider: ContactEnrichmentProvider | undefined,
  lushaResult: LushaEnrichmentUiResult | null | undefined,
  apolloResult: ApolloEnrichmentUiResult | null | undefined,
): LushaDetailBranch {
  if (apolloResult) return 'apollo';

  const lushaCredentialsMissing =
    provider === 'lusha' &&
    (lushaResult?.status === 'missing_api_key' || lushaResult?.status === 'disabled');
  if (lushaCredentialsMissing) return 'credentials_missing';

  const lushaCompanyContextError =
    provider === 'lusha' &&
    (lushaResult?.status === 'invalid_account' || lushaResult?.status === 'not_found');
  if (lushaCompanyContextError) return 'company_context_error';

  const lushaProviderError = provider === 'lusha' && lushaResult?.status === 'provider_error';
  if (lushaProviderError) return 'provider_error';

  if (lushaResult && lushaResult.candidatesCreated === 0) return 'empty_after_filtering';
  if (lushaResult) return 'pending_review';
  return 'preflight_instructions';
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Reproduces contact_enrichment_run_id 5e6fcc30-8449-4816-b46b-63a190704665
// (SITECO): provider_usage_logs.status=success, credits_used=1, raw_results=4,
// role_relevant=0, fqdn_consistent=0, candidates=0.
const SITECO_EMPTY_AFTER_FILTERING: LushaEnrichmentUiResult = {
  status: 'no_reviewable_candidate',
  candidatesCreated: 0,
  duplicatesSkipped: 0,
  rawResultsCount: 4,
  creditsUsed: 1,
  providerStatus: 'success',
  noReviewableContactsFound: true,
};

const TRUE_MISSING_CREDENTIALS: LushaEnrichmentUiResult = {
  status: 'missing_api_key',
  candidatesCreated: 0,
  duplicatesSkipped: 0,
  rawResultsCount: 0,
  creditsUsed: null,
  providerStatus: 'skipped',
  noReviewableContactsFound: true,
  error: 'Lusha API key not configured (sellup_prospecting_lusha_api_key not found in Vault).',
};

const TRUE_PROVIDER_ERROR: LushaEnrichmentUiResult = {
  status: 'provider_error',
  candidatesCreated: 0,
  duplicatesSkipped: 0,
  rawResultsCount: 0,
  creditsUsed: null,
  providerStatus: 'error',
  noReviewableContactsFound: true,
  error: 'Lusha enrich failed: HTTP 503',
};

const SUCCESS_WITH_CANDIDATES: LushaEnrichmentUiResult = {
  status: 'ready_for_review',
  candidatesCreated: 1,
  duplicatesSkipped: 0,
  rawResultsCount: 4,
  creditsUsed: 1,
  providerStatus: 'success',
  noReviewableContactsFound: false,
};

const APOLLO_RESULT: ApolloEnrichmentUiResult = {
  status: 'ready_for_review',
  candidatesCreated: 0,
  totalCandidates: 0,
  duplicatesSkipped: 0,
  possibleDuplicates: 0,
  rawResultsCount: 3,
  rejectedByRelevance: 3,
  completionAttempted: 0,
  actionableContactsCount: 0,
  noReviewableContactsFound: true,
  noActionableContactsFound: false,
  providerStatus: 'success',
  estimatedCostUsd: 0,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RunResultSnapshot — Lusha empty-after-filtering vs unavailable (17B.4X.7C.3D)', () => {
  it('A: SITECO reproduction (success, 0 candidates) resolves to empty_after_filtering', () => {
    const branch = selectLushaDetailBranch('lusha', SITECO_EMPTY_AFTER_FILTERING, null);
    assert.equal(branch, 'empty_after_filtering');
  });

  it('A: never resolves the SITECO reproduction to credentials_missing (the reported bug)', () => {
    const branch = selectLushaDetailBranch('lusha', SITECO_EMPTY_AFTER_FILTERING, null);
    assert.notEqual(branch, 'credentials_missing');
    assert.notEqual(branch, 'provider_error');
  });

  it('B: true missing-credentials outcome still resolves to credentials_missing', () => {
    const branch = selectLushaDetailBranch('lusha', TRUE_MISSING_CREDENTIALS, null);
    assert.equal(branch, 'credentials_missing');
  });

  it('C: true provider-error outcome still resolves to provider_error', () => {
    const branch = selectLushaDetailBranch('lusha', TRUE_PROVIDER_ERROR, null);
    assert.equal(branch, 'provider_error');
  });

  it('D: success with candidates resolves to pending_review', () => {
    const branch = selectLushaDetailBranch('lusha', SUCCESS_WITH_CANDIDATES, null);
    assert.equal(branch, 'pending_review');
  });

  it('E: Apollo empty result (candidatesCreated=0) is routed to the apollo branch, not Lusha logic', () => {
    const branch = selectLushaDetailBranch('apollo', null, APOLLO_RESULT);
    assert.equal(branch, 'apollo');
  });
});
