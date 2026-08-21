/**
 * BR-SOURCE-GATE-ROUND-3 — GATE-5 output sanitization, and the lines this round must not cross.
 *
 * Round 3 freezes GATE-5's output contract with the owner's values, makes every rule in it a
 * predicate, and corrects the status read that Round 2's post-merge report got wrong. Each of those
 * has a way of quietly becoming something bigger than it is, and this suite exists for those ways:
 *
 *   · GATE-5 could look approved because the rules now execute. It is `ready_for_review`, blocked by
 *     the rule that the implementer of a subject may not approve it.
 *   · the frozen contract could look like it resolved its own collisions. `total_rows_scanned` is
 *     ALLOWED by owner direction and is refused by two invariants that already exist. Both are
 *     asserted RECORDED and asserted UNRESOLVED, and BR-SOURCE-11A is asserted un-weakened.
 *   · the allowlist could look like decoration next to the denylist. `OS-A08` is asserted to refuse a
 *     key that passes every denylist rule — which is the only test that proves an allowlist governs.
 *   · small-cell suppression could look done because `k` exists. Complementary suppression, the
 *     single-count residual, the absorb-until-`k` loop and the outright FAILURE state are each
 *     asserted, because publishing a family total next to one suppressed cell suppresses nothing.
 *   · the error envelope could look sanitized at print time. It is asserted sanitized at
 *     CONSTRUCTION, and asserted to have nowhere to put a stack or an interpolated message.
 *   · the status correction could look like history being rewritten. 10K keeps its original lines;
 *     the guard asserts each stale one is explicitly annotated instead.
 *   · the three EXCLUDED breakdowns could look like an oversight. Their absence from the allowlist is
 *     asserted to be the exclusion being enforced.
 *
 * Pure and synthetic: no network, no Supabase, no provider, no real Receita data, no benchmark, no
 * filesystem write. The only files read are repository sources and 10K itself, for static guards.
 * Every digit-bearing fixture is GENERATED in-suite, so no identifier of any length is a literal
 * here. 0 credits, 0 writes, 0 migrations.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';

import {
  BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS,
  BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS,
  BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST,
  BRAZIL_RECEITA_GATE5_ALLOWLIST_GOVERNS,
  BRAZIL_RECEITA_GATE5_COMPLEMENTARY_SUPPRESSION_REQUIRED,
  BRAZIL_RECEITA_GATE5_CROSS_TABULATIONS_PERMITTED,
  BRAZIL_RECEITA_GATE5_ERROR_CODES,
  BRAZIL_RECEITA_GATE5_ERROR_ENVELOPE_FIELDS,
  BRAZIL_RECEITA_GATE5_EVIDENCE_ALLOWED_CONTENT,
  BRAZIL_RECEITA_GATE5_EVIDENCE_ASSEMBLED_FROM_PASSED_ARTIFACTS_ONLY,
  BRAZIL_RECEITA_GATE5_EVIDENCE_FORBIDDEN_CONTENT,
  BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_GROUPS,
  BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_LIST_HAS_EQUIVALENTS_TAIL,
  BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_LIST_IS_CLOSED,
  BRAZIL_RECEITA_GATE5_GENERIC_ERROR_CODE,
  BRAZIL_RECEITA_GATE5_LOG_EVENT_FIELDS,
  BRAZIL_RECEITA_GATE5_LOG_INTERPOLATION_PERMITTED,
  BRAZIL_RECEITA_GATE5_MACHINE_UNDETECTABLE_SURFACE,
  BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH,
  BRAZIL_RECEITA_GATE5_NAMED_MUNICIPALITY_COUNTS_PERMITTED,
  BRAZIL_RECEITA_GATE5_OUTPUT_SANITIZATION_VERSION,
  BRAZIL_RECEITA_GATE5_OUTPUT_SURFACES,
  BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS,
  BRAZIL_RECEITA_GATE5_PER_RECORD_LOG_LINES_PERMITTED,
  BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL,
  BRAZIL_RECEITA_GATE5_SANITIZE_AT_CONSTRUCTION,
  BRAZIL_RECEITA_GATE5_SANITIZER_REPORTS_ITS_INPUT,
  BRAZIL_RECEITA_GATE5_SMALL_CELL_K,
  BRAZIL_RECEITA_GATE5_STACK_OUTPUT_PERMITTED,
  BRAZIL_RECEITA_GATE5_SUPPRESSED_BUCKET_FAMILIES,
  BRAZIL_RECEITA_GATE5_SUPPRESSION_EXEMPT_KEYS,
  BRAZIL_RECEITA_GATE5_SURFACE_EXEMPTIONS,
} from '../br-receita-cnpj-gate5-output-contract';
import {
  BRAZIL_RECEITA_GATE5_VP_RESIDUAL_DIGIT_RUN_GAP,
  applyBrazilReceitaGate5SmallCellSuppression,
  checkBrazilReceitaGate5StringValue,
  containsBrazilReceitaGate5EmailMarker,
  createBrazilReceitaGate5SanitizedError,
  exceedsBrazilReceitaGate5StringLength,
  findBrazilReceitaGate5DigitRunViolations,
  guardBrazilReceitaGate5LogEvent,
  guardBrazilReceitaGate5RenderedOutput,
  guardBrazilReceitaGate5Report,
  isBrazilReceitaGate5AdmissibleCount,
  isBrazilReceitaGate5AdmissibleStringValue,
  isBrazilReceitaGate5AllowedKey,
  isBrazilReceitaGate5ErrorEnvelopeShape,
  isBrazilReceitaGate5ForbiddenKey,
  matchBrazilReceitaGate5ForbiddenKeyGroup,
  normalizeBrazilReceitaGate5Key,
} from '../br-receita-cnpj-gate5-output-guard';
import {
  BRAZIL_RECEITA_GATE5_AGENT_MAY_APPROVE,
  BRAZIL_RECEITA_GATE5_APPROVAL_IS_JOINT,
  BRAZIL_RECEITA_GATE5_APPROVED,
  BRAZIL_RECEITA_GATE5_ASSERTION_RECORDS,
  BRAZIL_RECEITA_GATE5_ASSERTION_TOTALS,
  BRAZIL_RECEITA_GATE5_DECISIONS_INSIDE_THE_REVIEW,
  BRAZIL_RECEITA_GATE5_RESTRICTIONS,
  BRAZIL_RECEITA_GATE5_SECURITY_PRIVACY_APPROVER_ROLE,
  BRAZIL_RECEITA_GATE5_SINGLE_REMAINING_CRITERION,
  BRAZIL_RECEITA_GATE5_STATUS,
  BRAZIL_RECEITA_GATE5_SUPERSEDED_ASSERTIONS,
  BRAZIL_RECEITA_GATE5_TEST_APPROVER_ROLE,
} from '../br-receita-cnpj-gate5-recorded-output-sanitization';
import {
  BRAZIL_RECEITA_GATE_APPROVED_STATUSES,
  BRAZIL_RECEITA_GATE_CURRENT_STATE,
  BRAZIL_RECEITA_GATE_STATUSES,
  BRAZIL_RECEITA_GATE_STATUSES_ADDED_AFTER_10K,
  BRAZIL_RECEITA_GATES_WITH_SUPERSEDED_SECTION_STATUS,
  brazilReceitaApprovedGateCount,
  brazilReceitaGateGlobalVerdict,
} from '../br-receita-cnpj-gate-status-current-state';
import { BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF } from '../br-receita-cnpj-full-join-output-sanitizer';
import { BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL } from '../br-receita-cnpj-full-join-resource-envelope';
import { BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS } from '../br-receita-cnpj-gate8-recorded-contract-approval';
import { BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED } from '../br-receita-cnpj-real-benchmark-attempt-ledger';

// ─── Static-guard helpers ─────────────────────────────────────────────────────

/**
 * Removes comments so a scan asserts what a module DOES rather than what its prose says. Round 2
 * learned this the hard way: a raw scan flags the very sentence that promises the safety.
 */
function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function connectorCode(relativePath: string): string {
  return codeWithoutComments(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

function rawConnectorSource(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

/**
 * Removes string and template literals as well as comments.
 *
 * 🔴 Necessary for the same reason Round 2 needed comment-stripping, one level deeper. This round's
 * contract module DATA legitimately contains the tokens a naive bypass scan looks for: `'debug'` is
 * an entry in the § 5.2 denylist, and `'supabase_write'` is an entry in the § 6 allowlist. A scan
 * that cannot tell a forbidden-key NAME from a bypass SWITCH flags the enumeration that forbids it.
 */
function executableCodeOnly(source: string): string {
  return codeWithoutComments(source)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function connectorExecutableCode(relativePath: string): string {
  return executableCodeOnly(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

function checklistDoc(): string {
  return fs.readFileSync(
    new URL(
      '../../../../../../docs/source-catalog/br-receita-cnpj-full-join-approval-gates-checklist.md',
      import.meta.url,
    ),
    'utf8',
  );
}

/** Generates a digit run of `length`. Nothing digit-bearing is a literal in this suite. */
function digitRun(length: number): string {
  return '4'.repeat(length);
}

const THE_ROUND_3_MODULES = [
  '../br-receita-cnpj-gate5-output-contract.ts',
  '../br-receita-cnpj-gate5-output-guard.ts',
  '../br-receita-cnpj-gate5-recorded-output-sanitization.ts',
  '../br-receita-cnpj-gate-status-current-state.ts',
] as const;

// ─── 1 · The status read that Round 2's report got wrong ──────────────────────

describe('GATE-ROUND-3 · the current gate state is authoritative and mechanically unambiguous', () => {
  it('reports the eight statuses entering this round, not eight not_starteds', () => {
    const byGate = new Map(BRAZIL_RECEITA_GATE_CURRENT_STATE.map((e) => [e.gate, e.status]));
    assert.equal(byGate.get(1), 'approved');
    assert.equal(byGate.get(2), 'needs_owner_confirmation');
    assert.equal(byGate.get(3), 'ready_for_review');
    assert.equal(byGate.get(4), 'needs_owner_decision');
    assert.equal(byGate.get(5), 'ready_for_review');
    assert.equal(byGate.get(6), 'ready_for_review');
    assert.equal(byGate.get(7), 'not_started');
    assert.equal(byGate.get(8), 'APPROVED_AS_CONTRACT');
    assert.equal(BRAZIL_RECEITA_GATE_CURRENT_STATE.length, 8);
  });

  it('every status is a member of the vocabulary in force', () => {
    for (const entry of BRAZIL_RECEITA_GATE_CURRENT_STATE) {
      assert.ok(
        BRAZIL_RECEITA_GATE_STATUSES.includes(entry.status),
        `gate ${entry.gate} carries a status outside the vocabulary`,
      );
    }
  });

  it('the three statuses the recorded rounds added are declared rather than silently used', () => {
    for (const added of BRAZIL_RECEITA_GATE_STATUSES_ADDED_AFTER_10K) {
      assert.ok(BRAZIL_RECEITA_GATE_STATUSES.includes(added));
    }
    assert.deepEqual([...BRAZIL_RECEITA_GATE_STATUSES_ADDED_AFTER_10K], [
      'needs_owner_confirmation',
      'needs_owner_decision',
      'APPROVED_AS_CONTRACT',
    ]);
  });

  it('the global verdict is NO-GO, and two gates are approved — not zero and not eight', () => {
    assert.equal(brazilReceitaGateGlobalVerdict(), 'NO-GO');
    assert.equal(brazilReceitaApprovedGateCount(), 2);
  });

  it('ready_for_review and both needs_owner_* statuses are NOT approved statuses', () => {
    for (const status of [
      'ready_for_review',
      'needs_owner_confirmation',
      'needs_owner_decision',
      'not_started',
      'needs_evidence',
    ] as const) {
      assert.ok(
        !BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(status),
        `${status} must not count as approved`,
      );
    }
  });

  it('every gate whose 10K section line is stale carries an explicit SUPERSEDED BY annotation', () => {
    const doc = checklistDoc();
    // The per-gate sections, in document order, each opening with `## N. GATE-n — ...`.
    const sections = doc.split(/^## \d+\. GATE-/m).slice(1);
    assert.equal(sections.length, 8, 'expected exactly eight GATE- sections in 10K');

    for (const [index, body] of sections.entries()) {
      const gate = index + 1;
      const statusLine = /\*\*Status today[^:]*:\*\*(.*)$/m.exec(body);
      assert.ok(statusLine, `GATE-${gate} has no Status today line`);
      const line = statusLine[1];
      const current = BRAZIL_RECEITA_GATE_CURRENT_STATE.find((e) => e.gate === gate);
      assert.ok(current);

      const lineNamesCurrent = line.includes(`\`${current.status}\``);
      const lineIsAnnotated = /SUPERSEDED BY §/.test(line);
      assert.ok(
        lineNamesCurrent || lineIsAnnotated,
        `GATE-${gate} Status today line is stale (current: ${current.status}) and carries no SUPERSEDED BY annotation`,
      );
      if (lineIsAnnotated) {
        assert.ok(
          new RegExp(`SUPERSEDED BY §\\s*${current.recordedIn.replace('§ ', '')}`).test(line),
          `GATE-${gate} annotation must name ${current.recordedIn}, the subsection that set the current status`,
        );
      }
    }
  });

  it('10K § 15 carries no stale per-gate prose contradicting its own current-state summary', () => {
    const doc = checklistDoc();
    const matrix = doc.slice(doc.indexOf('## 15. Global GO / NO-GO matrix'));
    // Round 1 left "the gate is `needs_evidence`" for GATE-3 in § 15's reader-warning bullets while
    // the matrix above it already read `ready_for_review`. One document, two answers.
    assert.ok(
      !/GATE-3[^#]*?the gate is `needs_evidence`/.test(matrix.replace(/\n/g, ' ')),
      '§ 15 still describes GATE-3 as needs_evidence while its matrix reads ready_for_review',
    );
    for (const entry of BRAZIL_RECEITA_GATE_CURRENT_STATE) {
      assert.ok(
        matrix.includes(`GATE-${entry.gate}`),
        `§ 15 must name GATE-${entry.gate} in its current-state block`,
      );
    }
  });

  it('the stale-section list is derived, so a future status change cannot leave it behind', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATES_WITH_SUPERSEDED_SECTION_STATUS], [2, 3, 4, 5, 6, 8]);
  });
});

// ─── 2 · GATE-5 is ready_for_review, and NOT approved ─────────────────────────

describe('GATE-ROUND-3 · GATE-5 advanced its reviewability, not its permission', () => {
  it('is ready_for_review and explicitly not approved', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_STATUS, 'ready_for_review');
    assert.equal(BRAZIL_RECEITA_GATE5_APPROVED, false);
  });

  it('requires both named approvers jointly, and no agent may supply either half', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_SECURITY_PRIVACY_APPROVER_ROLE, 'security/privacy owner');
    assert.equal(BRAZIL_RECEITA_GATE5_TEST_APPROVER_ROLE, 'test owner');
    assert.equal(BRAZIL_RECEITA_GATE5_APPROVAL_IS_JOINT, true);
    assert.equal(BRAZIL_RECEITA_GATE5_AGENT_MAY_APPROVE, false);
    assert.equal(BRAZIL_RECEITA_GATE5_SINGLE_REMAINING_CRITERION.agentMayApprove, false);
  });

  it('names the implementer rule as the exact reason it cannot approve itself', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_SINGLE_REMAINING_CRITERION.blockedByImplementerRule, true);
    assert.match(BRAZIL_RECEITA_GATE5_SINGLE_REMAINING_CRITERION.implementerRule, /10K § 3/);
  });

  it('carries restrictions that refuse every permission an approval might be read as', () => {
    const text = BRAZIL_RECEITA_GATE5_RESTRICTIONS.join(' | ');
    for (const refusal of [
      /does not authorize executing the full join/,
      /does not authorize emitting any report from real data/,
      /does not freeze the 10J § 12 report SCHEMA/,
      /flips no operational flag/,
    ]) {
      assert.match(text, refusal);
    }
  });

  it('names the substantive decisions the approvers still owe rather than burying them', () => {
    assert.ok(BRAZIL_RECEITA_GATE5_DECISIONS_INSIDE_THE_REVIEW.length >= 6);
    const text = BRAZIL_RECEITA_GATE5_DECISIONS_INSIDE_THE_REVIEW.join(' | ');
    assert.match(text, /OD-C1/);
    assert.match(text, /OD-C2/);
    assert.match(text, /OS-A34/);
  });
});

// ─── 3 · The owner technical direction, as frozen ─────────────────────────────

describe('GATE-ROUND-3 · the owner values are frozen and the two unenforceable rules became enforceable', () => {
  it('sets k = 10 and the string ceiling at 64', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_SMALL_CELL_K, 10);
    assert.equal(BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH, 64);
  });

  it('prohibits cross-tabulations, named municipality counts, and stack output', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_CROSS_TABULATIONS_PERMITTED, false);
    assert.equal(BRAZIL_RECEITA_GATE5_NAMED_MUNICIPALITY_COUNTS_PERMITTED, false);
    assert.equal(BRAZIL_RECEITA_GATE5_STACK_OUTPUT_PERMITTED, false);
  });

  it('records the exact disposition of every aggregate the direction names', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS.total_rows_scanned, 'allowed');
    assert.equal(
      BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS.cnae_section_counts,
      'allowed_with_small_cell_suppression',
    );
    assert.equal(
      BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS.uf_counts,
      'allowed_with_small_cell_suppression',
    );
    assert.equal(
      BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS.named_municipality_counts,
      'prohibited',
    );
    for (const excluded of [
      'capital_social_bucket_counts',
      'opened_at_bucket_counts',
      'municipality_count_distribution',
    ]) {
      assert.equal(BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS[excluded], 'excluded');
    }
    for (const prohibited of [
      'raw_row_output',
      'raw_cell_output',
      'identity_key_output',
      'stack_output',
      'cross_tabulations',
    ]) {
      assert.equal(BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS[prohibited], 'prohibited');
    }
  });

  it('ENFORCES the three exclusions by their absence from the frozen allowlist', () => {
    for (const excluded of [
      'capital_social_bucket_counts',
      'opened_at_bucket_counts',
      'municipality_count_distribution',
    ]) {
      assert.ok(
        !BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.includes(excluded),
        `${excluded} is EXCLUDED by owner direction and must be absent from the allowlist`,
      );
      // And absence must actually refuse it, not merely omit it.
      assert.equal(isBrazilReceitaGate5AllowedKey(excluded), false);
    }
    // The two the owner allowed are present, so the exclusions are a decision and not a purge.
    assert.ok(BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.includes('cnae_section_counts'));
    assert.ok(BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.includes('uf_counts'));
    assert.ok(BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.includes('total_rows_scanned'));
  });

  it('applies to all twelve surfaces with no exemption, no debug mode, no override', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_OUTPUT_SURFACES.length, 12);
    assert.deepEqual([...BRAZIL_RECEITA_GATE5_SURFACE_EXEMPTIONS], []);
    assert.equal(
      BRAZIL_RECEITA_GATE5_MACHINE_UNDETECTABLE_SURFACE,
      'screenshots_or_copied_terminal_output',
    );
  });

  it('binds a version marker so two reports under different contracts are distinguishable', () => {
    assert.equal(
      BRAZIL_RECEITA_GATE5_OUTPUT_SANITIZATION_VERSION,
      'br_receita_cnpj_output_sanitization_v1',
    );
    assert.ok(BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.includes('output_sanitization_version'));
  });
});

// ─── 4 · The two collisions the owner values create ───────────────────────────

describe('GATE-ROUND-3 · the owner-direction collisions are RECORDED and left to the approvers', () => {
  it('records all three collisions against their real owning symbols', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS.length, 3);
    const byId = new Map(BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS.map((c) => [c.id, c]));
    assert.equal(
      byId.get('OD-C1')?.collidesWith,
      'BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF',
    );
    assert.equal(byId.get('OD-C2')?.collidesWith, 'VP-1 and VP-4');
    assert.equal(byId.get('OD-C3')?.collidesWith, 'the § 5.2 closed denylist, group 7');
  });

  it('OD-C3 is real: the residual label 10O § 7 MANDATES is refused by 10O § 5.2 group 7', () => {
    // `other_or_suppressed_small_cell` contains `cell`. The one label small-cell suppression is
    // required to emit is caught by the same record's key rule.
    assert.equal(
      matchBrazilReceitaGate5ForbiddenKeyGroup(BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL),
      7,
    );
    // This round admits it under the allowlist-governs precedence and edits neither list.
    const byId = new Map(BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS.map((c) => [c.id, c]));
    assert.equal(byId.get('OD-C3')?.resolvedByThisRound, false);
    assert.equal(byId.get('OD-C3')?.weakenedByThisRound, false);
    assert.match(byId.get('OD-C3')?.ownerChoice ?? '', /rename the residual label/);
  });

  it('neither collision is claimed resolved, and neither invariant was weakened', () => {
    for (const collision of BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS) {
      assert.equal(collision.resolvedByThisRound, false);
      assert.equal(collision.weakenedByThisRound, false);
      assert.ok(collision.ownerChoice.length > 0, 'a recorded collision must name the owner choice');
    }
  });

  it('BR-SOURCE-11A is un-weakened: the numeric ceiling and the 8-or-more digit run both stand', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF, 9_999_999);
    const sanitizer = connectorCode('../br-receita-cnpj-full-join-output-sanitizer.ts');
    assert.match(sanitizer, /LONG_DIGIT_RUN\s*=\s*\/\(\?<!\\d\)\\d\{8,\}/);
  });

  it('OD-C1 is real: a national-scale row total exceeds the 11A ceiling', () => {
    // Generated, not a literal: an eight-digit magnitude is what a national total looks like.
    const nationalScaleTotal = Number(digitRun(8));
    assert.ok(nationalScaleTotal > BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF);
  });

  it('OD-C2 is real: the same total, once rendered, is refused by the digit-run rules', () => {
    const rendered = JSON.stringify({ total_rows_scanned: Number(digitRun(8)) });
    const outcome = guardBrazilReceitaGate5RenderedOutput(rendered);
    assert.equal(outcome.ok, false);
    assert.ok(outcome.findings.some((f) => f.rule === 'VP-1'));
  });

  it('records the VP-1..VP-4 residual gap rather than widening the frozen rules', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATE5_VP_RESIDUAL_DIGIT_RUN_GAP.uncoveredRunLengths], [
      9, 10, 12, 13,
    ]);
    assert.equal(BRAZIL_RECEITA_GATE5_VP_RESIDUAL_DIGIT_RUN_GAP.widenedByThisRound, false);
    assert.equal(BRAZIL_RECEITA_GATE5_VP_RESIDUAL_DIGIT_RUN_GAP.coveredElsewhereBy, 'LONG_DIGIT_RUN');
    // And the gap is genuinely there, in the frozen rules as written.
    for (const length of [9, 10, 12, 13]) {
      assert.deepEqual(
        findBrazilReceitaGate5DigitRunViolations(`x${digitRun(length)}x`),
        [],
        `a ${length}-position run is uncovered by the frozen VP rules, as recorded`,
      );
    }
  });
});

// ─── 5 · VP-1 … VP-10, executable ─────────────────────────────────────────────

describe('GATE-ROUND-3 · VP-1 … VP-10 are predicates, not prose', () => {
  it('VP-1, VP-2, VP-3 reject runs of exactly 8, 11 and 14 positions', () => {
    assert.deepEqual(findBrazilReceitaGate5DigitRunViolations(`a${digitRun(8)}b`), ['VP-1']);
    assert.deepEqual(findBrazilReceitaGate5DigitRunViolations(`a${digitRun(11)}b`), ['VP-2']);
    assert.deepEqual(findBrazilReceitaGate5DigitRunViolations(`a${digitRun(14)}b`), ['VP-3']);
  });

  it('VP-4 rejects a run longer than 14 — the gap concatenation walks through', () => {
    assert.deepEqual(findBrazilReceitaGate5DigitRunViolations(`a${digitRun(20)}b`), ['VP-4']);
  });

  it('VP-5 catches a formatted identifier a bare-run rule alone would miss', () => {
    // Eight digits split by separators: no 8-run in the raw text, one in the stripped form.
    const formatted = `${digitRun(2)}.${digitRun(3)}.${digitRun(3)}`;
    assert.deepEqual([...findBrazilReceitaGate5DigitRunViolations(formatted)].sort(), ['VP-1', 'VP-5']);
  });

  it('VP-5 checks the raw form too, so a bare run is not reported as separator-only', () => {
    const hits = findBrazilReceitaGate5DigitRunViolations(`a${digitRun(14)}b`);
    assert.ok(hits.includes('VP-3'));
    assert.ok(!hits.includes('VP-5'), 'a bare run is not a separator-insensitive-only finding');
  });

  it('VP-6 rejects the email MARKER, which is broader than an address shape', () => {
    const marker = String.fromCharCode(64);
    assert.equal(containsBrazilReceitaGate5EmailMarker(`stage${marker}three`), true);
    assert.equal(containsBrazilReceitaGate5EmailMarker('stage_three'), false);
  });

  it('VP-7 admits a closed-enum literal or a numeral, and refuses free text', () => {
    assert.equal(isBrazilReceitaGate5AdmissibleStringValue('not_approved', ['not_approved']), true);
    assert.equal(isBrazilReceitaGate5AdmissibleStringValue('12', []), true);
    assert.equal(
      isBrazilReceitaGate5AdmissibleStringValue('a company in Sao Paulo', ['not_approved']),
      false,
    );
    // Fail-closed default: an empty literal set admits numerals only.
    assert.equal(isBrazilReceitaGate5AdmissibleStringValue('not_approved', []), false);
  });

  it('VP-8 refuses a string beyond the owner ceiling and admits one at it', () => {
    assert.equal(
      exceedsBrazilReceitaGate5StringLength('x'.repeat(BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH)),
      false,
    );
    assert.equal(
      exceedsBrazilReceitaGate5StringLength(
        'x'.repeat(BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH + 1),
      ),
      true,
    );
  });

  it('VP-9 refuses a non-integer count, a float, and a string count', () => {
    assert.equal(isBrazilReceitaGate5AdmissibleCount(10), true);
    assert.equal(isBrazilReceitaGate5AdmissibleCount(0), true);
    assert.equal(isBrazilReceitaGate5AdmissibleCount(10.5), false);
    assert.equal(isBrazilReceitaGate5AdmissibleCount('10'), false);
    assert.equal(isBrazilReceitaGate5AdmissibleCount(Number.POSITIVE_INFINITY), false);
    assert.equal(isBrazilReceitaGate5AdmissibleCount(null), false);
  });

  it('VP-10 refuses a count-map KEY outside the closed bucket enum — where the datum hides', () => {
    const outcome = guardBrazilReceitaGate5Report(
      { uf_counts: { alpha: 12, an_unexpected_place_name: 40 } },
      {
        countMapKeys: ['uf_counts'],
        allowedBucketLabels: ['alpha'],
      },
    );
    assert.equal(outcome.ok, false);
    const vp10 = outcome.findings.filter((f) => f.rule === 'VP-10');
    assert.equal(vp10.length, 1);
    assert.equal(vp10[0].path, 'uf_counts.an_unexpected_place_name');
  });

  it('VP-10 admits the residual label without it being declared, since the contract names it', () => {
    const outcome = guardBrazilReceitaGate5Report(
      { uf_counts: { [BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL]: 30 } },
      { countMapKeys: ['uf_counts'], allowedBucketLabels: [] },
    );
    assert.equal(outcome.ok, true);
  });

  it('a count-map key carrying a digit run is refused even though its value is a safe integer', () => {
    const outcome = guardBrazilReceitaGate5Report(
      { uf_counts: { [digitRun(8)]: 40 } },
      { countMapKeys: ['uf_counts'], allowedBucketLabels: [digitRun(8)] },
    );
    assert.equal(outcome.ok, false);
    assert.ok(outcome.findings.some((f) => f.rule === 'VP-1'));
  });

  it('checkBrazilReceitaGate5StringValue reports rule ids and never the value', () => {
    const hits = checkBrazilReceitaGate5StringValue(`x${digitRun(14)}x`, []);
    assert.ok(hits.includes('VP-3'));
    assert.ok(hits.every((hit) => /^VP-\d+$/.test(hit)));
  });
});

// ─── 6 · The closed forbidden key-name rule ───────────────────────────────────

describe('GATE-ROUND-3 · the § 5.2 forbidden-key rule is closed and consumable', () => {
  it('is declared closed, with no "and equivalents" tail', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_LIST_IS_CLOSED, true);
    assert.equal(BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_LIST_HAS_EQUIVALENTS_TAIL, false);
    assert.equal(BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_GROUPS.length, 7);
    for (const group of BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_GROUPS) {
      assert.ok(group.names.length > 0);
      for (const name of group.names) {
        assert.ok(
          !/equivalent|and so on|etc/i.test(name),
          'a closed enumeration carries no prose tail',
        );
      }
    }
  });

  it('applies the four-step normalization, so layout, case and separators cannot evade', () => {
    assert.equal(normalizeBrazilReceitaGate5Key('Razão-Social'), 'razao_social');
    assert.equal(normalizeBrazilReceitaGate5Key('  __CNPJ Básico__ '), 'cnpj_basico');
    assert.equal(normalizeBrazilReceitaGate5Key('correioEletronico'), 'correioeletronico');
    assert.equal(normalizeBrazilReceitaGate5Key('faixa etária'), 'faixa_etaria');
  });

  it('each of the seven groups fires on a representative key, by its declared match mode', () => {
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('qsa_partner_counts'), 1);
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('telefone'), 2);
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('logradouro'), 3);
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('cnpj_root_count'), 4);
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('razao_social'), 5);
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('record_identity_key'), 6);
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('rows_seen_by_family'), 7);
  });

  it('group 2 catches a positional numeric suffix the enumeration does not list', () => {
    // `telefone_3` is not an entry; `whole_or_ordinal` is what makes it forbidden anyway.
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('telefone_3'), 2);
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('ddd_7'), 2);
  });

  it('group 3 matches WHOLE names only, which is why underscores survive normalization', () => {
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('numero'), 3);
    // A whole-name rule must NOT fire on a compound that merely contains the token.
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('establishment_numero_bucket'), null);
  });

  it('groups 4 and 7 over-match exactly as 10O § 5.2 records, and are not weakened for it', () => {
    // Both of these are legitimate-looking aggregate names that the denylist still refuses. The
    // recorded resolution is to rename the aggregate, never to soften the matcher.
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('cnpj_root_count'), 4);
    assert.equal(matchBrazilReceitaGate5ForbiddenKeyGroup('rows_seen_by_family'), 7);
    // And the structural answer: § 6 names it, so the allowlist admits it.
    assert.equal(isBrazilReceitaGate5AllowedKey('rows_seen_by_family'), true);
  });

  it('reports the group that fired, so a finding is traceable to the closed rule', () => {
    const outcome = guardBrazilReceitaGate5Report({ nome_socio: 'x' });
    const denylist = outcome.findings.filter((f) => f.rule === 'KEY-DENYLIST');
    assert.equal(denylist.length, 1);
    assert.equal(denylist[0].group, 1);
  });
});

// ─── 7 · OS-A08, the load-bearing assertion ───────────────────────────────────

describe('GATE-ROUND-3 · the allowlist GOVERNS — OS-A08', () => {
  it('refuses a key that passes every denylist rule, which is the whole point', () => {
    // `establishment_density_index` contains no denylisted token, matches no group, and is not in
    // § 6. A denylist alone admits it; an allowlist cannot be evaded by novelty.
    assert.equal(isBrazilReceitaGate5ForbiddenKey('establishment_density_index'), false);
    assert.equal(isBrazilReceitaGate5AllowedKey('establishment_density_index'), false);

    const outcome = guardBrazilReceitaGate5Report({ establishment_density_index: 4 });
    assert.equal(outcome.ok, false);
    assert.deepEqual(outcome.findings, [
      { rule: 'KEY-ALLOWLIST', path: 'establishment_density_index' },
    ]);
  });

  it('where allowlist and denylist disagree about a key in neither, the key is forbidden', () => {
    const outcome = guardBrazilReceitaGate5Report({ some_novel_metric: 1 });
    assert.equal(outcome.ok, false);
    assert.ok(outcome.findings.some((f) => f.rule === 'KEY-ALLOWLIST'));
  });

  it('admits a report whose every key is named in § 6', () => {
    const outcome = guardBrazilReceitaGate5Report(
      {
        mode: 'readiness_dry_run',
        ok: true,
        country_code: 'BR',
        persisted_rows: 0,
        supabase_write: false,
        import_executed: false,
        runtime_integration: false,
        agent1_integration: false,
        field_allowlist_version: 'not_approved',
        record_identity_grain_decision: 'not_decided',
        temporary_storage_mode: 'not_approved',
        output_sanitization_version: BRAZIL_RECEITA_GATE5_OUTPUT_SANITIZATION_VERSION,
      },
      {
        allowedLiterals: [
          'readiness_dry_run',
          'BR',
          'not_approved',
          'not_decided',
          BRAZIL_RECEITA_GATE5_OUTPUT_SANITIZATION_VERSION,
        ],
      },
    );
    assert.deepEqual(outcome.findings, []);
    assert.equal(outcome.ok, true);
  });

  it('refuses a raw row, a raw cell, and an identity key by BOTH nets at once', () => {
    for (const key of ['raw_row', 'cell_value', 'record_identity_key', 'join_key', 'row_offset']) {
      const outcome = guardBrazilReceitaGate5Report({ [key]: 'x' });
      assert.equal(outcome.ok, false, `${key} must be refused`);
      assert.ok(
        outcome.findings.some((f) => f.rule === 'KEY-DENYLIST'),
        `${key} must be refused by the denylist`,
      );
      assert.ok(
        outcome.findings.some((f) => f.rule === 'KEY-ALLOWLIST'),
        `${key} must be refused by the allowlist too`,
      );
    }
  });

  it('the allowlist GOVERNS a denylist hit — the case without which the frozen report is un-emittable', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_ALLOWLIST_GOVERNS, true);
    // Three keys the frozen § 6 allowlist REQUIRES trip group 7's deliberately-broad substrings.
    // 10O § 5.2's answer is structural: they are permitted because § 6 NAMES them.
    assert.ok(BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST.length >= 3);
    for (const key of BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST) {
      assert.equal(isBrazilReceitaGate5ForbiddenKey(key), true, `${key} must trip the denylist`);
      assert.equal(isBrazilReceitaGate5AllowedKey(key), true, `${key} must be allowlisted`);
      assert.deepEqual(
        guardBrazilReceitaGate5Report({ [key]: 0 }).findings,
        [],
        `${key} is named in § 6, so the allowlist governs and the denylist hit is not a violation`,
      );
    }
  });

  it('every allowlisted key that trips the denylist is enumerated, so the set cannot grow silently', () => {
    const tripping = BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.filter((key) =>
      isBrazilReceitaGate5ForbiddenKey(key),
    );
    assert.deepEqual(
      tripping.sort(),
      [...BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST].sort(),
      'a new allowlisted key that trips a denylist group must be recorded, not discovered later',
    );
  });

  it('the precedence does NOT admit a denylisted key that is merely similar to an allowlisted one', () => {
    // `rows_seen_by_family` is admitted; `raw_rows_seen_by_family` is not. Naming, not resemblance.
    assert.equal(isBrazilReceitaGate5AllowedKey('raw_rows_seen_by_family'), false);
    const outcome = guardBrazilReceitaGate5Report({ raw_rows_seen_by_family: 4 });
    assert.equal(outcome.ok, false);
    assert.ok(outcome.findings.some((f) => f.rule === 'KEY-ALLOWLIST'));
    assert.ok(outcome.findings.some((f) => f.rule === 'KEY-DENYLIST'));
  });

  it('reuses the DV-validated CNPJ detector rather than re-implementing a shape check', () => {
    const guard = connectorCode('../br-receita-cnpj-gate5-output-guard.ts');
    assert.match(guard, /containsBrazilCnpjLikeIdentifier/);
    assert.match(guard, /from '\.\/br-receita-cnpj-identifier-shape'/);
    assert.ok(
      !/computeBrazilCnpjCheckDigits|modulo|mod\s*11/i.test(guard),
      'the DV algorithm must not be re-implemented here',
    );
  });
});

// ─── 8 · Small-cell suppression ───────────────────────────────────────────────

describe('GATE-ROUND-3 · small-cell suppression is a mechanism, not a threshold', () => {
  it('discloses a family whose every cell clears k, untouched', () => {
    const outcome = applyBrazilReceitaGate5SmallCellSuppression({ a: 40, b: 12, c: 10 });
    assert.deepEqual(outcome.disclosed, { a: 40, b: 12, c: 10 });
    assert.equal(outcome.residualCount, null);
    assert.equal(outcome.suppressionFailed, false);
  });

  it('never discloses a bucket below k directly', () => {
    const outcome = applyBrazilReceitaGate5SmallCellSuppression({ a: 40, b: 30, c: 4, d: 9 });
    assert.ok(!('c' in outcome.disclosed));
    assert.ok(!('d' in outcome.disclosed));
    for (const count of Object.values(outcome.disclosed)) {
      assert.ok(count >= BRAZIL_RECEITA_GATE5_SMALL_CELL_K);
    }
  });

  it('merges into exactly one residual count, with no tally and no labels', () => {
    const outcome = applyBrazilReceitaGate5SmallCellSuppression({ a: 40, b: 30, c: 4, d: 9 });
    assert.equal(outcome.disclosed[BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL], 13);
    assert.equal(outcome.residualCount, 13);
    const residualKeys = Object.keys(outcome.disclosed).filter((k) =>
      k.includes('suppressed'),
    );
    assert.deepEqual(residualKeys, [BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL]);
    // No field anywhere reveals how many buckets merged, or which.
    assert.ok(!Object.keys(outcome).includes('suppressedBucketCount'));
    assert.ok(!Object.keys(outcome).includes('suppressedLabels'));
  });

  it('applies COMPLEMENTARY suppression: one suppressed cell is recoverable by subtraction', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_COMPLEMENTARY_SUPPRESSION_REQUIRED, true);
    // Only `c` is below k. Publishing a and b beside a family total would recover c exactly, so the
    // next smallest — b — is suppressed with it.
    const outcome = applyBrazilReceitaGate5SmallCellSuppression({ a: 100, b: 40, c: 3 });
    assert.ok(!('c' in outcome.disclosed));
    assert.ok(!('b' in outcome.disclosed), 'the next smallest must be suppressed alongside');
    assert.deepEqual(Object.keys(outcome.disclosed).sort(), [
      'a',
      BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL,
    ]);
    assert.equal(outcome.residualCount, 43);
  });

  it('absorbs further buckets when the residual itself would sit below k', () => {
    // Residual of the two small cells is 3; it must absorb until it clears k.
    const outcome = applyBrazilReceitaGate5SmallCellSuppression({ a: 60, b: 11, c: 2, d: 1 });
    assert.ok((outcome.residualCount as number) >= BRAZIL_RECEITA_GATE5_SMALL_CELL_K);
    assert.ok(!('b' in outcome.disclosed), 'b was absorbed to lift the residual over k');
  });

  it('FAILS rather than reporting a family it cannot make compliant', () => {
    const outcome = applyBrazilReceitaGate5SmallCellSuppression({ a: 2, b: 1 });
    assert.equal(outcome.suppressionFailed, true);
    assert.deepEqual(outcome.disclosed, {});
    assert.equal(outcome.residualCount, null);
  });

  it('names the bucket families it governs, and the run-level fields it must not touch', () => {
    for (const family of ['cnae_section_counts', 'uf_counts', 'guardrail_counts']) {
      assert.ok(BRAZIL_RECEITA_GATE5_SUPPRESSED_BUCKET_FAMILIES.includes(family));
    }
    for (const exempt of ['persisted_rows', 'safety', 'duration_ms']) {
      assert.ok(
        BRAZIL_RECEITA_GATE5_SUPPRESSION_EXEMPT_KEYS.includes(exempt),
        `${exempt} describes the run, not the records, and must be suppression-exempt`,
      );
    }
    // A suppression-exempt key is never also a suppressed family.
    for (const exempt of BRAZIL_RECEITA_GATE5_SUPPRESSION_EXEMPT_KEYS) {
      assert.ok(!BRAZIL_RECEITA_GATE5_SUPPRESSED_BUCKET_FAMILIES.includes(exempt));
    }
  });

  it('every suppressed family is itself an allowlisted key', () => {
    for (const family of BRAZIL_RECEITA_GATE5_SUPPRESSED_BUCKET_FAMILIES) {
      assert.equal(isBrazilReceitaGate5AllowedKey(family), true, `${family} must be allowlisted`);
    }
  });
});

// ─── 9 · Error and exception safety ───────────────────────────────────────────

describe('GATE-ROUND-3 · errors are sanitized at CONSTRUCTION, not at print time', () => {
  it('declares the construction-time rule and refuses to report its own input', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_SANITIZE_AT_CONSTRUCTION, true);
    assert.equal(BRAZIL_RECEITA_GATE5_SANITIZER_REPORTS_ITS_INPUT, false);
  });

  it('carries only the seven envelope fields', () => {
    const error = createBrazilReceitaGate5SanitizedError({ code: 'cleanup_failed' });
    assert.deepEqual(Object.keys(error).sort(), [...BRAZIL_RECEITA_GATE5_ERROR_ENVELOPE_FIELDS].sort());
    assert.equal(isBrazilReceitaGate5ErrorEnvelopeShape(error), true);
  });

  it('maps an unrecognized code to the generic one rather than passing it through', () => {
    const error = createBrazilReceitaGate5SanitizedError({ code: 'some_driver_said_something' });
    assert.equal(error.error_code, BRAZIL_RECEITA_GATE5_GENERIC_ERROR_CODE);
    assert.equal(error.error_code, 'unclassified_failure');
  });

  it('every admitted code is a member of the closed enum', () => {
    for (const code of BRAZIL_RECEITA_GATE5_ERROR_CODES) {
      assert.equal(createBrazilReceitaGate5SanitizedError({ code }).error_code, code);
    }
  });

  it('drops an unclassifiable field to null instead of keeping the original value', () => {
    const marker = String.fromCharCode(64);
    const error = createBrazilReceitaGate5SanitizedError({
      code: 'forbidden_output_detected',
      failedStage: `stage with a ${marker} in it`,
      fileFamily: `family_${digitRun(14)}`,
      gateName: 'a free form sentence about what went wrong',
      cleanupStatus: 'completed',
    });
    assert.equal(error.failed_stage, null);
    assert.equal(error.file_family, null);
    assert.equal(error.gate_name, null);
    assert.equal(error.cleanup_status, 'completed');
  });

  it('refuses a path outside the controlled root — OS-A33', () => {
    const error = createBrazilReceitaGate5SanitizedError({
      code: 'manifest_invalid',
      failedStage: '/var/data/receita/empresas',
    });
    assert.equal(error.failed_stage, null);
  });

  it('admits only allowlisted, integer safe_counts and silently drops the rest', () => {
    const error = createBrazilReceitaGate5SanitizedError({
      code: 'resource_cap_exceeded',
      safeCounts: {
        files_seen: 12,
        raw_row: 4,
        establishments_seen: 1.5,
        some_novel_metric: 9,
        companies_seen: 7,
      },
    });
    assert.deepEqual(error.safe_counts, { files_seen: 12, companies_seen: 7 });
  });

  it('has nowhere to put a stack — OS-A34 — and is not an Error subclass', () => {
    const error = createBrazilReceitaGate5SanitizedError({ code: 'cleanup_failed' });
    assert.equal(error instanceof Error, false);
    assert.equal('stack' in error, false);
    assert.equal(BRAZIL_RECEITA_GATE5_STACK_OUTPUT_PERMITTED, false);
  });

  it('has nowhere to put an interpolated message — OS-A31', () => {
    const error = createBrazilReceitaGate5SanitizedError({ code: 'cleanup_failed' });
    assert.equal('message' in error, false);
    assert.ok(!(BRAZIL_RECEITA_GATE5_ERROR_ENVELOPE_FIELDS as readonly string[]).includes('message'));
  });

  it('carries an all-false safety block — OS-A45', () => {
    const error = createBrazilReceitaGate5SanitizedError({ code: 'cleanup_failed' });
    for (const value of Object.values(error.safety_flags)) {
      assert.equal(value, false);
    }
    assert.ok(Object.keys(error.safety_flags).length >= 4);
  });

  it('is frozen, so a later caller cannot attach a caught message to it', () => {
    const error = createBrazilReceitaGate5SanitizedError({ code: 'cleanup_failed' });
    assert.equal(Object.isFrozen(error), true);
    assert.throws(() => {
      (error as unknown as Record<string, unknown>).raw_driver_message = 'x';
    });
  });

  it('the guard is the ONLY constructor: no other module builds this envelope', () => {
    const guard = connectorCode('../br-receita-cnpj-gate5-output-guard.ts');
    assert.match(guard, /export function createBrazilReceitaGate5SanitizedError/);
    // The envelope shape is not assembled by hand anywhere in the round's own modules.
    for (const modulePath of THE_ROUND_3_MODULES) {
      if (modulePath.includes('output-guard')) continue;
      assert.ok(
        !/safety_flags:\s*\{/.test(connectorCode(modulePath)),
        `${modulePath} must not assemble an error envelope by hand`,
      );
    }
  });
});

// ─── 10 · Log and console safety ──────────────────────────────────────────────

describe('GATE-ROUND-3 · logs and console obey the same universal set, with no debug bypass', () => {
  it('admits a log event whose every key is in the closed field set', () => {
    const outcome = guardBrazilReceitaGate5LogEvent(
      { stage: 'partition_build', aggregate_count: 12, elapsed_ms: 40, error_code: 'cleanup_failed' },
      ['partition_build', 'cleanup_failed'],
    );
    assert.deepEqual(outcome.findings, []);
  });

  it('refuses a free-form message field, which is the thing there is nowhere to put', () => {
    const outcome = guardBrazilReceitaGate5LogEvent({ message: 'processing a row' }, []);
    assert.equal(outcome.ok, false);
    assert.ok(outcome.findings.some((f) => f.rule === 'LOG-FIELD-SET' && f.path === 'message'));
    assert.ok(!(BRAZIL_RECEITA_GATE5_LOG_EVENT_FIELDS as readonly string[]).includes('message'));
  });

  it('refuses an identifier reaching a log event through an otherwise-legal field', () => {
    const outcome = guardBrazilReceitaGate5LogEvent({ stage: digitRun(14) }, [digitRun(14)]);
    assert.equal(outcome.ok, false);
    assert.ok(outcome.findings.some((f) => f.rule === 'VP-3'));
  });

  it('declares no per-record log lines and no interpolation', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_PER_RECORD_LOG_LINES_PERMITTED, false);
    assert.equal(BRAZIL_RECEITA_GATE5_LOG_INTERPOLATION_PERMITTED, false);
  });

  it('the BR connector emits nothing to console or to a process stream, today', () => {
    // The negative guard: a future console call in this flow is a source change this test fails on.
    const dir = new URL('../', import.meta.url);
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ts'));
    assert.ok(files.length > 50, 'expected the connector directory to be enumerated');
    const offenders: string[] = [];
    for (const name of files) {
      const code = codeWithoutComments(fs.readFileSync(new URL(name, dir), 'utf8'));
      if (/\bconsole\s*\.\s*(log|info|warn|error|debug|trace|dir|table)\b/.test(code)) {
        offenders.push(`${name} (console)`);
      }
      if (/\bprocess\s*\.\s*std(out|err)\s*\.\s*write\b/.test(code)) {
        offenders.push(`${name} (process stream)`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'a console or process-stream write in the BR connector bypasses the § 11 contract',
    );
  });

  it('the round-3 modules perform no I/O at all — no fs, no path, no env, no process', () => {
    for (const modulePath of THE_ROUND_3_MODULES) {
      const code = connectorCode(modulePath);
      for (const forbidden of [
        /from\s+'node:fs'/,
        /from\s+'node:path'/,
        /from\s+'node:os'/,
        /from\s+'node:child_process'/,
        /\bprocess\s*\.\s*env\b/,
        /\bfetch\s*\(/,
        /createClient/,
      ]) {
        assert.ok(
          !forbidden.test(code),
          `${modulePath} must not reach for ${forbidden} — this round is pure`,
        );
      }
    }
  });

  it('no round-3 module has a debug or verbose bypass', () => {
    for (const modulePath of THE_ROUND_3_MODULES) {
      // Executable code only: `'debug'` is a § 5.2 denylist ENTRY, not a switch.
      const code = connectorExecutableCode(modulePath);
      assert.ok(
        !/\b(DEBUG|VERBOSE|BYPASS|SKIP_SANITIZ)/i.test(code),
        `${modulePath} must carry no bypass switch`,
      );
    }
    // And the token IS present as data, so the guard above is proven to be reading code not prose.
    assert.match(rawConnectorSource('../br-receita-cnpj-gate5-output-contract.ts'), /'debug'/);
  });
});

// ─── 11 · Gate evidence safety ────────────────────────────────────────────────

describe('GATE-ROUND-3 · gate evidence and operator summaries are output surfaces too', () => {
  it('are named as surfaces in their own right', () => {
    assert.ok(BRAZIL_RECEITA_GATE5_OUTPUT_SURFACES.includes('gate_evidence_packet'));
    assert.ok(BRAZIL_RECEITA_GATE5_OUTPUT_SURFACES.includes('operator_summary'));
    assert.ok(BRAZIL_RECEITA_GATE5_OUTPUT_SURFACES.includes('future_audit_artifacts'));
  });

  it('permit counts, booleans, controlled enums and safe codes', () => {
    for (const allowed of [
      'aggregate_report',
      'gate_status_list',
      'safety_booleans_all_false',
      'validation_command_names',
      'assertion_ids_and_pass_state',
    ]) {
      assert.ok((BRAZIL_RECEITA_GATE5_EVIDENCE_ALLOWED_CONTENT as readonly string[]).includes(allowed));
    }
  });

  it('forbid rows, samples, identifiers, paths, raw exceptions and stack traces', () => {
    for (const forbidden of [
      'sample_rows',
      'identifiers',
      'paths',
      'raw_exceptions',
      'stack_traces',
      'join_key_samples',
      'identity_key_samples',
      'raw_command_output',
    ]) {
      assert.ok(
        (BRAZIL_RECEITA_GATE5_EVIDENCE_FORBIDDEN_CONTENT as readonly string[]).includes(forbidden),
        `${forbidden} must be forbidden in evidence`,
      );
    }
  });

  it('the allowed and forbidden lists are disjoint', () => {
    const allowed = new Set<string>(BRAZIL_RECEITA_GATE5_EVIDENCE_ALLOWED_CONTENT);
    for (const forbidden of BRAZIL_RECEITA_GATE5_EVIDENCE_FORBIDDEN_CONTENT) {
      assert.ok(!allowed.has(forbidden));
    }
  });

  it('are assembled only from artifacts that already passed the report and log contracts', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_EVIDENCE_ASSEMBLED_FROM_PASSED_ARTIFACTS_ONLY, true);
  });
});

// ─── 12 · The assertion catalogue ─────────────────────────────────────────────

describe('GATE-ROUND-3 · OS-A01 … OS-A46 are accounted for, none deleted and none weakened', () => {
  it('carries the 41 IDs 10O actually assigned, gaps included', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_ASSERTION_RECORDS.length, 41);
    assert.equal(BRAZIL_RECEITA_GATE5_ASSERTION_TOTALS.total, 41);
    const ids = BRAZIL_RECEITA_GATE5_ASSERTION_RECORDS.map((r) => r.id);
    assert.equal(new Set(ids).size, 41, 'no duplicate assertion id');
    // The gaps are in the source record: OS-A29 and OS-A36..OS-A39 were never assigned.
    for (const absent of ['OS-A29', 'OS-A36', 'OS-A37', 'OS-A38', 'OS-A39']) {
      assert.ok(!ids.includes(absent), `${absent} was never assigned by 10O`);
    }
    for (const present of ['OS-A01', 'OS-A08', 'OS-A19', 'OS-A28', 'OS-A30', 'OS-A35', 'OS-A46']) {
      assert.ok(ids.includes(present), `${present} must be accounted for`);
    }
  });

  it('the totals are arithmetic, so a silently dropped assertion fails this suite', () => {
    const counts = { executable_and_asserted: 0, deferred_to_implementation: 0, owned_by_other_gate: 0 };
    for (const record of BRAZIL_RECEITA_GATE5_ASSERTION_RECORDS) counts[record.state] += 1;
    assert.equal(counts.executable_and_asserted, BRAZIL_RECEITA_GATE5_ASSERTION_TOTALS.executableAndAsserted);
    assert.equal(counts.deferred_to_implementation, BRAZIL_RECEITA_GATE5_ASSERTION_TOTALS.deferredToImplementation);
    assert.equal(counts.owned_by_other_gate, BRAZIL_RECEITA_GATE5_ASSERTION_TOTALS.ownedByOtherGate);
    assert.equal(
      counts.executable_and_asserted + counts.deferred_to_implementation + counts.owned_by_other_gate,
      BRAZIL_RECEITA_GATE5_ASSERTION_TOTALS.total,
    );
  });

  it('deletes nothing and weakens nothing', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_ASSERTION_TOTALS.deleted, 0);
    assert.equal(BRAZIL_RECEITA_GATE5_ASSERTION_TOTALS.weakened, 0);
  });

  it('the superseded list is EMPTY as a finding, not by omission', () => {
    // Round 1 and Round 2 changed the architecture around this gate. Neither change makes an OUTPUT
    // assertion obsolete: a rule about a value appearing on a surface is unaffected by that value
    // ceasing to be persisted. Anything else here would be an invented supersession.
    assert.deepEqual([...BRAZIL_RECEITA_GATE5_SUPERSEDED_ASSERTIONS], []);
  });

  it('every record names where it is discharged, or which gate owns it', () => {
    for (const record of BRAZIL_RECEITA_GATE5_ASSERTION_RECORDS) {
      assert.match(record.id, /^OS-A\d{2}$/);
      assert.ok(record.dischargedBy.length > 20, `${record.id} needs a real discharge, not a stub`);
      if (record.state === 'owned_by_other_gate') {
        assert.match(record.dischargedBy, /GATE-\d/);
      }
    }
  });

  it('the two deferred assertions are deferred for a named absence of code, not for convenience', () => {
    const deferred = BRAZIL_RECEITA_GATE5_ASSERTION_RECORDS.filter(
      (r) => r.state === 'deferred_to_implementation',
    );
    assert.deepEqual(deferred.map((r) => r.id), ['OS-A24', 'OS-A26']);
    for (const record of deferred) {
      assert.match(record.dischargedBy, /no .*exists|no implementation/);
    }
  });

  it('OS-A46 is owned by GATE-6 and points at the Round-2 coordinator that discharges it', () => {
    const record = BRAZIL_RECEITA_GATE5_ASSERTION_RECORDS.find((r) => r.id === 'OS-A46');
    assert.equal(record?.state, 'owned_by_other_gate');
    assert.match(record?.dischargedBy ?? '', /cleanup-coordinator/);
  });
});

// ─── 13 · The invariant assertions, against their REAL owners ─────────────────

describe('GATE-ROUND-3 · OS-A40 … OS-A45 hold against the modules that own them', () => {
  it('OS-A40 · zero output rows, from the resource-envelope proposal that owns the cap', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL.maxOutputRows, 0);
    assert.equal(BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS.maxOutputRows, 0);
  });

  it('OS-A41, OS-A43, OS-A44 · no snapshot persistence, no runtime, no Agent 1 Brazil', () => {
    assert.equal(BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS.snapshotPersistence, false);
    assert.equal(BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS.runtime, false);
    assert.equal(BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS.agent1Brazil, false);
    assert.equal(BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS.production, false);
  });

  it('OS-A42 · the § 6 allowlist fixes the no-write members as contract-false fields', () => {
    for (const key of [
      'import_executed',
      'supabase_write',
      'runtime_integration',
      'agent1_integration',
      'hubspot_write',
      'slack_write',
      'persisted_rows',
      'safety',
    ]) {
      assert.ok(
        BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.includes(key),
        `${key} must be a named member of the frozen allowlist`,
      );
    }
  });

  it('the benchmark third attempt stays disallowed — this round crosses no operational line', () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED, false);
  });

  it('no round-3 module reaches for a migration, a snapshot writer, or a provider', () => {
    // 🔴 This asserts REACH, not token presence. `supabase_write` is a § 6 allowlist entry and a
    // safety-flag field name; a scan for the bare word flags the very field that declares no write
    // happened. What matters is whether a module can CALL one of these, so the guard tests the call
    // and import shapes.
    for (const modulePath of THE_ROUND_3_MODULES) {
      const code = connectorExecutableCode(modulePath);
      for (const forbidden of [
        /createClient/,
        /\bfrom\s+'@supabase/,
        /apply_migration/,
        /snapshot-builder/,
        /\.from\s*\(/,
        /\bawait\b/,
        /apolloClient|lushaClient/i,
      ]) {
        assert.ok(!forbidden.test(code), `${modulePath} must not reach for ${forbidden}`);
      }
      // And every import a round-3 module has is a sibling BR module. Read from the comment-stripped
      // source, not the literal-stripped one — stripping literals erases the specifier itself.
      for (const spec of connectorCode(modulePath).match(/from\s+'[^']*'/g) ?? []) {
        assert.match(
          spec,
          /'\.\/br-receita-cnpj-/,
          `${modulePath} imports ${spec}, which is outside the BR connector`,
        );
      }
    }
  });

  it('no round-3 module carries a literal identifier of any length', () => {
    // Raw source, comments included: a "helpful example" in a docstring is the leak class here.
    for (const modulePath of THE_ROUND_3_MODULES) {
      const source = rawConnectorSource(modulePath);
      // A numeric separator (`9_999_999`) stops a magnitude reading as a digit run at all, so any
      // BARE run of eight or more digits in this round's own source is a defect rather than a value.
      const runs = source.match(/(?<!\d)\d{8,}(?!\d)/g) ?? [];
      assert.deepEqual(runs, [], `${modulePath} carries a bare digit run of 8+ positions`);
    }
  });
});

// ─── 14 · What this round did NOT do ──────────────────────────────────────────

describe('GATE-ROUND-3 · the guard is reachable from tests only, and wires into nothing', () => {
  it('no production module imports the round-3 guard or contract', () => {
    const dir = new URL('../', import.meta.url);
    const productionFiles = fs.readdirSync(dir).filter((name) => name.endsWith('.ts'));
    const importers: string[] = [];
    for (const name of productionFiles) {
      if (name.startsWith('br-receita-cnpj-gate5-')) continue;
      if (name === 'br-receita-cnpj-gate-status-current-state.ts') continue;
      const code = codeWithoutComments(fs.readFileSync(new URL(name, dir), 'utf8'));
      if (/br-receita-cnpj-gate5-output-(guard|contract)/.test(code)) importers.push(name);
    }
    assert.deepEqual(
      importers,
      [],
      'the GATE-5 guard must not be wired into any execution path while the gate is unapproved',
    );
  });

  it('the runner is untouched by this round', () => {
    const runner = connectorCode('../br-receita-cnpj-full-join-dry-run-runner.ts');
    assert.ok(!/gate5-output-guard|gate5-output-contract/.test(runner));
  });

  it('the round-3 suite is a REQUIRED CI step, asserted on the run: line and not the step name', () => {
    const workflow = fs.readFileSync(
      new URL('../../../../../../.github/workflows/automatic-routing-tests.yml', import.meta.url),
      'utf8',
    );
    // 🔴 Grep the `run:` lines, never the step NAMES. A step whose name mentions a suite it does not
    // invoke is a false positive, and this repository has been caught by exactly that before.
    const runLines = workflow
      .split('\n')
      .filter((line) => /^\s*run:\s/.test(line))
      .map((line) => line.trim());
    for (const script of [
      'npm run test:br-source:gate-round3-output-sanitization',
      'npm run test:br-source:gate-round2-identity-cleanup',
      'npm run test:br-source:gate-round1-cnpj-hardening',
    ]) {
      assert.ok(
        runLines.some((line) => line === `run: ${script}`),
        `${script} must be invoked by a run: line in the required workflow`,
      );
    }
  });

  it('the round-3 npm script actually points at this suite', () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../../../../../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    const script = pkg.scripts['test:br-source:gate-round3-output-sanitization'];
    assert.ok(script, 'the round-3 script must exist');
    assert.match(script, /br-receita-cnpj-gate-round3-output-sanitization\.test\.ts/);
    // And it re-runs the two prior rounds, so a round-3 change that breaks one is caught here.
    assert.match(script, /br-receita-cnpj-gate-round2-identity-and-cleanup\.test\.ts/);
    assert.match(script, /br-receita-cnpj-gate-round1-owner-records\.test\.ts/);
    // And BR-SOURCE-11A, whose invariants this round depends on and must not weaken.
    assert.match(script, /br-receita-cnpj-full-join-output-sanitizer\.test\.ts/);
  });

  it('the current-state view imports each gate status rather than restating it', () => {
    const view = connectorCode('../br-receita-cnpj-gate-status-current-state.ts');
    for (const gate of [2, 3, 4, 5, 6, 8]) {
      assert.match(
        view,
        new RegExp(`BRAZIL_RECEITA_GATE${gate}_STATUS`),
        `the view must import GATE-${gate}'s own status constant, not a second copy`,
      );
    }
    // The two it states itself are the two that own no constant, and it says which.
    assert.match(view, /BRAZIL_RECEITA_GATE1_STATUS: BrazilReceitaGateStatus = 'approved'/);
    assert.match(view, /BRAZIL_RECEITA_GATE7_STATUS: BrazilReceitaGateStatus = 'not_started'/);
  });
});
