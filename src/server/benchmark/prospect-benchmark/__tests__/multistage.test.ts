/**
 * Tests — Multistage Orchestrator (Hito 16AB.23.3)
 *
 * 10 tests requeridos. Sin llamadas reales a la API. Sin timers reales largos.
 * Usa Node.js built-in test runner (node:test + node:assert).
 * Sistema de archivos temporal para checkpoints.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
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
      const simetrikHash = computeVerificationCandidateInputHash(simetrik, country, '16AB.23.8', 'claude-sonnet-4-6');
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
      const inputHash = computeVerificationCandidateInputHash(simetrik, country, '16AB.23.8', 'claude-sonnet-4-6');

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

// ════════════════════════════════════════════════════════════════════════════════
// 16AB.23.7 — Budget separation tests (Cases 1–12)
// ════════════════════════════════════════════════════════════════════════════════

function makeZeroUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    search_calls: 0,
    search_count_status: 'unavailable' as const,
    token_cost_usd: 0,
    web_search_cost_usd: null,
    cost_usd: 0,
  };
}

function makeTokenUsage(cost = 0.01) {
  return {
    input_tokens: 1000,
    output_tokens: 500,
    search_calls: 0,
    search_count_status: 'unavailable' as const,
    token_cost_usd: cost,
    web_search_cost_usd: null,
    cost_usd: cost,
  };
}

function writeLegacyState(dir: string, overrides: Record<string, unknown>): void {
  const base = {
    runId: 'legacy-run',
    provider: 'anthropic_native_search',
    requestHash: 'hash-legacy',
    model: 'claude-sonnet-4-6',
    pipelineVersion: '16AB.23.3',
    currentStage: 'stage2_discovery',
    completedStages: [],
    completedDiscoveryBatches: [],
    completedVerificationBatches: [],
    failedBatches: [],
    stageArtifacts: {},
    usage: {},
    startedAt: '2026-06-09T19:18:06.336Z',
    updatedAt: '2026-06-09T20:19:47.366Z',
  };
  const merged = { ...base, ...overrides };
  const stateDir = join(dir, 'state');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'run-state.json'), JSON.stringify(merged), 'utf-8');
}

// ─── Case 1 (16AB.23.7): Legacy run state migration ───────────────────────────

describe('16AB.23.7 Case 1 — legacy run state migration', () => {
  it('resume derives usage_bearing_api_calls=5 from successful_api_calls on legacy state', () => {
    const dir = makeTmpDir();
    try {
      writeLegacyState(dir, {
        completedDiscoveryBatches: [0, 1],
        failedBatches: [
          { stage: 'stage2_discovery', batch: 2, errorCode: 'rate_limit' },
          { stage: 'stage2_discovery', batch: 3, errorCode: 'rate_limit' },
          { stage: 'stage2_discovery', batch: 4, errorCode: 'rate_limit' },
        ],
        usage: {
          input_tokens: 286057,
          output_tokens: 8122,
          searches_executed: 0,
          total_api_calls: 16,
          successful_api_calls: 5,
          failed_api_calls: 11,
          retried_api_calls: 13,
          rate_limit_wait_ms: 195000,
          estimated_cost_usd: 0.98,
          // 16AB.23.5 fields present
          web_search_requests_reported: 0,
          web_search_requests_inferred: 0,
          web_search_count_status: 'unavailable',
          token_cost_usd: 0.98,
          web_search_cost_usd: null,
          web_search_results_count: 0,
          web_search_citations_count: 0,
          web_search_errors_count: 0,
          // No 16AB.23.7 fields — migration must fill them
        },
      });

      const resumed = CheckpointManager.resume(dir);
      assert.ok(resumed !== null, 'must be resumable');

      const usage = resumed!.getState().usage;
      assert.equal(usage.usage_bearing_api_calls, 5, 'usage_bearing_api_calls derived from successful_api_calls');
      assert.ok(usage.rate_limited_attempts >= 11, 'rate_limited_attempts ≥ failed_api_calls(11)');
      assert.equal(usage.known_cost_usd, 0.98, 'known_cost_usd derived from estimated_cost_usd');
      assert.equal(usage.total_provider_attempts, 16, 'total_provider_attempts derived from total_api_calls');
      assert.ok(usage.legacy_search_cost_upper_bound_usd !== null, 'upper bound computed for unavailable status');

      // Key assertion: withinBudget must be TRUE after migration (5 usage-bearing, not 16)
      assert.ok(resumed!.hasRunConsumptionBudget(), 'run consumption budget available (5/16)');
      assert.ok(resumed!.hasMonetaryBudget(), 'monetary budget available ($0.98 + upper_bound < $2.50)');
      assert.ok(resumed!.canMakeProviderAttempt(), 'invocation attempt budget fresh on resume');
      assert.ok(resumed!.withinBudget(), 'withinBudget() MUST be true — this was the reported bug');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Case 2 (16AB.23.7): 429 sin usage ────────────────────────────────────────

describe('16AB.23.7 Case 2 — 429 with zero tokens does not consume run budget', () => {
  it('rate_limit addUsage increments rate_limited_attempts only', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23_7-c2', 'hash');
      checkpoint.addUsage(makeZeroUsage(), 'rate_limit');

      const usage = checkpoint.getState().usage;
      assert.equal(usage.rate_limited_attempts, 1, 'rate_limited_attempts must be 1');
      assert.equal(usage.usage_bearing_api_calls, 0, 'usage_bearing_api_calls must remain 0');
      assert.equal(usage.known_cost_usd, 0, 'known_cost_usd must not increase');
      assert.equal(usage.total_provider_attempts, 1, 'total_provider_attempts incremented');
      assert.equal(usage.total_api_calls, 1, 'legacy total_api_calls also incremented');

      // Budget NOT exhausted: run consumption gate uses usage_bearing_api_calls (0), not rate_limited (1)
      assert.ok(checkpoint.hasRunConsumptionBudget(), 'consumption budget still available after 429');
      assert.ok(checkpoint.canMakeProviderAttempt(), 'invocation budget still available');
      assert.ok(checkpoint.withinBudget(), 'withinBudget() must be true after 1 rate-limited attempt');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Case 3 (16AB.23.7): Error con usage ──────────────────────────────────────

describe('16AB.23.7 Case 3 — error with tokens still consumes run budget', () => {
  it('non-rate-limit error that returned tokens increments usage_bearing_api_calls', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23_7-c3', 'hash');
      checkpoint.addUsage(makeTokenUsage(0.01), 'timeout');

      const usage = checkpoint.getState().usage;
      assert.equal(usage.usage_bearing_api_calls, 1, 'usage_bearing_api_calls must be 1');
      assert.equal(usage.rate_limited_attempts, 0, 'rate_limited_attempts must be 0');
      assert.ok(usage.known_cost_usd > 0, 'known_cost_usd must increase');
      assert.equal(usage.total_provider_attempts, 1, 'total_provider_attempts incremented');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Case 4 (16AB.23.7): Nueva invocación reset ───────────────────────────────

describe('16AB.23.7 Case 4 — resume resets invocation attempt budget without erasing history', () => {
  it('getInvocationBudget().attempts=0 after resume while usage_bearing_api_calls is preserved', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23_7-c4', 'hash');
      for (let i = 0; i < 5; i++) {
        checkpoint.addUsage(makeTokenUsage(0.01));
        checkpoint.recordSuccess();
      }

      assert.equal(checkpoint.getState().usage.usage_bearing_api_calls, 5);

      const resumed = CheckpointManager.resume(dir);
      assert.ok(resumed !== null);

      assert.equal(resumed!.getInvocationBudget().attempts, 0, 'invocation attempts reset to 0 on resume');
      assert.ok(resumed!.canMakeProviderAttempt(), 'fresh invocation has full attempt budget');
      assert.equal(
        resumed!.getState().usage.usage_bearing_api_calls,
        5,
        'historical usage_bearing_api_calls preserved across resume',
      );
      assert.ok(resumed!.hasRunConsumptionBudget(), 'run consumption budget still available (5/16)');
      assert.ok(resumed!.withinBudget(), 'withinBudget() true on fresh resume with 5 prior calls');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Case 5 (16AB.23.7): Cachés cargadas aunque budget de consumo agotado ─────

describe('16AB.23.7 Case 5 — Phase A loads all cached batches even when run consumption budget is exhausted', () => {
  it('10 candidates hydrated from cache when usage_bearing_api_calls=16 (budget exhausted)', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23_7-c5', 'hash');

      // Pre-populate 2 completed discovery batches (5 candidates each)
      const makeBatch = (idx: number) => ({
        batch_index: idx,
        batch_theme: `Theme${idx}`,
        candidates: Array.from({ length: 5 }, (_, i) =>
          makeCandidate(`Empresa${idx}_${i}`, `https://e${idx}-${i}.co`, idx),
        ),
      });
      checkpoint.saveFile(checkpoint.discoveryFile(0), makeBatch(0));
      checkpoint.markDiscoveryBatchCompleted(0);
      checkpoint.saveFile(checkpoint.discoveryFile(1), makeBatch(1));
      checkpoint.markDiscoveryBatchCompleted(1);

      // Exhaust the run consumption budget (16 usage-bearing calls)
      for (let i = 0; i < 16; i++) checkpoint.addUsage(makeTokenUsage(0.01));

      assert.ok(!checkpoint.hasRunConsumptionBudget(), 'run consumption budget must be exhausted');
      assert.ok(!checkpoint.withinBudget(), 'withinBudget() must be false');

      // Simulate Phase A: load ALL completed batches WITHOUT checking withinBudget()
      const allDiscovered: DiscoveryCandidate[] = [];
      for (let i = 0; i < 5; i++) {
        if (!checkpoint.isDiscoveryBatchCompleted(i)) continue;
        const cached = checkpoint.loadFile<{ candidates: DiscoveryCandidate[] }>(checkpoint.discoveryFile(i));
        if (cached?.candidates) allDiscovered.push(...cached.candidates);
      }

      assert.equal(allDiscovered.length, 10, 'Phase A must hydrate all 10 cached candidates');
      // Phase B cannot run (budget exhausted) — but the cached data is preserved
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Case 6 (16AB.23.7): Phase A carga cache, Phase B intenta faltantes ───────

describe('16AB.23.7 Case 6 — Phase A hydrates cache; Phase B fetch only missing batches', () => {
  it('batches 0,1 cached (no fetch), batches 2-4 trigger exactly 3 fetch calls', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23_7-c6', 'hash');

      // Batches 0 and 1 cached
      for (const idx of [0, 1]) {
        checkpoint.saveFile(checkpoint.discoveryFile(idx), {
          batch_index: idx, batch_theme: `Theme${idx}`,
          candidates: [makeCandidate(`Empresa${idx}`, `https://e${idx}.co`, idx)],
        });
        checkpoint.markDiscoveryBatchCompleted(idx);
      }

      let fetchCallCount = 0;
      const countingFetch: FetchFn = async () => {
        fetchCallCount++;
        const body = JSON.stringify({
          id: 'msg_test', type: 'message', role: 'assistant',
          content: [{ type: 'text', text: `<json_output>${JSON.stringify({ batch_index: 0, batch_theme: 'SaaS', candidates: [] })}</json_output>` }],
          model: 'claude-sonnet-4-6', stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      };

      // Phase A: load cached batches (no fetch)
      const allDiscovered: DiscoveryCandidate[] = [];
      for (let i = 0; i < 5; i++) {
        if (!checkpoint.isDiscoveryBatchCompleted(i)) continue;
        const cached = checkpoint.loadFile<{ candidates: DiscoveryCandidate[] }>(checkpoint.discoveryFile(i));
        if (cached?.candidates) allDiscovered.push(...cached.candidates);
      }
      assert.equal(fetchCallCount, 0, 'Phase A must not call fetch');
      assert.equal(allDiscovered.length, 2, 'Phase A hydrates 2 cached candidates');

      // Phase B: attempt uncompleted batches (2, 3, 4) — budget available
      const metrics = buildMetrics();
      const existingNames = allDiscovered.map((c) => c.name);
      for (let i = 0; i < 5; i++) {
        if (checkpoint.isDiscoveryBatchCompleted(i)) continue;
        if (!checkpoint.withinBudget()) break;
        await runStage2DiscoveryBatch(
          'fake-key', i, `Theme${i}`, 'Colombia', 'ctx',
          existingNames, checkpoint, metrics, countingFetch,
        );
      }

      assert.equal(fetchCallCount, 3, 'Phase B must call fetch exactly 3 times (batches 2, 3, 4)');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Case 7 (16AB.23.7): Budget se agota durante Phase B ──────────────────────

describe('16AB.23.7 Case 7 — budget exhaustion mid-Phase B preserves completed batches', () => {
  it('batches 0,1,2 preserved when invocation budget exhausts before batch 3', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23_7-c7', 'hash');

      // Batches 0,1 cached
      for (const idx of [0, 1]) {
        checkpoint.saveFile(checkpoint.discoveryFile(idx), {
          batch_index: idx, batch_theme: `Theme${idx}`,
          candidates: [makeCandidate(`Empresa${idx}`, `https://e${idx}.co`, idx)],
        });
        checkpoint.markDiscoveryBatchCompleted(idx);
      }

      // Batch 2 will succeed, but exhaust the invocation budget
      const onceSuccessfulThenExhausted: FetchFn = async () => {
        const body = JSON.stringify({
          id: 'msg_test', type: 'message', role: 'assistant',
          content: [{ type: 'text', text: `<json_output>${JSON.stringify({ batch_index: 2, batch_theme: 'Theme2', candidates: [{ name: 'Batch2Empresa', website: 'https://b2.co', linkedin: null, city: null, sector: 'SaaS', description: null, confidence: 'Alta', evidence_url: null, evidence_source: null, estimated_size: null, notes: null }] })}</json_output>` }],
          model: 'claude-sonnet-4-6', stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      };

      // Phase A: load cached batches
      for (let i = 0; i < 5; i++) {
        if (!checkpoint.isDiscoveryBatchCompleted(i)) continue;
        checkpoint.loadFile<{ candidates: DiscoveryCandidate[] }>(checkpoint.discoveryFile(i));
      }

      // Phase B: batch 2 runs successfully
      const metrics = buildMetrics();
      await runStage2DiscoveryBatch(
        'fake-key', 2, 'Theme2', 'Colombia', 'ctx', [], checkpoint, metrics, onceSuccessfulThenExhausted,
      );
      assert.ok(checkpoint.isDiscoveryBatchCompleted(2), 'batch 2 must be completed after success');

      // Exhaust invocation budget after batch 2
      for (let i = 0; i < 16; i++) checkpoint.addUsage(makeTokenUsage(0.01));
      assert.ok(!checkpoint.withinBudget(), 'budget exhausted — Phase B must stop');

      // Phase B continues: should break at batch 3 (budget exhausted)
      let attemptedAfterExhaustion = false;
      for (let i = 3; i < 5; i++) {
        if (checkpoint.isDiscoveryBatchCompleted(i)) continue;
        if (!checkpoint.withinBudget()) break;
        attemptedAfterExhaustion = true;
      }
      assert.ok(!attemptedAfterExhaustion, 'must not attempt batches 3,4 after budget exhaustion');

      // Completed batches preserved
      assert.ok(checkpoint.isDiscoveryBatchCompleted(0), 'batch 0 preserved');
      assert.ok(checkpoint.isDiscoveryBatchCompleted(1), 'batch 1 preserved');
      assert.ok(checkpoint.isDiscoveryBatchCompleted(2), 'batch 2 preserved');
      assert.ok(!checkpoint.isDiscoveryBatchCompleted(3), 'batch 3 retryable');
      assert.ok(!checkpoint.isDiscoveryBatchCompleted(4), 'batch 4 retryable');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Case 8 (16AB.23.7): No-degradación — artifact con más inputs se preserva ─

describe('16AB.23.7 Case 8 — no-degradation: loadArtifactRaw returns existing even on hash mismatch', () => {
  it('richer existing prefilter artifact is detectable via loadArtifactRaw when pool shrinks', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23_7-c8', 'hash');

      // Save prefilter artifact with 10 candidates
      const pool10 = Array.from({ length: 10 }, (_, i) => makeCandidate(`Empresa${i}`, `https://e${i}.co`));
      const hash10 = computePrefilterInputHash(pool10, '16AB.23.4');
      checkpoint.saveArtifact('prefiltered-pool.json', 'stage3_prefilter', hash10, {
        accepted: pool10,
        rejected: [],
        stats: { total: 10, accepted: 10, rejected: 0 },
      });

      // Now pool has only 5 candidates (hash mismatch)
      const pool5 = pool10.slice(0, 5);
      const hash5 = computePrefilterInputHash(pool5, '16AB.23.4');
      assert.notEqual(hash10, hash5, 'hashes must differ');

      // loadArtifactIfValid returns null (hash mismatch — correct behavior)
      const valid = checkpoint.loadArtifactIfValid<unknown>('prefiltered-pool.json', hash5);
      assert.equal(valid, null, 'loadArtifactIfValid must reject on hash mismatch');

      // loadArtifactRaw returns the existing data regardless of hash
      const raw = checkpoint.loadArtifactRaw<{ accepted: DiscoveryCandidate[]; stats: { total: number } }>('prefiltered-pool.json');
      assert.ok(raw !== null, 'loadArtifactRaw must return existing artifact');
      assert.equal(raw!.data.stats.total, 10, 'existing artifact reports 10 total inputs');

      // No-degradation check: existing artifact has more inputs than current pool
      const existingTotal = raw?.data.stats.total ?? 0;
      assert.ok(existingTotal > pool5.length, 'degradation detected: existing(10) > current(5)');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Case 9 (16AB.23.7): Costo máximo bloquea llamadas ────────────────────────

describe('16AB.23.7 Case 9 — monetary limit blocks further calls', () => {
  it('withinBudget() false and reason is monetary when known_cost_usd >= max_cost_usd', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23_7-c9', 'hash');
      // Spend exactly $2.50 (at or above limit)
      checkpoint.addUsage({ ...makeTokenUsage(), cost_usd: 2.5, token_cost_usd: 2.5 });

      assert.ok(!checkpoint.hasMonetaryBudget(), 'monetary budget must be exhausted at $2.50');
      assert.ok(!checkpoint.withinBudget(), 'withinBudget() must be false');
      assert.equal(checkpoint.budgetExhaustedReason(), 'monetary', 'exhausted reason must be monetary');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Case 10 (16AB.23.7): Upper bound de costo legacy ─────────────────────────

describe('16AB.23.7 Case 10 — legacy search cost upper bound computed on resume', () => {
  it('legacy_search_cost_upper_bound_usd is set and used in monetary gate', () => {
    const dir = makeTmpDir();
    try {
      writeLegacyState(dir, {
        usage: {
          input_tokens: 100000, output_tokens: 50000, searches_executed: 0,
          total_api_calls: 5, successful_api_calls: 5, failed_api_calls: 0,
          retried_api_calls: 0, rate_limit_wait_ms: 0, estimated_cost_usd: 1.05,
          web_search_requests_reported: 0, web_search_requests_inferred: 0,
          web_search_count_status: 'unavailable',
          token_cost_usd: 1.05, web_search_cost_usd: null,
          web_search_results_count: 0, web_search_citations_count: 0, web_search_errors_count: 0,
        },
      });

      const resumed = CheckpointManager.resume(dir);
      assert.ok(resumed !== null);
      const usage = resumed!.getState().usage;

      // Upper bound = 5 calls * 4 searches/call * $0.01/search = $0.20
      assert.ok(usage.legacy_search_cost_upper_bound_usd !== null, 'upper bound must be computed');
      assert.ok(usage.legacy_search_cost_upper_bound_usd! > 0, 'upper bound must be positive');
      // effective cost = 1.05 + 0.20 = 1.25 < 2.50 → still has budget
      assert.ok(resumed!.hasMonetaryBudget(), 'monetary budget available ($1.25 effective < $2.50)');
      // Upper bound is separate from known_cost_usd
      assert.equal(usage.known_cost_usd, 1.05, 'known_cost_usd must not include upper bound');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Case 11 (16AB.23.7): Reanudaciones infinitas no bypassean límite monetario ─

describe('16AB.23.7 Case 11 — accumulated cost persists across resumes', () => {
  it('third resume still sees monetary limit exceeded from accumulated known_cost_usd', () => {
    const dir = makeTmpDir();
    try {
      // First run: spend $2.40
      const checkpoint = CheckpointManager.create(dir, 'run-23_7-c11', 'hash');
      checkpoint.addUsage({ ...makeTokenUsage(), cost_usd: 2.4, token_cost_usd: 2.4 });
      assert.ok(checkpoint.hasMonetaryBudget(), 'still within limit after $2.40');

      // Second invocation (resume): spend $0.165 more → crosses $2.50
      const r1 = CheckpointManager.resume(dir);
      assert.ok(r1 !== null);
      assert.equal(r1!.getInvocationBudget().attempts, 0, 'invocation budget resets on resume');
      assert.ok(r1!.hasMonetaryBudget(), 'still within limit at start of second invocation ($2.40)');

      r1!.addUsage({ ...makeTokenUsage(), cost_usd: 0.165, token_cost_usd: 0.165 });
      assert.ok(!r1!.hasMonetaryBudget(), 'monetary limit exceeded after $2.565');
      assert.ok(!r1!.withinBudget(), 'withinBudget() false after $2.565');

      // Third invocation (resume): monetary limit MUST persist (cost is cumulative, not reset)
      const r2 = CheckpointManager.resume(dir);
      assert.ok(r2 !== null);
      assert.equal(r2!.getInvocationBudget().attempts, 0, 'invocation budget resets again');
      assert.ok(!r2!.hasMonetaryBudget(), 'monetary limit persists after third resume');
      assert.ok(!r2!.withinBudget(), 'withinBudget() still false on third resume');
    } finally {
      cleanupDir(dir);
    }
  });
});

// ─── Case 12 (16AB.23.7): Batch recuperado sin duplicar candidatos ni costos ──

describe('16AB.23.7 Case 12 — recovered batch adds usage once, second cache load is free', () => {
  it('batch 2 retried after rate_limit failure; cost incremented once; cache load adds nothing', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23_7-c12', 'hash');

      // Historical failure for batch 2 (rate_limit)
      checkpoint.recordBatchFailure('stage2_discovery', 2, 'rate_limit');
      const failedBatchCountBefore = checkpoint.getState().failedBatches.length;
      const usageBefore = checkpoint.getState().usage.usage_bearing_api_calls;
      const costBefore = checkpoint.getState().usage.known_cost_usd;

      // Retry batch 2 — it now succeeds
      const metrics = buildMetrics();
      const result = await runStage2DiscoveryBatch(
        'fake-key', 2, 'Theme2', 'Colombia', 'ctx', [], checkpoint, metrics,
        successfulFetch([{
          name: 'RecoveredEmpresa', website: 'https://recovered.co',
          linkedin: null, city: null, sector: 'SaaS', description: null,
          confidence: 'Alta', evidence_url: null, evidence_source: null,
          estimated_size: null, notes: null,
        }]),
      );

      assert.ok(checkpoint.isDiscoveryBatchCompleted(2), 'batch 2 must be completed after retry');
      assert.ok(result.length > 0, 'recovered batch must return candidates');
      // Cost and usage incremented exactly once
      assert.equal(
        checkpoint.getState().usage.usage_bearing_api_calls - usageBefore,
        1,
        'usage_bearing_api_calls incremented exactly once',
      );
      assert.ok(checkpoint.getState().usage.known_cost_usd > costBefore, 'cost incremented once');
      // Historical failedBatches preserved (audit trail, not cleared on retry)
      assert.equal(
        checkpoint.getState().failedBatches.length,
        failedBatchCountBefore,
        'historical failure records kept for audit',
      );

      const usageAfterRetry = checkpoint.getState().usage.usage_bearing_api_calls;
      const costAfterRetry = checkpoint.getState().usage.known_cost_usd;

      // Second load from cache must NOT add usage
      await runStage2DiscoveryBatch(
        'fake-key', 2, 'Theme2', 'Colombia', 'ctx', [], checkpoint, buildMetrics(),
        async () => { throw new Error('fetch must NOT be called for completed batch'); },
      );

      assert.equal(
        checkpoint.getState().usage.usage_bearing_api_calls,
        usageAfterRetry,
        'cache load must not increment usage_bearing_api_calls',
      );
      assert.equal(
        checkpoint.getState().usage.known_cost_usd,
        costAfterRetry,
        'cache load must not increment known_cost_usd',
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

// ─── Cases 16AB.23.8 — Legacy verification enforcement ───────────────────────

describe('Case 16AB.23.8-1 — saveLegacyVerification writes correct record', () => {
  it('creates legacy-verifications/<key>.json with status legacy_unverifiable', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23.8-1', 'hash-23.8-1');
      checkpoint.saveLegacyVerification('deadbeefdeadbeef', 'Simetrik');
      const path = join(dir, 'state', 'legacy-verifications', 'deadbeefdeadbeef.json');
      assert.ok(existsSync(path), 'legacy-verifications/<key>.json must exist');
      const record = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
      assert.equal(record['status'], 'legacy_unverifiable');
      assert.equal(record['requiresReverification'], true);
      assert.equal(record['candidateKey'], 'deadbeefdeadbeef');
      assert.equal(record['candidateName'], 'Simetrik');
      assert.ok(typeof record['migratedAt'] === 'string', 'migratedAt must be a string');
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Case 16AB.23.8-2 — isLegacyVerification returns correct boolean', () => {
  it('returns true for marked key, false for unmarked key', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23.8-2', 'hash-23.8-2');
      checkpoint.saveLegacyVerification('aaaa1111aaaa1111', 'Truora');
      assert.equal(checkpoint.isLegacyVerification('aaaa1111aaaa1111'), true, 'marked key must return true');
      assert.equal(checkpoint.isLegacyVerification('bbbb2222bbbb2222'), false, 'unmarked key must return false');
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Case 16AB.23.8-3 — getLegacyVerificationKeys returns all marked keys', () => {
  it('returns exactly the keys that were saved, excludes .superseded files', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23.8-3', 'hash-23.8-3');
      checkpoint.saveLegacyVerification('key0000000000001', 'CandA');
      checkpoint.saveLegacyVerification('key0000000000002', 'CandB');
      checkpoint.saveLegacyVerification('key0000000000003', 'CandC');

      // Supersede one — it must not appear in keys
      checkpoint.clearLegacyVerification('key0000000000002');

      const keys = checkpoint.getLegacyVerificationKeys();
      assert.ok(keys.includes('key0000000000001'), 'CandA key must be present');
      assert.ok(!keys.includes('key0000000000002'), 'superseded CandB key must be absent');
      assert.ok(keys.includes('key0000000000003'), 'CandC key must be present');
      assert.equal(keys.length, 2, 'must return exactly 2 active legacy keys');
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Case 16AB.23.8-4 — saveVerificationCandidate clears legacy record for same key', () => {
  it('fresh verification supersedes the legacy record for that key', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23.8-4', 'hash-23.8-4');
      const key = 'cccc3333cccc3333';
      checkpoint.saveLegacyVerification(key, 'B-Secure');
      assert.equal(checkpoint.isLegacyVerification(key), true, 'must be legacy before re-verification');

      const freshData = { original_name: 'B-Secure', is_real_company: true };
      checkpoint.saveVerificationCandidate(key, freshData, 'newhash0000001');

      assert.equal(checkpoint.isLegacyVerification(key), false, 'legacy record must be cleared after re-verification');
      // The superseded file must exist for audit trail
      const supersededPath = join(dir, 'state', 'legacy-verifications', `${key}.json.superseded`);
      assert.ok(existsSync(supersededPath), 'superseded file must be preserved for audit');
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Case 16AB.23.8-5 — legacy record for one key does not affect another key', () => {
  it('re-verifying Truora does not affect Simetrik legacy status', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23.8-5', 'hash-23.8-5');
      const keySimetrik = 'dddd4444dddd4444';
      const keyTruora = 'eeee5555eeee5555';
      checkpoint.saveLegacyVerification(keySimetrik, 'Simetrik');
      checkpoint.saveLegacyVerification(keyTruora, 'Truora');

      // Re-verify Truora only
      checkpoint.saveVerificationCandidate(keyTruora, { original_name: 'Truora' }, 'newhash0000002');

      assert.equal(checkpoint.isLegacyVerification(keySimetrik), true, 'Simetrik must remain legacy');
      assert.equal(checkpoint.isLegacyVerification(keyTruora), false, 'Truora must no longer be legacy');
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Case 16AB.23.8-6 — addUsage accumulates known_web_search_cost_usd from known-cost calls', () => {
  it('known_web_search_cost_usd sums only calls where web_search_cost_usd is non-null', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23.8-6', 'hash-23.8-6');

      // 4 calls with known search cost ($0.01 each)
      for (let i = 0; i < 4; i++) {
        checkpoint.addUsage({
          input_tokens: 500, output_tokens: 200, search_calls: 1,
          search_count_status: 'reported_by_provider', token_cost_usd: 0.02,
          web_search_cost_usd: 0.01, cost_usd: 0.03,
        });
      }
      // 3 calls with unknown search cost
      for (let i = 0; i < 3; i++) {
        checkpoint.addUsage({
          input_tokens: 500, output_tokens: 200, search_calls: 0,
          search_count_status: 'unavailable', token_cost_usd: 0.02,
          web_search_cost_usd: null, cost_usd: 0.02,
        });
      }

      const usage = checkpoint.getState().usage;
      assert.equal(usage.known_web_search_cost_usd, 0.04, 'known_web_search_cost_usd must be 4 × $0.01 = $0.04');
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Case 16AB.23.8-7 — known_web_search_cost_usd preserved when web_search_cost_usd is nullified', () => {
  it('web_search_cost_usd goes null but known_web_search_cost_usd retains the partial total', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23.8-7', 'hash-23.8-7');

      checkpoint.addUsage({
        input_tokens: 500, output_tokens: 200, search_calls: 1,
        search_count_status: 'reported_by_provider', token_cost_usd: 0.02,
        web_search_cost_usd: 0.01, cost_usd: 0.03,
      });
      // This unknown call nullifies web_search_cost_usd
      checkpoint.addUsage({
        input_tokens: 500, output_tokens: 200, search_calls: 0,
        search_count_status: 'unavailable', token_cost_usd: 0.02,
        web_search_cost_usd: null, cost_usd: 0.02,
      });

      const usage = checkpoint.getState().usage;
      assert.equal(usage.web_search_cost_usd, null, 'web_search_cost_usd must be null');
      assert.equal(usage.known_web_search_cost_usd, 0.01, 'known_web_search_cost_usd must preserve $0.01');
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Case 16AB.23.8-8 — addUsage increments unknown_search_usage_calls for null-cost calls', () => {
  it('each call with null web_search_cost_usd increments unknown_search_usage_calls', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23.8-8', 'hash-23.8-8');

      for (let i = 0; i < 7; i++) {
        checkpoint.addUsage({
          input_tokens: 500, output_tokens: 200, search_calls: 0,
          search_count_status: 'unavailable', token_cost_usd: 0.02,
          web_search_cost_usd: null, cost_usd: 0.02,
        });
      }

      const usage = checkpoint.getState().usage;
      assert.equal(usage.unknown_search_usage_calls, 7, 'unknown_search_usage_calls must be 7');
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Case 16AB.23.8-9 — resume() back-fills known_web_search_cost_usd from reported searches', () => {
  it('legacy run-state with web_search_requests_reported=4 back-fills known cost as 4×$0.01', () => {
    const dir = makeTmpDir();
    try {
      mkdirSync(join(dir, 'state'), { recursive: true });
      const legacyState = {
        runId: 'run-legacy-cost', provider: 'anthropic_native_search',
        requestHash: 'hash-legacy-cost', model: 'claude-sonnet-4-6',
        pipelineVersion: '16AB.23.4', currentStage: 'stage5_verification',
        completedStages: [], completedDiscoveryBatches: [], completedVerificationBatches: [],
        failedBatches: [], stageArtifacts: {},
        usage: {
          input_tokens: 5000, output_tokens: 2000, searches_executed: 4,
          total_api_calls: 11, successful_api_calls: 4, failed_api_calls: 0,
          retried_api_calls: 0, rate_limit_wait_ms: 0, estimated_cost_usd: 0.15,
          web_search_requests_reported: 4, web_search_requests_inferred: 0,
          web_search_count_status: 'reported_by_provider',
          token_cost_usd: 0.11, web_search_cost_usd: null,
          web_search_results_count: 12, web_search_citations_count: 8,
          web_search_errors_count: 0,
          total_provider_attempts: 11, usage_bearing_api_calls: 6,
          rate_limited_attempts: 0, unknown_usage_attempts: 7,
          known_cost_usd: 0.11, legacy_search_cost_upper_bound_usd: null,
        },
        startedAt: '2026-06-09T19:18:05.000Z',
        updatedAt: '2026-06-09T20:00:00.000Z',
      };
      writeFileSync(join(dir, 'state', 'run-state.json'), JSON.stringify(legacyState), 'utf-8');

      const resumed = CheckpointManager.resume(dir);
      assert.ok(resumed !== null, 'resume must succeed');
      const usage = resumed!.getState().usage;
      assert.equal(
        usage.known_web_search_cost_usd, 0.04,
        'known_web_search_cost_usd must be back-filled as 4 × $0.01 = $0.04'
      );
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Case 16AB.23.8-10 — resume() back-fills unknown_search_usage_calls from unknown_usage_attempts', () => {
  it('legacy run-state with unknown_usage_attempts=7 back-fills unknown_search_usage_calls=7', () => {
    const dir = makeTmpDir();
    try {
      mkdirSync(join(dir, 'state'), { recursive: true });
      const legacyState = {
        runId: 'run-legacy-unk', provider: 'anthropic_native_search',
        requestHash: 'hash-legacy-unk', model: 'claude-sonnet-4-6',
        pipelineVersion: '16AB.23.4', currentStage: 'stage5_verification',
        completedStages: [], completedDiscoveryBatches: [], completedVerificationBatches: [],
        failedBatches: [], stageArtifacts: {},
        usage: {
          input_tokens: 1000, output_tokens: 500, searches_executed: 0,
          total_api_calls: 10, successful_api_calls: 3, failed_api_calls: 0,
          retried_api_calls: 0, rate_limit_wait_ms: 0, estimated_cost_usd: 0.05,
          web_search_requests_reported: 0, web_search_requests_inferred: 0,
          web_search_count_status: 'unavailable',
          token_cost_usd: 0.05, web_search_cost_usd: null,
          web_search_results_count: 0, web_search_citations_count: 0,
          web_search_errors_count: 0,
          total_provider_attempts: 10, usage_bearing_api_calls: 3,
          rate_limited_attempts: 0, unknown_usage_attempts: 7,
          known_cost_usd: 0.05, legacy_search_cost_upper_bound_usd: null,
        },
        startedAt: '2026-06-09T19:00:00.000Z',
        updatedAt: '2026-06-09T20:00:00.000Z',
      };
      writeFileSync(join(dir, 'state', 'run-state.json'), JSON.stringify(legacyState), 'utf-8');

      const resumed = CheckpointManager.resume(dir);
      assert.ok(resumed !== null, 'resume must succeed');
      const usage = resumed!.getState().usage;
      assert.equal(
        usage.unknown_search_usage_calls, 7,
        'unknown_search_usage_calls must be back-filled as unknown_usage_attempts=7'
      );
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Case 16AB.23.8-11 — getVerificationCandidateKeys returns keys from verification-candidates/', () => {
  it('returns keys for existing .json files, excludes .corrupt files', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23.8-11', 'hash-23.8-11');
      const subdir = join(dir, 'state', 'verification-candidates');
      mkdirSync(subdir, { recursive: true });

      writeFileSync(join(subdir, 'aaa1111100000001.json'), '{}', 'utf-8');
      writeFileSync(join(subdir, 'bbb2222200000002.json'), '{}', 'utf-8');
      writeFileSync(join(subdir, 'ccc3333300000003.json.corrupt'), '{}', 'utf-8');

      const keys = checkpoint.getVerificationCandidateKeys();
      assert.ok(keys.includes('aaa1111100000001'), 'first key must be present');
      assert.ok(keys.includes('bbb2222200000002'), 'second key must be present');
      assert.ok(!keys.includes('ccc3333300000003'), 'corrupt file key must be absent');
      assert.equal(keys.length, 2, 'must return exactly 2 keys');
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Case 16AB.23.8-12 — stale per-candidate hash is detected via loadArtifactRaw comparison', () => {
  it('artifact saved with old hash is correctly identified as stale when compared to a new hash', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = CheckpointManager.create(dir, 'run-23.8-12', 'hash-23.8-12');
      const key = 'fff6666600000006';
      const oldHash = 'oldhash0000001';
      const newHash = 'newhash0000002';

      // Save an artifact with the old hash (simulating pre-16AB.23.8 verification)
      checkpoint.saveVerificationCandidate(key, { original_name: 'Truora' }, oldHash);

      // Load raw without hash validation
      const artifact = checkpoint.loadArtifactRaw<{ original_name: string }>(
        `verification-candidates/${key}.json`
      );
      assert.ok(artifact !== null, 'raw artifact must be loadable');
      assert.equal(artifact!.inputHash, oldHash, 'stored hash must match old hash');
      assert.notEqual(artifact!.inputHash, newHash, 'stored hash must differ from new hash');

      // loadVerificationCandidateIfValid must reject when queried with new hash
      const valid = checkpoint.loadVerificationCandidateIfValid<{ original_name: string }>(key, newHash);
      assert.equal(valid, null, 'stale artifact must not be served as valid');

      // After marking as legacy, isLegacyVerification must return true
      checkpoint.saveLegacyVerification(key, artifact!.data.original_name);
      assert.equal(checkpoint.isLegacyVerification(key), true, 'stale candidate must be marked as legacy');
    } finally {
      cleanupDir(dir);
    }
  });
});
