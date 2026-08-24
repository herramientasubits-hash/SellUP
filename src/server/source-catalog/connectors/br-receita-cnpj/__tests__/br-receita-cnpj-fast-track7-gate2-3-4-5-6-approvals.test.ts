/**
 * BR-SOURCE-FAST-TRACK-7 — the human owner relay for GATE-2, GATE-3, GATE-4, GATE-5 and GATE-6, and
 * the line it must not cross into GATE-7.
 *
 * The project owner relayed, on 2026-08-24: "The responsible humans say everything is approved for
 * GATE-2, GATE-3, GATE-4, GATE-5 and GATE-6. Proceed and use the best technical decision." This suite
 * proves that relay was recorded in the exact § 14 shape this repository already uses for every prior
 * round, and nothing more:
 *
 *   · GATE-2, GATE-3, GATE-5 and GATE-6 each carry exactly ONE independently-recorded decision.
 *   · GATE-4 carries exactly THREE independently-recorded decisions (4A/4B/4C) — never bundled into
 *     one "approve everything" record, per 10K § 4.
 *   · every decision names a ROLE, never a person, and every decision date is 2026-08-24.
 *   · no agent supplied any half of any decision — every record says so as data.
 *   · GATE-2 … GATE-6 become `approved` ONLY through these recorded artifacts, never by inference.
 *   · GATE-7 is NOT approved by this round. Its dependency-gate blockers are discharged, but
 *     reproducibility by a different operator stays UNDEMONSTRATED, and the gate reads
 *     `needs_evidence` — a status this suite proves is derived, not asserted, from the live state.
 *   · nothing operational moved: the attempt-3 ledger, the temporary-storage policy flag and the
 *     provisional resource-cap proposal are all asserted unchanged against their real owners.
 *
 * Pure: no network, no Supabase, no provider, no real Receita data, no benchmark, no filesystem
 * write. The only file I/O is reading this repository's own sources for the static guards below.
 * 0 credits, 0 writes, 0 migrations.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  BRAZIL_RECEITA_GATE2_APPROVAL_IS_JOINT,
  BRAZIL_RECEITA_GATE2_APPROVED_CAPS,
  BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION,
  BRAZIL_RECEITA_GATE2_PRIVACY_APPROVER_ROLE,
  BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_BUCKET_ORDINAL_CONFIRMATION,
  BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_CONFIRMATION_DATE,
  BRAZIL_RECEITA_GATE2_STATUS,
  BRAZIL_RECEITA_GATE2_TECHNICAL_APPROVER_ROLE,
  buildBrazilReceitaGate2RecordedOwnerDecisionArtifact,
} from '../br-receita-cnpj-gate2-recorded-owner-decision';
import {
  BRAZIL_RECEITA_GATE3_APPROVED,
  BRAZIL_RECEITA_GATE3_FIELD_ALLOWLIST_VERSION,
  BRAZIL_RECEITA_GATE3_LEGAL_PRIVACY_APPROVAL_DATE,
  BRAZIL_RECEITA_GATE3_LEGAL_PRIVACY_APPROVER_ROLE,
  BRAZIL_RECEITA_GATE3_PRODUCT_APPROVER_ROLE,
  BRAZIL_RECEITA_GATE3_REPORT_MARKER_VALUE,
  BRAZIL_RECEITA_GATE3_SINGLE_REMAINING_CRITERION,
  BRAZIL_RECEITA_GATE3_STATUS,
} from '../br-receita-cnpj-gate3-recorded-field-policy';
import {
  BRAZIL_RECEITA_GATE4A_APPROVAL,
  BRAZIL_RECEITA_GATE4B_APPROVAL,
  BRAZIL_RECEITA_GATE4C_APPROVAL,
  BRAZIL_RECEITA_GATE4_APPROVAL_DOES_NOT,
  BRAZIL_RECEITA_GATE4_DECIDED_PARTS,
  BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS,
  BRAZIL_RECEITA_GATE4_NON_PERSISTABLE_FIELDS,
  BRAZIL_RECEITA_GATE4_REPORT_MARKER_VALUE,
  BRAZIL_RECEITA_GATE4_RESTRICTIONS,
  BRAZIL_RECEITA_GATE4_RUNTIME_LOOKUP_FINDING,
  BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION,
  BRAZIL_RECEITA_GATE4_STATUS,
  BRAZIL_RECEITA_GATE4_SUB_DECISIONS,
  BRAZIL_RECEITA_GATE4_SUB_DECISIONS_RECORDED_DATE,
  BRAZIL_RECEITA_GATE4_TECHNICAL_DIRECTION_EXACT_LOOKUP_REPRESENTATION,
  assertBrazilReceitaSnapshotRowIsPersistable,
  BrazilReceitaGate4NonPersistableRowError,
} from '../br-receita-cnpj-gate4-recorded-identity-grain';
import {
  BRAZIL_RECEITA_GATE5_APPROVAL_DATE,
  BRAZIL_RECEITA_GATE5_APPROVAL_SUBJECT,
  BRAZIL_RECEITA_GATE5_APPROVED,
  BRAZIL_RECEITA_GATE5_REVISIONS_EARN_AN_APPROVAL,
  BRAZIL_RECEITA_GATE5_SECURITY_PRIVACY_APPROVER_ROLE,
  BRAZIL_RECEITA_GATE5_SINGLE_REMAINING_CRITERION,
  BRAZIL_RECEITA_GATE5_STATUS,
  BRAZIL_RECEITA_GATE5_TEST_APPROVER_ROLE,
} from '../br-receita-cnpj-gate5-recorded-output-sanitization';
import {
  BRAZIL_RECEITA_GATE6_APPROVAL_DATE,
  BRAZIL_RECEITA_GATE6_APPROVED,
  BRAZIL_RECEITA_GATE6_OPERATOR_APPROVER_ROLE,
  BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION,
  BRAZIL_RECEITA_GATE6_STATUS,
  BRAZIL_RECEITA_GATE6_TECHNICAL_APPROVER_ROLE,
} from '../br-receita-cnpj-gate6-recorded-cleanup-contract';
import {
  BRAZIL_RECEITA_GATE7_APPROVED,
  BRAZIL_RECEITA_GATE7_DEPENDENCY_BLOCKERS_DISCHARGED_BY_FAST_TRACK_7,
  BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS,
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR,
  BRAZIL_RECEITA_GATE7_STATUS,
  BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED,
  BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED_BLOCKED,
  BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION,
} from '../br-receita-cnpj-gate7-recorded-operator-runbook';
import {
  BRAZIL_RECEITA_GATE7_BLOCKING_GATES,
  evaluateBrazilReceitaGate7Preconditions,
  evaluateBrazilReceitaGate7PrivacyPreflight,
} from '../br-receita-cnpj-gate7-operator-runbook';
import { BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS } from '../br-receita-cnpj-gate7-preflight-items';
import {
  BRAZIL_RECEITA_GATE_APPROVED_STATUSES,
  BRAZIL_RECEITA_GATE_CURRENT_STATE,
  brazilReceitaApprovedGateCount,
  brazilReceitaGateGlobalVerdict,
} from '../br-receita-cnpj-gate-status-current-state';
import { BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED } from '../br-receita-cnpj-real-benchmark-attempt-ledger';
import { BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED } from '../br-receita-cnpj-full-join-partition-workspace';
import { BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL } from '../br-receita-cnpj-full-join-resource-envelope';

// ─── Static-guard plumbing ────────────────────────────────────────────────────

const CONNECTOR = 'src/server/source-catalog/connectors/br-receita-cnpj';
const ROOT = path.resolve(__dirname, '../../../../../..');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/** Every module this round changed. Used by the cross-cutting static guards below. */
const TOUCHED_MODULES = [
  'br-receita-cnpj-gate2-recorded-owner-decision.ts',
  'br-receita-cnpj-gate3-recorded-field-policy.ts',
  'br-receita-cnpj-gate4-recorded-identity-grain.ts',
  'br-receita-cnpj-gate5-recorded-output-sanitization.ts',
  'br-receita-cnpj-gate6-recorded-cleanup-contract.ts',
  'br-receita-cnpj-gate7-recorded-operator-runbook.ts',
  'br-receita-cnpj-gate7-operator-runbook.ts',
  'br-receita-cnpj-gate7-preflight-items.ts',
  'br-receita-cnpj-gate-status-current-state.ts',
  'br-receita-cnpj-final-owner-signoff-packet.ts',
].map((name) => `${CONNECTOR}/${name}`);

// ─── 1 · GATE-2 — the privacy-owner confirmation ──────────────────────────────

describe('FAST-TRACK-7 · GATE-2 — the privacy owner confirms the bucket-ordinal disposition', () => {
  it('is approved, and the joint approval is JOINT — both roles named', () => {
    assert.equal(BRAZIL_RECEITA_GATE2_STATUS, 'approved');
    assert.equal(BRAZIL_RECEITA_GATE2_APPROVAL_IS_JOINT, true);
    assert.equal(BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(BRAZIL_RECEITA_GATE2_STATUS), true);
  });

  it('the confirmation answers the privacy question only, on the record', () => {
    assert.equal(BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_BUCKET_ORDINAL_CONFIRMATION.confirmedBy, 'PRIVACY_OWNER');
    assert.equal(BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_BUCKET_ORDINAL_CONFIRMATION.confirmedByAgent, false);
    assert.equal(BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_BUCKET_ORDINAL_CONFIRMATION.reDecidesNumericCeilings, false);
    assert.equal(BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_BUCKET_ORDINAL_CONFIRMATION.reDecidesStorageOption, false);
    assert.equal(
      BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_BUCKET_ORDINAL_CONFIRMATION.reDecidesMaxPhaseRuntimeMsDivergence,
      false,
    );
    assert.equal(BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_BUCKET_ORDINAL_CONFIRMATION.confirmationDate, '2026-08-24');
    assert.equal(BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_CONFIRMATION_DATE, '2026-08-24');
  });

  it('the technical classification it confirms is untouched', () => {
    assert.equal(
      BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION.classification,
      'structural_non_invertible_partition_metadata',
    );
    assert.equal(BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION.isJoinKeyMaterial, false);
  });

  it('numeric ceilings are unchanged by this confirmation', () => {
    assert.deepEqual({ ...BRAZIL_RECEITA_GATE2_APPROVED_CAPS }, {
      maxHeapUsedBytes: 134_217_728,
      maxExternalMemoryBytes: 67_108_864,
      maxRssBytes: 536_870_912,
      maxRuntimeMs: 21_600_000,
      maxPhaseRuntimeMs: 10_800_000,
      maxTemporaryStorageBytes: 4_294_967_296,
      maxRowsRead: 360_000_000,
      maxFilesOpened: 64,
      maxBytesRead: 73_014_444_032,
      maxJoinKeysInMemory: 131_072,
    });
  });

  it('13A now reads gate2Approved true from the recorded artifact, with both roles named', () => {
    const artifact = buildBrazilReceitaGate2RecordedOwnerDecisionArtifact();
    assert.equal(artifact.gate2?.decisionValue, 'approved');
    assert.match(artifact.gate2?.ownerRole ?? '', /technical owner/);
    assert.match(artifact.gate2?.ownerRole ?? '', /privacy owner/);
    assert.equal(BRAZIL_RECEITA_GATE2_TECHNICAL_APPROVER_ROLE, 'technical owner (storage and execution model)');
    assert.equal(BRAZIL_RECEITA_GATE2_PRIVACY_APPROVER_ROLE, 'privacy owner');
  });
});

// ─── 2 · GATE-3 — the legal/privacy half of the joint approval ────────────────

describe('FAST-TRACK-7 · GATE-3 — the legal/privacy owner approves the recorded field policy', () => {
  it('is approved, with both halves of the joint approval on record', () => {
    assert.equal(BRAZIL_RECEITA_GATE3_STATUS, 'approved');
    assert.equal(BRAZIL_RECEITA_GATE3_APPROVED, true);
    assert.equal(BRAZIL_RECEITA_GATE3_SINGLE_REMAINING_CRITERION.productDataHalfRecorded, true);
    assert.equal(BRAZIL_RECEITA_GATE3_SINGLE_REMAINING_CRITERION.legalPrivacyHalfRecorded, true);
    assert.equal(BRAZIL_RECEITA_GATE3_SINGLE_REMAINING_CRITERION.agentMayApprove, false);
    assert.equal(BRAZIL_RECEITA_GATE3_LEGAL_PRIVACY_APPROVAL_DATE, '2026-08-24');
  });

  it('names the roles required, and the field policy is not widened', () => {
    assert.equal(BRAZIL_RECEITA_GATE3_PRODUCT_APPROVER_ROLE, 'product / data owner');
    assert.equal(BRAZIL_RECEITA_GATE3_LEGAL_PRIVACY_APPROVER_ROLE, 'legal/privacy owner');
  });

  it('the report marker now legitimately equals the assigned version, by construction not restatement', () => {
    assert.equal(BRAZIL_RECEITA_GATE3_REPORT_MARKER_VALUE, BRAZIL_RECEITA_GATE3_FIELD_ALLOWLIST_VERSION);
    assert.equal(BRAZIL_RECEITA_GATE3_FIELD_ALLOWLIST_VERSION, 'br_receita_cnpj_field_allowlist_v1');
  });
});

// ─── 3 · GATE-4 — THREE independent decisions, never bundled ─────────────────

describe('FAST-TRACK-7 · GATE-4 — 4A / 4B / 4C are three separate, independently-recorded decisions', () => {
  it('exactly three sub-decisions exist, each with its own owner and reference', () => {
    assert.equal(BRAZIL_RECEITA_GATE4_SUB_DECISIONS.length, 3);
    const ids = BRAZIL_RECEITA_GATE4_SUB_DECISIONS.map((entry) => entry.id);
    assert.deepEqual(ids, ['4A', '4B', '4C']);
    const references = new Set(BRAZIL_RECEITA_GATE4_SUB_DECISIONS.map((entry) => entry.record.ownerReference));
    assert.equal(references.size, 3, 'each sub-decision must carry its own distinct owner reference');
    for (const entry of BRAZIL_RECEITA_GATE4_SUB_DECISIONS) {
      assert.equal(entry.record.decisionDate, '2026-08-24');
    }
    assert.equal(BRAZIL_RECEITA_GATE4_SUB_DECISIONS_RECORDED_DATE, '2026-08-24');
  });

  it('4A: legal/privacy owner grants a narrow exception, answering yes, choosing no encoding', () => {
    assert.equal(BRAZIL_RECEITA_GATE4A_APPROVAL.approvedBy, 'LEGAL_PRIVACY_OWNER');
    assert.equal(BRAZIL_RECEITA_GATE4A_APPROVAL.approvedByAgent, false);
    assert.equal(BRAZIL_RECEITA_GATE4A_APPROVAL.decision, 'yes');
    assert.equal(BRAZIL_RECEITA_GATE4A_APPROVAL.choosesAStorageEncoding, false);
    assert.match(BRAZIL_RECEITA_GATE4A_APPROVAL.grants, /exactly one/);
  });

  it('4B: data architecture owner approves the SAME grain already recorded as decided', () => {
    assert.equal(BRAZIL_RECEITA_GATE4B_APPROVAL.approvedBy, 'DATA_ARCHITECTURE_OWNER');
    assert.equal(BRAZIL_RECEITA_GATE4B_APPROVAL.approvedByAgent, false);
    assert.equal(BRAZIL_RECEITA_GATE4B_APPROVAL.approves, 'option_d');
    assert.equal(BRAZIL_RECEITA_GATE4B_APPROVAL.approvesTheSameGrainAlreadyRecordedAsDecided, true);
  });

  it('4C: product owner approves option D, requiring exact lookup and refusing fuzzy substitution', () => {
    assert.equal(BRAZIL_RECEITA_GATE4C_APPROVAL.approvedBy, 'PRODUCT_OWNER');
    assert.equal(BRAZIL_RECEITA_GATE4C_APPROVAL.approvedByAgent, false);
    assert.equal(BRAZIL_RECEITA_GATE4C_APPROVAL.approves, 'option_d');
    assert.equal(BRAZIL_RECEITA_GATE4C_APPROVAL.exactLookupRequired, true);
    assert.equal(BRAZIL_RECEITA_GATE4C_APPROVAL.fuzzyOrNameBasedLookupAcceptable, false);
  });

  it('the single unresolved question is now ANSWERED yes, attributed to the owner reference from 4A', () => {
    assert.equal(BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION.askedOf, 'LEGAL_PRIVACY_OWNER');
    assert.notEqual(BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION.answeredBy, null);
    assert.equal(BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION.answer, 'yes');
    assert.equal(BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION.agentMayAnswer, false);
  });

  it('GATE-4 is approved, with the grain owner-approved and the identity construction still unimplemented', () => {
    assert.equal(BRAZIL_RECEITA_GATE4_STATUS, 'approved');
    assert.equal(BRAZIL_RECEITA_GATE4_DECIDED_PARTS.grain, 'decided_and_owner_approved');
    assert.equal(
      BRAZIL_RECEITA_GATE4_DECIDED_PARTS.persistedRecordIdentityConstruction,
      'exception_granted_concrete_construction_not_implemented',
    );
    assert.equal(
      BRAZIL_RECEITA_GATE4_DECIDED_PARTS.runtimeExactLookupMechanism,
      'productization_blocker_recorded_not_resolved',
    );
  });

  it('the productization blocker stays recorded as a blocker — it is NOT resolved by this approval', () => {
    assert.equal(BRAZIL_RECEITA_GATE4_RUNTIME_LOOKUP_FINDING.outcome, 'C_NO_COMPLIANT_LOOKUP_MECHANISM_EXISTS');
    assert.equal(BRAZIL_RECEITA_GATE4_RUNTIME_LOOKUP_FINDING.isProductizationBlocker, true);
  });

  it('the technical direction for the eventual encoding is NOT a legal/privacy approval', () => {
    const direction = BRAZIL_RECEITA_GATE4_TECHNICAL_DIRECTION_EXACT_LOOKUP_REPRESENTATION;
    assert.equal(direction.isALegalPrivacyApproval, false);
    assert.equal(direction.isAHumanPrivacySignature, false);
    assert.equal(direction.decidedBy, 'project_technical_direction');
    assert.equal(direction.preferredRepresentation, 'single_normalized_14_character_establishment_cnpj');
    for (const rejected of ['hash', 'fingerprint', 'truncation', 'partial_cnpj', 'other_encoded_derivative', 'multiple_representations']) {
      assert.ok(direction.rejectedRepresentations.includes(rejected), `${rejected} must be named as rejected`);
    }
    assert.equal(direction.authorizesPersistence, false);
    assert.equal(direction.authorsOrAppliesMigration, false);
    assert.equal(direction.changesTransientOnlyDisposition, false);
    assert.equal(direction.resolvesRuntimeLookupBlocker, false);
  });

  it('what 4A/4B/4C do NOT do is enumerated, and none of it happened', () => {
    for (const item of [
      'implement a surrogate generator',
      'source_period migration',
      'TRANSIENT_ONLY',
      'productization blocker',
      'SOURCE_FAMILY_BY_SOURCE_KEY',
      'Supabase write',
    ]) {
      assert.ok(
        BRAZIL_RECEITA_GATE4_APPROVAL_DOES_NOT.some((entry) => entry.includes(item)),
        `the does-not list must name ${item}`,
      );
    }
  });

  it('tax_id, normalized_tax_id and record_identity_key stay TRANSIENT_ONLY, and persisting them is still refused', () => {
    for (const entry of BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS) {
      assert.equal(entry.persistence, 'TRANSIENT_ONLY');
    }
    assert.deepEqual([...BRAZIL_RECEITA_GATE4_NON_PERSISTABLE_FIELDS].sort(), [
      'normalized_tax_id',
      'record_identity_key',
      'tax_id',
    ]);
    // Generated, never a literal: a run of 14 digits, so no identifier-shaped literal sits in this
    // source (mirrors the digitRun() convention used elsewhere in this suite family).
    const fourteenDigits = '4'.repeat(14);
    assert.throws(
      () =>
        assertBrazilReceitaSnapshotRowIsPersistable({
          tax_id: fourteenDigits,
          normalized_tax_id: '',
          record_identity_key: '' as never,
        }),
      BrazilReceitaGate4NonPersistableRowError,
    );
    assert.throws(
      () =>
        assertBrazilReceitaSnapshotRowIsPersistable({
          tax_id: '',
          normalized_tax_id: '',
          record_identity_key: `tax:${fourteenDigits}` as never,
        }),
      BrazilReceitaGate4NonPersistableRowError,
      'a namespace prefix must not disguise the prohibited identifier',
    );
  });

  it('the record_identity_grain_decision marker may now read the chosen grain, no emitter reads it', () => {
    assert.equal(BRAZIL_RECEITA_GATE4_REPORT_MARKER_VALUE, 'option_d');
  });

  it('the restrictions still forbid every operational crossing', () => {
    const text = BRAZIL_RECEITA_GATE4_RESTRICTIONS.join(' | ');
    assert.match(text, /no migration/);
    assert.match(text, /no surrogate generator is implemented/);
    assert.match(text, /TRANSIENT_ONLY/);
    assert.match(text, /PRODUCTIZATION BLOCKER/);
    assert.match(text, /project direction only, not a legal\/privacy approval/);
  });
});

// ─── 4 · GATE-5 — the joint approval against the CORRECTED contract ──────────

describe('FAST-TRACK-7 · GATE-5 — the joint security/privacy + test owner approval, against the § 9.3 contract', () => {
  it('is approved, and the subject is explicitly the post-§9.3 contract, not the § 9.1 draft', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_STATUS, 'approved');
    assert.equal(BRAZIL_RECEITA_GATE5_APPROVED, true);
    assert.equal(BRAZIL_RECEITA_GATE5_APPROVAL_SUBJECT.approvesTheOriginalSection91Draft, false);
    assert.equal(BRAZIL_RECEITA_GATE5_APPROVAL_SUBJECT.approvesThePostSection92SupersededContract, true);
    assert.equal(BRAZIL_RECEITA_GATE5_APPROVAL_SUBJECT.approvesTheSection93EngineReportBoundaryFix, true);
    assert.equal(
      BRAZIL_RECEITA_GATE5_APPROVAL_SUBJECT.totalRowsScannedDisposition,
      'INTERNAL_EXECUTION_COUNTER_ONLY',
    );
    assert.equal(BRAZIL_RECEITA_GATE5_APPROVAL_SUBJECT.residualBucketLabel, 'suppressed_other');
    assert.deepEqual([...BRAZIL_RECEITA_GATE5_APPROVAL_SUBJECT.renamedKeys], [
      'records_persisted',
      'records_seen_by_family',
    ]);
    assert.equal(BRAZIL_RECEITA_GATE5_APPROVAL_DATE, '2026-08-24');
  });

  it('names both required roles and records the joint approval, not a self-approval', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_SECURITY_PRIVACY_APPROVER_ROLE, 'security/privacy owner');
    assert.equal(BRAZIL_RECEITA_GATE5_TEST_APPROVER_ROLE, 'test owner');
    assert.notEqual(BRAZIL_RECEITA_GATE5_SINGLE_REMAINING_CRITERION.securityPrivacyOwnerReference, undefined);
    assert.notEqual(BRAZIL_RECEITA_GATE5_SINGLE_REMAINING_CRITERION.testOwnerReference, undefined);
    assert.equal(BRAZIL_RECEITA_GATE5_SINGLE_REMAINING_CRITERION.agentMayApprove, false);
  });

  it('the revisions themselves still did not earn the approval — the owners did', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_REVISIONS_EARN_AN_APPROVAL, false);
  });
});

// ─── 5 · GATE-6 — the joint approval, DELETE confirmed over quarantine ───────

describe('FAST-TRACK-7 · GATE-6 — the joint technical + operator owner approval confirms DELETE', () => {
  it('is approved, with delete-over-quarantine explicitly confirmed', () => {
    assert.equal(BRAZIL_RECEITA_GATE6_STATUS, 'approved');
    assert.equal(BRAZIL_RECEITA_GATE6_APPROVED, true);
    assert.equal(
      BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION.substantiveDecisionConfirmedAs,
      'delete_over_quarantine',
    );
    assert.equal(BRAZIL_RECEITA_GATE6_APPROVAL_DATE, '2026-08-24');
  });

  it('names both required roles, and the implementer rule stayed intact', () => {
    assert.equal(BRAZIL_RECEITA_GATE6_TECHNICAL_APPROVER_ROLE, 'technical owner');
    assert.equal(BRAZIL_RECEITA_GATE6_OPERATOR_APPROVER_ROLE, 'operator owner');
    assert.equal(BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION.blockedByImplementerRule, true);
    assert.equal(BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION.agentMayApprove, false);
  });
});

// ─── 6 · GATE-7 — NOT approved; needs_evidence, derived not asserted ─────────

describe('FAST-TRACK-7 · GATE-7 is NOT approved — needs_evidence, and the reasoning is checked against live code', () => {
  it('is needs_evidence, never approved, never ready_for_review, never blocked', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_STATUS, 'needs_evidence');
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVED, false);
    assert.equal(BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(BRAZIL_RECEITA_GATE7_STATUS), false);
    assert.notEqual(BRAZIL_RECEITA_GATE7_STATUS, BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED);
    assert.notEqual(BRAZIL_RECEITA_GATE7_STATUS, BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED_BLOCKED);
  });

  it('the three dependency-gate blockers are discharged, and only reproducibility remains', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS.length, 1);
    assert.equal(BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS[0].kind, 'undemonstrated_pass_criterion');
    assert.equal(BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS[0].dischargeableByAnAgent, false);
    assert.equal(BRAZIL_RECEITA_GATE7_DEPENDENCY_BLOCKERS_DISCHARGED_BY_FAST_TRACK_7.length, 3);
    const text = BRAZIL_RECEITA_GATE7_DEPENDENCY_BLOCKERS_DISCHARGED_BY_FAST_TRACK_7.join(' | ');
    for (const gate of ['GATE-2', 'GATE-5', 'GATE-6']) {
      assert.ok(text.includes(gate), `${gate} must be named as discharged`);
    }
  });

  it('reproducibility by a different operator is still UNDEMONSTRATED — no rehearsal happened here', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR, 'UNDEMONSTRATED');
  });

  it('the precondition evaluator derives FAIL from the live state — GATE-7 itself is the only unapproved gate', () => {
    const outcome = evaluateBrazilReceitaGate7Preconditions();
    assert.equal(outcome.result, 'FAIL');
    assert.deepEqual(outcome.unapprovedGates.map((entry) => entry.gate), [7]);
    assert.deepEqual([...outcome.unapprovedBlockingGates], []);
    assert.deepEqual([...BRAZIL_RECEITA_GATE7_BLOCKING_GATES], [2, 5, 6]);
  });

  it('the privacy preflight now PASSES — all five contracts it checks are approved', () => {
    const outcome = evaluateBrazilReceitaGate7PrivacyPreflight();
    assert.equal(outcome.result, 'PASS');
    assert.deepEqual([...outcome.unapprovedContracts], []);
  });

  it('P-19 and P-21 no longer carry a deterministic-fail standing now that GATE-5 and GATE-2 are approved', () => {
    const p19 = BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS.find((item) => item.id === 'P-19');
    const p21 = BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS.find((item) => item.id === 'P-21');
    assert.ok(p19);
    assert.ok(p21);
    assert.notEqual(p19.standing, 'checkable_and_fails_today');
    assert.notEqual(p21.standing, 'checkable_and_fails_today');
  });

  it('the unblocking criterion now names the rehearsal, not another gate approval', () => {
    assert.match(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.criterion, /rehearsal/);
    assert.equal(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.thenStatusBecomes, 'ready_for_review');
    assert.equal(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.agentMayDischarge, false);
  });
});

// ─── 7 · Cross-cutting: the global view, and what stayed untouched ───────────

describe('FAST-TRACK-7 · the global view: seven of eight approved, GLOBAL VERDICT still NO-GO', () => {
  it('brazilReceitaApprovedGateCount() is 7, and the verdict is NO-GO', () => {
    assert.equal(brazilReceitaApprovedGateCount(), 7);
    assert.equal(brazilReceitaGateGlobalVerdict(), 'NO-GO');
  });

  it('every gate except GATE-7 reads an approved status in the authoritative view', () => {
    for (const entry of BRAZIL_RECEITA_GATE_CURRENT_STATE) {
      if (entry.gate === 7) {
        assert.equal(BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(entry.status), false);
      } else {
        assert.equal(
          BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(entry.status),
          true,
          `gate ${entry.gate} must be approved`,
        );
      }
    }
  });

  it('the attempt-3 ledger is untouched: false, imported, no reset path introduced', () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED, false);
    for (const rel of TOUCHED_MODULES) {
      const code = stripComments(read(rel));
      for (const forbidden of ['resetAttempt', 'ATTEMPT_3_ALLOWED = true', 'ATTEMPT_3_ALLOWED=true']) {
        assert.equal(code.includes(forbidden), false, `${rel} must not reset the attempt ledger`);
      }
    }
  });

  it('no operational flag changed: temporary-storage policy stays false, provisional cap stays 0', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED, false);
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL.maxTemporaryStorageBytes, 0);
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL.maxOutputRows, 0);
  });

  it('every new decision date across every gate is 2026-08-24', () => {
    const dates = new Set([
      BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_CONFIRMATION_DATE,
      BRAZIL_RECEITA_GATE3_LEGAL_PRIVACY_APPROVAL_DATE,
      ...BRAZIL_RECEITA_GATE4_SUB_DECISIONS.map((entry) => entry.record.decisionDate),
      BRAZIL_RECEITA_GATE5_APPROVAL_DATE,
      BRAZIL_RECEITA_GATE6_APPROVAL_DATE,
    ]);
    assert.deepEqual([...dates], ['2026-08-24']);
  });
});

// ─── 8 · No personal names, signatures, emails, message IDs or URLs ─────────

describe('FAST-TRACK-7 · every new record carries roles only — no personal identity of any kind', () => {
  it('no touched module carries an email marker, a URL, or a Slack/JWT-shaped token', () => {
    for (const rel of TOUCHED_MODULES) {
      const code = read(rel);
      for (const pattern of [/[\w.+-]+@[\w-]+\.[\w.-]+/, /https?:\/\//, /\bxoxb-/, /\bsk-/]) {
        assert.equal(pattern.test(code), false, `${rel} must not carry ${pattern}`);
      }
    }
  });

  it('every owner reference names a ROLE and a RELAY, never a person', () => {
    const references = [
      BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_BUCKET_ORDINAL_CONFIRMATION.ownerReference,
      ...BRAZIL_RECEITA_GATE4_SUB_DECISIONS.map((entry) => entry.record.ownerReference),
    ];
    for (const reference of references) {
      assert.match(reference, /^OWNER_REF_GATE\d[A-Z]?_[A-Z_]+_RELAY_2026_08_24$/);
    }
  });

  it('no touched module carries a 14- or 11-digit run — no CNPJ- or CPF-shaped literal', () => {
    for (const rel of TOUCHED_MODULES) {
      const code = stripComments(read(rel));
      assert.equal(/(?<!\d)\d{14}(?!\d)/.test(code), false, `${rel} carries a 14-digit run`);
      assert.equal(/(?<!\d)\d{11}(?!\d)/.test(code), false, `${rel} carries an 11-digit run`);
    }
  });
});

// ─── 9 · No agent can supply an approval — structural, not by convention ────

describe('FAST-TRACK-7 · no agent supplied any half of any decision', () => {
  it('every new decision object says agentMayApprove / approvedByAgent is false, as data', () => {
    assert.equal(BRAZIL_RECEITA_GATE2_PRIVACY_OWNER_BUCKET_ORDINAL_CONFIRMATION.confirmedByAgent, false);
    assert.equal(BRAZIL_RECEITA_GATE3_SINGLE_REMAINING_CRITERION.agentMayApprove, false);
    assert.equal(BRAZIL_RECEITA_GATE4A_APPROVAL.approvedByAgent, false);
    assert.equal(BRAZIL_RECEITA_GATE4B_APPROVAL.approvedByAgent, false);
    assert.equal(BRAZIL_RECEITA_GATE4C_APPROVAL.approvedByAgent, false);
    assert.equal(BRAZIL_RECEITA_GATE5_SINGLE_REMAINING_CRITERION.agentMayApprove, false);
    assert.equal(BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION.agentMayApprove, false);
  });

  it('no touched module performs I/O that could fabricate an external confirmation', () => {
    // 🔴 Matched against actual import/require statements and live call sites, never a bare
    // substring: several of these modules NAME "Supabase write" and "supabaseWritesOnAnyPath: 0" in
    // their own prose and preserved-invariant fields precisely because they forbid it — a bare-text
    // grep would flag the very sentence that says "never".
    for (const rel of TOUCHED_MODULES) {
      const code = stripComments(read(rel));
      for (const forbidden of [
        /from\s+['"]node:fs['"]/,
        /from\s+['"]node:path['"]/,
        /from\s+['"]node:process['"]/,
        /\bprocess\s*\.\s*env\b/,
        /\bfetch\s*\(/,
        /\bcreateClient\s*\(/,
        /from\s+['"][^'"]*supabase[^'"]*['"]/i,
      ]) {
        assert.equal(forbidden.test(code), false, `${rel} must stay pure (${forbidden})`);
      }
    }
  });

  it('no touched module imports a runtime, Agent 1, Agent 2A or provider-client module', () => {
    // 🔴 Matched against import/require paths only. `agent1Brazil` and `agent1Integration` are
    // discharge-label and field-name STRINGS elsewhere in this codebase, not module paths, and a
    // bare substring check would flag them as false positives.
    for (const rel of TOUCHED_MODULES) {
      const code = stripComments(read(rel));
      const importSpecifiers = [...code.matchAll(/(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)]
        .map((match) => match[1].toLowerCase());
      for (const forbidden of ['agent-1', 'agent1', 'agent-2a', 'agent2a', 'next/server', 'apollo', 'lusha']) {
        assert.ok(
          !importSpecifiers.some((specifier) => specifier.includes(forbidden)),
          `${rel} must not import a module reaching for ${forbidden}`,
        );
      }
    }
  });
});

// ─── 10 · The doc's new subsections exist, in the exact § 14 shape ─────────

describe('FAST-TRACK-7 · the checklist doc carries the new subsections in the § 14 template shape', () => {
  function checklistDoc(): string {
    return read('docs/source-catalog/br-receita-cnpj-full-join-approval-gates-checklist.md');
  }

  it('every new subsection exists, in gate order', () => {
    const doc = checklistDoc();
    for (const heading of [
      /^### 6\.2 /m,
      /^### 7\.3 /m,
      /^### 8\.2 /m,
      /^### 9\.4 /m,
      /^### 10\.2 /m,
      /^### 11\.2 /m,
    ]) {
      assert.match(doc, heading, `missing subsection for ${heading}`);
    }
  });

  it('each new subsection carries a § 14 template block naming a role-only approver', () => {
    const doc = checklistDoc();
    // Bounded per-heading slices, never a naive split on every "### " (which also matches the
    // "Required owner / approver" style subheadings inside every gate's original section and would
    // pull in unrelated trailing content).
    const approvedHeadings = ['### 6.2 ', '### 7.3 ', '### 8.2 ', '### 9.4 ', '### 10.2 '];
    for (const heading of [...approvedHeadings, '### 11.2 ']) {
      const start = doc.indexOf(heading);
      assert.ok(start >= 0, `missing subsection heading ${heading}`);
      const nextBoundary = doc.indexOf('\n---', start);
      assert.ok(nextBoundary > start, `${heading} has no closing --- boundary`);
      const body = doc.slice(start, nextBoundary);
      assert.match(body, /BR-SOURCE-FAST-TRACK-7/, `${heading} must cite BR-SOURCE-FAST-TRACK-7`);
      const block = /```\nGate:([\s\S]*?)\n```/.exec(body);
      assert.ok(block, `${heading} must carry a fenced § 14 template`);
      assert.match(block[1], /Approver:/);
      assert.doesNotMatch(body, /@[\w-]+\.[\w.-]+/);
      // The five gates this round approves carry the 2026-08-24 approval date; GATE-7's own § 11.2
      // carries none, because it correctly records no approval.
      if (approvedHeadings.includes(heading)) {
        assert.match(block[1], /2026-08-24/, `${heading} must date its approval 2026-08-24`);
      } else {
        assert.match(block[1], /n\/a — no approval exists/, `${heading} must record no approval date`);
      }
    }
  });

  it('§ 15 names the new approved count and GATE-7 by its new status', () => {
    const doc = checklistDoc();
    const matrix = doc.slice(doc.indexOf('## 15. Global GO / NO-GO matrix'));
    assert.match(matrix, /Approved: 7 of 8/);
    assert.match(matrix, /needs_evidence/);
  });
});
