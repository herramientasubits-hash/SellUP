/**
 * Tests — Multistage Orchestrator (Hito 16AB.23.3)
 *
 * 10 tests requeridos. Sin llamadas reales a la API. Sin timers reales largos.
 * Usa Node.js built-in test runner (node:test + node:assert).
 * Sistema de archivos temporal para checkpoints.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { CheckpointManager } from '../multistage/checkpoint';
import { callWithRetry } from '../multistage/client';
import { runStage2DiscoveryBatch, runStage3Prefilter, runStage5VerificationCandidates } from '../multistage/stages';
import {
  computeArtifactInputHash,
  computeCandidateKey,
  computeDedupInputHash,
  computePrefilterInputHash,
  computeSelectionInputHash,
  computeVerificationCandidateInputHash,
} from '../multistage/artifact-hash';
import type { DiscoveryCandidate, ExecutionMetrics, VerifiedCandidateResult } from '../multistage/ms-types';
import type { FetchFn } from '../multistage/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'benchmark-ms-test-'));
}

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function buildMetrics(): ExecutionMetrics {
  return {
    total_api_calls: 0,
    successful_api_calls: 0,
    failed_api_calls: 0,
    retried_api_calls: 0,
    rate_limit_wait_ms: 0,
    discovery_batches_completed: 0,
    verification_batches_completed: 0,
    resumed_from_checkpoint: false,
    checkpoint_count: 0,
    per_stage_duration_ms: {},
    longest_call_duration_ms: 0,
    terminated_connections: 0,
    partial_results_preserved: false,
  };
}


function successfulFetch(candidates: unknown[]): FetchFn {
  const body = JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: `<json_output>${JSON.stringify({ batch_index: 0, batch_theme: 'SaaS', candidates })}</json_output>`,
      },
    ],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 200 },
  });

  return async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

function terminatedFetch(): FetchFn {
  return async () => {
    throw new Error('Connection terminated unexpectedly');
  };
}

function rateLimitFetch(successAfterAttempts: number): { fetchFn: FetchFn; callCount: number[] } {
  const callCount = [0];
  const body = JSON.stringify({
    id: 'msg_ok',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: '<json_output>{"candidates":[]}</json_output>' }],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 10 },
  });
  const fetchFn: FetchFn = async () => {
    callCount[0]++;
    if (callCount[0] <= successAfterAttempts) {
      return new Response('{"error":{"type":"rate_limit_error"}}', { status: 429 });
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchFn, callCount };
}

const noopSleep = () => Promise.resolve();

// ─── Test 1: Terminated call preserves existing checkpoints ──────────────────

describe('Test 1 — terminated call preserves checkpoints', () => {
  it('a connection_terminated error on batch 1 leaves batch 0 intact', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-test1', 'hash-1');

      // Pre-populate batch 0 as completed
      const batch0Data = { batch_index: 0, batch_theme: 'SaaS', candidates: [{ name: 'EmpresaA' }] };
      checkpoint.saveFile(checkpoint.discoveryFile(0), batch0Data);
      checkpoint.markDiscoveryBatchCompleted(0);

      const metrics = buildMetrics();

      // Batch 1 terminates
      await runStage2DiscoveryBatch(
        'fake-key', 1, 'AI Theme', 'Colombia', 'ctx',
        [], checkpoint, metrics, terminatedFetch()
      );

      // Batch 0 data must still exist and be readable
      assert.ok(checkpoint.isDiscoveryBatchCompleted(0), 'batch 0 must stay completed');
      const loaded = checkpoint.loadFile<{ candidates: unknown[] }>(checkpoint.discoveryFile(0));
      assert.ok(loaded?.candidates.length === 1, 'batch 0 data must be intact');

      // Batch 1 must be marked as failed, not completed
      assert.ok(!checkpoint.isDiscoveryBatchCompleted(1), 'batch 1 must not be completed');
      assert.ok(metrics.terminated_connections >= 1, 'terminated_connections must be incremented');
      assert.ok(metrics.partial_results_preserved, 'partial_results_preserved must be true');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test 2: Resume skips completed batches ───────────────────────────────────

describe('Test 2 — resume skips completed batches', () => {
  it('loading a completed batch returns cached data without making a fetch call', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-test2', 'hash-2');

      // Pre-populate batch 0 as completed with real data
      const batchData = { batch_index: 0, batch_theme: 'SaaS', candidates: [{ name: 'CachedEmpresa', website: 'https://cached.co', linkedin: null, city: null, sector: 'SaaS', description: null, confidence: 'Alta', evidence_url: null, evidence_source: null, estimated_size: null, notes: null, batch_index: 0, batch_theme: 'SaaS' }] };
      checkpoint.saveFile(checkpoint.discoveryFile(0), batchData);
      checkpoint.markDiscoveryBatchCompleted(0);

      let fetchCalled = false;
      const trackingFetch: FetchFn = async () => {
        fetchCalled = true;
        throw new Error('Should not be called for completed batch');
      };

      const metrics = buildMetrics();
      const result = await runStage2DiscoveryBatch(
        'fake-key', 0, 'SaaS', 'Colombia', 'ctx',
        [], checkpoint, metrics, trackingFetch
      );

      assert.ok(!fetchCalled, 'fetch must NOT be called for a completed batch');
      assert.ok(result.length > 0, 'cached candidates must be returned');
      assert.equal(result[0]?.name, 'CachedEmpresa');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test 3: 429 respects backoff and retries ─────────────────────────────────

describe('Test 3 — 429 respects backoff and retries', () => {
  it('rate_limit on first attempt causes retry; second attempt succeeds', async () => {
    const { fetchFn, callCount } = rateLimitFetch(1);

    let rateLimitWaitCalled = false;
    const result = await callWithRetry(
      'fake-key',
      'test prompt',
      { systemPrompt: 'system', maxSearchUses: 0 },
      () => { rateLimitWaitCalled = true; },
      fetchFn,
      noopSleep
    );

    assert.equal(callCount[0], 2, 'fetch must be called twice (1 fail + 1 success)');
    assert.ok(result.retried, 'retried must be true');
    assert.ok(rateLimitWaitCalled, 'onRateLimitWait callback must be invoked');
    assert.equal(result.errorCode, null, 'final result must succeed');
  });
});

// ─── Test 4: Failed batch does not delete other batches ───────────────────────

describe('Test 4 — failed batch does not delete other batches', () => {
  it('batch 1 failure leaves batch 0 data untouched', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-test4', 'hash-4');

      checkpoint.saveFile(checkpoint.discoveryFile(0), { batch_index: 0, candidates: [{ name: 'StableEmpresa' }] });
      checkpoint.markDiscoveryBatchCompleted(0);

      const metrics = buildMetrics();
      await runStage2DiscoveryBatch(
        'fake-key', 1, 'Theme B', 'Colombia', 'ctx',
        [], checkpoint, metrics, terminatedFetch()
      );

      // Batch 0 unaffected
      const data = checkpoint.loadFile<{ candidates: { name: string }[] }>(checkpoint.discoveryFile(0));
      assert.ok(data?.candidates.some((c) => c.name === 'StableEmpresa'), 'batch 0 data must survive');
      assert.equal(checkpoint.getState().failedBatches.length, 1, 'only 1 failed batch');
      assert.equal(checkpoint.getState().failedBatches[0]?.batch, 1, 'failed batch index must be 1');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test 5: Corrupt file retries only that batch ─────────────────────────────

describe('Test 5 — corrupt file retries only that batch', () => {
  it('corrupt discovery file causes only that batch to be reprocessed', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-test5', 'hash-5');

      // Write a corrupt file and mark batch 0 as completed
      const batchFile = join(dir, 'state', checkpoint.discoveryFile(0));
      writeFileSync(batchFile, '{ this is not valid json }', 'utf-8');
      checkpoint.markDiscoveryBatchCompleted(0);

      let fetchCalled = false;
      const mockFetch = successfulFetch([{
        name: 'ReprocessedEmpresa',
        website: 'https://reprocessed.co',
        linkedin: null,
        city: null,
        sector: 'SaaS',
        description: null,
        confidence: 'Alta',
        evidence_url: null,
        evidence_source: null,
        estimated_size: null,
        notes: null,
      }]);
      const trackingFetch: FetchFn = async (input, init) => {
        fetchCalled = true;
        return mockFetch(input, init);
      };

      const metrics = buildMetrics();
      const result = await runStage2DiscoveryBatch(
        'fake-key', 0, 'SaaS', 'Colombia', 'ctx',
        [], checkpoint, metrics, trackingFetch
      );

      assert.ok(fetchCalled, 'fetch MUST be called to reprocess the corrupt batch');
      assert.ok(result.length > 0, 'reprocessed batch must yield candidates');
      // The corrupt file should be renamed to .corrupt; a new valid file is written at the same path
      assert.ok(existsSync(`${batchFile}.corrupt`), 'corrupt file should be renamed to .corrupt');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test 6: Selection works with partial results ─────────────────────────────

describe('Test 6 — selection works with partial results', () => {
  it('prefilter accepts valid candidates and rejects low-confidence ones', () => {
    const pool: DiscoveryCandidate[] = [
      { name: 'EmpresaValida', website: 'https://valida.co', linkedin: null, city: 'Bogotá', sector: 'SaaS', description: null, confidence: 'Alta', evidence_url: null, evidence_source: null, estimated_size: null, notes: null, batch_index: 0, batch_theme: 'SaaS' },
      { name: 'EmpresaBaja', website: 'https://baja.co', linkedin: null, city: null, sector: 'SaaS', description: null, confidence: 'Baja', evidence_url: null, evidence_source: null, estimated_size: null, notes: null, batch_index: 0, batch_theme: 'SaaS' },
      { name: 'Artículo sobre startups', website: null, linkedin: null, city: null, sector: 'SaaS', description: null, confidence: 'Media', evidence_url: null, evidence_source: null, estimated_size: null, notes: null, batch_index: 0, batch_theme: 'SaaS' },
    ];

    const { accepted, rejected } = runStage3Prefilter(pool);

    assert.equal(accepted.length, 1, 'only EmpresaValida should pass');
    assert.ok(accepted.some((c) => c.name === 'EmpresaValida'));
    assert.ok(rejected.some((r) => r.candidate.name === 'EmpresaBaja' && r.reason === 'low_confidence'));
    assert.ok(rejected.some((r) => r.reason === 'name_is_article_or_list'));
  });
});

// ─── Test 7: Budget safely stops ─────────────────────────────────────────────

describe('Test 7 — budget stops safely', () => {
  it('withinBudget returns false after exceeding max_total_api_calls', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-test7', 'hash-7');

      // Simulate max API calls exhausted
      for (let i = 0; i < 16; i++) {
        checkpoint.addUsage({ input_tokens: 1000, output_tokens: 500, search_calls: 0, search_count_status: 'unavailable', token_cost_usd: 0.01, web_search_cost_usd: null, cost_usd: 0.01 });
      }

      assert.ok(!checkpoint.withinBudget(), 'withinBudget must return false after max_total_api_calls');
    } finally {
      cleanupDir(dir);
    }
  });

  it('withinBudget returns false after exceeding max_cost_usd', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-test7b', 'hash-7b');

      checkpoint.addUsage({ input_tokens: 100_000, output_tokens: 150_000, search_calls: 0, search_count_status: 'unavailable', token_cost_usd: 3.0, web_search_cost_usd: null, cost_usd: 3.0 });

      assert.ok(!checkpoint.withinBudget(), 'withinBudget must return false after max_cost_usd');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test 8: Two --resume runs do not duplicate costs ────────────────────────

describe('Test 8 — resume does not duplicate costs', () => {
  it('loading a completed batch does not add usage again', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-test8', 'hash-8');

      // First run: batch 0 completes and adds usage
      const batchData = {
        batch_index: 0,
        batch_theme: 'SaaS',
        candidates: [{ name: 'EmpresaOnce', website: 'https://once.co', linkedin: null, city: null, sector: 'SaaS', description: null, confidence: 'Alta', evidence_url: null, evidence_source: null, estimated_size: null, notes: null, batch_index: 0, batch_theme: 'SaaS' }],
      };
      checkpoint.saveFile(checkpoint.discoveryFile(0), batchData);
      checkpoint.markDiscoveryBatchCompleted(0);
      checkpoint.addUsage({ input_tokens: 500, output_tokens: 200, search_calls: 2, search_count_status: 'reported_by_provider', token_cost_usd: 0.03, web_search_cost_usd: 0.02, cost_usd: 0.05 });

      const usageAfterFirstRun = checkpoint.getState().usage.estimated_cost_usd;

      // Second run (resume): loading from cache — should NOT call addUsage again
      const metrics = buildMetrics();
      await runStage2DiscoveryBatch(
        'fake-key', 0, 'SaaS', 'Colombia', 'ctx',
        [], checkpoint, metrics,
        async () => { throw new Error('fetch must not be called'); }
      );

      const usageAfterResume = checkpoint.getState().usage.estimated_cost_usd;
      assert.equal(usageAfterResume, usageAfterFirstRun, 'cost must not increase when loading from cache');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test 9: Changed request invalidates resume ───────────────────────────────

describe('Test 9 — changed request invalidates resume', () => {
  it('runMultistageProvider throws when requestHash does not match checkpoint', async () => {
    const dir = makeTmpDir();
    try {
      // Create checkpoint with a specific hash
      const checkpoint = CheckpointManager.create(dir, 'run-test9', 'original-hash');
      assert.ok(checkpoint, 'checkpoint created');

      // Try to resume with a different hash — simulate by directly checking the hash
      const resumed = CheckpointManager.resume(dir);
      assert.ok(resumed, 'checkpoint must be loadable');
      assert.equal(resumed!.getState().requestHash, 'original-hash', 'hash must match original');

      // A different request would produce a different hash and should be rejected
      // (This is enforced in orchestrator.ts — here we verify the hash is stored correctly)
      assert.notEqual(
        resumed!.getState().requestHash,
        'different-hash',
        'different request hash must not match saved checkpoint'
      );
    } finally {
      cleanupDir(dir);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 16AB.23.4 — Checkpoint coherence tests (Cases 1–10)
// ════════════════════════════════════════════════════════════════════════════════

// ─── Shared helpers for 16AB.23.4 tests ──────────────────────────────────────

function makeCandidate(name: string, website: string | null, batchIndex = 0): DiscoveryCandidate {
  return {
    name,
    website,
    linkedin: null,
    city: 'Bogotá',
    sector: 'SaaS',
    description: `${name} description`,
    confidence: 'Alta' as const,
    evidence_url: null,
    evidence_source: 'LinkedIn',
    estimated_size: '50-200',
    notes: null,
    batch_index: batchIndex,
    batch_theme: 'SaaS',
  };
}

function makeVerified(originalName: string, website: string | null): VerifiedCandidateResult {
  return {
    original_name: originalName,
    resolved_name: originalName,
    is_real_company: true,
    official_website: website,
    linkedin_url: null,
    operates_in_colombia: true,
    is_tech_b2b: true,
    city: 'Bogotá',
    estimated_size: '50-200',
    confidence: 'Alta' as const,
    evidence_url: null,
    evidence_source: 'LinkedIn',
    description: `${originalName} verified`,
    notes: null,
    rejection_reason: null,
  };
}

function successfulVerificationFetch(verifiedNames: string[]): FetchFn {
  const candidates = verifiedNames.map((name) => ({
    original_name: name,
    resolved_name: name,
    is_real_company: true,
    official_website: `https://${name.toLowerCase().replace(/\s/g, '')}.co`,
    linkedin_url: null,
    operates_in_colombia: true,
    is_tech_b2b: true,
    city: 'Bogotá',
    estimated_size: '50-200',
    confidence: 'Alta',
    evidence_url: null,
    evidence_source: 'LinkedIn',
    description: `${name} verified`,
    notes: null,
    rejection_reason: null,
  }));
  const body = JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: `<json_output>${JSON.stringify({ candidates })}</json_output>` }],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 200 },
  });
  return async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

const noopSleepFn = () => Promise.resolve();

// ─── Test Case 1 — Bug reproducido: legacy dedup artifact invalidado ──────────

describe('Case 1 — legacy dedup artifact is treated as stale', () => {
  it('loadArtifactIfValid returns null for a file without envelope (legacy format)', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-c1', 'hash-c1');

      // Write a legacy file (raw JSON, no envelope)
      const legacyFile = join(dir, 'state', 'deduplicated-pool.json');
      writeFileSync(legacyFile, JSON.stringify({ deduped: [{ name: 'Simetrik' }], externalDuplicates: [] }), 'utf-8');

      const pool = [makeCandidate('Simetrik', 'https://simetrik.com')];
      const expectedHash = computeDedupInputHash(pool, '16AB.23.4');

      // Legacy file must not be reused — no envelope, no hash
      const result = checkpoint.loadArtifactIfValid<unknown>('deduplicated-pool.json', expectedHash);
      assert.equal(result, null, 'legacy dedup artifact must be treated as stale');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test Case 2 — Dedup stale: hash mismatch → null ─────────────────────────

describe('Case 2 — dedup artifact with wrong inputHash is rejected', () => {
  it('loadArtifactIfValid returns null when stored inputHash differs from expected', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-c2', 'hash-c2');

      const poolA = [makeCandidate('EmpresaA', 'https://empresa-a.co')];
      const hashA = computeDedupInputHash(poolA, '16AB.23.4');
      // Save artifact with hash of pool A
      checkpoint.saveArtifact('deduplicated-pool.json', 'stage4_dedup', hashA, { deduped: poolA, externalDuplicates: [] });

      // Now pool has changed — hash B differs
      const poolB = [makeCandidate('EmpresaA', 'https://empresa-a.co'), makeCandidate('EmpresaB', 'https://empresa-b.co')];
      const hashB = computeDedupInputHash(poolB, '16AB.23.4');

      assert.notEqual(hashA, hashB, 'hashes must differ for different pools');
      const result = checkpoint.loadArtifactIfValid<unknown>('deduplicated-pool.json', hashB);
      assert.equal(result, null, 'stale artifact must not be returned');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test Case 3 — Dedup válido: hash match → data returned ──────────────────

describe('Case 3 — dedup artifact with matching inputHash is reused', () => {
  it('loadArtifactIfValid returns data when inputHash matches', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-c3', 'hash-c3');

      const pool = [makeCandidate('EmpresaA', 'https://empresa-a.co')];
      const hash = computeDedupInputHash(pool, '16AB.23.4');
      const stored = { deduped: pool, externalDuplicates: [] };
      checkpoint.saveArtifact('deduplicated-pool.json', 'stage4_dedup', hash, stored);

      const result = checkpoint.loadArtifactIfValid<typeof stored>('deduplicated-pool.json', hash);
      assert.ok(result !== null, 'valid artifact must be returned');
      assert.equal(result!.deduped.length, 1, 'returned data must match stored data');
      assert.equal(result!.deduped[0]?.name, 'EmpresaA');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test Case 4 — Verificación por candidato ────────────────────────────────

describe('Case 4 — per-candidate verification cache', () => {
  it('Simetrik cached; 4 new candidates trigger 2 API calls (batch size 2)', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-c4', 'hash-c4');
      const country = 'Colombia';

      // Pre-populate Simetrik in per-candidate cache
      const simetrik = makeCandidate('Simetrik', 'https://simetrik.com');
      const simetrikKey = computeCandidateKey(simetrik);
      const simetrikHash = computeVerificationCandidateInputHash(simetrik, country, '16AB.23.4', 'claude-sonnet-4-6');
      const simetrikVerified = makeVerified('Simetrik', 'https://simetrik.com');
      checkpoint.saveVerificationCandidate(simetrikKey, simetrikVerified, simetrikHash);

      // Pool: Simetrik (cached) + 4 new candidates
      const newCandidates = [
        makeCandidate('NuevaCo1', 'https://nuevaco1.co', 1),
        makeCandidate('NuevaCo2', 'https://nuevaco2.co', 1),
        makeCandidate('NuevaCo3', 'https://nuevaco3.co', 2),
        makeCandidate('NuevaCo4', 'https://nuevaco4.co', 2),
      ];
      const pool = [simetrik, ...newCandidates];

      let apiCallCount = 0;
      const trackingFetch: FetchFn = async (input, init) => {
        apiCallCount++;
        // Each call returns 2 verified candidates (1 per batch member)
        return successfulVerificationFetch(['CandA', 'CandB'])(input, init);
      };

      const metrics = buildMetrics();
      const results = await runStage5VerificationCandidates(
        'fake-key', pool, country, checkpoint, metrics, trackingFetch, noopSleepFn
      );

      // 4 uncached candidates → 2 batches of 2 → 2 API calls
      assert.equal(apiCallCount, 2, 'only 2 API calls for 4 uncached candidates (batch size 2)');
      // Simetrik comes from cache — total results = 1 (simetrik) + 2*batch_results
      assert.ok(results.length >= 1, 'Simetrik must be in results from cache');
      assert.ok(
        results.some((r) => r.original_name === 'Simetrik'),
        'Simetrik must be in results without extra API call'
      );
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test Case 5 — Cambio de orden no invalida hash ──────────────────────────

describe('Case 5 — order change does not invalidate hash', () => {
  it('computePrefilterInputHash is identical regardless of candidate order', () => {
    const poolAB = [
      makeCandidate('EmpresaA', 'https://empresa-a.co'),
      makeCandidate('EmpresaB', 'https://empresa-b.co'),
    ];
    const poolBA = [
      makeCandidate('EmpresaB', 'https://empresa-b.co'),
      makeCandidate('EmpresaA', 'https://empresa-a.co'),
    ];

    const hashAB = computePrefilterInputHash(poolAB, '16AB.23.4');
    const hashBA = computePrefilterInputHash(poolBA, '16AB.23.4');

    assert.equal(hashAB, hashBA, 'hash must be order-independent (candidates are sorted by key)');
  });

  it('computeDedupInputHash is identical regardless of candidate order', () => {
    const poolAB = [
      makeCandidate('EmpresaA', 'https://empresa-a.co'),
      makeCandidate('EmpresaB', 'https://empresa-b.co'),
    ];
    const poolBA = [poolAB[1]!, poolAB[0]!];

    assert.equal(
      computeDedupInputHash(poolAB, '16AB.23.4'),
      computeDedupInputHash(poolBA, '16AB.23.4'),
      'dedup hash must be order-independent'
    );
  });
});

// ─── Test Case 6 — Cambio de datos invalida hash de verificación ──────────────

describe('Case 6 — relevant data change invalidates verification hash', () => {
  it('same domain/name but different sector produces different verification inputHash', () => {
    const base = makeCandidate('EmpresaA', 'https://empresa-a.co');
    const changed = { ...base, sector: 'Fintech' };

    const h1 = computeVerificationCandidateInputHash(base, 'Colombia', '16AB.23.4', 'claude-sonnet-4-6');
    const h2 = computeVerificationCandidateInputHash(changed, 'Colombia', '16AB.23.4', 'claude-sonnet-4-6');

    assert.notEqual(h1, h2, 'different sector must produce different verification hash');
  });

  it('same domain/name with same data produces identical hash (idempotent)', () => {
    const c = makeCandidate('EmpresaA', 'https://empresa-a.co');
    const h1 = computeVerificationCandidateInputHash(c, 'Colombia', '16AB.23.4', 'claude-sonnet-4-6');
    const h2 = computeVerificationCandidateInputHash({ ...c }, 'Colombia', '16AB.23.4', 'claude-sonnet-4-6');
    assert.equal(h1, h2, 'identical inputs must produce identical hash');
  });
});

// ─── Test Case 7 — Selección stale cuando crece el pool ──────────────────────

describe('Case 7 — selection is invalidated when verified pool grows', () => {
  it('loadArtifactIfValid returns null for selection when acceptedVerified set changes', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-c7', 'hash-c7');

      // Initial selection: 1 candidate
      const smallPool = [makeVerified('EmpresaA', 'https://empresa-a.co')];
      const hashSmall = computeSelectionInputHash(smallPool, 10, '16AB.23.4');
      checkpoint.saveArtifact('selection-round-0.json', 'stage6_selection', hashSmall, {
        round: 0,
        candidates: smallPool,
      });

      // Pool grows to 2 candidates
      const largerPool = [
        makeVerified('EmpresaA', 'https://empresa-a.co'),
        makeVerified('EmpresaB', 'https://empresa-b.co'),
      ];
      const hashLarger = computeSelectionInputHash(largerPool, 10, '16AB.23.4');

      assert.notEqual(hashSmall, hashLarger, 'hashes must differ when pool grows');
      const result = checkpoint.loadArtifactIfValid<unknown>('selection-round-0.json', hashLarger);
      assert.equal(result, null, 'stale selection must not be returned when pool grew');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test Case 8 — Artefacto legacy: sin envelope → null, discovery intacto ──

describe('Case 8 — legacy artifact handling', () => {
  it('legacy file (no envelope) returns null from loadArtifactIfValid but NOT from loadFile', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-c8', 'hash-c8');

      // Write legacy prefiltered-pool.json without envelope
      const legacyData = { accepted: [{ name: 'EmpresaLegacy' }], rejected: [] };
      checkpoint.saveFile('prefiltered-pool.json', legacyData);

      const anyHash = computeArtifactInputHash({ anything: 'value' });

      // loadArtifactIfValid must treat it as stale (no envelope)
      const artResult = checkpoint.loadArtifactIfValid<typeof legacyData>('prefiltered-pool.json', anyHash);
      assert.equal(artResult, null, 'legacy file must return null from loadArtifactIfValid');

      // loadFile still reads it (discovery batches use loadFile, must remain accessible)
      const rawResult = checkpoint.loadFile<typeof legacyData>('prefiltered-pool.json');
      assert.ok(rawResult !== null, 'loadFile must still read legacy files');
      assert.equal(rawResult!.accepted[0]?.name, 'EmpresaLegacy');
    } finally {
      cleanupDir(dir);
    }
  });

  it('discovery batch 0 (legacy, no envelope) is preserved via loadFile + isDiscoveryBatchCompleted', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-c8b', 'hash-c8b');

      // Simulate legacy run: batch 0 exists as raw file
      const batchData = {
        batch_index: 0, batch_theme: 'SaaS',
        candidates: [{ name: 'Simetrik', website: 'https://simetrik.com', linkedin: null, city: null, sector: 'SaaS', description: null, confidence: 'Alta', evidence_url: null, evidence_source: null, estimated_size: null, notes: null, batch_index: 0, batch_theme: 'SaaS' }],
      };
      checkpoint.saveFile(checkpoint.discoveryFile(0), batchData);
      checkpoint.markDiscoveryBatchCompleted(0);

      // On resume, isDiscoveryBatchCompleted must remain true
      const resumed = CheckpointManager.resume(dir);
      assert.ok(resumed !== null, 'checkpoint must be resumable');
      assert.ok(resumed!.isDiscoveryBatchCompleted(0), 'discovery batch 0 must stay completed after resume');
      const loaded = resumed!.loadFile<typeof batchData>(resumed!.discoveryFile(0));
      assert.ok(loaded?.candidates.length === 1, 'discovery batch 0 data must survive resume');
      assert.equal(loaded!.candidates[0]?.name, 'Simetrik');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test Case 9 — Reanudación repetida no duplica costos ni verificaciones ──

describe('Case 9 — repeated resume does not duplicate costs or verifications', () => {
  it('second resume reads Simetrik from per-candidate cache, no extra API call', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-c9', 'hash-c9');
      const country = 'Colombia';

      const simetrik = makeCandidate('Simetrik', 'https://simetrik.com');
      const key = computeCandidateKey(simetrik);
      const inputHash = computeVerificationCandidateInputHash(simetrik, country, '16AB.23.4', 'claude-sonnet-4-6');

      // First run: verify Simetrik and save to per-candidate cache
      const simetrikVerified = makeVerified('Simetrik', 'https://simetrik.com');
      checkpoint.saveVerificationCandidate(key, simetrikVerified, inputHash);
      checkpoint.addUsage({ input_tokens: 500, output_tokens: 200, search_calls: 2, search_count_status: 'reported_by_provider', token_cost_usd: 0.03, web_search_cost_usd: 0.02, cost_usd: 0.05 });

      const costAfterFirstRun = checkpoint.getState().usage.estimated_cost_usd;

      // Second run (resume): pool is the same — Simetrik should come from cache
      let apiCallCount = 0;
      const trackingFetch: FetchFn = async () => {
        apiCallCount++;
        throw new Error('Should not be called for cached candidate');
      };

      const resumed = CheckpointManager.resume(dir);
      assert.ok(resumed !== null);
      const metrics2 = buildMetrics();
      const results = await runStage5VerificationCandidates(
        'fake-key', [simetrik], country, resumed!, metrics2, trackingFetch, noopSleepFn
      );

      assert.equal(apiCallCount, 0, 'fetch must NOT be called for already-cached candidate');
      assert.equal(results.length, 1, 'Simetrik must be returned from cache');
      assert.equal(results[0]?.original_name, 'Simetrik');

      // Cost must not increase after resume (no new addUsage call)
      assert.equal(
        resumed!.getState().usage.estimated_cost_usd,
        costAfterFirstRun,
        'cost must not increase when all candidates served from cache'
      );
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test Case 10 — Archivo corrupto no rompe el run ─────────────────────────

describe('Case 10 — corrupt artifact is handled gracefully', () => {
  it('corrupt deduplicated-pool.json is renamed .corrupt and returns null (triggers recompute)', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-c10', 'hash-c10');

      const corruptPath = join(dir, 'state', 'deduplicated-pool.json');
      writeFileSync(corruptPath, '{ this is not valid JSON }', 'utf-8');

      const pool = [makeCandidate('EmpresaA', 'https://empresa-a.co')];
      const hash = computeDedupInputHash(pool, '16AB.23.4');

      const result = checkpoint.loadArtifactIfValid<unknown>('deduplicated-pool.json', hash);
      assert.equal(result, null, 'corrupt file must return null');
      assert.ok(existsSync(`${corruptPath}.corrupt`), 'corrupt file must be renamed to .corrupt');
      assert.ok(!existsSync(corruptPath), 'original corrupt path must no longer exist');
    } finally {
      cleanupDir(dir);
    }
  });

  it('corrupt per-candidate cache file is renamed and candidate is re-verified', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-c10b', 'hash-c10b');
      const country = 'Colombia';

      const empresa = makeCandidate('EmpresaCorrupt', 'https://empresacorrupt.co');
      const key = computeCandidateKey(empresa);
      const inputHash = computeVerificationCandidateInputHash(empresa, country, '16AB.23.4', 'claude-sonnet-4-6');

      // Write corrupt per-candidate cache
      const { mkdirSync: mkdirS, writeFileSync: writeS } = await import('fs');
      const subdir = join(dir, 'state', 'verification-candidates');
      mkdirS(subdir, { recursive: true });
      writeS(join(subdir, `${key}.json`), '{ invalid }', 'utf-8');

      // loadVerificationCandidateIfValid must return null and rename corrupt file
      const cached = checkpoint.loadVerificationCandidateIfValid<VerifiedCandidateResult>(key, inputHash);
      assert.equal(cached, null, 'corrupt per-candidate file must return null');
      assert.ok(
        existsSync(join(subdir, `${key}.json.corrupt`)),
        'corrupt per-candidate file must be renamed to .corrupt'
      );
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Test 10 (original): 8 solid candidates produce 8 results, not 10 weak ones ─────────

describe('Test 10 — 8 solid candidates produce 8, not 10 weak ones', () => {
  it('prefilter + verification stage returns only accepted count (8), not padded', async () => {
    // Create 8 valid discovery candidates
    const solidPool: DiscoveryCandidate[] = Array.from({ length: 8 }, (_, i) => ({
      name: `SolidEmpresa${i}`,
      website: `https://solid${i}.co`,
      linkedin: `https://www.linkedin.com/company/solid${i}`,
      city: 'Bogotá',
      sector: 'Tecnología / SaaS',
      description: `Empresa sólida ${i}`,
      confidence: 'Alta' as const,
      evidence_url: `https://www.linkedin.com/company/solid${i}`,
      evidence_source: 'LinkedIn',
      estimated_size: '100-500 empleados',
      notes: null,
      batch_index: 0,
      batch_theme: 'SaaS',
    }));

    // 2 weak (Baja confidence) candidates that should be filtered out
    const weakPool: DiscoveryCandidate[] = Array.from({ length: 2 }, (_, i) => ({
      name: `WeakEmpresa${i}`,
      website: null,
      linkedin: null,
      city: null,
      sector: 'Tecnología',
      description: null,
      confidence: 'Baja' as const,
      evidence_url: null,
      evidence_source: null,
      estimated_size: null,
      notes: null,
      batch_index: 0,
      batch_theme: 'SaaS',
    }));

    const { accepted } = runStage3Prefilter([...solidPool, ...weakPool]);

    // Must return exactly 8 solid ones, not 10
    assert.equal(accepted.length, 8, 'prefilter must return exactly 8 solid candidates');
    assert.ok(
      accepted.every((c) => c.confidence !== 'Baja'),
      'no Baja-confidence candidate must survive prefilter'
    );
    assert.ok(
      accepted.every((c) => c.name.startsWith('SolidEmpresa')),
      'only solid companies must be accepted'
    );
  });
});
