/**
 * BR Receita CNPJ — controlled execution attempt runner scaffold — tests (BR-SOURCE-13G).
 *
 * Three load-bearing properties:
 *
 *   1. The attempt is only ever scaffolded over what the chain actually decided. 13F's plan travels
 *      inside the result verbatim, and 13G re-implements none of 13A's, 13B's, 13D's, 13E's or 13F's
 *      rules.
 *   2. Fail-closed, with no exit. A review-ready plan yields `blocked_no_execution_authorization`; a
 *      blocked plan yields `blocked_plan_not_ready`; there is no third outcome, `goNoGo` is `NO_GO` in
 *      every case, and the CLI refuses every argument that is not `--fixture`, `--decision`, `--format`
 *      or `--pretty`.
 *   3. Runner scaffold result is not execution authorization, and a created runner scaffold is not a
 *      started run. No result and no step, in any format, over any fixture and any decision, sets a
 *      state, permission or authorization field to `true`.
 *
 * 100% offline and synthetic. No dataset, no manifest, no CSV, no ZIP, no row, no join, no coverage,
 * no import, no Supabase, no network, no runtime, no provider, no Agent 1. Two kinds of process
 * interaction happen HERE and nowhere in the runner scaffold or its CLI: this file reads this
 * repository's OWN sources for the static guards, and spawns the CLIs to test them as CLIs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  BRAZIL_RECEITA_ATTEMPT_RUNNER_BLOCKERS,
  BRAZIL_RECEITA_ATTEMPT_RUNNER_DISCLAIMER,
  BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES,
  BRAZIL_RECEITA_ATTEMPT_RUNNER_REQUIRED_HUMAN_ACTIONS,
  BRAZIL_RECEITA_ATTEMPT_RUNNER_RESULT_TYPE,
  BRAZIL_RECEITA_ATTEMPT_RUNNER_SAFETY_ASSERTIONS,
  BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_BLOCKED_REASON,
  BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_SKIPPED_REASON,
  BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_WITHHELD_KEYS as STEP_WITHHELD_KEYS,
  BRAZIL_RECEITA_ATTEMPT_RUNNER_WITHHELD_KEYS as WITHHELD_KEYS,
  formatBrazilReceitaControlledExecutionAttemptRunnerScaffoldResult,
  renderBrazilReceitaControlledExecutionAttemptRunnerScaffoldMarkdown,
  runBrazilReceitaControlledExecutionAttemptRunnerScaffold,
  type BrazilReceitaControlledExecutionAttemptRunnerResult,
} from '../br-receita-cnpj-controlled-execution-attempt-runner-scaffold';
import {
  buildBrazilReceitaControlledExecutionAttemptPlan,
  buildBrazilReceitaSyntheticControlledExecutionAttemptPlan,
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

const RUNNER_CLI = path.join(
  REPO_ROOT,
  'scripts',
  'source-catalog',
  'br-receita-cnpj-controlled-execution-attempt-runner-scaffold.ts',
);

const GENERATOR_13F_CLI = path.join(
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

const RUNNER_MODULE = path.join(
  __dirname,
  '..',
  'br-receita-cnpj-controlled-execution-attempt-runner-scaffold.ts',
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
  return runScript(RUNNER_CLI, args);
}

function scaffold(
  fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName,
  reviewDecisionValue: 'approve' | 'reject' | 'defer',
): BrazilReceitaControlledExecutionAttemptRunnerResult {
  return runBrazilReceitaControlledExecutionAttemptRunnerScaffold({
    fixtureName,
    reviewDecisionValue,
  });
}

/** The only combination that can reach a review-ready plan, and therefore the reached-and-blocked path. */
function approvedScaffold(): BrazilReceitaControlledExecutionAttemptRunnerResult {
  return scaffold('synthetic-ready', 'approve');
}

/** Every fixture that cannot reach a reviewable packet: the catalogue minus the one that can. */
const BLOCKED_FIXTURES: readonly BrazilReceitaSyntheticOwnerArtifactFixtureName[] =
  BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES.filter((name) => name !== 'synthetic-ready');

/** The blockers a result inherited from 13F, i.e. everything past this module's unconditional list. */
function inheritedBlockers(result: BrazilReceitaControlledExecutionAttemptRunnerResult): string[] {
  return result.blockers.slice(BRAZIL_RECEITA_ATTEMPT_RUNNER_BLOCKERS.length);
}

// ─── 1. A review-ready plan is still refused ──────────────────────────────────

describe('BR-SOURCE-13G result over a review-ready plan', () => {
  it('reaches blocked_no_execution_authorization / NO_GO for synthetic-ready + approve', () => {
    const result = approvedScaffold();

    assert.equal(result.resultType, BRAZIL_RECEITA_ATTEMPT_RUNNER_RESULT_TYPE);
    assert.equal(result.version, 1);
    assert.equal(result.generatedAt, BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP);
    assert.equal(result.fixture, 'synthetic-ready');
    assert.equal(result.reviewDecisionValue, 'approve');
    assert.equal(result.status, 'blocked_no_execution_authorization');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.syntheticOnly, true);
    assert.equal(result.runnerScaffoldCreated, true);

    // The plan underneath reached GO; the attempt over it is refused anyway.
    assert.equal(result.plan.status, 'plan_ready_for_human_review');
    assert.equal(result.plan.goNoGo, 'GO');
    assert.deepEqual(result.blockers, [...BRAZIL_RECEITA_ATTEMPT_RUNNER_BLOCKERS]);
  });

  it('never starts execution, even over a plan that reached GO', () => {
    assert.equal(approvedScaffold().executionStarted, false);
  });

  it('never attempts execution, even over a plan that reached GO', () => {
    assert.equal(approvedScaffold().executionAttempted, false);
  });

  it('never authorizes execution, even over a plan that reached GO', () => {
    const result = approvedScaffold();

    assert.equal(result.executionAuthorized, false);
    assert.equal(result.realDataExecutionAuthorized, false);
  });

  it('grants no real-data permission and records no real-data access', () => {
    const result = approvedScaffold();

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

  it('approves neither GATE-2, GATE-7 nor the cap / input policy', () => {
    const result = approvedScaffold();

    assert.equal(result.gate2Approved, false);
    assert.equal(result.gate7Approved, false);
    assert.equal(result.capInputPolicyApproved, false);
  });

  it('does not authorize a controlled execution attempt', () => {
    assert.equal(approvedScaffold().controlledExecutionAttemptAuthorized, false);
  });
});

// ─── 2. Plans that never became reviewable ────────────────────────────────────

describe('BR-SOURCE-13G results over blocked plans', () => {
  it('a reject decision yields blocked_plan_not_ready / NO_GO', () => {
    const result = scaffold('synthetic-ready', 'reject');

    assert.equal(result.status, 'blocked_plan_not_ready');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.reviewDecisionValue, 'reject');
    assert.equal(result.plan.status, 'blocked');
  });

  it('a defer decision yields blocked_plan_not_ready / NO_GO', () => {
    const result = scaffold('synthetic-ready', 'defer');

    assert.equal(result.status, 'blocked_plan_not_ready');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.reviewDecisionValue, 'defer');
    assert.equal(result.plan.status, 'blocked');
  });

  it('missing-owner-artifact with an approve decision still yields blocked_plan_not_ready', () => {
    const result = scaffold('missing-owner-artifact', 'approve');

    assert.equal(result.status, 'blocked_plan_not_ready');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.plan.status, 'blocked');
  });

  it('every blocked plan contributes its blockers under a PLAN/ prefix', () => {
    const blockedCombinations: readonly {
      readonly fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
      readonly decision: 'approve' | 'reject' | 'defer';
    }[] = [
      ...BLOCKED_FIXTURES.map((fixture) => ({ fixture, decision: 'approve' as const })),
      { fixture: 'synthetic-ready' as const, decision: 'reject' as const },
      { fixture: 'synthetic-ready' as const, decision: 'defer' as const },
    ];

    for (const { fixture, decision } of blockedCombinations) {
      const result = scaffold(fixture, decision);
      const inherited = inheritedBlockers(result);

      assert.equal(result.status, 'blocked_plan_not_ready', `${fixture} / ${decision}`);
      assert.ok(inherited.length > 0, `${fixture} / ${decision} must inherit at least one blocker`);
      assert.equal(inherited.length, result.plan.blockers.length, `${fixture} / ${decision}`);

      for (const blocker of inherited) {
        assert.ok(
          blocker.startsWith('PLAN/'),
          `${fixture} / ${decision}: inherited blocker must be PLAN-prefixed, got "${blocker}"`,
        );
      }

      // This module's own unconditional blockers always lead, so a blocked result is never an
      // empty-list refusal.
      assert.deepEqual(
        result.blockers.slice(0, BRAZIL_RECEITA_ATTEMPT_RUNNER_BLOCKERS.length),
        [...BRAZIL_RECEITA_ATTEMPT_RUNNER_BLOCKERS],
        `${fixture} / ${decision}`,
      );
    }
  });
});

// ─── 3. The plan travels verbatim, and its steps become records ───────────────

describe('BR-SOURCE-13G plan delegation and step results', () => {
  it('carries the 13F plan verbatim, including the plan the two-step 13D + 13E path produces', () => {
    const result = approvedScaffold();

    // Identical to 13F's own synthetic builder...
    assert.deepEqual(
      result.plan,
      buildBrazilReceitaSyntheticControlledExecutionAttemptPlan('synthetic-ready', 'approve'),
    );

    // ...and identical to the explicit 13D packet + 13E decision + 13F plan path, so 13G cannot have
    // reconstructed the decision differently from the chain that owns it.
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');
    assert.deepEqual(
      result.plan,
      buildBrazilReceitaControlledExecutionAttemptPlan({
        fixtureName: 'synthetic-ready',
        reviewDecision: buildBrazilReceitaSyntheticControlledExecutionReviewDecision(
          packet,
          'approve',
        ),
      }),
    );
  });

  it('generates exactly one step result per plan step, in the plan order', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        const result = scaffold(fixture, decision);

        assert.equal(
          result.stepResults.length,
          result.plan.planSteps.length,
          `${fixture} / ${decision}`,
        );
        assert.deepEqual(
          result.stepResults.map((step) => step.stepId),
          result.plan.planSteps.map((step) => step.stepId),
          `${fixture} / ${decision}`,
        );
        assert.deepEqual(
          result.stepResults.map((step) => step.title),
          result.plan.planSteps.map((step) => step.title),
          `${fixture} / ${decision}`,
        );
      }
    }
  });

  it('marks every step blocked when the plan was reviewable but the attempt is unauthorized', () => {
    const result = approvedScaffold();

    assert.ok(result.stepResults.length > 0);
    for (const step of result.stepResults) {
      assert.equal(step.status, 'blocked', step.stepId);
      assert.equal(step.reason, BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_BLOCKED_REASON, step.stepId);
    }
  });

  it('marks every step skipped when the plan never became reviewable', () => {
    for (const fixture of BLOCKED_FIXTURES) {
      const result = scaffold(fixture, 'approve');

      assert.ok(result.stepResults.length > 0, fixture);
      for (const step of result.stepResults) {
        assert.equal(step.status, 'skipped', `${fixture} / ${step.stepId}`);
        assert.equal(
          step.reason,
          BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_SKIPPED_REASON,
          `${fixture} / ${step.stepId}`,
        );
      }
    }
  });

  it('reports executionAttempted as false on every step of every result', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        for (const step of scaffold(fixture, decision).stepResults) {
          assert.equal(step.executionAttempted, false, `${fixture} / ${decision} / ${step.stepId}`);
        }
      }
    }
  });

  it('reports realDataAccessed as false on every step of every result', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        for (const step of scaffold(fixture, decision).stepResults) {
          assert.equal(step.realDataAccessed, false, `${fixture} / ${decision} / ${step.stepId}`);
        }
      }
    }
  });

  it('reports every manifest, CSV/ZIP, row, import, Supabase, runtime, Agent 1 and provider step flag as false', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        for (const step of scaffold(fixture, decision).stepResults) {
          assert.equal(step.manifestRead, false, step.stepId);
          assert.equal(step.csvZipRead, false, step.stepId);
          assert.equal(step.rowReads, false, step.stepId);
          assert.equal(step.importExecuted, false, step.stepId);
          assert.equal(step.supabaseWrites, false, step.stepId);
          assert.equal(step.runtimeActivated, false, step.stepId);
          assert.equal(step.agent1Activated, false, step.stepId);
          assert.equal(step.providerCalls, false, step.stepId);
        }
      }
    }
  });
});

// ─── 4. Assertions, human actions, disclaimer ─────────────────────────────────

describe('BR-SOURCE-13G assertions and owed human actions', () => {
  it('states every safety assertion on every result', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        assert.deepEqual(
          scaffold(fixture, decision).safetyAssertions,
          [...BRAZIL_RECEITA_ATTEMPT_RUNNER_SAFETY_ASSERTIONS],
          `${fixture} / ${decision}`,
        );
      }
    }

    for (const assertion of [
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
    ]) {
      assert.ok(
        approvedScaffold().safetyAssertions.includes(assertion),
        `missing safety assertion ${assertion}`,
      );
    }
  });

  it('still owes every human action on every result, review-ready plan included', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        assert.deepEqual(
          scaffold(fixture, decision).requiredNextHumanActions,
          [...BRAZIL_RECEITA_ATTEMPT_RUNNER_REQUIRED_HUMAN_ACTIONS],
          `${fixture} / ${decision}`,
        );
      }
    }

    for (const action of [
      'HUMAN_REVIEW_RUNNER_SCAFFOLD_RESULT',
      'OWNER_MUST_PROVIDE_REAL_SIGNED_EXECUTION_AUTHORIZATION',
      'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
      'GATE_2_REMAINS_NOT_APPROVED',
      'GATE_7_REMAINS_NOT_APPROVED',
      'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
    ]) {
      assert.ok(
        approvedScaffold().requiredNextHumanActions.includes(action),
        `missing human action ${action}`,
      );
    }
  });

  it('carries the exact disclaimer on every result', () => {
    assert.equal(
      BRAZIL_RECEITA_ATTEMPT_RUNNER_DISCLAIMER,
      'Runner scaffold result is not execution authorization.',
    );

    for (const fixture of BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        assert.equal(
          scaffold(fixture, decision).disclaimer,
          'Runner scaffold result is not execution authorization.',
          `${fixture} / ${decision}`,
        );
      }
    }
  });
});

// ─── 5. Determinism ───────────────────────────────────────────────────────────

describe('BR-SOURCE-13G determinism', () => {
  it('produces byte-identical JSON for the same fixture and decision', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        const first = formatBrazilReceitaControlledExecutionAttemptRunnerScaffoldResult(
          scaffold(fixture, decision),
          'json',
        );
        const second = formatBrazilReceitaControlledExecutionAttemptRunnerScaffoldResult(
          scaffold(fixture, decision),
          'json',
        );

        assert.equal(first, second, `${fixture} / ${decision}`);
        assert.deepEqual(scaffold(fixture, decision), scaffold(fixture, decision));
      }
    }
  });

  it('produces byte-identical Markdown for the same fixture and decision', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        const first = renderBrazilReceitaControlledExecutionAttemptRunnerScaffoldMarkdown(
          scaffold(fixture, decision),
        );
        const second = formatBrazilReceitaControlledExecutionAttemptRunnerScaffoldResult(
          scaffold(fixture, decision),
          'markdown',
          true,
        );

        assert.equal(first, second, `${fixture} / ${decision}`);
      }
    }
  });

  it('says in Markdown that there is no execution authorization', () => {
    const markdown = renderBrazilReceitaControlledExecutionAttemptRunnerScaffoldMarkdown(
      approvedScaffold(),
    );

    assert.match(markdown, /## No execution authorization/);
    assert.match(markdown, /Runner scaffold result is not execution authorization\./);
    assert.match(markdown, /A created runner scaffold is not a started run\./);
    assert.match(markdown, /Brazil remains blocked\./);
    assert.match(markdown, /Go \/ No-Go: \*\*NO_GO\*\*/);
    assert.match(markdown, /\| executionStarted \| NO \|/);
    assert.match(markdown, /\| executionAttempted \| NO \|/);
    assert.match(markdown, /\| controlledExecutionAttemptAuthorized \| NO \|/);
    assert.ok(!markdown.includes('| YES |'), 'no withheld row may render as YES');
  });
});

// ─── 6. CLI happy paths ───────────────────────────────────────────────────────

describe('BR-SOURCE-13G CLI output', () => {
  it('prints JSON for synthetic-ready + approve and exits 0', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');

    const result = JSON.parse(run.stdout) as Record<string, unknown>;
    assert.equal(result.resultType, BRAZIL_RECEITA_ATTEMPT_RUNNER_RESULT_TYPE);
    assert.equal(result.status, 'blocked_no_execution_authorization');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.executionStarted, false);
    assert.equal(result.executionAttempted, false);
    assert.equal(result.controlledExecutionAttemptAuthorized, false);
  });

  it('prints indented JSON with --pretty and exits 0', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
      '--pretty',
    ]);

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /\n {2}"resultType": /);

    const pretty = JSON.parse(run.stdout) as Record<string, unknown>;
    const compact = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    // Same result, different only in whitespace.
    assert.deepEqual(pretty, JSON.parse(compact.stdout));
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
    assert.match(run.stdout, /# BR Receita CNPJ — controlled execution attempt runner scaffold result/);
    assert.match(run.stdout, /Runner scaffold result is not execution authorization\./);
    assert.ok(!run.stdout.includes('| YES |'));
  });

  it('exits 0 for a reject decision, because a refusal is a correct outcome', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'reject', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');

    const result = JSON.parse(run.stdout) as Record<string, unknown>;
    assert.equal(result.status, 'blocked_plan_not_ready');
    assert.equal(result.goNoGo, 'NO_GO');
  });

  it('exits 0 for a blocked fixture, because a refusal is a correct outcome', () => {
    const run = runCli([
      '--fixture',
      'missing-owner-artifact',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');

    const result = JSON.parse(run.stdout) as Record<string, unknown>;
    assert.equal(result.status, 'blocked_plan_not_ready');
    assert.equal(result.goNoGo, 'NO_GO');
  });
});

// ─── 7. CLI usage errors ──────────────────────────────────────────────────────

describe('BR-SOURCE-13G CLI usage errors', () => {
  it('refuses a missing --fixture', () => {
    const run = runCli(['--decision', 'approve', '--format', 'json']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13G_FIXTURE_REQUIRED/);
  });

  it('refuses a missing --decision', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--format', 'json']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13G_DECISION_REQUIRED/);
  });

  it('refuses a missing --format', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13G_FORMAT_REQUIRED/);
  });

  it('refuses an unknown fixture', () => {
    const run = runCli([
      '--fixture',
      'not-a-fixture',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13G_FIXTURE_UNKNOWN/);
  });

  it('refuses an unknown decision', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'authorize',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13G_DECISION_UNKNOWN/);
  });

  it('refuses an unknown format', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'csv',
    ]);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13G_FORMAT_UNKNOWN/);
  });
});

// ─── 8. CLI forbidden arguments ───────────────────────────────────────────────

describe('BR-SOURCE-13G CLI forbidden arguments', () => {
  /** Asserts a flag is refused before anything is produced, in both spellings. */
  function assertForbidden(flag: string, value = 'anything'): void {
    const base = ['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json'];

    for (const args of [
      [...base, flag, value],
      [...base, `${flag}=${value}`],
      [flag, value, ...base],
    ]) {
      const run = runCli(args);

      assert.equal(run.status, 1, `${flag} must be refused: ${args.join(' ')}`);
      assert.equal(run.stdout, '', `${flag} must produce no output`);
      assert.match(run.stderr, /BRSOURCE13G_FORBIDDEN_ARGUMENT/);
      assert.ok(run.stderr.includes(flag), `the error must name ${flag}`);
    }
  }

  it('refuses --manifest', () => {
    assertForbidden('--manifest');
  });

  it('refuses --input', () => {
    assertForbidden('--input');
  });

  it('refuses --output', () => {
    assertForbidden('--output');
  });

  it('refuses --path', () => {
    assertForbidden('--path');
  });

  it('refuses --real-data', () => {
    assertForbidden('--real-data');
  });

  it('refuses --execute', () => {
    assertForbidden('--execute');
  });

  it('refuses --run', () => {
    assertForbidden('--run');
  });

  it('refuses --apply', () => {
    assertForbidden('--apply');
  });

  it('refuses --force', () => {
    assertForbidden('--force');
  });

  it('refuses any unknown argument', () => {
    for (const flag of ['--verbose', '--yes', '--all', '--debug']) {
      const run = runCli([
        '--fixture',
        'synthetic-ready',
        '--decision',
        'approve',
        '--format',
        'json',
        flag,
      ]);

      assert.equal(run.status, 1, flag);
      assert.equal(run.stdout, '');
      assert.match(run.stderr, /BRSOURCE13G_UNKNOWN_ARGUMENT/);
    }
  });

  it('refuses a positional argument, so nothing can be passed as a bare location', () => {
    for (const positional of ['synthetic-ready', './somewhere', 'run']) {
      const run = runCli([
        positional,
        '--fixture',
        'synthetic-ready',
        '--decision',
        'approve',
        '--format',
        'json',
      ]);

      assert.equal(run.status, 1, positional);
      assert.equal(run.stdout, '');
      assert.match(run.stderr, /BRSOURCE13G_UNKNOWN_ARGUMENT/);
    }
  });
});

// ─── 9. Static guards ─────────────────────────────────────────────────────────

describe('BR-SOURCE-13G static guards', () => {
  it('the runner scaffold module reaches no filesystem, process, database or runtime surface', () => {
    const source = fs.readFileSync(RUNNER_MODULE, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      './br-receita-cnpj-controlled-execution-attempt-plan-generator',
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
      assert.ok(
        !source.includes(forbidden),
        `the runner scaffold module must not reference ${forbidden}`,
      );
    }
  });

  it('the CLI reaches no filesystem, process-spawning, database or runtime surface', () => {
    const source = fs.readFileSync(RUNNER_CLI, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-attempt-runner-scaffold',
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
  });

  it('neither file offers a path, manifest, real-data or execution input surface', () => {
    for (const file of [RUNNER_MODULE, RUNNER_CLI]) {
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

  it('no state, permission or authorization flag can be true for any fixture and decision combination', () => {
    for (const fixture of BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        const result = scaffold(fixture, decision);

        assert.equal(result.goNoGo, 'NO_GO', `${fixture} / ${decision}`);
        assert.ok(
          ['blocked_no_execution_authorization', 'blocked_plan_not_ready'].includes(result.status),
          `${fixture} / ${decision}: unexpected status ${result.status}`,
        );

        for (const key of WITHHELD_KEYS) {
          assert.equal(result[key], false, `${fixture} / ${decision} / ${key} must stay false`);
        }

        for (const step of result.stepResults) {
          for (const key of STEP_WITHHELD_KEYS) {
            assert.equal(
              step[key],
              false,
              `${fixture} / ${decision} / ${step.stepId} / ${key} must stay false`,
            );
          }
        }
      }
    }
  });
});

// ─── 10. Upstream regressions ─────────────────────────────────────────────────

describe('BR-SOURCE-13G upstream regressions', () => {
  it('BR-SOURCE-13F still reaches plan_ready_for_human_review for synthetic-ready + approve', () => {
    const plan = buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(
      'synthetic-ready',
      'approve',
    );

    assert.equal(plan.status, 'plan_ready_for_human_review');
    assert.equal(plan.goNoGo, 'GO');
    assert.equal(plan.planGenerated, true);
    assert.equal(plan.executionStarted, false);
    assert.equal(plan.controlledExecutionAttemptAuthorized, false);

    const run = runScript(GENERATOR_13F_CLI, [
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as Record<string, unknown>;
    assert.equal(printed.status, 'plan_ready_for_human_review');
    assert.equal(printed.goNoGo, 'GO');
  });

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

    const run = runScript(GENERATOR_13D_CLI, ['--fixture', 'synthetic-ready', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as Record<string, unknown>;
    assert.equal(printed.status, 'ready_for_review');
    assert.equal(printed.goNoGo, 'GO');
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
