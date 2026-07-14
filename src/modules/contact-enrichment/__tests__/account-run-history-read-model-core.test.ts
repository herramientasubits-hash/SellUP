/**
 * Tests — account-run-history-read-model-core.ts (Hito 17B.4X.7C.3E.3)
 *
 * Pure unit tests over the DI loader with injected fake fetchers. No
 * Supabase, no network, no DOM.
 *
 * Reproduces the SITECO account with two contact_enrichment_runs — one
 * Apollo, one Lusha (agent_run_id 5e6fcc30-8449-4816-b46b-63a190704665 for
 * Lusha, fe613742-303d-4a9c-bfc3-398f74ebaf98 for Apollo, mirroring the
 * hito's SITECO fixture ids) — plus candidates and provider_usage_logs rows
 * scoped to those runs.
 *
 * Cases:
 *   A — runs by account_id: returns only that account's runs, preserves the
 *       caller's created_at desc ordering, counts candidates per run, sums
 *       credits per agent_run_id
 *   B — invalid/missing accountId is handled safely (no throw, no crash)
 *   C — an account with zero runs returns []
 *   D — candidate counts and provider usage are scoped by run/agent_run_id,
 *       never mixed across runs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidAccountIdForRunHistory,
  loadContactEnrichmentRunsByAccountId,
} from '../account-run-history-read-model-core';

const SITECO_ACCOUNT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_ACCOUNT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LUSHA_RUN_ID = '5e6fcc30-8449-4816-b46b-63a190704665';
const APOLLO_RUN_ID = 'fe613742-303d-4a9c-bfc3-398f74ebaf98';
const LUSHA_AGENT_RUN_ID = '11111111-1111-1111-1111-111111111111';
const APOLLO_AGENT_RUN_ID = '22222222-2222-2222-2222-222222222222';

function lushaRunRow() {
  return {
    id: LUSHA_RUN_ID,
    status: 'ready_for_review',
    company_name: 'Siteco Soluciones',
    company_domain: 'sitecosoluciones.com',
    company_country_code: 'CO',
    hubspot_company_id: null,
    account_id: SITECO_ACCOUNT_ID,
    agent_run_id: LUSHA_AGENT_RUN_ID,
    request_id: 'req-lusha',
    attempt_order: 1,
    intended_provider: 'lusha',
    providers_used: ['lusha'],
    estimated_cost_usd: 0.008,
    real_cost_usd: null,
    summary: {},
    created_at: '2026-07-10T12:00:00.000Z',
    updated_at: '2026-07-10T12:05:00.000Z',
  };
}

function apolloRunRow() {
  return {
    id: APOLLO_RUN_ID,
    status: 'completed',
    company_name: 'Siteco Soluciones',
    company_domain: 'sitecosoluciones.com',
    company_country_code: 'CO',
    hubspot_company_id: null,
    account_id: SITECO_ACCOUNT_ID,
    agent_run_id: APOLLO_AGENT_RUN_ID,
    request_id: 'req-apollo',
    attempt_order: 1,
    intended_provider: 'apollo',
    providers_used: ['apollo'],
    estimated_cost_usd: 0.05,
    real_cost_usd: 0.05,
    summary: {},
    created_at: '2026-07-08T09:00:00.000Z',
    updated_at: '2026-07-08T09:05:00.000Z',
  };
}

describe('isValidAccountIdForRunHistory', () => {
  it('accepts a well-formed UUID', () => {
    assert.equal(isValidAccountIdForRunHistory(SITECO_ACCOUNT_ID), true);
  });

  it('rejects an empty string', () => {
    assert.equal(isValidAccountIdForRunHistory(''), false);
  });

  it('rejects a non-UUID string', () => {
    assert.equal(isValidAccountIdForRunHistory('not-a-uuid'), false);
  });
});

describe('A — loadContactEnrichmentRunsByAccountId (SITECO reproduction)', () => {
  it('returns runs in the order the fetcher provided them (Apollo, then Lusha desc by created_at)', async () => {
    const runs = await loadContactEnrichmentRunsByAccountId(SITECO_ACCOUNT_ID, {
      fetchRunRows: async (id) => {
        assert.equal(id, SITECO_ACCOUNT_ID);
        return [lushaRunRow(), apolloRunRow()];
      },
      fetchCandidateCountRows: async () => [],
      fetchProviderUsageSummaryRows: async () => [],
    });

    assert.equal(runs.length, 2);
    assert.deepEqual(runs.map((r) => r.id), [LUSHA_RUN_ID, APOLLO_RUN_ID]);
  });

  it('scopes candidate counts by enrichment_run_id — no mixing across runs', async () => {
    const runs = await loadContactEnrichmentRunsByAccountId(SITECO_ACCOUNT_ID, {
      fetchRunRows: async () => [lushaRunRow(), apolloRunRow()],
      fetchCandidateCountRows: async (runIds) => {
        assert.deepEqual(new Set(runIds), new Set([LUSHA_RUN_ID, APOLLO_RUN_ID]));
        return [
          { enrichment_run_id: APOLLO_RUN_ID, status: 'pending_review' },
          { enrichment_run_id: APOLLO_RUN_ID, status: 'approved' },
          { enrichment_run_id: APOLLO_RUN_ID, status: 'discarded' },
        ];
      },
      fetchProviderUsageSummaryRows: async () => [],
    });

    const lusha = runs.find((r) => r.id === LUSHA_RUN_ID);
    const apollo = runs.find((r) => r.id === APOLLO_RUN_ID);

    assert.equal(lusha?.candidateCount, 0);
    assert.equal(apollo?.candidateCount, 3);
    assert.equal(apollo?.pendingReviewCount, 1);
    assert.equal(apollo?.approvedCount, 1);
  });

  it('sums provider_usage_logs.credits_used per agent_run_id and collects distinct statuses', async () => {
    const runs = await loadContactEnrichmentRunsByAccountId(SITECO_ACCOUNT_ID, {
      fetchRunRows: async () => [lushaRunRow(), apolloRunRow()],
      fetchCandidateCountRows: async () => [],
      fetchProviderUsageSummaryRows: async (agentRunIds) => {
        assert.deepEqual(new Set(agentRunIds), new Set([LUSHA_AGENT_RUN_ID, APOLLO_AGENT_RUN_ID]));
        return [
          { agent_run_id: LUSHA_AGENT_RUN_ID, credits_used: 1, status: 'success' },
          { agent_run_id: APOLLO_AGENT_RUN_ID, credits_used: 2, status: 'success' },
          { agent_run_id: APOLLO_AGENT_RUN_ID, credits_used: 3, status: 'success' },
        ];
      },
    });

    const lusha = runs.find((r) => r.id === LUSHA_RUN_ID);
    const apollo = runs.find((r) => r.id === APOLLO_RUN_ID);

    assert.equal(lusha?.totalCreditsUsed, 1);
    assert.deepEqual(lusha?.providerUsageStatuses, ['success']);
    assert.equal(apollo?.totalCreditsUsed, 5);
  });

  it('never returns a run for a different account_id than requested', async () => {
    const runs = await loadContactEnrichmentRunsByAccountId(OTHER_ACCOUNT_ID, {
      fetchRunRows: async (id) => {
        assert.equal(id, OTHER_ACCOUNT_ID);
        return [];
      },
      fetchCandidateCountRows: async () => [],
      fetchProviderUsageSummaryRows: async () => [],
    });
    assert.deepEqual(runs, []);
  });
});

describe('B — invalid / missing accountId handled safely', () => {
  it('returns [] for an invalid UUID without calling any fetcher', async () => {
    let called = false;
    const runs = await loadContactEnrichmentRunsByAccountId('not-a-uuid', {
      fetchRunRows: async () => {
        called = true;
        return [lushaRunRow()];
      },
      fetchCandidateCountRows: async () => [],
      fetchProviderUsageSummaryRows: async () => [],
    });
    assert.deepEqual(runs, []);
    assert.equal(called, false);
  });
});

describe('C — account with zero runs', () => {
  it('returns [] without calling candidate/usage fetchers', async () => {
    let candidateFetcherCalled = false;
    let usageFetcherCalled = false;

    const runs = await loadContactEnrichmentRunsByAccountId(SITECO_ACCOUNT_ID, {
      fetchRunRows: async () => [],
      fetchCandidateCountRows: async () => {
        candidateFetcherCalled = true;
        return [];
      },
      fetchProviderUsageSummaryRows: async () => {
        usageFetcherCalled = true;
        return [];
      },
    });

    assert.deepEqual(runs, []);
    assert.equal(candidateFetcherCalled, false);
    assert.equal(usageFetcherCalled, false);
  });
});

describe('D — a run with no agent_run_id never triggers a provider usage lookup for it', () => {
  it('skips the agent_run_id-less run and still resolves the other run correctly', async () => {
    const legacyRun = { ...apolloRunRow(), id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', agent_run_id: null };

    const runs = await loadContactEnrichmentRunsByAccountId(SITECO_ACCOUNT_ID, {
      fetchRunRows: async () => [lushaRunRow(), legacyRun],
      fetchCandidateCountRows: async () => [],
      fetchProviderUsageSummaryRows: async (agentRunIds) => {
        assert.deepEqual(agentRunIds, [LUSHA_AGENT_RUN_ID]);
        return [{ agent_run_id: LUSHA_AGENT_RUN_ID, credits_used: 1, status: 'success' }];
      },
    });

    const legacy = runs.find((r) => r.id === legacyRun.id);
    assert.equal(legacy?.totalCreditsUsed, null);
    assert.deepEqual(legacy?.providerUsageStatuses, []);
  });
});
