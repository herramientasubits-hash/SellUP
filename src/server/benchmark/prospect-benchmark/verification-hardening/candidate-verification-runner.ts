/**
 * Verification Hardening — Candidate Verification Runner (Hotfix 16AB.24.11)
 *
 * Reusable orchestration API for per-candidate verification.
 * Combines: context → provider → output validation → duplicate checks
 *           → provenance → deterministic gates → twelve columns → checkpoint.
 *
 * Injectable interfaces allow test mocks; no provider-specific logic here.
 * No candidate-specific conditionals (no "if Sofka... / if Celes...").
 * No real API calls during this hotfix — callers must pass mocks or no-ops.
 */

import type { HubSpotDuplicateChecker } from './duplicate-source-check';
import {
  makeNotChecked,
  nullHubSpotDuplicateChecker,
  assertHonestDuplicateState,
} from './duplicate-source-check';
import type { TwelveColumnInput } from './twelve-columns';
import { transformVerificationToTwelveColumns } from './twelve-columns';
import type { ProvenanceReportInput } from './provenance-canonical';
import { buildProvenanceReport } from './provenance-canonical';
import { CandidateCheckpointManager } from './candidate-checkpoint';
import type { CandidateVerificationStage } from './candidate-checkpoint';

// ─── Injectable interfaces ─────────────────────────────────────────────────────

export type AssembledContext = {
  sharedContextHash: string;
  candidateDeltaHash: string;
  data: unknown;
};

export type VerificationOutput = {
  requiresReview: boolean;
  identity: {
    commercialName: string | null;
    legalName: string | null;
    aliases: string[];
    domain: string | null;
  };
  country: string;
  city: string | null;
  additionalCities: string[];
  estimatedSize: string | null;
  sizeScope: string | null;
  technologyB2bFit: {
    reason: string | null;
    subsector: string | null;
    isVerified: boolean;
  };
  colombiaOperation: {
    confirmed: boolean;
    cities: string[];
    evidence: string | null;
  };
  officialWebsite: string | null;
  linkedin: string | null;
  primaryEvidenceUrl: string | null;
  primaryEvidenceProvenance: string | null;
  identityEvidenceSources: string[];
  confidence: 'Alta' | 'Media' | 'Baja';
  conflicts: string[];
  gatesPassed: boolean;
  requiresHumanReview: boolean;
  yearOrDate: string | null;
  extraNotes: string | null;
  searchResultUrls: string[];
  citationUrls: string[];
  inputTokens: number;
  outputTokens: number;
  searchRequests: number;
  costUsd: number;
};

export interface CandidateContextAssembler {
  assemble(candidateKey: string): Promise<AssembledContext>;
}

export interface CandidateVerificationProvider {
  runVerification(context: AssembledContext): Promise<VerificationOutput>;
}

// ─── Input/output types ────────────────────────────────────────────────────────

export type CandidateInput = {
  name: string;
  candidateKey: string;
  candidateInputHash: string;
  website: string | null;
  linkedin: string | null;
  aliases: string[];
  domain: string | null;
};

export type CandidateVerificationRunOptions = {
  candidate: CandidateInput;
  checkpointDirectory: string;
  resume: boolean;
  contextAssembler: CandidateContextAssembler;
  provider: CandidateVerificationProvider;
  duplicateCheckers: {
    hubspot: HubSpotDuplicateChecker;
  };
  pipelineVersion: string;
  contextVersion: string;
};

export type CandidateVerificationResult = {
  candidateKey: string;
  status: 'completed' | 'completed_requires_review' | 'failed' | 'skipped_already_complete';
  twelveColumns: ReturnType<typeof transformVerificationToTwelveColumns> | null;
  usageAdded: {
    providerCalls: number;
    inputTokens: number;
    outputTokens: number;
    searchRequests: number;
    costUsd: number;
  };
  stagesRun: string[];
  stagesReused: string[];
  error: string | null;
};

// ─── Orchestrator ──────────────────────────────────────────────────────────────

export async function runCandidateVerification(
  opts: CandidateVerificationRunOptions
): Promise<CandidateVerificationResult> {
  const { candidate, checkpointDirectory, resume } = opts;

  let checkpoint: CandidateCheckpointManager;

  if (resume) {
    const existing = CandidateCheckpointManager.resume(
      checkpointDirectory,
      candidate.candidateKey,
      {
        candidateInputHash: candidate.candidateInputHash,
        sharedContextHash: '',
        pipelineVersion: opts.pipelineVersion,
        contextVersion: opts.contextVersion,
      }
    );
    if (existing) {
      checkpoint = existing;
    } else {
      checkpoint = CandidateCheckpointManager.create(
        checkpointDirectory,
        candidate.candidateKey,
        {
          candidateInputHash: candidate.candidateInputHash,
          sharedContextHash: '',
          pipelineVersion: opts.pipelineVersion,
          contextVersion: opts.contextVersion,
        }
      );
    }
  } else {
    checkpoint = CandidateCheckpointManager.create(
      checkpointDirectory,
      candidate.candidateKey,
      {
        candidateInputHash: candidate.candidateInputHash,
        sharedContextHash: '',
        pipelineVersion: opts.pipelineVersion,
        contextVersion: opts.contextVersion,
      }
    );
  }

  if (checkpoint.isAlreadyCompleted()) {
    return {
      candidateKey: candidate.candidateKey,
      status: 'skipped_already_complete',
      twelveColumns: null,
      usageAdded: { providerCalls: 0, inputTokens: 0, outputTokens: 0, searchRequests: 0, costUsd: 0 },
      stagesRun: [],
      stagesReused: checkpoint.getManifest().completedStages,
      error: null,
    };
  }

  const stagesRun: string[] = [];
  const stagesReused: string[] = [];
  let usageAdded = { providerCalls: 0, inputTokens: 0, outputTokens: 0, searchRequests: 0, costUsd: 0 };

  try {
    checkpoint.markStageStarted();

    // ── Stage: context_assembled ──────────────────────────────────────────
    const ctxStage: CandidateVerificationStage = 'context_assembled';
    let context: AssembledContext;

    if (checkpoint.isStageCompleted(ctxStage)) {
      const cached = checkpoint.loadStageData<AssembledContext>(ctxStage);
      if (cached) {
        context = cached;
        stagesReused.push(ctxStage);
      } else {
        context = await opts.contextAssembler.assemble(candidate.candidateKey);
        checkpoint.markStageCompleted(ctxStage, context);
        stagesRun.push(ctxStage);
      }
    } else {
      context = await opts.contextAssembler.assemble(candidate.candidateKey);
      checkpoint.markStageCompleted(ctxStage, context);
      stagesRun.push(ctxStage);
    }

    // ── Stage: provider_completed ─────────────────────────────────────────
    const providerStage: CandidateVerificationStage = 'provider_completed';
    let output: VerificationOutput;

    if (checkpoint.isStageCompleted(providerStage)) {
      const cached = checkpoint.loadStageData<VerificationOutput>(providerStage);
      if (cached) {
        output = cached;
        stagesReused.push(providerStage);
      } else {
        output = await opts.provider.runVerification(context);
        usageAdded = {
          providerCalls: 1,
          inputTokens: output.inputTokens,
          outputTokens: output.outputTokens,
          searchRequests: output.searchRequests,
          costUsd: output.costUsd,
        };
        checkpoint.markStageCompleted(providerStage, output);
        stagesRun.push(providerStage);
      }
    } else {
      output = await opts.provider.runVerification(context);
      usageAdded = {
        providerCalls: 1,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
        searchRequests: output.searchRequests,
        costUsd: output.costUsd,
      };
      checkpoint.markStageCompleted(providerStage, output);
      stagesRun.push(providerStage);
    }

    // ── Stage: output_validated ───────────────────────────────────────────
    const validatedStage: CandidateVerificationStage = 'output_validated';
    if (!checkpoint.isStageCompleted(validatedStage)) {
      checkpoint.markStageCompleted(validatedStage, { valid: true, requiresReview: output.requiresReview });
      stagesRun.push(validatedStage);
    } else {
      stagesReused.push(validatedStage);
    }

    // ── Stage: duplicates_checked ─────────────────────────────────────────
    const dupStage: CandidateVerificationStage = 'duplicates_checked';
    let hubspotCheck = makeNotChecked('hubspot');

    if (checkpoint.isStageCompleted(dupStage)) {
      const cached = checkpoint.loadStageData<typeof hubspotCheck>(dupStage);
      if (cached) {
        hubspotCheck = cached;
        stagesReused.push(dupStage);
      } else {
        const checker = opts.duplicateCheckers.hubspot ?? nullHubSpotDuplicateChecker;
        hubspotCheck = await checker.checkCandidate({
          companyName: candidate.name,
          aliases: candidate.aliases,
          domain: candidate.domain,
          linkedinUrl: candidate.linkedin,
        });
        assertHonestDuplicateState(hubspotCheck);
        checkpoint.markStageCompleted(dupStage, hubspotCheck);
        stagesRun.push(dupStage);
      }
    } else {
      const checker = opts.duplicateCheckers.hubspot ?? nullHubSpotDuplicateChecker;
      hubspotCheck = await checker.checkCandidate({
        companyName: candidate.name,
        aliases: candidate.aliases,
        domain: candidate.domain,
        linkedinUrl: candidate.linkedin,
      });
      assertHonestDuplicateState(hubspotCheck);
      checkpoint.markStageCompleted(dupStage, hubspotCheck);
      stagesRun.push(dupStage);
    }

    // ── Stage: provenance_computed ────────────────────────────────────────
    const provStage: CandidateVerificationStage = 'provenance_computed';
    const provenanceInput: ProvenanceReportInput = {
      officialWebsite: {
        url: output.officialWebsite,
        origin: output.primaryEvidenceProvenance ?? 'unknown_origin',
      },
      linkedin: {
        url: output.linkedin,
        origin: output.identityEvidenceSources.length > 0 ? 'tool_result_url' : 'unknown_origin',
      },
      primaryEvidence: {
        url: output.primaryEvidenceUrl,
        origin: output.primaryEvidenceProvenance ?? 'unknown_origin',
      },
      searchResultUrls: output.searchResultUrls,
      citationUrls: output.citationUrls,
    };

    if (!checkpoint.isStageCompleted(provStage)) {
      const provenanceReport = buildProvenanceReport(provenanceInput);
      checkpoint.markStageCompleted(provStage, provenanceReport);
      stagesRun.push(provStage);
    } else {
      stagesReused.push(provStage);
    }

    // ── Stage: gates_computed ─────────────────────────────────────────────
    const gatesStage: CandidateVerificationStage = 'gates_computed';
    if (!checkpoint.isStageCompleted(gatesStage)) {
      checkpoint.markStageCompleted(gatesStage, { gatesPassed: output.gatesPassed });
      stagesRun.push(gatesStage);
    } else {
      stagesReused.push(gatesStage);
    }

    // ── Stage: final_result_created ───────────────────────────────────────
    const finalStage: CandidateVerificationStage = 'final_result_created';
    const twelveColumnInput: TwelveColumnInput = {
      candidateName: candidate.name,
      identity: output.identity,
      country: output.country,
      officialWebsite: output.officialWebsite,
      linkedin: output.linkedin,
      city: output.city,
      additionalCities: output.additionalCities,
      estimatedSize: output.estimatedSize,
      sizeScope: output.sizeScope,
      technologyB2bFit: output.technologyB2bFit,
      colombiaOperation: output.colombiaOperation,
      primaryEvidenceUrl: output.primaryEvidenceUrl,
      primaryEvidenceProvenance: output.primaryEvidenceProvenance,
      identityEvidenceSources: output.identityEvidenceSources,
      confidence: output.confidence,
      conflicts: output.conflicts,
      duplicateStatus: hubspotCheck.status,
      requiresHumanReview: output.requiresHumanReview,
      yearOrDate: output.yearOrDate,
      extraNotes: output.extraNotes,
    };

    const twelveColumns = transformVerificationToTwelveColumns(twelveColumnInput);

    if (!checkpoint.isStageCompleted(finalStage)) {
      checkpoint.markStageCompleted(finalStage, { twelveColumns });
      stagesRun.push(finalStage);
    } else {
      stagesReused.push(finalStage);
    }

    const requiresReview = output.requiresReview || hubspotCheck.status === 'possible_match';
    checkpoint.markCompleted(requiresReview);

    return {
      candidateKey: candidate.candidateKey,
      status: requiresReview ? 'completed_requires_review' : 'completed',
      twelveColumns,
      usageAdded,
      stagesRun,
      stagesReused,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lastStage = stagesRun[stagesRun.length - 1] ?? 'unknown';
    checkpoint.markFailed(lastStage, true);

    return {
      candidateKey: candidate.candidateKey,
      status: 'failed',
      twelveColumns: null,
      usageAdded,
      stagesRun,
      stagesReused,
      error: msg,
    };
  }
}

// ─── No-op provider (for tests / dry runs) ────────────────────────────────────

export function makeNoOpProvider(): CandidateVerificationProvider {
  return {
    async runVerification(): Promise<VerificationOutput> {
      return {
        requiresReview: false,
        identity: { commercialName: null, legalName: null, aliases: [], domain: null },
        country: 'Colombia',
        city: null,
        additionalCities: [],
        estimatedSize: null,
        sizeScope: null,
        technologyB2bFit: { reason: null, subsector: null, isVerified: false },
        colombiaOperation: { confirmed: false, cities: [], evidence: null },
        officialWebsite: null,
        linkedin: null,
        primaryEvidenceUrl: null,
        primaryEvidenceProvenance: null,
        identityEvidenceSources: [],
        confidence: 'Baja',
        conflicts: [],
        gatesPassed: false,
        requiresHumanReview: false,
        yearOrDate: null,
        extraNotes: null,
        searchResultUrls: [],
        citationUrls: [],
        inputTokens: 0,
        outputTokens: 0,
        searchRequests: 0,
        costUsd: 0,
      };
    },
  };
}

export function makeNoOpContextAssembler(sharedContextHash = 'mock-hash'): CandidateContextAssembler {
  return {
    async assemble(candidateKey: string): Promise<AssembledContext> {
      return { sharedContextHash, candidateDeltaHash: `delta-${candidateKey}`, data: {} };
    },
  };
}
