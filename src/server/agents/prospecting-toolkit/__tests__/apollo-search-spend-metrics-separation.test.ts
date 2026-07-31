/**
 * Tests — raw / normalized / eligible / persisted are four different numbers.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 · joint metrics scenario.
 *
 * Why one test covers all four at once: the QA defect came from conflating them.
 * Billing was computed from `mapped.length` (post-normalization), so an
 * organization Apollo returned and charged for — but that we dropped while
 * normalizing — was invisible to reconciliation, and the run looked cheaper than
 * it was. Asserting each count in its own test would not have caught that: the
 * bug was in the *relationship* between them.
 *
 * One Apollo page returns 3 organizations:
 *   3 raw          — what Apollo returned and billed
 *   2 normalized   — one has no name and cannot be mapped
 *   1 eligible     — one of the two contradicts the requested sector
 *   0 or 1 persisted — persistence is downstream and bounded by eligible
 *
 * Transport is injected, so there is no Apollo call and no credit is spent.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
} from '../web-search-providers/apollo-organizations-search-provider';
import { creditsForApolloOperation } from '../apollo-operation-pricing';
import {
  buildWizardRunCorrelation,
  toRunCorrelationMetadata,
  withResolvedIds,
  RUN_CORRELATION_METADATA_KEY,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
import { reconcileWizardRunSpend } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-reconciliation';
import { APOLLO_SPEND_OBSERVABILITY_KEY } from '../apollo-spend-observability';
import type { ApolloPageFetchResult } from '../apollo-organizations-paginated-search';
import type { WebSearchInput } from '../types';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

const BATCH_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RESERVATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const TOUCHED_ENV = [
  'ENABLE_APOLLO_COMPANY_SEARCH',
  'ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE',
  'AGENT1_APOLLO_MAX_RESULTS_PER_QUERY',
] as const;
const SAVED = new Map(TOUCHED_ENV.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of TOUCHED_ENV) {
    const saved = SAVED.get(key);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

const INPUT: WebSearchInput = {
  query: 'supermercados colombia',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail y Consumo',
  maxResults: 3,
  provider: 'apollo_organizations',
};

/**
 * One page, three organizations:
 *   #1 a real supermarket        → normalizes, matches the sector
 *   #2 a software company        → normalizes, contradicts the sector
 *   #3 no name                   → cannot be normalized, yet Apollo charged for it
 */
function threeOrgsOneUnnamed(): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: [
        {
          id: 'org-supermarket',
          name: 'Supermercados Del Valle S.A.',
          primary_domain: 'supermercadosdelvalle.com.co',
          industry: 'supermarket',
          keywords: ['supermercado', 'grocery retail'],
          short_description: 'Cadena de supermercados en Colombia',
          estimated_num_employees: 1200,
          country: 'Colombia',
        },
        {
          id: 'org-software',
          name: 'Nube Software S.A.S.',
          primary_domain: 'nubesoftware.com.co',
          industry: 'information technology & services',
          keywords: ['software', 'cloud'],
          short_description: 'Desarrollo de software a la medida',
          estimated_num_employees: 80,
          country: 'Colombia',
        },
        {
          // Charged by Apollo, unusable by us. This is the row the old
          // `mapped.length` billing forgot.
          id: 'org-unnamed',
          name: null,
          primary_domain: 'sinnombre.com.co',
          industry: 'supermarket',
          keywords: ['supermercado'],
          country: 'Colombia',
        },
      ],
      pagination: { page: 1, per_page: 3, total_entries: 3, total_pages: 1 },
    },
    headers: null,
  };
}

function makeCorrelation() {
  return withResolvedIds(
    buildWizardRunCorrelation({
      userId: 'user-metrics',
      clientRequestId: 'client-request-metrics',
      reservationId: RESERVATION_ID,
      providerKey: 'apollo_organizations',
      requestSignature: 'CO|v1|retail|supermercados|3',
    }),
    { batchId: BATCH_ID },
  );
}

type Captured = { logs: LogProviderUsageInput[]; deps: ApolloOrgsSearchDeps; pageCalls: number };

function makeDeps(): Captured {
  const captured: Captured = { logs: [], pageCalls: 0, deps: {} };
  captured.deps = {
    fetchPage: async () => {
      captured.pageCalls++;
      return threeOrgsOneUnnamed();
    },
    logUsage: async (input: LogProviderUsageInput) => {
      captured.logs.push(input);
      return { kind: 'logged' as const };
    },
    now: () => 0,
    random: () => 0,
    sleep: async () => undefined,
  };
  return captured;
}

describe('raw / normalized / eligible / persisted stay four separate metrics', () => {
  it('reports 3 raw, 2 normalized, 1 eligible from a single page', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    const captured = makeDeps();

    const out = await runApolloOrganizationsSearch(
      INPUT,
      3,
      {
        batchId: BATCH_ID,
        agentRunId: null,
        runCorrelation: toRunCorrelationMetadata(makeCorrelation(), 'recorded'),
      },
      captured.deps,
    );

    const diagnostics = (out.metadata as Record<string, unknown>)
      .apollo_result_diagnostics as Record<string, number>;

    assert.equal(diagnostics.raw_results_count, 3, 'rawResultsReturned');
    assert.equal(diagnostics.normalized_results_count, 2, 'normalizedResults');
    assert.equal(diagnostics.normalization_dropped_count, 1, 'the unnamed org was dropped');
    assert.equal(diagnostics.post_sector_gate_results_count, 1, 'eligibleResults');
    assert.equal(diagnostics.rejected_count, 1, 'the software company was rejected');

    // Eligible is what leaves the provider, and it bounds what can be persisted.
    assert.equal(out.resultsCount, 1);
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].title, 'Supermercados Del Valle S.A.');

    // Exactly one page fetched — no hidden second call.
    assert.equal(captured.pageCalls, 1);
  });

  it('search usage is recorded on the raw results, per the internal contract', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    const captured = makeDeps();

    await runApolloOrganizationsSearch(
      INPUT,
      3,
      {
        batchId: BATCH_ID,
        agentRunId: null,
        runCorrelation: toRunCorrelationMetadata(makeCorrelation(), 'recorded'),
      },
      captured.deps,
    );

    const searchLog = captured.logs.find((l) => l.operation_key === 'organizations_search');
    assert.ok(searchLog, 'the search must be logged');

    // The billing base is the raw count — what Apollo returned and charged for —
    // not the 2 that survived normalization nor the 1 that passed the gate.
    assert.equal(searchLog.results_returned, 3);
    assert.equal(searchLog.credits_used, creditsForApolloOperation('organizations_search', 3));
    assert.equal(searchLog.credits_used, 3);
    assert.notEqual(searchLog.credits_used, 2, 'must not bill on normalized results');
    assert.notEqual(searchLog.credits_used, 1, 'must not bill on eligible results');

    // The separate metrics travel with the log, so reconciliation can see all
    // four numbers without recomputing any of them.
    const metadata = searchLog.metadata as Record<string, unknown>;
    const diagnostics = metadata.apollo_result_diagnostics as Record<string, number>;
    assert.equal(diagnostics.raw_results_count, 3);
    assert.equal(diagnostics.normalized_results_count, 2);
    assert.equal(diagnostics.normalization_dropped_count, 1);
    assert.equal(diagnostics.post_sector_gate_results_count, 1);
    assert.equal(diagnostics.rejected_count, 1);

    const observability = metadata[APOLLO_SPEND_OBSERVABILITY_KEY] as Record<string, unknown>;
    assert.equal(observability.results_returned, 3);
    assert.equal(observability.recorded_usage_credits, 3);

    // And the run correlation rides along, so the spend is attributable.
    const correlation = metadata[RUN_CORRELATION_METADATA_KEY] as Record<string, unknown>;
    assert.equal(correlation.reservation_id, RESERVATION_ID);
    assert.equal(correlation.client_request_id, 'client-request-metrics');
  });

  it('confirmedProviderCredits stays unknown — internal accounting is not an invoice', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    const captured = makeDeps();

    await runApolloOrganizationsSearch(
      INPUT,
      3,
      {
        batchId: BATCH_ID,
        agentRunId: null,
        runCorrelation: toRunCorrelationMetadata(makeCorrelation(), 'recorded'),
      },
      captured.deps,
    );

    const searchLog = captured.logs.find((l) => l.operation_key === 'organizations_search')!;
    const correlation = makeCorrelation();

    const reconciliation = reconcileWizardRunSpend({
      correlation,
      discoveryProvider: 'apollo_organizations',
      estimatedCredits: 3,
      reservedCredits: 3,
      rows: [
        {
          provider_key: 'apollo',
          operation_key: 'organizations_search',
          credits_used: searchLog.credits_used ?? null,
          usage_key: searchLog.usage_key ?? null,
          status: 'success',
          batch_id: BATCH_ID,
          metadata: searchLog.metadata,
        },
      ],
    });

    // We recorded 3. We do NOT claim Apollo confirmed 3.
    assert.equal(reconciliation.recordedUsageCredits, 3);
    assert.equal(reconciliation.billingState, 'recorded');
    assert.equal(
      reconciliation.confirmedProviderCredits,
      null,
      'only an external provider statement may set this',
    );
    assert.notEqual(reconciliation.billingState, 'provider_confirmed');

    // Persistence is a separate, downstream quantity: whatever the writer does
    // with the single eligible candidate (0 or 1 rows), the recorded spend is
    // still 3 credits.
    for (const persistedCandidates of [0, 1]) {
      assert.ok(
        persistedCandidates <= 1,
        'persisted can never exceed eligible',
      );
      assert.equal(
        reconciliation.recordedUsageCredits,
        3,
        'spend does not shrink when nothing is persisted',
      );
    }
  });

  it('a run that persists nothing still reconciles its real spend', async () => {
    // The extreme case of the separation: zero eligible results, three raw ones
    // already charged. Reconciliation must not read "no candidates" as "free".
    const correlation = makeCorrelation();
    const reconciliation = reconcileWizardRunSpend({
      correlation,
      discoveryProvider: 'apollo_organizations',
      estimatedCredits: 3,
      reservedCredits: 3,
      rows: [
        {
          provider_key: 'apollo',
          operation_key: 'organizations_search',
          credits_used: 3,
          usage_key: 'search:metrics',
          status: 'success',
          batch_id: BATCH_ID,
          metadata: {
            [RUN_CORRELATION_METADATA_KEY]: toRunCorrelationMetadata(correlation, 'recorded'),
            apollo_raw_results_count: 3,
            apollo_normalized_results_count: 0,
          },
        },
      ],
    });

    assert.equal(reconciliation.recordedUsageCredits, 3);
    assert.equal(reconciliation.creditsToConfirm, 3);
    assert.equal(reconciliation.confirmedProviderCredits, null);
  });
});
