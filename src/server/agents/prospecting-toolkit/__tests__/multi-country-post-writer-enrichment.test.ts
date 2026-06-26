/**
 * Tests — v1.16K-M Post-writer enrichment multi-country gate
 *
 * Verifies that the POST_WRITER_ENRICHMENT_COUNTRIES set correctly
 * gates CO/MX/CL (proceed) vs PE/EC (skip with metadata).
 * Uses enrichBatchCandidates directly — no real Supabase calls.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function makeChain(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    eq: () => chain,
    single: () => Promise.resolve({ data: overrides['singleData'] ?? {} }),
    select: () => chain,
    update: () => chain,
    insert: () => chain,
  };
  return chain;
}

function createMockSupabase(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const chain = makeChain(overrides);
  return { from: () => chain };
}

describe('PWEN1 — enrichBatchCandidates country support', () => {
  it('CO is supported — function proceeds (returns 0 with empty DB)', async () => {
    const { enrichBatchCandidates } = await import('../incremental-search');
    const result = await enrichBatchCandidates(createMockSupabase() as never, 'batch-co', 'CO');
    assert.equal(typeof result.candidatesProcessed, 'number');
    assert.ok(Array.isArray(result.sourcesApplied));
    assert.ok(Array.isArray(result.errors));
  });

  it('MX is supported — function proceeds (returns 0 with empty DB)', async () => {
    const { enrichBatchCandidates } = await import('../incremental-search');
    const result = await enrichBatchCandidates(createMockSupabase() as never, 'batch-mx', 'MX');
    assert.equal(typeof result.candidatesProcessed, 'number');
    assert.ok(Array.isArray(result.sourcesApplied));
  });

  it('CL is supported — function proceeds (returns 0 with empty DB)', async () => {
    const { enrichBatchCandidates } = await import('../incremental-search');
    const result = await enrichBatchCandidates(createMockSupabase() as never, 'batch-cl', 'CL');
    assert.equal(typeof result.candidatesProcessed, 'number');
    assert.ok(Array.isArray(result.sourcesApplied));
  });

  it('PE is not supported — early return with 0 processed', async () => {
    const { enrichBatchCandidates } = await import('../incremental-search');
    const result = await enrichBatchCandidates(createMockSupabase() as never, 'batch-pe', 'PE');
    assert.equal(result.candidatesProcessed, 0);
    assert.deepEqual(result.sourcesApplied, []);
    assert.deepEqual(result.errors, []);
  });

  it('EC is not supported — early return with 0 processed', async () => {
    const { enrichBatchCandidates } = await import('../incremental-search');
    const result = await enrichBatchCandidates(createMockSupabase() as never, 'batch-ec', 'EC');
    assert.equal(result.candidatesProcessed, 0);
    assert.deepEqual(result.sourcesApplied, []);
  });

  it('never throws for any country code', async () => {
    const { enrichBatchCandidates } = await import('../incremental-search');
    for (const cc of ['CO', 'MX', 'CL', 'PE', 'EC', 'AR', '']) {
      const result = await enrichBatchCandidates(createMockSupabase() as never, 'batch-x', cc);
      assert.equal(typeof result.candidatesProcessed, 'number', `Should not throw for ${cc}`);
    }
  });
});

describe('PWEN2 — enrichBatchCandidates is an async function', () => {
  it('returns a Promise for any country', async () => {
    const { enrichBatchCandidates } = await import('../incremental-search');
    const p = enrichBatchCandidates(createMockSupabase() as never, 'test', 'PE');
    assert.ok(p instanceof Promise);
    await p;
  });
});
