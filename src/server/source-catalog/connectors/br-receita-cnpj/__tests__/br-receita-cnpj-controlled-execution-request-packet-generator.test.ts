/**
 * BR Receita CNPJ — controlled execution request packet generator — tests (BR-SOURCE-13D).
 *
 * Three load-bearing properties:
 *
 *   1. The packet is produced by the chain, not by 13D. `synthetic-ready` reaches
 *      `ready_for_review` / `GO` through 13C → 13B → 13A, every blocked fixture reaches `blocked` /
 *      `NO_GO`, and the embedded preflight verdict is byte-equal to what 13B returns on its own.
 *   2. Fail-closed. The CLI refuses every argument that is not `--fixture <known name>`,
 *      `--format <json|markdown>` or `--pretty`; a forbidden flag such as `--manifest` exits 1
 *      without generating anything, in bare and in `--flag=value` form.
 *   3. Ready for review is never ready for execution. No fixture, in any format, in any code path,
 *      grants a real-data authorization or moves a gate, and every packet restates it in prose.
 *
 * 100% offline and synthetic. No dataset, no manifest, no CSV, no ZIP, no row, no join, no coverage,
 * no import, no Supabase, no network, no runtime, no provider, no Agent 1. Two kinds of process
 * interaction happen HERE and nowhere in the generator or its CLI: this file reads this repository's
 * OWN sources for the static guards, and spawns the CLI to test it as a CLI.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  BRAZIL_RECEITA_REQUEST_PACKET_DISCLAIMER,
  BRAZIL_RECEITA_REQUEST_PACKET_FIXTURE_NAMES as FIXTURE_NAMES,
  BRAZIL_RECEITA_REQUEST_PACKET_FORMATS,
  BRAZIL_RECEITA_REQUEST_PACKET_REQUIRED_HUMAN_ACTIONS as REQUIRED_HUMAN_ACTIONS,
  BRAZIL_RECEITA_REQUEST_PACKET_SAFETY_KEYS as SAFETY_KEYS,
  BRAZIL_RECEITA_REQUEST_PACKET_WITHHELD_AUTHORIZATION_KEYS as WITHHELD_KEYS,
  buildBrazilReceitaControlledExecutionRequestPacket,
  formatBrazilReceitaControlledExecutionRequestPacket,
  renderBrazilReceitaControlledExecutionRequestPacketMarkdown,
  type BrazilReceitaControlledExecutionRequestPacket,
} from '../br-receita-cnpj-controlled-execution-request-packet-generator';
import { evaluateBrazilReceitaControlledExecutionPreflight } from '../br-receita-cnpj-controlled-execution-preflight-evaluator';
import {
  BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_FIXTURE_NAMES,
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
  'br-receita-cnpj-controlled-execution-request-packet-generator.ts',
);

/** The BR-SOURCE-13C harness, spawned only by the regression test at the end of this file. */
const HARNESS_13C_CLI = path.join(
  REPO_ROOT,
  'scripts',
  'source-catalog',
  'br-receita-cnpj-synthetic-owner-artifact-harness.ts',
);

const GENERATOR_MODULE = path.join(
  __dirname,
  '..',
  'br-receita-cnpj-controlled-execution-request-packet-generator.ts',
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

/** Every fixture name except the one that is allowed to reach a review-ready packet. */
const BLOCKED_FIXTURE_NAMES = FIXTURE_NAMES.filter((name) => name !== 'synthetic-ready');

function assertNoAuthorizations(packet: Record<string, unknown>): void {
  for (const key of WITHHELD_KEYS) {
    assert.equal(packet[key], false, `${key} must always be false`);
  }
}

// ─── 1. synthetic-ready packet ────────────────────────────────────────────────

describe('BR-SOURCE-13D packet — synthetic-ready', () => {
  it('reaches ready_for_review / GO through 13C, 13B and 13A', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');

    assert.equal(packet.status, 'ready_for_review');
    assert.equal(packet.goNoGo, 'GO');
    assert.equal(packet.preflight.status, 'ready');
    assert.equal(packet.preflight.goNoGo, 'GO');
    assert.equal(packet.preflight.ownerDecisionValidation.status, 'valid');
    assert.deepEqual(packet.blockers, []);
  });

  it('carries the packet identity, version and static timestamp', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');

    assert.equal(
      packet.packetType,
      'br_receita_cnpj_controlled_execution_attempt_review_request',
    );
    assert.equal(packet.version, 1);
    assert.equal(packet.generatedAt, 'STATIC_SYNTHETIC_TIMESTAMP');
    assert.equal(packet.fixture, 'synthetic-ready');
    assert.equal(packet.syntheticOnly, true);
  });

  it('keeps every real authorization false even on a GO', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');

    assertNoAuthorizations(packet as unknown as Record<string, unknown>);
    assert.equal(packet.realDataExecutionAuthorized, false);
    assert.equal(packet.importAuthorized, false);
    assert.equal(packet.runtimeAuthorized, false);
    assert.equal(packet.agent1Authorized, false);
    assert.equal(packet.gate2Approved, false);
    assert.equal(packet.gate7Approved, false);
    assert.equal(packet.capInputPolicyApproved, false);
  });

  it('states that the review is a human decision this packet does not grant', () => {
    const { ownerReviewRequest } = buildBrazilReceitaControlledExecutionRequestPacket(
      'synthetic-ready',
    );

    assert.equal(ownerReviewRequest.requestedReview, 'controlled_execution_attempt_review');
    assert.equal(ownerReviewRequest.reviewMode, 'synthetic_packet_only');
    assert.equal(ownerReviewRequest.requiredHumanDecision, true);
    assert.equal(ownerReviewRequest.approvalGrantedByThisPacket, false);
    assert.equal(ownerReviewRequest.syntheticGoIsExecutionAuthorization, false);
  });

  it('includes every required next human action', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');

    assert.deepEqual(packet.requiredNextHumanActions, [...REQUIRED_HUMAN_ACTIONS]);
    for (const action of [
      'HUMAN_REVIEW_CONTROLLED_EXECUTION_ATTEMPT_REQUEST',
      'OWNER_MUST_PROVIDE_REAL_SIGNED_DECISION',
      'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
      'GATE_2_REMAINS_NOT_APPROVED',
      'GATE_7_REMAINS_NOT_APPROVED',
      'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
    ]) {
      assert.ok(packet.requiredNextHumanActions.includes(action), `missing action ${action}`);
    }
  });

  it('reports the safety object with every real-data fact false', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');

    for (const key of SAFETY_KEYS) {
      assert.equal(packet.safety[key], false, `safety.${key} must be false`);
    }
  });

  it('carries the disclaimer verbatim', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');

    assert.equal(packet.disclaimer, 'Synthetic GO is not real-data execution authorization.');
    assert.equal(packet.disclaimer, BRAZIL_RECEITA_REQUEST_PACKET_DISCLAIMER);
  });
});

// ─── 2. Blocked packets ───────────────────────────────────────────────────────

describe('BR-SOURCE-13D packet — refusals', () => {
  it('blocks every fixture other than synthetic-ready', () => {
    for (const name of BLOCKED_FIXTURE_NAMES) {
      const packet = buildBrazilReceitaControlledExecutionRequestPacket(name);

      assert.equal(packet.status, 'blocked', `${name} must be blocked`);
      assert.equal(packet.goNoGo, 'NO_GO', `${name} must be NO_GO`);
    }
  });

  it('derives at least one blocker for every blocked fixture', () => {
    for (const name of BLOCKED_FIXTURE_NAMES) {
      const packet = buildBrazilReceitaControlledExecutionRequestPacket(name);

      assert.ok(packet.blockers.length > 0, `${name} must carry a blocker`);
    }
  });

  it('derives blockers from the preflight blocking findings, preserving their codes', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('missing-stage');

    assert.ok(
      packet.blockers.some((blocker) => blocker.startsWith('PREFLIGHT/PREFLIGHT_STAGE_INVALID')),
      `expected a stage blocker, got ${packet.blockers.join(' | ')}`,
    );
  });

  it('surfaces the delegated 13A blocking findings as OWNER blockers', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('missing-owner-artifact');

    assert.ok(
      packet.blockers.some((blocker) =>
        blocker.startsWith('PREFLIGHT/OWNER_DECISION_VALIDATION_BLOCKED_PREFLIGHT'),
      ),
    );
    assert.ok(packet.blockers.some((blocker) => blocker.startsWith('OWNER/')));
  });

  it('prepends the resolve-blockers action when blocked, keeping the unconditional ones', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('rejected-owner-decision');

    assert.equal(
      packet.requiredNextHumanActions[0],
      'RESOLVE_PREFLIGHT_BLOCKERS_BEFORE_RESUBMISSION',
    );
    for (const action of REQUIRED_HUMAN_ACTIONS) {
      assert.ok(packet.requiredNextHumanActions.includes(action), `missing action ${action}`);
    }
  });

  it('keeps every real authorization false for every blocked fixture', () => {
    for (const name of BLOCKED_FIXTURE_NAMES) {
      assertNoAuthorizations(
        buildBrazilReceitaControlledExecutionRequestPacket(name) as unknown as Record<
          string,
          unknown
        >,
      );
    }
  });
});

// ─── 3. Delegation and permission sweep ───────────────────────────────────────

describe('BR-SOURCE-13D packet — delegation', () => {
  it('embeds the 13B preflight result verbatim, without reinterpretation', () => {
    for (const name of FIXTURE_NAMES) {
      const packet = buildBrazilReceitaControlledExecutionRequestPacket(name);
      const expected = evaluateBrazilReceitaControlledExecutionPreflight(
        buildBrazilReceitaSyntheticOwnerArtifactFixture(name),
      );

      assert.deepEqual(packet.preflight, expected, `${name}: preflight must be 13B's own verdict`);
    }
  });

  it('exposes the 13C fixture catalogue without drift', () => {
    assert.deepEqual([...FIXTURE_NAMES], [...BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_FIXTURE_NAMES]);
  });

  it('exposes exactly the two output formats', () => {
    assert.deepEqual([...BRAZIL_RECEITA_REQUEST_PACKET_FORMATS], ['json', 'markdown']);
  });

  it('rejects an unknown fixture name, via 13C', () => {
    assert.throws(
      () =>
        buildBrazilReceitaControlledExecutionRequestPacket(
          'not-a-fixture' as BrazilReceitaSyntheticOwnerArtifactFixtureName,
        ),
      /BRSOURCE13C_UNKNOWN_FIXTURE/,
    );
  });

  it('never grants a real authorization, and never denies a 13B permission, for any fixture', () => {
    for (const name of FIXTURE_NAMES) {
      const packet = buildBrazilReceitaControlledExecutionRequestPacket(name);
      const preflight = packet.preflight as unknown as Record<string, unknown>;

      assertNoAuthorizations(packet as unknown as Record<string, unknown>);
      for (const key of [
        'canExecuteRealData',
        'canReadManifest',
        'canReadCsv',
        'canReadZip',
        'canReadRows',
        'canImport',
        'canWriteSupabase',
        'canActivateRuntime',
        'canActivateAgent1',
      ]) {
        assert.equal(preflight[key], false, `${name}: preflight.${key} must be false`);
      }
    }
  });

  it('returns a fresh packet each call, so a caller cannot mutate a shared one', () => {
    const first = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');
    const second = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');

    assert.notEqual(first, second);
    assert.deepEqual(first, second);
  });
});

// ─── 4. Determinism and rendering ─────────────────────────────────────────────

describe('BR-SOURCE-13D packet — determinism', () => {
  it('serializes deterministic JSON for every fixture', () => {
    for (const name of FIXTURE_NAMES) {
      const first = formatBrazilReceitaControlledExecutionRequestPacket(
        buildBrazilReceitaControlledExecutionRequestPacket(name),
        'json',
      );
      const second = formatBrazilReceitaControlledExecutionRequestPacket(
        buildBrazilReceitaControlledExecutionRequestPacket(name),
        'json',
      );

      assert.equal(first, second, `${name}: JSON must be byte-identical across runs`);
      assert.deepEqual(JSON.parse(first), JSON.parse(second));
    }
  });

  it('renders deterministic Markdown for every fixture', () => {
    for (const name of FIXTURE_NAMES) {
      const first = renderBrazilReceitaControlledExecutionRequestPacketMarkdown(
        buildBrazilReceitaControlledExecutionRequestPacket(name),
      );
      const second = renderBrazilReceitaControlledExecutionRequestPacketMarkdown(
        buildBrazilReceitaControlledExecutionRequestPacket(name),
      );

      assert.equal(first, second, `${name}: Markdown must be byte-identical across runs`);
    }
  });

  it('renders Markdown with every real-data authorization marked NO', () => {
    const markdown = renderBrazilReceitaControlledExecutionRequestPacketMarkdown(
      buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready'),
    );

    assert.match(markdown, /\| Real-data execution \| NO \|/);
    assert.match(markdown, /\| Import \| NO \|/);
    assert.match(markdown, /\| Runtime \| NO \|/);
    assert.match(markdown, /\| Agent 1 \| NO \|/);
    assert.ok(!markdown.includes('| Real-data execution | YES |'));
  });

  it('renders Markdown with every gate approval marked NO', () => {
    const markdown = renderBrazilReceitaControlledExecutionRequestPacketMarkdown(
      buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready'),
    );

    assert.match(markdown, /\| GATE-2 approval \| NO \|/);
    assert.match(markdown, /\| GATE-7 approval \| NO \|/);
    assert.match(markdown, /\| Cap \/ input policy approval \| NO \|/);
  });

  it('renders Markdown carrying the disclaimer and the ready-is-not-execution sentence', () => {
    for (const name of FIXTURE_NAMES) {
      const markdown = renderBrazilReceitaControlledExecutionRequestPacketMarkdown(
        buildBrazilReceitaControlledExecutionRequestPacket(name),
      );

      assert.ok(
        markdown.includes('Synthetic GO is not real-data execution authorization.'),
        `${name}: Markdown must carry the disclaimer`,
      );
      assert.ok(
        markdown.includes('Ready for review is not ready for execution.'),
        `${name}: Markdown must carry the ready-is-not-execution sentence`,
      );
    }
  });

  it('renders "- none" in the blockers section of a review-ready packet', () => {
    const markdown = renderBrazilReceitaControlledExecutionRequestPacketMarkdown(
      buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready'),
    );

    assert.match(markdown, /## Blockers\n\n- none\n/);
  });

  it('renders every blocker of a blocked packet', () => {
    const packet: BrazilReceitaControlledExecutionRequestPacket =
      buildBrazilReceitaControlledExecutionRequestPacket('placeholder-owner-artifact');
    const markdown = renderBrazilReceitaControlledExecutionRequestPacketMarkdown(packet);

    for (const blocker of packet.blockers) {
      assert.ok(markdown.includes(`- ${blocker}`), `Markdown must list blocker ${blocker}`);
    }
  });

  it('ignores --pretty for Markdown, which has one canonical rendering', () => {
    const packet = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');

    assert.equal(
      formatBrazilReceitaControlledExecutionRequestPacket(packet, 'markdown', true),
      formatBrazilReceitaControlledExecutionRequestPacket(packet, 'markdown', false),
    );
  });
});

// ─── 5. CLI — accepted usage ──────────────────────────────────────────────────

describe('BR-SOURCE-13D CLI — accepted usage', () => {
  it('prints a valid JSON packet for --format json and exits 0', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    const packet = JSON.parse(run.stdout) as Record<string, unknown>;

    assert.equal(packet.packetType, 'br_receita_cnpj_controlled_execution_attempt_review_request');
    assert.equal(packet.fixture, 'synthetic-ready');
    assert.equal(packet.generatedAt, 'STATIC_SYNTHETIC_TIMESTAMP');
    assert.equal(packet.status, 'ready_for_review');
    assert.equal(packet.goNoGo, 'GO');
    assertNoAuthorizations(packet);
  });

  it('supports --pretty and prints the same JSON packet indented', () => {
    const compact = runCli(['--fixture', 'synthetic-ready', '--format', 'json']);
    const pretty = runCli(['--fixture', 'synthetic-ready', '--format', 'json', '--pretty']);

    assert.equal(pretty.status, 0, pretty.stderr);
    assert.ok(pretty.stdout.includes('\n  '), '--pretty must indent the packet');
    assert.deepEqual(JSON.parse(pretty.stdout), JSON.parse(compact.stdout));
  });

  it('prints a Markdown packet for --format markdown and exits 0', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--format', 'markdown']);

    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stdout,
      /^# BR Receita CNPJ — controlled execution attempt review request\n/,
    );
    assert.match(run.stdout, /- Status: \*\*ready_for_review\*\*/);
    assert.match(run.stdout, /\| Real-data execution \| NO \|/);
    assert.ok(run.stdout.includes('Ready for review is not ready for execution.'));
  });

  it('accepts --fixture and --format in --flag=value form', () => {
    const inline = runCli(['--fixture=synthetic-ready', '--format=json']);
    const spaced = runCli(['--fixture', 'synthetic-ready', '--format', 'json']);

    assert.equal(inline.status, 0, inline.stderr);
    assert.equal(inline.stdout, spaced.stdout);
  });

  it('exits 0 for a blocked fixture, because a refusal is a valid outcome', () => {
    const run = runCli(['--fixture', 'missing-owner-artifact', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    const packet = JSON.parse(run.stdout) as Record<string, unknown>;

    assert.equal(packet.status, 'blocked');
    assert.equal(packet.goNoGo, 'NO_GO');
    assert.ok((packet.blockers as string[]).length > 0);
    assertNoAuthorizations(packet);
  });

  it('is deterministic: two runs of the same fixture and format are byte-identical', () => {
    const firstJson = runCli(['--fixture', 'synthetic-ready', '--format', 'json']);
    const secondJson = runCli(['--fixture', 'synthetic-ready', '--format', 'json']);
    const firstMarkdown = runCli(['--fixture', 'synthetic-ready', '--format', 'markdown']);
    const secondMarkdown = runCli(['--fixture', 'synthetic-ready', '--format', 'markdown']);

    assert.equal(firstJson.status, 0, firstJson.stderr);
    assert.equal(firstJson.stdout, secondJson.stdout);
    assert.equal(firstMarkdown.status, 0, firstMarkdown.stderr);
    assert.equal(firstMarkdown.stdout, secondMarkdown.stdout);
  });

  it('never grants a real authorization in CLI output, for any fixture in either format', () => {
    for (const name of FIXTURE_NAMES) {
      const json = runCli(['--fixture', name, '--format', 'json']);
      assert.equal(json.status, 0, json.stderr);
      assertNoAuthorizations(JSON.parse(json.stdout) as Record<string, unknown>);

      const markdown = runCli(['--fixture', name, '--format', 'markdown']);
      assert.equal(markdown.status, 0, markdown.stderr);
      assert.ok(!markdown.stdout.includes('| Real-data execution | YES |'), name);
      assert.ok(!markdown.stdout.includes('| GATE-2 approval | YES |'), name);
    }
  });
});

// ─── 6. CLI — refused usage ───────────────────────────────────────────────────

describe('BR-SOURCE-13D CLI — refused usage', () => {
  it('rejects a missing --fixture', () => {
    const run = runCli(['--format', 'json']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13D_FIXTURE_REQUIRED/);
  });

  it('rejects --fixture without a value', () => {
    const run = runCli(['--fixture', '--format', 'json']);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /BRSOURCE13D_FIXTURE_REQUIRED/);
  });

  it('rejects a missing --format', () => {
    const run = runCli(['--fixture', 'synthetic-ready']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13D_FORMAT_REQUIRED/);
  });

  it('rejects --format without a value', () => {
    const run = runCli(['--format', '--fixture', 'synthetic-ready']);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /BRSOURCE13D_FORMAT_REQUIRED/);
  });

  it('rejects an unknown fixture name', () => {
    const run = runCli(['--fixture', 'not-a-fixture', '--format', 'json']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13D_FIXTURE_UNKNOWN/);
  });

  it('rejects an unknown format', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--format', 'yaml']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13D_FORMAT_UNKNOWN/);
  });

  it('rejects a manifest argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--format', 'json', '--manifest', 'x']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13D_FORBIDDEN_ARGUMENT/);
  });

  it('rejects an input argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--format', 'json', '--input', 'x']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13D_FORBIDDEN_ARGUMENT/);
  });

  it('rejects an output argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--format', 'json', '--output', 'x']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13D_FORBIDDEN_ARGUMENT/);
  });

  it('rejects a path argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--format', 'json', '--path', 'x']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13D_FORBIDDEN_ARGUMENT/);
  });

  it('rejects a real-data argument, bare and in --flag=value form', () => {
    for (const arg of ['--real-data', '--real-data=true']) {
      const run = runCli(['--fixture', 'synthetic-ready', '--format', 'json', arg]);

      assert.equal(run.status, 1, arg);
      assert.equal(run.stdout, '', arg);
      assert.match(run.stderr, /BRSOURCE13D_FORBIDDEN_ARGUMENT/);
    }
  });

  it('rejects every forbidden flag before generating anything', () => {
    for (const flag of [
      '--input-dir',
      '--output-dir',
      '--dir',
      '--file',
      '--csv',
      '--zip',
      '--execute',
      '--import',
      '--supabase',
      '--production',
      '--runtime',
      '--agent1',
    ]) {
      const run = runCli(['--fixture', 'synthetic-ready', '--format', 'json', flag, 'x']);

      assert.equal(run.status, 1, flag);
      assert.equal(run.stdout, '', flag);
      assert.match(run.stderr, /BRSOURCE13D_FORBIDDEN_ARGUMENT/);
    }
  });

  it('rejects an unrecognized argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--format', 'json', '--verbose']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13D_UNKNOWN_ARGUMENT/);
  });

  it('rejects a bare positional argument', () => {
    const run = runCli(['synthetic-ready']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13D_UNKNOWN_ARGUMENT/);
  });
});

// ─── 7. Static guards ─────────────────────────────────────────────────────────

describe('BR-SOURCE-13D static guards', () => {
  it('the generator module reaches no filesystem, process, database or runtime surface', () => {
    const source = fs.readFileSync(GENERATOR_MODULE, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      './br-receita-cnpj-controlled-execution-preflight-evaluator',
      './br-receita-cnpj-synthetic-owner-artifact-fixtures',
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
      'process.',
      'globalThis',
      '@supabase/',
      'createClient',
      'fetch(',
      'Date.now',
      'new Date(',
      'Math.random',
    ]) {
      assert.ok(!source.includes(token), `the generator module must not reference ${token}`);
    }
  });

  it('the CLI reaches no filesystem, process-spawning, database or runtime surface', () => {
    const source = fs.readFileSync(GENERATOR_CLI, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-request-packet-generator',
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
      assert.ok(!source.includes(token), `the CLI must not reference ${token}`);
    }
  });

  it('the CLI touches process only through argv, stdout, stderr and the exit code', () => {
    const source = fs.readFileSync(GENERATOR_CLI, 'utf8');
    const processUses = [...source.matchAll(/process\.[A-Za-z]+/g)].map((match) => match[0]);

    assert.ok(processUses.length > 0, 'the CLI reads process.argv, so uses must be present');
    for (const use of processUses) {
      assert.ok(
        ['process.argv', 'process.stdout', 'process.stderr', 'process.exitCode'].includes(use),
        `unexpected process surface in the CLI: ${use}`,
      );
    }
  });

  it('neither file offers a path, manifest or real-data input surface', () => {
    for (const file of [GENERATOR_MODULE, GENERATOR_CLI]) {
      const source = fs.readFileSync(file, 'utf8');

      // Call-shaped tokens only: the prose in these files legitimately discusses spawning and
      // file reads in order to state that neither happens.
      for (const token of [
        'readFile',
        'writeFile',
        'createWriteStream',
        'spawn(',
        'spawnSync(',
        'exec(',
      ]) {
        assert.ok(!source.includes(token), `${file} must not reference ${token}`);
      }
    }
  });
});

// ─── 8. BR-SOURCE-13C regression ──────────────────────────────────────────────

describe('BR-SOURCE-13C regression', () => {
  it('the 13C harness still reaches ready / GO for synthetic-ready', () => {
    const run = runScript(HARNESS_13C_CLI, ['--fixture', 'synthetic-ready']);

    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout) as { result: Record<string, unknown> };

    assert.equal(report.result.status, 'ready');
    assert.equal(report.result.goNoGo, 'GO');
  });
});
