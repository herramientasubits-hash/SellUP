/**
 * BR Receita CNPJ — controlled execution authorization intake validator — tests (BR-SOURCE-13J).
 *
 * Three load-bearing properties:
 *
 *   1. Intake completeness is a fact about a DOCUMENT, never a grant of an AUTHORIZATION. Even
 *      `complete_synthetic_accept` — the fixture built to look as finished as an intake can look, with
 *      all nine decisions accepted and every acknowledgement stated — validates to the identical `NO_GO`,
 *      `blocked`, all-false-execution-and-gate-fields result as the worst-case fixture.
 *   2. Fail-closed, with no exit. Every one of the sixteen intake fixtures resolves to exactly one of six
 *      statuses, in a fixed precedence (invalid > inconsistent > rejected > deferred > incomplete >
 *      complete), and the CLI refuses every argument that is not `--fixture`, `--decision`, `--intake`,
 *      `--format` or `--pretty` — `--approve` and `--sign` included, refused for the same reason as
 *      `--execute`.
 *   3. Authorization intake validation is not execution authorization. No result, in any format, over any
 *      fixture / decision / intake combination, sets a state, gate, cap, execution or activation field to
 *      `true`, and the embedded BR-SOURCE-13I handoff packet always carries `goNoGo: 'NO_GO'`.
 *
 * 100% offline and synthetic. No dataset, no manifest, no CSV, no ZIP, no row, no join, no coverage, no
 * import, no database, no network, no runtime, no provider, no Agent 1. Two kinds of process interaction
 * happen HERE and nowhere in the validator module or its CLI: this file reads this repository's OWN
 * sources for the static guards, and spawns the CLIs to test them as CLIs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  BRAZIL_RECEITA_INTAKE_DISCLAIMER,
  BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES,
  BRAZIL_RECEITA_INTAKE_READINESS_CONCLUSION,
  BRAZIL_RECEITA_INTAKE_REQUIRED_DECISION_IDS,
  BRAZIL_RECEITA_INTAKE_REQUIRED_HUMAN_ACTIONS,
  BRAZIL_RECEITA_INTAKE_SAFETY_ASSERTIONS,
  BRAZIL_RECEITA_INTAKE_SCOPE,
  BRAZIL_RECEITA_INTAKE_STATIC_TIMESTAMP,
  BRAZIL_RECEITA_INTAKE_TYPE,
  BRAZIL_RECEITA_INTAKE_VALIDATION_RESULT_TYPE,
  BRAZIL_RECEITA_INTAKE_WITHHELD_KEYS,
  buildBrazilReceitaControlledExecutionAuthorizationIntakeFixture,
  buildBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult,
  formatBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult,
  renderBrazilReceitaControlledExecutionAuthorizationIntakeValidationMarkdown,
  validateBrazilReceitaControlledExecutionAuthorizationIntake,
  type BrazilReceitaControlledExecutionAuthorizationIntake,
  type BrazilReceitaControlledExecutionAuthorizationIntakeFixture,
  type BrazilReceitaControlledExecutionAuthorizationIntakeValidationResult,
} from '../br-receita-cnpj-controlled-execution-authorization-intake-validator';
import { buildBrazilReceitaControlledExecutionAuthorizationHandoffPacket } from '../br-receita-cnpj-controlled-execution-authorization-handoff-packet';
import { buildBrazilReceitaControlledExecutionReadinessReport } from '../br-receita-cnpj-controlled-execution-readiness-orchestrator';
import { runBrazilReceitaControlledExecutionAttemptRunnerScaffold } from '../br-receita-cnpj-controlled-execution-attempt-runner-scaffold';
import { buildBrazilReceitaSyntheticControlledExecutionAttemptPlan } from '../br-receita-cnpj-controlled-execution-attempt-plan-generator';
import { buildBrazilReceitaControlledExecutionRequestPacket } from '../br-receita-cnpj-controlled-execution-request-packet-generator';
import {
  BRAZIL_RECEITA_REVIEW_DECISION_VALUES,
  buildBrazilReceitaSyntheticControlledExecutionReviewDecision,
  validateBrazilReceitaControlledExecutionReviewDecision,
} from '../br-receita-cnpj-controlled-execution-review-decision-validator';
import { evaluateBrazilReceitaControlledExecutionPreflight } from '../br-receita-cnpj-controlled-execution-preflight-evaluator';
import { validateBrazilReceitaOwnerDecisionArtifact } from '../br-receita-cnpj-owner-decision-validator';
import { buildBrazilReceitaSyntheticOwnerArtifactFixture } from '../br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Paths and helpers ────────────────────────────────────────────────────────

/** Repository root, reached from this test's directory without hardcoding any absolute path. */
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..', '..');

function scriptPath(name: string): string {
  return path.join(REPO_ROOT, 'scripts', 'source-catalog', name);
}

const INTAKE_CLI = scriptPath('br-receita-cnpj-controlled-execution-authorization-intake-validator.ts');
const HANDOFF_13I_CLI = scriptPath(
  'br-receita-cnpj-controlled-execution-authorization-handoff-packet.ts',
);
const READINESS_13H_CLI = scriptPath('br-receita-cnpj-controlled-execution-readiness-orchestrator.ts');
const RUNNER_13G_CLI = scriptPath('br-receita-cnpj-controlled-execution-attempt-runner-scaffold.ts');
const GENERATOR_13F_CLI = scriptPath('br-receita-cnpj-controlled-execution-attempt-plan-generator.ts');
const VALIDATOR_13E_CLI = scriptPath('br-receita-cnpj-controlled-execution-review-decision-validator.ts');
const GENERATOR_13D_CLI = scriptPath('br-receita-cnpj-controlled-execution-request-packet-generator.ts');
const HARNESS_13C_CLI = scriptPath('br-receita-cnpj-synthetic-owner-artifact-harness.ts');

const INTAKE_MODULE = path.join(
  __dirname,
  '..',
  'br-receita-cnpj-controlled-execution-authorization-intake-validator.ts',
);

type CliRun = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** Runs a script as a real CLI, exactly as a human would. */
function runScript(script: string, args: readonly string[]): CliRun {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runCli(args: readonly string[]): CliRun {
  return runScript(INTAKE_CLI, args);
}

/** The fixed 13C fixture and 13E decision used everywhere the intake-specific outcome is what matters. */
const FIXTURE_NAME = 'synthetic-ready';
const DECISION_VALUE = 'approve';

function resultFor(
  intakeFixture: BrazilReceitaControlledExecutionAuthorizationIntakeFixture,
): BrazilReceitaControlledExecutionAuthorizationIntakeValidationResult {
  return buildBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult({
    fixtureName: FIXTURE_NAME,
    reviewDecisionValue: DECISION_VALUE,
    intakeFixture,
  });
}

/** Every 13C fixture / 13E decision / 13J intake fixture triple, for sweeps over the whole input space. */
const ALL_COMBINATIONS: readonly {
  readonly fixture: typeof FIXTURE_NAME;
  readonly decision: (typeof BRAZIL_RECEITA_REVIEW_DECISION_VALUES)[number];
  readonly intakeFixture: BrazilReceitaControlledExecutionAuthorizationIntakeFixture;
}[] = BRAZIL_RECEITA_REVIEW_DECISION_VALUES.flatMap((decision) =>
  BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES.map((intakeFixture) => ({
    fixture: FIXTURE_NAME,
    decision,
    intakeFixture,
  })),
);

function findDecision(
  intake: BrazilReceitaControlledExecutionAuthorizationIntake,
  decisionId: string,
) {
  return intake.decisions.find((decision) => decision.decisionId === decisionId) ?? null;
}

// ─── 1. Result envelope, over every combination ────────────────────────────────

describe('BR-SOURCE-13J result envelope', () => {
  it('always reports resultType, version, NO_GO, synthetic-only and blocked', () => {
    for (const { fixture, decision, intakeFixture } of ALL_COMBINATIONS) {
      const result = buildBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult({
        fixtureName: fixture,
        reviewDecisionValue: decision,
        intakeFixture,
      });

      assert.equal(result.resultType, BRAZIL_RECEITA_INTAKE_VALIDATION_RESULT_TYPE, intakeFixture);
      assert.equal(result.version, 1, intakeFixture);
      assert.equal(result.goNoGo, 'NO_GO', intakeFixture);
      assert.equal(result.syntheticOnly, true, intakeFixture);
      assert.equal(result.intakeValidated, true, intakeFixture);
      assert.equal(result.brazilReadiness, 'blocked', intakeFixture);
      assert.equal(
        result.readinessConclusion,
        BRAZIL_RECEITA_INTAKE_READINESS_CONCLUSION,
        intakeFixture,
      );
      assert.equal(result.generatedAt, BRAZIL_RECEITA_INTAKE_STATIC_TIMESTAMP, intakeFixture);
      assert.equal(result.intakeFixture, intakeFixture);
    }
  });

  it('carries exactly the required disclaimer', () => {
    assert.equal(
      BRAZIL_RECEITA_INTAKE_DISCLAIMER,
      'Authorization intake validation is not execution authorization.',
    );

    for (const { intakeFixture } of ALL_COMBINATIONS) {
      assert.equal(
        resultFor(intakeFixture).disclaimer,
        'Authorization intake validation is not execution authorization.',
        intakeFixture,
      );
    }
  });

  it('never sets any withheld state, gate, execution or authorization field to true', () => {
    for (const { fixture, decision, intakeFixture } of ALL_COMBINATIONS) {
      const result = buildBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult({
        fixtureName: fixture,
        reviewDecisionValue: decision,
        intakeFixture,
      });

      for (const key of BRAZIL_RECEITA_INTAKE_WITHHELD_KEYS) {
        assert.equal(result[key], false, `${intakeFixture} / ${key}`);
      }
    }
  });

  it('embeds a BR-SOURCE-13I handoff packet that is itself always NO_GO / not_authorized / blocked', () => {
    for (const { intakeFixture } of ALL_COMBINATIONS) {
      const result = resultFor(intakeFixture);
      const expectedPacket = buildBrazilReceitaControlledExecutionAuthorizationHandoffPacket({
        fixtureName: FIXTURE_NAME,
        reviewDecisionValue: DECISION_VALUE,
      });

      assert.deepEqual(result.handoffPacket, expectedPacket, intakeFixture);
      assert.equal(result.handoffPacket.goNoGo, 'NO_GO', intakeFixture);
      assert.equal(result.handoffPacket.authorizationStatus, 'not_authorized', intakeFixture);
      assert.equal(result.handoffPacket.brazilReadiness, 'blocked', intakeFixture);
    }
  });
});

// ─── 2. The best-case fixture is still NO_GO (the central claim) ──────────────

describe('BR-SOURCE-13J complete_synthetic_accept — completeness is not authorization', () => {
  const result = resultFor('complete_synthetic_accept');

  it('reaches intake_complete_synthetic_only', () => {
    assert.equal(result.status, 'intake_complete_synthetic_only');
    assert.equal(result.syntheticIntakeComplete, true);
    assert.equal(result.ownerDecisionsCapturedSynthetic, true);
    assert.equal(result.ownerDecisionsValidSynthetic, true);
  });

  it('still reports NO_GO and blocked, identically to every other fixture', () => {
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.brazilReadiness, 'blocked');
  });

  it('holds every execution, real-data and activation field false', () => {
    assert.equal(result.executionStarted, false);
    assert.equal(result.executionAttempted, false);
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.realDataExecutionAuthorized, false);
    assert.equal(result.realDataAccessed, false);
    assert.equal(result.pathInputAccepted, false);
    assert.equal(result.manifestRead, false);
    assert.equal(result.csvRead, false);
    assert.equal(result.zipRead, false);
    assert.equal(result.rowReads, false);
    assert.equal(result.joinExecuted, false);
    assert.equal(result.coverageExecuted, false);
    assert.equal(result.importExecuted, false);
    assert.equal(result.supabaseWrites, false);
    assert.equal(result.runtimeActivated, false);
    assert.equal(result.agent1Activated, false);
    assert.equal(result.providerCalls, false);
  });

  it('holds every gate, cap and authorization field false', () => {
    assert.equal(result.gate2Approved, false);
    assert.equal(result.gate7Approved, false);
    assert.equal(result.capInputPolicyApproved, false);
    assert.equal(result.controlledExecutionAttemptAuthorized, false);
    assert.equal(result.fullJoinAuthorized, false);
    assert.equal(result.importAuthorized, false);
    assert.equal(result.runtimeAuthorized, false);
    assert.equal(result.agent1Authorized, false);
  });

  it('has no missing, rejected, deferred or inconsistent decisions, and no findings', () => {
    assert.deepEqual(result.missingDecisions, []);
    assert.deepEqual(result.rejectedDecisions, []);
    assert.deepEqual(result.deferredDecisions, []);
    assert.deepEqual(result.inconsistentDecisions, []);
    assert.deepEqual(result.findings, []);
  });

  it('carries all nine decisions, each accepted and carrying the synthetic-only scope', () => {
    assert.equal(result.intake.decisions.length, 9);
    for (const decisionId of BRAZIL_RECEITA_INTAKE_REQUIRED_DECISION_IDS) {
      const decision = findDecision(result.intake, decisionId);
      assert.ok(decision, decisionId);
      assert.equal(decision?.decisionValue, 'accepted', decisionId);
      assert.equal(decision?.scope, BRAZIL_RECEITA_INTAKE_SCOPE, decisionId);
      assert.equal(decision?.acknowledgesSeparateAuthorizationRequired, true, decisionId);
      assert.equal(decision?.acknowledgesNoExecutionAuthorizationGranted, true, decisionId);
      assert.equal(decision?.acknowledgesNoGateApprovalByInference, true, decisionId);
    }
  });
});

// ─── 3. Missing-decision fixtures ───────────────────────────────────────────────

describe('BR-SOURCE-13J missing-decision fixtures', () => {
  const cases: readonly {
    readonly intakeFixture: BrazilReceitaControlledExecutionAuthorizationIntakeFixture;
    readonly expectedMissing: readonly string[];
  }[] = [
    { intakeFixture: 'missing_owner_completion', expectedMissing: ['OWNER_COMPLETION_RESUBMISSION'] },
    {
      intakeFixture: 'missing_gate_2',
      expectedMissing: ['GATE_2_ROUTE_DECISION', 'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION'],
    },
    {
      intakeFixture: 'missing_gate_7',
      expectedMissing: [
        'GATE_7_PRIVACY_SECURITY_DECISION',
        'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION',
      ],
    },
    {
      intakeFixture: 'missing_cap_input',
      expectedMissing: ['CAP_INPUT_POLICY_APPROVAL', 'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION'],
    },
    {
      intakeFixture: 'missing_controlled_execution',
      expectedMissing: ['CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION'],
    },
    {
      intakeFixture: 'missing_full_join',
      expectedMissing: [
        'FULL_JOIN_EXECUTION_AUTHORIZATION',
        'IMPORT_AUTHORIZATION',
        'RUNTIME_AUTHORIZATION',
        'AGENT1_AUTHORIZATION',
      ],
    },
    {
      intakeFixture: 'missing_import',
      expectedMissing: ['IMPORT_AUTHORIZATION', 'RUNTIME_AUTHORIZATION', 'AGENT1_AUTHORIZATION'],
    },
    {
      intakeFixture: 'missing_runtime',
      expectedMissing: ['RUNTIME_AUTHORIZATION', 'AGENT1_AUTHORIZATION'],
    },
    { intakeFixture: 'missing_agent1', expectedMissing: ['AGENT1_AUTHORIZATION'] },
  ];

  for (const { intakeFixture, expectedMissing } of cases) {
    it(`${intakeFixture} reaches intake_incomplete with missingDecisions ${expectedMissing.join(', ')}`, () => {
      const result = resultFor(intakeFixture);

      assert.equal(result.status, 'intake_incomplete', intakeFixture);
      assert.deepEqual(result.missingDecisions, expectedMissing, intakeFixture);
      assert.equal(result.syntheticIntakeComplete, false, intakeFixture);
      assert.equal(result.ownerDecisionsCapturedSynthetic, false, intakeFixture);
      assert.equal(result.ownerDecisionsValidSynthetic, false, intakeFixture);
      assert.deepEqual(result.rejectedDecisions, [], intakeFixture);
      assert.deepEqual(result.deferredDecisions, [], intakeFixture);
      assert.deepEqual(result.inconsistentDecisions, [], intakeFixture);

      for (const decisionId of expectedMissing) {
        assert.ok(
          result.findings.some(
            (finding) => finding.findingId === 'INTAKE_DECISION_MISSING' && finding.decisionId === decisionId,
          ),
          `${intakeFixture} must report INTAKE_DECISION_MISSING for ${decisionId}`,
        );
      }
      for (const finding of result.findings) {
        assert.equal(finding.severity, 'blocking', intakeFixture);
      }
    });
  }
});

// ─── 4. Rejected and deferred fixtures ──────────────────────────────────────────

describe('BR-SOURCE-13J rejected and deferred fixtures', () => {
  it('rejected_gate_2 reaches intake_rejected and reports INTAKE_DECISION_REJECTED', () => {
    const result = resultFor('rejected_gate_2');

    assert.equal(result.status, 'intake_rejected');
    assert.deepEqual(result.rejectedDecisions, ['GATE_2_ROUTE_DECISION']);
    assert.deepEqual(result.deferredDecisions, []);
    assert.deepEqual(result.inconsistentDecisions, []);
    assert.equal(result.syntheticIntakeComplete, false);
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.findingId === 'INTAKE_DECISION_REJECTED' && finding.decisionId === 'GATE_2_ROUTE_DECISION',
      ),
    );
  });

  it('deferred_gate_7 reaches intake_deferred and reports INTAKE_DECISION_DEFERRED', () => {
    const result = resultFor('deferred_gate_7');

    assert.equal(result.status, 'intake_deferred');
    assert.deepEqual(result.deferredDecisions, ['GATE_7_PRIVACY_SECURITY_DECISION']);
    assert.deepEqual(result.rejectedDecisions, []);
    assert.deepEqual(result.inconsistentDecisions, []);
    assert.equal(result.syntheticIntakeComplete, false);
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.findingId === 'INTAKE_DECISION_DEFERRED' &&
          finding.decisionId === 'GATE_7_PRIVACY_SECURITY_DECISION',
      ),
    );
  });
});

// ─── 5. Inconsistent fixtures ────────────────────────────────────────────────────

describe('BR-SOURCE-13J inconsistent fixtures', () => {
  it('inconsistent_import_without_full_join reaches intake_inconsistent', () => {
    const result = resultFor('inconsistent_import_without_full_join');

    assert.equal(result.status, 'intake_inconsistent');
    assert.deepEqual(result.inconsistentDecisions, ['IMPORT_AUTHORIZATION']);
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.findingId === 'INTAKE_INCONSISTENT_IMPORT_WITHOUT_FULL_JOIN' &&
          finding.decisionId === 'IMPORT_AUTHORIZATION',
      ),
    );
  });

  it('inconsistent_agent1_without_runtime reaches intake_inconsistent', () => {
    const result = resultFor('inconsistent_agent1_without_runtime');

    assert.equal(result.status, 'intake_inconsistent');
    assert.deepEqual(result.inconsistentDecisions, ['AGENT1_AUTHORIZATION']);
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.findingId === 'INTAKE_INCONSISTENT_AGENT1_WITHOUT_RUNTIME' &&
          finding.decisionId === 'AGENT1_AUTHORIZATION',
      ),
    );
  });

  it('inconsistency outranks incompleteness in the reported status', () => {
    // Both inconsistent fixtures also carry a missing decision (the one the accepted decision depends
    // on), and the status still reports the more severe category.
    for (const intakeFixture of [
      'inconsistent_import_without_full_join',
      'inconsistent_agent1_without_runtime',
    ] as const) {
      const result = resultFor(intakeFixture);
      assert.ok(result.missingDecisions.length > 0, intakeFixture);
      assert.equal(result.status, 'intake_inconsistent', intakeFixture);
    }
  });
});

// ─── 6. Invalid-content fixtures ─────────────────────────────────────────────────

describe('BR-SOURCE-13J invalid-content fixtures', () => {
  it('placeholder_values reaches intake_invalid via INTAKE_FIELD_PLACEHOLDER', () => {
    const result = resultFor('placeholder_values');

    assert.equal(result.status, 'intake_invalid');
    assert.deepEqual(result.missingDecisions, []);
    assert.deepEqual(result.rejectedDecisions, []);
    assert.deepEqual(result.deferredDecisions, []);
    assert.deepEqual(result.inconsistentDecisions, []);
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.findingId === 'INTAKE_FIELD_PLACEHOLDER' &&
          finding.decisionId === 'OWNER_COMPLETION_RESUBMISSION',
      ),
    );
  });

  it('forbidden_content reaches intake_invalid via INTAKE_FORBIDDEN_CONTENT', () => {
    const result = resultFor('forbidden_content');

    assert.equal(result.status, 'intake_invalid');
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.findingId === 'INTAKE_FORBIDDEN_CONTENT' &&
          finding.decisionId === 'OWNER_COMPLETION_RESUBMISSION',
      ),
    );
  });

  it('every finding across every fixture carries severity blocking', () => {
    for (const intakeFixture of BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES) {
      for (const finding of resultFor(intakeFixture).findings) {
        assert.equal(finding.severity, 'blocking', `${intakeFixture}: ${finding.findingId}`);
      }
    }
  });
});

// ─── 7. Status precedence sweep ─────────────────────────────────────────────────

describe('BR-SOURCE-13J status precedence', () => {
  const expectedStatusByFixture: Record<
    BrazilReceitaControlledExecutionAuthorizationIntakeFixture,
    BrazilReceitaControlledExecutionAuthorizationIntakeValidationResult['status']
  > = {
    complete_synthetic_accept: 'intake_complete_synthetic_only',
    missing_owner_completion: 'intake_incomplete',
    missing_gate_2: 'intake_incomplete',
    missing_gate_7: 'intake_incomplete',
    missing_cap_input: 'intake_incomplete',
    missing_controlled_execution: 'intake_incomplete',
    missing_full_join: 'intake_incomplete',
    missing_import: 'intake_incomplete',
    missing_runtime: 'intake_incomplete',
    missing_agent1: 'intake_incomplete',
    rejected_gate_2: 'intake_rejected',
    deferred_gate_7: 'intake_deferred',
    inconsistent_import_without_full_join: 'intake_inconsistent',
    inconsistent_agent1_without_runtime: 'intake_inconsistent',
    placeholder_values: 'intake_invalid',
    forbidden_content: 'intake_invalid',
  };

  it('every fixture resolves to its expected status, deterministically', () => {
    for (const [intakeFixture, expectedStatus] of Object.entries(expectedStatusByFixture)) {
      const result = resultFor(
        intakeFixture as BrazilReceitaControlledExecutionAuthorizationIntakeFixture,
      );
      assert.equal(result.status, expectedStatus, intakeFixture);
    }

    assert.deepEqual(
      [...BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES].sort(),
      Object.keys(expectedStatusByFixture).sort(),
    );
  });

  it('exactly one fixture reaches intake_complete_synthetic_only', () => {
    const completeFixtures = BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES.filter(
      (intakeFixture) => resultFor(intakeFixture).status === 'intake_complete_synthetic_only',
    );
    assert.deepEqual(completeFixtures, ['complete_synthetic_accept']);
  });
});

// ─── 8. Safety assertions, required actions and fixed catalogues ───────────────

describe('BR-SOURCE-13J safety assertions and required human actions', () => {
  it('states all sixteen safety assertions, for every fixture, including INTAKE_VALIDATION_SYNTHETIC_ONLY', () => {
    const required = [
      'NO_REAL_DATA_ACCESSED',
      'NO_PATH_INPUT_ACCEPTED',
      'NO_MANIFEST_READ',
      'NO_CSV_OR_ZIP_READ',
      'NO_ROW_READS',
      'NO_JOIN_EXECUTED',
      'NO_COVERAGE_EXECUTED',
      'NO_IMPORT_EXECUTED',
      'NO_SUPABASE_WRITES',
      'NO_RUNTIME_ACTIVATED',
      'NO_AGENT1_ACTIVATED',
      'NO_PROVIDER_CALLS',
      'NO_GATE_APPROVAL_GRANTED',
      'NO_PRODUCTION_READINESS_GRANTED',
      'NO_EXECUTION_AUTHORIZATION_GRANTED',
      'INTAKE_VALIDATION_SYNTHETIC_ONLY',
    ];

    assert.deepEqual([...BRAZIL_RECEITA_INTAKE_SAFETY_ASSERTIONS], required);
    assert.equal(BRAZIL_RECEITA_INTAKE_SAFETY_ASSERTIONS.length, 16);

    for (const intakeFixture of BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES) {
      assert.deepEqual(resultFor(intakeFixture).safetyAssertions, required, intakeFixture);
    }
  });

  it('states all eleven required next human actions, for every fixture', () => {
    const required = [
      'HUMAN_REVIEW_AUTHORIZATION_INTAKE_VALIDATION',
      'REAL_OWNER_INTAKE_REQUIRED',
      'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
      'SEPARATE_GATE_2_APPROVAL_REQUIRED',
      'SEPARATE_GATE_7_APPROVAL_REQUIRED',
      'SEPARATE_CAP_INPUT_APPROVAL_REQUIRED',
      'SEPARATE_CONTROLLED_EXECUTION_AUTHORIZATION_REQUIRED',
      'SEPARATE_FULL_JOIN_AUTHORIZATION_REQUIRED',
      'SEPARATE_IMPORT_AUTHORIZATION_REQUIRED',
      'SEPARATE_RUNTIME_AUTHORIZATION_REQUIRED',
      'SEPARATE_AGENT1_AUTHORIZATION_REQUIRED',
    ];

    assert.deepEqual([...BRAZIL_RECEITA_INTAKE_REQUIRED_HUMAN_ACTIONS], required);
    assert.equal(BRAZIL_RECEITA_INTAKE_REQUIRED_HUMAN_ACTIONS.length, 11);

    for (const intakeFixture of BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES) {
      assert.deepEqual(resultFor(intakeFixture).requiredNextHumanActions, required, intakeFixture);
    }
  });

  it('lists exactly sixteen intake fixtures and nine required decision ids', () => {
    assert.equal(BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES.length, 16);
    assert.equal(BRAZIL_RECEITA_INTAKE_REQUIRED_DECISION_IDS.length, 9);
  });
});

// ─── 9. Determinism and rendering ───────────────────────────────────────────────

describe('BR-SOURCE-13J determinism and rendering', () => {
  it('serializes JSON deterministically, over every fixture', () => {
    for (const intakeFixture of BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES) {
      const first = formatBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult(
        resultFor(intakeFixture),
        'json',
      );
      const second = formatBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult(
        resultFor(intakeFixture),
        'json',
      );

      assert.equal(first, second, intakeFixture);
      assert.ok(
        first.includes(`"generatedAt":"${BRAZIL_RECEITA_INTAKE_STATIC_TIMESTAMP}"`),
        `${intakeFixture} must carry the static synthetic timestamp`,
      );
    }
  });

  it('renders Markdown deterministically, over every fixture', () => {
    for (const intakeFixture of BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES) {
      const result = resultFor(intakeFixture);
      const first = renderBrazilReceitaControlledExecutionAuthorizationIntakeValidationMarkdown(result);
      const second = renderBrazilReceitaControlledExecutionAuthorizationIntakeValidationMarkdown(result);

      assert.equal(first, second, intakeFixture);
      assert.equal(
        first,
        formatBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult(result, 'markdown'),
        intakeFixture,
      );
      // `pretty` is a JSON-only concern.
      assert.equal(
        first,
        formatBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult(
          result,
          'markdown',
          true,
        ),
        intakeFixture,
      );
    }
  });

  it('says Brazil remains blocked and states the disclaimer in every Markdown rendering', () => {
    for (const intakeFixture of BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES) {
      const markdown = renderBrazilReceitaControlledExecutionAuthorizationIntakeValidationMarkdown(
        resultFor(intakeFixture),
      );

      assert.match(markdown, /Brazil remains blocked\./, intakeFixture);
      assert.match(
        markdown,
        /Authorization intake validation is not execution authorization\./,
        intakeFixture,
      );
      assert.match(markdown, /\*\*NO_GO\*\*/, intakeFixture);
      assert.match(markdown, /\*\*blocked\*\*/, intakeFixture);
    }
  });

  it('calling build/validate twice with identical inputs yields byte-identical JSON and Markdown', () => {
    for (const intakeFixture of BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES) {
      const intake = buildBrazilReceitaControlledExecutionAuthorizationIntakeFixture({ intakeFixture });
      const firstResult = validateBrazilReceitaControlledExecutionAuthorizationIntake({
        fixtureName: FIXTURE_NAME,
        reviewDecisionValue: DECISION_VALUE,
        intake,
      });
      const secondResult = validateBrazilReceitaControlledExecutionAuthorizationIntake({
        fixtureName: FIXTURE_NAME,
        reviewDecisionValue: DECISION_VALUE,
        intake,
      });

      assert.equal(JSON.stringify(firstResult), JSON.stringify(secondResult), intakeFixture);
      assert.equal(
        renderBrazilReceitaControlledExecutionAuthorizationIntakeValidationMarkdown(firstResult),
        renderBrazilReceitaControlledExecutionAuthorizationIntakeValidationMarkdown(secondResult),
        intakeFixture,
      );
    }
  });
});

// ─── 10. The CLI produces results ───────────────────────────────────────────────

describe('BR-SOURCE-13J CLI output', () => {
  it('prints the JSON result for complete_synthetic_accept and exits 0', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--intake',
      'complete_synthetic_accept',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');

    const printed = JSON.parse(
      run.stdout,
    ) as BrazilReceitaControlledExecutionAuthorizationIntakeValidationResult;
    assert.deepEqual(printed, JSON.parse(JSON.stringify(resultFor('complete_synthetic_accept'))));
    assert.equal(printed.status, 'intake_complete_synthetic_only');
    assert.equal(printed.goNoGo, 'NO_GO');
  });

  it('prints indented JSON with --pretty, carrying the same result', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--intake',
      'complete_synthetic_accept',
      '--format',
      'json',
      '--pretty',
    ]);

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /\n {2}"resultType": /);
    assert.deepEqual(JSON.parse(run.stdout), JSON.parse(JSON.stringify(resultFor('complete_synthetic_accept'))));
  });

  it('prints the Markdown result and exits 0', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--intake',
      'complete_synthetic_accept',
      '--format',
      'markdown',
    ]);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      run.stdout,
      `${renderBrazilReceitaControlledExecutionAuthorizationIntakeValidationMarkdown(resultFor('complete_synthetic_accept'))}\n`,
    );
    assert.match(run.stdout, /Brazil remains blocked\./);
  });

  it('prints a NO_GO result for missing_gate_2 and still exits 0', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--intake',
      'missing_gate_2',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(
      run.stdout,
    ) as BrazilReceitaControlledExecutionAuthorizationIntakeValidationResult;
    assert.equal(printed.status, 'intake_incomplete');
    assert.equal(printed.goNoGo, 'NO_GO');
  });

  it('prints a NO_GO result for inconsistent_import_without_full_join and still exits 0', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--intake',
      'inconsistent_import_without_full_join',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(
      run.stdout,
    ) as BrazilReceitaControlledExecutionAuthorizationIntakeValidationResult;
    assert.equal(printed.status, 'intake_inconsistent');
    assert.equal(printed.goNoGo, 'NO_GO');
  });

  it('exits 0 for every intake fixture, every one printing NO_GO', () => {
    for (const intakeFixture of BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES) {
      const run = runCli([
        '--fixture',
        'synthetic-ready',
        '--decision',
        'approve',
        '--intake',
        intakeFixture,
        '--format',
        'json',
      ]);

      assert.equal(run.status, 0, `${intakeFixture}: ${run.stderr}`);
      const printed = JSON.parse(run.stdout) as { goNoGo: string };
      assert.equal(printed.goNoGo, 'NO_GO', intakeFixture);
    }
  });
});

// ─── 11. The CLI refuses everything else ────────────────────────────────────────

/** Asserts a run failed as a usage error: nothing on stdout, the code on stderr, exit 1. */
function assertUsageError(run: CliRun, code: string): void {
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, new RegExp(code));
}

const VALID_BASE = [
  '--fixture',
  'synthetic-ready',
  '--decision',
  'approve',
  '--intake',
  'complete_synthetic_accept',
  '--format',
  'json',
];

/** Asserts a forbidden flag is refused in both `--flag value` and `--flag=value` form. */
function assertForbiddenFlag(flag: string): void {
  assertUsageError(runCli([...VALID_BASE, flag, 'anything']), 'BRSOURCE13J_FORBIDDEN_ARGUMENT');
  assertUsageError(runCli([...VALID_BASE, `${flag}=anything`]), 'BRSOURCE13J_FORBIDDEN_ARGUMENT');
  assertUsageError(runCli([flag, 'anything', ...VALID_BASE]), 'BRSOURCE13J_FORBIDDEN_ARGUMENT');
}

describe('BR-SOURCE-13J CLI usage errors', () => {
  it('refuses a missing --fixture', () => {
    assertUsageError(
      runCli(['--decision', 'approve', '--intake', 'complete_synthetic_accept', '--format', 'json']),
      'BRSOURCE13J_FIXTURE_REQUIRED',
    );
  });

  it('refuses a missing --decision', () => {
    assertUsageError(
      runCli([
        '--fixture',
        'synthetic-ready',
        '--intake',
        'complete_synthetic_accept',
        '--format',
        'json',
      ]),
      'BRSOURCE13J_DECISION_REQUIRED',
    );
  });

  it('refuses a missing --intake', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json']),
      'BRSOURCE13J_INTAKE_REQUIRED',
    );
  });

  it('refuses a missing --format', () => {
    assertUsageError(
      runCli([
        '--fixture',
        'synthetic-ready',
        '--decision',
        'approve',
        '--intake',
        'complete_synthetic_accept',
      ]),
      'BRSOURCE13J_FORMAT_REQUIRED',
    );
  });

  it('refuses an unknown --fixture', () => {
    assertUsageError(
      runCli([
        '--fixture',
        'not-a-fixture',
        '--decision',
        'approve',
        '--intake',
        'complete_synthetic_accept',
        '--format',
        'json',
      ]),
      'BRSOURCE13J_FIXTURE_UNKNOWN',
    );
  });

  it('refuses an unknown --decision', () => {
    assertUsageError(
      runCli([
        '--fixture',
        'synthetic-ready',
        '--decision',
        'authorized',
        '--intake',
        'complete_synthetic_accept',
        '--format',
        'json',
      ]),
      'BRSOURCE13J_DECISION_UNKNOWN',
    );
  });

  it('refuses an unknown --intake', () => {
    assertUsageError(
      runCli([
        '--fixture',
        'synthetic-ready',
        '--decision',
        'approve',
        '--intake',
        'not-an-intake-fixture',
        '--format',
        'json',
      ]),
      'BRSOURCE13J_INTAKE_UNKNOWN',
    );
  });

  it('refuses an unknown --format', () => {
    assertUsageError(
      runCli([...VALID_BASE.slice(0, 6), '--format', 'csv']),
      'BRSOURCE13J_FORMAT_UNKNOWN',
    );
  });

  for (const flag of [
    '--manifest',
    '--input',
    '--output',
    '--path',
    '--real-data',
    '--execute',
    '--run',
    '--apply',
    '--force',
    '--import',
    '--activate',
    '--approve',
    '--sign',
  ]) {
    it(`refuses ${flag}`, () => {
      assertForbiddenFlag(flag);
    });
  }

  it('refuses any unknown flag', () => {
    for (const flag of ['--verbose', '--all', '--ready', '--handoff']) {
      assertUsageError(runCli([...VALID_BASE, flag]), 'BRSOURCE13J_UNKNOWN_ARGUMENT');
    }
  });

  it('refuses a positional argument, including one shaped like a location', () => {
    for (const positional of ['complete_synthetic_accept', 'intake.json', 'some/relative/dir']) {
      assertUsageError(runCli([positional, ...VALID_BASE]), 'BRSOURCE13J_UNKNOWN_ARGUMENT');
    }
  });
});

// ─── 12. Static guards ───────────────────────────────────────────────────────────

describe('BR-SOURCE-13J static guards', () => {
  it('the intake validator module reaches no filesystem, process, database or runtime surface', () => {
    const source = fs.readFileSync(INTAKE_MODULE, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      './br-receita-cnpj-controlled-execution-authorization-handoff-packet',
      './br-receita-cnpj-controlled-execution-review-decision-validator',
      './br-receita-cnpj-synthetic-owner-artifact-fixtures',
    ]);

    for (const forbidden of [
      'node:fs',
      'node:path',
      'node:http',
      'node:https',
      'node:child_process',
      'node:crypto',
      'require(',
      '__dirname',
      'process.',
      'globalThis',
      '@supabase/',
      'createClient',
      'fetch(',
      'Date.now',
      'new Date(',
      'Math.random',
    ]) {
      assert.ok(!source.includes(forbidden), `the intake validator module must not reference ${forbidden}`);
    }
  });

  it('the CLI reaches no filesystem, process-spawning, database or runtime surface', () => {
    const source = fs.readFileSync(INTAKE_CLI, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-authorization-intake-validator',
      '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-request-packet-generator',
      '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-review-decision-validator',
      '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-synthetic-owner-artifact-fixtures',
    ]);

    for (const forbidden of [
      'node:fs',
      'node:path',
      'node:http',
      'node:https',
      'node:child_process',
      'node:crypto',
      'require(',
      '__dirname',
      'process.env',
      '@supabase/',
      'createClient',
      'fetch(',
      'Date.now',
      'new Date(',
      'Math.random',
    ]) {
      assert.ok(!source.includes(forbidden), `the CLI must not reference ${forbidden}`);
    }

    const processUses = [...source.matchAll(/process\.[A-Za-z]+/g)].map((match) => match[0]);
    assert.ok(processUses.length > 0, 'the CLI reads the argument vector, so uses must be present');
    for (const use of processUses) {
      assert.ok(
        ['process.argv', 'process.stdout', 'process.stderr', 'process.exitCode'].includes(use),
        `unexpected process surface in the CLI: ${use}`,
      );
    }

    for (const file of [INTAKE_MODULE, INTAKE_CLI]) {
      const text = fs.readFileSync(file, 'utf8');
      for (const forbidden of ['readFile', 'writeFile', 'createWriteStream', 'spawnSync(', 'exec(']) {
        assert.ok(!text.includes(forbidden), `${file} must not reference ${forbidden}`);
      }
    }
  });

  it('no state, permission, authorization or readiness flag can be true, over the whole input space', () => {
    for (const { fixture, decision, intakeFixture } of ALL_COMBINATIONS) {
      const result = buildBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult({
        fixtureName: fixture,
        reviewDecisionValue: decision,
        intakeFixture,
      });

      for (const key of BRAZIL_RECEITA_INTAKE_WITHHELD_KEYS) {
        assert.equal(result[key], false, `${intakeFixture} / ${key} must stay false`);
      }
      assert.equal(result.goNoGo, 'NO_GO', intakeFixture);
      assert.equal(result.brazilReadiness, 'blocked', intakeFixture);

      const json = formatBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult(
        result,
        'json',
      );
      const markdown = formatBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult(
        result,
        'markdown',
      );
      for (const key of BRAZIL_RECEITA_INTAKE_WITHHELD_KEYS) {
        assert.ok(json.includes(`"${key}":false`), `${intakeFixture}: JSON must state ${key} as false`);
        assert.match(
          markdown,
          new RegExp(`\\| ${key} \\| NO \\|`),
          `${intakeFixture}: Markdown must state ${key} as NO`,
        );
      }
    }
  });

  it('every intake object carries the correct type, version and synthetic-only markers', () => {
    for (const intakeFixture of BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES) {
      const intake = buildBrazilReceitaControlledExecutionAuthorizationIntakeFixture({ intakeFixture });
      assert.equal(intake.intakeType, BRAZIL_RECEITA_INTAKE_TYPE, intakeFixture);
      assert.equal(intake.version, 1, intakeFixture);
      assert.equal(intake.syntheticOnly, true, intakeFixture);
      assert.equal(intake.intakeFixture, intakeFixture, intakeFixture);
    }
  });

  it('throws for an unknown intake fixture name', () => {
    assert.throws(() => {
      buildBrazilReceitaControlledExecutionAuthorizationIntakeFixture({
        // @ts-expect-error deliberately invalid for the runtime guard
        intakeFixture: 'not-a-real-intake-fixture',
      });
    }, /BRSOURCE13J_UNKNOWN_INTAKE_FIXTURE/);
  });
});

// ─── 13. Upstream regressions (13A–13I) ──────────────────────────────────────────

describe('BR-SOURCE-13J upstream regressions', () => {
  it('BR-SOURCE-13I still builds a handoff packet for synthetic-ready + approve, NO_GO throughout', () => {
    const packet = buildBrazilReceitaControlledExecutionAuthorizationHandoffPacket({
      fixtureName: 'synthetic-ready',
      reviewDecisionValue: 'approve',
    });

    assert.equal(packet.goNoGo, 'NO_GO');
    assert.equal(packet.authorizationStatus, 'not_authorized');
    assert.equal(packet.decisionRequests.length, 9);

    const run = runScript(HANDOFF_13I_CLI, [
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as Record<string, unknown>;
    assert.equal(printed.goNoGo, 'NO_GO');
  });

  it('BR-SOURCE-13H still reaches synthetic_chain_operational_execution_blocked for synthetic-ready + approve', () => {
    const report = buildBrazilReceitaControlledExecutionReadinessReport({
      fixtureName: 'synthetic-ready',
      reviewDecisionValue: 'approve',
    });

    assert.equal(report.status, 'synthetic_chain_operational_execution_blocked');
    assert.equal(report.goNoGo, 'NO_GO');

    const run = runScript(READINESS_13H_CLI, [
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);
    assert.equal(run.status, 0, run.stderr);
  });

  it('BR-SOURCE-13G still reaches blocked_no_execution_authorization for synthetic-ready + approve', () => {
    const result = runBrazilReceitaControlledExecutionAttemptRunnerScaffold({
      fixtureName: 'synthetic-ready',
      reviewDecisionValue: 'approve',
    });

    assert.equal(result.status, 'blocked_no_execution_authorization');
    assert.equal(result.goNoGo, 'NO_GO');

    const run = runScript(RUNNER_13G_CLI, [
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);
    assert.equal(run.status, 0, run.stderr);
  });

  it('BR-SOURCE-13F still reaches plan_ready_for_human_review for synthetic-ready + approve', () => {
    const plan = buildBrazilReceitaSyntheticControlledExecutionAttemptPlan('synthetic-ready', 'approve');

    assert.equal(plan.status, 'plan_ready_for_human_review');
    assert.equal(plan.goNoGo, 'GO');
    assert.equal(plan.executionStarted, false);

    const run = runScript(GENERATOR_13F_CLI, [
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);
    assert.equal(run.status, 0, run.stderr);
  });

  it('BR-SOURCE-13E still approves the synthetic-ready packet for planning review only', () => {
    const requestPacket = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: requestPacket,
      reviewDecision: buildBrazilReceitaSyntheticControlledExecutionReviewDecision(
        requestPacket,
        'approve',
      ),
    });

    assert.equal(result.status, 'valid');
    assert.equal(result.goNoGo, 'GO');
    assert.equal(result.decisionOutcome, 'approved_for_next_planning_review');

    const run = runScript(VALIDATOR_13E_CLI, [
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);
    assert.equal(run.status, 0, run.stderr);
  });

  it('BR-SOURCE-13D still produces a ready_for_review packet for synthetic-ready', () => {
    const requestPacket = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');

    assert.equal(requestPacket.status, 'ready_for_review');
    assert.equal(requestPacket.goNoGo, 'GO');

    const run = runScript(GENERATOR_13D_CLI, ['--fixture', 'synthetic-ready', '--format', 'json']);
    assert.equal(run.status, 0, run.stderr);
  });

  it('the BR-SOURCE-13C harness still reaches ready / GO for synthetic-ready', () => {
    const run = runScript(HARNESS_13C_CLI, ['--fixture', 'synthetic-ready']);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as { result: Record<string, unknown> };
    assert.equal(printed.result.status, 'ready');
    assert.equal(printed.result.goNoGo, 'GO');
  });

  it('BR-SOURCE-13B still reaches ready / GO for the synthetic-ready request', () => {
    const preflight = evaluateBrazilReceitaControlledExecutionPreflight(
      buildBrazilReceitaSyntheticOwnerArtifactFixture('synthetic-ready'),
    );

    assert.equal(preflight.status, 'ready');
    assert.equal(preflight.goNoGo, 'GO');
  });

  it('BR-SOURCE-13A still validates the synthetic-ready owner artifact through the fixture chain', () => {
    const request = buildBrazilReceitaSyntheticOwnerArtifactFixture('synthetic-ready');
    const owner = validateBrazilReceitaOwnerDecisionArtifact(request.ownerDecisionArtifact);

    assert.equal(owner.status, 'valid');
    assert.equal(owner.goNoGo, 'GO');
  });
});
