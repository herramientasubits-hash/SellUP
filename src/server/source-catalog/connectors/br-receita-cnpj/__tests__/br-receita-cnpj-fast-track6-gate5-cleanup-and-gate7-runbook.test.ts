/**
 * BR-SOURCE-FAST-TRACK-6 — the GATE-5 contract cleanup, the GATE-7 runbook, and the final owner packet.
 *
 * Three deliverables, and each has a specific way of quietly becoming something bigger than it is.
 * This suite exists for those ways:
 *
 *   · **the GATE-5 collisions closing could look like an invariant being relaxed.** Every one is
 *     asserted resolved on the OWNER-DIRECTION side, with BR-SOURCE-11A's numeric ceiling, its
 *     `LONG_DIGIT_RUN`, and § 5.2 group 7 each asserted un-weakened by execution rather than by flag.
 *   · **`total_rows_scanned` becoming internal could look like a quieter output.** It is asserted
 *     absent from the allowlist, absent from the suppression-exempt set, refused by the guard with a
 *     dedicated `INTERNAL-ONLY` finding, and permitted on ZERO surfaces.
 *   · **an empty carve-out list could look like a reason to delete the precedence.** The list is
 *     asserted empty by DERIVATION over the real allowlist and denylist, and the precedence is
 *     asserted kept.
 *   · **the digit-run gap could look closed by widening a regex.** It is asserted closed by running
 *     BOTH layers over runs of 8, 9, 10, 11, 12, 13, 14 and 15 — never by merging them.
 *   · **the GATE-7 runbook existing could look like GATE-7 advancing toward approval.** The status is
 *     asserted `blocked`, `ready_for_review` is asserted explicitly NOT claimed, the preflight
 *     evaluator is asserted to take no arguments, and the four remaining blockers are asserted.
 *   · **a complete runbook could look reproducible.** Reproducibility is asserted `UNDEMONSTRATED`.
 *   · **the owner packet could look like an approval.** Every response field is asserted `null`, and
 *     the validator is asserted to REFUSE a packet whose fields have been filled.
 *
 * Pure and synthetic: no network, no Supabase, no provider, no real Receita data, no benchmark, no
 * filesystem write. The only files read are repository sources and two documents, for static guards.
 * Every digit-bearing fixture is GENERATED in-suite, so no identifier of any length is a literal here.
 * 0 credits, 0 writes, 0 migrations.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';

import {
  BRAZIL_RECEITA_GATE5_11A_WEAKENED_BY_THIS_ROUND,
  BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS,
  BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS,
  BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST,
  BRAZIL_RECEITA_GATE5_ALLOWLIST_GOVERNS,
  BRAZIL_RECEITA_GATE5_ANY_KEY_DEPENDS_ON_ALLOWLIST_CARVE_OUT,
  BRAZIL_RECEITA_GATE5_CROSS_TABULATIONS_PERMITTED,
  BRAZIL_RECEITA_GATE5_DIGIT_RUN_CONTRACTS_MERGED,
  BRAZIL_RECEITA_GATE5_DIGIT_RUN_SAFETY_LAYERS,
  BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_GROUPS,
  BRAZIL_RECEITA_GATE5_FROZEN_CONTRACT,
  BRAZIL_RECEITA_GATE5_IMMUTABLE_KEY_FORCING_A_CARVE_OUT,
  BRAZIL_RECEITA_GATE5_INTERNAL_ONLY_COUNTERS,
  BRAZIL_RECEITA_GATE5_INTERNAL_ONLY_COUNTER_PERMITTED_SURFACES,
  BRAZIL_RECEITA_GATE5_LIST_INDEPENDENCE,
  BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH,
  BRAZIL_RECEITA_GATE5_NAMED_MUNICIPALITY_COUNTS_PERMITTED,
  BRAZIL_RECEITA_GATE5_OUTPUT_KEY_RENAMES,
  BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS,
  BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_SUPERSESSIONS,
  BRAZIL_RECEITA_GATE5_RENAMED_KEYS_HAD_A_PRODUCTION_EMITTER,
  BRAZIL_RECEITA_GATE5_RENAME_SCOPE,
  BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL,
  BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_OBLIGATIONS,
  BRAZIL_RECEITA_GATE5_SMALL_CELL_K,
  BRAZIL_RECEITA_GATE5_STACK_OUTPUT_PERMITTED,
  BRAZIL_RECEITA_GATE5_SUPERSEDED_RESIDUAL_BUCKET_LABEL,
  BRAZIL_RECEITA_GATE5_SUPPRESSED_BUCKET_FAMILIES,
  BRAZIL_RECEITA_GATE5_SUPPRESSION_EXEMPT_KEYS,
  BRAZIL_RECEITA_GATE5_TOTAL_ROWS_SCANNED_DISPOSITION,
  BRAZIL_RECEITA_GATE5_VP_RULES_WIDENED_BY_THIS_ROUND,
} from '../br-receita-cnpj-gate5-output-contract';
import {
  applyBrazilReceitaGate5SmallCellSuppression,
  findBrazilReceitaGate5DigitRunViolations,
  guardBrazilReceitaGate5Report,
  isBrazilReceitaGate5AllowedKey,
  isBrazilReceitaGate5ForbiddenKey,
  isBrazilReceitaGate5InternalOnlyCounter,
  matchBrazilReceitaGate5ForbiddenKeyGroup,
} from '../br-receita-cnpj-gate5-output-guard';
import {
  BRAZIL_RECEITA_GATE5_CONTRACT_REVISIONS,
  BRAZIL_RECEITA_GATE5_DECISIONS_INSIDE_THE_REVIEW,
  BRAZIL_RECEITA_GATE5_REVISIONS_EARN_AN_APPROVAL,
  BRAZIL_RECEITA_GATE5_STATUS,
} from '../br-receita-cnpj-gate5-recorded-output-sanitization';
import {
  BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF,
  sanitizeBrazilReceitaFullJoinReport,
} from '../br-receita-cnpj-full-join-output-sanitizer';
import {
  BRAZIL_RECEITA_GATE7_ASSERTION_RECORDS,
  BRAZIL_RECEITA_GATE7_ASSERTION_TOTALS,
  BRAZIL_RECEITA_GATE7_ATTEMPT_3_ALLOWED,
  BRAZIL_RECEITA_GATE7_AUTOMATIC_RETRY_PERMITTED,
  BRAZIL_RECEITA_GATE7_BLOCKING_GATES,
  BRAZIL_RECEITA_GATE7_BREACH_PROCEDURE,
  BRAZIL_RECEITA_GATE7_CHANGES_THE_ATTEMPT_BUDGET,
  BRAZIL_RECEITA_GATE7_CLEANUP_FAILURE_IS_TERMINAL,
  BRAZIL_RECEITA_GATE7_CLEANUP_VERIFICATIONS,
  BRAZIL_RECEITA_GATE7_DATASET_PREFLIGHT,
  BRAZIL_RECEITA_GATE7_FAILED_PREFLIGHT_ITEM_IS_A_STOP,
  BRAZIL_RECEITA_GATE7_FORBIDDEN_FAMILIES,
  BRAZIL_RECEITA_GATE7_FORBIDDEN_OPERATOR_CLASSES,
  BRAZIL_RECEITA_GATE7_LOCAL_PATH_MAY_APPEAR_IN_REPORTS,
  BRAZIL_RECEITA_GATE7_MONITORED_SIGNALS,
  BRAZIL_RECEITA_GATE7_OPERATOR_MAY_BE_SOLE_APPROVER,
  BRAZIL_RECEITA_GATE7_OPERATOR_SUPPLIED_CAPS,
  BRAZIL_RECEITA_GATE7_OUTPUT_REVIEW_FORBIDDEN,
  BRAZIL_RECEITA_GATE7_OUTPUT_REVIEW_PERMITTED,
  BRAZIL_RECEITA_GATE7_PERMITTED_OPERATOR_CLASS,
  BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS,
  BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS,
  BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEM_COUNT,
  BRAZIL_RECEITA_GATE7_PRIVACY_PREFLIGHT_CONTRACTS,
  BRAZIL_RECEITA_GATE7_REHEARSAL_AUTHORIZED,
  BRAZIL_RECEITA_GATE7_REHEARSAL_PERFORMED,
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR,
  BRAZIL_RECEITA_GATE7_RESOURCE_PREFLIGHT_CHECKS,
  BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION,
  BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION_EXISTS,
  BRAZIL_RECEITA_GATE7_SECTION_IS_A_PERMISSION,
  BRAZIL_RECEITA_GATE7_SIGNOFF_FORBIDDEN_VALUE_KINDS,
  BRAZIL_RECEITA_GATE7_SIGNOFF_PERMITTED_VALUE_KINDS,
  BRAZIL_RECEITA_GATE7_SUCCESS_WITH_RESIDUE_PERMITTED,
  BRAZIL_RECEITA_GATE7_UNEXPECTED_FAMILY_DISPOSITION,
  BRAZIL_RECEITA_GATE7_WARNING_IS_EVER_A_PASS,
  BRAZIL_RECEITA_GATE7_WORKSPACE_CONFIRMATIONS,
  BRAZIL_RECEITA_GATE7_WORKSPACE_PREFLIGHT,
  brazilReceitaGate7ActorMayExecute,
  brazilReceitaGate7SignoffValueKindIsAdmissible,
  evaluateBrazilReceitaGate7PrivacyPreflight,
  evaluateBrazilReceitaGate7Preconditions,
} from '../br-receita-cnpj-gate7-operator-runbook';
import {
  BRAZIL_RECEITA_GATE7_AGENT_MAY_APPROVE,
  BRAZIL_RECEITA_GATE7_APPROVAL_IS_JOINT,
  BRAZIL_RECEITA_GATE7_APPROVED,
  BRAZIL_RECEITA_GATE7_APPROVER_COUNT,
  BRAZIL_RECEITA_GATE7_BLOCKERS_DISCHARGED,
  BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS,
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY,
  BRAZIL_RECEITA_GATE7_REQUIRED_EVIDENCE_DISPOSITION,
  BRAZIL_RECEITA_GATE7_RESTRICTIONS,
  BRAZIL_RECEITA_GATE7_STATUS,
  BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED,
  BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION,
} from '../br-receita-cnpj-gate7-recorded-operator-runbook';
import {
  BRAZIL_RECEITA_SIGNOFF_AGENT_MAY_ANSWER,
  BRAZIL_RECEITA_SIGNOFF_APPROVAL_BY_INFERENCE_PERMITTED,
  BRAZIL_RECEITA_SIGNOFF_COVERED_GATES,
  BRAZIL_RECEITA_SIGNOFF_DECISIONS_MAY_BE_BUNDLED,
  BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS,
  BRAZIL_RECEITA_SIGNOFF_GATE4_WRITES_REMAIN_BLOCKED,
  BRAZIL_RECEITA_SIGNOFF_GATE5_SUBJECT_TERMS,
  BRAZIL_RECEITA_SIGNOFF_GATE7_ABSENT_REASON,
  BRAZIL_RECEITA_SIGNOFF_PACKET_IS_AN_APPROVAL,
  BRAZIL_RECEITA_SIGNOFF_STILL_FORBIDDEN_AFTER_EVERY_APPROVAL,
  BRAZIL_RECEITA_SIGNOFF_TECHNICAL_DIRECTION_IS_A_HUMAN_PRIVACY_APPROVAL,
  brazilReceitaSignoffPacketIsUnanswered,
  findBrazilReceitaSignoffPacketDefects,
} from '../br-receita-cnpj-final-owner-signoff-packet';
import { BRAZIL_RECEITA_GATE2_APPROVED_CAPS } from '../br-receita-cnpj-gate2-recorded-owner-decision';
import {
  BRAZIL_RECEITA_GATE_APPROVED_STATUSES,
  BRAZIL_RECEITA_GATE_CURRENT_STATE,
  brazilReceitaGateGlobalVerdict,
} from '../br-receita-cnpj-gate-status-current-state';
import { BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED } from '../br-receita-cnpj-real-benchmark-attempt-ledger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function connectorCode(relativePath: string): string {
  return codeWithoutComments(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}
function rawConnectorSource(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
function repoDoc(relativePath: string): string {
  return fs.readFileSync(
    new URL(`../../../../../../${relativePath}`, import.meta.url),
    'utf8',
  );
}
/** Generated, never a literal: a run of `length` digits, so no identifier sits in this source. */
function digitRun(length: number): string {
  return '4'.repeat(length);
}

const THE_FAST_TRACK_6_MODULES = [
  '../br-receita-cnpj-gate5-owner-direction-log.ts',
  '../br-receita-cnpj-gate7-operator-runbook.ts',
  '../br-receita-cnpj-gate7-preflight-items.ts',
  '../br-receita-cnpj-gate7-recorded-operator-runbook.ts',
  '../br-receita-cnpj-final-owner-signoff-packet.ts',
] as const;

// ─── 1 · OD-C1 / OD-C2 — total_rows_scanned is INTERNAL ONLY ──────────────────

describe('FAST-TRACK-6 · OD-C1 and OD-C2 are closed by SUPERSEDING the owner direction', () => {
  it('records the supersession explicitly, naming what replaced it', () => {
    const supersession = BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_SUPERSESSIONS.find((entry) =>
      entry.collisionIds.includes('OD-C1'),
    );
    assert.ok(supersession, 'OD-C1 must have a recorded supersession');
    assert.equal(supersession.supersededDirection, 'TOTAL_ROWS_SCANNED = ALLOWED');
    assert.equal(
      supersession.supersededBy,
      'TOTAL_ROWS_SCANNED = INTERNAL_EXECUTION_COUNTER_ONLY',
    );
    assert.ok(supersession.collisionIds.includes('OD-C2'), 'one supersession closes both');
  });

  it('names all four reasons, including that 11A must not be weakened to preserve the field', () => {
    const supersession = BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_SUPERSESSIONS.find((entry) =>
      entry.collisionIds.includes('OD-C1'),
    );
    const text = (supersession?.rationale ?? []).join(' | ');
    assert.match(text, /MAX_NUMERIC_LEAF/);
    assert.match(text, /RENDERED/);
    assert.match(text, /Agent 1|product/);
    assert.match(text, /weaken BR-SOURCE-11A/);
  });

  it('the disposition is INTERNAL_EXECUTION_COUNTER_ONLY on both surfaces that state it', () => {
    assert.equal(
      BRAZIL_RECEITA_GATE5_TOTAL_ROWS_SCANNED_DISPOSITION,
      'INTERNAL_EXECUTION_COUNTER_ONLY',
    );
    assert.equal(
      BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS.total_rows_scanned,
      'internal_execution_counter_only',
    );
  });

  it('is permitted on ZERO surfaces — not "fewer surfaces"', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATE5_INTERNAL_ONLY_COUNTER_PERMITTED_SURFACES], []);
    assert.deepEqual([...BRAZIL_RECEITA_GATE5_INTERNAL_ONLY_COUNTERS], ['total_rows_scanned']);
    assert.equal(isBrazilReceitaGate5InternalOnlyCounter('total_rows_scanned'), true);
    assert.equal(isBrazilReceitaGate5InternalOnlyCounter('records_persisted'), false);
  });

  it('is absent from the § 6 allowlist, which is what makes OS-A08 refuse it', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.includes('total_rows_scanned'), false);
    assert.equal(isBrazilReceitaGate5AllowedKey('total_rows_scanned'), false);
  });

  it('is absent from the suppression-exempt set too — it belongs to NEITHER set', () => {
    // 🔴 Listing it as "exempt from suppression" would imply a surface it may reach. An internal-only
    // counter is not a field suppression spares; it is not a field at all.
    assert.equal(BRAZIL_RECEITA_GATE5_SUPPRESSION_EXEMPT_KEYS.includes('total_rows_scanned'), false);
    assert.equal(
      BRAZIL_RECEITA_GATE5_SUPPRESSED_BUCKET_FAMILIES.includes('total_rows_scanned'),
      false,
    );
  });

  it('the guard refuses it with a DEDICATED finding, not merely as an unknown key', () => {
    const outcome = guardBrazilReceitaGate5Report({ total_rows_scanned: 4 });
    assert.equal(outcome.ok, false);
    // Both nets fire. The dedicated one exists so a future reader does not "fix" the failure by
    // adding the key back to the allowlist.
    assert.ok(outcome.findings.some((f) => f.rule === 'KEY-ALLOWLIST'));
    assert.ok(outcome.findings.some((f) => f.rule === 'INTERNAL-ONLY'));
  });

  it('BR-SOURCE-11A is un-weakened: both invariants that caused the collision still stand', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_11A_WEAKENED_BY_THIS_ROUND, false);
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF, 9_999_999);
    const sanitizer = connectorCode('../br-receita-cnpj-full-join-output-sanitizer.ts');
    assert.match(sanitizer, /LONG_DIGIT_RUN\s*=\s*\/\(\?<!\\d\)\\d\{8,\}/);
  });

  it('11A still REFUSES a national-scale numeric leaf, proved by running it', () => {
    // Not a flag: the sanitizer is executed on the shape that used to carry the counter.
    const nationalScaleTotal = Number(digitRun(8));
    assert.ok(nationalScaleTotal > BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF);
    const outcome = sanitizeBrazilReceitaFullJoinReport({ some_total: nationalScaleTotal });
    assert.equal(outcome.ok, false, '11A must still refuse an oversized numeric leaf');
  });
});

// ─── 2 · The row-named output collisions are renamed away ─────────────────────

describe('FAST-TRACK-6 · the two row-named output keys are RENAMED, not carved out', () => {
  it('renames both keys and records each with its reason and its historical prose', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_OUTPUT_KEY_RENAMES.length, 2);
    const byFrom = new Map(BRAZIL_RECEITA_GATE5_OUTPUT_KEY_RENAMES.map((r) => [r.from, r]));
    assert.equal(byFrom.get('persisted_rows')?.to, 'records_persisted');
    assert.equal(byFrom.get('rows_seen_by_family')?.to, 'records_seen_by_family');
    for (const rename of BRAZIL_RECEITA_GATE5_OUTPUT_KEY_RENAMES) {
      assert.equal(rename.trippedDenylistGroup, 7);
      assert.ok(rename.reason.length > 0);
      assert.ok(rename.historicalReferences.length > 0, 'a rename must name what still uses the old spelling');
      assert.equal(rename.historicalProseEdited, false, 'historical prose is never rewritten');
    }
  });

  it('the new names are allowlisted and trip NO denylist group', () => {
    for (const key of ['records_persisted', 'records_seen_by_family']) {
      assert.equal(isBrazilReceitaGate5AllowedKey(key), true, `${key} must be allowlisted`);
      assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup(key), null, `${key} must trip nothing`);
      assert.deepEqual(guardBrazilReceitaGate5Report({ [key]: 0 }).findings, []);
    }
  });

  it('the old names are no longer allowlisted, and still trip group 7', () => {
    for (const key of ['persisted_rows', 'rows_seen_by_family']) {
      assert.equal(isBrazilReceitaGate5AllowedKey(key), false, `${key} must no longer be admitted`);
      assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup(key), 7, 'the matcher is untouched');
    }
  });

  it('the suppressed-family and exempt sets carry the NEW names, not the old ones', () => {
    assert.ok(BRAZIL_RECEITA_GATE5_SUPPRESSED_BUCKET_FAMILIES.includes('records_seen_by_family'));
    assert.equal(BRAZIL_RECEITA_GATE5_SUPPRESSED_BUCKET_FAMILIES.includes('rows_seen_by_family'), false);
    assert.ok(BRAZIL_RECEITA_GATE5_SUPPRESSION_EXEMPT_KEYS.includes('records_persisted'));
    assert.equal(BRAZIL_RECEITA_GATE5_SUPPRESSION_EXEMPT_KEYS.includes('persisted_rows'), false);
  });

  it('the rename is scoped to the output contract, and no production emitter changed shape', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_RENAMED_KEYS_HAD_A_PRODUCTION_EMITTER, false);
    assert.equal(BRAZIL_RECEITA_GATE5_RENAME_SCOPE, 'future_sanitized_output_contract_only');
  });

  it('no production module EMITS either OLD key, which is why the rename is safe', () => {
    // 🔴 Match an EMISSION, not a mention. An emitter writes `persisted_rows:` as an object property
    // or a type member; a record that NAMES the old spelling — the rename table, the owner packet —
    // writes it as a quoted datum. Grepping the bare token would flag the very records whose job is
    // to carry the old name forward, and the false positive would teach a future author to delete the
    // provenance instead of the emitter.
    const dir = new URL('../', import.meta.url);
    const offenders = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => !name.startsWith('br-receita-cnpj-gate5-'))
      .filter((name) =>
        /(?:^|[\s{,(])(?:readonly\s+)?persisted_rows\s*[:?]|(?:^|[\s{,(])(?:readonly\s+)?rows_seen_by_family\s*[:?]/m.test(
          codeWithoutComments(fs.readFileSync(new URL(name, dir), 'utf8')),
        ),
      );
    assert.deepEqual(offenders, [], 'a production emitter of an old key would make this a breaking rename');
  });
});

// ─── 3 · The carve-out set is empty, and the precedence is kept ───────────────

describe('FAST-TRACK-6 · the allowlist/denylist carve-out set is empty by DERIVATION', () => {
  it('is empty, and is empty because the real lists no longer disagree', () => {
    // 🔴 Derived, not asserted twice: the intersection of the real allowlist and the real denylist is
    // computed here, so an entry appearing in either list without being recorded fails this test.
    const tripping = BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.filter((key) =>
      isBrazilReceitaGate5ForbiddenKey(key),
    );
    assert.deepEqual(tripping, [], 'no § 6 key may trip a denylist group without a recorded decision');
    assert.deepEqual([...BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST], []);
    assert.equal(BRAZIL_RECEITA_GATE5_ANY_KEY_DEPENDS_ON_ALLOWLIST_CARVE_OUT, false);
  });

  it('reports that NO authoritative immutable key forced a carve-out to survive', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_IMMUTABLE_KEY_FORCING_A_CARVE_OUT, null);
  });

  it('KEEPS the precedence rather than deleting it for being unused', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_ALLOWLIST_GOVERNS, true);
    const guard = connectorCode('../br-receita-cnpj-gate5-output-guard.ts');
    assert.match(guard, /isBrazilReceitaGate5AllowedKey\(key\)\) return/);
  });

  it('the denylist was NOT weakened: seven groups, and group 7 still holds row and cell', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_GROUPS.length, 7);
    const group7 = BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_GROUPS.find((g) => g.group === 7);
    assert.equal(group7?.matchMode, 'substring');
    for (const name of ['raw', 'sample', 'example', 'debug', 'payload', 'row', 'cell', 'offset']) {
      assert.ok(group7?.names.includes(name), `group 7 must still forbid ${name}`);
    }
  });

  it('the two lists stay two lists, with no unnecessary exceptions between them', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_LIST_INDEPENDENCE.allowlistIsAuthoritative, true);
    assert.equal(BRAZIL_RECEITA_GATE5_LIST_INDEPENDENCE.denylistIsAnIndependentSecondNet, true);
    assert.equal(BRAZIL_RECEITA_GATE5_LIST_INDEPENDENCE.listsMergedIntoOne, false);
    assert.equal(BRAZIL_RECEITA_GATE5_LIST_INDEPENDENCE.unnecessaryExceptionsBetweenThem, 0);
  });

  it('the allowlist still refuses a novel key, so emptying the carve-out changed nothing structural', () => {
    assert.equal(isBrazilReceitaGate5ForbiddenKey('establishment_density_index'), false);
    assert.equal(isBrazilReceitaGate5AllowedKey('establishment_density_index'), false);
    const outcome = guardBrazilReceitaGate5Report({ establishment_density_index: 4 });
    assert.equal(outcome.ok, false);
  });
});

// ─── 4 · OD-C3 — the residual label ───────────────────────────────────────────

describe('FAST-TRACK-6 · OD-C3 is closed by renaming the label, not by exempting it', () => {
  it('the label in force is suppressed_other, and it survives group 7 unaided', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL, 'suppressed_other');
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('suppressed_other'), null);
  });

  it('the superseded label is kept, and still trips group 7 — so the collision was real', () => {
    assert.equal(
      BRAZIL_RECEITA_GATE5_SUPERSEDED_RESIDUAL_BUCKET_LABEL,
      'other_or_suppressed_small_cell',
    );
    assert.equal(
      matchBrazilReceitaGate5ForbiddenKeyGroup(BRAZIL_RECEITA_GATE5_SUPERSEDED_RESIDUAL_BUCKET_LABEL),
      7,
    );
  });

  it('the residual bucket keeps every obligation the old label carried', () => {
    assert.deepEqual(BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_OBLIGATIONS, {
      aggregateOnly: true,
      mergedBucketCountDisclosed: false,
      originalLabelsDisclosed: false,
      originalSmallCountsDisclosed: false,
      reconstructableBySubtraction: false,
    });
  });

  it('suppression still emits ONE count under the new label, with no tally and no labels', () => {
    const outcome = applyBrazilReceitaGate5SmallCellSuppression({ a: 60, b: 40, c: 7, d: 6 });
    const residualKeys = Object.keys(outcome.disclosed).filter(
      (key) => !['a', 'b'].includes(key),
    );
    assert.deepEqual(residualKeys, [BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL]);
    // One count. No bucket tally, no original labels, nothing recoverable by subtraction.
    assert.equal(typeof outcome.residualCount, 'number');
    assert.equal('c' in outcome.disclosed, false);
    assert.equal('d' in outcome.disclosed, false);
    assert.equal(Object.keys(outcome).includes('mergedBucketCount'), false);
  });

  it('group 7 was not touched to make the old label fit', () => {
    const supersession = BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_SUPERSESSIONS.find((entry) =>
      entry.collisionIds.includes('OD-C3'),
    );
    assert.ok(supersession);
    assert.ok(
      supersession.whatDidNotMove.some((item) => /group 7/.test(item)),
      'the supersession must name group 7 as the thing that did not move',
    );
  });
});

// ─── 5 · Every collision resolved on the owner-direction side ─────────────────

describe('FAST-TRACK-6 · the resolution direction is asserted, not just the resolution', () => {
  it('all three collisions are resolved, and none by moving an invariant', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS.length, 3);
    for (const collision of BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS) {
      assert.equal(collision.resolvedByThisRound, true, `${collision.id} must be resolved`);
      assert.equal(collision.weakenedByThisRound, false, `${collision.id} weakened an invariant`);
      assert.equal(collision.invariantMovedToAccommodateIt, null);
    }
  });

  it('every supersession is recorded as project direction, NOT as a human privacy approval', () => {
    assert.ok(BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_SUPERSESSIONS.length >= 2);
    for (const supersession of BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_SUPERSESSIONS) {
      assert.equal(supersession.isAHumanPrivacyApproval, false);
      assert.ok(supersession.whatDidNotMove.length > 0, 'a supersession must name what stayed put');
    }
  });
});

// ─── 6 · The frozen contract, after the cleanup ────────────────────────────────

describe('FAST-TRACK-6 · the frozen contract table cannot disagree with its own sources', () => {
  it('every derived row equals the constant that owns it', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_FROZEN_CONTRACT.SMALL_CELL_K, BRAZIL_RECEITA_GATE5_SMALL_CELL_K);
    assert.equal(
      BRAZIL_RECEITA_GATE5_FROZEN_CONTRACT.MAX_OUTPUT_STRING_LENGTH,
      BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH,
    );
    assert.equal(
      BRAZIL_RECEITA_GATE5_FROZEN_CONTRACT.SMALL_CELL_RESIDUAL_KEY,
      BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL,
    );
  });

  it('freezes the exact values the review is asked about', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_SMALL_CELL_K, 10);
    assert.equal(BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH, 64);
    assert.equal(BRAZIL_RECEITA_GATE5_CROSS_TABULATIONS_PERMITTED, false);
    assert.equal(BRAZIL_RECEITA_GATE5_NAMED_MUNICIPALITY_COUNTS_PERMITTED, false);
    assert.equal(BRAZIL_RECEITA_GATE5_STACK_OUTPUT_PERMITTED, false);
    assert.equal(BRAZIL_RECEITA_GATE5_FROZEN_CONTRACT.TOTAL_ROWS_SCANNED, 'INTERNAL_ONLY');
    assert.equal(BRAZIL_RECEITA_GATE5_FROZEN_CONTRACT.RECORDS_PERSISTED_OUTPUT_KEY, 'records_persisted');
    assert.equal(
      BRAZIL_RECEITA_GATE5_FROZEN_CONTRACT.RECORDS_SEEN_BY_FAMILY_OUTPUT_KEY,
      'records_seen_by_family',
    );
  });

  it('keeps the three breakdowns EXCLUDED, and their exclusion is enforced by absence', () => {
    for (const key of [
      'capital_social_bucket_counts',
      'opened_at_bucket_counts',
      'municipality_count_distribution',
    ]) {
      assert.equal(BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS[key], 'excluded');
      assert.equal(isBrazilReceitaGate5AllowedKey(key), false);
    }
  });
});

// ─── 7 · The digit-run layers, PROVED by execution ────────────────────────────

describe('FAST-TRACK-6 · every digit-run length fails closed through at least one layer', () => {
  it('runs of 8 … 15 each fail closed, proved by RUNNING both layers', () => {
    // 🔴 The map is not the evidence. For every length, both authoritative layers are EXECUTED on a
    // generated run and at least one must refuse it. A table can be wrong; this cannot.
    for (const length of [8, 9, 10, 11, 12, 13, 14, 15]) {
      const value = digitRun(length);
      const gate5Hits = findBrazilReceitaGate5DigitRunViolations(value);
      const sanitizer11A = sanitizeBrazilReceitaFullJoinReport({ warnings: [value] });
      assert.ok(
        gate5Hits.length > 0 || sanitizer11A.ok === false,
        `a run of ${length} digits must be refused by at least one authoritative layer`,
      );
    }
  });

  it('the four lengths the frozen VP rules miss are covered by 11A, and only by 11A', () => {
    for (const length of [9, 10, 12, 13]) {
      const value = digitRun(length);
      assert.deepEqual(
        findBrazilReceitaGate5DigitRunViolations(value),
        [],
        `VP-1..VP-4 are frozen and must NOT have been widened to cover ${length}`,
      );
      assert.equal(
        sanitizeBrazilReceitaFullJoinReport({ warnings: [value] }).ok,
        false,
        `11A LONG_DIGIT_RUN must be what closes ${length}`,
      );
    }
  });

  it('the four lengths the VP rules DO name are caught by the frozen rules themselves', () => {
    const expected: ReadonlyArray<readonly [number, string]> = [
      [8, 'VP-1'],
      [11, 'VP-2'],
      [14, 'VP-3'],
      [15, 'VP-4'],
    ];
    for (const [length, rule] of expected) {
      assert.ok(
        findBrazilReceitaGate5DigitRunViolations(digitRun(length)).includes(
          rule as ReturnType<typeof findBrazilReceitaGate5DigitRunViolations>[number],
        ),
        `a run of ${length} must be caught by ${rule}`,
      );
    }
  });

  it('the coverage map agrees with what the layers actually do', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_DIGIT_RUN_SAFETY_LAYERS.length, 8);
    for (const layer of BRAZIL_RECEITA_GATE5_DIGIT_RUN_SAFETY_LAYERS) {
      const value = digitRun(layer.runLength);
      const actualVp = findBrazilReceitaGate5DigitRunViolations(value);
      for (const claimed of layer.gate5VpRules) {
        assert.ok(
          (actualVp as readonly string[]).includes(claimed),
          `the map claims ${claimed} covers a run of ${layer.runLength}; it does not`,
        );
      }
      if (layer.gate5VpRules.length === 0) {
        assert.deepEqual(actualVp, [], `the map claims no VP rule covers ${layer.runLength}`);
      }
      assert.equal(layer.sanitizer11ALongDigitRun, true);
    }
  });

  it('neither contract was widened, and the two were not merged', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_VP_RULES_WIDENED_BY_THIS_ROUND, false);
    assert.equal(BRAZIL_RECEITA_GATE5_DIGIT_RUN_CONTRACTS_MERGED, false);
    // The Gate-5 guard must not import 11A, which is what keeps them two contracts.
    const guard = connectorCode('../br-receita-cnpj-gate5-output-guard.ts');
    assert.ok(
      !/from '\.\/br-receita-cnpj-full-join-output-sanitizer'/.test(guard),
      'the Gate-5 guard must not reach into 11A; two authorities are the point',
    );
  });
});

// ─── 8 · GATE-5 is STILL ready_for_review ─────────────────────────────────────

describe('FAST-TRACK-6 · fixing everything the review flagged does not earn the approval on its own', () => {
  // 🔴 UPDATED BY BR-SOURCE-FAST-TRACK-7 — the joint security/privacy + test owner approval was later
  // recorded (§ 9.4), against the CORRECTED contract this round produced. The revisions themselves
  // still did not earn it: BRAZIL_RECEITA_GATE5_REVISIONS_EARN_AN_APPROVAL stays false, because what
  // discharged the gate was the owners' own recorded decision, not the implementer's fixes.
  it('GATE-5 is approved (BR-SOURCE-FAST-TRACK-7), but not because the revisions earned it', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_STATUS, 'approved');
    assert.equal(
      BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(BRAZIL_RECEITA_GATE5_STATUS),
      true,
    );
    assert.equal(BRAZIL_RECEITA_GATE5_REVISIONS_EARN_AN_APPROVAL, false);
  });

  it('records the three revisions, each with weakenedAnInvariant false', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_CONTRACT_REVISIONS.length, 3);
    for (const revision of BRAZIL_RECEITA_GATE5_CONTRACT_REVISIONS) {
      assert.equal(revision.round, 'BR-SOURCE-FAST-TRACK-6');
      assert.equal(revision.weakenedAnInvariant, false);
    }
    const closed = BRAZIL_RECEITA_GATE5_CONTRACT_REVISIONS.flatMap((r) => [...r.closes]).sort();
    assert.deepEqual(closed, ['OD-C1', 'OD-C2', 'OD-C3']);
  });

  it('the review subject names the corrections, so no approver blesses a superseded document', () => {
    const text = BRAZIL_RECEITA_GATE5_DECISIONS_INSIDE_THE_REVIEW.join(' | ');
    assert.match(text, /INTERNAL_EXECUTION_COUNTER_ONLY/);
    assert.match(text, /suppressed_other/);
    assert.match(text, /records_persisted/);
    assert.match(text, /EMPTY/);
  });
});

// ─── 9 · The GATE-7 runbook SECTION exists ────────────────────────────────────

describe('FAST-TRACK-6 · the GATE-7 runbook section exists, in the document 10K § 11 requires', () => {
  it('claims to exist, and extends the existing runbook rather than competing with it', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION_EXISTS, true);
    assert.equal(BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION.extendsExistingRunbook, true);
    assert.equal(BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION.isACompetingDocument, false);
  });

  it('the section is REALLY in that document, with every required step present', () => {
    // 🔴 A module claiming a document exists is not evidence. The document is read.
    const runbook = repoDoc(BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION.document);
    assert.match(runbook, /^## 16\. GATE-7 operator runbook/m);
    for (const heading of [
      /### 16\.1 Step 0 — who may operate/,
      /### 16\.2 Step 1 — preconditions/,
      /### 16\.3 Step 2 — the twenty-two-item preflight/,
      /### 16\.4 Step 3 — resource preflight/,
      /### 16\.5 Step 4 — workspace preflight/,
      /### 16\.6 Step 5 — dataset and manifest preflight/,
      /### 16\.7 Step 6 — privacy preflight/,
      /### 16\.8 Step 7 — live monitoring/,
      /### 16\.9 Step 8 — output review/,
      /### 16\.10 Step 9 — cleanup/,
      /### 16\.11 Step 10 — signoff/,
    ]) {
      assert.match(runbook, heading, `the runbook section is missing ${heading}`);
    }
  });

  it('every one of P-01 … P-22 appears in the prose section, not only in the module', () => {
    const runbook = repoDoc(BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION.document);
    for (const item of BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS) {
      assert.ok(runbook.includes(item.id), `${item.id} is missing from the runbook prose`);
    }
  });

  it('the section is a PROCEDURE and says so, never a permission', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_SECTION_IS_A_PERMISSION, false);
    const runbook = repoDoc(BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION.document);
    assert.match(runbook, /PROCEDURE, never a PERMISSION/);
  });
});

// ─── 10 · The preflight, and the absence of a bypass ──────────────────────────

describe('FAST-TRACK-6 · the GATE-7 preflight is executable and fails closed', () => {
  it('carries exactly 22 items, uniquely identified, each with one action and one pass condition', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS.length, BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEM_COUNT);
    assert.equal(BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEM_COUNT, 22);
    const ids = BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS.map((item) => item.id);
    assert.equal(new Set(ids).size, 22, 'every preflight id must be unique');
    for (let index = 1; index <= 22; index += 1) {
      const id = `P-${String(index).padStart(2, '0')}`;
      assert.ok(ids.includes(id), `${id} is missing`);
    }
    for (const item of BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS) {
      assert.ok(item.action.length > 0, `${item.id} has no action`);
      assert.ok(item.passCondition.length > 0, `${item.id} has no pass condition`);
    }
  });

  it('🔴 UPDATED BY BR-SOURCE-FAST-TRACK-8: P-05 is still the gate-status item, and now expected to pass', () => {
    const p05 = BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS.find((item) => item.id === 'P-05');
    assert.ok(p05);
    // GATE-7's own approval was the last gate this item waited on. Not
    // `operator_environment_dependent` like P-19 / P-21: the gate state lives in this repo, so the
    // answer is fully determined here rather than on the operator's machine.
    assert.equal(p05.standing, 'checkable_and_expected_to_pass');
    assert.equal(p05.authority, 'br-receita-cnpj-gate-status-current-state');
  });

  it('🔴 UPDATED BY BR-SOURCE-FAST-TRACK-8: the evaluator now returns PASS, because every gate — GATE-7 included — is approved', () => {
    const outcome = evaluateBrazilReceitaGate7Preconditions();
    assert.equal(outcome.result, 'PASS');
    assert.deepEqual([...outcome.unapprovedGates], []);
    // The contract's named blocking-gate list is unchanged — it is the fixed dependency contract,
    // not a live "currently blocking" computation — and its unapproved subset stays empty.
    assert.deepEqual([...BRAZIL_RECEITA_GATE7_BLOCKING_GATES], [2, 5, 6]);
    assert.deepEqual([...outcome.unapprovedBlockingGates], []);
    // 🔴 PASS is not permission. The bypass never existed and still does not.
    assert.equal(outcome.bypassAvailable, false);
    assert.equal(BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS, false);
  });

  it('the evaluator takes NO arguments, so there is no surface to weaken it on', () => {
    // 🔴 Arity is the assertion. An options object is where a `force` flag would eventually live.
    assert.equal(evaluateBrazilReceitaGate7Preconditions.length, 0);
    assert.equal(BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS, false);
    assert.equal(evaluateBrazilReceitaGate7Preconditions().bypassAvailable, false);
  });

  it('the evaluator derives from the authoritative view rather than a second copy', () => {
    const outcome = evaluateBrazilReceitaGate7Preconditions();
    const expected = BRAZIL_RECEITA_GATE_CURRENT_STATE.filter(
      (entry) => !BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(entry.status),
    ).map((entry) => entry.gate);
    assert.deepEqual(outcome.unapprovedGates.map((entry) => entry.gate), expected);
    // 🔴 UPDATED BY BR-SOURCE-FAST-TRACK-8: eight of eight approved, so the verdict is GO — the narrow
    // § 15 GO (a runner PR may be PROPOSED), never an execution authorization.
    assert.equal(brazilReceitaGateGlobalVerdict(), 'GO');
  });

  it('a failed item is a stop, and a warning is never a pass', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_FAILED_PREFLIGHT_ITEM_IS_A_STOP, true);
    assert.equal(BRAZIL_RECEITA_GATE7_WARNING_IS_EVER_A_PASS, false);
  });
});

// ─── 11 · Operator identity ───────────────────────────────────────────────────

describe('FAST-TRACK-6 · only a named authorized human operator may execute', () => {
  it('admits exactly one actor class', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_PERMITTED_OPERATOR_CLASS, 'named_authorized_human_operator');
    assert.equal(brazilReceitaGate7ActorMayExecute('named_authorized_human_operator'), true);
  });

  it('refuses every automated class, and refuses "on behalf of" a human by name', () => {
    for (const actor of BRAZIL_RECEITA_GATE7_FORBIDDEN_OPERATOR_CLASSES) {
      assert.equal(brazilReceitaGate7ActorMayExecute(actor), false, `${actor} must be refused`);
    }
    assert.ok(
      BRAZIL_RECEITA_GATE7_FORBIDDEN_OPERATOR_CLASSES.includes('agent_acting_on_behalf_of_a_human'),
      'delegation to an agent is an agent executing, and must be named',
    );
    for (const actor of ['agent', 'automation', 'ci_runner', 'cron_or_scheduled_job', 'background_task']) {
      assert.ok(BRAZIL_RECEITA_GATE7_FORBIDDEN_OPERATOR_CLASSES.includes(actor));
    }
  });

  it('refuses an UNRECOGNIZED actor class too, rather than defaulting to permitted', () => {
    assert.equal(brazilReceitaGate7ActorMayExecute('some_future_runner_kind'), false);
    assert.equal(brazilReceitaGate7ActorMayExecute(''), false);
  });

  it('the operator may not be the sole approver of the gate', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_OPERATOR_MAY_BE_SOLE_APPROVER, false);
  });
});

// ─── 12 · Resource, workspace, dataset and privacy preflights ─────────────────

describe('FAST-TRACK-6 · the preflights read their ceilings from the records that own them', () => {
  it('every resource ceiling equals its owning constant, with no literal restated', () => {
    const byName = new Map(
      BRAZIL_RECEITA_GATE7_RESOURCE_PREFLIGHT_CHECKS.map((check) => [check.signal, check.ceiling]),
    );
    assert.equal(byName.get('rss'), BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxRssBytes);
    assert.equal(byName.get('heap_used'), BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxHeapUsedBytes);
    assert.equal(byName.get('external_memory'), BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxExternalMemoryBytes);
    assert.equal(byName.get('runtime'), BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxRuntimeMs);
    assert.equal(byName.get('phase_runtime'), BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxPhaseRuntimeMs);
    assert.equal(byName.get('temporary_storage'), BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxTemporaryStorageBytes);
    assert.equal(byName.get('rows_read'), BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxRowsRead);
    assert.equal(byName.get('files_opened'), BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxFilesOpened);
    assert.equal(byName.get('bytes_read'), BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxBytesRead);
    assert.equal(byName.get('join_keys_in_memory'), BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxJoinKeysInMemory);
  });

  it('covers all ten ceilings plus the two disk thresholds the task names', () => {
    const signals = BRAZIL_RECEITA_GATE7_RESOURCE_PREFLIGHT_CHECKS.map((check) => check.signal);
    for (const signal of [
      'rss',
      'heap_used',
      'external_memory',
      'runtime',
      'phase_runtime',
      'temporary_storage',
      'rows_read',
      'files_opened',
      'bytes_read',
      'join_keys_in_memory',
      'minimum_free_disk_before_start',
      'minimum_free_disk_reserve',
    ]) {
      assert.ok(signals.includes(signal), `the resource preflight is missing ${signal}`);
    }
  });

  it('classifies every ceiling as a DECISION, never as a measurement', () => {
    for (const check of BRAZIL_RECEITA_GATE7_RESOURCE_PREFLIGHT_CHECKS) {
      assert.ok(['owner_decision_value', 'standing_proposal_value'].includes(check.kind));
    }
    // The three operator-supplied caps stay operator-supplied, however written-down they are.
    const supplied = BRAZIL_RECEITA_GATE7_RESOURCE_PREFLIGHT_CHECKS.filter(
      (check) => check.operatorSuppliedAtInvocation,
    ).map((check) => check.signal);
    for (const cap of BRAZIL_RECEITA_GATE7_OPERATOR_SUPPLIED_CAPS) {
      const signal = cap.replace(/^max/, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
      assert.ok(supplied.includes(signal), `${cap} must remain operator-supplied at invocation`);
    }
  });

  it('the workspace constraints are the GATE-2 object itself, not a copy', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_WORKSPACE_PREFLIGHT.outsideRepository, true);
    assert.equal(BRAZIL_RECEITA_GATE7_WORKSPACE_PREFLIGHT.outsideHomeDirectory, true);
    assert.equal(BRAZIL_RECEITA_GATE7_WORKSPACE_PREFLIGHT.outsideDatasetRoot, true);
    assert.equal(BRAZIL_RECEITA_GATE7_WORKSPACE_PREFLIGHT.symlinkPermitted, false);
    assert.equal(BRAZIL_RECEITA_GATE7_WORKSPACE_PREFLIGHT.directoryMode, 0o700);
    assert.equal(BRAZIL_RECEITA_GATE7_WORKSPACE_PREFLIGHT.fileMode, 0o600);
    assert.equal(BRAZIL_RECEITA_GATE7_WORKSPACE_CONFIRMATIONS.length, 7);
  });

  it('the resolved local path may never appear in a sanitized report', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_LOCAL_PATH_MAY_APPEAR_IN_REPORTS, false);
  });

  it('an unexpected file family is a HARD STOP, and the person-linked families are named', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_UNEXPECTED_FAMILY_DISPOSITION, 'HARD_STOP');
    for (const family of ['socios', 'qsa', 'cpf']) {
      assert.ok(BRAZIL_RECEITA_GATE7_FORBIDDEN_FAMILIES.includes(family));
    }
    const text = BRAZIL_RECEITA_GATE7_DATASET_PREFLIGHT.join(' | ');
    assert.match(text, /Empresas multipart set is COMPLETE/);
    assert.match(text, /Estabelecimentos multipart set is COMPLETE/);
    assert.match(text, /no Socios/);
    assert.match(text, /no QSA/);
    assert.match(text, /no CPF or person-linked/);
    assert.match(text, /LOCAL FILE manifest/);
  });

  it('🔴 UPDATED BY BR-SOURCE-FAST-TRACK-7: the privacy preflight covers five contracts, requires approved, and now PASSES — all five owning gates are approved', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_PRIVACY_PREFLIGHT_CONTRACTS.length, 5);
    const gates = BRAZIL_RECEITA_GATE7_PRIVACY_PREFLIGHT_CONTRACTS.map((c) => c.owningGate).sort();
    assert.deepEqual(gates, [2, 3, 4, 5, 6]);
    for (const contract of BRAZIL_RECEITA_GATE7_PRIVACY_PREFLIGHT_CONTRACTS) {
      assert.equal(contract.requiredStatus, 'approved');
    }
    const outcome = evaluateBrazilReceitaGate7PrivacyPreflight();
    assert.equal(outcome.result, 'PASS');
    assert.equal(outcome.operatorDiscretionAvailable, false);
    // All five owning gates (GATE-2 … GATE-6) are now approved.
    assert.deepEqual([...outcome.unapprovedContracts], []);
  });

  it('the privacy preflight takes no arguments either', () => {
    assert.equal(evaluateBrazilReceitaGate7PrivacyPreflight.length, 0);
  });
});

// ─── 13 · Monitoring, output review, cleanup, signoff ─────────────────────────

describe('FAST-TRACK-6 · the run-time discipline is enumerated and fail-closed', () => {
  it('watches all ten signals', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_MONITORED_SIGNALS.length, 10);
    for (const signal of [
      'rss',
      'heap_used',
      'external_memory',
      'disk_and_temporary_storage',
      'files_and_handles_open',
      'bytes_read',
      'rows_read',
      'join_keys_in_memory',
      'runtime',
      'phase_runtime',
    ]) {
      assert.ok(BRAZIL_RECEITA_GATE7_MONITORED_SIGNALS.includes(signal), `missing ${signal}`);
    }
  });

  it('a breach stops, cleans up, and is terminal — in that order, with no retry', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATE7_BREACH_PROCEDURE], [
      'stop the run',
      'run cleanup and verify it',
      'record the outcome as a terminal failure',
    ]);
    assert.equal(BRAZIL_RECEITA_GATE7_AUTOMATIC_RETRY_PERMITTED, false);
  });

  it('ATTEMPT_3_ALLOWED is READ from the ledger and is unchanged', () => {
    // 🔴 Identity with the ledger constant is the assertion: there is no second copy to flip.
    assert.equal(BRAZIL_RECEITA_GATE7_ATTEMPT_3_ALLOWED, BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED);
    assert.equal(BRAZIL_RECEITA_GATE7_ATTEMPT_3_ALLOWED, false);
    assert.equal(BRAZIL_RECEITA_GATE7_CHANGES_THE_ATTEMPT_BUDGET, false);
  });

  it('output review permits only sanitized aggregates, and forbids the undetectable class by name', () => {
    const permitted = BRAZIL_RECEITA_GATE7_OUTPUT_REVIEW_PERMITTED.join(' | ');
    assert.match(permitted, /after the sanitizer boundary/);
    const forbidden = BRAZIL_RECEITA_GATE7_OUTPUT_REVIEW_FORBIDDEN.join(' | ');
    assert.match(forbidden, /manually editing a report to make it pass/);
    assert.match(forbidden, /screenshotting raw data/);
    assert.match(forbidden, /hidden debug/);
    assert.match(forbidden, /path value/);
    assert.match(forbidden, /stack/);
    assert.match(forbidden, /identifier of any length/);
    assert.match(forbidden, /just one example/);
  });

  it('cleanup must be VERIFIED on every terminal path, and a failure is terminal', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_SUCCESS_WITH_RESIDUE_PERMITTED, false);
    assert.equal(BRAZIL_RECEITA_GATE7_CLEANUP_FAILURE_IS_TERMINAL, true);
    const text = BRAZIL_RECEITA_GATE7_CLEANUP_VERIFICATIONS.join(' | ');
    assert.match(text, /ABSENT/);
    assert.match(text, /handle/);
    assert.match(text, /residual/);
  });

  it('the signoff admits only controlled kinds, and refuses an unknown one', () => {
    for (const kind of BRAZIL_RECEITA_GATE7_SIGNOFF_PERMITTED_VALUE_KINDS) {
      assert.equal(brazilReceitaGate7SignoffValueKindIsAdmissible(kind), true, `${kind} must pass`);
    }
    for (const kind of ['path', 'identifier', 'source_value', 'stack', 'row_sample']) {
      assert.ok(BRAZIL_RECEITA_GATE7_SIGNOFF_FORBIDDEN_VALUE_KINDS.includes(kind));
      assert.equal(brazilReceitaGate7SignoffValueKindIsAdmissible(kind), false, `${kind} must fail`);
    }
    // Fail-closed: a novel kind cannot pass merely by being absent from the forbidden list.
    assert.equal(brazilReceitaGate7SignoffValueKindIsAdmissible('free_text_note'), false);
  });
});

// ─── 14 · GATE-7's status ─────────────────────────────────────────────────────

describe('FAST-TRACK-6 · GATE-7 status (superseded by BR-SOURCE-FAST-TRACK-8 — see the dedicated FAST-TRACK-8 suite)', () => {
  // 🔴 UPDATED BY BR-SOURCE-FAST-TRACK-7, THEN BY BR-SOURCE-FAST-TRACK-8. FAST-TRACK-7 approved
  // GATE-2/5/6, discharging the dependency that made `blocked` correct, and moved GATE-7 to
  // `needs_evidence`. FAST-TRACK-8 recorded GATE-7's own joint owner approval, with the reproducibility
  // rehearsal WAIVED rather than performed. See
  // br-receita-cnpj-fast-track8-gate7-approval.test.ts for the full reasoning.
  it('is approved, and approved is GO-eligible', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_STATUS, 'approved');
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVED, true);
    assert.equal(BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(BRAZIL_RECEITA_GATE7_STATUS), true);
    assert.equal(brazilReceitaGateGlobalVerdict(), 'GO');
  });

  it('names the status it never occupied, and the criterion whose OTHER branch was taken', () => {
    // The gate went needs_evidence → approved directly: the waiver and the approval were one decision,
    // so there was never an interval in which evidence stood complete and an approver was awaited.
    assert.equal(BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED, 'ready_for_review');
    assert.notEqual(BRAZIL_RECEITA_GATE7_STATUS, BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED);
    assert.equal(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.thenStatusBecomes, 'ready_for_review');
    assert.equal(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.agentMayDischarge, false);
  });

  it('requires three joint approvers, and no agent may be any of them', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVAL_IS_JOINT, true);
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVER_COUNT, 3);
    assert.equal(BRAZIL_RECEITA_GATE7_AGENT_MAY_APPROVE, false);
  });

  it('lists NO remaining blocker, and the audit trail still names how the last one closed', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS], []);
    // 🔴 Empty is not "all criteria demonstrated". The last blocker closed by an owner WAIVER, and the
    // discharge record says so rather than letting the empty array imply evidence.
    const waived = BRAZIL_RECEITA_GATE7_BLOCKERS_DISCHARGED.filter(
      (entry) => entry.dischargedBy === 'owner_waiver',
    );
    assert.equal(waived.length, 1);
    assert.equal(waived[0]?.round, 'BR-SOURCE-FAST-TRACK-8');
  });

  it('reproducibility is STILL UNDEMONSTRATED after the approval, and the two records agree because one imports the other', () => {
    // 🔴 The approval did not move this value, and BR-SOURCE-FAST-TRACK-8 is the round with the most
    // incentive to have moved it. A waiver sits beside the value, never on top of it.
    assert.equal(BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR, 'UNDEMONSTRATED');
    assert.equal(BRAZIL_RECEITA_GATE7_REPRODUCIBILITY, 'UNDEMONSTRATED');
    assert.equal(BRAZIL_RECEITA_GATE7_REHEARSAL_PERFORMED, false);
    assert.equal(BRAZIL_RECEITA_GATE7_REHEARSAL_AUTHORIZED, false);
  });

  it('every one of 10K § 11\'s twelve required-evidence items now has a step', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_REQUIRED_EVIDENCE_DISPOSITION.length, 12);
    for (const item of BRAZIL_RECEITA_GATE7_REQUIRED_EVIDENCE_DISPOSITION) {
      assert.equal(item.present, true, `${item.evidence} has no step`);
      assert.ok(item.note.length > 0);
    }
  });

  // 🔴 UPDATED BY BR-SOURCE-FAST-TRACK-8. Two entries left this list when the gate was approved — "this
  // record approves no gate" and "the implementer of this subject may not approve this gate" — because
  // both became false statements: the record now carries an approval, supplied by three named owners
  // and not by the implementer. Every operational refusal below is unchanged, and four were added.
  it('the restrictions forbid every operational crossing, including a rehearsal', () => {
    const text = BRAZIL_RECEITA_GATE7_RESTRICTIONS.join(' | ');
    for (const refusal of [
      /PROCEDURE, never a PERMISSION/,
      /No rehearsal|no rehearsal/,
      /ATTEMPT_3_ALLOWED stays false/,
      /no real Receita data/,
      /no migration/,
      /UNDEMONSTRATED/,
      /never an agent/,
      // FAST-TRACK-8's own additions.
      /WAIVED by owner decision, not demonstrated/,
      /P-05 is unchanged and still has no bypass/,
      /GLOBAL becoming GO means only what 10K § 15 says/,
    ]) {
      assert.match(text, refusal);
    }
  });

  it('the assertion catalogue accounts for all twenty OR-A ids', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_ASSERTION_RECORDS.length, BRAZIL_RECEITA_GATE7_ASSERTION_TOTALS.total);
    assert.equal(BRAZIL_RECEITA_GATE7_ASSERTION_TOTALS.total, 20);
    for (let index = 1; index <= 20; index += 1) {
      const id = `OR-A${String(index).padStart(2, '0')}`;
      assert.ok(
        BRAZIL_RECEITA_GATE7_ASSERTION_RECORDS.some((record) => record.id === id),
        `${id} is unaccounted for`,
      );
    }
    const counts = {
      executableAndAsserted: BRAZIL_RECEITA_GATE7_ASSERTION_RECORDS.filter((r) => r.state === 'executable_and_asserted').length,
      operatorBehaviourRule: BRAZIL_RECEITA_GATE7_ASSERTION_RECORDS.filter((r) => r.state === 'operator_behaviour_rule').length,
      deferredToRehearsal: BRAZIL_RECEITA_GATE7_ASSERTION_RECORDS.filter((r) => r.state === 'deferred_to_rehearsal').length,
    };
    assert.equal(counts.executableAndAsserted, BRAZIL_RECEITA_GATE7_ASSERTION_TOTALS.executableAndAsserted);
    assert.equal(counts.operatorBehaviourRule, BRAZIL_RECEITA_GATE7_ASSERTION_TOTALS.operatorBehaviourRule);
    assert.equal(counts.deferredToRehearsal, BRAZIL_RECEITA_GATE7_ASSERTION_TOTALS.deferredToRehearsal);
    for (const record of BRAZIL_RECEITA_GATE7_ASSERTION_RECORDS) {
      assert.ok(record.dischargedBy.length > 0, `${record.id} has no discharge`);
    }
  });
});

// ─── 15 · The final owner signoff packet ──────────────────────────────────────

describe('FAST-TRACK-6 · the owner packet is a set of QUESTIONS, and refuses to be answers', () => {
  it('is not an approval, cannot be answered by an agent, and cannot be bundled', () => {
    assert.equal(BRAZIL_RECEITA_SIGNOFF_PACKET_IS_AN_APPROVAL, false);
    assert.equal(BRAZIL_RECEITA_SIGNOFF_AGENT_MAY_ANSWER, false);
    assert.equal(BRAZIL_RECEITA_SIGNOFF_DECISIONS_MAY_BE_BUNDLED, false);
    assert.equal(BRAZIL_RECEITA_SIGNOFF_APPROVAL_BY_INFERENCE_PERMITTED, false);
  });

  it('does NOT treat project technical direction as a human privacy signature', () => {
    // 🔴 The specific failure this packet exists to make impossible.
    assert.equal(BRAZIL_RECEITA_SIGNOFF_TECHNICAL_DIRECTION_IS_A_HUMAN_PRIVACY_APPROVAL, false);
  });

  it('covers five gates in seven separate, uniquely identified sections', () => {
    assert.deepEqual([...BRAZIL_RECEITA_SIGNOFF_COVERED_GATES], [2, 3, 4, 5, 6]);
    assert.equal(BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS.length, 7);
    const ids = BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS.map((section) => section.id);
    assert.equal(new Set(ids).size, 7, 'two sections sharing an id would collapse into one answer');
    const gates = [...new Set(BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS.map((s) => s.gate))].sort();
    assert.deepEqual(gates, [2, 3, 4, 5, 6]);
  });

  it('GATE-4 is three sections with three distinct authorities, never one bundled verdict', () => {
    const gate4 = BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS.filter((section) => section.gate === 4);
    assert.equal(gate4.length, 3);
    assert.deepEqual(gate4.map((section) => section.part), ['A', 'B', 'C']);
    const roles = gate4.flatMap((section) => [...section.requiredRoles]);
    assert.equal(new Set(roles).size, 3, 'the three GATE-4 authorities must be distinct');
  });

  it('every required response field is blank, and the validator agrees', () => {
    for (const section of BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS) {
      assert.ok(section.responseFields.length > 0, `${section.id} asks for no response`);
      assert.ok(section.requiredRoles.length > 0, `${section.id} names no role`);
      assert.ok(section.question.length > 0);
      assert.ok(section.restrictions.length > 0, `${section.id} records no restrictions`);
      assert.equal(section.approvalUnblocksExecution, false);
      for (const field of section.responseFields) {
        assert.equal(field.value, null, `${section.id}.${field.field} is PREFILLED`);
      }
    }
    // 🔴 UPDATED BY BR-SOURCE-FAST-TRACK-7 — as SHIPPED (no response field filled), the packet is
    // still unanswered by construction. But GATE-2, GATE-3, GATE-4, GATE-5 and GATE-6 have since been
    // approved by separate owner-relay records in their own gate modules, not by this packet — so the
    // validator now correctly reports every section `gate_already_approved`, which is the defect class
    // that exists precisely to catch a packet asking about an already-decided gate.
    const defects = findBrazilReceitaSignoffPacketDefects();
    assert.equal(defects.length, BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS.length);
    assert.ok(defects.every((finding) => finding.defect === 'gate_already_approved'));
    assert.equal(brazilReceitaSignoffPacketIsUnanswered(), false);
  });

  it('the validator REFUSES a packet whose response field has been filled', () => {
    const tampered = BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS.map((section) =>
      section.id === 'DECISION-GATE-2'
        ? {
            ...section,
            responseFields: section.responseFields.map((field) => ({
              ...field,
              value: 'APPROVED' as unknown as null,
            })),
          }
        : section,
    );
    const findings = findBrazilReceitaSignoffPacketDefects(tampered);
    // 🔴 UPDATED BY BR-SOURCE-FAST-TRACK-7 — every underlying gate is now approved via its own record,
    // so `gate_already_approved` findings exist for every section regardless of tampering. What this
    // test still proves is narrower and just as load-bearing: the DECISION-GATE-2 section specifically
    // carries a `prefilled_response_field` finding once its field is filled, on top of whatever other
    // finding it already carries.
    const gate2Findings = findings.filter((finding) => finding.section === 'DECISION-GATE-2');
    assert.ok(gate2Findings.length > 0, 'a prefilled field must be a defect');
    assert.ok(gate2Findings.some((finding) => finding.defect === 'prefilled_response_field'));
  });

  it('the validator refuses a duplicated section id, which is a bundled decision', () => {
    const duplicated = [
      ...BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS,
      BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS[0],
    ];
    const findings = findBrazilReceitaSignoffPacketDefects(duplicated);
    assert.ok(findings.some((finding) => finding.defect === 'bundled_decision'));
  });

  it('asks each gate the question its own approver role owns', () => {
    const byId = new Map(BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS.map((s) => [s.id, s]));
    assert.deepEqual([...(byId.get('DECISION-GATE-2')?.requiredRoles ?? [])], ['privacy owner']);
    assert.match(byId.get('DECISION-GATE-2')?.question ?? '', /structural_non_invertible_partition_metadata/);
    assert.match(byId.get('DECISION-GATE-3')?.question ?? '', /br_receita_cnpj_field_allowlist_v1/);
    assert.match(byId.get('DECISION-GATE-4-A-LEGAL')?.question ?? '', /exactly \*\*ONE\*\*|exactly \*\*|ONE/);
    assert.match(byId.get('DECISION-GATE-4-B-ARCHITECTURE')?.question ?? '', /OPTION_D/);
    assert.match(byId.get('DECISION-GATE-4-C-PRODUCT')?.question ?? '', /fuzzy-name/);
    assert.match(byId.get('DECISION-GATE-5')?.question ?? '', /CORRECTED/);
    assert.match(byId.get('DECISION-GATE-6')?.question ?? '', /verified/i);
    assert.deepEqual([...(byId.get('DECISION-GATE-5')?.requiredRoles ?? [])], [
      'security/privacy owner',
      'test owner',
    ]);
    assert.deepEqual([...(byId.get('DECISION-GATE-6')?.requiredRoles ?? [])], [
      'technical owner',
      'operator owner',
    ]);
  });

  it('names the CORRECTED GATE-5 terms, so no approver blesses the superseded contract', () => {
    const text = BRAZIL_RECEITA_SIGNOFF_GATE5_SUBJECT_TERMS.join(' | ');
    assert.match(text, /k = 10/);
    assert.match(text, /64/);
    assert.match(text, /total_rows_scanned is INTERNAL ONLY/);
    assert.match(text, /records_persisted/);
    assert.match(text, /records_seen_by_family/);
    assert.match(text, /suppressed_other/);
  });

  it('GATE-4 approval does NOT unblock Brazil snapshot writes', () => {
    assert.equal(BRAZIL_RECEITA_SIGNOFF_GATE4_WRITES_REMAIN_BLOCKED.brazilSnapshotWritesBlocked, true);
    assert.equal(BRAZIL_RECEITA_SIGNOFF_GATE4_WRITES_REMAIN_BLOCKED.unblockedByGate4Approval, false);
    assert.match(
      BRAZIL_RECEITA_SIGNOFF_GATE4_WRITES_REMAIN_BLOCKED.reason,
      /source_period/,
    );
    assert.match(
      BRAZIL_RECEITA_SIGNOFF_GATE4_WRITES_REMAIN_BLOCKED.requiredFutureMigration,
      /NOT authored or applied here/,
    );
  });

  it('GATE-7 is absent from the packet, and the reason is recorded', () => {
    assert.equal(BRAZIL_RECEITA_SIGNOFF_COVERED_GATES.includes(7), false);
    assert.match(BRAZIL_RECEITA_SIGNOFF_GATE7_ABSENT_REASON, /blocked by GATE-2, GATE-5 and GATE-6/);
  });

  it('enumerates what stays forbidden even after every section returns APPROVED', () => {
    const text = BRAZIL_RECEITA_SIGNOFF_STILL_FORBIDDEN_AFTER_EVERY_APPROVAL.join(' | ');
    for (const refusal of [
      /reading real Receita data/,
      /executing the full join/,
      /benchmark/,
      /migration/,
      /Supabase write/,
      /snapshot write/,
      /source_period/,
      /Agent 1/,
      /provider call/,
      /production/,
      /runner code/,
    ]) {
      assert.match(text, refusal);
    }
  });

  it('the packet document exists and its response fields are blank there too', () => {
    const packet = repoDoc('docs/source-catalog/br-receita-cnpj-final-owner-signoff-packet.md');
    assert.match(packet, /is not an approval/);
    for (const field of [
      'GATE2_BUCKET_ORDINAL_PRIVACY',
      'GATE3_FIELD_POLICY',
      'GATE4_INTERNAL_CNPJ_LOOKUP_EXCEPTION',
      'GATE4_DATA_ARCHITECTURE',
      'GATE4_PRODUCT',
      'GATE5_OUTPUT_SANITIZATION',
      'GATE6_CLEANUP_CONTRACT',
    ]) {
      assert.match(
        packet,
        new RegExp(`${field}\\s*=\\s*APPROVED \\| NOT_APPROVED`),
        `${field} must be offered as a CHOICE, never as a filled verdict`,
      );
    }
    // 🔴 No date and no role may be prefilled anywhere in the packet.
    assert.match(packet, /<actual human date>/);
    assert.ok(
      !/APPROVAL_DATE\s*=\s*20\d\d-\d\d-\d\d/.test(packet),
      'a prefilled approval date would make the packet an approval',
    );
  });
});

// ─── 16 · Static guards — what this round did NOT do ──────────────────────────

describe('FAST-TRACK-6 · the new modules are pure, unwired, and carry no identifier', () => {
  it('emits nothing to console or to a process stream', () => {
    for (const modulePath of THE_FAST_TRACK_6_MODULES) {
      const code = connectorCode(modulePath);
      assert.ok(!/console\s*\./.test(code), `${modulePath} calls console`);
      assert.ok(!/process\s*\.\s*std(out|err)/.test(code), `${modulePath} writes to a process stream`);
    }
  });

  it('imports nothing that could perform I/O', () => {
    for (const modulePath of THE_FAST_TRACK_6_MODULES) {
      const code = connectorCode(modulePath);
      for (const forbidden of [
        /from 'node:fs'/,
        /from 'node:path'/,
        /from 'node:child_process'/,
        /from 'node:http/,
        /from 'node:net'/,
        /\bfetch\s*\(/,
        /process\s*\.\s*env/,
      ]) {
        assert.ok(!forbidden.test(code), `${modulePath} reaches for ${forbidden}`);
      }
    }
  });

  it('every module this round adds or grows stays under the 800-line ceiling', () => {
    // The project style caps a file at 800 lines. Both of this round's largest modules crossed it
    // before being split along a cohesive seam — the preflight enumeration and the owner-direction
    // decision log each answer a different question from the module they came out of.
    for (const modulePath of [
      ...THE_FAST_TRACK_6_MODULES,
      '../br-receita-cnpj-gate5-output-contract.ts',
      '../br-receita-cnpj-gate5-output-guard.ts',
      '../br-receita-cnpj-gate5-recorded-output-sanitization.ts',
    ]) {
      const lines = rawConnectorSource(modulePath).split('\n').length;
      assert.ok(lines <= 800, `${modulePath} is ${lines} lines, over the 800-line ceiling`);
    }
  });

  it('carries no bare digit run of eight or more positions, comments included', () => {
    for (const modulePath of THE_FAST_TRACK_6_MODULES) {
      const source = rawConnectorSource(modulePath);
      const runs = source.match(/(?<!\d)\d{8,}(?!\d)/g) ?? [];
      assert.deepEqual(runs, [], `${modulePath} carries a bare digit run of 8+ positions`);
    }
  });

  it('the GATE-7 runbook does not import or call the GATE-5 guard', () => {
    // It NAMES the contract as an authority, which is provenance. Wiring would be different.
    const code = connectorCode('../br-receita-cnpj-gate7-operator-runbook.ts');
    assert.ok(
      !/(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"][^'"]*br-receita-cnpj-gate5-output-(?:guard|contract)['"]/.test(
        code,
      ),
      'the GATE-7 module must not import the GATE-5 guard or contract',
    );
    assert.ok(!/guardBrazilReceitaGate5Report\s*\(/.test(code), 'and must not call it');
  });

  it('no execution path imports the GATE-7 runbook except its recorded module and the state view', () => {
    const dir = new URL('../', import.meta.url);
    const importers = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => !name.startsWith('br-receita-cnpj-gate7-'))
      .filter((name) =>
        /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"][^'"]*br-receita-cnpj-gate7-operator-runbook['"]/.test(
          codeWithoutComments(fs.readFileSync(new URL(name, dir), 'utf8')),
        ),
      );
    assert.deepEqual(importers, [], 'the runbook contract must not be wired into any execution path');
  });

  it('the full-join runner is untouched by this round', () => {
    const runner = connectorCode('../br-receita-cnpj-full-join-dry-run-runner.ts');
    assert.ok(!/gate7-operator-runbook|final-owner-signoff-packet/.test(runner));
  });

  it('this suite is a REQUIRED CI step, asserted on the run: line and not the step name', () => {
    const workflow = fs.readFileSync(
      new URL('../../../../../../.github/workflows/automatic-routing-tests.yml', import.meta.url),
      'utf8',
    );
    // 🔴 Grep the `run:` lines, never the step NAMES. A step whose name mentions a suite it does not
    // invoke is a false positive, and this repository has been caught by exactly that before.
    const runLines = workflow
      .split('\n')
      .filter((line) => /^\s*run:\s/.test(line))
      .join('\n');
    assert.match(runLines, /npm run test:br-source:fast-track6-gate5-and-gate7/);
  });

  it('10K records both corrections in their own subsections', () => {
    const checklist = repoDoc(
      'docs/source-catalog/br-receita-cnpj-full-join-approval-gates-checklist.md',
    );
    assert.match(checklist, /^### 9\.2 /m);
    assert.match(checklist, /^### 11\.1 /m);
    // 🔴 UPDATED BY BR-SOURCE-FAST-TRACK-7 — § 11's top pointer now supersedes to § 11.2, the
    // subsection that most recently set GATE-7's status. § 11.1 itself is untouched and still exists.
    assert.match(checklist, /SUPERSEDED BY § 11\.2/);
  });
});
