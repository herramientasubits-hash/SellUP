/**
 * Verification Hardening — Per-Candidate Checkpoint (Hotfix 16AB.24.11)
 *
 * Durable, resumable checkpoints for the per-candidate verification workflow.
 *
 * Directory layout (under checkpointDirectory/<candidateKey>/):
 *   manifest.json
 *   stages/context_assembled.json
 *   stages/provider_completed.json
 *   stages/output_validated.json
 *   stages/duplicates_checked.json
 *   stages/provenance_computed.json
 *   stages/gates_computed.json
 *   stages/final_result_created.json
 *
 * Invariants:
 *   - Raw provider responses are NEVER stored
 *   - No scratch/ dependency at runtime
 *   - Idempotent: completed candidate with unchanged hashes adds 0 cost
 *   - Resume reuses completed stages; reruns only invalid ones
 *   - Changing any input hash invalidates downstream stages
 *   - Lock prevents concurrent workers; expired locks can be recovered
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
} from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

// ─── Stage names ───────────────────────────────────────────────────────────────

export const CANDIDATE_VERIFICATION_STAGES = [
  'context_assembled',
  'provider_completed',
  'output_validated',
  'duplicates_checked',
  'provenance_computed',
  'gates_computed',
  'final_result_created',
] as const;

export type CandidateVerificationStage = (typeof CANDIDATE_VERIFICATION_STAGES)[number];

const STAGE_ORDER: Record<CandidateVerificationStage, number> = {
  context_assembled: 0,
  provider_completed: 1,
  output_validated: 2,
  duplicates_checked: 3,
  provenance_computed: 4,
  gates_computed: 5,
  final_result_created: 6,
};

const CURRENT_MANIFEST_VERSION = 1;
const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

// ─── Manifest type ─────────────────────────────────────────────────────────────

export type CandidateVerificationManifest = {
  artifactVersion: number;
  pipelineVersion: string;
  contextVersion: string;

  candidateKey: string;
  candidateInputHash: string;
  sharedContextHash: string;
  candidateDeltaHash: string;
  outputSchemaHash: string;
  duplicateCheckConfigHash: string;

  status: 'pending' | 'processing' | 'completed' | 'completed_requires_review' | 'failed';

  completedStages: string[];
  failedStage: string | null;
  retryable: boolean;

  usageMerged: boolean;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;

  lockedAt: string | null;
  lockedBy: string | null;
  lockExpiration: string | null;
};

// ─── Stage artifact envelope ──────────────────────────────────────────────────

type StageArtifact<T> = {
  stage: string;
  candidateKey: string;
  inputHash: string;
  createdAt: string;
  data: T;
};

function isStageArtifact(v: unknown): v is StageArtifact<unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    'stage' in v &&
    'candidateKey' in v &&
    'inputHash' in v &&
    'data' in v
  );
}

// ─── Hash helpers ──────────────────────────────────────────────────────────────

export function computeManifestInputHashes(opts: {
  candidateKey: string;
  candidateInputHash: string;
  sharedContextHash: string;
  pipelineVersion: string;
  contextVersion: string;
  outputSchemaVersion?: string;
  duplicateCheckConfigVersion?: string;
}): { candidateDeltaHash: string; outputSchemaHash: string; duplicateCheckConfigHash: string } {
  const canonicalize = (v: unknown): string =>
    createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

  const candidateDeltaHash = canonicalize({
    candidateKey: opts.candidateKey,
    candidateInputHash: opts.candidateInputHash,
    sharedContextHash: opts.sharedContextHash,
  });

  const outputSchemaHash = canonicalize({
    pipelineVersion: opts.pipelineVersion,
    contextVersion: opts.contextVersion,
    outputSchemaVersion: opts.outputSchemaVersion ?? '1',
  });

  const duplicateCheckConfigHash = canonicalize({
    pipelineVersion: opts.pipelineVersion,
    duplicateCheckConfigVersion: opts.duplicateCheckConfigVersion ?? '1',
  });

  return { candidateDeltaHash, outputSchemaHash, duplicateCheckConfigHash };
}

// ─── CandidateCheckpointManager ───────────────────────────────────────────────

export class CandidateCheckpointManager {
  readonly candidateDir: string;
  private manifest: CandidateVerificationManifest;

  private constructor(candidateDir: string, manifest: CandidateVerificationManifest) {
    this.candidateDir = candidateDir;
    this.manifest = manifest;
  }

  // ─── Factory: new candidate ──────────────────────────────────────────────

  static create(
    checkpointDirectory: string,
    candidateKey: string,
    opts: {
      candidateInputHash: string;
      sharedContextHash: string;
      pipelineVersion: string;
      contextVersion: string;
      outputSchemaVersion?: string;
      duplicateCheckConfigVersion?: string;
    }
  ): CandidateCheckpointManager {
    const candidateDir = join(checkpointDirectory, candidateKey);
    mkdirSync(join(candidateDir, 'stages'), { recursive: true });

    const { candidateDeltaHash, outputSchemaHash, duplicateCheckConfigHash } =
      computeManifestInputHashes({
        candidateKey,
        ...opts,
      });

    const now = new Date().toISOString();
    const manifest: CandidateVerificationManifest = {
      artifactVersion: CURRENT_MANIFEST_VERSION,
      pipelineVersion: opts.pipelineVersion,
      contextVersion: opts.contextVersion,
      candidateKey,
      candidateInputHash: opts.candidateInputHash,
      sharedContextHash: opts.sharedContextHash,
      candidateDeltaHash,
      outputSchemaHash,
      duplicateCheckConfigHash,
      status: 'pending',
      completedStages: [],
      failedStage: null,
      retryable: true,
      usageMerged: false,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      lockedAt: null,
      lockedBy: null,
      lockExpiration: null,
    };

    const mgr = new CandidateCheckpointManager(candidateDir, manifest);
    mgr.persistManifest();
    return mgr;
  }

  // ─── Factory: resume existing ─────────────────────────────────────────────

  static resume(
    checkpointDirectory: string,
    candidateKey: string,
    currentInputHashes: {
      candidateInputHash: string;
      sharedContextHash: string;
      pipelineVersion: string;
      contextVersion: string;
    }
  ): CandidateCheckpointManager | null {
    const candidateDir = join(checkpointDirectory, candidateKey);
    const manifestPath = join(candidateDir, 'manifest.json');
    if (!existsSync(manifestPath)) return null;

    let manifest: CandidateVerificationManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as CandidateVerificationManifest;
    } catch {
      return null;
    }

    if (manifest.artifactVersion !== CURRENT_MANIFEST_VERSION) return null;

    // Detect input changes that require downstream invalidation
    const inputsChanged =
      manifest.candidateInputHash !== currentInputHashes.candidateInputHash ||
      manifest.sharedContextHash !== currentInputHashes.sharedContextHash ||
      manifest.pipelineVersion !== currentInputHashes.pipelineVersion;

    const contextVersionChanged = manifest.contextVersion !== currentInputHashes.contextVersion;

    if (inputsChanged || contextVersionChanged) {
      const invalidateFrom: CandidateVerificationStage | null = contextVersionChanged
        ? 'context_assembled'
        : 'context_assembled';

      const keepStages = invalidateFrom
        ? manifest.completedStages.filter(
            (s) =>
              STAGE_ORDER[s as CandidateVerificationStage] <
              STAGE_ORDER[invalidateFrom as CandidateVerificationStage]
          )
        : [];

      manifest.candidateInputHash = currentInputHashes.candidateInputHash;
      manifest.sharedContextHash = currentInputHashes.sharedContextHash;
      manifest.pipelineVersion = currentInputHashes.pipelineVersion;
      manifest.contextVersion = currentInputHashes.contextVersion;
      manifest.completedStages = keepStages;
      manifest.failedStage = null;
      manifest.status = 'pending';
      manifest.completedAt = null;

      const { candidateDeltaHash, outputSchemaHash, duplicateCheckConfigHash } =
        computeManifestInputHashes({
          candidateKey,
          candidateInputHash: currentInputHashes.candidateInputHash,
          sharedContextHash: currentInputHashes.sharedContextHash,
          pipelineVersion: currentInputHashes.pipelineVersion,
          contextVersion: currentInputHashes.contextVersion,
        });
      manifest.candidateDeltaHash = candidateDeltaHash;
      manifest.outputSchemaHash = outputSchemaHash;
      manifest.duplicateCheckConfigHash = duplicateCheckConfigHash;
    }

    manifest.updatedAt = new Date().toISOString();
    mkdirSync(join(candidateDir, 'stages'), { recursive: true });
    const mgr = new CandidateCheckpointManager(candidateDir, manifest);
    mgr.persistManifest();
    return mgr;
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  getManifest(): Readonly<CandidateVerificationManifest> {
    return this.manifest;
  }

  isStageCompleted(stage: CandidateVerificationStage): boolean {
    return this.manifest.completedStages.includes(stage);
  }

  isAlreadyCompleted(): boolean {
    return (
      this.manifest.status === 'completed' ||
      this.manifest.status === 'completed_requires_review'
    );
  }

  loadStageData<T>(stage: CandidateVerificationStage): T | null {
    const path = join(this.candidateDir, 'stages', `${stage}.json`);
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
      if (!isStageArtifact(raw)) return null;
      if (raw.candidateKey !== this.manifest.candidateKey) return null;
      return raw.data as T;
    } catch {
      try { renameSync(path, `${path}.corrupt`); } catch { /* ignore */ }
      return null;
    }
  }

  // ─── Writes ───────────────────────────────────────────────────────────────

  markStageStarted(): void {
    if (this.manifest.status === 'pending') {
      this.manifest.status = 'processing';
      this.persistManifest();
    }
  }

  markStageCompleted<T>(stage: CandidateVerificationStage, data: T): void {
    if (!this.manifest.completedStages.includes(stage)) {
      this.manifest.completedStages.push(stage);
    }

    const artifact: StageArtifact<T> = {
      stage,
      candidateKey: this.manifest.candidateKey,
      inputHash: this.manifest.candidateDeltaHash,
      createdAt: new Date().toISOString(),
      data,
    };
    const stagePath = join(this.candidateDir, 'stages', `${stage}.json`);
    writeFileSync(stagePath, JSON.stringify(artifact, null, 2), 'utf-8');

    this.persistManifest();
  }

  markCompleted(requiresReview = false): void {
    const now = new Date().toISOString();
    this.manifest.status = requiresReview ? 'completed_requires_review' : 'completed';
    this.manifest.completedAt = now;
    this.manifest.lockedAt = null;
    this.manifest.lockedBy = null;
    this.manifest.lockExpiration = null;
    this.persistManifest();
  }

  markFailed(stage: string, retryable = true): void {
    this.manifest.status = 'failed';
    this.manifest.failedStage = stage;
    this.manifest.retryable = retryable;
    this.manifest.lockedAt = null;
    this.manifest.lockedBy = null;
    this.manifest.lockExpiration = null;
    this.persistManifest();
  }

  markUsageMerged(): void {
    this.manifest.usageMerged = true;
    this.persistManifest();
  }

  // ─── Locking ──────────────────────────────────────────────────────────────

  acquireLock(workerId: string, ttlMs = DEFAULT_LOCK_TTL_MS): boolean {
    const now = Date.now();

    if (this.manifest.lockedAt && this.manifest.lockExpiration) {
      const expiry = new Date(this.manifest.lockExpiration).getTime();
      if (now < expiry) {
        return this.manifest.lockedBy === workerId;
      }
    }

    const nowIso = new Date(now).toISOString();
    const expiryIso = new Date(now + ttlMs).toISOString();
    this.manifest.lockedAt = nowIso;
    this.manifest.lockedBy = workerId;
    this.manifest.lockExpiration = expiryIso;
    this.manifest.status = 'processing';
    this.persistManifest();
    return true;
  }

  releaseLock(): void {
    this.manifest.lockedAt = null;
    this.manifest.lockedBy = null;
    this.manifest.lockExpiration = null;
    this.persistManifest();
  }

  isLocked(): boolean {
    if (!this.manifest.lockedAt || !this.manifest.lockExpiration) return false;
    return Date.now() < new Date(this.manifest.lockExpiration).getTime();
  }

  isLockExpired(): boolean {
    if (!this.manifest.lockedAt || !this.manifest.lockExpiration) return false;
    return Date.now() >= new Date(this.manifest.lockExpiration).getTime();
  }

  recoverExpiredLock(newWorkerId: string, ttlMs = DEFAULT_LOCK_TTL_MS): boolean {
    if (!this.isLockExpired()) return false;
    return this.acquireLock(newWorkerId, ttlMs);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private persistManifest(): void {
    this.manifest.updatedAt = new Date().toISOString();
    writeFileSync(
      join(this.candidateDir, 'manifest.json'),
      JSON.stringify(this.manifest, null, 2),
      'utf-8'
    );
  }
}
