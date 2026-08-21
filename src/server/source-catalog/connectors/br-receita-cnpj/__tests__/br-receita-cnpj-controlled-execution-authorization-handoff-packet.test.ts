/**
 * BR Receita CNPJ — controlled execution authorization handoff packet — tests (BR-SOURCE-13I).
 *
 * Three load-bearing properties:
 *
 *   1. The handoff is only ever built from what the chain actually decided. 13H's readiness report
 *      travels inside the packet verbatim, and 13I re-implements none of 13A–13H's rules.
 *   2. Fail-closed, with no exit. An operational chain yields `handoff_ready_for_human_decision`; a chain
 *      that stopped earlier yields `handoff_blocked_by_readiness`; there is no third outcome, `goNoGo` is
 *      `NO_GO`, `authorizationStatus` is `not_authorized` and `brazilReadiness` is `blocked` in every
 *      case, and the CLI refuses every argument that is not `--fixture`, `--decision`, `--format` or
 *      `--pretty` — `--approve` included, and refused for the same reason as `--execute`.
 *   3. Authorization handoff packet is not execution authorization, and a human decision packet is not an
 *      owner approval. No packet, in any format, over any fixture and any decision, sets a state,
 *      permission or authorization field to `true`, and all nine decisions stay unresolved.
 *
 * 100% offline and synthetic. No dataset, no manifest, no CSV, no ZIP, no row, no join, no coverage, no
 * import, no database, no network, no runtime, no provider, no Agent 1. Two kinds of process interaction
 * happen HERE and nowhere in the packet module or its CLI: this file reads this repository's OWN sources
 * for the static guards, and spawns the CLIs to test them as CLIs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  BRAZIL_RECEITA_HANDOFF_BLOCKERS,
  BRAZIL_RECEITA_HANDOFF_CONCLUSION,
  BRAZIL_RECEITA_HANDOFF_DECISION_IDS,
  BRAZIL_RECEITA_HANDOFF_DISCLAIMER,
  BRAZIL_RECEITA_HANDOFF_FIXTURE_NAMES,
  BRAZIL_RECEITA_HANDOFF_PACKET_TYPE,
  BRAZIL_RECEITA_HANDOFF_READINESS_BLOCKER_PREFIX,
  BRAZIL_RECEITA_HANDOFF_READINESS_CONCLUSION,
  BRAZIL_RECEITA_HANDOFF_REQUIRED_HUMAN_ACTIONS,
  BRAZIL_RECEITA_HANDOFF_SAFETY_ASSERTIONS,
  BRAZIL_RECEITA_HANDOFF_WITHHELD_KEYS as WITHHELD_KEYS,
  buildBrazilReceitaControlledExecutionAuthorizationHandoffPacket,
  formatBrazilReceitaControlledExecutionAuthorizationHandoffPacket,
  renderBrazilReceitaControlledExecutionAuthorizationHandoffPacketMarkdown,
  type BrazilReceitaControlledExecutionAuthorizationDecisionId,
  type BrazilReceitaControlledExecutionAuthorizationHandoffPacket,
} from '../br-receita-cnpj-controlled-execution-authorization-handoff-packet';
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

const HANDOFF_CLI = scriptPath(
  'br-receita-cnpj-controlled-execution-authorization-handoff-packet.ts',
);
const READINESS_13H_CLI = scriptPath(
  'br-receita-cnpj-controlled-execution-readiness-orchestrator.ts',
);
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

const HANDOFF_MODULE = path.join(
  __dirname,
  '..',
  'br-receita-cnpj-controlled-execution-authorization-handoff-packet.ts',
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
  return runScript(HANDOFF_CLI, args);
}

type DecisionValue = 'approve' | 'reject' | 'defer';

function packet(
  fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName,
  reviewDecisionValue: DecisionValue,
): BrazilReceitaControlledExecutionAuthorizationHandoffPacket {
  return buildBrazilReceitaControlledExecutionAuthorizationHandoffPacket({
    fixtureName,
    reviewDecisionValue,
  });
}

/** The only combination that can reach an operational chain, and therefore the ready status. */
function readyPacket(): BrazilReceitaControlledExecutionAuthorizationHandoffPacket {
  return packet('synthetic-ready', 'approve');
}

/** Every fixture that cannot reach a reviewable packet: the catalogue minus the one that can. */
const BLOCKED_FIXTURES: readonly BrazilReceitaSyntheticOwnerArtifactFixtureName[] =
  BRAZIL_RECEITA_HANDOFF_FIXTURE_NAMES.filter((name) => name !== 'synthetic-ready');

/** Every fixture / decision pair, for the sweeps that must hold over the whole input space. */
const ALL_COMBINATIONS: readonly {
  readonly fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly decision: DecisionValue;
}[] = BRAZIL_RECEITA_HANDOFF_FIXTURE_NAMES.flatMap((fixture) =>
  BRAZIL_RECEITA_REVIEW_DECISION_VALUES.map((decision) => ({ fixture, decision })),
);

/** The nine decisions, as the source of truth every "includes" test reads from. */
const NINE_DECISIONS: readonly BrazilReceitaControlledExecutionAuthorizationDecisionId[] = [
  'OWNER_COMPLETION_RESUBMISSION',
  'GATE_2_ROUTE_DECISION',
  'GATE_7_PRIVACY_SECURITY_DECISION',
  'CAP_INPUT_POLICY_APPROVAL',
  'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION',
  'FULL_JOIN_EXECUTION_AUTHORIZATION',
  'IMPORT_AUTHORIZATION',
  'RUNTIME_AUTHORIZATION',
  'AGENT1_AUTHORIZATION',
];

function decisionIds(
  value: BrazilReceitaControlledExecutionAuthorizationHandoffPacket,
): readonly string[] {
  return value.decisionRequests.map((request) => request.decisionId);
}

function findDecision(
  value: BrazilReceitaControlledExecutionAuthorizationHandoffPacket,
  decisionId: BrazilReceitaControlledExecutionAuthorizationDecisionId,
) {
  const found = value.decisionRequests.find((request) => request.decisionId === decisionId);
  assert.ok(found, `${decisionId} must be present among the decision requests`);
  return found;
}

// ─── 1. The ready packet (1–10) ────────────────────────────────────────────────

describe('BR-SOURCE-13I packet over an operational synthetic chain', () => {
  it('reaches handoff_ready_for_human_decision and still reports NO_GO', () => {
    const value = readyPacket();

    assert.equal(value.packetType, BRAZIL_RECEITA_HANDOFF_PACKET_TYPE);
    assert.equal(value.version, 1);
    assert.equal(value.status, 'handoff_ready_for_human_decision');
    assert.equal(value.goNoGo, 'NO_GO');
  });

  it('reports authorizationStatus not_authorized', () => {
    assert.equal(readyPacket().authorizationStatus, 'not_authorized');
  });

  it('reports brazilReadiness blocked', () => {
    assert.equal(readyPacket().brazilReadiness, 'blocked');
  });

  it('reports humanDecisionPacketReady true, which is a statement about the DOCUMENT only', () => {
    const value = readyPacket();

    assert.equal(value.humanDecisionPacketReady, true);
    assert.equal(value.handoffPacketGenerated, true);
    assert.equal(value.syntheticOnly, true);
    // A ready document and an unauthorized run, in the same artefact.
    assert.equal(value.authorizationStatus, 'not_authorized');
  });

  it('never starts execution', () => {
    const value = readyPacket();

    assert.equal(value.executionStarted, false);
    assert.equal(value.readinessReport.executionStarted, false);
  });

  it('never attempts execution', () => {
    const value = readyPacket();

    assert.equal(value.executionAttempted, false);
    assert.equal(value.readinessReport.executionAttempted, false);
  });

  it('never authorizes execution', () => {
    const value = readyPacket();

    assert.equal(value.executionAuthorized, false);
    assert.equal(value.realDataExecutionAuthorized, false);
    assert.equal(value.controlledExecutionAttemptAuthorized, false);
  });

  it('holds every real-data field false', () => {
    const value = readyPacket();

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

  it('holds GATE-2, GATE-7 and the cap and input policy unapproved', () => {
    const value = readyPacket();

    assert.equal(value.gate2Approved, false);
    assert.equal(value.gate7Approved, false);
    assert.equal(value.capInputPolicyApproved, false);
  });

  it('holds controlledExecutionAttemptAuthorized false', () => {
    assert.equal(readyPacket().controlledExecutionAttemptAuthorized, false);
  });
});

// ─── 2. Packets over chains that stopped earlier (11–14) ───────────────────────

describe('BR-SOURCE-13I packets over chains that stopped earlier', () => {
  it('a reject decision yields handoff_blocked_by_readiness and NO_GO', () => {
    const value = packet('synthetic-ready', 'reject');

    assert.equal(value.status, 'handoff_blocked_by_readiness');
    assert.equal(value.goNoGo, 'NO_GO');
    assert.equal(value.humanDecisionPacketReady, false);
    assert.equal(value.authorizationStatus, 'not_authorized');
    assert.equal(value.brazilReadiness, 'blocked');
  });

  it('a defer decision yields handoff_blocked_by_readiness and NO_GO', () => {
    const value = packet('synthetic-ready', 'defer');

    assert.equal(value.status, 'handoff_blocked_by_readiness');
    assert.equal(value.goNoGo, 'NO_GO');
    assert.equal(value.humanDecisionPacketReady, false);
  });

  it('missing-owner-artifact with an approve decision yields handoff_blocked_by_readiness', () => {
    const value = packet('missing-owner-artifact', 'approve');

    assert.equal(value.status, 'handoff_blocked_by_readiness');
    assert.equal(value.goNoGo, 'NO_GO');
    assert.equal(value.humanDecisionPacketReady, false);
  });

  it('every blocked fixture yields handoff_blocked_by_readiness for every decision', () => {
    for (const fixture of BLOCKED_FIXTURES) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        const value = packet(fixture, decision);

        assert.equal(
          value.status,
          'handoff_blocked_by_readiness',
          `${fixture} / ${decision} must stay blocked by readiness`,
        );
        assert.equal(value.humanDecisionPacketReady, false, `${fixture} / ${decision}`);
      }
    }
  });
});

// ─── 3. Delegation to 13H (15) ────────────────────────────────────────────────

describe('BR-SOURCE-13I delegation to BR-SOURCE-13H', () => {
  it('carries the 13H readiness report verbatim', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const value = packet(fixture, decision);
      const report = buildBrazilReceitaControlledExecutionReadinessReport({
        fixtureName: fixture,
        reviewDecisionValue: decision,
      });

      assert.deepEqual(value.readinessReport, report, `${fixture} / ${decision}`);
      // And the packet never contradicts what it carries.
      assert.equal(value.generatedAt, report.generatedAt);
      assert.equal(value.fixture, report.fixture);
      assert.equal(value.reviewDecisionValue, report.reviewDecisionValue);
      assert.equal(report.goNoGo, 'NO_GO');
      assert.equal(report.productionReadiness, 'not_ready_blocked');
    }
  });
});

// ─── 4. The nine decision requests (16–27) ────────────────────────────────────

describe('BR-SOURCE-13I decision requests', () => {
  it('always contains exactly nine decisions, over every fixture and decision', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.equal(
        packet(fixture, decision).decisionRequests.length,
        9,
        `${fixture} / ${decision} must request exactly nine decisions`,
      );
    }

    assert.deepEqual([...BRAZIL_RECEITA_HANDOFF_DECISION_IDS], [...NINE_DECISIONS]);
  });

  it('includes OWNER_COMPLETION_RESUBMISSION, owned by the owner and missing', () => {
    const request = findDecision(readyPacket(), 'OWNER_COMPLETION_RESUBMISSION');

    assert.equal(request.decisionOwner, 'owner');
    assert.equal(request.currentStatus, 'missing');
  });

  it('includes GATE_2_ROUTE_DECISION, and approving it does not authorize import', () => {
    const request = findDecision(readyPacket(), 'GATE_2_ROUTE_DECISION');

    assert.equal(request.decisionOwner, 'owner');
    assert.equal(request.currentStatus, 'not_approved');
    assert.ok(request.approvalDoesNotGrant.includes('IMPORT_AUTHORIZATION'));
  });

  it('includes GATE_7_PRIVACY_SECURITY_DECISION, and approving it does not authorize import', () => {
    const request = findDecision(readyPacket(), 'GATE_7_PRIVACY_SECURITY_DECISION');

    assert.equal(request.decisionOwner, 'legal_security_privacy');
    assert.equal(request.currentStatus, 'not_approved');
    assert.ok(request.approvalDoesNotGrant.includes('IMPORT_AUTHORIZATION'));
  });

  it('includes CAP_INPUT_POLICY_APPROVAL, and approving it does not authorize runtime', () => {
    const request = findDecision(readyPacket(), 'CAP_INPUT_POLICY_APPROVAL');

    assert.equal(request.currentStatus, 'not_approved');
    assert.ok(request.approvalDoesNotGrant.includes('RUNTIME_AUTHORIZATION'));
  });

  it('includes CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION, which cannot stand in for the gates', () => {
    const request = findDecision(readyPacket(), 'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION');

    assert.equal(request.decisionOwner, 'owner');
    assert.equal(request.currentStatus, 'not_authorized');
    for (const withheld of ['GATE_2_APPROVAL', 'GATE_7_APPROVAL', 'CAP_INPUT_POLICY_APPROVAL']) {
      assert.ok(request.approvalDoesNotGrant.includes(withheld), withheld);
    }
  });

  it('includes FULL_JOIN_EXECUTION_AUTHORIZATION, and authorizing it does not authorize import', () => {
    const request = findDecision(readyPacket(), 'FULL_JOIN_EXECUTION_AUTHORIZATION');

    assert.equal(request.currentStatus, 'not_authorized');
    assert.ok(request.approvalDoesNotGrant.includes('IMPORT_AUTHORIZATION'));
  });

  it('includes IMPORT_AUTHORIZATION, and authorizing it does not authorize runtime', () => {
    const request = findDecision(readyPacket(), 'IMPORT_AUTHORIZATION');

    assert.equal(request.currentStatus, 'not_authorized');
    assert.ok(request.approvalDoesNotGrant.includes('RUNTIME_AUTHORIZATION'));
  });

  it('includes RUNTIME_AUTHORIZATION, and authorizing it does not authorize Agent 1', () => {
    const request = findDecision(readyPacket(), 'RUNTIME_AUTHORIZATION');

    assert.equal(request.currentStatus, 'not_authorized');
    assert.ok(request.approvalDoesNotGrant.includes('AGENT1_AUTHORIZATION'));
  });

  it('includes AGENT1_AUTHORIZATION, which cannot skip GATE-2, GATE-7 or the cap and input policy', () => {
    const request = findDecision(readyPacket(), 'AGENT1_AUTHORIZATION');

    assert.equal(request.decisionOwner, 'commercial_operations');
    assert.equal(request.currentStatus, 'not_authorized');
    for (const withheld of ['GATE_2_APPROVAL', 'GATE_7_APPROVAL', 'CAP_INPUT_POLICY_APPROVAL']) {
      assert.ok(request.approvalDoesNotGrant.includes(withheld), withheld);
    }
  });

  it('marks every decision as requiring its own separate authorization', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      for (const request of packet(fixture, decision).decisionRequests) {
        assert.equal(
          request.separateAuthorizationRequired,
          true,
          `${fixture} / ${decision} / ${request.decisionId}`,
        );
      }
    }
  });

  it('gives every decision a non-empty approvalDoesNotGrant list, and a stated owner and effect', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      for (const request of packet(fixture, decision).decisionRequests) {
        assert.ok(
          request.approvalDoesNotGrant.length > 0,
          `${request.decisionId} must state what approving it does NOT grant`,
        );
        assert.ok(request.requiredDecision.length > 0, request.decisionId);
        assert.ok(request.approvalEffect.length > 0, request.decisionId);
        // A decision can never list itself as something its own approval fails to grant.
        assert.ok(
          !request.approvalDoesNotGrant.includes(request.decisionId),
          `${request.decisionId} must not withhold itself`,
        );
      }
    }
  });
});

// ─── 5. Unresolved authorizations (28) ────────────────────────────────────────

describe('BR-SOURCE-13I unresolved authorizations', () => {
  it('lists all nine as unresolved, for every fixture and decision', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const value = packet(fixture, decision);

      assert.deepEqual(value.unresolvedAuthorizations, [...NINE_DECISIONS], `${fixture} / ${decision}`);
      assert.equal(value.unresolvedAuthorizations.length, 9);
      // The requested set and the unresolved set are the same set, always.
      assert.deepEqual([...decisionIds(value)], [...value.unresolvedAuthorizations]);
    }
  });
});

// ─── 6. Blockers (29–38) ──────────────────────────────────────────────────────

describe('BR-SOURCE-13I blockers', () => {
  /** Asserts a blocker id is present in every packet, whatever the fixture and decision. */
  function assertAlwaysBlocked(blockerId: string): void {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.ok(
        packet(fixture, decision).blockers.includes(blockerId),
        `${fixture} / ${decision} must report ${blockerId}`,
      );
    }
  }

  it('reports OWNER_COMPLETION_RESUBMISSION_NOT_RECEIVED', () => {
    assertAlwaysBlocked('OWNER_COMPLETION_RESUBMISSION_NOT_RECEIVED');
  });

  it('reports OWNER_DECISIONS_NOT_CAPTURED', () => {
    assertAlwaysBlocked('OWNER_DECISIONS_NOT_CAPTURED');
  });

  it('reports GATE_2_REMAINS_NOT_APPROVED', () => {
    assertAlwaysBlocked('GATE_2_REMAINS_NOT_APPROVED');
  });

  it('reports GATE_7_REMAINS_NOT_APPROVED', () => {
    assertAlwaysBlocked('GATE_7_REMAINS_NOT_APPROVED');
  });

  it('reports CAP_INPUT_POLICY_REMAINS_NOT_APPROVED', () => {
    assertAlwaysBlocked('CAP_INPUT_POLICY_REMAINS_NOT_APPROVED');
  });

  it('reports CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED', () => {
    assertAlwaysBlocked('CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED');
  });

  it('reports FULL_JOIN_EXECUTION_NOT_AUTHORIZED', () => {
    assertAlwaysBlocked('FULL_JOIN_EXECUTION_NOT_AUTHORIZED');
  });

  it('reports IMPORT_NOT_AUTHORIZED', () => {
    assertAlwaysBlocked('IMPORT_NOT_AUTHORIZED');
  });

  it('reports RUNTIME_NOT_AUTHORIZED, AGENT1_NOT_AUTHORIZED and BRAZIL_REMAINS_BLOCKED', () => {
    assertAlwaysBlocked('RUNTIME_NOT_AUTHORIZED');
    assertAlwaysBlocked('AGENT1_NOT_AUTHORIZED');
    assertAlwaysBlocked('BRAZIL_REMAINS_BLOCKED');

    // The eleven owned blockers lead the list, in their declared order.
    assert.deepEqual(
      readyPacket().blockers.slice(0, BRAZIL_RECEITA_HANDOFF_BLOCKERS.length),
      [...BRAZIL_RECEITA_HANDOFF_BLOCKERS],
    );
  });

  it('carries every readiness blocker with the READINESS/ prefix and no other provenance', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const value = packet(fixture, decision);
      const report = value.readinessReport;

      assert.ok(report.blockers.length > 0, `${fixture} / ${decision}`);

      for (const inherited of report.blockers) {
        assert.ok(
          value.blockers.includes(
            `${BRAZIL_RECEITA_HANDOFF_READINESS_BLOCKER_PREFIX}${inherited.blockerId}`,
          ),
          `${fixture} / ${decision}: ${inherited.blockerId} must be carried with the READINESS/ prefix`,
        );
      }

      // Everything beyond the owned list is prefixed, and nothing is duplicated.
      const inheritedSlice = value.blockers.slice(BRAZIL_RECEITA_HANDOFF_BLOCKERS.length);
      for (const blocker of inheritedSlice) {
        assert.ok(
          blocker.startsWith(BRAZIL_RECEITA_HANDOFF_READINESS_BLOCKER_PREFIX),
          `${fixture} / ${decision}: ${blocker} must be prefixed`,
        );
      }
      assert.equal(new Set(inheritedSlice).size, inheritedSlice.length, `${fixture} / ${decision}`);
    }
  });
});

// ─── 7. Assertions and conclusions (39–43) ────────────────────────────────────

describe('BR-SOURCE-13I assertions and conclusions', () => {
  it('states every required safety assertion, for every fixture and decision', () => {
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
    ];

    assert.deepEqual([...BRAZIL_RECEITA_HANDOFF_SAFETY_ASSERTIONS], required);

    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.deepEqual(packet(fixture, decision).safetyAssertions, required, `${fixture} / ${decision}`);
    }
  });

  it('states every required next human action, for every fixture and decision', () => {
    const required = [
      'HUMAN_REVIEW_AUTHORIZATION_HANDOFF_PACKET',
      'OWNER_MUST_COMPLETE_RESUBMISSION',
      'OWNER_MUST_CAPTURE_FORMAL_DECISIONS',
      'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
      'GATE_2_DECISION_REQUIRED',
      'GATE_7_DECISION_REQUIRED',
      'CAP_INPUT_POLICY_DECISION_REQUIRED',
      'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION_REQUIRED',
      'FULL_JOIN_EXECUTION_AUTHORIZATION_REQUIRED',
      'IMPORT_AUTHORIZATION_REQUIRED',
      'RUNTIME_AUTHORIZATION_REQUIRED',
      'AGENT1_AUTHORIZATION_REQUIRED',
    ];

    assert.deepEqual([...BRAZIL_RECEITA_HANDOFF_REQUIRED_HUMAN_ACTIONS], required);

    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.deepEqual(
        packet(fixture, decision).requiredNextHumanActions,
        required,
        `${fixture} / ${decision}`,
      );
    }
  });

  it('concludes exactly OWNER_LEGAL_SECURITY_DECISION_REQUIRED', () => {
    assert.equal(BRAZIL_RECEITA_HANDOFF_CONCLUSION, 'OWNER_LEGAL_SECURITY_DECISION_REQUIRED');

    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.equal(
        packet(fixture, decision).handoffConclusion,
        'OWNER_LEGAL_SECURITY_DECISION_REQUIRED',
        `${fixture} / ${decision}`,
      );
    }
  });

  it('concludes exactly BRAZIL_REMAINS_BLOCKED about Brazil', () => {
    assert.equal(BRAZIL_RECEITA_HANDOFF_READINESS_CONCLUSION, 'BRAZIL_REMAINS_BLOCKED');

    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.equal(
        packet(fixture, decision).readinessConclusion,
        'BRAZIL_REMAINS_BLOCKED',
        `${fixture} / ${decision}`,
      );
    }
  });

  it('carries exactly the disclaimer "Authorization handoff packet is not execution authorization."', () => {
    assert.equal(
      BRAZIL_RECEITA_HANDOFF_DISCLAIMER,
      'Authorization handoff packet is not execution authorization.',
    );

    for (const { fixture, decision } of ALL_COMBINATIONS) {
      assert.equal(
        packet(fixture, decision).disclaimer,
        'Authorization handoff packet is not execution authorization.',
        `${fixture} / ${decision}`,
      );
    }
  });
});

// ─── 8. Determinism and rendering (44–47) ─────────────────────────────────────

describe('BR-SOURCE-13I determinism and rendering', () => {
  it('serializes JSON deterministically', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const first = formatBrazilReceitaControlledExecutionAuthorizationHandoffPacket(
        packet(fixture, decision),
        'json',
      );
      const second = formatBrazilReceitaControlledExecutionAuthorizationHandoffPacket(
        packet(fixture, decision),
        'json',
      );

      assert.equal(first, second, `${fixture} / ${decision}`);
      // The static timestamp is what makes two runs byte-identical; no clock may leak into the packet.
      assert.ok(
        first.includes('"generatedAt":"STATIC_SYNTHETIC_TIMESTAMP"'),
        `${fixture} / ${decision} must carry the static synthetic timestamp`,
      );
      assert.equal(
        first,
        formatBrazilReceitaControlledExecutionAuthorizationHandoffPacket(
          packet(fixture, decision),
          'json',
          false,
        ),
      );
    }
  });

  it('renders Markdown deterministically', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const first = renderBrazilReceitaControlledExecutionAuthorizationHandoffPacketMarkdown(
        packet(fixture, decision),
      );
      const second = renderBrazilReceitaControlledExecutionAuthorizationHandoffPacketMarkdown(
        packet(fixture, decision),
      );

      assert.equal(first, second, `${fixture} / ${decision}`);
      assert.equal(
        first,
        formatBrazilReceitaControlledExecutionAuthorizationHandoffPacket(
          packet(fixture, decision),
          'markdown',
        ),
      );
      // `pretty` is a JSON-only concern and must not alter the Markdown.
      assert.equal(
        first,
        formatBrazilReceitaControlledExecutionAuthorizationHandoffPacket(
          packet(fixture, decision),
          'markdown',
          true,
        ),
      );
    }
  });

  it('says Brazil remains blocked in the Markdown, for every fixture and decision', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const markdown = renderBrazilReceitaControlledExecutionAuthorizationHandoffPacketMarkdown(
        packet(fixture, decision),
      );

      assert.match(markdown, /Brazil remains blocked\./, `${fixture} / ${decision}`);
      assert.match(markdown, /\*\*BRAZIL_REMAINS_BLOCKED\*\*/, `${fixture} / ${decision}`);
    }
  });

  it('says it is not an execution authorization in the Markdown, and names all nine decisions', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const markdown = renderBrazilReceitaControlledExecutionAuthorizationHandoffPacketMarkdown(
        packet(fixture, decision),
      );

      assert.match(
        markdown,
        /Authorization handoff packet is not execution authorization\./,
        `${fixture} / ${decision}`,
      );
      assert.match(markdown, /\*\*NO_GO\*\*/, `${fixture} / ${decision}`);
      assert.match(markdown, /\*\*not_authorized\*\*/, `${fixture} / ${decision}`);
      assert.match(markdown, /\*\*blocked\*\*/, `${fixture} / ${decision}`);

      for (const decisionId of NINE_DECISIONS) {
        assert.ok(markdown.includes(decisionId), `${fixture} / ${decision}: ${decisionId}`);
      }
    }
  });
});

// ─── 9. The CLI produces packets (48–52) ──────────────────────────────────────

describe('BR-SOURCE-13I CLI output', () => {
  it('prints the JSON packet for synthetic-ready + approve and exits 0', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');

    const printed = JSON.parse(run.stdout) as BrazilReceitaControlledExecutionAuthorizationHandoffPacket;
    assert.deepEqual(printed, JSON.parse(JSON.stringify(readyPacket())));
    assert.equal(printed.status, 'handoff_ready_for_human_decision');
    assert.equal(printed.goNoGo, 'NO_GO');
    assert.equal(printed.authorizationStatus, 'not_authorized');
    assert.equal(printed.brazilReadiness, 'blocked');
  });

  it('prints indented JSON with --pretty, carrying the same packet', () => {
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
    assert.match(run.stdout, /\n {2}"packetType": /);
    assert.deepEqual(JSON.parse(run.stdout), JSON.parse(JSON.stringify(readyPacket())));
  });

  it('prints the Markdown packet for synthetic-ready + approve and exits 0', () => {
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
      `${renderBrazilReceitaControlledExecutionAuthorizationHandoffPacketMarkdown(readyPacket())}\n`,
    );
    assert.match(run.stdout, /Brazil remains blocked\./);
    assert.match(run.stdout, /Authorization handoff packet is not execution authorization\./);
  });

  it('prints a NO_GO packet for a reject decision and still exits 0', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'reject', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as BrazilReceitaControlledExecutionAuthorizationHandoffPacket;
    assert.equal(printed.status, 'handoff_blocked_by_readiness');
    assert.equal(printed.goNoGo, 'NO_GO');
    assert.equal(printed.humanDecisionPacketReady, false);
  });

  it('prints a NO_GO packet for a blocked fixture and still exits 0', () => {
    const run = runCli([
      '--fixture',
      'missing-owner-artifact',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as BrazilReceitaControlledExecutionAuthorizationHandoffPacket;
    assert.equal(printed.status, 'handoff_blocked_by_readiness');
    assert.equal(printed.goNoGo, 'NO_GO');
    assert.equal(printed.authorizationStatus, 'not_authorized');
    assert.equal(printed.brazilReadiness, 'blocked');
  });
});

// ─── 10. The CLI refuses everything else (53–72) ──────────────────────────────

/** Asserts a run failed as a usage error: nothing on stdout, the code on stderr, exit 1. */
function assertUsageError(run: CliRun, code: string): void {
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, new RegExp(code));
}

/** Asserts a forbidden flag is refused in both `--flag value` and `--flag=value` form. */
function assertForbiddenFlag(flag: string): void {
  const base = ['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json'];

  assertUsageError(runCli([...base, flag, 'anything']), 'BRSOURCE13I_FORBIDDEN_ARGUMENT');
  assertUsageError(runCli([...base, `${flag}=anything`]), 'BRSOURCE13I_FORBIDDEN_ARGUMENT');
  // Refused before any packet is produced, even when it leads the argument vector.
  assertUsageError(runCli([flag, 'anything', ...base]), 'BRSOURCE13I_FORBIDDEN_ARGUMENT');
}

describe('BR-SOURCE-13I CLI usage errors', () => {
  it('refuses a missing --fixture', () => {
    assertUsageError(
      runCli(['--decision', 'approve', '--format', 'json']),
      'BRSOURCE13I_FIXTURE_REQUIRED',
    );
    assertUsageError(
      runCli(['--fixture', '--decision', 'approve', '--format', 'json']),
      'BRSOURCE13I_FIXTURE_REQUIRED',
    );
  });

  it('refuses a missing --decision', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--format', 'json']),
      'BRSOURCE13I_DECISION_REQUIRED',
    );
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', '--format', 'json']),
      'BRSOURCE13I_DECISION_REQUIRED',
    );
  });

  it('refuses a missing --format', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', 'approve']),
      'BRSOURCE13I_FORMAT_REQUIRED',
    );
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format']),
      'BRSOURCE13I_FORMAT_REQUIRED',
    );
  });

  it('refuses an unknown --fixture', () => {
    assertUsageError(
      runCli(['--fixture', 'not-a-fixture', '--decision', 'approve', '--format', 'json']),
      'BRSOURCE13I_FIXTURE_UNKNOWN',
    );
  });

  it('refuses an unknown --decision', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', 'authorized', '--format', 'json']),
      'BRSOURCE13I_DECISION_UNKNOWN',
    );
  });

  it('refuses an unknown --format', () => {
    assertUsageError(
      runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'csv']),
      'BRSOURCE13I_FORMAT_UNKNOWN',
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

  it('refuses --approve, the flag it would most plausibly be expected to have', () => {
    assertForbiddenFlag('--approve');
  });

  it('refuses any unknown flag', () => {
    for (const flag of ['--verbose', '--all', '--ready', '--handoff', '--sign']) {
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
        'BRSOURCE13I_UNKNOWN_ARGUMENT',
      );
    }
  });

  it('refuses a positional argument, including one shaped like a location', () => {
    for (const positional of ['synthetic-ready', 'packet.json', 'some/relative/dir']) {
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
        'BRSOURCE13I_UNKNOWN_ARGUMENT',
      );
    }
  });
});

// ─── 11. Static guards (73–75) ────────────────────────────────────────────────

describe('BR-SOURCE-13I static guards', () => {
  it('the handoff packet module reaches no filesystem, process, database or runtime surface', () => {
    const source = fs.readFileSync(HANDOFF_MODULE, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      './br-receita-cnpj-controlled-execution-readiness-orchestrator',
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
        `the handoff packet module must not reference ${forbidden}`,
      );
    }
  });

  it('the CLI reaches no filesystem, process-spawning, database or runtime surface', () => {
    const source = fs.readFileSync(HANDOFF_CLI, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-authorization-handoff-packet',
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

    // Call-shaped tokens only: the prose in both files legitimately discusses file reads and spawning in
    // order to state that neither happens.
    for (const file of [HANDOFF_MODULE, HANDOFF_CLI]) {
      const text = fs.readFileSync(file, 'utf8');
      for (const forbidden of [
        'readFile',
        'writeFile',
        'createWriteStream',
        'spawnSync(',
        'exec(',
      ]) {
        assert.ok(!text.includes(forbidden), `${file} must not reference ${forbidden}`);
      }
    }
  });

  it('no state, permission, authorization or readiness flag can be true for any fixture and decision combination', () => {
    for (const { fixture, decision } of ALL_COMBINATIONS) {
      const value = packet(fixture, decision);

      for (const key of WITHHELD_KEYS) {
        assert.equal(value[key], false, `${fixture} / ${decision} / ${key} must stay false`);
      }

      assert.equal(value.goNoGo, 'NO_GO', `${fixture} / ${decision}`);
      assert.equal(value.authorizationStatus, 'not_authorized', `${fixture} / ${decision}`);
      assert.equal(value.brazilReadiness, 'blocked', `${fixture} / ${decision}`);
      assert.equal(
        value.handoffConclusion,
        'OWNER_LEGAL_SECURITY_DECISION_REQUIRED',
        `${fixture} / ${decision}`,
      );
      assert.equal(value.readinessConclusion, 'BRAZIL_REMAINS_BLOCKED', `${fixture} / ${decision}`);

      // The same sweep over the serialized forms, so no format can leak a permission the object withheld.
      const json = formatBrazilReceitaControlledExecutionAuthorizationHandoffPacket(value, 'json');
      const markdown = formatBrazilReceitaControlledExecutionAuthorizationHandoffPacket(
        value,
        'markdown',
      );
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

// ─── 12. Upstream regressions (76–83) ─────────────────────────────────────────

describe('BR-SOURCE-13I upstream regressions', () => {
  it('BR-SOURCE-13H still reaches synthetic_chain_operational_execution_blocked for synthetic-ready + approve', () => {
    const report = buildBrazilReceitaControlledExecutionReadinessReport({
      fixtureName: 'synthetic-ready',
      reviewDecisionValue: 'approve',
    });

    assert.equal(report.status, 'synthetic_chain_operational_execution_blocked');
    assert.equal(report.goNoGo, 'NO_GO');
    assert.equal(report.productionReadiness, 'not_ready_blocked');
    assert.equal(report.syntheticChainOperational, true);
    assert.equal(report.controlledExecutionAttemptAuthorized, false);

    const run = runScript(READINESS_13H_CLI, [
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as Record<string, unknown>;
    assert.equal(printed.status, 'synthetic_chain_operational_execution_blocked');
    assert.equal(printed.goNoGo, 'NO_GO');
  });

  it('BR-SOURCE-13G still reaches blocked_no_execution_authorization for synthetic-ready + approve', () => {
    const result = runBrazilReceitaControlledExecutionAttemptRunnerScaffold({
      fixtureName: 'synthetic-ready',
      reviewDecisionValue: 'approve',
    });

    assert.equal(result.status, 'blocked_no_execution_authorization');
    assert.equal(result.goNoGo, 'NO_GO');
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
    const requestPacket = buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');

    assert.equal(requestPacket.status, 'ready_for_review');
    assert.equal(requestPacket.goNoGo, 'GO');
    assert.deepEqual(requestPacket.blockers, []);

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

  it('BR-SOURCE-13A still validates the synthetic-ready owner artifact through the fixture chain', () => {
    const request = buildBrazilReceitaSyntheticOwnerArtifactFixture('synthetic-ready');
    const owner = validateBrazilReceitaOwnerDecisionArtifact(request.ownerDecisionArtifact);

    assert.equal(owner.status, 'valid');
    assert.equal(owner.goNoGo, 'GO');
    assert.equal(owner.canProceedToControlledExecutionPreflight, true);
  });
});
