/**
 * Tests — run-viewer-read-model-core.ts (Hito 17B.4X.7C.3E.2)
 *
 * Pure unit tests over the DI loaders with injected fake fetchers. No
 * Supabase, no network, no DOM.
 *
 * Reproduces contact_enrichment_run_id 5e6fcc30-8449-4816-b46b-63a190704665
 * (SITECO): a Lusha run that executed correctly (providers_used=['lusha'],
 * status='ready_for_review') but ended with 0 candidates after filtering.
 *
 * Cases:
 *   A — loadContactEnrichmentRunById returns the mapped historical run
 *   B — invalid/missing runId is handled safely (no throw, no crash)
 *   C — loadContactCandidatesByRunId is scoped by enrichment_run_id, not
 *       hard-filtered to pending_review, and returns [] for a run with none
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidContactEnrichmentRunId,
  loadContactCandidatesByRunId,
  loadContactEnrichmentRunById,
  loadProviderUsageByAgentRunId,
  mapProviderUsageRow,
  mapRunCandidateRow,
  mapRunDetailRow,
} from '../run-viewer-read-model-core';

const SITECO_RUN_ID = '5e6fcc30-8449-4816-b46b-63a190704665';
const SITECO_AGENT_RUN_ID = '11111111-1111-1111-1111-111111111111';

function sitecoRunRow() {
  return {
    id: SITECO_RUN_ID,
    status: 'ready_for_review',
    company_name: 'Siteco Soluciones',
    company_domain: 'sitecosoluciones.com',
    company_country_code: 'CO',
    hubspot_company_id: null,
    account_id: 'acc-siteco',
    agent_run_id: SITECO_AGENT_RUN_ID,
    request_id: 'req-siteco',
    attempt_order: 1,
    intended_provider: 'lusha',
    providers_used: ['lusha'],
    estimated_cost_usd: 0.008,
    real_cost_usd: null,
    summary: {
      totalCandidates: 0,
      candidates_created: 0,
      raw_results: 4,
      credits_used: 1,
      discovery_mode: 'company_first_discovery',
    },
    created_at: '2026-07-10T12:00:00.000Z',
    updated_at: '2026-07-10T12:05:00.000Z',
  };
}

describe('isValidContactEnrichmentRunId', () => {
  it('accepts a well-formed UUID', () => {
    assert.equal(isValidContactEnrichmentRunId(SITECO_RUN_ID), true);
  });

  it('rejects an empty string', () => {
    assert.equal(isValidContactEnrichmentRunId(''), false);
  });

  it('rejects a non-UUID string', () => {
    assert.equal(isValidContactEnrichmentRunId('not-a-uuid'), false);
  });

  it('rejects a UUID-shaped string with an invalid character', () => {
    assert.equal(isValidContactEnrichmentRunId('5e6fcc30-8449-4816-b46b-63a190704zzz'), false);
  });
});

describe('A — loadContactEnrichmentRunById (SITECO reproduction)', () => {
  it('returns the mapped run for a valid, existing runId', async () => {
    const run = await loadContactEnrichmentRunById(SITECO_RUN_ID, {
      fetchRunRow: async (id) => {
        assert.equal(id, SITECO_RUN_ID);
        return sitecoRunRow();
      },
    });

    assert.ok(run);
    assert.equal(run?.id, SITECO_RUN_ID);
    assert.equal(run?.status, 'ready_for_review');
    assert.equal(run?.companyName, 'Siteco Soluciones');
    assert.equal(run?.companyDomain, 'sitecosoluciones.com');
    assert.equal(run?.companyCountryCode, 'CO');
    assert.equal(run?.intendedProvider, 'lusha');
    assert.equal(run?.attemptOrder, 1);
    assert.deepEqual(run?.providersUsed, ['lusha']);
    assert.equal(run?.agentRunId, SITECO_AGENT_RUN_ID);
  });

  it('summaryError is null for a successful run (never implies a failure)', async () => {
    const run = await loadContactEnrichmentRunById(SITECO_RUN_ID, {
      fetchRunRow: async () => sitecoRunRow(),
    });
    assert.equal(run?.summaryError, null);
  });

  it('surfaces summary.error for a genuinely failed run', async () => {
    const run = await loadContactEnrichmentRunById(SITECO_RUN_ID, {
      fetchRunRow: async () => ({
        ...sitecoRunRow(),
        status: 'failed',
        summary: { error: 'missing_api_key' },
      }),
    });
    assert.equal(run?.summaryError, 'missing_api_key');
  });
});

describe('B — invalid / missing runId handled safely', () => {
  it('returns null for an invalid UUID without calling the fetcher', async () => {
    let called = false;
    const run = await loadContactEnrichmentRunById('not-a-uuid', {
      fetchRunRow: async () => {
        called = true;
        return sitecoRunRow();
      },
    });
    assert.equal(run, null);
    assert.equal(called, false);
  });

  it('returns null when the fetcher reports the run does not exist', async () => {
    const run = await loadContactEnrichmentRunById(SITECO_RUN_ID, {
      fetchRunRow: async () => null,
    });
    assert.equal(run, null);
  });

  it('candidates loader returns [] for an invalid UUID without calling the fetcher', async () => {
    let called = false;
    const candidates = await loadContactCandidatesByRunId('not-a-uuid', {
      fetchCandidateRows: async () => {
        called = true;
        return [];
      },
    });
    assert.deepEqual(candidates, []);
    assert.equal(called, false);
  });

  it('provider usage loader returns [] for a null agentRunId without calling the fetcher', async () => {
    let called = false;
    const usage = await loadProviderUsageByAgentRunId(null, {
      fetchUsageRows: async () => {
        called = true;
        return [];
      },
    });
    assert.deepEqual(usage, []);
    assert.equal(called, false);
  });
});

describe('C — candidates scoped by enrichment_run_id, not hard-filtered to pending_review', () => {
  it('returns [] for the SITECO run (0 candidates after filtering) without failing', async () => {
    const candidates = await loadContactCandidatesByRunId(SITECO_RUN_ID, {
      fetchCandidateRows: async (id) => {
        assert.equal(id, SITECO_RUN_ID);
        return [];
      },
    });
    assert.deepEqual(candidates, []);
  });

  it('includes candidates regardless of status (approved/discarded/duplicate), not just pending_review', async () => {
    const candidates = await loadContactCandidatesByRunId(SITECO_RUN_ID, {
      fetchCandidateRows: async () => [
        { id: 'c-1', full_name: 'A', status: 'pending_review', source: 'lusha', created_at: '2026-07-10T00:00:00.000Z' },
        { id: 'c-2', full_name: 'B', status: 'approved', source: 'lusha', created_at: '2026-07-10T00:00:00.000Z' },
        { id: 'c-3', full_name: 'C', status: 'discarded', source: 'lusha', created_at: '2026-07-10T00:00:00.000Z' },
        { id: 'c-4', full_name: 'D', status: 'duplicate', source: 'lusha', created_at: '2026-07-10T00:00:00.000Z' },
      ],
    });
    assert.equal(candidates.length, 4);
    assert.deepEqual(
      candidates.map((c) => c.status),
      ['pending_review', 'approved', 'discarded', 'duplicate'],
    );
  });
});

describe('Provider usage — Lusha success with 0 candidates (SITECO)', () => {
  it('maps raw_results and credits_used from provider_usage_logs.metadata', async () => {
    const usage = await loadProviderUsageByAgentRunId(SITECO_AGENT_RUN_ID, {
      fetchUsageRows: async (id) => {
        assert.equal(id, SITECO_AGENT_RUN_ID);
        return [
          {
            provider_key: 'lusha',
            operation_key: 'lusha_contact_prospecting',
            status: 'success',
            credits_used: 1,
            results_returned: 0,
            metadata: { raw_results: 4, phone_reveal_enabled: false },
            error_message: null,
            created_at: '2026-07-10T12:03:00.000Z',
          },
        ];
      },
    });

    assert.equal(usage.length, 1);
    assert.equal(usage[0].providerKey, 'lusha');
    assert.equal(usage[0].status, 'success');
    assert.equal(usage[0].creditsUsed, 1);
    assert.equal(usage[0].rawResultsCount, 4);
    assert.equal(usage[0].phoneRevealEnabled, false);
  });
});

describe('Row mappers — defensive against unknown/partial shapes', () => {
  it('mapRunDetailRow never throws on a minimal row', () => {
    assert.doesNotThrow(() => mapRunDetailRow({ id: 'x' }));
  });

  it('mapRunCandidateRow never throws on a minimal row', () => {
    assert.doesNotThrow(() => mapRunCandidateRow({ id: 'x' }));
  });

  it('mapProviderUsageRow never throws on a minimal row', () => {
    assert.doesNotThrow(() => mapProviderUsageRow({}));
  });

  it('mapProviderUsageRow does not fabricate rawResultsCount when metadata lacks it', () => {
    const usage = mapProviderUsageRow({ provider_key: 'lusha', status: 'success', metadata: {} });
    assert.equal(usage.rawResultsCount, null);
  });
});
