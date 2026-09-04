/**
 * BR-SOURCE-GATE-ROUND-2 — identity grain, cleanup, and the lines this round must not cross.
 *
 * Round 2 closes GATE-3's RB-3, records GATE-4, hardens GATE-2's temp-file naming, and makes GATE-6's
 * cleanup contract executable. Each of those has a way of quietly becoming something bigger than it
 * is, and this suite exists for exactly those ways:
 *
 *   · RB-3 could look like a deletion spree. It is a CLASSIFICATION: the R5 control signals still
 *     exist and the count that was `mei_flag`'s only real consumer still works — asserted against the
 *     real builder, not described.
 *   · GATE-4 could look approved because the grain is decided. It is `needs_owner_decision`, one
 *     exact question, and the question is legal/privacy so no agent may answer it.
 *   · GATE-4 could look like it solved runtime lookup. It recorded a PRODUCTIZATION BLOCKER, and the
 *     blocker is asserted against the REAL lookup primitives rather than against its own prose.
 *   · The identity fields could look removed. They are TRANSIENT_ONLY, and persisting them is refused
 *     — including the case a future author is most likely to get wrong: nulling two fields and
 *     leaving `record_identity_key` as `tax:<14>`.
 *   · GATE-2's opaque names could look like a privacy approval. They are a structural fix; the
 *     privacy owner's confirmation is still outstanding and is asserted still outstanding.
 *   · GATE-6 could look approved because the code works. It is `ready_for_review`, blocked by the
 *     rule that the implementer of a subject may not approve it.
 *
 * Pure and synthetic: no network, no Supabase, no provider, no real Receita data, no benchmark. The
 * only filesystem touched is a temporary directory this suite creates for the cleanup fixtures, and
 * it is removed. 0 credits, 0 writes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildBrReceitaCnpjSnapshotRows } from '../br-receita-cnpj-snapshot-builder';
import { sampleParserInput } from '../br-receita-cnpj-fixtures';
import {
  BRAZIL_RECEITA_GATE3_PAYLOAD_KEY_DISPOSITION,
  BRAZIL_RECEITA_RB3_CLASSIFICATIONS,
  BRAZIL_RECEITA_RB3_CLASSIFICATION_AUTHORITY,
  BRAZIL_RECEITA_RB3_FIELD_CLASSIFICATIONS,
  BRAZIL_RECEITA_RB3_KEYS_KEPT_IN_PAYLOAD,
  BRAZIL_RECEITA_RB3_KEYS_REMOVED_FROM_PAYLOAD,
  BRAZIL_RECEITA_RB3_R5_ENFORCEMENT_POINT,
  brazilReceitaRb3IsClosedForPayload,
  findBrazilReceitaUnlabelledPayloadKeys,
} from '../br-receita-cnpj-gate3-residual-field-classification';
import {
  BRAZIL_RECEITA_GATE3_APPROVED,
  BRAZIL_RECEITA_GATE3_RESIDUAL_BLOCKERS,
  BRAZIL_RECEITA_GATE3_SINGLE_REMAINING_CRITERION,
  BRAZIL_RECEITA_GATE3_STATUS,
} from '../br-receita-cnpj-gate3-recorded-field-policy';
import {
  BRAZIL_RECEITA_GATE4_CHOSEN_GRAIN,
  BRAZIL_RECEITA_GATE4_CONSTRAINT_COLLISION,
  BRAZIL_RECEITA_GATE4_DECIDED_PARTS,
  BRAZIL_RECEITA_GATE4_GRAIN_OPTIONS,
  BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS,
  BRAZIL_RECEITA_GATE4_PERIOD_MODEL,
  BRAZIL_RECEITA_GATE4_REPLACEMENT_SEMANTICS,
  BRAZIL_RECEITA_GATE4_REQUIRED_FUTURE_MIGRATION,
  BRAZIL_RECEITA_GATE4_RUNTIME_LOOKUP_FINDING,
  BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION,
  BRAZIL_RECEITA_GATE4_STATUS,
  BRAZIL_RECEITA_GATE4_SURROGATE_EVALUATION,
  BRAZIL_RECEITA_GATE4_YEAR_GRAIN_HAZARDS,
  BrazilReceitaGate4NonPersistableRowError,
  assertBrazilReceitaSnapshotRowIsPersistable,
  findBrazilReceitaSnapshotRowPersistabilityViolations,
} from '../br-receita-cnpj-gate4-recorded-identity-grain';
import {
  BRAZIL_RECEITA_GATE6_APPROVED,
  BRAZIL_RECEITA_GATE6_ARTIFACT_LIFECYCLES,
  BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION,
  BRAZIL_RECEITA_GATE6_STATUS,
  BRAZIL_RECEITA_GATE6_STATUS_DISPOSITION,
  BRAZIL_RECEITA_GATE6_SUCCESS_WITH_RESIDUE_PERMITTED,
  BRAZIL_RECEITA_GATE6_TERMINATING_PATHS,
} from '../br-receita-cnpj-gate6-recorded-cleanup-contract';
import {
  BrazilReceitaCleanupUnitClassRefusedError,
  createBrazilReceitaCleanupCoordinator,
  reduceBrazilReceitaCleanupUnitOutcomes,
  toBrazilReceitaGate6CleanupReport,
  type BrazilReceitaCleanupUnit,
  type BrazilReceitaCleanupUnitOutcome,
} from '../br-receita-cnpj-full-join-cleanup-coordinator';
import {
  brazilReceitaPrivateArtifactCleanupUnit,
  brazilReceitaPrivateArtifactTtlPurgeUnit,
  brazilReceitaWorkspaceCleanupUnit,
} from '../br-receita-cnpj-full-join-cleanup-units';
import {
  BRAZIL_RECEITA_FULL_JOIN_PARTITION_FILE_PATTERN,
  BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED,
  createBrazilReceitaFullJoinPartitionLabelAllocator,
  createBrazilReceitaFullJoinRandomPartitionLabelSource,
} from '../br-receita-cnpj-full-join-partition-workspace';
import {
  BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION,
  BRAZIL_RECEITA_GATE2_APPROVED_CAPS,
  BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT,
  BRAZIL_RECEITA_GATE2_STATUS,
} from '../br-receita-cnpj-gate2-recorded-owner-decision';
import { SOURCE_FAMILY_BY_SOURCE_KEY } from '../../../record-identity/source-family-registry';
import { BR_RECEITA_CNPJ_SOURCE_KEY } from '../br-receita-cnpj-types';
import type { BrazilReceitaFullJoinPrivateChannelFileSystem } from '../br-receita-cnpj-full-join-operator-metric-channel';

// ─── Static-guard helpers ─────────────────────────────────────────────────────

/**
 * Removes comments so a scan asserts what a module DOES rather than what its prose says.
 *
 * 🔴 This is not a convenience. Every one of this suite's static guards below failed on its first
 * run against the RAW source, and in every case the "violation" was the module's own documentation
 * saying it does NOT do the thing — `never recursively delete`, `NOT enforced as unique`,
 * `empresas-part-00001.refs was removed`. A raw scan cannot tell naming something in code from
 * quoting it in prose, and it flags the very sentence that promises the safety.
 */
function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Reads a sibling connector module with its comments stripped. */
function connectorCode(relativePath: string): string {
  return codeWithoutComments(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

/** Strips `--` line comments from SQL, for the same reason. */
function sqlWithoutComments(source: string): string {
  return source.replace(/^\s*--.*$/gm, '');
}

// ─── GATE-3 · RB-3 ────────────────────────────────────────────────────────────

describe('GATE-ROUND-2 · GATE-3 RB-3 is closed, and closed by labelling rather than deleting', () => {
  it('every RB-3 field carries exactly one of the four dispositions', () => {
    assert.equal(BRAZIL_RECEITA_RB3_FIELD_CLASSIFICATIONS.length, 6);
    for (const entry of BRAZIL_RECEITA_RB3_FIELD_CLASSIFICATIONS) {
      assert.ok(
        BRAZIL_RECEITA_RB3_CLASSIFICATIONS.includes(entry.classification),
        `${entry.field} carries an unrecognized classification`,
      );
      assert.ok(entry.reason.length > 40, `${entry.field} needs a real reason, not a label`);
    }
    // No field may be labelled twice, which would be "labelled" in name only.
    const fields = BRAZIL_RECEITA_RB3_FIELD_CLASSIFICATIONS.map((entry) => entry.field);
    assert.equal(new Set(fields).size, fields.length);
  });

  it('🔴 the R5 enforcement point is the CLASSIFIER, not the payload flag — checked in the source', () => {
    assert.equal(BRAZIL_RECEITA_RB3_R5_ENFORCEMENT_POINT.readsSnapshotPayload, false);

    // Asserted against the real module rather than against this record's claim about it: the whole
    // reason RB-3 could be closed is that the control lives somewhere the payload cannot reach.
    const classifier = connectorCode('../br-receita-cnpj-privacy-safe-classifier.ts');
    assert.match(classifier, /classifyLegalNatureRiskClass/);
    assert.match(classifier, /mei_or_individual_entrepreneur_signal/);
    assert.match(classifier, /excluded_person_or_pii_risk/);
    // And it must NOT have grown a dependency on the snapshot payload.
    assert.equal(classifier.includes('raw_data.mei_flag'), false);
  });

  it('🔴 the control signals survive on the real builder, and the count still works', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.ok(result.snapshots.length > 0);
    assert.equal(result.internalControlSignals.length, result.snapshots.length);

    // Every removed key is gone from the payload…
    for (const snapshot of result.snapshots) {
      for (const removed of BRAZIL_RECEITA_RB3_KEYS_REMOVED_FROM_PAYLOAD) {
        assert.equal(
          removed in (snapshot.raw_data as unknown as Record<string, unknown>),
          false,
          `${removed} must not be in the persisted payload`,
        );
      }
      for (const kept of BRAZIL_RECEITA_RB3_KEYS_KEPT_IN_PAYLOAD) {
        assert.ok(
          kept in (snapshot.raw_data as unknown as Record<string, unknown>),
          `${kept} must stay in the persisted payload`,
        );
      }
    }

    // …and every one of them is still computed, so nothing was weakened by deletion.
    for (const signals of result.internalControlSignals) {
      assert.equal(typeof signals.mei_flag, 'boolean');
      assert.ok('legal_nature_code' in signals);
      assert.ok('legal_nature_label' in signals);
      assert.ok('simples_opt_in' in signals);
      assert.ok('simei_opt_in' in signals);
    }

    assert.equal(
      result.summary.meiFlaggedRows,
      result.internalControlSignals.filter((entry) => entry.mei_flag).length,
      'the count that was mei_flag’s only real consumer must still be correct',
    );
    assert.ok(result.summary.meiFlaggedRows > 0, 'and the fixture must actually exercise it');
  });

  it('🔴 the control signals are NOT reachable from a row — non-persistence is structural', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    for (const snapshot of result.snapshots) {
      const row = snapshot as unknown as Record<string, unknown>;
      assert.equal('internalControlSignals' in row, false);
      assert.equal('mei_flag' in row, false);
      assert.equal('legal_nature_code' in row, false);
    }
    // Correlation is by source_row_index and nothing else.
    for (const signals of result.internalControlSignals) {
      assert.equal(typeof signals.source_row_index, 'number');
    }
  });

  it('🔴 "nothing unlabelled" is now MECHANICAL, over the real emitted payload', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    for (const snapshot of result.snapshots) {
      const keys = Object.keys(snapshot.raw_data);
      const findings = findBrazilReceitaUnlabelledPayloadKeys(keys);
      assert.deepEqual(findings, [], `unlabelled or forbidden keys: ${JSON.stringify(findings)}`);
      assert.equal(brazilReceitaRb3IsClosedForPayload(keys), true);
    }
  });

  it('the completeness check catches BOTH failure modes, not just the missing label', () => {
    // A brand-new key nobody labelled.
    assert.deepEqual(findBrazilReceitaUnlabelledPayloadKeys(['some_new_signal']), [
      { key: 'some_new_signal', problem: 'unlabelled' },
    ]);
    // A key that WAS labelled non-output and is being emitted anyway. This is the regression that
    // would otherwise pass silently, because the key is "known".
    assert.deepEqual(findBrazilReceitaUnlabelledPayloadKeys(['mei_flag']), [
      { key: 'mei_flag', problem: 'labelled_but_must_not_be_emitted' },
    ]);
    assert.equal(brazilReceitaRb3IsClosedForPayload(['mei_flag']), false);
  });

  it('the disposition map covers only real payload keys, and matrix_branch_flag is the kept one', () => {
    assert.ok('matrix_branch_flag' in BRAZIL_RECEITA_GATE3_PAYLOAD_KEY_DISPOSITION);
    assert.deepEqual([...BRAZIL_RECEITA_RB3_KEYS_KEPT_IN_PAYLOAD], ['matrix_branch_flag']);
    assert.equal(BRAZIL_RECEITA_RB3_KEYS_REMOVED_FROM_PAYLOAD.length, 5);
  });

  it('🔴 the classification carries the product/data authority and NO privacy determination', () => {
    assert.equal(BRAZIL_RECEITA_RB3_CLASSIFICATION_AUTHORITY.decidedBy, 'product_data_owner');
    assert.equal(
      BRAZIL_RECEITA_RB3_CLASSIFICATION_AUTHORITY.legalPrivacyDeterminationRecorded,
      false,
    );
    assert.equal(BRAZIL_RECEITA_RB3_CLASSIFICATION_AUTHORITY.decidedByAgent, false);
  });
});

describe('GATE-ROUND-2 · GATE-3 advances to ready_for_review, then to approved (BR-SOURCE-FAST-TRACK-7)', () => {
  it('the status is approved — the legal/privacy half was recorded 2026-08-24', () => {
    assert.equal(BRAZIL_RECEITA_GATE3_STATUS, 'approved');
    assert.equal(BRAZIL_RECEITA_GATE3_APPROVED, true);
  });

  it('🔴 the joint approval criterion is now discharged; both halves are recorded and no agent supplied either', () => {
    assert.equal(BRAZIL_RECEITA_GATE3_SINGLE_REMAINING_CRITERION.productDataHalfRecorded, true);
    assert.equal(BRAZIL_RECEITA_GATE3_SINGLE_REMAINING_CRITERION.legalPrivacyHalfRecorded, true);
    assert.equal(BRAZIL_RECEITA_GATE3_SINGLE_REMAINING_CRITERION.agentMayApprove, false);
    assert.equal(
      BRAZIL_RECEITA_GATE3_SINGLE_REMAINING_CRITERION.coveredByTheGate1Determination,
      false,
      'the GATE-1 determination must not be read as covering the field allowlist',
    );
  });

  it('both residual blockers are resolved, and both stay enumerated for the audit trail', () => {
    assert.equal(BRAZIL_RECEITA_GATE3_RESIDUAL_BLOCKERS.length, 2);
    for (const blocker of BRAZIL_RECEITA_GATE3_RESIDUAL_BLOCKERS) {
      assert.equal(blocker.resolvedByThisWorkstream, true, blocker.id);
    }
  });
});

// ─── GATE-4 ───────────────────────────────────────────────────────────────────

describe('GATE-ROUND-2 · GATE-4 records the grain and refuses to record the identity', () => {
  it('exactly one grain option is chosen, and the other three are rejected ON THE RECORD', () => {
    const entries = Object.values(BRAZIL_RECEITA_GATE4_GRAIN_OPTIONS);
    assert.equal(entries.filter((option) => option.chosen).length, 1, 'exactly one option');
    assert.equal(BRAZIL_RECEITA_GATE4_CHOSEN_GRAIN, 'option_d');
    for (const option of entries) {
      if (option.chosen) {
        assert.equal(option.rejectedBecause, null);
      } else {
        assert.ok(
          option.rejectedBecause !== null && option.rejectedBecause.length > 40,
          `${option.label} needs a documented rejection, not an assertion`,
        );
      }
    }
  });

  it('🔴 the gate is approved (BR-SOURCE-FAST-TRACK-7, via 4A/4B/4C), with the grain owner-approved and the runtime lookup still a recorded blocker', () => {
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

  it('🔴 the constraint collision is recorded and is not resolvable by an agent', () => {
    assert.equal(BRAZIL_RECEITA_GATE4_CONSTRAINT_COLLISION.resolvableByAgent, false);
    assert.match(BRAZIL_RECEITA_GATE4_CONSTRAINT_COLLISION.constraintOne, /R4/);
    assert.match(BRAZIL_RECEITA_GATE4_CONSTRAINT_COLLISION.constraintTwo, /DETERMINISTIC/);
  });

  it('🔴 exactly ONE question, addressed to legal/privacy, ANSWERED YES by owner relay (BR-SOURCE-FAST-TRACK-7)', () => {
    assert.equal(BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION.askedOf, 'LEGAL_PRIVACY_OWNER');
    assert.notEqual(BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION.answeredBy, null);
    assert.equal(BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION.answer, 'yes');
    assert.equal(BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION.agentMayAnswer, false);
    // Both branches must be spelled out: a question whose "no" has no stated consequence is a
    // question nobody has to answer.
    assert.ok(BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION.ifYes.length > 40);
    assert.ok(BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION.ifNo.length > 40);
  });

  it('🔴 no derived surrogate is admissible, and the non-derived one is not sufficient either', () => {
    const admissible = BRAZIL_RECEITA_GATE4_SURROGATE_EVALUATION.filter((entry) => entry.admissible);
    assert.equal(admissible.length, 1, 'only the non-derived surrogate may be admissible');
    assert.match(admissible[0].candidate, /not derived from the CNPJ/);
    assert.ok(
      'butInsufficientBecause' in admissible[0],
      'the admissible surrogate must still be recorded as insufficient on its own',
    );

    for (const entry of BRAZIL_RECEITA_GATE4_SURROGATE_EVALUATION) {
      if (/hash|truncation|fingerprint|base64/i.test(entry.candidate)) {
        assert.equal(entry.admissible, false, `${entry.candidate} must be refused`);
      }
    }
  });

  it('🔴 no surrogate GENERATOR is implemented — a key nobody approved may not be built', () => {
    const source = connectorCode('../br-receita-cnpj-gate4-recorded-identity-grain.ts');
    // No entropy, no hashing, no key construction of any kind in the GATE-4 record.
    for (const forbidden of [
      'randomUUID',
      'randomBytes',
      'createHash',
      'node:crypto',
      'buildRecordIdentityKey',
      'deriveTaxRecordIdentity',
    ]) {
      assert.equal(source.includes(forbidden), false, `GATE-4 must not reach for ${forbidden}`);
    }
  });
});

describe('GATE-ROUND-2 · GATE-4 makes persisting prohibited identity material impossible', () => {
  // 🔴 BR-SOURCE-FUNCTIONAL-CUT-A — a "clean" row is no longer an EMPTY row. Since 4A's exception
  // was exercised the guard also REQUIRES the one representation it permits and a valid period, so
  // a fully-cleared row is now refused for the opposite reason: it has no identity at all.
  const CLEAN_CNPJ = '11222333000181';
  const cleanRow = {
    tax_id: '',
    normalized_tax_id: CLEAN_CNPJ,
    record_identity_key: '',
    source_period: '2026-07',
  } as never;

  it('🔴 exactly ONE identity field is persistable; the other two stay refused under GATE-1 R4', () => {
    // BR-SOURCE-FUNCTIONAL-CUT-A. Round 2 recorded all three as TRANSIENT_ONLY because the single
    // unresolved owner question was still open. FAST-TRACK-7 answered it (4A), and CUT A exercised
    // the exception in `normalized_tax_id`. The other two are SECOND representations of the same
    // identifier, which is exactly why they did not move.
    assert.equal(BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS.length, 3);

    const byField = new Map(
      BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS.map((entry) => [entry.field, entry]),
    );

    for (const field of ['tax_id', 'record_identity_key'] as const) {
      const entry = byField.get(field);
      assert.ok(entry, field);
      assert.equal(entry.persistence, 'TRANSIENT_ONLY', field);
      assert.equal(entry.owner, 'GATE_1_R4_LEGAL_PRIVACY', field);
    }

    const permitted = byField.get('normalized_tax_id');
    assert.ok(permitted);
    assert.equal(permitted.persistence, 'PERSISTED');
    // 🔴 The owner MOVED with the disposition. GATE-1 R4 no longer owns this field's persistence —
    // the enumerated 4A exception does — and recording it any other way would attribute a
    // legal/privacy decision to the wrong gate.
    assert.equal(permitted.owner, 'GATE_4A_EXCEPTION_EXERCISED_BY_FUNCTIONAL_CUT_A');
  });

  // 🔴 STILL TRUE after CUT A, and load-bearing. The parser's in-memory row carries all THREE
  // representations because it needs them for duplicate detection, so the RAW row remains
  // unpersistable. Only `toBrReceitaPersistedSnapshot`'s projection — which structurally cannot
  // carry the other two — is persistable. Weakening this test would have been the actual regression.
  it('🔴 the real builder produces rows that are REFUSED at a persistence boundary', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    for (const snapshot of result.snapshots) {
      assert.throws(
        () => assertBrazilReceitaSnapshotRowIsPersistable(snapshot),
        BrazilReceitaGate4NonPersistableRowError,
      );
    }
  });

  it('🔴 nulling the two tax fields does NOT make a tax-namespaced key clean', () => {
    // The mistake a future author is most likely to make: clear the obvious fields, keep the key.
    // The identity and period are VALID here on purpose: the only thing wrong with this row is the
    // namespaced duplicate, so a single violation proves the key is caught on its own merits.
    const violations = findBrazilReceitaSnapshotRowPersistabilityViolations({
      tax_id: '',
      normalized_tax_id: CLEAN_CNPJ,
      record_identity_key: 'tax:11222333000181' as never,
      source_period: '2026-07',
    });
    assert.equal(violations.length, 1);
    assert.deepEqual(violations[0], {
      field: 'record_identity_key',
      violation: 'prohibited_identity_namespace',
    });
    // Case does not rescue it either.
    assert.equal(
      findBrazilReceitaSnapshotRowPersistabilityViolations({
        tax_id: '',
        normalized_tax_id: CLEAN_CNPJ,
        record_identity_key: 'TAX:11222333000181' as never,
        source_period: '2026-07',
      })[0].violation,
      'prohibited_identity_namespace',
    );
  });

  it('a non-tax key is still refused today — but as TRANSIENT_ONLY, a different fact', () => {
    const violations = findBrazilReceitaSnapshotRowPersistabilityViolations({
      tax_id: '',
      normalized_tax_id: CLEAN_CNPJ,
      record_identity_key: 'br_receita_establishment:opaque' as never,
      source_period: '2026-07',
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].violation, 'transient_only_field_present');
  });

  it('a row with the ONE identity and a valid period passes, so the guard is not vacuously true', () => {
    assert.deepEqual(findBrazilReceitaSnapshotRowPersistabilityViolations(cleanRow), []);
    assert.doesNotThrow(() => assertBrazilReceitaSnapshotRowIsPersistable(cleanRow));

    // 🔴 And the inverse, which is the half CUT A added: an EMPTY row no longer passes. Before this
    // cut it did, and a Brazil row with a NULL identity is exactly what the vacuous
    // `NULLS DISTINCT` uniqueness accepted without limit.
    assert.throws(
      () =>
        assertBrazilReceitaSnapshotRowIsPersistable({
          tax_id: '',
          normalized_tax_id: '',
          record_identity_key: '',
          source_period: '',
        } as never),
      BrazilReceitaGate4NonPersistableRowError,
    );
  });

  it('🔴 the guard has no flag, no override and no allow parameter', () => {
    assert.equal(assertBrazilReceitaSnapshotRowIsPersistable.length, 1);
    const source = connectorCode('../br-receita-cnpj-gate4-recorded-identity-grain.ts');
    // Real identifiers, not English words: `force` alone matches `enforced`, which is what the
    // guard is FOR rather than against.
    for (const forbidden of [
      'allowPersist',
      'force:',
      'force =',
      'override',
      'process.env',
      'skipGuard',
    ]) {
      assert.equal(source.includes(forbidden), false, `no ${forbidden} escape hatch`);
    }
  });

  it('🔴 this source stays UNREGISTERED, so the family registry keeps throwing for it', () => {
    assert.equal(BR_RECEITA_CNPJ_SOURCE_KEY in SOURCE_FAMILY_BY_SOURCE_KEY, false);
    assert.equal('br_receita_cnpj' in SOURCE_FAMILY_BY_SOURCE_KEY, false);
    assert.equal('br_receita_dados_abertos' in SOURCE_FAMILY_BY_SOURCE_KEY, false);
  });
});

describe('GATE-ROUND-2 · GATE-4 monthly identity and the runtime lookup blocker', () => {
  it('🔴 the runtime lookup outcome is C — no compliant mechanism exists', () => {
    assert.equal(
      BRAZIL_RECEITA_GATE4_RUNTIME_LOOKUP_FINDING.outcome,
      'C_NO_COMPLIANT_LOOKUP_MECHANISM_EXISTS',
    );
    assert.equal(BRAZIL_RECEITA_GATE4_RUNTIME_LOOKUP_FINDING.isProductizationBlocker, true);
    assert.deepEqual([...BRAZIL_RECEITA_GATE4_RUNTIME_LOOKUP_FINDING.brazilCanSupply], []);
    assert.match(
      BRAZIL_RECEITA_GATE4_RUNTIME_LOOKUP_FINDING.fuzzyNameLookupConsidered,
      /rejected/,
    );
  });

  it('🔴 asserted against the REAL read contract: every primitive needs a blocked entry point', () => {
    const contract = connectorCode('../../../snapshot-read/snapshot-read-contract.ts');
    // The five lookups that exist. Each takes normalizedTaxId or a caller-known record identity key,
    // and Brazil can supply neither — which is the blocker, verified rather than asserted.
    for (const primitive of [
      'readSnapshotByRecordIdentityKey',
      'readTaxGrainSnapshotByTaxId',
      'readLatestTaxGrainSnapshotByTaxId',
      'probeNativeSnapshotsByTaxId',
      'probeLatestNativeSnapshotsByTaxId',
    ]) {
      assert.match(contract, new RegExp(`export async function ${primitive}`), primitive);
    }
    // And there is no name-based lookup to fall back to.
    assert.equal(/normalizedLegalName|legalNameLookup|byName/.test(contract), false);

    // The shared identity module forbids the `name` namespace globally, in code.
    const identityKey = connectorCode('../../../record-identity/record-identity-key.ts');
    assert.match(identityKey, /FORBIDDEN_NAMESPACE = 'name'/);
  });

  it('🔴 monthly grain is unsupported by the real schema, and both hazards are recorded', () => {
    assert.equal(BRAZIL_RECEITA_GATE4_PERIOD_MODEL.publicationCadence, 'monthly');
    assert.equal(BRAZIL_RECEITA_GATE4_PERIOD_MODEL.schemaSupportsMonthlyToday, false);
    assert.equal(BRAZIL_RECEITA_GATE4_PERIOD_MODEL.sourcePeriodColumnExists, false);
    assert.equal(BRAZIL_RECEITA_GATE4_PERIOD_MODEL.recordIdentityKeyIsUnique, false);

    assert.equal(BRAZIL_RECEITA_GATE4_YEAR_GRAIN_HAZARDS.length, 2);
    const ids = BRAZIL_RECEITA_GATE4_YEAR_GRAIN_HAZARDS.map((entry) => entry.id);
    assert.deepEqual([...ids], ['YH-1', 'YH-2']);
  });

  it('🔴 asserted against the REAL migrations: no source_period, year-grained uniqueness', () => {
    const migrationsDir = new URL('../../../../../../supabase/migrations/', import.meta.url);
    const m065 = sqlWithoutComments(
      fs.readFileSync(new URL('065_create_source_snapshot_tables.sql', migrationsDir), 'utf8'),
    );
    assert.match(m065, /UNIQUE \(source_key, country_code, source_year, normalized_tax_id\)/);
    assert.equal(m065.includes('source_period'), false, 'there is no source_period column');

    // Comments stripped: 087's own header says the column is "NOT enforced as unique", and a raw
    // scan would read that promise as the violation it rules out.
    const m087 = sqlWithoutComments(
      fs.readFileSync(
        new URL('087_add_record_identity_key_to_source_company_snapshots.sql', migrationsDir),
        'utf8',
      ),
    );
    assert.match(m087, /ADD COLUMN record_identity_key text NULL/);
    assert.equal(/UNIQUE/i.test(m087), false, 'record_identity_key was never made unique');
  });

  it('🔴 the required migration is recorded as TEXT and is NOT authored or authorized', () => {
    assert.equal(BRAZIL_RECEITA_GATE4_REQUIRED_FUTURE_MIGRATION.authorizedNow, false);
    assert.equal(BRAZIL_RECEITA_GATE4_REQUIRED_FUTURE_MIGRATION.authoredInThisRound, false);
    assert.equal(BRAZIL_RECEITA_GATE4_REQUIRED_FUTURE_MIGRATION.statements.length, 3);
    assert.match(
      BRAZIL_RECEITA_GATE4_REQUIRED_FUTURE_MIGRATION.statements[0],
      /ADD COLUMN source_period text NULL/,
    );

    // The ceiling moves whenever an AUTHORIZED milestone adds its own migration; what this guard
    // defends is WHO authored what, never the number alone.
    //
    // 🔴 BR-SOURCE-FUNCTIONAL-CUT-A authored 125, which is the migration the record above described
    // as text. Round 2 still authored none, and `authoredInThisRound` above stays false — the two
    // statements are about different rounds. 124 belongs to Agent 2A and must still not be BR.
    //
    // 🔴 Renamed TWICE by BR-SOURCE CUT A.1 (production schema reconciliation before CUT B):
    // 125→126→127. The first move made room for a sibling generic reconciliation migration — NOT
    // authored by any BR round, and NOT touching the BR-specific columns/constraints this guard
    // cares about — at the 125 slot. The second was forced by
    // AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY (Agent 1), which independently claimed 126 —
    // optimistic fencing of batch-identity admission — while this reconciliation was still in
    // review. CUT A still adds EXACTLY one migration, and that claim is what this guard defends;
    // the migration this guard defends is now 127. The authorship sweep is WIDENED to 124 and 126,
    // so the guard is stronger than before, not merely shifted.
    const files = fs.readdirSync(
      new URL('../../../../../../supabase/migrations/', import.meta.url),
    );
    const highest = files
      .map((name) => Number.parseInt(name.slice(0, 3), 10))
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => Math.max(max, value), 0);
    // 🔴 The ceiling moved again, and NOT by a BR round: AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-
    // PHONE-REVEAL-1 independently claimed 128 (projection of an already-approved candidate's
    // phone collection onto its own official contact). CUT A still adds EXACTLY one migration and
    // it is still 127; what this line pins is the repository ceiling, kept EXACT so an undeclared
    // migration above the last known milestone breaks the guard. The authorship sweep below is
    // WIDENED to 128, so the guard is stronger than before rather than merely shifted.
    // 🔴 The ceiling moved again, and NOT by a BR round either:
    // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 canonicalized Agent 2's HubSpot sync chain to
    // 129/130/131/132 — four files that were deliberately unnumbered while the 125/126/127
    // dispute was open upstream. CUT A still adds EXACTLY one migration and it is still 127; what
    // this line pins is the repository ceiling, kept EXACT so an undeclared migration above the
    // last known milestone breaks the guard. The authorship sweep below is WIDENED to all four,
    // so the guard is stronger than before rather than merely shifted.
    // 🔴 BR-PRODUCTION-RELEASE moved the ceiling AGAIN, and this time it IS a BR migration:
    // BR-SOURCE CUT D's fenced fiscal-identity promotion, numbered 133 when that work returned to
    // GitHub. The old message ("…and it is not a BR migration") stops being true here, so it is
    // CORRECTED rather than kept: what this line pins is the repository ceiling, kept EXACT so an
    // undeclared migration above the last known milestone still breaks the guard. What GATE
    // ROUND 2 actually defends is unchanged and asserted right below — CUT A still adds EXACTLY
    // one migration and it is still 127 — and the authorship sweep further down still refuses
    // BR authorship for every NON-BR slot, 133 excluded from it precisely because it IS BR.
    // 🔴 BR-COMPACT-SNAPSHOT-PRODUCTIZATION moves the ceiling to 134, and it is BR again: the
    // dedicated compact national snapshot table. Same reasoning as every prior move — what this
    // line pins is the repository CEILING, kept EXACT so an undeclared migration above the last
    // known milestone still breaks the guard. CUT D keeps owning exactly one migration and it is
    // still 133; it simply is not the top any more, which is asserted rather than assumed.
    assert.deepEqual(
      files.filter((f) => f.startsWith('134')),
      ['134_br_receita_compact_snapshot.sql'],
      'BR-COMPACT-SNAPSHOT-PRODUCTIZATION owns exactly one migration',
    );
    // AGENT1-LUSHA-CUT-L3 then moved the ceiling to 135 — renumbered from 134 on serial
    // integration, since BR-COMPACT-SNAPSHOT-PRODUCTIZATION reached main first with that number —
    // with the durable pre-send fence for one Lusha Company Prospecting request. It is an Agent-1
    // spend-safety migration, not a BR one; the authorship sweep further down still refuses BR
    // authorship for it. What GATE ROUND 2 defends is unchanged and asserted right below — CUT A
    // still adds EXACTLY one migration and it is still 127.
    // AGENT1-LUSHA-CUT-L4 then moved the ceiling to 136 with the durable ATTEMPT history for a
    // Lusha Company Prospecting request and the atomic claim of ONE safe retry (only after a 429
    // or a 5xx, which the provider's HUMAN contract declares to be 0 credits). Like the 135, it
    // is an Agent-1 spend-safety migration, not a BR one; the authorship sweep further down still
    // refuses BR authorship for it. What GATE ROUND 2 defends is unchanged and asserted right
    // below — CUT A still adds EXACTLY one migration and it is still 127.
    // AGENT1-WIZARD-BUDGET-ADMIN-F1B then moved the ceiling to 137 with the ADMINISTRATIVE
    // surface of the Wizard budget: `wizard_monthly_budget_periods.updated_by`, the append-only
    // `wizard_budget_period_changes` log, and two functions that write the value and the log
    // entry in one transaction. Like the 135 and the 136, it is an Agent-1 spend migration, not
    // a BR one; the authorship sweep further down is WIDENED to include it rather than merely
    // shifted, so it still refuses BR authorship for it. What GATE ROUND 2 defends is unchanged
    // and asserted right below — CUT A still adds EXACTLY one migration and it is still 127.
    // AGENT1-DISCARDED-PROSPECTS-REVIEW-1 then moved the ceiling to 138 with the durable
    // disposition of a discarded prospect, for "Descartadas" (issue #389). Like the 135/136/137,
    // it is not a BR migration; the authorship sweep further down is WIDENED to include it.
    assert.equal(highest, 138, 'the repository ceiling is 138 — AGENT1-DISCARDED-PROSPECTS-REVIEW-1, not CUT A');
    assert.deepEqual(
      files.filter((f) => f.startsWith('135')),
      ['135_agent1_lusha_prospecting_request_fence.sql'],
      'AGENT1-LUSHA-CUT-L3 owns exactly one migration',
    );
    assert.deepEqual(
      files.filter((f) => f.startsWith('136')),
      ['136_agent1_lusha_prospecting_safe_retry_attempts.sql'],
      'AGENT1-LUSHA-CUT-L4 owns exactly one migration',
    );
    assert.deepEqual(
      files.filter((f) => f.startsWith('137')),
      ['137_wizard_budget_period_admin_audit.sql'],
      'AGENT1-WIZARD-BUDGET-ADMIN-F1B owns exactly one migration',
    );
    assert.deepEqual(
      files.filter((f) => f.startsWith('138')),
      ['138_prospect_discarded_dispositions.sql'],
      'AGENT1-DISCARDED-PROSPECTS-REVIEW-1 owns exactly one migration, and it is the ceiling',
    );
    assert.deepEqual(
      files.filter((f) => f.startsWith('133')),
      ['133_br_candidate_identity_promotion.sql'],
      'BR-SOURCE CUT D still owns exactly one migration',
    );
    assert.equal(
      files.filter((f) => f.startsWith('127')).length,
      1,
      'CUT A still adds EXACTLY one migration',
    );
    assert.equal(
      files.filter((f) => f.startsWith('125')).length,
      1,
      'the generic reconciliation still owns exactly one migration',
    );
    assert.equal(
      files.filter((f) => f.startsWith('126')).length,
      1,
      'AGENT1-CUT3B4 still owns exactly one migration',
    );

    assert.equal(
      files.filter((f) => f.startsWith('128')).length,
      1,
      'AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 owns exactly one migration',
    );
    for (const agent2 of ['129', '130', '131', '132']) {
      assert.equal(
        files.filter((f) => f.startsWith(agent2)).length,
        1,
        `AGENT2-FINAL-INTEGRATION owns exactly one ${agent2} migration`,
      );
    }
    for (const name of files.filter((f) =>
      // 135, 136, 137 and 138 join the sweep: all four are Agent-1 spend/discard migrations, and
      // none of them may be authored by a BR round. Asserting it is cheaper than trusting the
      // comment above, and the sweep GROWS with each new ceiling instead of moving off the
      // previous one.
      ['124', '126', '128', '129', '130', '131', '132', '135', '136', '137', '138'].some((n) =>
        f.startsWith(n),
      ),
    )) {
      const sql = fs.readFileSync(
        new URL(`../../../../../../supabase/migrations/${name}`, import.meta.url),
        'utf8',
      );
      assert.equal(
        /BR-SOURCE|RECEITA|CNPJ/i.test(sql),
        false,
        `${name} must not be authored by a BR round`,
      );
    }

    // The sibling reconciliation migration (125) belongs to BR-SOURCE CUT A.1 — a real BR-SOURCE
    // milestone, so its own name and the BR source_key exemption literal legitimately appear in
    // the file — but it is NOT a "BR round" in the sense this guard defends: it is generic (every
    // source, not Brazil-specific), grants Brazil an EXEMPTION rather than a requirement, and does
    // not touch any of the Brazil-only columns/constraints this guard protects (source_period,
    // snapshot_run_id, the BR identity CHECK, the BR-only unique index).
    const m125 = fs.readFileSync(
      new URL(
        '../../../../../../supabase/migrations/125_reconcile_source_snapshot_record_identity.sql',
        import.meta.url,
      ),
      'utf8',
    );
    assert.equal(m125.includes('snapshot_run_id'), false);
    assert.equal(m125.includes('source_period'), false);
    // The ONLY Brazil-specific SQL clause in 125 is the exemption below, and it exempts Brazil
    // rather than imposing anything new on it.
    assert.match(m125, /source_key = 'br_receita_cnpj_dados_abertos'\s*\n\s*OR record_identity_key IS NOT NULL/);

    // The AGENT1-CUT3B4 migration is genuinely independent: it is not authored by any BR round
    // either, which is exactly what the sweep above already proved for 126.

    // And 127 IS the BR one, authored by CUT A and explicitly not applied.
    const m127 = fs.readFileSync(
      new URL('../../../../../../supabase/migrations/127_br_receita_monthly_snapshot_identity.sql', import.meta.url),
      'utf8',
    );
    assert.match(m127, /BR-SOURCE-FUNCTIONAL-CUT-A/);
    assert.match(m127, /IT IS NOT APPLIED BY CUT A/);
  });

  it('replacement is period-scoped, and cross-month overwrite is forbidden', () => {
    assert.equal(BRAZIL_RECEITA_GATE4_REPLACEMENT_SEMANTICS.crossMonthOverwritePermitted, false);
    assert.equal(BRAZIL_RECEITA_GATE4_REPLACEMENT_SEMANTICS.partialMonthVisible, false);
    assert.equal(
      BRAZIL_RECEITA_GATE4_REPLACEMENT_SEMANTICS.publicationPeriodIsTheUnitOfReplacement,
      true,
    );
    assert.equal(BRAZIL_RECEITA_GATE4_REPLACEMENT_SEMANTICS.atomicPublishImplementedHere, false);
  });
});

// ─── GATE-2 · opaque temp names ───────────────────────────────────────────────

describe('GATE-ROUND-2 · GATE-2 temp file names no longer carry the bucket ordinal', () => {
  it('🔴 the file pattern carries no family and no ordinal, and rejects the old scheme', () => {
    const label = createBrazilReceitaFullJoinRandomPartitionLabelSource()();
    assert.match(label, /^[0-9a-f]{32}$/);
    assert.ok(BRAZIL_RECEITA_FULL_JOIN_PARTITION_FILE_PATTERN.test(`brfj-${label}.refs`));

    for (const oldName of [
      'empresas-part-00001.refs',
      'estabelecimentos-part-00042.refs',
      'brfj-00000000000000000000000000000007.refs'.replace('brfj-', 'part-7-'),
    ]) {
      assert.equal(
        BRAZIL_RECEITA_FULL_JOIN_PARTITION_FILE_PATTERN.test(oldName),
        false,
        `${oldName} must not be recognized`,
      );
    }
  });

  it('🔴 the source module names no ordinal-derived file pattern any more', () => {
    // Comments stripped: this module's own header EXPLAINS the old `empresas-part-00001.refs`
    // scheme it replaced, and a raw scan would flag that explanation.
    const source = connectorCode('../br-receita-cnpj-full-join-partition-workspace.ts');
    // The old regex, and the padding that built it, must both be gone from the module BODY.
    assert.equal(source.includes('PARTITION_ORDINAL_DIGITS'), false);
    assert.equal(source.includes('-part-'), false);
    // The mapping must not be written anywhere: no manifest, no sidecar, no log of it.
    assert.equal(/writeFile[^\n]*label/i.test(source), false);
  });

  it('labels are per-invocation: two allocators never agree', () => {
    const first = createBrazilReceitaFullJoinPartitionLabelAllocator(
      createBrazilReceitaFullJoinRandomPartitionLabelSource(),
    );
    const second = createBrazilReceitaFullJoinPartitionLabelAllocator(
      createBrazilReceitaFullJoinRandomPartitionLabelSource(),
    );
    assert.notEqual(first.resolve('empresas:0'), second.resolve('empresas:0'));
  });

  it('🔴 the structural fix alone did NOT manufacture the privacy owner confirmation — a later, separate owner relay did (BR-SOURCE-FAST-TRACK-7)', () => {
    // This is the assertion that keeps the round honest. The ordinal being off the disk did not, by
    // itself, supply the privacy owner's confirmation — GATE-2's own status stayed
    // needs_owner_confirmation through this round. It moved to approved only later, via the separate
    // BR-SOURCE-FAST-TRACK-7 owner relay recorded in its own confirmation object.
    assert.equal(BRAZIL_RECEITA_GATE2_STATUS, 'approved');
    assert.equal(
      BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION.attributedTo,
      'PRIVACY_OWNER_CONFIRMATION_REQUIRED',
    );
    assert.equal(BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION.attributedToAgent, false);
  });

  it('🔴 the GATE-2 owner caps are UNCHANGED and no cap was loosened', () => {
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

  it('🔴 the temporary-storage policy constant is still the tracked false', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED, false);
  });
});

// ─── GATE-6 ───────────────────────────────────────────────────────────────────

function outcome(
  partial: Partial<BrazilReceitaCleanupUnitOutcome>,
): BrazilReceitaCleanupUnitOutcome {
  return {
    verifiedAbsent: false,
    residualEntries: 0,
    deletionAttempted: true,
    ...partial,
  };
}

function unit(
  unitClass: BrazilReceitaCleanupUnit['unitClass'],
  destroy: () => BrazilReceitaCleanupUnitOutcome,
): BrazilReceitaCleanupUnit {
  return { unitClass, destroy };
}

describe('GATE-ROUND-2 · GATE-6 success path is verified deletion', () => {
  it('completed requires every unit verified absent with zero residue', () => {
    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(unit('partition_workspace', () => outcome({ verifiedAbsent: true })));
    coordinator.register(unit('private_metric_artifact', () => outcome({ verifiedAbsent: true })));

    const result = coordinator.runCleanup();
    assert.equal(result.status, 'completed');
    assert.equal(result.cleanupRequired, true);
    assert.equal(result.allUnitsVerifiedAbsent, true);
    assert.equal(result.unitsVerifiedAbsent, 2);
    assert.equal(result.residualEntriesTotal, 0);
    assert.deepEqual([...result.failureCodes], []);
    assert.equal(result.terminal, true);
  });

  it('nothing registered and nothing failed is not_needed, not completed', () => {
    const result = createBrazilReceitaCleanupCoordinator().runCleanup();
    assert.equal(result.status, 'not_needed');
    assert.equal(result.cleanupRequired, false);
  });

  it('a sanitizer or guard refusal makes cleanup required even with no units', () => {
    for (const reason of ['sanitizer_failed', 'guard_failed', 'run_error'] as const) {
      const coordinator = createBrazilReceitaCleanupCoordinator();
      coordinator.requireCleanup(reason);
      const result = coordinator.runCleanup();
      assert.equal(result.cleanupRequired, true, reason);
      // No units to delete, so there is nothing left behind: required and clean.
      assert.equal(result.status, 'completed', reason);
    }
  });
});

describe('GATE-ROUND-2 · GATE-6 failure paths cannot become success', () => {
  it('🔴 SUCCESS WITH RESIDUE IS UNREPRESENTABLE', () => {
    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(
      unit('partition_workspace', () => outcome({ verifiedAbsent: true, residualEntries: 3 })),
    );
    const result = coordinator.runCleanup();
    assert.equal(result.status, 'failed');
    assert.equal(result.allUnitsVerifiedAbsent, false);
    assert.equal(result.residualEntriesTotal, 3);
    assert.ok(result.failureCodes.includes('residual_entries_present'));
    // And the report bridge refuses to render it as a clean block.
    assert.equal(toBrazilReceitaGate6CleanupReport(result), null);
  });

  it('an unverified deletion is a DISTINCT failure, never a success', () => {
    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(unit('partition_workspace', () => outcome({ verifiedAbsent: false })));
    const result = coordinator.runCleanup();
    assert.equal(result.status, 'failed');
    assert.ok(result.failureCodes.includes('unit_deletion_unverified'));
    assert.equal(result.failureCodes.includes('unit_deletion_failed'), false);
  });

  it('a unit that could not attempt its deletion is a failure', () => {
    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(unit('partition_workspace', () => outcome({ deletionAttempted: false })));
    const result = coordinator.runCleanup();
    assert.equal(result.status, 'failed');
    assert.ok(result.failureCodes.includes('unit_deletion_failed'));
  });

  it('a unit that THROWS is a failure, not an exception that escapes', () => {
    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(
      unit('partition_workspace', () => {
        throw new Error('scripted destroy failure');
      }),
    );
    const result = coordinator.runCleanup();
    assert.equal(result.status, 'failed');
    assert.ok(result.failureCodes.includes('unit_destroy_threw'));
  });

  it('🔴 every unit is attempted even after one fails — no skipping a later step', () => {
    const attempted: string[] = [];
    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(
      unit('partition_workspace', () => {
        attempted.push('first');
        throw new Error('scripted');
      }),
    );
    coordinator.register(
      unit('private_metric_artifact', () => {
        attempted.push('second');
        return outcome({ verifiedAbsent: true });
      }),
    );
    coordinator.runCleanup();
    assert.deepEqual(attempted, ['first', 'second'], 'the second unit must still be attempted');
  });

  it('🔴 failed is TERMINAL: a retry cannot upgrade it', () => {
    let calls = 0;
    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(
      unit('partition_workspace', () => {
        calls += 1;
        // Would succeed on the second call — and must never get one.
        return outcome({ verifiedAbsent: calls > 1 });
      }),
    );
    assert.equal(coordinator.runCleanup().status, 'failed');
    assert.equal(coordinator.runCleanup().status, 'failed');
    assert.equal(calls, 1, 'a latched terminal result must not re-run a deletion');
  });

  it('🔴 not_executed when cleanup was required, and it is terminal', () => {
    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(unit('partition_workspace', () => outcome({ verifiedAbsent: true })));
    const result = coordinator.reportNotExecuted();
    assert.equal(result.status, 'not_executed');
    assert.equal(result.terminal, true);
    assert.ok(result.failureCodes.includes('cleanup_never_invoked'));
    // And it cannot be walked back into a run.
    assert.equal(coordinator.runCleanup().status, 'not_executed');
  });

  it('reportNotExecuted on a run that owed nothing is not_needed', () => {
    assert.equal(
      createBrazilReceitaCleanupCoordinator().reportNotExecuted().status,
      'not_needed',
    );
  });

  it('idempotence: a second runCleanup returns the same result and re-deletes nothing', () => {
    let calls = 0;
    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(
      unit('partition_workspace', () => {
        calls += 1;
        return outcome({ verifiedAbsent: true });
      }),
    );
    const first = coordinator.runCleanup();
    const second = coordinator.runCleanup();
    assert.deepEqual(first, second);
    assert.equal(calls, 1);
    assert.deepEqual(coordinator.lastResult(), first);
  });

  it('lastResult is null before cleanup runs, and performs no I/O', () => {
    assert.equal(createBrazilReceitaCleanupCoordinator().lastResult(), null);
  });

  it('the reduction is total: no arrangement of outcomes yields ok with a failure code', () => {
    const combinations: BrazilReceitaCleanupUnitOutcome[][] = [
      [outcome({ verifiedAbsent: true })],
      [outcome({ verifiedAbsent: true }), outcome({ verifiedAbsent: false })],
      [outcome({ verifiedAbsent: true, residualEntries: 1 })],
      [outcome({ deletionAttempted: false })],
      [],
    ];
    for (const combination of combinations) {
      const reduced = reduceBrazilReceitaCleanupUnitOutcomes(combination);
      assert.equal(reduced.ok, reduced.failureCodes.length === 0);
    }
  });
});

describe('GATE-ROUND-2 · GATE-6 boundaries and private artifacts', () => {
  it('🔴 snapshot output may NOT be registered as a cleanup subject', () => {
    const coordinator = createBrazilReceitaCleanupCoordinator();
    assert.throws(
      () =>
        coordinator.register({
          unitClass: 'snapshot_output' as never,
          destroy: () => outcome({ verifiedAbsent: true }),
        }),
      BrazilReceitaCleanupUnitClassRefusedError,
    );
  });

  it('🔴 the coordinator has no path parameter anywhere — it cannot be handed one', () => {
    // Comments stripped: the module's header promises it "never recursively delete[s] arbitrary
    // parent directories", and a raw scan reads that promise as a `recursive` violation.
    const source = connectorCode('../br-receita-cnpj-full-join-cleanup-coordinator.ts');
    assert.equal(source.includes("from 'node:fs'"), false);
    assert.equal(source.includes("from 'node:path'"), false);
    for (const forbidden of ['rmSync', 'unlinkSync', 'rmdirSync', 'recursive:', 'path.join']) {
      assert.equal(source.includes(forbidden), false, `no ${forbidden}`);
    }
  });

  it('the private artifact is a SEPARATE unit class with its own lifecycle owner', () => {
    // The class list and its lifecycle owners live in the coordinator; the GATE-6 record carries the
    // artifact lifecycles. Both are asserted, against the module that actually owns each.
    const coordinator = connectorCode('../br-receita-cnpj-full-join-cleanup-coordinator.ts');
    assert.match(coordinator, /private_metric_artifact/);
    assert.match(coordinator, /BR_SOURCE_14B0C_PRIVATE_CHANNEL_TTL/);

    const lifecycles = BRAZIL_RECEITA_GATE6_ARTIFACT_LIFECYCLES;
    const privateArtifact = lifecycles.find(
      (entry) => entry.artifactClass === 'private_metric_artifact',
    );
    const workspace = lifecycles.find((entry) => entry.artifactClass === 'partition_workspace');
    // The distinction § 16 asks to be kept: only one of them may outlive the process, and NEITHER
    // may outlive a completed cleanup.
    assert.equal(privateArtifact?.maySurviveProcess, true);
    assert.equal(workspace?.maySurviveProcess, false);
    for (const entry of lifecycles) {
      assert.equal(entry.maySurviveCompletedCleanup, false, entry.artifactClass);
    }
  });

  it('🔴 a live-TTL private artifact is still deleted by a RUN cleanup', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brfj-gate6-'));
    const file = path.join(directory, 'artifact.json');
    fs.writeFileSync(file, '{}', { mode: 0o600 });
    const port = realPrivateChannelPort();

    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(brazilReceitaPrivateArtifactCleanupUnit(file, port));
    const result = coordinator.runCleanup();

    assert.equal(result.status, 'completed');
    assert.equal(fs.existsSync(file), false, 'a live TTL is not a licence to survive cleanup');
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('a TTL purge leaves a live artifact alone, and reports no deletion', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brfj-gate6-'));
    const file = path.join(directory, 'artifact.json');
    fs.writeFileSync(file, '{}', { mode: 0o600 });
    const port = realPrivateChannelPort();

    const purge = brazilReceitaPrivateArtifactTtlPurgeUnit(file, 10_000, 5_000, port);
    const live = purge.destroy();
    assert.equal(live.deletionAttempted, false, 'a live artifact is not this unit’s business');
    assert.equal(fs.existsSync(file), true);

    const expired = brazilReceitaPrivateArtifactTtlPurgeUnit(file, 10_000, 20_000, port).destroy();
    assert.equal(expired.deletionAttempted, true);
    assert.equal(expired.verifiedAbsent, true);
    assert.equal(fs.existsSync(file), false);

    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('an already-absent artifact is verified absent, so cleanup after partial init works', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brfj-gate6-'));
    const neverCreated = path.join(directory, 'never-created.json');

    // Registered before creation, and the creation never happened. This is the partial-init case.
    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(
      brazilReceitaPrivateArtifactCleanupUnit(neverCreated, realPrivateChannelPort()),
    );
    assert.equal(coordinator.runCleanup().status, 'completed');

    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('🔴 an unlink that "succeeded" but left the file present is NOT verified', () => {
    const port: BrazilReceitaFullJoinPrivateChannelFileSystem = {
      ...realPrivateChannelPort(),
      // Reports success and does nothing — the exact shape of a claim without a check.
      unlink: () => undefined,
      exists: () => true,
    };
    const coordinator = createBrazilReceitaCleanupCoordinator();
    coordinator.register(brazilReceitaPrivateArtifactCleanupUnit('/nonexistent/x.json', port));
    const result = coordinator.runCleanup();
    assert.equal(result.status, 'failed');
    assert.ok(result.failureCodes.includes('unit_deletion_unverified'));
  });

  it('the workspace adapter preserves failed / unverified rather than flattening them', () => {
    for (const [workspaceOutcome, expectVerified] of [
      ['completed', true],
      ['not_needed', true],
      ['failed', false],
      ['unverified', false],
    ] as const) {
      const fake = {
        dispose: () => ({
          outcome: workspaceOutcome,
          filesReleased: 0,
          verifiedAbsent: workspaceOutcome === 'completed' || workspaceOutcome === 'not_needed',
          foreignEntriesLeftInPlace: 0,
        }),
      };
      const adapted = brazilReceitaWorkspaceCleanupUnit(fake as never).destroy();
      assert.equal(adapted.verifiedAbsent, expectVerified, workspaceOutcome);
      assert.equal(adapted.deletionAttempted, true, workspaceOutcome);
    }
  });

  it('the workspace adapter carries foreign entries through as residue', () => {
    const fake = {
      dispose: () => ({
        outcome: 'failed' as const,
        filesReleased: 1,
        verifiedAbsent: false,
        foreignEntriesLeftInPlace: 2,
      }),
    };
    assert.equal(brazilReceitaWorkspaceCleanupUnit(fake as never).destroy().residualEntries, 2);
  });
});

describe('GATE-ROUND-2 · GATE-6 record advances to ready_for_review, then approved (BR-SOURCE-FAST-TRACK-7)', () => {
  it('the status is approved — the joint technical + operator owner approval is recorded', () => {
    assert.equal(BRAZIL_RECEITA_GATE6_STATUS, 'approved');
    assert.equal(BRAZIL_RECEITA_GATE6_APPROVED, true);
  });

  it('🔴 the implementer rule stayed intact — the approval came from the owners, not from the implementer', () => {
    assert.equal(BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION.blockedByImplementerRule, true);
    assert.equal(BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION.agentMayApprove, false);
    assert.match(BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION.implementerRule, /10K § 3/);
    assert.equal(
      BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION.substantiveDecisionConfirmedAs,
      'delete_over_quarantine',
    );
  });

  it('all four statuses are terminal, and only two are success', () => {
    for (const [status, disposition] of Object.entries(BRAZIL_RECEITA_GATE6_STATUS_DISPOSITION)) {
      assert.equal(disposition.terminal, true, status);
    }
    assert.equal(BRAZIL_RECEITA_GATE6_STATUS_DISPOSITION.failed.success, false);
    assert.equal(BRAZIL_RECEITA_GATE6_STATUS_DISPOSITION.not_executed.success, false);
    assert.equal(BRAZIL_RECEITA_GATE6_SUCCESS_WITH_RESIDUE_PERMITTED, false);
  });

  it('the recorded contract matches the GATE-2 cleanup contract rather than restating it loosely', () => {
    assert.equal(BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT.successWithResiduePermitted, false);
    assert.equal(BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT.cleanupFailedDisposition, 'terminal');
    assert.equal(BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT.cleanupNotExecutedDisposition, 'terminal');
    assert.equal(
      BRAZIL_RECEITA_GATE6_SUCCESS_WITH_RESIDUE_PERMITTED,
      BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT.successWithResiduePermitted,
    );
  });

  it('every terminating path GATE-6 enumerates is covered, including a process crash', () => {
    assert.equal(BRAZIL_RECEITA_GATE6_TERMINATING_PATHS.length, 10);
    for (const entry of BRAZIL_RECEITA_GATE6_TERMINATING_PATHS) {
      assert.equal(entry.cleanupRequired, true, entry.path);
      assert.ok(['runCleanup', 'reportNotExecuted'].includes(entry.coveredBy), entry.path);
    }
    const crash = BRAZIL_RECEITA_GATE6_TERMINATING_PATHS.find(
      (entry) => entry.path === 'process_crash',
    );
    assert.equal(crash?.coveredBy, 'reportNotExecuted');
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A real filesystem port for the private channel, built here rather than imported from the fs
 * adapter so this suite exercises the same shape a caller would inject.
 */
function realPrivateChannelPort(): BrazilReceitaFullJoinPrivateChannelFileSystem {
  return {
    writeFileExclusive(filePath, contents, mode) {
      fs.writeFileSync(filePath, contents, { mode, flag: 'wx' });
    },
    chmod(filePath, mode) {
      fs.chmodSync(filePath, mode);
    },
    statMode(filePath) {
      return fs.lstatSync(filePath).mode;
    },
    rename(fromPath, toPath) {
      fs.renameSync(fromPath, toPath);
    },
    exists(filePath) {
      try {
        fs.lstatSync(filePath);
        return true;
      } catch {
        return false;
      }
    },
    unlink(filePath) {
      fs.unlinkSync(filePath);
    },
  };
}
