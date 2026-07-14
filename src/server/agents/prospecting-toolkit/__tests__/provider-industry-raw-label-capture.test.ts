// Tests — Provider Industry Raw Label Observation Capture (Q3F-5AU.5)
//
// Full dependency injection (no DB, no network, no Apollo/Lusha/Tavily, no
// AI). Verifies no-labels/client-unavailable short-circuits, RPC payload
// shape, RPC result-status translation, source-context minimization, and
// the module's import boundary (no provider/mapping-lifecycle/candidate-
// writer coupling).

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  captureProviderIndustryRawLabelObservations,
  minimizeProviderIndustrySourceContext,
  type CaptureProviderIndustryRawLabelObservationsDeps,
} from '../provider-industry-raw-label-capture';

const MODULE_PATH = join(
  process.cwd(),
  'src/server/agents/prospecting-toolkit/provider-industry-raw-label-capture.ts',
);
const MODULE_SOURCE = readFileSync(MODULE_PATH, 'utf-8');

// Import-only view of the module (excludes the file's own header/doc
// comments, which legitimately name things like "the candidate writer" or
// "mapping draft/snapshot lifecycle" in prose to document what this file
// must NOT do — a bare substring check against the full source would
// false-positive on that required documentation).
const IMPORT_STATEMENTS = MODULE_SOURCE
  .split('\n')
  .filter((line) => /^\s*import\b/.test(line))
  .join('\n');

type RpcCallParams = Parameters<NonNullable<CaptureProviderIndustryRawLabelObservationsDeps['callRpc']>>[0];

function depsFixture(
  overrides: Partial<CaptureProviderIndustryRawLabelObservationsDeps> = {},
): { deps: CaptureProviderIndustryRawLabelObservationsDeps; rpcCalls: RpcCallParams[] } {
  const rpcCalls: RpcCallParams[] = [];
  const deps: CaptureProviderIndustryRawLabelObservationsDeps = {
    callRpc: async (params) => {
      rpcCalls.push(params);
      return {
        data: {
          success: true,
          inserted_count: 1,
          updated_count: 0,
          skipped_count: 0,
          observed_count_delta: 1,
          error_code: null,
        },
        error: null,
      };
    },
    ...overrides,
  };
  return { deps, rpcCalls };
}

describe('captureProviderIndustryRawLabelObservations', () => {
  it('T1: labels empty → skipped no_labels, RPC never called', async () => {
    const { deps, rpcCalls } = depsFixture();

    const result = await captureProviderIndustryRawLabelObservations(
      {
        sourceVocabularyKey: 'apollo_organization_industry',
        providerKey: 'apollo',
        operationKey: 'apollo/organizations',
        labels: [],
      },
      deps,
    );

    assert.deepEqual(result, { status: 'skipped', reason: 'no_labels' });
    assert.equal(rpcCalls.length, 0);
  });

  it('T2: client unavailable → skipped client_unavailable', async () => {
    const deps: CaptureProviderIndustryRawLabelObservationsDeps = {
      callRpc: async () => 'client_unavailable',
    };

    const result = await captureProviderIndustryRawLabelObservations(
      {
        sourceVocabularyKey: 'apollo_organization_industry',
        providerKey: 'apollo',
        operationKey: 'apollo/organizations',
        labels: [{ rawLabel: 'Banking', normalizedLookupKey: 'banking' }],
      },
      deps,
    );

    assert.deepEqual(result, { status: 'skipped', reason: 'client_unavailable' });
  });

  it('T3: banking label calls the RPC with the correct payload', async () => {
    const { deps, rpcCalls } = depsFixture();

    await captureProviderIndustryRawLabelObservations(
      {
        sourceVocabularyKey: 'apollo_organization_industry',
        providerKey: 'apollo',
        operationKey: 'apollo/organizations',
        labels: [{ rawLabel: 'Banking', normalizedLookupKey: 'banking' }],
        countryCode: 'CO',
        requestedIndustry: 'Financial Services',
        agentRunId: 'run-1',
      },
      deps,
    );

    assert.equal(rpcCalls.length, 1);
    assert.deepEqual(rpcCalls[0].observations, [{ raw_label: 'Banking', normalized_lookup_key: 'banking' }]);
    assert.equal(rpcCalls[0].sourceVocabularyKey, 'apollo_organization_industry');
    assert.equal(rpcCalls[0].providerKey, 'apollo');
    assert.equal(rpcCalls[0].operationKey, 'apollo/organizations');
    assert.equal(rpcCalls[0].countryCode, 'CO');
    assert.equal(rpcCalls[0].requestedIndustry, 'Financial Services');
    assert.equal(rpcCalls[0].agentRunId, 'run-1');
  });

  it('T4: e-learning label calls the RPC with the correct payload', async () => {
    const { deps, rpcCalls } = depsFixture();

    await captureProviderIndustryRawLabelObservations(
      {
        sourceVocabularyKey: 'apollo_organization_industry',
        providerKey: 'apollo',
        operationKey: 'apollo/organizations',
        labels: [{ rawLabel: 'E-Learning', normalizedLookupKey: 'e learning' }],
      },
      deps,
    );

    assert.equal(rpcCalls.length, 1);
    assert.deepEqual(rpcCalls[0].observations, [
      { raw_label: 'E-Learning', normalized_lookup_key: 'e learning' },
    ]);
  });

  it('T5: RPC success=true translates capturedCount/insertedCount/updatedCount/skippedCount', async () => {
    const deps: CaptureProviderIndustryRawLabelObservationsDeps = {
      callRpc: async () => ({
        data: {
          success: true,
          inserted_count: 2,
          updated_count: 3,
          skipped_count: 1,
          observed_count_delta: 5,
          error_code: null,
        },
        error: null,
      }),
    };

    const result = await captureProviderIndustryRawLabelObservations(
      {
        sourceVocabularyKey: 'apollo_organization_industry',
        providerKey: 'apollo',
        operationKey: 'apollo/organizations',
        labels: [{ rawLabel: 'Banking', normalizedLookupKey: 'banking' }],
      },
      deps,
    );

    assert.deepEqual(result, {
      status: 'captured',
      capturedCount: 5,
      insertedCount: 2,
      updatedCount: 3,
      skippedCount: 1,
    });
  });

  it('T6: RPC success=false with error_code translates to failed', async () => {
    const deps: CaptureProviderIndustryRawLabelObservationsDeps = {
      callRpc: async () => ({
        data: {
          success: false,
          inserted_count: 0,
          updated_count: 0,
          skipped_count: 0,
          observed_count_delta: 0,
          error_code: 'invalid_observations_shape',
        },
        error: null,
      }),
    };

    const result = await captureProviderIndustryRawLabelObservations(
      {
        sourceVocabularyKey: 'apollo_organization_industry',
        providerKey: 'apollo',
        operationKey: 'apollo/organizations',
        labels: [{ rawLabel: 'Banking', normalizedLookupKey: 'banking' }],
      },
      deps,
    );

    assert.deepEqual(result, { status: 'failed', errorCode: 'invalid_observations_shape' });
  });

  it('T7: RPC throws → failed, never throws outward', async () => {
    const deps: CaptureProviderIndustryRawLabelObservationsDeps = {
      callRpc: async () => {
        throw new Error('network exploded');
      },
    };

    await assert.doesNotReject(async () => {
      const result = await captureProviderIndustryRawLabelObservations(
        {
          sourceVocabularyKey: 'apollo_organization_industry',
          providerKey: 'apollo',
          operationKey: 'apollo/organizations',
          labels: [{ rawLabel: 'Banking', normalizedLookupKey: 'banking' }],
        },
        deps,
      );
      assert.equal(result.status, 'failed');
    });
  });

  it('T8: sourceContext is minimized — no raw provider payload, no email/phone/LinkedIn leaks through', async () => {
    const { deps, rpcCalls } = depsFixture();

    await captureProviderIndustryRawLabelObservations(
      {
        sourceVocabularyKey: 'apollo_organization_industry',
        providerKey: 'apollo',
        operationKey: 'apollo/organizations',
        labels: [{ rawLabel: 'Banking', normalizedLookupKey: 'banking' }],
        sourceContext: {
          queryShape: 'organizations_search_by_domain',
          resultCount: 12,
          contactEmail: 'someone@example.com',
          linkedinUrl: 'https://linkedin.com/in/someone',
          rawApolloResponse: { organizations: [{ id: 1, name: 'Acme' }] },
          personPhone: '+1 555-123-4567',
        },
      },
      deps,
    );

    assert.equal(rpcCalls.length, 1);
    const sentContext = rpcCalls[0].sourceContext;
    assert.deepEqual(sentContext, { queryShape: 'organizations_search_by_domain', resultCount: 12 });
    assert.ok(!('contactEmail' in sentContext));
    assert.ok(!('linkedinUrl' in sentContext));
    assert.ok(!('rawApolloResponse' in sentContext));
    assert.ok(!('personPhone' in sentContext));
    assert.equal(JSON.stringify(sentContext).includes('@'), false);
    assert.equal(JSON.stringify(sentContext).includes('linkedin.com'), false);
  });

  it('minimizeProviderIndustrySourceContext drops disallowed keys entirely', () => {
    const minimized = minimizeProviderIndustrySourceContext({
      queryShape: 'x',
      email: 'a@b.com',
      requestId: 'req-1',
      notes: 'call +1 555-000-1111 about this',
    });
    assert.deepEqual(minimized, { queryShape: 'x', requestId: 'req-1' });
  });

  it('minimizeProviderIndustrySourceContext drops PII-shaped scalar values even on an allowed key', () => {
    const minimized = minimizeProviderIndustrySourceContext({
      queryShape: 'contact a@b.com about this',
      requestId: 'req-1',
    });
    assert.deepEqual(minimized, { requestId: 'req-1' });
  });

  it('T9: does not import Apollo/provider-HTTP client or fetch', () => {
    assert.ok(!/from\s+['"].*apollo.*['"]/i.test(IMPORT_STATEMENTS));
    assert.ok(!/from\s+['"].*lusha.*['"]/i.test(IMPORT_STATEMENTS));
    assert.ok(!/from\s+['"].*tavily.*['"]/i.test(IMPORT_STATEMENTS));
    assert.ok(!/\bfetch\s*\(/.test(MODULE_SOURCE));
    assert.ok(!/node-fetch|axios/i.test(IMPORT_STATEMENTS));
  });

  it('T10: does not import mapping draft/snapshot/association/publication lifecycle modules', () => {
    for (const marker of ['mapping-draft', 'mapping-publication', 'snapshot-service', 'association-service']) {
      assert.ok(!IMPORT_STATEMENTS.toLowerCase().includes(marker), `must not import "${marker}"`);
    }
  });

  it('T11: does not import the candidate writer', () => {
    assert.ok(!/candidate.writer/i.test(IMPORT_STATEMENTS));
  });

  it('T12: the result type carries no candidate/status/ranking fields', () => {
    const resultKeySets = [
      ['status', 'capturedCount', 'insertedCount', 'updatedCount', 'skippedCount'],
      ['status', 'reason'],
      ['status', 'errorCode'],
    ];
    const forbidden = ['candidateId', 'candidateStatus', 'ranking', 'score'];
    for (const keys of resultKeySets) {
      for (const key of keys) {
        assert.ok(!forbidden.includes(key));
      }
    }
  });
});
