/**
 * Multistage Orchestrator — Main Entry Point (16AB.23.3)
 *
 * Executes 8 stages with checkpointing, resume, timeout, and rate-limit
 * handling. No single HTTP connection may exceed per_call_timeout_ms.
 *
 * Outputs state/ directory under the run's outputDir.
 * Returns ProviderRunResult — identical interface to the previous single-call provider.
 */

import { join } from 'path';
import { CheckpointManager } from './checkpoint';
import { MULTISTAGE_CONFIG, COST_RATES } from './config';
import {
  runStage1Plan,
  runStage2DiscoveryBatch,
  runStage3Prefilter,
  runStage5VerificationBatch,
  runReplacementDiscovery,
  verifiedToBenchmarkCandidate,
} from './stages';
import type { FetchFn } from './client';
import type {
  DiscoveryCandidate,
  ExecutionMetrics,
  SearchPlanOutput,
  VerifiedCandidateResult,
} from './ms-types';
import type { BenchmarkCandidate, BenchmarkRequest, ProviderRunResult, SearchPlan } from '../types';

const PROVIDER_ID = 'anthropic_native_search' as const;

// ─── Public options ───────────────────────────────────────────────────────────

export type MultistageOptions = {
  outputDir: string;
  resumeRunId?: string;
  fetchFn?: FetchFn;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function hashRequest(req: BenchmarkRequest): string {
  return Buffer.from(
    `${req.country}|${req.industry}|${req.requested_count}|${req.commercial_context}`
  ).toString('base64').slice(0, 24);
}

function buildEmptyMetrics(): ExecutionMetrics {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Stage 4 — External duplicate check (delegates to duplicate-checker) ─────

async function runStage4ExternalDedup(
  pool: DiscoveryCandidate[],
  checkpoint: CheckpointManager,
  startMs: number,
  metrics: ExecutionMetrics
): Promise<{
  deduped: DiscoveryCandidate[];
  externalDuplicates: string[];
}> {
  const stageStart = Date.now();

  // Read from cache if available
  const cached = checkpoint.loadFile<{
    deduped: DiscoveryCandidate[];
    externalDuplicates: string[];
  }>('deduplicated-pool.json');

  if (cached) {
    metrics.per_stage_duration_ms['stage4_dedup'] = 0;
    return cached;
  }

  checkpoint.markStageStarted('stage4_dedup');

  // Lazy-load duplicate checker (only available in server environment with DB)
  let checkDuplicate: ((opts: { name: string; website?: string; domain?: string; country?: string }) => Promise<{ status: string }>) | null = null;
  try {
    const mod = await import('@/server/agents/prospecting-toolkit/duplicate-checker');
    checkDuplicate = mod.checkCompanyDuplicate;
  } catch {
    // Not available in test/CLI environment — skip external dedup
  }

  const externalDuplicates: string[] = [];
  const deduped: DiscoveryCandidate[] = [];

  for (const c of pool) {
    if (checkDuplicate) {
      try {
        const domain = c.website
          ? (() => { try { return new URL(c.website).hostname.replace(/^www\./, ''); } catch { return undefined; } })()
          : undefined;
        const result = await checkDuplicate({
          name: c.name,
          website: c.website ?? undefined,
          domain,
          country: 'Colombia',
        });
        if (result.status === 'existing_in_sellup' || result.status === 'existing_in_hubspot') {
          externalDuplicates.push(c.name);
          continue;
        }
      } catch {
        // If checker fails, include candidate (prefer false negatives over false positives)
      }
    }
    deduped.push(c);
  }

  const out = { deduped, externalDuplicates };
  checkpoint.saveFile('deduplicated-pool.json', out);
  checkpoint.saveFile('external-duplicates.json', { external_duplicates: externalDuplicates });
  checkpoint.markStageCompleted('stage4_dedup');
  metrics.per_stage_duration_ms['stage4_dedup'] = Date.now() - stageStart;

  return out;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runMultistageProvider(
  request: BenchmarkRequest,
  apiKey: string,
  opts: MultistageOptions
): Promise<ProviderRunResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const overallStartMs = Date.now();
  const startedAt = new Date().toISOString();
  const metrics = buildEmptyMetrics();

  // ─── Resolve run ID and output dir ──────────────────────────────────────────

  let runId: string;
  let outputDir: string;
  let checkpoint: CheckpointManager;
  const requestHash = hashRequest(request);

  if (opts.resumeRunId) {
    runId = opts.resumeRunId;
    outputDir = opts.outputDir;
    const resumed = CheckpointManager.resume(outputDir);
    if (!resumed) {
      throw new Error(`Cannot resume: no checkpoint found in ${join(outputDir, 'state')}`);
    }
    // Validate that request matches
    const saved = resumed.getState();
    if (saved.requestHash !== requestHash) {
      throw new Error(
        `Resume failed: request hash mismatch. Expected ${saved.requestHash}, got ${requestHash}`
      );
    }
    checkpoint = resumed;
    metrics.resumed_from_checkpoint = true;
  } else {
    runId = buildRunId();
    outputDir = opts.outputDir;
    checkpoint = CheckpointManager.create(outputDir, runId, requestHash);
  }

  const overallController = new AbortController();
  const overallTimer = setTimeout(
    () => overallController.abort(),
    MULTISTAGE_CONFIG.overall_run_timeout_ms
  );

  try {
    return await executeStages(
      request,
      apiKey,
      checkpoint,
      metrics,
      overallStartMs,
      startedAt,
      runId,
      outputDir,
      fetchFn
    );
  } finally {
    clearTimeout(overallTimer);
    // Save final metrics
    metrics.checkpoint_count = checkpoint.getCheckpointCount();
    const state = checkpoint.getState();
    checkpoint.saveFile('../execution-summary.json', {
      runId,
      ...metrics,
      usage: state.usage,
    });
  }
}

async function executeStages(
  request: BenchmarkRequest,
  apiKey: string,
  checkpoint: CheckpointManager,
  metrics: ExecutionMetrics,
  overallStartMs: number,
  startedAt: string,
  runId: string,
  outputDir: string,
  fetchFn: FetchFn
): Promise<ProviderRunResult> {
  const stageErrors: Array<{ phase: string; message: string; recoverable: boolean }> = [];

  // ─── Stage 1: Search Plan ──────────────────────────────────────────────────

  const planStart = Date.now();
  const plan = await runStage1Plan(
    apiKey, request.country, request.industry, request.commercial_context,
    checkpoint, metrics, fetchFn
  );
  metrics.per_stage_duration_ms['stage1_plan'] = Date.now() - planStart;

  // Pause between calls
  if (metrics.total_api_calls > 0) await sleep(MULTISTAGE_CONFIG.inter_call_pause_ms);

  // ─── Stage 2: Discovery Batches ────────────────────────────────────────────

  const discoveryStart = Date.now();
  checkpoint.markStageStarted('stage2_discovery');

  const themes = plan?.batch_themes ?? [];
  const allDiscovered: DiscoveryCandidate[] = [];
  const allNames: string[] = [];

  for (let i = 0; i < MULTISTAGE_CONFIG.discovery_batch_count; i++) {
    const theme = themes[i] ?? `Tema ${i + 1} — tecnología B2B Colombia`;

    const batchCandidates = await runStage2DiscoveryBatch(
      apiKey, i, theme, request.country, request.commercial_context,
      [...allNames],
      checkpoint, metrics, fetchFn
    );

    allDiscovered.push(...batchCandidates);
    allNames.push(...batchCandidates.map((c) => c.name));

    if (!checkpoint.withinBudget()) {
      stageErrors.push({ phase: 'stage2_discovery', message: 'Budget exhausted', recoverable: false });
      break;
    }

    if (i < MULTISTAGE_CONFIG.discovery_batch_count - 1) {
      await sleep(MULTISTAGE_CONFIG.inter_call_pause_ms);
    }
  }

  metrics.per_stage_duration_ms['stage2_discovery'] = Date.now() - discoveryStart;
  checkpoint.markStageCompleted('stage2_discovery');
  checkpoint.saveFile('prefiltered-pool-raw.json', { candidates: allDiscovered });

  // ─── Stage 3: Deterministic Pre-filter ────────────────────────────────────

  const prefilterStart = Date.now();
  checkpoint.markStageStarted('stage3_prefilter');

  const { accepted: prefilteredPool, rejected: prefilterRejected } = runStage3Prefilter(allDiscovered);

  checkpoint.saveFile('prefiltered-pool.json', {
    accepted: prefilteredPool,
    rejected: prefilterRejected,
    stats: { total: allDiscovered.length, accepted: prefilteredPool.length, rejected: prefilterRejected.length },
  });
  checkpoint.markStageCompleted('stage3_prefilter');
  metrics.per_stage_duration_ms['stage3_prefilter'] = Date.now() - prefilterStart;

  // ─── Stage 4: External Dedup ───────────────────────────────────────────────

  const { deduped: dedupedPool, externalDuplicates } = await runStage4ExternalDedup(
    prefilteredPool, checkpoint, overallStartMs, metrics
  );

  // ─── Stage 5: Verification Batches ────────────────────────────────────────

  const verifyStart = Date.now();
  checkpoint.markStageStarted('stage5_verification');

  // Verify the best N candidates first (initial pool)
  const initialPool = dedupedPool.slice(0, MULTISTAGE_CONFIG.initial_verification_pool_size);
  const reservePool = dedupedPool.slice(MULTISTAGE_CONFIG.initial_verification_pool_size);

  const allVerified: VerifiedCandidateResult[] = [];

  for (let i = 0; i < initialPool.length; i += MULTISTAGE_CONFIG.verification_batch_size) {
    const batch = initialPool.slice(i, i + MULTISTAGE_CONFIG.verification_batch_size);
    const batchIdx = Math.floor(i / MULTISTAGE_CONFIG.verification_batch_size);

    const verified = await runStage5VerificationBatch(
      apiKey, batchIdx, batch, request.country,
      checkpoint, metrics, fetchFn
    );
    allVerified.push(...verified);

    if (!checkpoint.withinBudget()) {
      stageErrors.push({ phase: 'stage5_verification', message: 'Budget exhausted', recoverable: false });
      break;
    }

    await sleep(MULTISTAGE_CONFIG.inter_call_pause_ms);
  }

  metrics.per_stage_duration_ms['stage5_verification'] = Date.now() - verifyStart;
  checkpoint.markStageCompleted('stage5_verification');

  // ─── Stage 6: Selection (deterministic) ───────────────────────────────────

  const selectionStart = Date.now();
  checkpoint.markStageStarted('stage6_selection');

  const acceptedVerified = allVerified.filter(
    (v) => v.is_real_company && v.operates_in_colombia && v.is_tech_b2b && v.confidence !== 'Baja' && !v.rejection_reason
  );

  let finalCandidates = acceptedVerified.slice(0, request.requested_count);

  checkpoint.saveFile(checkpoint.selectionFile(0), {
    round: 0,
    candidate_count: finalCandidates.length,
    candidates: finalCandidates,
  });
  checkpoint.markStageCompleted('stage6_selection');
  metrics.per_stage_duration_ms['stage6_selection'] = Date.now() - selectionStart;

  // ─── Stage 7: Controlled Replacement ──────────────────────────────────────

  if (finalCandidates.length < request.requested_count) {
    const replacementStart = Date.now();
    checkpoint.markStageStarted('stage7_replacement');

    let replacementRound = 0;
    const allKnownNames = new Set(allDiscovered.map((c) => c.name.toLowerCase()));
    const remainingReserve = [...reservePool];

    while (
      finalCandidates.length < request.requested_count &&
      replacementRound < MULTISTAGE_CONFIG.max_replacement_rounds &&
      checkpoint.withinBudget()
    ) {
      replacementRound++;
      const needed = request.requested_count - finalCandidates.length;

      // Use reserve first
      if (remainingReserve.length > 0) {
        const toVerify = remainingReserve.splice(0, needed * MULTISTAGE_CONFIG.verification_batch_size);

        for (let i = 0; i < toVerify.length; i += MULTISTAGE_CONFIG.verification_batch_size) {
          const batch = toVerify.slice(i, i + MULTISTAGE_CONFIG.verification_batch_size);
          const batchIdx = 100 + replacementRound * 10 + Math.floor(i / MULTISTAGE_CONFIG.verification_batch_size);

          const verified = await runStage5VerificationBatch(
            apiKey, batchIdx, batch, request.country,
            checkpoint, metrics, fetchFn
          );
          const accepted = verified.filter(
            (v) => v.is_real_company && v.operates_in_colombia && v.is_tech_b2b && v.confidence !== 'Baja' && !v.rejection_reason
          );
          finalCandidates = [...finalCandidates, ...accepted];

          if (finalCandidates.length >= request.requested_count) break;
          await sleep(MULTISTAGE_CONFIG.inter_call_pause_ms);
        }
      } else if (checkpoint.withinBudget()) {
        // Reserve exhausted — try targeted discovery
        const newCandidates = await runReplacementDiscovery(
          apiKey, replacementRound,
          request.country, request.commercial_context,
          needed,
          Array.from(allKnownNames),
          checkpoint, metrics, fetchFn
        );

        if (newCandidates.length === 0) break;

        await sleep(MULTISTAGE_CONFIG.inter_call_pause_ms);
        const verifyBatchIdx = 200 + replacementRound;

        const verifiedNew = await runStage5VerificationBatch(
          apiKey, verifyBatchIdx, newCandidates.slice(0, needed),
          request.country, checkpoint, metrics, fetchFn
        );
        const acceptedNew = verifiedNew.filter(
          (v) => v.is_real_company && v.operates_in_colombia && v.is_tech_b2b && v.confidence !== 'Baja' && !v.rejection_reason
        );
        finalCandidates = [...finalCandidates, ...acceptedNew];
        newCandidates.forEach((c) => allKnownNames.add(c.name.toLowerCase()));
      } else {
        break;
      }

      checkpoint.saveFile(checkpoint.selectionFile(replacementRound), {
        round: replacementRound,
        candidate_count: finalCandidates.length,
        candidates: finalCandidates,
      });
    }

    checkpoint.markStageCompleted('stage7_replacement');
    metrics.per_stage_duration_ms['stage7_replacement'] = Date.now() - replacementStart;
  }

  // ─── Stage 8: Output ───────────────────────────────────────────────────────

  const topCandidates = finalCandidates.slice(0, request.requested_count);
  const benchmarkCandidates: BenchmarkCandidate[] = topCandidates.map((v) =>
    verifiedToBenchmarkCandidate(v, request.country, request.industry)
  );

  const state = checkpoint.getState();
  const usage = state.usage;

  const estimatedCost =
    (usage.input_tokens / 1_000_000) * COST_RATES.input_per_million +
    (usage.output_tokens / 1_000_000) * COST_RATES.output_per_million +
    (usage.searches_executed / 1_000) * COST_RATES.search_per_thousand;

  const status = !checkpoint.withinBudget() && benchmarkCandidates.length === 0
    ? 'error'
    : benchmarkCandidates.length > 0
      ? 'completed'
      : 'partial';

  if (!checkpoint.withinBudget() && benchmarkCandidates.length < request.requested_count) {
    stageErrors.push({
      phase: 'budget',
      message: `Budget exhausted: ${usage.total_api_calls} API calls, $${usage.estimated_cost_usd.toFixed(4)} cost`,
      recoverable: false,
    });
  }

  metrics.per_stage_duration_ms['stage8_output'] = 0;
  checkpoint.markStageCompleted('stage8_output');

  const searchPlan = buildSearchPlan(plan);

  return {
    provider: PROVIDER_ID,
    model: MULTISTAGE_CONFIG.model,
    status,
    request,
    search_plan: searchPlan,
    candidates_discovered: allDiscovered.length,
    candidates_rejected: allDiscovered.length - benchmarkCandidates.length,
    candidates: benchmarkCandidates,
    duplicate_results: externalDuplicates.map((name) => ({
      candidate_name: name,
      status: 'duplicate_sellup' as const,
    })),
    diversification: null,
    usage: {
      input_tokens: usage.input_tokens || null,
      output_tokens: usage.output_tokens || null,
      searches_executed: usage.searches_executed,
      estimated_cost_usd: usage.input_tokens > 0 ? estimatedCost : null,
      cost_status: usage.input_tokens > 0 ? 'estimated' : 'unavailable',
    },
    timings: {
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - overallStartMs,
    },
    errors: stageErrors,
  };
}

function buildSearchPlan(plan: SearchPlanOutput | null): SearchPlan | null {
  if (!plan) return null;
  return {
    subsectors: plan.subsectors,
    cities: plan.cities,
    queries_planned: plan.queries,
    sources_prioritized: plan.target_sources,
    exclusions: plan.exclusions,
    quality_criteria: ['evidencia Nivel A o B', 'Colombia confirmado', 'B2B verificado'],
    diversification_strategy: plan.diversity_strategy,
  };
}
