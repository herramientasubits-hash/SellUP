/**
 * Multistage Orchestrator — Main Entry Point (16AB.23.3 / 16AB.23.4)
 *
 * Executes 8 stages with checkpointing, resume, timeout, and rate-limit
 * handling. No single HTTP connection may exceed per_call_timeout_ms.
 *
 * 16AB.23.4 — Checkpoint coherence:
 *   - Derived artifacts (prefilter, dedup, selection) carry an inputHash envelope.
 *   - An artifact is only reused when its stored inputHash matches the current inputs.
 *   - Stage 5 uses per-candidate cache (see runStage5VerificationCandidates).
 *   - Legacy artifacts without envelope are treated as stale and recomputed.
 *   - On resume, legacy verification-XX.json files are migrated to per-candidate
 *     cache when the candidate identity can be matched to the current pool.
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
  runStage5VerificationCandidates,
  runReplacementDiscovery,
  verifiedToBenchmarkCandidate,
} from './stages';
import {
  computePrefilterInputHash,
  computeDedupInputHash,
  computeSelectionInputHash,
  computeVerificationCandidateInputHash,
  computeCandidateKey,
} from './artifact-hash';
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

// ─── Legacy migration (16AB.23.4) ────────────────────────────────────────────

/**
 * On resume, scan legacy verification-XX.json files and migrate matching
 * candidates to per-candidate cache. Only migrates when:
 *   1. The candidate appears in the current discovery pool (identity match).
 *   2. No valid per-candidate cache already exists for that candidate.
 *
 * This preserves verified results (e.g. Simetrik) across the hotfix upgrade
 * without requiring manual file edits.
 */
function migrateLegacyVerifications(
  checkpoint: CheckpointManager,
  currentPool: DiscoveryCandidate[],
  country: string
): void {
  // Build lookup: normalized name → discovery candidate
  const byNormName = new Map<string, DiscoveryCandidate>();
  for (const c of currentPool) {
    byNormName.set(c.name.toLowerCase().trim(), c);
  }

  for (let i = 0; i < 20; i++) {
    const legacy = checkpoint.loadFile<{ candidates: VerifiedCandidateResult[] }>(
      checkpoint.verificationFile(i)
    );
    if (!legacy?.candidates) continue;

    for (const verResult of legacy.candidates) {
      const original = byNormName.get(verResult.original_name.toLowerCase().trim());
      if (!original) continue;

      const key = computeCandidateKey(original);
      const inputHash = computeVerificationCandidateInputHash(
        original, country, MULTISTAGE_CONFIG.pipeline_version, MULTISTAGE_CONFIG.model
      );

      // Only migrate if per-candidate cache does not already hold a valid entry
      const existing = checkpoint.loadVerificationCandidateIfValid<VerifiedCandidateResult>(key, inputHash);
      if (!existing) {
        checkpoint.saveVerificationCandidate(key, verResult, inputHash);
      }
    }
  }
}

// ─── Stage 4 — External duplicate check ──────────────────────────────────────

async function runStage4ExternalDedup(
  pool: DiscoveryCandidate[],
  checkpoint: CheckpointManager,
  metrics: ExecutionMetrics
): Promise<{
  deduped: DiscoveryCandidate[];
  externalDuplicates: string[];
}> {
  const stageStart = Date.now();

  // 16AB.23.4: compute the expected inputHash for this pool.
  // Only reuse the cached artifact when its stored hash matches.
  const expectedInputHash = computeDedupInputHash(pool, MULTISTAGE_CONFIG.pipeline_version);

  const cached = checkpoint.loadArtifactIfValid<{
    deduped: DiscoveryCandidate[];
    externalDuplicates: string[];
  }>('deduplicated-pool.json', expectedInputHash);

  if (cached) {
    metrics.per_stage_duration_ms['stage4_dedup'] = 0;
    checkpoint.updateStageArtifact('stage4_dedup', expectedInputHash, 'completed');
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

  // Save with envelope so future resumes can validate coherence
  checkpoint.saveArtifact('deduplicated-pool.json', 'stage4_dedup', expectedInputHash, out);
  checkpoint.saveFile('external-duplicates.json', { external_duplicates: externalDuplicates });
  checkpoint.markStageCompleted('stage4_dedup');
  checkpoint.updateStageArtifact('stage4_dedup', expectedInputHash, 'completed');
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

  // 16AB.23.4: use inputHash to decide whether the cached prefilter is still valid.
  const prefilterInputHash = computePrefilterInputHash(allDiscovered, MULTISTAGE_CONFIG.pipeline_version);

  const cachedPrefilter = checkpoint.loadArtifactIfValid<{
    accepted: DiscoveryCandidate[];
    rejected: Array<{ candidate: DiscoveryCandidate; reason: string }>;
  }>('prefiltered-pool.json', prefilterInputHash);

  let prefilteredPool: DiscoveryCandidate[];
  let prefilterRejected: Array<{ candidate: DiscoveryCandidate; reason: string }>;

  if (cachedPrefilter) {
    prefilteredPool = cachedPrefilter.accepted;
    prefilterRejected = cachedPrefilter.rejected;
  } else {
    checkpoint.markStageStarted('stage3_prefilter');
    const result = runStage3Prefilter(allDiscovered);
    prefilteredPool = result.accepted;
    prefilterRejected = result.rejected;
    checkpoint.saveArtifact('prefiltered-pool.json', 'stage3_prefilter', prefilterInputHash, {
      accepted: prefilteredPool,
      rejected: prefilterRejected,
      stats: { total: allDiscovered.length, accepted: prefilteredPool.length, rejected: prefilterRejected.length },
    });
  }

  checkpoint.markStageCompleted('stage3_prefilter');
  checkpoint.updateStageArtifact('stage3_prefilter', prefilterInputHash, 'completed');
  metrics.per_stage_duration_ms['stage3_prefilter'] = Date.now() - prefilterStart;

  // ─── Stage 4: External Dedup ───────────────────────────────────────────────

  const { deduped: dedupedPool, externalDuplicates } = await runStage4ExternalDedup(
    prefilteredPool, checkpoint, metrics
  );

  // ─── Stage 5: Per-candidate Verification ──────────────────────────────────

  const verifyStart = Date.now();
  checkpoint.markStageStarted('stage5_verification');

  // 16AB.23.4: migrate any legacy verification-XX.json files to per-candidate cache
  // before running verification. This preserves previously verified candidates
  // (e.g. Simetrik) when resuming a run created before this hotfix.
  if (metrics.resumed_from_checkpoint) {
    migrateLegacyVerifications(checkpoint, allDiscovered, request.country);
  }

  const initialPool = dedupedPool.slice(0, MULTISTAGE_CONFIG.initial_verification_pool_size);
  const reservePool = dedupedPool.slice(MULTISTAGE_CONFIG.initial_verification_pool_size);

  // Per-candidate cache: Simetrik (or any previously verified candidate) will
  // be served from cache; only new/changed candidates trigger API calls.
  const allVerified: VerifiedCandidateResult[] = await runStage5VerificationCandidates(
    apiKey,
    initialPool,
    request.country,
    checkpoint,
    metrics,
    fetchFn,
    sleep
  );

  if (!checkpoint.withinBudget() && allVerified.length === 0) {
    stageErrors.push({ phase: 'stage5_verification', message: 'Budget exhausted', recoverable: false });
  }

  metrics.per_stage_duration_ms['stage5_verification'] = Date.now() - verifyStart;
  checkpoint.markStageCompleted('stage5_verification');

  // ─── Stage 6: Selection (deterministic) ───────────────────────────────────

  const selectionStart = Date.now();
  checkpoint.markStageStarted('stage6_selection');

  const acceptedVerified = allVerified.filter(
    (v) => v.is_real_company && v.operates_in_colombia && v.is_tech_b2b && v.confidence !== 'Baja' && !v.rejection_reason
  );

  // 16AB.23.4: selection is only reused when its inputHash matches the current
  // accepted candidate set. Growing the pool invalidates the old selection.
  const selectionInputHash = computeSelectionInputHash(
    acceptedVerified, request.requested_count, MULTISTAGE_CONFIG.pipeline_version
  );

  const cachedSelection = checkpoint.loadArtifactIfValid<{
    round: number;
    candidate_count: number;
    candidates: VerifiedCandidateResult[];
  }>(checkpoint.selectionFile(0), selectionInputHash);

  let finalCandidates: VerifiedCandidateResult[];

  if (cachedSelection) {
    finalCandidates = cachedSelection.candidates;
  } else {
    finalCandidates = acceptedVerified.slice(0, request.requested_count);
    checkpoint.saveArtifact(checkpoint.selectionFile(0), 'stage6_selection', selectionInputHash, {
      round: 0,
      candidate_count: finalCandidates.length,
      candidates: finalCandidates,
    });
  }

  checkpoint.markStageCompleted('stage6_selection');
  checkpoint.updateStageArtifact('stage6_selection', selectionInputHash, 'completed');
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

  // ── Cost calculation (16AB.23.5) ────────────────────────────────────────────
  // Token cost is always known when input_tokens > 0.
  // Web search cost is known only when web_search_count_status != 'unavailable'.
  const tokenCostUsd = usage.token_cost_usd > 0
    ? usage.token_cost_usd
    : usage.input_tokens > 0
      ? (usage.input_tokens / 1_000_000) * COST_RATES.input_per_million +
        (usage.output_tokens / 1_000_000) * COST_RATES.output_per_million
      : null;

  const webSearchCostUsd = usage.web_search_cost_usd;  // already null when unavailable

  const totalCostUsd = tokenCostUsd !== null
    ? tokenCostUsd + (webSearchCostUsd ?? 0)
    : null;

  const costStatus = !usage.input_tokens
    ? 'unavailable' as const
    : webSearchCostUsd === null
      ? 'partial_search_usage_unavailable' as const
      : 'estimated' as const;

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
      estimated_cost_usd: totalCostUsd,
      cost_status: costStatus,
      web_search_requests_reported: usage.web_search_requests_reported,
      web_search_requests_inferred: usage.web_search_requests_inferred,
      web_search_count_status: usage.web_search_count_status,
      token_cost_usd: tokenCostUsd,
      web_search_cost_usd: webSearchCostUsd,
      web_search_results_count: usage.web_search_results_count,
      web_search_citations_count: usage.web_search_citations_count,
      web_search_errors_count: usage.web_search_errors_count,
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
