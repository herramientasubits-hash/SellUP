/**
 * Tests — v1.16K-M / Perú.9O / Chile.2 / México.2B / Centroamérica.4F Post-approval enrichment trigger country guard
 *
 * Verifies that triggerPostApprovalEnrichment:
 * - Returns skipped + country_not_supported for unsupported countries (EC)
 * - Queues MX candidates with empty source_keys even without RFC (DENUE uses name context)
 * - Queues CL candidates with empty source_keys (ChileCompra OCDS runs in worker directly)
 * - Queues PE candidates with empty source_keys (SUNAT+Migo run in worker directly)
 * - Still proceeds normally for CO candidates (queued when NIT present)
 * - Never queues CO-specific source keys for PE, CL, or MX candidates
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

describe('PATCG1 — country guard skips unsupported countries', () => {
  it('EC → status skipped, reason country_not_supported', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('EC', '1234567890001'));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'country_not_supported_for_post_approval_source_enrichment');
  });

  it('null country → skipped (not supported)', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams(null));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'country_not_supported_for_post_approval_source_enrichment');
  });
});

describe('PATCG1C — CL candidates queue with ChileCompra OCDS enrichment (Chile.2)', () => {
  it('CL with RUT → triggered=true, status=queued', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CL', '12345678-9'));
    assert.equal(result.triggered, true);
    assert.equal(result.meta.status, 'queued');
    assert.equal(result.meta.nit, '12345678-9');
  });

  it('CL with RUT → source_keys empty (ChileCompra OCDS runs in worker directly)', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CL', '12345678-9'));
    assert.ok(Array.isArray(result.meta.source_keys));
    assert.equal(result.meta.source_keys!.length, 0, 'CL source_keys must be empty — ChileCompra OCDS step runs in worker directly');
  });

  it('CL without RUT → triggered=false, status=skipped, reason=missing_tax_id', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CL'));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'missing_tax_id');
  });

  it('CL does not queue CO-specific source keys', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CL', '12345678-9'));
    const keys = result.meta.source_keys ?? [];
    assert.ok(!keys.some(k => k.startsWith('co_')), 'CL must not include CO source keys');
  });
});

describe('PATCG1B — PE candidates queue with SUNAT enrichment', () => {
  it('PE with RUC → triggered=true, status=queued', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('PE', '20615264335'));
    assert.equal(result.triggered, true);
    assert.equal(result.meta.status, 'queued');
    assert.equal(result.meta.nit, '20615264335');
  });

  it('PE with RUC → source_keys empty (no CO adapters for PE)', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('PE', '20615264335'));
    assert.ok(Array.isArray(result.meta.source_keys));
    assert.equal(result.meta.source_keys!.length, 0, 'PE source_keys must be empty — SUNAT+Migo run in worker directly');
  });

  it('PE without RUC → triggered=false, status=skipped, reason=missing_tax_id', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('PE'));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'missing_tax_id');
  });
});

describe('PATCG1D — MX candidates queue via name context (México.2B)', () => {
  it('MX with RFC → triggered=true, status=queued', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('MX', 'OXXO-RFC'));
    assert.equal(result.triggered, true);
    assert.equal(result.meta.status, 'queued');
  });

  it('MX without RFC → triggered=true, status=queued (DENUE uses name context)', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('MX'));
    assert.equal(result.triggered, true);
    assert.equal(result.meta.status, 'queued');
    assert.equal(result.meta.reason, undefined, 'MX queues without RFC — no missing_tax_id reason');
  });

  it('MX → source_keys empty (DENUE runs in worker directly)', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('MX'));
    assert.ok(Array.isArray(result.meta.source_keys));
    assert.equal(result.meta.source_keys!.length, 0, 'MX source_keys must be empty — DENUE step runs in worker directly');
  });

  it('MX does not queue CO-specific source keys', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('MX', 'RFC-123'));
    const keys = result.meta.source_keys ?? [];
    assert.ok(!keys.some(k => k.startsWith('co_')), 'MX must not include CO source keys');
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

describe('PATCG1E — CR candidates queue with SICOP enrichment (Centroamérica.4F)', () => {
  it('CR with cédula jurídica → triggered=true, status=queued', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CR', '3101123456'));
    assert.equal(result.triggered, true);
    assert.equal(result.meta.status, 'queued');
    assert.equal(result.meta.nit, '3101123456');
  });

  it('CR with cédula → source_keys empty (cr_sicop runs in worker directly)', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CR', '3101123456'));
    assert.ok(Array.isArray(result.meta.source_keys));
    assert.equal(result.meta.source_keys!.length, 0, 'CR source_keys must be empty — cr_sicop step runs in worker directly');
  });

  it('CR without cédula → triggered=false, status=skipped, reason=missing_tax_id', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CR'));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'missing_tax_id');
  });

  it('CR does not queue CO-specific source keys', async () => {
    const result = await triggerPostApprovalEnrichment(makeParams('CR', '3101123456'));
    const keys = result.meta.source_keys ?? [];
    assert.ok(!keys.some((k: string) => k.startsWith('co_')), 'CR must not include CO source keys');
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
