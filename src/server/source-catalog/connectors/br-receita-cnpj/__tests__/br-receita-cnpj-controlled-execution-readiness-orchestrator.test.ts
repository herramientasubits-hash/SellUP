/**
 * BR Receita CNPJ — controlled execution readiness orchestrator — tests (BR-SOURCE-13H).
 *
 * Three load-bearing properties:
 *
 *   1. The readiness answer is only ever built from what the chain actually decided. 13G's result
 *      travels inside the report verbatim, and 13H re-implements none of 13A–13G's rules.
 *   2. Fail-closed, with no exit. An operational chain yields
 *      `synthetic_chain_operational_execution_blocked`; a chain that stopped earlier yields
 *      `synthetic_chain_blocked`; there is no third outcome, `goNoGo` is `NO_GO` and
 *      `productionReadiness` is `not_ready_blocked` in every case, and the CLI refuses every argument
 *      that is not `--fixture`, `--decision`, `--format` or `--pretty`.
 *   3. Readiness report is not execution authorization, and an operational synthetic chain is not
 *      production readiness. No report, in any format, over any fixture and any decision, sets a state,
 *      permission or authorization field to `true`.
 *
 * 100% offline and synthetic. No dataset, no manifest, no CSV, no ZIP, no row, no join, no coverage,
 * no import, no Supabase, no network, no runtime, no provider, no Agent 1. Two kinds of process
 * interaction happen HERE and nowhere in the orchestrator or its CLI: this file reads this
 * repository's OWN sources for the static guards, and spawns the CLIs to test them as CLIs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  BRAZIL_RECEITA_READINESS_CONCLUSION,
  BRAZIL_RECEITA_READINESS_DISCLAIMER,
  BRAZIL_RECEITA_READINESS_FIXTURE_NAMES,
  BRAZIL_RECEITA_READINESS_OFFICIAL_STACK_KEYS as OFFICIAL_STACK_KEYS,
  BRAZIL_RECEITA_READINESS_PRODUCTION_BLOCKERS,
  BRAZIL_RECEITA_READINESS_PRODUCTION_BLOCKER_IDS,
  BRAZIL_RECEITA_READINESS_REPORT_TYPE,
  BRAZIL_RECEITA_READINESS_REQUIRED_HUMAN_ACTIONS,
  BRAZIL_RECEITA_READINESS_SAFETY_ASSERTIONS,
  BRAZIL_RECEITA_READINESS_WITHHELD_KEYS as WITHHELD_KEYS,
  buildBrazilReceitaControlledExecutionReadinessReport,
  formatBrazilReceitaControlledExecutionReadinessReport,
  renderBrazilReceitaControlledExecutionReadinessReportMarkdown,
  type BrazilReceitaControlledExecutionReadinessReport,
} from '../br-receita-cnpj-controlled-execution-readiness-orchestrator';
import { runBrazilReceitaControlledExecutionAttemptRunnerScaffold } from '../br-receita-cnpj-controlled-execution-attempt-runner-scaffold';
import { buildBrazilReceitaSyntheticControlledExecutionAttemptPlan } from '../br-receita-cnpj-controlled-execution-attempt-plan-generator';
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

function scriptPath(name: string): string {
  return path.join(REPO_ROOT, 'scripts', 'source-catalog', name);
}

const READINESS_CLI = scriptPath('br-receita-cnpj-controlled-execution-readiness-orchestrator.ts');
const RUNNER_13G_CLI = scriptPath(
  'br-receita-cnpj-controlled-execution-attempt-runner-scaffold.ts',
);
const GENERATOR_13F_CLI = scriptPath(
  'br-receita-cnpj-controlled-execution-attempt-plan-generator.ts',
);
const VALIDATOR_13E_CLI = scriptPath(
  'br-receita-cnpj-controlled-execution-review-decision-validator.ts',
);
const GENERATOR_13D_CLI = scriptPath(
  'br-receita-cnpj-controlled-execution-request-packet-generator.ts',
);
const HARNESS_13C_CLI = scriptPath('br-receita-cnpj-synthetic-owner-artifact-harness.ts');

const READINESS_MODULE = path.join(
  __dirname,
  '..',
  'br-receita-cnpj-controlled-execution-readiness-orchestrator.ts',
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
  return runScript(READINESS_CLI, args);
}

function report(
  fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName,
  reviewDecisionValue: 'approve' | 'reject' | 'defer',
): BrazilReceitaControlledExecutionReadinessReport {
  return buildBrazilReceitaControlledExecutionReadinessReport({ fixtureName, reviewDecisionValue });
}

/** The only combination that can reach an operational chain, and therefore the compound status. */
function operationalReport(): BrazilReceitaControlledExecutionReadinessReport {
  return report('synthetic-ready', 'approve');
}

/** Every fixture that cannot reach a reviewable packet: the catalogue minus the one that can. */
const BLOCKED_FIXTURES: readonly BrazilReceitaSyntheticOwnerArtifactFixtureName[] =
  BRAZIL_RECEITA_READINESS_FIXTURE_NAMES.filter((name) => name !== 'synthetic-ready');

/** Every fixture / decision pair, for the sweeps that must hold over the whole input space. */
const ALL_COMBINATIONS: readonly {
  readonly fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly decision: 'approve' | 'reject' | 'defer';
}[] = BRAZIL_RECEITA_READINESS_FIXTURE_NAMES.flatMap((fixture) =>
  BRAZIL_RECEITA_REVIEW_DECISION_VALUES.map((decision) => ({ fixture, decision })),
);

/** The blockers a report raised at its own production-readiness layer. */
function productionBlockers(
  value: BrazilReceitaControlledExecutionReadinessReport,
): readonly string[] {
  return value.blockers
    .filter((blocker) => blocker.layer === 'production_readiness')
    .map((blocker) => blocker.blockerId);
}

/** The blockers a report inherited from 13G. */
function runnerBlockers(
  value: BrazilReceitaControlledExecutionReadinessReport,
): readonly string[] {
  return value.blockers
    .filter((blocker) => blocker.layer === 'runner_scaffold')
    .map((blocker) => blocker.blockerId);
}

/** Asserts one production blocker id is present, whatever the fixture and decision. */
function assertProductionBlockerAlwaysPresent(blockerId: string): void {
  for (const { fixture, decision } of ALL_COMBINATIONS) {
    assert.ok(
      productionBlockers(report(fixture, decision)).includes(blockerId),
      `${fixture} / ${decision} must carry ${blockerId}`,
    );
  }
}

// ─── 1. An operational chain is still not ready (1–9) ─────────────────────────

describe('BR-SOURCE-13H report over an operational synthetic chain', () => {
  it('reaches synthetic_chain_operational_execution_blocked / NO_GO for synthetic-ready + approve', () => {
    const value = operationalReport();

    assert.equal(value.reportType, BRAZIL_RECEITA_READINESS_REPORT_TYPE);
    assert.equal(value.version, 1);
    assert.equal(value.generatedAt, BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP);
    assert.equal(value.fixture, 'synthetic-ready');
    assert.equal(value.reviewDecisionValue, 'approve');
    assert.equal(value.status, 'synthetic_chain_operational_execution_blocked');
    assert.equal(value.goNoGo, 'NO_GO');
    assert.equal(value.syntheticOnly, true);
    assert.equal(value.readinessReportGenerated, true);

    // The chain underneath ran end to end; the readiness answer is still no.
    assert.equal(value.runnerResult.status, 'blocked_no_execution_authorization');
    assert.equal(value.runnerResult.plan.goNoGo, 'GO');
  });

  it('reports productionReadiness as not_ready_blocked', () => {
    assert.equal(operationalReport().productionReadiness, 'not_ready_blocked');
  });

  it('reports syntheticChainOperational as true', () => {
    assert.equal(operationalReport().syntheticChainOperational, true);
  });

  it('never starts execution, even over a chain that ran end to end', () => {
    assert.equal(operationalReport().executionStarted, false);
  });

  it('never attempts execution, even over a chain that ran end to end', () => {
    assert.equal(operationalReport().executionAttempted, false);
  });

  it('never authorizes execution, even over a chain that ran end to end', () => {
    const value = operationalReport();

    assert.equal(value.executionAuthorized, false);
    assert.equal(value.realDataExecutionAuthorized, false);
  });

  it('grants no real-data permission and records no real-data access', () => {
    const value = operationalReport();

    assert.equal(value.realDataAccessed, false);
    assert.equal(value.pathInputAccepted, false);
    assert.equal(value.manifestRead, false);
    assert.equal(value.csvRead, false);
    assert.equal(value.zipRead, false);
    assert.equal(value.rowReads, false);
    assert.equal(value.joinExecuted, false);
    assert.equal(value.coverageExecuted, false);
    assert.equal(value.importExecuted, false);
    assert.equal(value.supabaseWrites, false);
    assert.equal(value.runtimeActivated, false);
    assert.equal(value.agent1Activated, false);
    assert.equal(value.providerCalls, false);
  });

  it('approves neither GATE-2, GATE-7 nor the cap / input policy', () => {
    const value = operationalReport();

    assert.equal(value.gate2Approved, false);
    assert.equal(value.gate7Approved, false);
    assert.equal(value.capInputPolicyApproved, false);
  });

  it('does not authorize a controlled execution attempt', () => {
    assert.equal(operationalReport().controlledExecutionAttemptAuthorized, false);
  });
});

// ─── 2. Chains that stopped earlier (10–13) ───────────────────────────────────

describe('BR-SOURCE-13H reports over chains that stopped earlier', () => {
  it('a reject decision yields synthetic_chain_blocked / NO_GO', () => {
    const value = report('synthetic-ready', 'reject');

    assert.equal(value.status, 'synthetic_chain_blocked');
    assert.equal(value.goNoGo, 'NO_GO');
    assert.equal(value.productionReadiness, 'not_ready_blocked');
    assert.equal(value.syntheticChainOperational, false);
    assert.equal(value.reviewDecisionValue, 'reject');
  });

  it('a defer decision yields synthetic_chain_blocked / NO_GO', () => {
    const value = report('synthetic-ready', 'defer');

    assert.equal(value.status, 'synthetic_chain_blocked');
    assert.equal(value.goNoGo, 'NO_GO');
    assert.equal(value.productionReadiness, 'not_ready_blocked');
    assert.equal(value.syntheticChainOperational, false);
    assert.equal(value.reviewDecisionValue, 'defer');
  });

  it('missing-owner-artifact with an approve decision still yields synthetic_chain_blocked', () => {
    const value = report('missing-owner-artifact', 'approve');

    assert.equal(value.status, 'synthetic_chain_blocked');
    assert.equal(value.goNoGo, 'NO_GO');
    assert.equal(value.syntheticChainOperational, false);
  });

  it('every fixture that cannot reach a reviewable packet yields synthetic_chain_blocked', () => {
    for (const fixture of BLOCKED_FIXTURES) {
      const value = report(fixture, 'approve');

      assert.equal(value.status, 'synthetic_chain_blocked', fixture);
      assert.equal(value.goNoGo, 'NO_GO', fixture);
      assert.equal(value.syntheticChainOperational, false, fixture);
      assert.equal(value.productionReadiness, 'not_ready_blocked', fixture);
    }
  });
});

// ─── 3. Delegation and the official stack (14–15) ─────────────────────────────

describe('BR-SOURCE-13H delegation to BR-SOURCE-13G', () => {
  it('carries the 13G runner result verbatim, for every fixture and decision', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.deepEqual(
        report(fixture, decision).runnerResult,
        runBrazilReceitaControlledExecutionAttemptRunnerScaffold({
          fixtureName: fixture,
          reviewDecisionValue: decision,
        }),
        `${fixture} / ${decision}`,
      );
    }

    // And the plan inside it is still 13F's own, so no link in the chain was reconstructed here.
    assert.deepEqual(
      operationalReport().runnerResult.plan,
      buildBrazilReceitaSyntheticControlledExecutionAttemptPlan('synthetic-ready', 'approve'),
    );
  });

  it('reports all seven official stack components as true, for every fixture and decision', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const { officialStack } = report(fixture, decision);

      assert.equal(OFFICIAL_STACK_KEYS.length, 7);
      for (const key of OFFICIAL_STACK_KEYS) {
        assert.equal(officialStack[key], true, `${fixture} / ${decision} / ${key}`);
      }
    }
  });
});

// ─── 4. Blockers (16–25) ──────────────────────────────────────────────────────

describe('BR-SOURCE-13H production blockers', () => {
  it('always carries CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED', () => {
    assertProductionBlockerAlwaysPresent('CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED');
  });

  it('always carries GATE_2_REMAINS_NOT_APPROVED', () => {
    assertProductionBlockerAlwaysPresent('GATE_2_REMAINS_NOT_APPROVED');
  });

  it('always carries GATE_7_REMAINS_NOT_APPROVED', () => {
    assertProductionBlockerAlwaysPresent('GATE_7_REMAINS_NOT_APPROVED');
  });

  it('always carries CAP_INPUT_POLICY_REMAINS_NOT_APPROVED', () => {
    assertProductionBlockerAlwaysPresent('CAP_INPUT_POLICY_REMAINS_NOT_APPROVED');
  });

  it('always carries FULL_JOIN_EXECUTION_NOT_READY', () => {
    assertProductionBlockerAlwaysPresent('FULL_JOIN_EXECUTION_NOT_READY');
  });

  it('always carries IMPORT_NOT_READY', () => {
    assertProductionBlockerAlwaysPresent('IMPORT_NOT_READY');
  });

  it('always carries RUNTIME_NOT_READY', () => {
    assertProductionBlockerAlwaysPresent('RUNTIME_NOT_READY');
  });

  it('always carries AGENT1_NOT_READY, and REAL_DATA_EXECUTION_REMAINS_NOT_AUTHORIZED with it', () => {
    assertProductionBlockerAlwaysPresent('AGENT1_NOT_READY');
    assertProductionBlockerAlwaysPresent('REAL_DATA_EXECUTION_REMAINS_NOT_AUTHORIZED');

    // The production list leads every report, in a fixed order, so a reader can diff two reports.
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.deepEqual(
        productionBlockers(report(fixture, decision)),
        [...BRAZIL_RECEITA_READINESS_PRODUCTION_BLOCKER_IDS],
        `${fixture} / ${decision}`,
      );
    }
    assert.equal(BRAZIL_RECEITA_READINESS_PRODUCTION_BLOCKERS.length, 9);
  });

  it('includes every blocker 13G reported, verbatim, at the runner_scaffold layer', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const value = report(fixture, decision);

      assert.ok(
        runnerBlockers(value).length > 0,
        `${fixture} / ${decision} must inherit at least one runner blocker`,
      );
      assert.deepEqual(
        runnerBlockers(value),
        value.runnerResult.blockers,
        `${fixture} / ${decision}`,
      );

      // The production list leads, so the inherited ones follow it rather than replacing it.
      assert.deepEqual(value.blockers.map((blocker) => blocker.blockerId), [
        ...BRAZIL_RECEITA_READINESS_PRODUCTION_BLOCKER_IDS,
        ...value.runnerResult.blockers,
      ]);
    }
  });

  it('marks every blocker blocking, with a non-empty description, and no other severity exists', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const value = report(fixture, decision);

      assert.ok(value.blockers.length > 0, `${fixture} / ${decision}`);
      for (const blocker of value.blockers) {
        assert.equal(blocker.severity, 'blocking', `${fixture} / ${decision} / ${blocker.blockerId}`);
        assert.ok(
          blocker.description.length > 0,
          `${fixture} / ${decision} / ${blocker.blockerId} must be traceable`,
        );
        assert.ok(
          ['production_readiness', 'runner_scaffold'].includes(blocker.layer),
          `${fixture} / ${decision} / ${blocker.blockerId}: unexpected layer ${blocker.layer}`,
        );
      }
    }
  });
});

// ─── 5. Assertions, human actions, conclusion, disclaimer (26–29) ─────────────

describe('BR-SOURCE-13H assertions and conclusion', () => {
  it('carries every required safety assertion, unconditionally', () => {
    const expected = [
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
    ];

    assert.deepEqual([...BRAZIL_RECEITA_READINESS_SAFETY_ASSERTIONS], expected);
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.deepEqual(report(fixture, decision).safetyAssertions, expected, `${fixture} / ${decision}`);
    }
  });

  it('carries every required next human action, unconditionally', () => {
    const expected = [
      'HUMAN_REVIEW_READINESS_REPORT',
      'OWNER_MUST_PROVIDE_REAL_SIGNED_EXECUTION_AUTHORIZATION',
      'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
      'GATE_2_REMAINS_NOT_APPROVED',
      'GATE_7_REMAINS_NOT_APPROVED',
      'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
      'FULL_JOIN_EXECUTION_REQUIRES_SEPARATE_AUTHORIZATION',
      'IMPORT_REQUIRES_SEPARATE_AUTHORIZATION',
      'RUNTIME_REQUIRES_SEPARATE_AUTHORIZATION',
      'AGENT1_REQUIRES_SEPARATE_AUTHORIZATION',
    ];

    assert.deepEqual([...BRAZIL_RECEITA_READINESS_REQUIRED_HUMAN_ACTIONS], expected);
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.deepEqual(
        report(fixture, decision).requiredNextHumanActions,
        expected,
        `${fixture} / ${decision}`,
      );
    }
  });

  it('concludes exactly BRAZIL_REMAINS_BLOCKED, for every fixture and decision', () => {
    assert.equal(BRAZIL_RECEITA_READINESS_CONCLUSION, 'BRAZIL_REMAINS_BLOCKED');
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.equal(
        report(fixture, decision).readinessConclusion,
        'BRAZIL_REMAINS_BLOCKED',
        `${fixture} / ${decision}`,
      );
    }
  });

  it('carries exactly the disclaimer "Readiness report is not execution authorization."', () => {
    assert.equal(
      BRAZIL_RECEITA_READINESS_DISCLAIMER,
      'Readiness report is not execution authorization.',
    );
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.equal(
        report(fixture, decision).disclaimer,
        'Readiness report is not execution authorization.',
        `${fixture} / ${decision}`,
      );
    }
  });
});

// ─── 6. Determinism and rendering (30–33) ─────────────────────────────────────

describe('BR-SOURCE-13H determinism and rendering', () => {
  it('renders byte-identical JSON for the same inputs', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const first = formatBrazilReceitaControlledExecutionReadinessReport(
        report(fixture, decision),
        'json',
      );
      const second = formatBrazilReceitaControlledExecutionReadinessReport(
        report(fixture, decision),
        'json',
      );

      assert.equal(first, second, `${fixture} / ${decision}`);
      assert.deepEqual(report(fixture, decision), report(fixture, decision));
    }
  });

  it('renders byte-identical Markdown for the same inputs, and ignores pretty for Markdown', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const first = renderBrazilReceitaControlledExecutionReadinessReportMarkdown(
        report(fixture, decision),
      );
      const second = renderBrazilReceitaControlledExecutionReadinessReportMarkdown(
        report(fixture, decision),
      );

      assert.equal(first, second, `${fixture} / ${decision}`);
      assert.equal(
        formatBrazilReceitaControlledExecutionReadinessReport(
          report(fixture, decision),
          'markdown',
          true,
        ),
        first,
        `${fixture} / ${decision}`,
      );
    }
  });

  it('states in Markdown that Brazil remains blocked, for every fixture and decision', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const markdown = renderBrazilReceitaControlledExecutionReadinessReportMarkdown(
        report(fixture, decision),
      );

      assert.match(markdown, /Brazil remains blocked\./, `${fixture} / ${decision}`);
      assert.match(markdown, /BRAZIL_REMAINS_BLOCKED/, `${fixture} / ${decision}`);
      assert.match(markdown, /not_ready_blocked/, `${fixture} / ${decision}`);
      assert.doesNotMatch(markdown, /\*\*GO\*\*/, `${fixture} / ${decision}`);
    }
  });

  it('states in Markdown that there is no execution authorization, for every fixture and decision', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const markdown = renderBrazilReceitaControlledExecutionReadinessReportMarkdown(
        report(fixture, decision),
      );

      assert.match(
        markdown,
        /Readiness report is not execution authorization\./,
        `${fixture} / ${decision}`,
      );
      assert.match(
        markdown,
        /is not an execution authorization/,
        `${fixture} / ${decision}`,
      );
    }
  });
});

// ─── 7. The CLI produces reports (34–38) ──────────────────────────────────────

describe('BR-SOURCE-13H CLI output', () => {
  it('prints the JSON report for synthetic-ready + approve and exits 0', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');

    const printed = JSON.parse(run.stdout) as BrazilReceitaControlledExecutionReadinessReport;
    assert.deepEqual(printed, JSON.parse(JSON.stringify(operationalReport())));
    assert.equal(printed.status, 'synthetic_chain_operational_execution_blocked');
    assert.equal(printed.goNoGo, 'NO_GO');
    assert.equal(printed.productionReadiness, 'not_ready_blocked');
  });

  it('prints indented JSON with --pretty, carrying the same report', () => {
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
    assert.match(run.stdout, /\n {2}"reportType": /);
    assert.deepEqual(
      JSON.parse(run.stdout),
      JSON.parse(JSON.stringify(operationalReport())),
    );
  });

  it('prints the Markdown report for synthetic-ready + approve and exits 0', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'markdown',
    ]);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      run.stdout,
      `${renderBrazilReceitaControlledExecutionReadinessReportMarkdown(operationalReport())}\n`,
    );
    assert.match(run.stdout, /Brazil remains blocked\./);
  });

  it('prints a NO_GO report for a reject decision and still exits 0', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'reject', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as BrazilReceitaControlledExecutionReadinessReport;
    assert.equal(printed.status, 'synthetic_chain_blocked');
    assert.equal(printed.goNoGo, 'NO_GO');
    assert.equal(printed.syntheticChainOperational, false);
  });

  it('prints a NO_GO report for a blocked fixture and still exits 0', () => {
    const run = runCli([
      '--fixture',
      'missing-owner-artifact',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as BrazilReceitaControlledExecutionReadinessReport;
    assert.equal(printed.status, 'synthetic_chain_blocked');
    assert.equal(printed.goNoGo, 'NO_GO');
    assert.equal(printed.productionReadiness, 'not_ready_blocked');
  });
});

// ─── 8. The CLI refuses everything else (39–57) ───────────────────────────────

/** Asserts a run failed as a usage error: nothing on stdout, the code on stderr, exit 1. */
function assertUsageError(run: CliRun, code: string): void {
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, new RegExp(code));
}

/** Asserts a forbidden flag is refused in both `--flag value` and `--flag=value` form. */
function assertForbiddenFlag(flag: string): void {
  const base = ['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json'];

  assertUsageError(runCli([...base, flag, 'anything']), 'BRSOURCE13H_FORBIDDEN_ARGUMENT');
  assertUsageError(runCli([...base, `${flag}=anything`]), 'BRSOURCE13H_FORBIDDEN_ARGUMENT');
  // Refused before any report is produced, even when it leads the argument vector.
  assertUsageError(runCli([flag, 'anything', ...base]), 'BRSOURCE13H_FORBIDDEN_ARGUMENT');
}

describe('BR-SOURCE-13H CLI usage errors', () => {
  it('refuses a missing --fixture', () => {
    assertUsageError(
      runCli(['--decision', 'approve', '--format', 'json']),
      'BRSOURCE13H_FIXTURE_REQUIRED',
    );
    assertUsageError(
      runCli(['--fixture', '--decision', 'approve', '--format', 'json']),
      'BRSOURCE13H_FIXTURE_REQUIRED',
    );
  });

  it('refuses a missing --decision', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--format', 'json']),
      'BRSOURCE13H_DECISION_REQUIRED',
    );
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', '--format', 'json']),
      'BRSOURCE13H_DECISION_REQUIRED',
    );
  });

  it('refuses a missing --format', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', 'approve']),
      'BRSOURCE13H_FORMAT_REQUIRED',
    );
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format']),
      'BRSOURCE13H_FORMAT_REQUIRED',
    );
  });

  it('refuses an unknown --fixture', () => {
    assertUsageError(
      runCli(['--fixture', 'not-a-fixture', '--decision', 'approve', '--format', 'json']),
      'BRSOURCE13H_FIXTURE_UNKNOWN',
    );
  });

  it('refuses an unknown --decision', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', 'authorize', '--format', 'json']),
      'BRSOURCE13H_DECISION_UNKNOWN',
    );
  });

  it('refuses an unknown --format', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'csv']),
      'BRSOURCE13H_FORMAT_UNKNOWN',
    );
  });

  it('refuses --manifest', () => {
    assertForbiddenFlag('--manifest');
  });

  it('refuses --input', () => {
    assertForbiddenFlag('--input');
  });

  it('refuses --output', () => {
    assertForbiddenFlag('--output');
  });

  it('refuses --path', () => {
    assertForbiddenFlag('--path');
  });

  it('refuses --real-data', () => {
    assertForbiddenFlag('--real-data');
  });

  it('refuses --execute', () => {
    assertForbiddenFlag('--execute');
  });

  it('refuses --run', () => {
    assertForbiddenFlag('--run');
  });

  it('refuses --apply', () => {
    assertForbiddenFlag('--apply');
  });

  it('refuses --force', () => {
    assertForbiddenFlag('--force');
  });

  it('refuses --import', () => {
    assertForbiddenFlag('--import');
  });

  it('refuses --activate', () => {
    assertForbiddenFlag('--activate');
  });

  it('refuses any unknown flag', () => {
    for (const flag of ['--verbose', '--all', '--ready', '--authorize', '--gate2']) {
      assertUsageError(
        runCli([
          '--fixture',
          'synthetic-ready',
          '--decision',
          'approve',
          '--format',
          'json',
          flag,
        ]),
        'BRSOURCE13H_UNKNOWN_ARGUMENT',
      );
    }
  });

  it('refuses a positional argument, including one shaped like a location', () => {
    for (const positional of ['synthetic-ready', 'report.json', 'some/relative/dir']) {
      assertUsageError(
        runCli([
          positional,
          '--fixture',
          'synthetic-ready',
          '--decision',
          'approve',
          '--format',
          'json',
        ]),
        'BRSOURCE13H_UNKNOWN_ARGUMENT',
      );
    }
  });
});

// ─── 9. Static guards (58–60) ─────────────────────────────────────────────────

describe('BR-SOURCE-13H static guards', () => {
  it('the orchestrator module reaches no filesystem, process, database or runtime surface', () => {
    const source = fs.readFileSync(READINESS_MODULE, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      './br-receita-cnpj-controlled-execution-attempt-runner-scaffold',
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
        `the orchestrator module must not reference ${forbidden}`,
      );
    }
  });

  it('the CLI reaches no filesystem, process-spawning, database or runtime surface', () => {
    const source = fs.readFileSync(READINESS_CLI, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-readiness-orchestrator',
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

    // Call-shaped tokens only: the prose in both files legitimately discusses file reads and
    // spawning in order to state that neither happens.
    for (const file of [READINESS_MODULE, READINESS_CLI]) {
      const text = fs.readFileSync(file, 'utf8');
      for (const forbidden of ['readFile', 'writeFile', 'createWriteStream', 'spawnSync(', 'exec(']) {
        assert.ok(!text.includes(forbidden), `${file} must not reference ${forbidden}`);
      }
    }
  });

  it('no state, permission, authorization or readiness flag can be true for any fixture and decision combination', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const value = report(fixture, decision);

      for (const key of WITHHELD_KEYS) {
        assert.equal(value[key], false, `${fixture} / ${decision} / ${key} must stay false`);
      }

      assert.equal(value.goNoGo, 'NO_GO', `${fixture} / ${decision}`);
      assert.equal(value.productionReadiness, 'not_ready_blocked', `${fixture} / ${decision}`);
      assert.equal(value.readinessConclusion, 'BRAZIL_REMAINS_BLOCKED', `${fixture} / ${decision}`);

      // The same sweep over the serialized forms, so no format can leak a permission the object withheld.
      const json = formatBrazilReceitaControlledExecutionReadinessReport(value, 'json');
      const markdown = formatBrazilReceitaControlledExecutionReadinessReport(value, 'markdown');
      for (const key of WITHHELD_KEYS) {
        assert.ok(
          json.includes(`"${key}":false`),
          `${fixture} / ${decision}: JSON must state ${key} as false`,
        );
        assert.match(
          markdown,
          new RegExp(`\\| ${key} \\| NO \\|`),
          `${fixture} / ${decision}: Markdown must state ${key} as NO`,
        );
      }
    }
  });
});

// ─── 10. Upstream regressions (61–67) ─────────────────────────────────────────

describe('BR-SOURCE-13H upstream regressions', () => {
  it('BR-SOURCE-13G still reaches blocked_no_execution_authorization for synthetic-ready + approve', () => {
    const result = runBrazilReceitaControlledExecutionAttemptRunnerScaffold({
      fixtureName: 'synthetic-ready',
      reviewDecisionValue: 'approve',
    });

    assert.equal(result.status, 'blocked_no_execution_authorization');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.runnerScaffoldCreated, true);
    assert.equal(result.executionStarted, false);
    assert.equal(result.controlledExecutionAttemptAuthorized, false);

    const run = runScript(RUNNER_13G_CLI, [
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as Record<string, unknown>;
    assert.equal(printed.status, 'blocked_no_execution_authorization');
    assert.equal(printed.goNoGo, 'NO_GO');
  });

  it('BR-SOURCE-13F still reaches plan_ready_for_human_review for synthetic-ready + approve', () => {
    const plan = buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(
      'synthetic-ready',
      'approve',
    );

    assert.equal(plan.status, 'plan_ready_for_human_review');
    assert.equal(plan.goNoGo, 'GO');
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
    const printed = JSON.parse(run.stdout) as { result: Record<string, unknown> };
    assert.equal(printed.result.status, 'valid');
    assert.equal(printed.result.goNoGo, 'GO');
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
