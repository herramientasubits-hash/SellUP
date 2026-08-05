/**
 * BR Receita CNPJ — controlled execution attempt plan generator — tests (BR-SOURCE-13F).
 *
 * Three load-bearing properties:
 *
 *   1. A plan is only generated over what the chain actually decided. The 13D packet and the 13E
 *      verdict travel inside the plan verbatim, and 13F re-implements none of their rules.
 *   2. Fail-closed. Only an approved 13E review over a reviewable packet yields
 *      `plan_ready_for_human_review`; a reject, a defer and every blocked fixture yield `blocked` with
 *      blockers, and the CLI refuses every argument that is not `--fixture`, `--decision`, `--format`
 *      or `--pretty`.
 *   3. Plan ready for review is not execution authorization, and a generated plan is not a started
 *      run. No plan, in any format, over any fixture and any decision, sets a state or authorization
 *      field to `true`.
 *
 * 100% offline and synthetic. No dataset, no manifest, no CSV, no ZIP, no row, no join, no coverage,
 * no import, no Supabase, no network, no runtime, no provider, no Agent 1. Two kinds of process
 * interaction happen HERE and nowhere in the generator or its CLI: this file reads this repository's
 * OWN sources for the static guards, and spawns the CLIs to test them as CLIs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  BRAZIL_RECEITA_ATTEMPT_PLAN_BLOCKED_HUMAN_ACTION,
  BRAZIL_RECEITA_ATTEMPT_PLAN_DISCLAIMER,
  BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES,
  BRAZIL_RECEITA_ATTEMPT_PLAN_NOT_APPROVED_BLOCKER,
  BRAZIL_RECEITA_ATTEMPT_PLAN_PRECONDITIONS,
  BRAZIL_RECEITA_ATTEMPT_PLAN_REQUIRED_HUMAN_ACTIONS,
  BRAZIL_RECEITA_ATTEMPT_PLAN_STEP_IDS,
  BRAZIL_RECEITA_ATTEMPT_PLAN_STOP_CONDITIONS,
  BRAZIL_RECEITA_ATTEMPT_PLAN_TYPE,
  BRAZIL_RECEITA_ATTEMPT_PLAN_WITHHELD_KEYS as WITHHELD_KEYS,
  buildBrazilReceitaControlledExecutionAttemptPlan,
  buildBrazilReceitaSyntheticControlledExecutionAttemptPlan,
  formatBrazilReceitaControlledExecutionAttemptPlan,
  renderBrazilReceitaControlledExecutionAttemptPlanMarkdown,
  type BrazilReceitaControlledExecutionAttemptPlan,
} from '../br-receita-cnpj-controlled-execution-attempt-plan-generator';
import {
  BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP,
  buildBrazilReceitaControlledExecutionRequestPacket,
} from '../br-receita-cnpj-controlled-execution-request-packet-generator';
import {
  BRAZIL_RECEITA_REVIEW_DECISION_VALUES,
  buildBrazilReceitaSyntheticControlledExecutionReviewDecision,
  validateBrazilReceitaControlledExecutionReviewDecision,
} from '../br-receita-cnpj-controlled-execution-review-decision-validator';
import { evaluateBrazilReceitaControlledExecutionPreflight } from '../br-receita-cnpj-controlled-execution-preflight-evaluator';
import { validateBrazilReceitaOwnerDecisionArtifact } from '../br-receita-cnpj-owner-decision-validator';
import {
  buildBrazilReceitaSyntheticOwnerArtifactFixture,
  type BrazilReceitaSyntheticOwnerArtifactFixtureName,
} from '../br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Paths and helpers ────────────────────────────────────────────────────────

/** Repository root, reached from this test's directory without hardcoding any absolute path. */
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..', '..');

const GENERATOR_CLI = path.join(
  REPO_ROOT,
  'scripts',
  'source-catalog',
  'br-receita-cnpj-controlled-execution-attempt-plan-generator.ts',
);

const VALIDATOR_13E_CLI = path.join(
  REPO_ROOT,
  'scripts',
  'source-catalog',
  'br-receita-cnpj-controlled-execution-review-decision-validator.ts',
);

const GENERATOR_13D_CLI = path.join(
  REPO_ROOT,
  'scripts',
  'source-catalog',
  'br-receita-cnpj-controlled-execution-request-packet-generator.ts',
);

const HARNESS_13C_CLI = path.join(
  REPO_ROOT,
  'scripts',
  'source-catalog',
  'br-receita-cnpj-synthetic-owner-artifact-harness.ts',
);

const GENERATOR_MODULE = path.join(
  __dirname,
  '..',
  'br-receita-cnpj-controlled-execution-attempt-plan-generator.ts',
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
  return runScript(GENERATOR_CLI, args);
}

function approvedPlan(): BrazilReceitaControlledExecutionAttemptPlan {
  return buildBrazilReceitaSyntheticControlledExecutionAttemptPlan('synthetic-ready', 'approve');
}

/** Every fixture that cannot reach a reviewable packet: the catalogue minus the one that can. */
const BLOCKED_FIXTURES: readonly BrazilReceitaSyntheticOwnerArtifactFixtureName[] =
  BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES.filter((name) => name !== 'synthetic-ready');

// ─── 1. Approved plan ─────────────────────────────────────────────────────────

describe('BR-SOURCE-13F approved plan', () => {
  it('reaches plan_ready_for_human_review / GO for synthetic-ready + approve', () => {
    const plan = approvedPlan();

    assert.equal(plan.planType, BRAZIL_RECEITA_ATTEMPT_PLAN_TYPE);
    assert.equal(plan.version, 1);
    assert.equal(plan.generatedAt, BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP);
    assert.equal(plan.fixture, 'synthetic-ready');
    assert.equal(plan.reviewDecisionValue, 'approve');
    assert.equal(plan.status, 'plan_ready_for_human_review');
    assert.equal(plan.goNoGo, 'GO');
    assert.equal(plan.syntheticOnly, true);
    assert.equal(plan.planGenerated, true);
    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.requiredNextHumanActions, [
      ...BRAZIL_RECEITA_ATTEMPT_PLAN_REQUIRED_HUMAN_ACTIONS,
    ]);
  });

  it('a review-ready plan still reports executionStarted as false', () => {
    assert.equal(approvedPlan().executionStarted, false);
  });

  it('a review-ready plan still reports executionAuthorized as false', () => {
    assert.equal(approvedPlan().executionAuthorized, false);
  });

  it('a review-ready plan grants no real-data permission', () => {
    const plan = approvedPlan();

    assert.equal(plan.realDataExecutionAuthorized, false);
    assert.equal(plan.manifestReadAuthorized, false);
    assert.equal(plan.csvZipReadAuthorized, false);
    assert.equal(plan.rowReadsAuthorized, false);
    assert.equal(plan.joinAuthorized, false);
    assert.equal(plan.coverageAuthorized, false);
    assert.equal(plan.importAuthorized, false);
    assert.equal(plan.supabaseWritesAuthorized, false);
    assert.equal(plan.runtimeAuthorized, false);
    assert.equal(plan.agent1Authorized, false);
    assert.equal(plan.providerCallsAuthorized, false);
  });

  it('a review-ready plan approves neither GATE-2, GATE-7 nor the cap / input policy', () => {
    const plan = approvedPlan();

    assert.equal(plan.gate2Approved, false);
    assert.equal(plan.gate7Approved, false);
    assert.equal(plan.capInputPolicyApproved, false);
  });

  it('a review-ready plan does not authorize a controlled execution attempt', () => {
    assert.equal(approvedPlan().controlledExecutionAttemptAuthorized, false);
  });
});

// ─── 2. Blocked plans ─────────────────────────────────────────────────────────

describe('BR-SOURCE-13F blocked plans', () => {
  it('a reject decision yields blocked / NO_GO', () => {
    const plan = buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(
      'synthetic-ready',
      'reject',
    );

    assert.equal(plan.status, 'blocked');
    assert.equal(plan.goNoGo, 'NO_GO');
    assert.equal(plan.reviewDecisionValue, 'reject');
    assert.equal(plan.reviewValidation.decisionOutcome, 'rejected');
  });

  it('a defer decision yields blocked / NO_GO', () => {
    const plan = buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(
      'synthetic-ready',
      'defer',
    );

    assert.equal(plan.status, 'blocked');
    assert.equal(plan.goNoGo, 'NO_GO');
    assert.equal(plan.reviewDecisionValue, 'defer');
    assert.equal(plan.reviewValidation.decisionOutcome, 'deferred');
  });

  it('missing-owner-artifact + approve yields blocked, because the chain already refused', () => {
    const plan = buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(
      'missing-owner-artifact',
      'approve',
    );

    assert.equal(plan.status, 'blocked');
    assert.equal(plan.goNoGo, 'NO_GO');
    assert.equal(plan.reviewValidation.decisionOutcome, 'blocked');
  });

  it('every blocked plan carries at least one blocker, and every blocker is prefixed', () => {
    const blockedPlans = [
      buildBrazilReceitaSyntheticControlledExecutionAttemptPlan('synthetic-ready', 'reject'),
      buildBrazilReceitaSyntheticControlledExecutionAttemptPlan('synthetic-ready', 'defer'),
      ...BLOCKED_FIXTURES.flatMap((fixture) =>
        BRAZIL_RECEITA_REVIEW_DECISION_VALUES.map((decision) =>
          buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(fixture, decision),
        ),
      ),
    ];

    for (const plan of blockedPlans) {
      assert.equal(plan.status, 'blocked', `${plan.fixture} / ${plan.reviewDecisionValue}`);
      assert.ok(
        plan.blockers.length > 0,
        `${plan.fixture} / ${plan.reviewDecisionValue} must state why it is blocked`,
      );
      assert.equal(
        plan.blockers[0],
        `PLAN/${BRAZIL_RECEITA_ATTEMPT_PLAN_NOT_APPROVED_BLOCKER} (${plan.reviewValidation.decisionOutcome})`,
      );
      for (const blocker of plan.blockers.slice(1)) {
        assert.ok(
          blocker.startsWith('REVIEW/'),
          `delegated blockers must name their origin: ${blocker}`,
        );
      }
      assert.equal(plan.requiredNextHumanActions[0], BRAZIL_RECEITA_ATTEMPT_PLAN_BLOCKED_HUMAN_ACTION);
    }
  });

  it('every delegated blocker corresponds to a blocking 13E finding, with none invented', () => {
    for (const fixture of BLOCKED_FIXTURES) {
      const plan = buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(fixture, 'approve');
      const expected = plan.reviewValidation.findings
        .filter((finding) => finding.severity === 'blocking')
        .map((finding) =>
          finding.field === undefined
            ? `REVIEW/${finding.code}`
            : `REVIEW/${finding.code} (${finding.field})`,
        );

      assert.deepEqual(plan.blockers.slice(1), expected, fixture);
    }
  });

  it('a decision whose value was never completed is reported as unrecognized and blocked', () => {
    const plan = buildBrazilReceitaControlledExecutionAttemptPlan({
      fixtureName: 'synthetic-ready',
      reviewDecision: {},
    });

    assert.equal(plan.reviewDecisionValue, 'unrecognized');
    assert.equal(plan.status, 'blocked');
    assert.equal(plan.goNoGo, 'NO_GO');
  });
});

// ─── 3. Embedded upstream artefacts ───────────────────────────────────────────

describe('BR-SOURCE-13F embeds the chain verbatim', () => {
  it('carries the BR-SOURCE-13D request packet without reinterpretation', () => {
    assert.deepEqual(
      approvedPlan().requestPacket,
      buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready'),
    );
  });

  it('carries the BR-SOURCE-13E review validation without reinterpretation', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');
    const reviewDecision = buildBrazilReceitaSyntheticControlledExecutionReviewDecision(
      packet,
      'approve',
    );

    assert.deepEqual(
      approvedPlan().reviewValidation,
      validateBrazilReceitaControlledExecutionReviewDecision({ packet, reviewDecision }),
    );
  });
});

// ─── 4. Plan steps ────────────────────────────────────────────────────────────

describe('BR-SOURCE-13F plan steps', () => {
  it('contains every required step id, in order', () => {
    assert.deepEqual(
      approvedPlan().planSteps.map((step) => step.stepId),
      [...BRAZIL_RECEITA_ATTEMPT_PLAN_STEP_IDS],
    );
  });

  it('allows execution in no step, for any fixture or decision', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        const plan = buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(fixture, decision);
        for (const step of plan.planSteps) {
          assert.equal(step.executionAllowed, false, `${fixture} / ${decision} / ${step.stepId}`);
        }
      }
    }
  });

  it('allows real-data access in no step, for any fixture or decision', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        const plan = buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(fixture, decision);
        for (const step of plan.planSteps) {
          assert.equal(
            step.realDataAccessAllowed,
            false,
            `${fixture} / ${decision} / ${step.stepId}`,
          );
        }
      }
    }
  });

  it('requires human approval in every step, and every step carries prose, not a command', () => {
    for (const step of approvedPlan().planSteps) {
      assert.equal(step.requiresHumanApproval, true, step.stepId);
      assert.ok(step.title.length > 0, step.stepId);
      assert.ok(step.description.length > 0, step.stepId);

      for (const commandShape of ['node --import', 'npm run', 'psql', 'curl ', 'unzip', '&&']) {
        assert.ok(
          !step.description.includes(commandShape),
          `${step.stepId} must not embed a runnable command (${commandShape})`,
        );
      }
    }
  });
});

// ─── 5. Preconditions, stop conditions, human actions ─────────────────────────

describe('BR-SOURCE-13F preconditions, stop conditions and human actions', () => {
  it('states every required precondition', () => {
    const plan = approvedPlan();

    for (const precondition of [
      '13A_VALIDATOR_OFFICIAL',
      '13B_PREFLIGHT_EVALUATOR_OFFICIAL',
      '13C_SYNTHETIC_HARNESS_OFFICIAL',
      '13D_REQUEST_PACKET_GENERATOR_OFFICIAL',
      '13E_REVIEW_DECISION_VALIDATOR_OFFICIAL',
      'REAL_DATA_EXECUTION_REMAINS_NOT_AUTHORIZED',
      'GATE_2_REMAINS_NOT_APPROVED',
      'GATE_7_REMAINS_NOT_APPROVED',
      'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
    ]) {
      assert.ok(plan.preconditions.includes(precondition), `missing precondition ${precondition}`);
    }

    assert.deepEqual(plan.preconditions, [...BRAZIL_RECEITA_ATTEMPT_PLAN_PRECONDITIONS]);
  });

  it('states every required stop condition', () => {
    const plan = approvedPlan();

    for (const stopCondition of [
      'STOP_IF_ANY_REAL_DATA_PATH_IS_PROVIDED',
      'STOP_IF_MANIFEST_OR_CSV_OR_ZIP_IS_REQUESTED',
      'STOP_IF_IMPORT_OR_RUNTIME_OR_AGENT1_IS_REQUESTED',
      'STOP_IF_GATE_APPROVAL_IS_INFERRED',
      'STOP_IF_OWNER_DECISION_IS_MISSING',
      'STOP_IF_REVIEW_APPROVAL_IS_TREATED_AS_EXECUTION_AUTHORIZATION',
    ]) {
      assert.ok(plan.stopConditions.includes(stopCondition), `missing stop ${stopCondition}`);
    }

    assert.deepEqual(plan.stopConditions, [...BRAZIL_RECEITA_ATTEMPT_PLAN_STOP_CONDITIONS]);
  });

  it('states every required next human action, in a blocked plan too', () => {
    const required = [
      'HUMAN_REVIEW_ATTEMPT_PLAN',
      'OWNER_MUST_PROVIDE_REAL_SIGNED_EXECUTION_AUTHORIZATION',
      'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
      'GATE_2_REMAINS_NOT_APPROVED',
      'GATE_7_REMAINS_NOT_APPROVED',
      'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
    ];

    for (const plan of [
      approvedPlan(),
      buildBrazilReceitaSyntheticControlledExecutionAttemptPlan('synthetic-ready', 'reject'),
      buildBrazilReceitaSyntheticControlledExecutionAttemptPlan('missing-owner-artifact', 'approve'),
    ]) {
      for (const action of required) {
        assert.ok(
          plan.requiredNextHumanActions.includes(action),
          `${plan.fixture} / ${plan.reviewDecisionValue} must still require ${action}`,
        );
      }
    }
  });

  it('carries the disclaimer verbatim, on an approved plan included', () => {
    assert.equal(
      BRAZIL_RECEITA_ATTEMPT_PLAN_DISCLAIMER,
      'Plan ready for review is not execution authorization.',
    );

    for (const fixture of BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        assert.equal(
          buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(fixture, decision).disclaimer,
          'Plan ready for review is not execution authorization.',
        );
      }
    }
  });
});

// ─── 6. Determinism and formats ───────────────────────────────────────────────

describe('BR-SOURCE-13F determinism', () => {
  it('renders byte-identical JSON for the same fixture and decision', () => {
    for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
      const first = formatBrazilReceitaControlledExecutionAttemptPlan(
        buildBrazilReceitaSyntheticControlledExecutionAttemptPlan('synthetic-ready', decision),
        'json',
      );
      const second = formatBrazilReceitaControlledExecutionAttemptPlan(
        buildBrazilReceitaSyntheticControlledExecutionAttemptPlan('synthetic-ready', decision),
        'json',
      );

      assert.equal(first, second);
      assert.equal(first.includes('STATIC_SYNTHETIC_TIMESTAMP'), true);
    }
  });

  it('renders byte-identical Markdown for the same fixture and decision', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES) {
      const first = renderBrazilReceitaControlledExecutionAttemptPlanMarkdown(
        buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(fixture, 'approve'),
      );
      const second = formatBrazilReceitaControlledExecutionAttemptPlan(
        buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(fixture, 'approve'),
        'markdown',
      );

      assert.equal(first, second);
    }
  });

  it('the Markdown grants no execution and no execution authorization', () => {
    const markdown = renderBrazilReceitaControlledExecutionAttemptPlanMarkdown(approvedPlan());

    assert.ok(markdown.includes('| executionStarted | NO |'));
    assert.ok(markdown.includes('| executionAuthorized | NO |'));
    assert.ok(markdown.includes('| realDataExecutionAuthorized | NO |'));
    assert.ok(markdown.includes('| controlledExecutionAttemptAuthorized | NO |'));
    assert.ok(markdown.includes('Plan ready for review is not execution authorization.'));
    assert.ok(markdown.includes('A generated plan is not a started run. Brazil remains blocked.'));

    for (const key of WITHHELD_KEYS) {
      assert.ok(!markdown.includes(`| ${key} | YES |`), `${key} must never render as YES`);
    }
  });

  it('the Markdown shows every gate approval as NO', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES) {
      const markdown = renderBrazilReceitaControlledExecutionAttemptPlanMarkdown(
        buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(fixture, 'approve'),
      );

      assert.ok(markdown.includes('| gate2Approved | NO |'), fixture);
      assert.ok(markdown.includes('| gate7Approved | NO |'), fixture);
      assert.ok(markdown.includes('| capInputPolicyApproved | NO |'), fixture);
    }
  });
});

// ─── 7. CLI happy paths ───────────────────────────────────────────────────────

describe('BR-SOURCE-13F CLI', () => {
  it('prints JSON for an approved plan and exits 0', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    const plan = JSON.parse(run.stdout) as Record<string, unknown>;

    assert.equal(plan.planType, BRAZIL_RECEITA_ATTEMPT_PLAN_TYPE);
    assert.equal(plan.status, 'plan_ready_for_human_review');
    assert.equal(plan.goNoGo, 'GO');
    assert.equal(plan.executionStarted, false);
    assert.equal(plan.executionAuthorized, false);
  });

  it('indents JSON with --pretty and prints the same plan', () => {
    const compact = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);
    const pretty = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
      '--pretty',
    ]);

    assert.equal(pretty.status, 0, pretty.stderr);
    assert.ok(pretty.stdout.includes('\n  "planType"'));
    assert.deepEqual(JSON.parse(pretty.stdout), JSON.parse(compact.stdout));
  });

  it('prints Markdown and exits 0', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'markdown',
    ]);

    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.startsWith('# BR Receita CNPJ — controlled execution attempt plan'));
    assert.ok(run.stdout.includes('Plan ready for review is not execution authorization.'));
    assert.ok(run.stdout.includes('| executionStarted | NO |'));
  });

  it('exits 0 for a rejected decision, because a recorded refusal is a correct outcome', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'reject', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    const plan = JSON.parse(run.stdout) as Record<string, unknown>;

    assert.equal(plan.status, 'blocked');
    assert.equal(plan.goNoGo, 'NO_GO');
  });

  it('exits 0 for a blocked fixture and prints the blocked plan', () => {
    const run = runCli([
      '--fixture',
      'missing-owner-artifact',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const plan = JSON.parse(run.stdout) as { status: string; blockers: string[] };

    assert.equal(plan.status, 'blocked');
    assert.ok(plan.blockers.length > 0);
  });
});

// ─── 8. CLI refusals ──────────────────────────────────────────────────────────

describe('BR-SOURCE-13F CLI refusals', () => {
  function assertUsageError(run: CliRun, code: string): void {
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.ok(run.stderr.includes(code), `expected ${code} in: ${run.stderr}`);
  }

  it('requires --fixture', () => {
    assertUsageError(
      runCli(['--decision', 'approve', '--format', 'json']),
      'BRSOURCE13F_FIXTURE_REQUIRED',
    );
    assertUsageError(
      runCli(['--fixture', '--decision', 'approve', '--format', 'json']),
      'BRSOURCE13F_FIXTURE_REQUIRED',
    );
  });

  it('requires --decision', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--format', 'json']),
      'BRSOURCE13F_DECISION_REQUIRED',
    );
  });

  it('requires --format', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', 'approve']),
      'BRSOURCE13F_FORMAT_REQUIRED',
    );
  });

  it('refuses an unknown fixture', () => {
    assertUsageError(
      runCli(['--fixture', 'not-a-fixture', '--decision', 'approve', '--format', 'json']),
      'BRSOURCE13F_FIXTURE_UNKNOWN',
    );
  });

  it('refuses an unknown decision, including 13A owner spellings', () => {
    for (const decision of ['maybe', 'approved', 'rejected', 'deferred']) {
      assertUsageError(
        runCli(['--fixture', 'synthetic-ready', '--decision', decision, '--format', 'json']),
        'BRSOURCE13F_DECISION_UNKNOWN',
      );
    }
  });

  it('refuses an unknown format', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'yaml']),
      'BRSOURCE13F_FORMAT_UNKNOWN',
    );
  });

  it('refuses every location, payload and real-data flag, bare and as --flag=value', () => {
    for (const flag of ['--manifest', '--input', '--output', '--path', '--real-data']) {
      assertUsageError(runCli([flag, 'anything']), 'BRSOURCE13F_FORBIDDEN_ARGUMENT');
      assertUsageError(runCli([`${flag}=anything`]), 'BRSOURCE13F_FORBIDDEN_ARGUMENT');
    }
  });

  it('refuses every execute, run and apply flag, bare and as --flag=value', () => {
    for (const flag of ['--execute', '--run', '--apply']) {
      assertUsageError(runCli([flag]), 'BRSOURCE13F_FORBIDDEN_ARGUMENT');
      assertUsageError(runCli([`${flag}=true`]), 'BRSOURCE13F_FORBIDDEN_ARGUMENT');
    }
  });

  it('refuses a forbidden flag even alongside otherwise valid arguments', () => {
    assertUsageError(
      runCli([
        '--fixture',
        'synthetic-ready',
        '--decision',
        'approve',
        '--format',
        'json',
        '--execute',
      ]),
      'BRSOURCE13F_FORBIDDEN_ARGUMENT',
    );
  });

  it('refuses any other unknown argument', () => {
    assertUsageError(runCli(['--verbose']), 'BRSOURCE13F_UNKNOWN_ARGUMENT');
  });

  it('refuses positional arguments', () => {
    assertUsageError(runCli(['plan.json']), 'BRSOURCE13F_UNKNOWN_ARGUMENT');
    assertUsageError(
      runCli([
        '--fixture',
        'synthetic-ready',
        '--decision',
        'approve',
        '--format',
        'json',
        'extra-positional',
      ]),
      'BRSOURCE13F_UNKNOWN_ARGUMENT',
    );
  });
});

// ─── 9. Static guards ─────────────────────────────────────────────────────────

describe('BR-SOURCE-13F static guards', () => {
  it('the generator module reaches no filesystem, process, database or runtime surface', () => {
    const source = fs.readFileSync(GENERATOR_MODULE, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      './br-receita-cnpj-controlled-execution-request-packet-generator',
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
      assert.ok(!source.includes(forbidden), `the generator module must not reference ${forbidden}`);
    }
  });

  it('the CLI reaches no filesystem, process-spawning, database or runtime surface', () => {
    const source = fs.readFileSync(GENERATOR_CLI, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-attempt-plan-generator',
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
  });

  it('the CLI touches process only through argv, stdout, stderr and the exit code', () => {
    const source = fs.readFileSync(GENERATOR_CLI, 'utf8');
    const processUses = [...source.matchAll(/process\.[A-Za-z]+/g)].map((match) => match[0]);

    assert.ok(processUses.length > 0, 'the CLI reads the argument vector, so uses must be present');
    for (const use of processUses) {
      assert.ok(
        ['process.argv', 'process.stdout', 'process.stderr', 'process.exitCode'].includes(use),
        `unexpected process surface in the CLI: ${use}`,
      );
    }
  });

  it('neither file offers a path, manifest, real-data or execution input surface', () => {
    for (const file of [GENERATOR_MODULE, GENERATOR_CLI]) {
      const source = fs.readFileSync(file, 'utf8');

      // Call-shaped tokens only: the prose in these files legitimately discusses file reads and
      // spawning in order to state that neither happens.
      for (const forbidden of [
        'readFile',
        'writeFile',
        'createWriteStream',
        'spawnSync(',
        'exec(',
      ]) {
        assert.ok(!source.includes(forbidden), `${file} must not reference ${forbidden}`);
      }
    }
  });

  it('no state or authorization flag can be true for any fixture and decision combination', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        const plan = buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(fixture, decision);

        for (const key of WITHHELD_KEYS) {
          assert.equal(plan[key], false, `${fixture} / ${decision} / ${key} must stay false`);
        }
      }
    }
  });
});

// ─── 10. Upstream regressions ─────────────────────────────────────────────────

describe('BR-SOURCE-13F upstream regressions', () => {
  it('BR-SOURCE-13E still approves the synthetic-ready packet for planning review only', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet,
      reviewDecision: buildBrazilReceitaSyntheticControlledExecutionReviewDecision(
        packet,
        'approve',
      ),
    });

    assert.equal(result.status, 'valid');
    assert.equal(result.goNoGo, 'GO');
    assert.equal(result.decisionOutcome, 'approved_for_next_planning_review');
    assert.equal(result.canProceedToControlledExecutionAttemptPlanningReview, true);
    assert.equal(result.controlledExecutionAttemptAuthorized, false);
  });

  it('the BR-SOURCE-13E CLI still exits 0 and prints an approved review decision', () => {
    const run = runScript(VALIDATOR_13E_CLI, [
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout) as { result: Record<string, unknown> };

    assert.equal(report.result.status, 'valid');
    assert.equal(report.result.goNoGo, 'GO');
  });

  it('BR-SOURCE-13D still produces a ready_for_review packet for synthetic-ready', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');

    assert.equal(packet.status, 'ready_for_review');
    assert.equal(packet.goNoGo, 'GO');
    assert.deepEqual(packet.blockers, []);
  });

  it('the BR-SOURCE-13D CLI still exits 0 and prints a ready_for_review packet', () => {
    const run = runScript(GENERATOR_13D_CLI, ['--fixture', 'synthetic-ready', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    const packet = JSON.parse(run.stdout) as Record<string, unknown>;

    assert.equal(packet.status, 'ready_for_review');
    assert.equal(packet.goNoGo, 'GO');
  });

  it('the BR-SOURCE-13C harness still reaches ready / GO for synthetic-ready', () => {
    const run = runScript(HARNESS_13C_CLI, ['--fixture', 'synthetic-ready']);

    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout) as { result: Record<string, unknown> };

    assert.equal(report.result.status, 'ready');
    assert.equal(report.result.goNoGo, 'GO');
  });

  it('BR-SOURCE-13B still reaches ready / GO for the synthetic-ready request', () => {
    const preflight = evaluateBrazilReceitaControlledExecutionPreflight(
      buildBrazilReceitaSyntheticOwnerArtifactFixture('synthetic-ready'),
    );

    assert.equal(preflight.status, 'ready');
    assert.equal(preflight.goNoGo, 'GO');
    assert.equal(preflight.canProceedToControlledExecutionAttemptReview, true);
  });

  it('BR-SOURCE-13A still validates the synthetic-ready owner artifact through the chain', () => {
    const request = buildBrazilReceitaSyntheticOwnerArtifactFixture('synthetic-ready');
    const owner = validateBrazilReceitaOwnerDecisionArtifact(request.ownerDecisionArtifact);

    assert.equal(owner.status, 'valid');
    assert.equal(owner.goNoGo, 'GO');
    assert.equal(owner.canProceedToControlledExecutionPreflight, true);
  });
});
