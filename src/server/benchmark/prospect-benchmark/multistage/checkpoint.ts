/**
 * Multistage Orchestrator — Checkpoint Manager (16AB.23.3 / 16AB.23.4 / 16AB.23.7)
 *
 * Persists run state to scratch/.../<runId>/state/ after every mutation.
 * Each batch gets its own file. Corrupt files are renamed and retried.
 *
 * 16AB.23.4 additions:
 *   - saveArtifact / loadArtifactIfValid: envelope-based cache with inputHash validation
 *   - saveVerificationCandidate / loadVerificationCandidateIfValid: per-candidate cache
 *   - updateStageArtifact: tracks per-stage inputHash and status in RunState
 *
 * 16AB.23.7 — Separated budget model:
 *   - addUsage(usage, errorCode?) now categorises each call:
 *       usage_bearing_api_calls  — token usage present (consumption gate)
 *       rate_limited_attempts    — 429 with zero tokens (NOT against consumption budget)
 *       unknown_usage_attempts   — error with ambiguous usage
 *   - withinBudget() replaced by composed gates:
 *       canMakeProviderAttempt() — invocation-level attempt budget
 *       hasRunConsumptionBudget() — run-level usage-bearing call budget
 *       hasMonetaryBudget()      — cost gate (+ conservative legacy upper bound)
 *       hasRateLimitWaitBudget() — per-invocation rate-limit wait ceiling
 *   - withinBudget() = AND of all four; only called before real API calls
 *   - InvocationBudgetState resets to zero on every create() or resume()
 *   - Legacy run-state migration: back-fills new fields from existing counters
 *   - Per-invocation summary persisted to state/invocations/<id>.json
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import type {
  BatchUsage,
  CheckpointArtifact,
  InvocationBudgetState,
  RunState,
  StageArtifactMeta,
} from './ms-types';
import type { MultistageErrorCode } from './ms-types';
import type { AnthropicWebSearchAudit, SearchCountStatus } from './web-search-audit';
import { degradeSearchCountStatus } from './web-search-audit';
import { MULTISTAGE_CONFIG, COST_RATES } from './config';
import { CURRENT_ARTIFACT_VERSION } from './artifact-hash';

function zeroPad(n: number): string {
  return String(n + 1).padStart(2, '0');
}

function isCheckpointArtifact(v: unknown): v is CheckpointArtifact<unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    'artifactVersion' in v &&
    typeof (v as Record<string, unknown>)['artifactVersion'] === 'number' &&
    'inputHash' in v &&
    typeof (v as Record<string, unknown>)['inputHash'] === 'string' &&
    'data' in v
  );
}

function makeInvocationId(): string {
  return `inv-${Date.now().toString(36)}`;
}

export class CheckpointManager {
  readonly stateDir: string;
  private state: RunState;
  private checkpointCount = 0;
  private invocationBudget: InvocationBudgetState;

  private constructor(stateDir: string, state: RunState, invocationBudget: InvocationBudgetState) {
    this.stateDir = stateDir;
    this.state = state;
    this.invocationBudget = invocationBudget;
  }

  static create(outputDir: string, runId: string, requestHash: string): CheckpointManager {
    const stateDir = join(outputDir, 'state');
    mkdirSync(stateDir, { recursive: true });
    const state: RunState = {
      runId,
      provider: 'anthropic_native_search',
      requestHash,
      model: MULTISTAGE_CONFIG.model,
      pipelineVersion: MULTISTAGE_CONFIG.pipeline_version,
      currentStage: 'initialized',
      completedStages: [],
      completedDiscoveryBatches: [],
      completedVerificationBatches: [],
      failedBatches: [],
      stageArtifacts: {},
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        searches_executed: 0,
        total_api_calls: 0,
        successful_api_calls: 0,
        failed_api_calls: 0,
        retried_api_calls: 0,
        rate_limit_wait_ms: 0,
        estimated_cost_usd: 0,
        web_search_requests_reported: 0,
        web_search_requests_inferred: 0,
        web_search_count_status: 'unavailable',
        token_cost_usd: 0,
        web_search_cost_usd: 0,
        web_search_results_count: 0,
        web_search_citations_count: 0,
        web_search_errors_count: 0,
        // 16AB.23.7
        total_provider_attempts: 0,
        usage_bearing_api_calls: 0,
        rate_limited_attempts: 0,
        unknown_usage_attempts: 0,
        known_cost_usd: 0,
        legacy_search_cost_upper_bound_usd: null,
      },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const invBudget = makeEmptyInvocationBudget(false);
    const mgr = new CheckpointManager(stateDir, state, invBudget);
    mgr.persist();
    return mgr;
  }

  static resume(outputDir: string): CheckpointManager | null {
    const stateDir = join(outputDir, 'state');
    const path = join(stateDir, 'run-state.json');
    if (!existsSync(path)) return null;
    try {
      const state = JSON.parse(readFileSync(path, 'utf-8')) as RunState;
      // Ensure stageArtifacts exists on legacy run states
      if (!state.stageArtifacts) state.stageArtifacts = {};

      const u = state.usage;

      // Back-fill 16AB.23.5 web search fields
      if (u.web_search_requests_reported === undefined) u.web_search_requests_reported = 0;
      if (u.web_search_requests_inferred === undefined) u.web_search_requests_inferred = 0;
      if (u.web_search_count_status === undefined) u.web_search_count_status = 'unavailable';
      if (u.token_cost_usd === undefined) u.token_cost_usd = 0;
      if (u.web_search_cost_usd === undefined) u.web_search_cost_usd = null;
      if (u.web_search_results_count === undefined) u.web_search_results_count = 0;
      if (u.web_search_citations_count === undefined) u.web_search_citations_count = 0;
      if (u.web_search_errors_count === undefined) u.web_search_errors_count = 0;

      // Back-fill 16AB.23.7 separated counters
      if (u.total_provider_attempts === undefined) {
        u.total_provider_attempts = u.total_api_calls;
      }
      if (u.usage_bearing_api_calls === undefined) {
        // Conservative: only confirmed-successful calls had usage
        u.usage_bearing_api_calls = u.successful_api_calls;
      }
      if (u.rate_limited_attempts === undefined) {
        // Count from failedBatches where errorCode === 'rate_limit' as lower bound.
        // Use failed_api_calls as upper bound (may include non-rate-limit errors).
        const rateLimitBatchFailures = state.failedBatches.filter(
          (fb) => fb.errorCode === 'rate_limit'
        ).length;
        // Use the larger of the two estimates conservatively — we don't know for sure.
        u.rate_limited_attempts = Math.max(rateLimitBatchFailures, u.failed_api_calls);
      }
      if (u.unknown_usage_attempts === undefined) {
        u.unknown_usage_attempts = 0;
      }
      if (u.known_cost_usd === undefined) {
        // estimated_cost_usd already only accumulated from actual token usage (429s add 0)
        u.known_cost_usd = u.estimated_cost_usd;
      }
      if (u.legacy_search_cost_upper_bound_usd === undefined) {
        // Compute conservative upper bound for pre-16AB.23.5 runs where search cost is unknown.
        // Only applies when web_search_count_status is 'unavailable' and there were real calls.
        if (u.web_search_count_status === 'unavailable' && u.usage_bearing_api_calls > 0) {
          const maxSearchesPerCall = Math.max(
            MULTISTAGE_CONFIG.max_searches_per_discovery_call,
            MULTISTAGE_CONFIG.max_searches_per_verification_call
          );
          u.legacy_search_cost_upper_bound_usd =
            u.usage_bearing_api_calls * maxSearchesPerCall * COST_RATES.web_search_per_request;
        } else {
          u.legacy_search_cost_upper_bound_usd = null;
        }
      }

      // Invocation budget starts fresh on every resume
      const invBudget = makeEmptyInvocationBudget(true);
      return new CheckpointManager(stateDir, state, invBudget);
    } catch {
      return null;
    }
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  getState(): Readonly<RunState> { return this.state; }
  getCheckpointCount(): number { return this.checkpointCount; }
  getInvocationBudget(): Readonly<InvocationBudgetState> { return this.invocationBudget; }

  isStageCompleted(stage: string): boolean {
    return this.state.completedStages.includes(stage);
  }

  isDiscoveryBatchCompleted(idx: number): boolean {
    return this.state.completedDiscoveryBatches.includes(idx);
  }

  isVerificationBatchCompleted(idx: number): boolean {
    return this.state.completedVerificationBatches.includes(idx);
  }

  // ─── Budget gates (16AB.23.7) ──────────────────────────────────────────────

  /** True when this invocation still has attempt budget. Resets on each CLI run or --resume. */
  canMakeProviderAttempt(): boolean {
    return this.invocationBudget.attempts < MULTISTAGE_CONFIG.max_provider_attempts_per_invocation;
  }

  /** True when the run has not yet reached the usage-bearing call ceiling. */
  hasRunConsumptionBudget(): boolean {
    const u = this.state.usage;
    return (
      u.usage_bearing_api_calls < MULTISTAGE_CONFIG.max_usage_bearing_api_calls_per_run &&
      u.searches_executed < MULTISTAGE_CONFIG.max_total_search_tool_uses
    );
  }

  /** True when cumulative cost (known + conservative legacy bound) is below ceiling. */
  hasMonetaryBudget(): boolean {
    const u = this.state.usage;
    const effectiveCost = u.known_cost_usd + (u.legacy_search_cost_upper_bound_usd ?? 0);
    return effectiveCost < MULTISTAGE_CONFIG.max_cost_usd;
  }

  /** True when this invocation has not yet exceeded the rate-limit wait ceiling. */
  hasRateLimitWaitBudget(): boolean {
    return this.invocationBudget.rateLimitWaitMs < MULTISTAGE_CONFIG.max_rate_limit_wait_ms_per_invocation;
  }

  /**
   * Composite gate — all conditions must hold before making a real provider call.
   * NEVER call this before reading from cache.
   */
  withinBudget(): boolean {
    return (
      this.canMakeProviderAttempt() &&
      this.hasRunConsumptionBudget() &&
      this.hasMonetaryBudget() &&
      this.hasRateLimitWaitBudget()
    );
  }

  /** Returns a human-readable reason for the first exhausted budget condition. */
  budgetExhaustedReason(): string | null {
    if (!this.canMakeProviderAttempt()) return 'invocation_attempts';
    if (!this.hasRunConsumptionBudget()) return 'usage_calls';
    if (!this.hasMonetaryBudget()) return 'monetary';
    if (!this.hasRateLimitWaitBudget()) return 'rate_limit_wait';
    return null;
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  markStageStarted(stage: string): void {
    this.state.currentStage = stage;
    this.persist();
  }

  markStageCompleted(stage: string): void {
    if (!this.state.completedStages.includes(stage)) {
      this.state.completedStages.push(stage);
    }
    this.persist();
  }

  markDiscoveryBatchCompleted(idx: number): void {
    if (!this.state.completedDiscoveryBatches.includes(idx)) {
      this.state.completedDiscoveryBatches.push(idx);
    }
    this.persist();
  }

  markVerificationBatchCompleted(idx: number): void {
    if (!this.state.completedVerificationBatches.includes(idx)) {
      this.state.completedVerificationBatches.push(idx);
    }
    this.persist();
  }

  recordBatchFailure(stage: string, batch: number, errorCode: string): void {
    this.state.failedBatches.push({ stage, batch, errorCode });
    this.persist();
  }

  /**
   * Accumulate usage from one callWithRetry result.
   *
   * 16AB.23.7: errorCode classifies the attempt:
   *   - rate_limit + no tokens → rate_limited_attempts (NOT consumption budget)
   *   - tokens present         → usage_bearing_api_calls (consumption budget)
   *   - other error + no tokens → unknown_usage_attempts
   *
   * Backward compat: callers omitting errorCode get treated as usage-bearing when
   * tokens > 0, unknown otherwise.
   */
  addUsage(u: BatchUsage, errorCode?: MultistageErrorCode | null): void {
    const usage = this.state.usage;
    usage.input_tokens += u.input_tokens;
    usage.output_tokens += u.output_tokens;
    usage.searches_executed += u.search_calls;
    // Keep legacy counter in sync
    usage.total_api_calls += 1;
    usage.estimated_cost_usd += u.cost_usd;
    usage.token_cost_usd += u.token_cost_usd;

    // 16AB.23.7 — categorise attempt
    usage.total_provider_attempts += 1;
    this.invocationBudget.attempts += 1;

    const hasUsage = u.input_tokens > 0 || u.output_tokens > 0;
    const isRateLimitNoUsage = errorCode === 'rate_limit' && !hasUsage;

    if (hasUsage) {
      usage.usage_bearing_api_calls += 1;
      usage.known_cost_usd += u.cost_usd;
      this.invocationBudget.incrementalKnownCostUsd += u.cost_usd;
    } else if (isRateLimitNoUsage) {
      usage.rate_limited_attempts += 1;
      this.invocationBudget.rateLimitedAttempts += 1;
    } else {
      // Error with no known usage or ambiguous case
      usage.unknown_usage_attempts += 1;
    }

    // Accumulate web search counts by status
    if (u.search_count_status === 'reported_by_provider') {
      usage.web_search_requests_reported += u.search_calls;
    } else if (u.search_count_status === 'inferred_from_blocks') {
      usage.web_search_requests_inferred += u.search_calls;
    }

    // Degrade web_search_count_status to worst seen
    const statuses: SearchCountStatus[] = [usage.web_search_count_status, u.search_count_status];
    usage.web_search_count_status = degradeSearchCountStatus(
      statuses.filter((s): s is SearchCountStatus => s !== undefined)
    );

    // Web search cost: null if any call was unavailable
    if (usage.web_search_cost_usd !== null) {
      if (u.web_search_cost_usd !== null) {
        usage.web_search_cost_usd = (usage.web_search_cost_usd ?? 0) + u.web_search_cost_usd;
      } else {
        usage.web_search_cost_usd = null;
      }
    }

    this.persist();
  }

  recordSuccess(): void {
    this.state.usage.successful_api_calls += 1;
    this.invocationBudget.successfulCalls += 1;
    this.persist();
  }

  recordFailure(): void {
    this.state.usage.failed_api_calls += 1;
    this.invocationBudget.failedCalls += 1;
    this.persist();
  }

  recordRetry(): void {
    this.state.usage.retried_api_calls += 1;
    this.invocationBudget.retries += 1;
    this.persist();
  }

  addRateLimitWait(ms: number): void {
    this.state.usage.rate_limit_wait_ms += ms;
    this.invocationBudget.rateLimitWaitMs += ms;
    this.persist();
  }

  // ─── Stage artifact tracking (16AB.23.4) ──────────────────────────────────

  /** Record the inputHash and status for a stage artifact in RunState. */
  updateStageArtifact(stage: string, inputHash: string, status: StageArtifactMeta['status']): void {
    if (!this.state.stageArtifacts) this.state.stageArtifacts = {};
    this.state.stageArtifacts[stage] = { inputHash, status };
    this.persist();
  }

  getStageArtifact(stage: string): StageArtifactMeta | undefined {
    return this.state.stageArtifacts?.[stage];
  }

  // ─── Artifact envelope I/O (16AB.23.4) ────────────────────────────────────

  /**
   * Save a derived artifact wrapped in an envelope containing its inputHash.
   * Path is relative to stateDir (may include a subdirectory).
   */
  saveArtifact<T>(name: string, stage: string, inputHash: string, data: T): void {
    const artifact: CheckpointArtifact<T> = {
      artifactVersion: CURRENT_ARTIFACT_VERSION,
      stage,
      inputHash,
      createdAt: new Date().toISOString(),
      data,
    };
    const fullPath = join(this.stateDir, name);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(artifact, null, 2), 'utf-8');
  }

  /**
   * Load a derived artifact only if:
   *   - The file exists
   *   - It has a valid envelope (not legacy)
   *   - artifactVersion === CURRENT_ARTIFACT_VERSION
   *   - inputHash === expectedInputHash
   *
   * Returns null for: missing, legacy (no envelope), version mismatch, hash mismatch, corrupt.
   * Corrupt files are renamed to .corrupt but NOT deleted.
   * Stale files (hash mismatch) are left in place for diagnostics.
   */
  loadArtifactIfValid<T>(name: string, expectedInputHash: string): T | null {
    const path = join(this.stateDir, name);
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
      if (!isCheckpointArtifact(raw)) {
        // Legacy artifact without envelope — stale, do not delete
        return null;
      }
      if (raw.artifactVersion !== CURRENT_ARTIFACT_VERSION) return null;
      if (raw.inputHash !== expectedInputHash) return null;
      return raw.data as T;
    } catch {
      try { renameSync(path, `${path}.corrupt`); } catch { /* ignore */ }
      return null;
    }
  }

  /**
   * Load the raw artifact data WITHOUT hash validation.
   * Used only for no-degradation checks — callers must NOT treat this data as
   * authoritative without verifying it is still coherent.
   * Returns null if missing, not an envelope, or corrupt.
   */
  loadArtifactRaw<T>(name: string): CheckpointArtifact<T> | null {
    const path = join(this.stateDir, name);
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
      if (!isCheckpointArtifact(raw)) return null;
      return raw as CheckpointArtifact<T>;
    } catch {
      return null;
    }
  }

  // ─── Per-candidate verification cache (16AB.23.4) ─────────────────────────

  /** Save a single verified candidate result keyed by stable candidate identity. */
  saveVerificationCandidate(key: string, data: unknown, inputHash: string): void {
    const subdir = join(this.stateDir, 'verification-candidates');
    mkdirSync(subdir, { recursive: true });
    const artifact: CheckpointArtifact<unknown> = {
      artifactVersion: CURRENT_ARTIFACT_VERSION,
      stage: 'stage5_verification',
      inputHash,
      createdAt: new Date().toISOString(),
      data,
    };
    writeFileSync(join(subdir, `${key}.json`), JSON.stringify(artifact, null, 2), 'utf-8');
  }

  /**
   * Load a per-candidate verification result only if valid.
   * Returns null if missing, legacy, version mismatch, hash mismatch, or corrupt.
   */
  loadVerificationCandidateIfValid<T>(key: string, expectedInputHash: string): T | null {
    const path = join(this.stateDir, 'verification-candidates', `${key}.json`);
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
      if (!isCheckpointArtifact(raw)) return null;
      if (raw.artifactVersion !== CURRENT_ARTIFACT_VERSION) return null;
      if (raw.inputHash !== expectedInputHash) return null;
      return raw.data as T;
    } catch {
      try { renameSync(path, `${path}.corrupt`); } catch { /* ignore */ }
      return null;
    }
  }

  // ─── Web search audit persistence (16AB.23.5) ─────────────────────────────

  /**
   * Persist a sanitized AnthropicWebSearchAudit for one stage call.
   * Stored under state/search-audit/<name>.json using the artifact envelope.
   * Never stores encrypted_content, encrypted_index, or raw API responses.
   */
  saveSearchAudit(name: string, stage: string, inputHash: string, audit: AnthropicWebSearchAudit): void {
    const subdir = join(this.stateDir, 'search-audit');
    mkdirSync(subdir, { recursive: true });
    const artifact: CheckpointArtifact<AnthropicWebSearchAudit> = {
      artifactVersion: CURRENT_ARTIFACT_VERSION,
      stage,
      inputHash,
      createdAt: new Date().toISOString(),
      data: audit,
    };
    writeFileSync(join(subdir, `${name}.json`), JSON.stringify(artifact, null, 2), 'utf-8');
  }

  /** Accumulate web search result/citation/error counts from an audit into RunUsage. */
  addWebSearchAuditCounts(audit: AnthropicWebSearchAudit): void {
    this.state.usage.web_search_results_count += audit.results.length;
    this.state.usage.web_search_citations_count += audit.citations.length;
    this.state.usage.web_search_errors_count += audit.errors.length;
    this.persist();
  }

  // ─── Invocation summary (16AB.23.7) ───────────────────────────────────────

  /** Persist a sanitized summary of this invocation's activity. No secrets, no raw responses. */
  saveInvocationSummary(finishedAt: string): void {
    const subdir = join(this.stateDir, 'invocations');
    mkdirSync(subdir, { recursive: true });
    const summary = {
      ...this.invocationBudget,
      finishedAt,
      runId: this.state.runId,
    };
    writeFileSync(
      join(subdir, `${this.invocationBudget.invocationId}.json`),
      JSON.stringify(summary, null, 2),
      'utf-8'
    );
  }

  // ─── Raw file I/O (discovery batches, plan, etc.) ─────────────────────────

  saveFile(name: string, data: unknown): void {
    writeFileSync(join(this.stateDir, name), JSON.stringify(data, null, 2), 'utf-8');
  }

  loadFile<T>(name: string): T | null {
    const path = join(this.stateDir, name);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch {
      try { renameSync(path, `${path}.corrupt`); } catch { /* ignore */ }
      return null;
    }
  }

  discoveryFile(idx: number): string { return `discovery-${zeroPad(idx)}.json`; }
  verificationFile(idx: number): string { return `verification-${zeroPad(idx)}.json`; }
  selectionFile(round: number): string { return `selection-round-${round}.json`; }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private persist(): void {
    this.state.updatedAt = new Date().toISOString();
    this.checkpointCount++;
    writeFileSync(
      join(this.stateDir, 'run-state.json'),
      JSON.stringify(this.state, null, 2),
      'utf-8'
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEmptyInvocationBudget(isResume: boolean): InvocationBudgetState {
  return {
    invocationId: makeInvocationId(),
    startedAt: new Date().toISOString(),
    isResume,
    attempts: 0,
    retries: 0,
    successfulCalls: 0,
    failedCalls: 0,
    rateLimitedAttempts: 0,
    rateLimitWaitMs: 0,
    incrementalKnownCostUsd: 0,
  };
}
