/**
 * BR Receita CNPJ — synthetic owner artifact harness — tests (BR-SOURCE-13C).
 *
 * Three load-bearing properties:
 *
 *   1. The synthetic chain runs. `synthetic-ready` reaches `ready` / `GO` through 13A and 13B, so
 *      the flow is demonstrably executable and not merely described in a document.
 *   2. Fail-closed. Every other fixture ends in `blocked` / `NO_GO`, and the CLI refuses every
 *      argument that is not `--fixture <known name>` or `--pretty` — a forbidden flag such as
 *      `--manifest` exits 1 without running anything.
 *   3. Ready is never execution. No fixture, in any code path, returns a real-data permission other
 *      than `false`, and every report restates that a synthetic GO authorizes nothing.
 *
 * 100% offline and synthetic. No dataset, no manifest, no CSV, no ZIP, no row, no join, no coverage,
 * no import, no Supabase, no network, no runtime, no provider, no Agent 1. Two kinds of process
 * interaction happen HERE and nowhere in the harness: this file reads this repository's OWN sources
 * for the static guards, and spawns the harness CLI to test it as a CLI.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_ALWAYS_DENIED_PERMISSION_KEYS as DENIED_KEYS,
  BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_FINDING_CODES as PREFLIGHT_CODES,
  BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_REQUIRED_SAFETY_FLAGS as SAFETY_FLAGS,
  BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_STAGE,
  evaluateBrazilReceitaControlledExecutionPreflight,
  type BrazilReceitaControlledExecutionPreflightResult,
} from '../br-receita-cnpj-controlled-execution-preflight-evaluator';
import { BRAZIL_RECEITA_OWNER_DECISION_FINDING_CODES as OWNER_CODES } from '../br-receita-cnpj-owner-decision-validator';
import {
  BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_FIXTURE_NAMES as FIXTURE_NAMES,
  buildBrazilReceitaSyntheticOwnerArtifactFixture,
  type BrazilReceitaSyntheticOwnerArtifactFixtureName,
} from '../br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Paths and helpers ────────────────────────────────────────────────────────

/** Repository root, reached from this test's directory without hardcoding any absolute path. */
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..', '..');

const HARNESS_SCRIPT = path.join(
  REPO_ROOT,
  'scripts',
  'source-catalog',
  'br-receita-cnpj-synthetic-owner-artifact-harness.ts',
);

const FIXTURE_MODULE = path.join(
  __dirname,
  '..',
  'br-receita-cnpj-synthetic-owner-artifact-fixtures.ts',
);

type CliRun = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** Runs the harness as a real CLI, exactly as a human would. */
function runCli(args: readonly string[]): CliRun {
  const result = spawnSync(process.execPath, ['--import', 'tsx', HARNESS_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Evaluates a fixture through 13B in-process (13B delegates the artifact to 13A). */
function evaluateFixture(
  name: BrazilReceitaSyntheticOwnerArtifactFixtureName,
): BrazilReceitaControlledExecutionPreflightResult {
  return evaluateBrazilReceitaControlledExecutionPreflight(
    buildBrazilReceitaSyntheticOwnerArtifactFixture(name),
  );
}

function blockingCodesOf(
  result: BrazilReceitaControlledExecutionPreflightResult,
): readonly string[] {
  return result.findings.filter((finding) => finding.severity === 'blocking').map((f) => f.code);
}

function ownerBlockingCodesOf(
  result: BrazilReceitaControlledExecutionPreflightResult,
): readonly string[] {
  return result.ownerDecisionValidation.findings
    .filter((finding) => finding.severity === 'blocking')
    .map((finding) => finding.code);
}

/** Asserts the shape every refusal must share. */
function assertBlocked(result: BrazilReceitaControlledExecutionPreflightResult): void {
  assert.equal(result.status, 'blocked');
  assert.equal(result.goNoGo, 'NO_GO');
  assert.equal(result.canProceedToControlledExecutionAttemptReview, false);
  assert.ok(blockingCodesOf(result).length > 0, 'a refusal must carry a blocking finding');
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

/** Every fixture name except the one that is allowed to reach GO. */
const BLOCKED_FIXTURE_NAMES = FIXTURE_NAMES.filter((name) => name !== 'synthetic-ready');

// ─── 1. Fixture catalogue ─────────────────────────────────────────────────────

describe('BR-SOURCE-13C fixtures — catalogue', () => {
  it('exposes exactly the nine expected fixture names', () => {
    assert.deepEqual(
      [...FIXTURE_NAMES],
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
      ],
    );
  });

  it('builds the safe fixture on the stage and safety vocabulary 13B actually exports', () => {
    const request = buildBrazilReceitaSyntheticOwnerArtifactFixture('synthetic-ready') as Record<
      string,
      unknown
    >;

    assert.equal(request.requestedStage, BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_STAGE);
    for (const flag of SAFETY_FLAGS) {
      assert.equal(request[flag], true, `${flag} must be stated explicitly as true`);
    }
  });

  it('rejects an unknown fixture name', () => {
    assert.throws(
      () =>
        buildBrazilReceitaSyntheticOwnerArtifactFixture(
          'not-a-fixture' as BrazilReceitaSyntheticOwnerArtifactFixtureName,
        ),
      /BRSOURCE13C_UNKNOWN_FIXTURE/,
    );
  });

  it('returns a fresh object each call, so a caller cannot mutate a shared fixture', () => {
    const first = buildBrazilReceitaSyntheticOwnerArtifactFixture('synthetic-ready');
    const second = buildBrazilReceitaSyntheticOwnerArtifactFixture('synthetic-ready');

    assert.notEqual(first, second);
    assert.deepEqual(first, second);
    assert.notEqual(first.ownerDecisionArtifact, second.ownerDecisionArtifact);
  });
});

// ─── 2. synthetic-ready ───────────────────────────────────────────────────────

describe('BR-SOURCE-13C fixtures — synthetic-ready', () => {
  it('reaches ready / GO through 13A and 13B', () => {
    const result = evaluateFixture('synthetic-ready');

    assert.equal(result.status, 'ready');
    assert.equal(result.goNoGo, 'GO');
    assert.equal(result.canProceedToControlledExecutionAttemptReview, true);
    assert.equal(result.ownerDecisionValidation.status, 'valid');
    assert.equal(result.ownerDecisionValidation.goNoGo, 'GO');
    assert.equal(blockingCodesOf(result).length, 0);
  });

  it('keeps every real-data permission false even on GO', () => {
    assertNoRealDataPermissions(evaluateFixture('synthetic-ready'));
  });

  it('states that a GO is not an execution authorization', () => {
    const result = evaluateFixture('synthetic-ready');
    const disclaimer = result.findings.find(
      (finding) => finding.code === PREFLIGHT_CODES.isNotExecutionAuthorization,
    );

    assert.ok(disclaimer, 'the GO must carry the not-an-authorization finding');
    assert.equal(disclaimer?.severity, 'info');
  });
});

// ─── 3. Blocked fixtures ──────────────────────────────────────────────────────

describe('BR-SOURCE-13C fixtures — refusals', () => {
  it('blocks missing-owner-artifact on the 13A artifact-missing finding', () => {
    const result = evaluateFixture('missing-owner-artifact');

    assertBlocked(result);
    assert.ok(blockingCodesOf(result).includes(PREFLIGHT_CODES.ownerValidationBlocked));
    assert.ok(ownerBlockingCodesOf(result).includes(OWNER_CODES.artifactMissing));
  });

  it('blocks placeholder-owner-artifact on the 13A placeholder finding', () => {
    const result = evaluateFixture('placeholder-owner-artifact');

    assertBlocked(result);
    assert.ok(blockingCodesOf(result).includes(PREFLIGHT_CODES.ownerValidationBlocked));
    assert.ok(ownerBlockingCodesOf(result).includes(OWNER_CODES.fieldPlaceholder));
  });

  it('blocks forbidden-content-owner-artifact on the 13A forbidden-content finding', () => {
    const result = evaluateFixture('forbidden-content-owner-artifact');

    assertBlocked(result);
    assert.ok(blockingCodesOf(result).includes(PREFLIGHT_CODES.ownerValidationBlocked));
    assert.ok(ownerBlockingCodesOf(result).includes(OWNER_CODES.fieldForbiddenContent));
  });

  it('blocks missing-stage on the 13B stage finding', () => {
    const result = evaluateFixture('missing-stage');

    assertBlocked(result);
    assert.ok(blockingCodesOf(result).includes(PREFLIGHT_CODES.stageInvalid));
  });

  it('blocks missing-safety-flag on the 13B safety-flag finding', () => {
    const result = evaluateFixture('missing-safety-flag');

    assertBlocked(result);
    assert.ok(blockingCodesOf(result).includes(PREFLIGHT_CODES.requiredSafetyFlagMissing));
  });

  it('blocks invalid-evidence-mode on the 13B evidence-mode finding', () => {
    const result = evaluateFixture('invalid-evidence-mode');

    assertBlocked(result);
    assert.ok(blockingCodesOf(result).includes(PREFLIGHT_CODES.evidenceModeInvalid));
  });

  it('blocks rejected-owner-decision on the 13A rejection finding', () => {
    const result = evaluateFixture('rejected-owner-decision');

    assertBlocked(result);
    assert.ok(blockingCodesOf(result).includes(PREFLIGHT_CODES.ownerValidationBlocked));
    assert.ok(ownerBlockingCodesOf(result).includes(OWNER_CODES.decisionRejected));
    assert.equal(result.ownerDecisionValidation.gate2Approved, false);
  });

  it('blocks deferred-owner-decision on the 13A deferral finding', () => {
    const result = evaluateFixture('deferred-owner-decision');

    assertBlocked(result);
    assert.ok(blockingCodesOf(result).includes(PREFLIGHT_CODES.ownerValidationBlocked));
    assert.ok(ownerBlockingCodesOf(result).includes(OWNER_CODES.decisionDeferred));
    assert.equal(result.ownerDecisionValidation.capInputPolicyApproved, false);
  });

  it('blocks every fixture other than synthetic-ready', () => {
    for (const name of BLOCKED_FIXTURE_NAMES) {
      assertBlocked(evaluateFixture(name));
    }
  });
});

// ─── 4. Real-data permission sweep ────────────────────────────────────────────

describe('BR-SOURCE-13C fixtures — real-data permissions', () => {
  it('never grants a real-data permission for any fixture', () => {
    for (const name of FIXTURE_NAMES) {
      assertNoRealDataPermissions(evaluateFixture(name));
    }
  });
});

// ─── 5. CLI behaviour ─────────────────────────────────────────────────────────

describe('BR-SOURCE-13C harness CLI — accepted usage', () => {
  it('prints a valid JSON report for --fixture synthetic-ready and exits 0', () => {
    const run = runCli(['--fixture', 'synthetic-ready']);

    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout) as Record<string, unknown>;
    const result = report.result as Record<string, unknown>;

    assert.equal(report.harness, 'br-receita-cnpj-synthetic-owner-artifact-harness');
    assert.equal(report.fixture, 'synthetic-ready');
    assert.equal(report.generatedAt, 'STATIC_SYNTHETIC_TIMESTAMP');
    assert.equal(result.status, 'ready');
    assert.equal(result.goNoGo, 'GO');
  });

  it('supports --pretty and prints the same report indented', () => {
    const compact = runCli(['--fixture', 'synthetic-ready']);
    const pretty = runCli(['--fixture', 'synthetic-ready', '--pretty']);

    assert.equal(pretty.status, 0, pretty.stderr);
    assert.ok(pretty.stdout.includes('\n  '), '--pretty must indent the report');
    assert.deepEqual(JSON.parse(pretty.stdout), JSON.parse(compact.stdout));
  });

  it('exits 0 for a fixture whose verdict is blocked, because a refusal is a valid outcome', () => {
    const run = runCli(['--fixture', 'missing-owner-artifact']);

    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout) as { result: Record<string, unknown> };
    assert.equal(report.result.status, 'blocked');
    assert.equal(report.result.goNoGo, 'NO_GO');
  });

  it('reports the safety object with every real-data fact false', () => {
    const run = runCli(['--fixture', 'synthetic-ready']);
    const report = JSON.parse(run.stdout) as { safety: Record<string, unknown> };

    assert.equal(report.safety.syntheticOnly, true);
    for (const key of [
      'realDataAccessed',
      'manifestRead',
      'csvRead',
      'zipRead',
      'rowReads',
      'joinExecuted',
      'coverageExecuted',
      'importExecuted',
      'supabaseWrites',
      'runtimeActivated',
      'agent1Activated',
    ]) {
      assert.equal(report.safety[key], false, `safety.${key} must be false`);
    }
  });

  it('carries the synthetic-GO disclaimer in the report', () => {
    const run = runCli(['--fixture', 'synthetic-ready']);
    const report = JSON.parse(run.stdout) as { disclaimer: string };

    assert.equal(report.disclaimer, 'Synthetic GO is not real-data execution authorization.');
  });

  it('is deterministic: two runs of the same fixture print byte-identical JSON', () => {
    const first = runCli(['--fixture', 'synthetic-ready']);
    const second = runCli(['--fixture', 'synthetic-ready']);

    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, second.stdout);
  });

  it('never grants a real-data permission in CLI output, for any fixture', () => {
    for (const name of FIXTURE_NAMES) {
      const run = runCli(['--fixture', name]);
      assert.equal(run.status, 0, run.stderr);

      const report = JSON.parse(run.stdout) as { result: Record<string, unknown> };
      for (const key of DENIED_KEYS) {
        assert.equal(report.result[key], false, `${name}: result.${key} must be false`);
      }
    }
  });
});

describe('BR-SOURCE-13C harness CLI — refused usage', () => {
  it('rejects a missing --fixture', () => {
    const run = runCli([]);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13C_FIXTURE_REQUIRED/);
  });

  it('rejects --fixture without a value', () => {
    const run = runCli(['--fixture']);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /BRSOURCE13C_FIXTURE_REQUIRED/);
  });

  it('rejects an unknown fixture name', () => {
    const run = runCli(['--fixture', 'not-a-fixture']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13C_FIXTURE_UNKNOWN/);
  });

  it('rejects a manifest argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--manifest', 'anything']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13C_FORBIDDEN_ARGUMENT/);
  });

  it('rejects an input argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--input', 'anything']);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /BRSOURCE13C_FORBIDDEN_ARGUMENT/);
  });

  it('rejects an output argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--output', 'anything']);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /BRSOURCE13C_FORBIDDEN_ARGUMENT/);
  });

  it('rejects a forbidden argument written in --flag=value form', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--real-data=true']);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /BRSOURCE13C_FORBIDDEN_ARGUMENT/);
  });

  it('rejects an unrecognized argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--verbose']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13C_UNKNOWN_ARGUMENT/);
  });

  it('rejects a bare positional argument', () => {
    const run = runCli(['synthetic-ready']);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /BRSOURCE13C_UNKNOWN_ARGUMENT/);
  });
});

// ─── 6. Static guards ─────────────────────────────────────────────────────────

describe('BR-SOURCE-13C static guards', () => {
  it('the fixture module imports types only, and reaches no I/O surface', () => {
    const source = fs.readFileSync(FIXTURE_MODULE, 'utf8');

    const importStatements = source.match(/^import[^\n]*/gm) ?? [];
    assert.ok(importStatements.length > 0, 'the fixture module must declare its imports');
    for (const statement of importStatements) {
      assert.match(statement, /^import type /, `not a type import: ${statement}`);
    }

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      './br-receita-cnpj-controlled-execution-preflight-evaluator',
      './br-receita-cnpj-owner-decision-validator',
    ]);

    for (const token of [
      'node:fs',
      'node:path',
      'node:http',
      'node:https',
      'node:child_process',
      'node:crypto',
      'require(',
      'process.',
      'globalThis',
      '@supabase/',
      'createClient',
      'fetch(',
      'Date.now',
      'new Date(',
      'Math.random',
    ]) {
      assert.ok(!source.includes(token), `the fixture module must not reference ${token}`);
    }
  });

  it('the harness reaches no filesystem, process-spawning, database or runtime surface', () => {
    const source = fs.readFileSync(HARNESS_SCRIPT, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-preflight-evaluator',
      '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-synthetic-owner-artifact-fixtures',
    ]);

    for (const token of [
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
      assert.ok(!source.includes(token), `the harness must not reference ${token}`);
    }
  });

  it('the harness touches process only through argv, stdout, stderr and the exit code', () => {
    const source = fs.readFileSync(HARNESS_SCRIPT, 'utf8');
    const processUses = [...source.matchAll(/process\.[A-Za-z]+/g)].map((match) => match[0]);

    assert.ok(processUses.length > 0, 'the harness reads process.argv, so uses must be present');
    for (const use of processUses) {
      assert.ok(
        ['process.argv', 'process.stdout', 'process.stderr', 'process.exitCode'].includes(use),
        `unexpected process surface in the harness: ${use}`,
      );
    }
  });
});
