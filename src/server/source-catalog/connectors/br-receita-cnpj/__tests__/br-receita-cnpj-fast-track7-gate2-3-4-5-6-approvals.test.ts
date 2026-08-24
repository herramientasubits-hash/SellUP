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
  // 🔴 BR-SOURCE-FAST-TRACK-8 removed this suite's GATE-7 STATUS assertions rather than re-pointing
  // them: GATE-7's status is now the dedicated FAST-TRACK-8 suite's subject, and two suites asserting
  // the same live status is how the § 11.1 / § 11.2 drift this series has already had to fix begins.
  // What stays here is what belongs to THIS round: which blockers it discharged, and which it did not.
  BRAZIL_RECEITA_GATE7_DEPENDENCY_BLOCKERS_DISCHARGED_BY_FAST_TRACK_7,
  BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS,
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR,
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

  it('the SECOND representations stay TRANSIENT_ONLY, and persisting either is still refused', () => {
    // 🔴 BR-SOURCE-FUNCTIONAL-CUT-A. 4A/4B/4C themselves changed no disposition — the assertion
    // above about `BRAZIL_RECEITA_GATE4_APPROVAL_DOES_NOT` still holds verbatim. CUT A then
    // EXERCISED 4A's exception in `normalized_tax_id`, so the refused set is now the two SECOND
    // representations. What must never regress is that those two stay refused: an exception for one
    // representation is not an exception for three.
    const refused = BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS.filter(
      (entry) => entry.field !== 'normalized_tax_id',
    );
    assert.equal(refused.length, 2);
    for (const entry of refused) {
      assert.equal(entry.persistence, 'TRANSIENT_ONLY', entry.field);
    }
    assert.deepEqual([...BRAZIL_RECEITA_GATE4_NON_PERSISTABLE_FIELDS].sort(), [
      'record_identity_key',
      'tax_id',
    ]);

    // Generated, never a literal: a run of 14 digits, so no identifier-shaped literal sits in this
    // source (mirrors the digitRun() convention used elsewhere in this suite family).
    const fourteenDigits = '4'.repeat(14);
    // A DV-valid synthetic identity, so these rows fail ONLY for the second representation they
    // carry — not incidentally for a missing identity or a missing period.
    const validIdentity = '11222333000181';
    const validPeriod = '2026-07';

    assert.throws(
      () =>
        assertBrazilReceitaSnapshotRowIsPersistable({
          tax_id: fourteenDigits,
          normalized_tax_id: validIdentity,
          record_identity_key: '' as never,
          source_period: validPeriod,
        }),
      BrazilReceitaGate4NonPersistableRowError,
      'the raw CNPJ is a second representation and must stay refused',
    );
    assert.throws(
      () =>
        assertBrazilReceitaSnapshotRowIsPersistable({
          tax_id: '',
          normalized_tax_id: validIdentity,
          record_identity_key: `tax:${fourteenDigits}` as never,
          source_period: validPeriod,
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

    // 🔴 BR-SOURCE-FUNCTIONAL-CUT-A narrowed four of these restrictions rather than removing them,
    // so this guard follows the narrowing instead of the old wording:
    //
    //   · "no migration is created" became "migration 126 is AUTHORED and is NOT APPLIED" (renamed
    //     from 125 by BR-SOURCE CUT A.1, which inserted a sibling generic reconciliation migration
    //     as 125). The operational crossing this defends is APPLYING it, and that is still
    //     forbidden.
    //   · "exact runtime lookup is a recorded PRODUCTIZATION BLOCKER" became "unblocked at the
    //     STORAGE boundary only" — the read half is still missing, and saying so precisely is
    //     stricter than repeating a blanket blocker that is no longer accurate.
    assert.match(text, /migration 126 is AUTHORED and is NOT APPLIED/);
    assert.match(text, /period-aware primitive is still required/);
    assert.match(text, /no surrogate generator is implemented/);
    assert.match(text, /TRANSIENT_ONLY/);
    assert.match(text, /project direction only, not a legal\/privacy approval/);

    // The crossings that must NOT have moved at all.
    assert.match(text, /no persistence, import, Supabase write, runtime path, Agent 1 or Agent 2A integration/);
    assert.match(text, /stays absent from SOURCE_FAMILY_BY_SOURCE_KEY/);
    assert.match(text, /no operational flag is flipped/);
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

// ─── 6 · GATE-7 — the gate THIS round did not approve (approved later, FAST-TRACK-8) ─────────
//
// 🔴 UPDATED BY BR-SOURCE-FAST-TRACK-8. This section's subject is what FAST-TRACK-7 did and did not do:
// it approved GATE-2/3/4/5/6 and it did NOT approve GATE-7. That remains true. GATE-7 was approved by a
// LATER, separate round, by its own three owners, with the reproducibility rehearsal WAIVED — see
// br-receita-cnpj-fast-track8-gate7-approval.test.ts. The assertions below are re-pointed at the
// current live state, because they read live constants rather than a snapshot of this round.

describe('FAST-TRACK-7 · GATE-7 was NOT approved by THIS round — its approval came later, and the reasoning is checked against live code', () => {
  it('the three dependency-gate blockers FAST-TRACK-7 discharged are still recorded as discharged by it', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_DEPENDENCY_BLOCKERS_DISCHARGED_BY_FAST_TRACK_7.length, 3);
    const text = BRAZIL_RECEITA_GATE7_DEPENDENCY_BLOCKERS_DISCHARGED_BY_FAST_TRACK_7.join(' | ');
    for (const gate of ['GATE-2', 'GATE-5', 'GATE-6']) {
      assert.ok(text.includes(gate), `${gate} must be named as discharged`);
    }
    // The fourth blocker was NOT discharged by this round. It outlived FAST-TRACK-7 and was closed by
    // an owner waiver in FAST-TRACK-8 — so nothing remains today, and nothing was closed here.
    assert.deepEqual([...BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS], []);
    assert.ok(
      !text.includes('reproducib'),
      'FAST-TRACK-7 must not be recorded as having discharged the reproducibility blocker',
    );
  });

  it('reproducibility by a different operator is still UNDEMONSTRATED — no rehearsal happened here, or since', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR, 'UNDEMONSTRATED');
  });

  it('🔴 UPDATED BY BR-SOURCE-FAST-TRACK-8: the precondition evaluator now derives PASS from the live state, because GATE-7 is approved too', () => {
    const outcome = evaluateBrazilReceitaGate7Preconditions();
    assert.equal(outcome.result, 'PASS');
    assert.deepEqual([...outcome.unapprovedGates], []);
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

  it('the unblocking criterion names the rehearsal, not another gate approval, and is preserved verbatim', () => {
    assert.match(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.criterion, /rehearsal/);
    assert.equal(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.thenStatusBecomes, 'ready_for_review');
    assert.equal(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.agentMayDischarge, false);
    // 🔴 FAST-TRACK-8 invoked this constant's own no-rehearsal-required branch and did NOT rewrite the
    // sentence that offered it. That is the evidence the branch pre-dated the decision.
    assert.match(
      BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.andStillRequires,
      /or their explicit decision that no rehearsal is required/,
    );
  });
});

// ─── 7 · Cross-cutting: the global view, and what stayed untouched ───────────

// 🔴 UPDATED BY BR-SOURCE-FAST-TRACK-8: eight of eight are now approved and the verdict is GO. The
// five approvals THIS round recorded are unchanged; the count and the verdict moved because a LATER
// round approved the eighth gate.
describe('FAST-TRACK-7 · the global view, re-pointed by FAST-TRACK-8: eight of eight approved, GLOBAL VERDICT GO', () => {
  it('brazilReceitaApprovedGateCount() is 8, and the verdict is GO', () => {
    assert.equal(brazilReceitaApprovedGateCount(), 8);
    assert.equal(brazilReceitaGateGlobalVerdict(), 'GO');
  });

  it('every gate reads an approved status in the authoritative view', () => {
    for (const entry of BRAZIL_RECEITA_GATE_CURRENT_STATE) {
      assert.equal(
        BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(entry.status),
        true,
        `gate ${entry.gate} must be approved`,
      );
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

  // 🔴 UPDATED BY BR-SOURCE-FAST-TRACK-8: § 15's live count is now 8 of 8. The FAST-TRACK-7 subsections
  // asserted above are unchanged; only the § 15 snapshot they feed moved, and it moved because the
  // eighth gate was approved by a later round.
  it('§ 15 names the current approved count, and still preserves the FAST-TRACK-7 needs_evidence history', () => {
    const doc = checklistDoc();
    const matrix = doc.slice(doc.indexOf('## 15. Global GO / NO-GO matrix'));
    assert.match(matrix, /Approved: 8 of 8/);
    assert.doesNotMatch(matrix, /Approved: 7 of 8/);
    // The word survives in the retained history (the § 11.2 pointer and the superseded bullets), which
    // is the series' rule: annotate, never rewrite.
    assert.match(matrix, /needs_evidence/);
  });
});
