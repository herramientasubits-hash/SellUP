/**
 * BR Receita CNPJ — synthetic owner artifact fixtures (BR-SOURCE-13C).
 *
 * BR-SOURCE-13A made "is this owner artifact complete, consistent and safe?" executable.
 * BR-SOURCE-13B made "may this request proceed to a controlled execution attempt review?"
 * executable. Neither could be exercised end to end without someone hand-typing fifty-one owner
 * fields, and no real owner artifact exists: every owner field in the 11W…12B packets still reads
 * `TBD_BY_OWNER`. This module supplies that missing input as SYNTHETIC data — a named set of
 * preflight requests, each one shaped to reach a specific 13A/13B verdict.
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   These fixtures demonstrate the synthetic flow. They are not owner decisions, they are not
 *   evidence, and the `synthetic-ready` fixture is not an approval. No fixture can grant real-data
 *   access, because the permissions it would need are typed as the literal `false` by 13B.
 *
 * ── This module NEVER (fail-closed by construction) ───────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - carries a real path, a real host, an address-shaped value, a credential, a CNPJ or a CPF.
 *   - carries a cap number: cap maxima are unapproved, so the cap field states a policy only.
 *   - imports anything at runtime. Its only imports are TYPE imports, so it contributes no
 *     executable dependency to any caller.
 *
 * Every builder returns a freshly constructed object, so callers can never mutate a shared fixture.
 */

import type {
  BrazilReceitaControlledExecutionPreflightEvidenceMode,
  BrazilReceitaControlledExecutionPreflightRequest,
  BrazilReceitaControlledExecutionPreflightSafetyFlag,
  BrazilReceitaControlledExecutionPreflightStage,
} from './br-receita-cnpj-controlled-execution-preflight-evaluator';
import type { OwnerDecisionArtifact } from './br-receita-cnpj-owner-decision-validator';

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/**
 * The named scenarios this module can build. One reaches `ready` / `GO`; every other one is a
 * refusal, each isolating a different reason a real submission could fail.
 */
export type BrazilReceitaSyntheticOwnerArtifactFixtureName =
  | 'synthetic-ready'
  | 'missing-owner-artifact'
  | 'placeholder-owner-artifact'
  | 'forbidden-content-owner-artifact'
  | 'missing-stage'
  | 'missing-safety-flag'
  | 'invalid-evidence-mode'
  | 'rejected-owner-decision'
  | 'deferred-owner-decision';

/** Every fixture name, in documentation order. The single source of truth for callers. */
export const BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_FIXTURE_NAMES: readonly BrazilReceitaSyntheticOwnerArtifactFixtureName[] =
  [
    'synthetic-ready',
    'missing-owner-artifact',
    'placeholder-owner-artifact',
    'forbidden-content-owner-artifact',
    'missing-stage',
    'missing-safety-flag',
    'invalid-evidence-mode',
    'rejected-owner-decision',
    'deferred-owner-decision',
  ] as const;

/**
 * The 13B review stage, restated as a literal because this module takes TYPE imports only. The
 * accompanying test asserts it still equals 13B's exported constant, so a rename cannot drift.
 */
const SYNTHETIC_REQUESTED_STAGE: BrazilReceitaControlledExecutionPreflightStage =
  'controlled_execution_attempt_review';

/** The inert evidence mode the synthetic flow uses. Dataset evidence is not an option. */
const SYNTHETIC_EVIDENCE_MODE: BrazilReceitaControlledExecutionPreflightEvidenceMode =
  'synthetic_only';

/**
 * The 13A placeholder token, restated for the same reason as the stage above. Its presence in a
 * field is proof the field was never completed.
 */
const SYNTHETIC_PLACEHOLDER_TOKEN = 'TBD_BY_OWNER';

/** The safety flag the `missing-safety-flag` fixture leaves unstated. */
const OMITTED_SAFETY_FLAG: BrazilReceitaControlledExecutionPreflightSafetyFlag = 'noRowReads';

/**
 * The two dates the fixtures use: a decision date and a later review date. Digits are safe here —
 * 13A never anchors a rule on digits outside the cap field.
 */
const SYNTHETIC_DECISION_DATE = '2026-08-04';
const SYNTHETIC_REVIEW_DATE = '2026-09-04';

/**
 * A forbidden-content marker assembled at runtime by joining harmless parts, so this source file
 * contains no path-shaped literal for a secret scanner (or a reader) to trip over. 13A refuses any
 * field carrying it.
 */
function buildForbiddenLocalPathMarker(): string {
  return ['', 'Users', ''].join('/');
}

// ─── Owner artifact builders ──────────────────────────────────────────────────

/**
 * A 13A-complete owner artifact: all four sections approved, every required field present, no
 * placeholder, no forbidden content, and a cap field that states a policy without a number.
 */
function buildCompleteOwnerArtifact(): OwnerDecisionArtifact {
  return {
    gate2: {
      decisionValue: 'approved',
      ownerRole: 'OWNER_ROLE_SYNTHETIC_GATE2',
      ownerReference: 'OWNER_REF_SYNTHETIC_GATE2',
      decisionDate: SYNTHETIC_DECISION_DATE,
      expirationOrReviewDate: SYNTHETIC_REVIEW_DATE,
      evidencePacketReference: 'EVIDENCE_REF_SYNTHETIC_PACKET',
      legalPrivacySecurityReference: 'LEGAL_REF_SYNTHETIC_PRIVACY_SECURITY',
      operatorReviewerRequirement: 'OPERATOR_REVIEWER_REQUIREMENT_SYNTHETIC',
      incidentEscalationReference: 'INCIDENT_REF_SYNTHETIC',
      stopConditionsAccepted: true,
    },
    gate7: {
      decisionValue: 'approved',
      ownerRole: 'OWNER_ROLE_SYNTHETIC_GATE7',
      ownerReference: 'OWNER_REF_SYNTHETIC_GATE7',
      decisionDate: SYNTHETIC_DECISION_DATE,
      expirationOrReviewDate: SYNTHETIC_REVIEW_DATE,
      operatorRole: 'OPERATOR_ROLE_SYNTHETIC',
      reviewerRole: 'REVIEWER_ROLE_SYNTHETIC',
      runbookReference: 'RUNBOOK_REF_SYNTHETIC',
      evidenceCaptureProcedure: 'EVIDENCE_CAPTURE_PROCEDURE_SYNTHETIC',
      sanitizerProcedure: 'SANITIZER_PROCEDURE_SYNTHETIC',
      cleanupProcedure: 'CLEANUP_PROCEDURE_SYNTHETIC',
      incidentPath: 'INCIDENT_REF_SYNTHETIC',
      escalationPath: 'ESCALATION_REF_SYNTHETIC',
      dryRunRehearsalReference: 'DRY_RUN_REHEARSAL_REF_SYNTHETIC',
      stopConditionsAccepted: true,
    },
    capInputPolicy: {
      decisionValue: 'approved',
      ownerRole: 'OWNER_ROLE_SYNTHETIC_CAP_INPUT',
      ownerReference: 'OWNER_REF_SYNTHETIC_CAP_INPUT',
      decisionDate: SYNTHETIC_DECISION_DATE,
      expirationOrReviewDate: SYNTHETIC_REVIEW_DATE,
      capMaximaDecision: 'CAP_POLICY_SYNTHETIC_APPROVED_WITHOUT_NUMERIC_VALUES',
      inputRootDecision: 'INPUT_ROOT_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      outputRootDecision: 'OUTPUT_ROOT_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      tempStorageDecision: 'TEMP_STORAGE_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      evidenceBucketDecision: 'EVIDENCE_BUCKET_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      familyAllowDenyDecision: 'FAMILY_ALLOW_DENY_SYNTHETIC_POLICY',
      manifestControlFilePolicyDecision: 'MANIFEST_CONTROL_SYNTHETIC_POLICY',
      exactPercentagePolicyDecision: 'EXACT_PERCENTAGE_SYNTHETIC_NOT_AUTHORIZED',
      fullDatasetDenominatorPolicyDecision: 'FULL_DENOMINATOR_SYNTHETIC_NOT_AUTHORIZED',
      coverageLanguageDecision: 'COVERAGE_LANGUAGE_SYNTHETIC_NO_EXACT_PERCENTAGE',
      legalPrivacySecurityReference: 'LEGAL_REF_SYNTHETIC_PRIVACY_SECURITY',
      stopConditionsAccepted: true,
    },
    controlledExecutionAttempt: {
      authorizationDecision: 'approved',
      ownerRole: 'OWNER_ROLE_SYNTHETIC_CONTROLLED',
      ownerReference: 'OWNER_REF_SYNTHETIC_CONTROLLED',
      decisionDate: SYNTHETIC_DECISION_DATE,
      expirationOrReviewDate: SYNTHETIC_REVIEW_DATE,
      scopeBoundary: 'SCOPE_BOUNDARY_SYNTHETIC_REVIEW_ONLY',
      stopConditionsAccepted: true,
    },
  };
}

/** Returns a copy of the complete artifact with one section patched. Never mutates the original. */
function withOwnerSection(
  section: keyof OwnerDecisionArtifact,
  patch: Record<string, unknown>,
): OwnerDecisionArtifact {
  const base = buildCompleteOwnerArtifact();
  return {
    ...base,
    [section]: { ...(base[section] as Record<string, unknown>), ...patch },
  } as OwnerDecisionArtifact;
}

// ─── Request builders ─────────────────────────────────────────────────────────

/**
 * The one request shape allowed to reach `ready` / `GO`: the review stage, an inert evidence mode,
 * and all eleven safety assertions stated explicitly as `true`.
 */
function buildSafeRequest(): BrazilReceitaControlledExecutionPreflightRequest {
  return {
    ownerDecisionArtifact: buildCompleteOwnerArtifact(),
    requestedStage: SYNTHETIC_REQUESTED_STAGE,
    dryRunOnly: true,
    noImport: true,
    noRuntime: true,
    noAgent1: true,
    noProviderCalls: true,
    noSupabaseWrites: true,
    noRealDataExecution: true,
    noManifestRead: true,
    noCsvRead: true,
    noZipRead: true,
    noRowReads: true,
    evidenceMode: SYNTHETIC_EVIDENCE_MODE,
  };
}

/** Returns a copy of the safe request with fields patched. Never mutates the original. */
function withRequest(
  patch: Record<string, unknown>,
): BrazilReceitaControlledExecutionPreflightRequest {
  return {
    ...buildSafeRequest(),
    ...patch,
  } as BrazilReceitaControlledExecutionPreflightRequest;
}

/** Returns a copy of the safe request with one key removed entirely, not set to `false`. */
function withoutRequestKey(key: string): BrazilReceitaControlledExecutionPreflightRequest {
  const base = buildSafeRequest() as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(base).filter(([entryKey]) => entryKey !== key),
  ) as BrazilReceitaControlledExecutionPreflightRequest;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/** Thrown for a fixture name this module does not recognize. */
export const BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_UNKNOWN_FIXTURE_CODE =
  'BRSOURCE13C_UNKNOWN_FIXTURE' as const;

/**
 * Builds the named synthetic preflight request.
 *
 * The returned value is synthetic input for BR-SOURCE-13B — never an owner decision, never
 * evidence, and never an authorization. Even `synthetic-ready` yields a request whose best possible
 * outcome is readiness for a controlled execution attempt REVIEW; real-data access, manifest/CSV/ZIP
 * reads, row reads, join, coverage, import, Supabase writes, runtime and Agent 1 all stay denied,
 * and Brazil stays blocked.
 *
 * @throws Error when `fixtureName` is not one of
 *   {@link BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_FIXTURE_NAMES}.
 */
export function buildBrazilReceitaSyntheticOwnerArtifactFixture(
  fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName,
): BrazilReceitaControlledExecutionPreflightRequest {
  switch (fixtureName) {
    // Complete artifact, complete request. The only fixture that can reach GO.
    case 'synthetic-ready':
      return buildSafeRequest();

    // No artifact at all: 13A reports OWNER_ARTIFACT_MISSING, 13B refuses on the delegated verdict.
    case 'missing-owner-artifact':
      return withRequest({ ownerDecisionArtifact: null });

    // An owner field that was never completed still holds the packet placeholder.
    case 'placeholder-owner-artifact':
      return withRequest({
        ownerDecisionArtifact: withOwnerSection('gate2', {
          evidencePacketReference: SYNTHETIC_PLACEHOLDER_TOKEN,
        }),
      });

    // An owner field carrying an absolute local path — refused as unsafe content, not stored.
    case 'forbidden-content-owner-artifact':
      return withRequest({
        ownerDecisionArtifact: withOwnerSection('gate7', {
          runbookReference: `RUNBOOK_REF_SYNTHETIC${buildForbiddenLocalPathMarker()}`,
        }),
      });

    // A request that never names the review stage has not asked for a stage 13B recognizes.
    case 'missing-stage':
      return withoutRequestKey('requestedStage');

    // A request silent about row reads has not ruled them out; absent and false block identically.
    case 'missing-safety-flag':
      return withoutRequestKey(OMITTED_SAFETY_FLAG);

    // Dataset evidence is not an accepted mode, however it is spelled.
    case 'invalid-evidence-mode':
      return withRequest({ evidenceMode: 'dataset_evidence' });

    // An explicit owner rejection. GATE-7 then also fails, because it cannot precede GATE-2.
    case 'rejected-owner-decision':
      return withRequest({
        ownerDecisionArtifact: withOwnerSection('gate2', { decisionValue: 'rejected' }),
      });

    // A deferral is not an approval, so the controlled execution attempt loses a prerequisite.
    case 'deferred-owner-decision':
      return withRequest({
        ownerDecisionArtifact: withOwnerSection('capInputPolicy', { decisionValue: 'deferred' }),
      });

    default: {
      const unknownName: string = fixtureName;
      throw new Error(
        `${BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_UNKNOWN_FIXTURE_CODE}: unknown synthetic owner artifact fixture "${unknownName}". Known fixtures: ${BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_FIXTURE_NAMES.join(', ')}.`,
      );
    }
  }
}
