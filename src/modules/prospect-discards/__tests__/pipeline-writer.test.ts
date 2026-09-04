// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — pipeline-writer tests.
//
// Covers: Test A (persistence), Test B (each reason bucket reaches a row),
// Test C (idempotent upsert — same source_key never duplicates), Test F/K
// (zero provider calls — the fake client below is the ENTIRE Supabase
// surface reachable; nothing else is imported), and the "never throws"
// contract (a DB failure must not propagate).
//
// `@supabase/supabase-js` is replaced with a fake client that only records
// what `.upsert()` was called with — no network, no real Supabase, no
// Apollo/Lusha/Tavily/HubSpot import anywhere in this file or the module
// under test.
//
// Run: node --import tsx --experimental-test-module-mocks --test <this file>

import { describe, it, mock, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import type { persistApolloRejectedDispositions as PersistFn } from '../pipeline-writer.server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';

interface UpsertCall {
  table: string;
  payload: Record<string, unknown>[];
  options: { onConflict?: string; ignoreDuplicates?: boolean };
}

let upsertCalls: UpsertCall[] = [];
let upsertShouldFail = false;

function resetSpy(): void {
  upsertCalls = [];
  upsertShouldFail = false;
}

mock.module('@supabase/supabase-js', {
  namedExports: {
    createClient: () => ({
      from: (table: string) => ({
        upsert: (payload: Record<string, unknown>[], options: Record<string, unknown>) => {
          upsertCalls.push({ table, payload, options });
          return {
            select: () =>
              upsertShouldFail
                ? Promise.resolve({ data: null, error: { message: 'simulated DB failure' } })
                : Promise.resolve({ data: payload.map((_, i) => ({ id: `row-${i}` })), error: null }),
          };
        },
      }),
    }),
  },
});

let persistApolloRejectedDispositions: typeof PersistFn;
before(async () => {
  ({ persistApolloRejectedDispositions } = await import('../pipeline-writer.server'));
});

const BASE_INPUT = {
  batchId: 'batch-1',
  requestedCountryCode: 'CO',
  requestedIndustry: 'Tecnología',
  sourcePrimary: 'apollo' as const,
};

describe('persistApolloRejectedDispositions', () => {
  beforeEach(resetSpy);

  it('persists one row per terminal rejection with a usable name (Test A/B)', async () => {
    const result = await persistApolloRejectedDispositions({
      ...BASE_INPUT,
      evaluatedCandidates: [
        { candidateKey: 'k1', identity: { providerOrganizationId: 'p1', normalizedDomain: 'acme.com', canonicalName: 'Acme' } },
        { candidateKey: 'k2', identity: { providerOrganizationId: 'p2', normalizedDomain: null, canonicalName: 'Beta SAS' } },
        { candidateKey: 'k3', identity: { providerOrganizationId: null, normalizedDomain: null, canonicalName: null } },
      ],
      finalDispositions: [
        { candidateKey: 'k1', roundNumber: 1, finalDisposition: 'country_rejected_final', finalReason: 'country_incompatible' },
        { candidateKey: 'k2', roundNumber: 1, finalDisposition: 'enrichment_budget_exhausted_final', finalReason: null },
        // k3 has no name → must be skipped, never inserted with an empty name.
        { candidateKey: 'k3', roundNumber: 2, finalDisposition: 'sector_subindustry_rejected_final', finalReason: 'sector_not_mapped' },
        // Not a rejection at all → must never reach the table.
        { candidateKey: 'k1', roundNumber: 1, finalDisposition: 'persisted_review_only_final', finalReason: null },
      ],
    });

    assert.equal(result.attempted, 2);
    assert.equal(result.persisted, 2);
    assert.equal(result.failed, 0);
    assert.equal(upsertCalls.length, 1);
    assert.equal(upsertCalls[0].table, 'prospect_discarded_dispositions');
    assert.equal(upsertCalls[0].payload.length, 2);

    const [row1, row2] = upsertCalls[0].payload;
    assert.equal(row1.name, 'Acme');
    assert.equal(row1.disposition, 'country_rejected');
    assert.equal(row1.source_key, 'domain:acme.com');
    assert.equal(row2.name, 'Beta SAS');
    assert.equal(row2.disposition, 'enrichment_budget_exhausted');
  });

  it('upserts with the batch_id+source_key conflict target (idempotency, Test C)', async () => {
    await persistApolloRejectedDispositions({
      ...BASE_INPUT,
      evaluatedCandidates: [
        { candidateKey: 'k1', identity: { providerOrganizationId: null, normalizedDomain: 'acme.com', canonicalName: 'Acme' } },
      ],
      finalDispositions: [
        { candidateKey: 'k1', roundNumber: 1, finalDisposition: 'country_rejected_final', finalReason: null },
      ],
    });
    assert.equal(upsertCalls[0].options.onConflict, 'batch_id,source_key');
    assert.equal(upsertCalls[0].options.ignoreDuplicates, false);
  });

  it('never throws when the DB write fails — reports the failure instead (non-critical contract)', async () => {
    upsertShouldFail = true;
    const result = await persistApolloRejectedDispositions({
      ...BASE_INPUT,
      evaluatedCandidates: [
        { candidateKey: 'k1', identity: { providerOrganizationId: null, normalizedDomain: 'acme.com', canonicalName: 'Acme' } },
      ],
      finalDispositions: [
        { candidateKey: 'k1', roundNumber: 1, finalDisposition: 'country_rejected_final', finalReason: null },
      ],
    });
    assert.equal(result.failed, 1);
    assert.equal(result.persisted, 0);
    assert.ok(result.errors.length > 0);
  });

  it('is a no-op (zero upserts) when there are no rejections to persist', async () => {
    const result = await persistApolloRejectedDispositions({
      ...BASE_INPUT,
      evaluatedCandidates: [],
      finalDispositions: [],
    });
    assert.equal(result.attempted, 0);
    assert.equal(upsertCalls.length, 0);
  });

  it('makes no network/provider call of any kind — the fake client is the entire reachable surface (Test F/K)', async () => {
    // The mocked module above is the ONLY Supabase surface this function can
    // reach; there is no fetch/http import anywhere in pipeline-writer.server.ts
    // (verified structurally by no-provider-calls-static.test.ts). This test
    // exercises the full happy path once more to prove it completes without
    // needing anything beyond the fake `.from().upsert().select()` chain.
    const result = await persistApolloRejectedDispositions({
      ...BASE_INPUT,
      evaluatedCandidates: [
        { candidateKey: 'k1', identity: { providerOrganizationId: null, normalizedDomain: 'acme.com', canonicalName: 'Acme' } },
      ],
      finalDispositions: [
        { candidateKey: 'k1', roundNumber: 1, finalDisposition: 'hubspot_duplicate_final', finalReason: null },
      ],
    });
    assert.equal(result.persisted, 1);
  });
});
