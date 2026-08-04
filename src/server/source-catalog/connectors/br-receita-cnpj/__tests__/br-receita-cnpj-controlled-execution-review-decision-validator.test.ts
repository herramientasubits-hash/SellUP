/**
 * BR Receita CNPJ — controlled execution review decision validator — tests (BR-SOURCE-13E).
 *
 * Three load-bearing properties:
 *
 *   1. A review decision is only meaningful over a genuine BR-SOURCE-13D packet that reached
 *      `ready_for_review`. A missing, blocked, mutated or disclaimer-less packet blocks the decision,
 *      and every verdict the chain produced still comes from 13A / 13B / 13D.
 *   2. Fail-closed. An incomplete, placeholder-carrying, unsafe or unrecognized decision blocks; an
 *      `approve` needs all seven identity fields and all thirteen acknowledgements; and the CLI
 *      refuses every argument that is not `--fixture`, `--decision`, `--format` or `--pretty`.
 *   3. Review approval is not execution authorization. No decision, in any format, in any code path,
 *      grants a real-data permission or moves a gate, and every result restates it in prose.
 *
 * 100% offline and synthetic. No dataset, no manifest, no CSV, no ZIP, no row, no join, no coverage,
 * no import, no Supabase, no network, no runtime, no provider, no Agent 1. Two kinds of process
 * interaction happen HERE and nowhere in the validator or its CLI: this file reads this repository's
 * OWN sources for the static guards, and spawns the CLIs to test them as CLIs.
 *
 * Every forbidden-content value below is assembled from harmless parts at runtime, so this file
 * contains no location-, host- or credential-shaped literal.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  BRAZIL_RECEITA_REVIEW_DECISION_APPROVE_REQUIRED_ACKS as REQUIRED_ACKS,
  BRAZIL_RECEITA_REVIEW_DECISION_APPROVE_REQUIRED_STRING_FIELDS as REQUIRED_STRINGS,
  BRAZIL_RECEITA_REVIEW_DECISION_DISCLAIMER,
  BRAZIL_RECEITA_REVIEW_DECISION_FINDING_CODES as CODES,
  BRAZIL_RECEITA_REVIEW_DECISION_FORBIDDEN_CONTENT_TOKENS as FORBIDDEN_TOKENS,
  BRAZIL_RECEITA_REVIEW_DECISION_PLACEHOLDER_TOKEN,
  BRAZIL_RECEITA_REVIEW_DECISION_VALUES,
  BRAZIL_RECEITA_REVIEW_DECISION_WITHHELD_KEYS as WITHHELD_KEYS,
  buildBrazilReceitaControlledExecutionReviewDecisionReport,
  buildBrazilReceitaSyntheticControlledExecutionReviewDecision,
  formatBrazilReceitaControlledExecutionReviewDecisionReport,
  validateBrazilReceitaControlledExecutionReviewDecision,
  type BrazilReceitaControlledExecutionReviewDecision,
  type BrazilReceitaControlledExecutionReviewDecisionValidationResult,
} from '../br-receita-cnpj-controlled-execution-review-decision-validator';
import {
  BRAZIL_RECEITA_REQUEST_PACKET_DISCLAIMER,
  buildBrazilReceitaControlledExecutionRequestPacket,
  type BrazilReceitaControlledExecutionRequestPacket,
} from '../br-receita-cnpj-controlled-execution-request-packet-generator';
import { evaluateBrazilReceitaControlledExecutionPreflight } from '../br-receita-cnpj-controlled-execution-preflight-evaluator';
import {
  BRAZIL_RECEITA_OWNER_DECISION_PLACEHOLDER_TOKEN,
  validateBrazilReceitaOwnerDecisionArtifact,
} from '../br-receita-cnpj-owner-decision-validator';
import { buildBrazilReceitaSyntheticOwnerArtifactFixture } from '../br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Paths and helpers ────────────────────────────────────────────────────────

/** Repository root, reached from this test's directory without hardcoding any absolute path. */
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..', '..');

const VALIDATOR_CLI = path.join(
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

const VALIDATOR_MODULE = path.join(
  __dirname,
  '..',
  'br-receita-cnpj-controlled-execution-review-decision-validator.ts',
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
  return runScript(VALIDATOR_CLI, args);
}

function readyPacket(): BrazilReceitaControlledExecutionRequestPacket {
  return buildBrazilReceitaControlledExecutionRequestPacket('synthetic-ready');
}

function blockedPacket(): BrazilReceitaControlledExecutionRequestPacket {
  return buildBrazilReceitaControlledExecutionRequestPacket('missing-owner-artifact');
}

/** A review-ready packet with fields overridden, for the artificially-mutated packet cases. */
function mutatedPacket(
  overrides: Record<string, unknown>,
): BrazilReceitaControlledExecutionRequestPacket {
  return {
    ...readyPacket(),
    ...overrides,
  } as unknown as BrazilReceitaControlledExecutionRequestPacket;
}

/** A complete synthetic approve decision over the review-ready packet, with fields overridden. */
function approveDecision(
  overrides: Record<string, unknown> = {},
): BrazilReceitaControlledExecutionReviewDecision {
  return {
    ...buildBrazilReceitaSyntheticControlledExecutionReviewDecision(readyPacket(), 'approve'),
    ...overrides,
  } as BrazilReceitaControlledExecutionReviewDecision;
}

/** The same decision with one key removed entirely, rather than set to a falsy value. */
function approveDecisionWithout(key: string): BrazilReceitaControlledExecutionReviewDecision {
  const base = approveDecision() as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(base).filter(([entryKey]) => entryKey !== key),
  ) as BrazilReceitaControlledExecutionReviewDecision;
}

function codesOf(result: BrazilReceitaControlledExecutionReviewDecisionValidationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

function blockingCodesOf(
  result: BrazilReceitaControlledExecutionReviewDecisionValidationResult,
): string[] {
  return result.findings.filter((f) => f.severity === 'blocking').map((f) => f.code);
}

function assertNothingGranted(result: Record<string, unknown>): void {
  for (const key of WITHHELD_KEYS) {
    assert.equal(result[key], false, `${key} must always be false`);
  }
}

// Forbidden-content values, assembled from harmless parts so no literal appears in this file.
const FORBIDDEN_LOCAL_PATH = ['', 'Users', ''].join('/');
const FORBIDDEN_MANIFEST_NAME = ['manifest', 'headerless', 'json'].join('.');
const FORBIDDEN_CREDENTIAL = ['sk', 'SYNTHETIC_PLACEHOLDER_VALUE'].join('-');

// ─── 1. Missing and malformed input ───────────────────────────────────────────

describe('BR-SOURCE-13E validator — missing input', () => {
  it('blocks a null input', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision(null);

    assert.equal(result.status, 'invalid');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(codesOf(result).includes(CODES.inputMissing));
    assertNothingGranted(result as unknown as Record<string, unknown>);
  });

  it('blocks an undefined input the same way', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision(undefined);

    assert.equal(result.status, 'invalid');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(codesOf(result).includes(CODES.inputMissing));
  });

  it('blocks a missing packet', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      reviewDecision: approveDecision(),
    });

    assert.equal(result.status, 'invalid');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.decisionOutcome, 'blocked');
    assert.equal(result.packetReadyForReview, false);
    assert.ok(codesOf(result).includes(CODES.packetMissing));
  });

  it('blocks a missing review decision', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
    });

    assert.equal(result.status, 'invalid');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.decisionOutcome, 'blocked');
    assert.equal(result.reviewDecisionAccepted, false);
    assert.equal(result.packetReadyForReview, true);
    assert.ok(codesOf(result).includes(CODES.decisionMissing));
  });

  it('blocks an empty object, reporting both the packet and the decision', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({});

    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(codesOf(result).includes(CODES.packetMissing));
    assert.ok(codesOf(result).includes(CODES.decisionMissing));
  });
});

// ─── 2. Approve over a review-ready packet ────────────────────────────────────

describe('BR-SOURCE-13E validator — approve', () => {
  it('accepts a complete approve decision over a review-ready packet', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision(),
    });

    assert.deepEqual(blockingCodesOf(result), []);
    assert.equal(result.status, 'valid');
    assert.equal(result.goNoGo, 'GO');
    assert.equal(result.decisionOutcome, 'approved_for_next_planning_review');
    assert.equal(result.reviewDecisionAccepted, true);
    assert.equal(result.packetReadyForReview, true);
    assert.equal(result.canProceedToControlledExecutionAttemptPlanningReview, true);
  });

  it('keeps every real-data permission false on an approval', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision(),
    });

    assert.equal(result.canExecuteRealData, false);
    assert.equal(result.canReadManifest, false);
    assert.equal(result.canReadCsv, false);
    assert.equal(result.canReadZip, false);
    assert.equal(result.canReadRows, false);
    assert.equal(result.canImport, false);
    assert.equal(result.canWriteSupabase, false);
    assert.equal(result.canActivateRuntime, false);
    assert.equal(result.canActivateAgent1, false);
    assert.equal(result.canCallProviders, false);
  });

  it('does not approve GATE-2, GATE-7 or the cap / input policy on an approval', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision(),
    });

    assert.equal(result.gate2Approved, false);
    assert.equal(result.gate7Approved, false);
    assert.equal(result.capInputPolicyApproved, false);
  });

  it('does not authorize a controlled execution attempt on an approval', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision(),
    });

    assert.equal(result.controlledExecutionAttemptAuthorized, false);
    assertNothingGranted(result as unknown as Record<string, unknown>);
  });

  it('states that review approval is not execution authorization', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision(),
    });

    const disclaimer = result.findings.find(
      (finding) => finding.code === CODES.isNotExecutionAuthorization,
    );

    assert.ok(disclaimer, 'the result must carry the disclaimer finding');
    assert.equal(disclaimer?.severity, 'info');
    assert.ok(disclaimer?.message.startsWith(BRAZIL_RECEITA_REVIEW_DECISION_DISCLAIMER));
  });
});

// ─── 3. Reject and defer ──────────────────────────────────────────────────────

describe('BR-SOURCE-13E validator — reject and defer', () => {
  it('accepts a reject decision but never lets it advance', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({ decisionValue: 'reject' }),
    });

    assert.equal(result.status, 'valid');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.decisionOutcome, 'rejected');
    assert.equal(result.reviewDecisionAccepted, true);
    assert.equal(result.canProceedToControlledExecutionAttemptPlanningReview, false);
    assert.ok(codesOf(result).includes(CODES.rejected));
    assertNothingGranted(result as unknown as Record<string, unknown>);
  });

  it('accepts a defer decision but never lets it advance', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({ decisionValue: 'defer' }),
    });

    assert.equal(result.status, 'valid');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.decisionOutcome, 'deferred');
    assert.equal(result.reviewDecisionAccepted, true);
    assert.equal(result.canProceedToControlledExecutionAttemptPlanningReview, false);
    assert.ok(codesOf(result).includes(CODES.deferred));
    assertNothingGranted(result as unknown as Record<string, unknown>);
  });

  it('does not require the approve-only acknowledgements for a reject', () => {
    const minimal = {
      decisionValue: 'reject',
    } as unknown as BrazilReceitaControlledExecutionReviewDecision;

    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: minimal,
    });

    assert.equal(result.decisionOutcome, 'rejected');
    assert.deepEqual(blockingCodesOf(result), []);
  });

  it('exposes exactly the three recognized decision values', () => {
    assert.deepEqual([...BRAZIL_RECEITA_REVIEW_DECISION_VALUES], ['approve', 'reject', 'defer']);
  });
});

// ─── 4. Decision value ───────────────────────────────────────────────────────

describe('BR-SOURCE-13E validator — decision value', () => {
  it('blocks a missing decision value', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecisionWithout('decisionValue'),
    });

    assert.equal(result.status, 'invalid');
    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.valueMissing));
  });

  it('blocks an unrecognized decision value', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({ decisionValue: 'approved' }),
    });

    assert.equal(result.status, 'invalid');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.valueUnrecognized));
  });

  it('blocks a placeholder decision value as never completed', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({
        decisionValue: BRAZIL_RECEITA_REVIEW_DECISION_PLACEHOLDER_TOKEN,
      }),
    });

    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.valueMissing));
  });

  it('uses the same placeholder token as BR-SOURCE-13A, without drift', () => {
    assert.equal(
      BRAZIL_RECEITA_REVIEW_DECISION_PLACEHOLDER_TOKEN,
      BRAZIL_RECEITA_OWNER_DECISION_PLACEHOLDER_TOKEN,
    );
  });
});

// ─── 5. Field hygiene ────────────────────────────────────────────────────────

describe('BR-SOURCE-13E validator — field hygiene', () => {
  it('blocks a placeholder string field', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({
        reviewerRole: BRAZIL_RECEITA_REVIEW_DECISION_PLACEHOLDER_TOKEN,
      }),
    });

    assert.equal(result.status, 'invalid');
    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.fieldPlaceholder));
  });

  it('blocks a whitespace-only string field', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({ reviewerReference: '   ' }),
    });

    assert.equal(result.status, 'invalid');
    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.fieldPlaceholder));
  });

  it('blocks an empty string field', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({ decisionDate: '' }),
    });

    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.fieldPlaceholder));
  });

  it('blocks a field carrying an absolute local path', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({
        reviewerReference: `REVIEWER_REF_SYNTHETIC${FORBIDDEN_LOCAL_PATH}`,
      }),
    });

    assert.equal(result.status, 'invalid');
    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.forbiddenContent));
  });

  it('blocks a field carrying the real manifest file name', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({
        reviewerRole: `REVIEWER_ROLE_SYNTHETIC_${FORBIDDEN_MANIFEST_NAME}`,
      }),
    });

    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.forbiddenContent));
  });

  it('blocks a field carrying a credential-shaped value', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({ reviewerReference: FORBIDDEN_CREDENTIAL }),
    });

    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.forbiddenContent));
  });

  it('declares a forbidden-content pattern for every documented category', () => {
    assert.equal(FORBIDDEN_TOKENS.length, 17);
    assert.ok(FORBIDDEN_TOKENS.includes(FORBIDDEN_LOCAL_PATH));
    assert.ok(FORBIDDEN_TOKENS.includes(FORBIDDEN_MANIFEST_NAME));
    assert.ok(FORBIDDEN_TOKENS.includes('@'));
  });

  it('leaves a synthetic date untouched: no rule is anchored on digits', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision(),
    });

    assert.deepEqual(blockingCodesOf(result), []);
  });
});

// ─── 6. Approve-only requirements ─────────────────────────────────────────────

describe('BR-SOURCE-13E validator — approve requirements', () => {
  it('blocks an approve missing any required string field', () => {
    for (const field of REQUIRED_STRINGS) {
      const result = validateBrazilReceitaControlledExecutionReviewDecision({
        packet: readyPacket(),
        reviewDecision: approveDecisionWithout(field),
      });

      assert.equal(result.decisionOutcome, 'blocked', `${field} must be required`);
      assert.ok(
        blockingCodesOf(result).includes(CODES.requiredFieldMissing),
        `${field}: expected ${CODES.requiredFieldMissing}`,
      );
    }
  });

  it('blocks an approve missing the reviewed packet version', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecisionWithout('reviewedPacketVersion'),
    });

    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.requiredFieldMissing));
  });

  it('blocks an approve missing any required acknowledgement', () => {
    for (const field of REQUIRED_ACKS) {
      const result = validateBrazilReceitaControlledExecutionReviewDecision({
        packet: readyPacket(),
        reviewDecision: approveDecisionWithout(field),
      });

      assert.equal(result.decisionOutcome, 'blocked', `${field} must be required`);
      assert.ok(
        blockingCodesOf(result).includes(CODES.requiredAckMissing),
        `${field}: expected ${CODES.requiredAckMissing}`,
      );
    }
  });

  it('treats an acknowledgement set to false exactly like an absent one', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({ noRowReadsAccepted: false }),
    });

    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.requiredAckMissing));
  });

  it('blocks an approve carrying a wider approval scope', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({ approvalScope: 'real_data_execution' }),
    });

    assert.equal(result.status, 'invalid');
    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.approvalScopeInvalid));
  });

  it('blocks an approve that reviewed a different fixture than the packet', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision({ reviewedFixture: 'missing-stage' }),
    });

    assert.equal(result.decisionOutcome, 'blocked');
    assert.ok(blockingCodesOf(result).includes(CODES.packetMismatch));
  });

  it('blocks an approve that reviewed a different packet type or version', () => {
    for (const overrides of [
      { reviewedPacketType: 'some_other_packet_type' },
      { reviewedPacketVersion: 2 },
    ]) {
      const result = validateBrazilReceitaControlledExecutionReviewDecision({
        packet: readyPacket(),
        reviewDecision: approveDecision(overrides),
      });

      assert.equal(result.decisionOutcome, 'blocked', JSON.stringify(overrides));
      assert.ok(blockingCodesOf(result).includes(CODES.packetMismatch));
    }
  });
});

// ─── 7. Packet under review ───────────────────────────────────────────────────

describe('BR-SOURCE-13E validator — packet under review', () => {
  it('blocks an approve over a blocked packet', () => {
    const result = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: blockedPacket(),
      reviewDecision: buildBrazilReceitaSyntheticControlledExecutionReviewDecision(
        blockedPacket(),
        'approve',
      ),
    });

    assert.equal(result.status, 'invalid');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.decisionOutcome, 'blocked');
    assert.equal(result.packetReadyForReview, false);
    assert.ok(blockingCodesOf(result).includes(CODES.packetNotReady));
    assertNothingGranted(result as unknown as Record<string, unknown>);
  });

  it('blocks a packet whose authorization field was artificially set to true', () => {
    for (const key of [
      'realDataExecutionAuthorized',
      'importAuthorized',
      'runtimeAuthorized',
      'agent1Authorized',
      'gate2Approved',
      'gate7Approved',
      'capInputPolicyApproved',
    ]) {
      const result = validateBrazilReceitaControlledExecutionReviewDecision({
        packet: mutatedPacket({ [key]: true }),
        reviewDecision: approveDecision(),
      });

      assert.equal(result.decisionOutcome, 'blocked', key);
      assert.ok(
        blockingCodesOf(result).includes(CODES.packetAuthorizationNotFalse),
        `${key}: expected ${CODES.packetAuthorizationNotFalse}`,
      );
      assertNothingGranted(result as unknown as Record<string, unknown>);
    }
  });

  it('blocks a packet whose disclaimer is missing or altered', () => {
    for (const disclaimer of ['', 'Synthetic GO authorizes execution.']) {
      const result = validateBrazilReceitaControlledExecutionReviewDecision({
        packet: mutatedPacket({ disclaimer }),
        reviewDecision: approveDecision(),
      });

      assert.equal(result.decisionOutcome, 'blocked', disclaimer);
      assert.ok(blockingCodesOf(result).includes(CODES.packetDisclaimerMissing));
    }
  });

  it('blocks a packet of the wrong type, version or synthetic flag', () => {
    for (const overrides of [
      { packetType: 'some_other_packet_type' },
      { version: 2 },
      { syntheticOnly: false },
    ]) {
      const result = validateBrazilReceitaControlledExecutionReviewDecision({
        packet: mutatedPacket(overrides),
        reviewDecision: approveDecision(),
      });

      assert.equal(result.decisionOutcome, 'blocked', JSON.stringify(overrides));
      assert.ok(blockingCodesOf(result).includes(CODES.packetInvalid));
    }
  });

  it('blocks a packet that is GO but not ready_for_review, and the reverse', () => {
    for (const overrides of [{ status: 'blocked' }, { goNoGo: 'NO_GO' }]) {
      const result = validateBrazilReceitaControlledExecutionReviewDecision({
        packet: mutatedPacket(overrides),
        reviewDecision: approveDecision(),
      });

      assert.equal(result.decisionOutcome, 'blocked', JSON.stringify(overrides));
      assert.ok(blockingCodesOf(result).includes(CODES.packetNotReady));
    }
  });

  it('reads the packet disclaimer from BR-SOURCE-13D, without restating it', () => {
    assert.equal(
      readyPacket().disclaimer,
      BRAZIL_RECEITA_REQUEST_PACKET_DISCLAIMER,
      'the reviewable packet must carry 13D’s own disclaimer',
    );
  });
});

// ─── 8. Purity ────────────────────────────────────────────────────────────────

describe('BR-SOURCE-13E validator — purity', () => {
  it('never mutates its input', () => {
    const input = { packet: readyPacket(), reviewDecision: approveDecision() };
    const snapshot = JSON.stringify(input);

    validateBrazilReceitaControlledExecutionReviewDecision(input);

    assert.equal(JSON.stringify(input), snapshot);
  });

  it('is deterministic for the same packet and decision', () => {
    const first = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision(),
    });
    const second = validateBrazilReceitaControlledExecutionReviewDecision({
      packet: readyPacket(),
      reviewDecision: approveDecision(),
    });

    assert.notEqual(first, second);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it('produces a deterministic report for every decision value', () => {
    for (const decisionValue of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
      const first = formatBrazilReceitaControlledExecutionReviewDecisionReport(
        buildBrazilReceitaControlledExecutionReviewDecisionReport('synthetic-ready', decisionValue),
        'json',
      );
      const second = formatBrazilReceitaControlledExecutionReviewDecisionReport(
        buildBrazilReceitaControlledExecutionReviewDecisionReport('synthetic-ready', decisionValue),
        'json',
      );

      assert.equal(first, second, `${decisionValue}: JSON must be byte-identical across runs`);
    }
  });

  it('renders deterministic Markdown that withholds every permission', () => {
    const markdown = formatBrazilReceitaControlledExecutionReviewDecisionReport(
      buildBrazilReceitaControlledExecutionReviewDecisionReport('synthetic-ready', 'approve'),
      'markdown',
    );

    assert.match(markdown, /\| canExecuteRealData \| NO \|/);
    assert.match(markdown, /\| gate2Approved \| NO \|/);
    assert.ok(markdown.includes(BRAZIL_RECEITA_REVIEW_DECISION_DISCLAIMER));
    assert.ok(markdown.includes('Ready for review is not ready for execution.'));
  });
});

// ─── 9. CLI — accepted usage ──────────────────────────────────────────────────

describe('BR-SOURCE-13E CLI — accepted usage', () => {
  it('prints a valid JSON report for an approve decision and exits 0', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout) as { result: Record<string, unknown> };

    assert.equal(report.result.status, 'valid');
    assert.equal(report.result.goNoGo, 'GO');
    assert.equal(report.result.decisionOutcome, 'approved_for_next_planning_review');
    assertNothingGranted(report.result);
  });

  it('supports --pretty and prints the same report indented', () => {
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
    assert.ok(pretty.stdout.includes('\n  '), '--pretty must indent the report');
    assert.deepEqual(JSON.parse(pretty.stdout), JSON.parse(compact.stdout));
  });

  it('prints a Markdown report and exits 0', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'markdown',
    ]);

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^# BR Receita CNPJ — controlled execution review decision\n/);
    assert.match(run.stdout, /- Decision outcome: \*\*approved_for_next_planning_review\*\*/);
    assert.ok(run.stdout.includes(BRAZIL_RECEITA_REVIEW_DECISION_DISCLAIMER));
  });

  it('exits 0 for a reject decision, reporting NO_GO', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'reject', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout) as { result: Record<string, unknown> };

    assert.equal(report.result.goNoGo, 'NO_GO');
    assert.equal(report.result.decisionOutcome, 'rejected');
    assertNothingGranted(report.result);
  });

  it('exits 0 for a defer decision, reporting NO_GO', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'defer', '--format', 'json']);

    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout) as { result: Record<string, unknown> };

    assert.equal(report.result.goNoGo, 'NO_GO');
    assert.equal(report.result.decisionOutcome, 'deferred');
  });

  it('exits 0 for a blocked packet, reporting NO_GO and a blocked outcome', () => {
    const run = runCli([
      '--fixture',
      'missing-owner-artifact',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout) as { result: Record<string, unknown> };

    assert.equal(report.result.status, 'invalid');
    assert.equal(report.result.goNoGo, 'NO_GO');
    assert.equal(report.result.decisionOutcome, 'blocked');
    assert.equal(report.result.packetReadyForReview, false);
    assertNothingGranted(report.result);
  });

  it('accepts every flag in --flag=value form and is deterministic', () => {
    const inline = runCli([
      '--fixture=synthetic-ready',
      '--decision=approve',
      '--format=json',
    ]);
    const spaced = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
    ]);

    assert.equal(inline.status, 0, inline.stderr);
    assert.equal(inline.stdout, spaced.stdout);
  });

  it('never grants a permission in CLI output, for any decision over any fixture', () => {
    for (const fixture of ['synthetic-ready', 'missing-stage', 'rejected-owner-decision']) {
      for (const decision of BRAZIL_RECEITA_REVIEW_DECISION_VALUES) {
        const run = runCli(['--fixture', fixture, '--decision', decision, '--format', 'json']);

        assert.equal(run.status, 0, run.stderr);
        const report = JSON.parse(run.stdout) as { result: Record<string, unknown> };
        assertNothingGranted(report.result);
      }
    }
  });
});

// ─── 10. CLI — refused usage ──────────────────────────────────────────────────

describe('BR-SOURCE-13E CLI — refused usage', () => {
  it('rejects a missing --fixture', () => {
    const run = runCli(['--decision', 'approve', '--format', 'json']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13E_FIXTURE_REQUIRED/);
  });

  it('rejects a missing --decision', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--format', 'json']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13E_DECISION_REQUIRED/);
  });

  it('rejects a missing --format', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13E_FORMAT_REQUIRED/);
  });

  it('rejects a flag given without a value', () => {
    for (const [args, code] of [
      [['--fixture', '--decision', 'approve', '--format', 'json'], 'BRSOURCE13E_FIXTURE_REQUIRED'],
      [['--fixture', 'synthetic-ready', '--decision', '--format', 'json'], 'BRSOURCE13E_DECISION_REQUIRED'],
      [['--fixture', 'synthetic-ready', '--decision', 'approve', '--format'], 'BRSOURCE13E_FORMAT_REQUIRED'],
    ] as const) {
      const run = runCli(args);

      assert.equal(run.status, 1, args.join(' '));
      assert.ok(run.stderr.includes(code), `${args.join(' ')}: expected ${code}`);
    }
  });

  it('rejects an unknown fixture name', () => {
    const run = runCli(['--fixture', 'not-a-fixture', '--decision', 'approve', '--format', 'json']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13E_FIXTURE_UNKNOWN/);
  });

  it('rejects an unknown decision value, including the 13A spelling', () => {
    for (const decision of ['approved', 'yes', 'APPROVE']) {
      const run = runCli(['--fixture', 'synthetic-ready', '--decision', decision, '--format', 'json']);

      assert.equal(run.status, 1, decision);
      assert.equal(run.stdout, '', decision);
      assert.match(run.stderr, /BRSOURCE13E_DECISION_UNKNOWN/);
    }
  });

  it('rejects an unknown format', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'yaml']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13E_FORMAT_UNKNOWN/);
  });

  it('rejects a manifest argument', () => {
    const run = runCli([
      '--fixture',
      'synthetic-ready',
      '--decision',
      'approve',
      '--format',
      'json',
      '--manifest',
      'x',
    ]);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13E_FORBIDDEN_ARGUMENT/);
  });

  it('rejects an input argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json', '--input', 'x']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13E_FORBIDDEN_ARGUMENT/);
  });

  it('rejects an output argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json', '--output', 'x']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13E_FORBIDDEN_ARGUMENT/);
  });

  it('rejects a path argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json', '--path', 'x']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13E_FORBIDDEN_ARGUMENT/);
  });

  it('rejects a real-data argument, bare and in --flag=value form', () => {
    for (const arg of ['--real-data', '--real-data=true']) {
      const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json', arg]);

      assert.equal(run.status, 1, arg);
      assert.equal(run.stdout, '', arg);
      assert.match(run.stderr, /BRSOURCE13E_FORBIDDEN_ARGUMENT/);
    }
  });

  it('rejects every remaining forbidden flag before producing anything', () => {
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
      const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json', flag, 'x']);

      assert.equal(run.status, 1, flag);
      assert.equal(run.stdout, '', flag);
      assert.match(run.stderr, /BRSOURCE13E_FORBIDDEN_ARGUMENT/);
    }
  });

  it('rejects an unrecognized argument', () => {
    const run = runCli(['--fixture', 'synthetic-ready', '--decision', 'approve', '--format', 'json', '--verbose']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13E_UNKNOWN_ARGUMENT/);
  });

  it('rejects a bare positional argument', () => {
    const run = runCli(['synthetic-ready']);

    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /BRSOURCE13E_UNKNOWN_ARGUMENT/);
  });
});

// ─── 11. Static guards ────────────────────────────────────────────────────────

describe('BR-SOURCE-13E static guards', () => {
  it('the validator module reaches no filesystem, process, database or runtime surface', () => {
    const source = fs.readFileSync(VALIDATOR_MODULE, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
      './br-receita-cnpj-controlled-execution-request-packet-generator',
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
      assert.ok(!source.includes(forbidden), `the validator module must not reference ${forbidden}`);
    }
  });

  it('the CLI reaches no filesystem, process-spawning, database or runtime surface', () => {
    const source = fs.readFileSync(VALIDATOR_CLI, 'utf8');

    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual([...specifiers].sort(), [
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
    const source = fs.readFileSync(VALIDATOR_CLI, 'utf8');
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
    for (const file of [VALIDATOR_MODULE, VALIDATOR_CLI]) {
      const source = fs.readFileSync(file, 'utf8');

      // Call-shaped tokens only: the prose in these files legitimately discusses spawning and file
      // reads in order to state that neither happens.
      for (const forbidden of [
        'readFile',
        'writeFile',
        'createWriteStream',
        'spawn(',
        'spawnSync(',
        'exec(',
      ]) {
        assert.ok(!source.includes(forbidden), `${file} must not reference ${forbidden}`);
      }
    }
  });
});

// ─── 12. Upstream regressions ─────────────────────────────────────────────────

describe('BR-SOURCE-13E upstream regressions', () => {
  it('BR-SOURCE-13D still produces a ready_for_review packet for synthetic-ready', () => {
    const packet = readyPacket();

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

  it('embeds the 13D packet verbatim in the report, without reinterpretation', () => {
    const report = buildBrazilReceitaControlledExecutionReviewDecisionReport(
      'synthetic-ready',
      'approve',
    );

    assert.deepEqual(report.packet, readyPacket());
  });
});
