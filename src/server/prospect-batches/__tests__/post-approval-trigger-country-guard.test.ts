/**
 * Tests — v1.16K-M Post-approval enrichment trigger country guard
 *
 * Verifies that triggerPostApprovalEnrichment:
 * - Returns skipped + country_not_supported for non-CO candidates (MX, CL, PE, EC)
 * - Still proceeds normally for CO candidates (queued when NIT present)
 * - Never queues CO-specific source keys for non-CO countries
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  triggerPostApprovalEnrichment,
  extractNitFromCandidate,
  planNitFirstSourceKeys,
} from '../post-approval-enrichment-trigger';

function makeSupabase(): Record<string, unknown> {
  // All methods return chain so `.eq()` can be called after `.update()/.insert()`.
  // When awaited, a non-thenable object resolves to itself — simulating success.
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    eq: () => chain,
    single: () => Promise.resolve({ data: { metadata: {} }, error: null }),
    select: () => chain,
    update: () => chain,
    insert: () => chain,
  });
  return { from: () => chain };
}

function makeParams(countryCode: string | null, taxId?: string) {
  return {
    candidate: {
      country_code: countryCode,
      tax_identifier: taxId ?? null,
    },
    candidateId: 'cand-1',
    batchId: 'batch-1',
    accountId: 'acct-1',
    internalUserId: 'user-1',
    supabase: makeSupabase() as never,
  };
}

describe('PATCG1 — country guard skips non-CO candidates', () => {
  it('MX → status skipped, reason country_not_supported', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('MX', 'SOME-RFC'));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'country_not_supported_for_post_approval_source_enrichment');
  });

  it('CL → status skipped, reason country_not_supported', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CL', '12345678-9'));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'country_not_supported_for_post_approval_source_enrichment');
  });

  it('PE → status skipped, reason country_not_supported', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('PE', '20123456789'));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'country_not_supported_for_post_approval_source_enrichment');
  });

  it('EC → status skipped, reason country_not_supported', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('EC', '1234567890001'));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'country_not_supported_for_post_approval_source_enrichment');
  });

  it('null country → skipped (not CO)', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams(null));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'country_not_supported_for_post_approval_source_enrichment');
  });
});

describe('PATCG2 — CO candidates still proceed normally', () => {
  it('CO with NIT → triggered=true, status=queued', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CO', '900123456-7'));
    assert.equal(result.triggered, true);
    assert.equal(result.meta.status, 'queued');
  });

  it('CO without NIT → triggered=false, status=skipped, reason=missing_tax_id', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CO'));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'missing_tax_id');
  });

  it('CO with NIT → source_keys are CO-specific', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CO', '900123456'));
    assert.ok(Array.isArray(result.meta.source_keys));
    assert.ok(result.meta.source_keys!.every(k => k.startsWith('co_')), 'All source keys should be CO-prefixed');
  });
});

describe('PATCG3 — helper function integrity', () => {
  it('extractNitFromCandidate finds tax_identifier field', () => {
    const nit = extractNitFromCandidate({ tax_identifier: '900123456' });
    assert.equal(nit, '900123456');
  });

  it('extractNitFromCandidate returns null for empty', () => {
    const nit = extractNitFromCandidate({ tax_identifier: '' });
    assert.equal(nit, null);
  });

  it('planNitFirstSourceKeys returns CO source keys', () => {
    const keys = planNitFirstSourceKeys();
    assert.ok(Array.isArray(keys));
    assert.ok(keys.length > 0);
    assert.ok(keys.every(k => typeof k === 'string'));
  });
});
