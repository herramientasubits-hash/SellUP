/**
 * BR Receita CNPJ — controlled execution preflight evaluator — tests (BR-SOURCE-13B).
 *
 * Two load-bearing properties:
 *
 *   1. Fail-closed. Every path that is not a fully safe, fully asserted request carrying a
 *      13A-valid owner artifact ends in `blocked` / `NO_GO` with
 *      `canProceedToControlledExecutionAttemptReview === false`.
 *   2. Ready is never execution. Even the single `ready` / `GO` fixture in this file returns every
 *      real-data permission as `false`, and says so in an `info` finding.
 *
 * 100% offline. No dataset, no manifest, no CSV, no ZIP, no row, no Supabase, no network, no
 * runtime, no provider, no Agent 1. The only file I/O is reading this repository's OWN evaluator
 * source for the static import guard at the end. Forbidden-content fixtures assemble their tokens by
 * CONCATENATION, so no path-shaped or credential-shaped literal exists in this source file.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_ALWAYS_DENIED_PERMISSION_KEYS as DENIED_KEYS,
  BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_EVIDENCE_MODES,
  BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_FINDING_CODES as CODES,
  BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_REQUIRED_SAFETY_FLAGS as SAFETY_FLAGS,
  BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_STAGE,
  evaluateBrazilReceitaControlledExecutionPreflight,
  type BrazilReceitaControlledExecutionPreflightRequest,
  type BrazilReceitaControlledExecutionPreflightResult,
} from '../br-receita-cnpj-controlled-execution-preflight-evaluator';
import type { OwnerDecisionArtifact } from '../br-receita-cnpj-owner-decision-validator';

// ─── Synthetic fixtures ───────────────────────────────────────────────────────

/**
 * A 13A-complete owner artifact. Every reference is an opaque synthetic label; the only digits live
 * in the date fields, which no rule forbids. Mirrors the 13A suite's fixture rather than importing
 * it, because this repository does not share helpers between test files.
 */
function buildSyntheticCompleteOwnerArtifact(): OwnerDecisionArtifact {
  return {
    gate1: {
      decisionValue: 'approved',
      legalPrivacyOwnerRole: 'OWNER_ROLE_SYNTHETIC_GATE1_LEGAL_PRIVACY',
      ownerReference: 'OWNER_REF_SYNTHETIC_GATE1',
      decisionDate: '2026-08-04',
      expirationOrReviewDate: '2026-11-04',
      dryRunImportScopeSeparationReference: 'SCOPE_SEPARATION_REF_SYNTHETIC_GATE1',
      evidencePacketReference: 'EVIDENCE_REF_SYNTHETIC_GATE1',
      stopConditionsAccepted: true,
    },
    gate2: {
      decisionValue: 'approved',
      ownerRole: 'OWNER_ROLE_SYNTHETIC_GATE2',
      ownerReference: 'OWNER_REF_SYNTHETIC_GATE2',
      decisionDate: '2026-08-04',
      expirationOrReviewDate: '2026-11-04',
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
      decisionDate: '2026-08-04',
      expirationOrReviewDate: '2026-11-04',
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
      decisionDate: '2026-08-04',
      expirationOrReviewDate: '2026-11-04',
      capMaximaDecision: 'CAP_POLICY_SYNTHETIC_APPROVED_WITHOUT_NUMERIC_VALUES',
      inputRootDecision: 'INPUT_ROOT_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      outputRootDecision: 'OUTPUT_ROOT_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      tempStorageDecision: 'TEMP_STORAGE_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      evidenceBucketDecision: 'EVIDENCE_BUCKET_SYNTHETIC_CLASS_APPROVED_WITHOUT_PATH',
      familyAllowDenyDecision: 'FAMILY_ALLOW_DENY_SYNTHETIC',
      manifestControlFilePolicyDecision: 'MANIFEST_CONTROL_FILE_POLICY_SYNTHETIC',
      exactPercentagePolicyDecision: 'EXACT_PERCENTAGE_POLICY_SYNTHETIC_FORBIDDEN',
      fullDatasetDenominatorPolicyDecision: 'FULL_DATASET_DENOMINATOR_POLICY_SYNTHETIC_FORBIDDEN',
      coverageLanguageDecision: 'COVERAGE_LANGUAGE_SYNTHETIC_QUALITATIVE_ONLY',
      legalPrivacySecurityReference: 'LEGAL_REF_SYNTHETIC_PRIVACY_SECURITY',
      stopConditionsAccepted: true,
    },
    controlledExecutionAttempt: {
      authorizationDecision: 'approved',
      ownerRole: 'OWNER_ROLE_SYNTHETIC_CONTROLLED',
      ownerReference: 'OWNER_REF_SYNTHETIC_CONTROLLED',
      decisionDate: '2026-08-04',
      expirationOrReviewDate: '2026-11-04',
      scopeBoundary: 'SCOPE_BOUNDARY_SYNTHETIC_DOCUMENT_PREFLIGHT_ONLY',
      stopConditionsAccepted: true,
    },
  };
}

/** The one request in this file that is allowed to reach `ready` / `GO`. */
function buildSyntheticSafeRequest(): BrazilReceitaControlledExecutionPreflightRequest {
  return {
    ownerDecisionArtifact: buildSyntheticCompleteOwnerArtifact(),
    requestedStage: BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_STAGE,
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
    evidenceMode: 'synthetic_only',
  };
}

/** Returns a copy of the safe request with fields patched. Never mutates the original. */
function withRequest(
  patch: Record<string, unknown>,
): BrazilReceitaControlledExecutionPreflightRequest {
  return {
    ...buildSyntheticSafeRequest(),
    ...patch,
  } as BrazilReceitaControlledExecutionPreflightRequest;
}

/** Returns a copy of the safe request with one key removed entirely. */
function withoutRequestKey(key: string): BrazilReceitaControlledExecutionPreflightRequest {
  const base = buildSyntheticSafeRequest() as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(base).filter(([entryKey]) => entryKey !== key),
  ) as BrazilReceitaControlledExecutionPreflightRequest;
}

/** Returns a copy of the complete owner artifact with one section patched. */
function withOwnerSection(
  section: keyof OwnerDecisionArtifact,
  patch: Record<string, unknown>,
): OwnerDecisionArtifact {
  const base = buildSyntheticCompleteOwnerArtifact();
  return {
    ...base,
    [section]: { ...(base[section] as Record<string, unknown>), ...patch },
  } as OwnerDecisionArtifact;
}

function codesOf(result: BrazilReceitaControlledExecutionPreflightResult): readonly string[] {
  return result.findings.map((finding) => finding.code);
}

function blockingOf(result: BrazilReceitaControlledExecutionPreflightResult): readonly string[] {
  return result.findings.filter((f) => f.severity === 'blocking').map((f) => f.code);
}

/** Asserts the shape every refusal must share. */
function assertBlocked(result: BrazilReceitaControlledExecutionPreflightResult): void {
  assert.equal(result.status, 'blocked');
  assert.equal(result.goNoGo, 'NO_GO');
  assert.equal(result.canProceedToControlledExecutionAttemptReview, false);
  assert.ok(blockingOf(result).length > 0, 'a refusal must carry at least one blocking finding');
}

/** Asserts that no real-data permission was granted, whatever the verdict. */
function assertNoRealDataPermissions(
  result: BrazilReceitaControlledExecutionPreflightResult,
): void {
  const permissions = result as unknown as Record<string, unknown>;
  for (const key of DENIED_KEYS) {
    assert.equal(permissions[key], false, `${key} must always be false`);
  }
}

// ─── 1–3. Absent, undefined and empty requests ────────────────────────────────

describe('BR-SOURCE-13B preflight evaluator — absent request', () => {
  it('blocks a null request', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight(null);
    assertBlocked(result);
    assert.ok(codesOf(result).includes(CODES.requestMissing));
    assertNoRealDataPermissions(result);
  });

  it('blocks an undefined request', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight(undefined);
    assertBlocked(result);
    assert.ok(codesOf(result).includes(CODES.requestMissing));
  });

  it('blocks an empty request object with one finding per unmet requirement', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight({});
    assertBlocked(result);

    const blocking = blockingOf(result);
    assert.ok(blocking.includes(CODES.ownerValidationBlocked));
    assert.ok(blocking.includes(CODES.stageInvalid));
    assert.ok(blocking.includes(CODES.evidenceModeInvalid));
    assert.equal(
      blocking.filter((code) => code === CODES.requiredSafetyFlagMissing).length,
      SAFETY_FLAGS.length,
      'every missing safety assertion must be reported individually',
    );
    assert.equal(
      codesOf(result).includes(CODES.requestMissing),
      false,
      'an empty object is present, so it is not a missing request',
    );
  });

  it('blocks a non-object request', () => {
    for (const value of ['controlled_execution_attempt_review', 7, true, []]) {
      const result = evaluateBrazilReceitaControlledExecutionPreflight(
        value as unknown as BrazilReceitaControlledExecutionPreflightRequest,
      );
      assertBlocked(result);
      assert.ok(codesOf(result).includes(CODES.requestMissing));
    }
  });
});

// ─── 4–5, 19–20. Owner artifact delegated to 13A ──────────────────────────────

describe('BR-SOURCE-13B preflight evaluator — owner artifact gate', () => {
  it('blocks a request with no owner artifact and surfaces the 13A verdict', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight(
      withoutRequestKey('ownerDecisionArtifact'),
    );
    assertBlocked(result);
    assert.deepEqual(blockingOf(result), [CODES.ownerValidationBlocked]);
    assert.equal(result.ownerDecisionValidation.status, 'invalid');
    assert.equal(result.ownerDecisionValidation.goNoGo, 'NO_GO');
    assert.equal(result.ownerDecisionValidation.canProceedToControlledExecutionPreflight, false);
  });

  it('blocks an explicitly null owner artifact', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight(
      withRequest({ ownerDecisionArtifact: null }),
    );
    assertBlocked(result);
    assert.ok(blockingOf(result).includes(CODES.ownerValidationBlocked));
  });

  it('blocks an owner artifact whose fields still read the 13A placeholder', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight(
      withRequest({
        ownerDecisionArtifact: withOwnerSection('gate2', {
          ownerReference: 'TBD_BY_OWNER',
          evidencePacketReference: 'TBD_BY_OWNER',
        }),
      }),
    );
    assertBlocked(result);
    assert.deepEqual(blockingOf(result), [CODES.ownerValidationBlocked]);
    assert.equal(result.ownerDecisionValidation.gate2Approved, false);
  });

  it('blocks forbidden content inside the owner artifact via the 13A content rules', () => {
    const forbiddenPath = '/' + 'Users' + '/' + 'synthetic';
    const forbiddenCredential = 's' + 'k-' + 'synthetic';

    for (const [section, patch] of [
      ['capInputPolicy', { inputRootDecision: forbiddenPath }],
      ['gate7', { runbookReference: forbiddenCredential }],
    ] as const) {
      const result = evaluateBrazilReceitaControlledExecutionPreflight(
        withRequest({
          ownerDecisionArtifact: withOwnerSection(section, patch as Record<string, unknown>),
        }),
      );
      assertBlocked(result);
      assert.ok(blockingOf(result).includes(CODES.ownerValidationBlocked));
      assert.ok(
        result.ownerDecisionValidation.findings.some(
          (f) => f.code === 'OWNER_FIELD_FORBIDDEN_CONTENT',
        ),
        'the 13A content rule must be the one that refuses, not a 13B re-implementation',
      );
    }
  });

  it('blocks rejected and deferred owner decisions in every section', () => {
    const sections = [
      ['gate2', 'decisionValue'],
      ['gate7', 'decisionValue'],
      ['capInputPolicy', 'decisionValue'],
      ['controlledExecutionAttempt', 'authorizationDecision'],
    ] as const;

    for (const [section, field] of sections) {
      for (const decision of ['rejected', 'deferred']) {
        const result = evaluateBrazilReceitaControlledExecutionPreflight(
          withRequest({
            ownerDecisionArtifact: withOwnerSection(section, { [field]: decision }),
          }),
        );
        assertBlocked(result);
        assert.ok(
          blockingOf(result).includes(CODES.ownerValidationBlocked),
          `a ${decision} decision in ${section} must block the preflight`,
        );
        assertNoRealDataPermissions(result);
      }
    }
  });
});

// ─── 6–7. Requested stage ─────────────────────────────────────────────────────

describe('BR-SOURCE-13B preflight evaluator — requested stage', () => {
  it('blocks a request with no requested stage', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight(
      withoutRequestKey('requestedStage'),
    );
    assertBlocked(result);
    assert.deepEqual(blockingOf(result), [CODES.stageInvalid]);
  });

  it('blocks any stage other than the controlled execution attempt review', () => {
    const wrongStages = [
      'controlled_execution_attempt',
      'controlled_execution',
      'real_data_execution',
      'import',
      'runtime_activation',
      'CONTROLLED_EXECUTION_ATTEMPT_REVIEW',
      '',
    ];

    for (const stage of wrongStages) {
      const result = evaluateBrazilReceitaControlledExecutionPreflight(
        withRequest({ requestedStage: stage }),
      );
      assertBlocked(result);
      assert.deepEqual(
        blockingOf(result),
        [CODES.stageInvalid],
        `stage ${stage || '(empty)'} must be refused`,
      );
      assertNoRealDataPermissions(result);
    }
  });
});

// ─── 8–9. Safety flags ────────────────────────────────────────────────────────

describe('BR-SOURCE-13B preflight evaluator — safety assertions', () => {
  it('blocks when any single safety flag is false', () => {
    for (const flag of SAFETY_FLAGS) {
      const result = evaluateBrazilReceitaControlledExecutionPreflight(
        withRequest({ [flag]: false }),
      );
      assertBlocked(result);
      assert.ok(
        result.findings.some(
          (f) => f.code === CODES.requiredSafetyFlagMissing && f.field === flag,
        ),
        `${flag} set to false must be reported`,
      );
      assertNoRealDataPermissions(result);
    }
  });

  it('blocks when any single safety flag is missing', () => {
    for (const flag of SAFETY_FLAGS) {
      const result = evaluateBrazilReceitaControlledExecutionPreflight(withoutRequestKey(flag));
      assertBlocked(result);
      assert.deepEqual(
        blockingOf(result),
        [CODES.requiredSafetyFlagMissing],
        `omitting ${flag} must be the only blocker`,
      );
      assert.ok(result.findings.some((f) => f.field === flag));
    }
  });

  it('blocks truthy-but-not-true safety flags', () => {
    for (const value of ['true', 1, {}, 'yes']) {
      const result = evaluateBrazilReceitaControlledExecutionPreflight(
        withRequest({ noImport: value }),
      );
      assertBlocked(result);
      assert.ok(
        result.findings.some(
          (f) => f.code === CODES.requiredSafetyFlagMissing && f.field === 'noImport',
        ),
      );
    }
  });
});

// ─── 10–11. Evidence mode ─────────────────────────────────────────────────────

describe('BR-SOURCE-13B preflight evaluator — evidence mode', () => {
  it('blocks a request with no evidence mode', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight(
      withoutRequestKey('evidenceMode'),
    );
    assertBlocked(result);
    assert.deepEqual(blockingOf(result), [CODES.evidenceModeInvalid]);
  });

  it('blocks an unrecognized evidence mode', () => {
    for (const mode of ['real_data', 'dataset_sample', 'manifest_metadata', 'mixed', '', 3]) {
      const result = evaluateBrazilReceitaControlledExecutionPreflight(
        withRequest({ evidenceMode: mode }),
      );
      assertBlocked(result);
      assert.deepEqual(blockingOf(result), [CODES.evidenceModeInvalid]);
      assertNoRealDataPermissions(result);
    }
  });

  it('accepts both inert evidence modes', () => {
    for (const mode of BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_EVIDENCE_MODES) {
      const result = evaluateBrazilReceitaControlledExecutionPreflight(
        withRequest({ evidenceMode: mode }),
      );
      assert.equal(result.status, 'ready', `${mode} must be accepted`);
      assertNoRealDataPermissions(result);
    }
  });
});

// ─── 12–15. The one passing request ───────────────────────────────────────────

describe('BR-SOURCE-13B preflight evaluator — synthetic safe request', () => {
  it('reaches ready / GO and can proceed to the controlled execution attempt review', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight(buildSyntheticSafeRequest());
    assert.equal(result.status, 'ready');
    assert.equal(result.goNoGo, 'GO');
    assert.equal(result.canProceedToControlledExecutionAttemptReview, true);
    assert.deepEqual(blockingOf(result), []);
  });

  it('still returns every real-data permission as false', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight(buildSyntheticSafeRequest());
    assert.equal(result.status, 'ready');

    assert.equal(result.canExecuteRealData, false);
    assert.equal(result.canReadManifest, false);
    assert.equal(result.canReadCsv, false);
    assert.equal(result.canReadZip, false);
    assert.equal(result.canReadRows, false);
    assert.equal(result.canImport, false);
    assert.equal(result.canWriteSupabase, false);
    assert.equal(result.canActivateRuntime, false);
    assert.equal(result.canActivateAgent1, false);

    assertNoRealDataPermissions(result);
    assert.equal(DENIED_KEYS.length, 9, 'all nine denied permissions must be covered');
  });

  it('carries the not-an-execution-authorization note on a GO', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight(buildSyntheticSafeRequest());
    const disclaimer = result.findings.find(
      (f) => f.code === CODES.isNotExecutionAuthorization,
    );
    assert.ok(disclaimer, 'a GO verdict must carry the not-an-authorization note');
    assert.equal(disclaimer?.severity, 'info');
  });

  it('treats an owner-authorized controlled execution attempt as review readiness only', () => {
    const result = evaluateBrazilReceitaControlledExecutionPreflight(buildSyntheticSafeRequest());

    // 13A says the owner authorized a controlled execution ATTEMPT …
    assert.equal(result.ownerDecisionValidation.controlledExecutionAttemptAuthorized, true);
    assert.equal(result.ownerDecisionValidation.canProceedToControlledExecutionPreflight, true);

    // … and 13B still refuses to convert that into any real-data capability.
    assert.equal(result.canProceedToControlledExecutionAttemptReview, true);
    assertNoRealDataPermissions(result);
    assert.ok(codesOf(result).includes(CODES.isNotExecutionAuthorization));
  });
});

// ─── 16–17. Purity ────────────────────────────────────────────────────────────

describe('BR-SOURCE-13B preflight evaluator — purity', () => {
  it('does not mutate the input request or its owner artifact', () => {
    const request = buildSyntheticSafeRequest();
    const before = JSON.stringify(request);

    Object.freeze(request);
    Object.freeze(request.ownerDecisionArtifact);
    for (const section of ['gate2', 'gate7', 'capInputPolicy', 'controlledExecutionAttempt']) {
      Object.freeze(
        (request.ownerDecisionArtifact as unknown as Record<string, unknown>)[section],
      );
    }

    evaluateBrazilReceitaControlledExecutionPreflight(request);
    assert.equal(JSON.stringify(request), before, 'the input must not be mutated');
  });

  it('is deterministic for the same input', () => {
    const request = buildSyntheticSafeRequest();
    const first = evaluateBrazilReceitaControlledExecutionPreflight(request);
    const second = evaluateBrazilReceitaControlledExecutionPreflight(request);
    assert.deepEqual(first, second);

    const blockedFirst = evaluateBrazilReceitaControlledExecutionPreflight(null);
    const blockedSecond = evaluateBrazilReceitaControlledExecutionPreflight(null);
    assert.deepEqual(blockedFirst, blockedSecond);
  });
});

// ─── 18. Static import guard ──────────────────────────────────────────────────

describe('BR-SOURCE-13B preflight evaluator — static guards', () => {
  it('imports only the 13A validator and nothing that could perform I/O', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'br-receita-cnpj-controlled-execution-preflight-evaluator.ts'),
      'utf8',
    );

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual(
      specifiers,
      ['./br-receita-cnpj-owner-decision-validator'],
      'the evaluator must import the 13A validator and nothing else',
    );

    const importStatements = source.match(/^import\s/gm) ?? [];
    assert.equal(importStatements.length, 1, 'the evaluator must have exactly one import statement');

    const forbiddenTokens = [
      'node:fs',
      'node:path',
      'node:http',
      'node:https',
      'node:child_process',
      'node:crypto',
      'require(',
      '@supabase/',
      'process.env',
      'fetch(',
      'createClient',
      'Date.now',
      'Math.random',
    ];

    for (const token of forbiddenTokens) {
      assert.equal(
        source.includes(token),
        false,
        `the evaluator must not reference ${token}: it is a pure function`,
      );
    }
  });
});
