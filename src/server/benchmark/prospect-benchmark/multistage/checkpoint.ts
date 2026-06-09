/**
 * Multistage Orchestrator — Checkpoint Manager (16AB.23.3 / 16AB.23.4)
 *
 * Persists run state to scratch/.../<runId>/state/ after every mutation.
 * Each batch gets its own file. Corrupt files are renamed and retried.
 *
 * 16AB.23.4 additions:
 *   - saveArtifact / loadArtifactIfValid: envelope-based cache with inputHash validation
 *   - saveVerificationCandidate / loadVerificationCandidateIfValid: per-candidate cache
 *   - updateStageArtifact: tracks per-stage inputHash and status in RunState
 *
 * Legacy artifacts (no envelope) are treated as stale and always recalculated.
 * Discovery batch files are exempt — they are controlled by completedDiscoveryBatches.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import type { CheckpointArtifact, RunState, StageArtifactMeta } from './ms-types';
import { MULTISTAGE_CONFIG } from './config';
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

export class CheckpointManager {
  readonly stateDir: string;
  private state: RunState;
  private checkpointCount = 0;

  private constructor(stateDir: string, state: RunState) {
    this.stateDir = stateDir;
    this.state = state;
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
      },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const mgr = new CheckpointManager(stateDir, state);
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
      return new CheckpointManager(stateDir, state);
    } catch {
      return null;
    }
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  getState(): Readonly<RunState> { return this.state; }
  getCheckpointCount(): number { return this.checkpointCount; }

  isStageCompleted(stage: string): boolean {
    return this.state.completedStages.includes(stage);
  }

  isDiscoveryBatchCompleted(idx: number): boolean {
    return this.state.completedDiscoveryBatches.includes(idx);
  }

  isVerificationBatchCompleted(idx: number): boolean {
    return this.state.completedVerificationBatches.includes(idx);
  }

  withinBudget(): boolean {
    const u = this.state.usage;
    return (
      u.total_api_calls < MULTISTAGE_CONFIG.max_total_api_calls &&
      u.searches_executed < MULTISTAGE_CONFIG.max_total_search_tool_uses &&
      u.estimated_cost_usd < MULTISTAGE_CONFIG.max_cost_usd
    );
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

  addUsage(u: { input_tokens: number; output_tokens: number; search_calls: number; cost_usd: number }): void {
    this.state.usage.input_tokens += u.input_tokens;
    this.state.usage.output_tokens += u.output_tokens;
    this.state.usage.searches_executed += u.search_calls;
    this.state.usage.total_api_calls += 1;
    this.state.usage.estimated_cost_usd += u.cost_usd;
    this.persist();
  }

  recordSuccess(): void {
    this.state.usage.successful_api_calls += 1;
    this.persist();
  }

  recordFailure(): void {
    this.state.usage.failed_api_calls += 1;
    this.persist();
  }

  recordRetry(): void {
    this.state.usage.retried_api_calls += 1;
    this.persist();
  }

  addRateLimitWait(ms: number): void {
    this.state.usage.rate_limit_wait_ms += ms;
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
