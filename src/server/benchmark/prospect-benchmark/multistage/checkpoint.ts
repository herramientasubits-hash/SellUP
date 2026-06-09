/**
 * Multistage Orchestrator — Checkpoint Manager (16AB.23.3)
 *
 * Persists run state to scratch/.../<runId>/state/ after every mutation.
 * Each batch gets its own file. Corrupt files are renamed and retried.
 * Zero-dependency on AI providers.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import type { RunState } from './ms-types';
import { MULTISTAGE_CONFIG } from './config';

function zeroPad(n: number): string {
  return String(n + 1).padStart(2, '0');
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

  // ─── File I/O ──────────────────────────────────────────────────────────────

  saveFile(name: string, data: unknown): void {
    writeFileSync(join(this.stateDir, name), JSON.stringify(data, null, 2), 'utf-8');
  }

  loadFile<T>(name: string): T | null {
    const path = join(this.stateDir, name);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch {
      try { renameSync(path, `${path}.corrupt`); } catch {}
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
