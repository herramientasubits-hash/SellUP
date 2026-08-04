/**
 * BR Receita CNPJ — controlled execution preflight evaluator (BR-SOURCE-13B).
 *
 * BR-SOURCE-13A turned "is this owner artifact complete, consistent and safe?" into a pure
 * function. That answer is necessary but not sufficient: a complete artifact still says nothing
 * about the *request* that carries it. 13B is that second half. Given a preflight request, it says
 * whether the request may proceed to a **controlled execution attempt review** — a documentary
 * step — and it refuses every request that is not explicitly dry-run, import-free, runtime-free,
 * Agent-1-free, provider-free, write-free and real-data-free.
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   13B may say "ready for controlled execution attempt review".
 *   13B may NEVER say "ready to execute real data".
 *
 * A `ready` / `GO` verdict names a *document* transition. It is not a gate approval, not a cap
 * approval, not an execution authorization, and not a statement that Brazil may read a byte of the
 * dataset. The nine real-data permissions on the result are typed as the literal `false`, so no
 * caller — and no future edit — can flip one without changing this module's public type.
 *
 * ── This evaluator NEVER (fail-closed by construction) ───────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - opens a Supabase client, writes to a database, or runs a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - approves a gate, authorizes a cap, or marks Brazil ready.
 *   - re-implements 13A's content rules; the owner artifact is delegated to 13A verbatim.
 *
 * Its only import is the 13A validator. It is a pure function: same input, same result, no side
 * effects, no mutation of the input.
 */

import {
  validateBrazilReceitaOwnerDecisionArtifact,
  type OwnerDecisionArtifact,
  type OwnerDecisionValidationResult,
} from './br-receita-cnpj-owner-decision-validator';

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/**
 * The only stage 13B recognizes. It is deliberately a review stage, not an execution stage: there
 * is no request shape that asks this evaluator for permission to touch real data.
 */
export const BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_STAGE =
  'controlled_execution_attempt_review' as const;

export type BrazilReceitaControlledExecutionPreflightStage =
  typeof BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_STAGE;

/**
 * Evidence a preflight request may cite. Both modes are inert: synthetic fixtures, or the owner
 * artifact already carried by the request. Neither admits dataset evidence.
 */
export type BrazilReceitaControlledExecutionPreflightEvidenceMode =
  | 'synthetic_only'
  | 'owner_artifact_only';

export const BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_EVIDENCE_MODES: readonly BrazilReceitaControlledExecutionPreflightEvidenceMode[] =
  ['synthetic_only', 'owner_artifact_only'] as const;

/**
 * Safety assertions the requester must make explicitly. Each one must read exactly `true`; absent
 * and `false` are treated identically, because a request that stays silent about import, runtime or
 * real data has not ruled it out.
 */
export type BrazilReceitaControlledExecutionPreflightSafetyFlag =
  | 'dryRunOnly'
  | 'noImport'
  | 'noRuntime'
  | 'noAgent1'
  | 'noProviderCalls'
  | 'noSupabaseWrites'
  | 'noRealDataExecution'
  | 'noManifestRead'
  | 'noCsvRead'
  | 'noZipRead'
  | 'noRowReads';

export const BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_REQUIRED_SAFETY_FLAGS: readonly BrazilReceitaControlledExecutionPreflightSafetyFlag[] =
  [
    'dryRunOnly',
    'noImport',
    'noRuntime',
    'noAgent1',
    'noProviderCalls',
    'noSupabaseWrites',
    'noRealDataExecution',
    'noManifestRead',
    'noCsvRead',
    'noZipRead',
    'noRowReads',
  ] as const;

/** Every finding code this evaluator can emit. The single source of truth for callers. */
export const BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_FINDING_CODES = {
  requestMissing: 'PREFLIGHT_REQUEST_MISSING',
  ownerValidationBlocked: 'OWNER_DECISION_VALIDATION_BLOCKED_PREFLIGHT',
  stageInvalid: 'PREFLIGHT_STAGE_INVALID',
  requiredSafetyFlagMissing: 'PREFLIGHT_REQUIRED_SAFETY_FLAG_MISSING',
  evidenceModeInvalid: 'PREFLIGHT_EVIDENCE_MODE_INVALID',
  isNotExecutionAuthorization: 'PREFLIGHT_IS_NOT_EXECUTION_AUTHORIZATION',
} as const;

const CODES = BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_FINDING_CODES;

// ─── Request and result shapes ────────────────────────────────────────────────

export type BrazilReceitaControlledExecutionPreflightRequest = {
  ownerDecisionArtifact?: OwnerDecisionArtifact | null;
  requestedStage?: BrazilReceitaControlledExecutionPreflightStage;
  dryRunOnly?: boolean;
  noImport?: boolean;
  noRuntime?: boolean;
  noAgent1?: boolean;
  noProviderCalls?: boolean;
  noSupabaseWrites?: boolean;
  noRealDataExecution?: boolean;
  noManifestRead?: boolean;
  noCsvRead?: boolean;
  noZipRead?: boolean;
  noRowReads?: boolean;
  evidenceMode?: BrazilReceitaControlledExecutionPreflightEvidenceMode;
};

export type BrazilReceitaControlledExecutionPreflightFinding = {
  code: string;
  severity: 'blocking' | 'warning' | 'info';
  message: string;
  field?: string;
};

export type BrazilReceitaControlledExecutionPreflightResult = {
  status: 'ready' | 'blocked';
  goNoGo: 'GO' | 'NO_GO';
  canProceedToControlledExecutionAttemptReview: boolean;

  canExecuteRealData: false;
  canReadManifest: false;
  canReadCsv: false;
  canReadZip: false;
  canReadRows: false;
  canImport: false;
  canWriteSupabase: false;
  canActivateRuntime: false;
  canActivateAgent1: false;

  ownerDecisionValidation: OwnerDecisionValidationResult;
  findings: BrazilReceitaControlledExecutionPreflightFinding[];
};

/**
 * The permissions this evaluator can never grant, in any code path. Frozen as literal `false` so
 * the result type itself forbids a `true`; a future edit that tried to grant one would have to
 * change this module's exported type, which no preflight is authorized to do.
 */
export const BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_ALWAYS_DENIED_PERMISSIONS = {
  canExecuteRealData: false,
  canReadManifest: false,
  canReadCsv: false,
  canReadZip: false,
  canReadRows: false,
  canImport: false,
  canWriteSupabase: false,
  canActivateRuntime: false,
  canActivateAgent1: false,
} as const;

/** The permission keys above, for callers that assert the whole set stays denied. */
export const BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_ALWAYS_DENIED_PERMISSION_KEYS: readonly (keyof typeof BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_ALWAYS_DENIED_PERMISSIONS)[] =
  [
    'canExecuteRealData',
    'canReadManifest',
    'canReadCsv',
    'canReadZip',
    'canReadRows',
    'canImport',
    'canWriteSupabase',
    'canActivateRuntime',
    'canActivateAgent1',
  ] as const;

// ─── Pure checks ──────────────────────────────────────────────────────────────

/** A request must be a present, plain object before any of its fields mean anything. */
function checkRequestPresence(
  request: unknown,
): readonly BrazilReceitaControlledExecutionPreflightFinding[] {
  if (request === undefined || request === null) {
    return [
      {
        code: CODES.requestMissing,
        severity: 'blocking',
        message: 'No controlled execution preflight request was provided.',
      },
    ];
  }

  if (typeof request !== 'object' || Array.isArray(request)) {
    return [
      {
        code: CODES.requestMissing,
        severity: 'blocking',
        message: 'The controlled execution preflight request must be an object.',
      },
    ];
  }

  return [];
}

/**
 * The owner artifact is delegated to 13A without reinterpretation. A GO here requires all three of
 * 13A's positive signals; any one of them missing blocks the preflight.
 */
function checkOwnerDecisionValidation(
  validation: OwnerDecisionValidationResult,
): readonly BrazilReceitaControlledExecutionPreflightFinding[] {
  const ownerArtifactPassed =
    validation.status === 'valid' &&
    validation.goNoGo === 'GO' &&
    validation.canProceedToControlledExecutionPreflight;

  if (ownerArtifactPassed) return [];

  return [
    {
      code: CODES.ownerValidationBlocked,
      severity: 'blocking',
      message:
        'The owner decision artifact did not pass BR-SOURCE-13A validation, so no controlled execution attempt review can be reached. See ownerDecisionValidation.findings for the reasons.',
      field: 'ownerDecisionArtifact',
    },
  ];
}

/** Only the review stage is recognized; an absent or unknown stage blocks. */
function checkRequestedStage(
  stage: unknown,
): readonly BrazilReceitaControlledExecutionPreflightFinding[] {
  if (stage === BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_STAGE) return [];

  return [
    {
      code: CODES.stageInvalid,
      severity: 'blocking',
      message: `The requested stage must be exactly ${BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_STAGE}. No other stage is evaluated here, and no stage grants real-data access.`,
      field: 'requestedStage',
    },
  ];
}

/** Every safety flag must be an explicit `true`. Absent and `false` block identically. */
function checkSafetyFlags(
  values: Record<string, unknown>,
): readonly BrazilReceitaControlledExecutionPreflightFinding[] {
  return BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_REQUIRED_SAFETY_FLAGS.filter(
    (flag) => values[flag] !== true,
  ).map((flag) => ({
    code: CODES.requiredSafetyFlagMissing,
    severity: 'blocking' as const,
    message: `Required safety assertion ${flag} must be stated explicitly as true. A request that omits it has not ruled the behaviour out.`,
    field: flag,
  }));
}

/** Only the two inert evidence modes are recognized; an absent or unknown mode blocks. */
function checkEvidenceMode(
  mode: unknown,
): readonly BrazilReceitaControlledExecutionPreflightFinding[] {
  if (
    typeof mode === 'string' &&
    (BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_EVIDENCE_MODES as readonly string[]).includes(
      mode,
    )
  ) {
    return [];
  }

  return [
    {
      code: CODES.evidenceModeInvalid,
      severity: 'blocking',
      message: `The evidence mode must be one of ${BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_EVIDENCE_MODES.join(' / ')}. Dataset evidence is not an accepted mode.`,
      field: 'evidenceMode',
    },
  ];
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Evaluates a controlled execution preflight request for Brazil Receita CNPJ.
 *
 * A `ready` / `GO` result states only that the request may proceed to a controlled execution
 * attempt **review**. It authorizes nothing: no gate is approved, no cap is set, and no execution,
 * real-data read, manifest read, import, Supabase write, runtime or Agent 1 path is opened. Brazil
 * stays blocked.
 */
export function evaluateBrazilReceitaControlledExecutionPreflight(
  request: BrazilReceitaControlledExecutionPreflightRequest | null | undefined,
): BrazilReceitaControlledExecutionPreflightResult {
  const requestFindings = checkRequestPresence(request);
  const values: Record<string, unknown> =
    requestFindings.length === 0 ? (request as unknown as Record<string, unknown>) : {};

  // 13A runs on every path, including an absent request, so the caller always receives its verdict.
  const ownerDecisionValidation = validateBrazilReceitaOwnerDecisionArtifact(
    (values.ownerDecisionArtifact as OwnerDecisionArtifact | null | undefined) ?? undefined,
  );

  const disclaimer: BrazilReceitaControlledExecutionPreflightFinding = {
    code: CODES.isNotExecutionAuthorization,
    severity: 'info',
    message:
      'A controlled execution preflight GO is readiness for a controlled execution attempt review only, never an execution authorization. Gates, caps, real-data access, manifest/CSV/ZIP reads, row reads, join, coverage, import, Supabase writes, runtime and Agent 1 all remain unapproved, and Brazil remains blocked.',
  };

  const findings: BrazilReceitaControlledExecutionPreflightFinding[] = [
    ...requestFindings,
    ...checkOwnerDecisionValidation(ownerDecisionValidation),
    ...checkRequestedStage(values.requestedStage),
    ...checkSafetyFlags(values),
    ...checkEvidenceMode(values.evidenceMode),
    disclaimer,
  ];

  const hasBlocking = findings.some((finding) => finding.severity === 'blocking');

  return {
    status: hasBlocking ? 'blocked' : 'ready',
    goNoGo: hasBlocking ? 'NO_GO' : 'GO',
    canProceedToControlledExecutionAttemptReview: !hasBlocking,
    ...BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_ALWAYS_DENIED_PERMISSIONS,
    ownerDecisionValidation,
    findings,
  };
}
