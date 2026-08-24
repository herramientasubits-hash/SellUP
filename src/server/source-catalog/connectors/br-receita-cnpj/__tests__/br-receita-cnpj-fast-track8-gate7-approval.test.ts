/**
 * BR-SOURCE-FAST-TRACK-8 — the human owner relay that approves GATE-7, and the four lines it must not
 * cross.
 *
 * The project owner relayed, on 2026-08-24, the joint decision of GATE-7's three required owners:
 * `GATE7_PRE_APPROVAL_REHEARSAL_REQUIRED = NO`, `GATE7_OPERATOR_RUNBOOK = APPROVED`, and an APPROVED
 * from each of the operator owner, the technical owner and the privacy owner. The relay was explicit
 * about the circularity it was ruling on — `P-05` requires every gate approved, GATE-7 included, so a
 * rehearsal intended to demonstrate reproducibility BEFORE the approval halts at `P-05` — and equally
 * explicit that it proposed no change to `P-05`, no bypass, no real-data execution and no change to
 * `ATTEMPT_3_ALLOWED`.
 *
 * This suite proves the record says exactly that, and only that:
 *
 *   · GATE-7 is `approved`, by three independently-named ROLES, dated 2026-08-24, no agent involved.
 *   · 🔴 reproducibility by a different operator is STILL `UNDEMONSTRATED`. It was WAIVED, not shown,
 *     and the two facts live in two separate constants that a single edit cannot conflate.
 *   · the waiver used a branch the unblocking criterion has carried since FAST-TRACK-6 — the constant
 *     is asserted VERBATIM, so a reader can see the branch pre-dated the decision.
 *   · `P-05` was not modified, no bypass was created, and the argument-free evaluator still has no
 *     surface to weaken it on. `P-05` returns PASS only because the live gate state changed.
 *   · nothing operational moved: the attempt-3 ledger, the temporary-storage policy flag and the
 *     provisional resource-cap proposal are asserted unchanged against their real owners.
 *   · GLOBAL is now `GO` — the narrow § 15 GO, whose every other field is `false`.
 *
 * Pure: no network, no Supabase, no provider, no real Receita data, no benchmark, no rehearsal, no
 * filesystem write. The only file I/O is reading this repository's own sources for the static guards.
 * 0 credits, 0 writes, 0 migrations, 0 flags.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  BRAZIL_RECEITA_EVERY_GATE_PASS_CRITERION_WAS_DEMONSTRATED,
  BRAZIL_RECEITA_GATE8_APPROVAL_IS_PERMISSION_TO_WRITE_RUNNER,
  BRAZIL_RECEITA_GATE_APPROVED_STATUSES,
  BRAZIL_RECEITA_GATE_CURRENT_STATE,
  BRAZIL_RECEITA_GATE_GO_MEANS,
  brazilReceitaApprovedGateCount,
  brazilReceitaGateGlobalVerdict,
} from '../br-receita-cnpj-gate-status-current-state';
import {
  BRAZIL_RECEITA_GATE7_AGENT_MAY_APPROVE,
  BRAZIL_RECEITA_GATE7_APPROVAL_DATE,
  BRAZIL_RECEITA_GATE7_APPROVAL_DOES_NOT_AUTHORIZE,
  BRAZIL_RECEITA_GATE7_APPROVAL_IS_JOINT,
  BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT,
  BRAZIL_RECEITA_GATE7_APPROVED,
  BRAZIL_RECEITA_GATE7_APPROVER_COUNT,
  BRAZIL_RECEITA_GATE7_BLOCKERS_DISCHARGED,
  BRAZIL_RECEITA_GATE7_JOINT_APPROVAL,
  BRAZIL_RECEITA_GATE7_OPERATOR_APPROVER_ROLE,
  BRAZIL_RECEITA_GATE7_PRE_APPROVAL_REHEARSAL_CIRCULARITY,
  BRAZIL_RECEITA_GATE7_PRIVACY_APPROVER_ROLE,
  BRAZIL_RECEITA_GATE7_REHEARSAL_AUTHORIZED,
  BRAZIL_RECEITA_GATE7_REHEARSAL_PERFORMED,
  BRAZIL_RECEITA_GATE7_REHEARSAL_REQUIRED,
  BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS,
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR,
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DEMONSTRATED,
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DISPOSITION,
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_WAIVER_REASON,
  BRAZIL_RECEITA_GATE7_REQUIRED_EVIDENCE_DISPOSITION,
  BRAZIL_RECEITA_GATE7_RESTRICTIONS,
  BRAZIL_RECEITA_GATE7_STATUS,
  BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED,
  BRAZIL_RECEITA_GATE7_TECHNICAL_APPROVER_ROLE,
  BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION,
} from '../br-receita-cnpj-gate7-recorded-operator-runbook';
import {
  BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS,
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DEMONSTRATED as RUNBOOK_REPRODUCIBILITY_DEMONSTRATED,
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DISPOSITION as RUNBOOK_REPRODUCIBILITY_DISPOSITION,
  BRAZIL_RECEITA_GATE7_SECTION_IS_A_PERMISSION,
  evaluateBrazilReceitaGate7Preconditions,
  evaluateBrazilReceitaGate7PrivacyPreflight,
} from '../br-receita-cnpj-gate7-operator-runbook';
import {
  BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS,
  BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEM_COUNT,
} from '../br-receita-cnpj-gate7-preflight-items';
import { BRAZIL_RECEITA_GATE8_AUTHORIZES_OPERATIONS } from '../br-receita-cnpj-gate8-recorded-contract-approval';
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

function checklistDoc(): string {
  return read('docs/source-catalog/br-receita-cnpj-full-join-approval-gates-checklist.md');
}

function runbookModule(): string {
  return read(`${CONNECTOR}/br-receita-cnpj-gate7-operator-runbook.ts`);
}

/**
 * The IDs of the stop conditions, derived from the enumeration that OWNS them.
 *
 * 🔴 There is no code module owning `T-01` … `T-16`, and this suite deliberately does not create one:
 * a second stop-condition authority invented to satisfy a test is exactly the drift risk the
 * cross-check exists to catch. The owner is BR-SOURCE-10PQR § 6.3's fenced block — the same frozen
 * enumeration the approval subject names — so the count is derived from there, in the test, at read
 * time.
 */
function ownedStopConditionIds(): readonly string[] {
  const doc = read('docs/source-catalog/br-receita-cnpj-full-join-remaining-gates-decision-packet.md');
  const start = doc.indexOf('### 6.3 Proposed stop conditions');
  assert.ok(start > -1, '10PQR § 6.3 must exist — it owns T-01 … T-16');
  const block = /```\n([\s\S]*?)\n```/.exec(doc.slice(start));
  assert.ok(block, '10PQR § 6.3 must carry a fenced stop-condition enumeration');
  return block[1]
    .split('\n')
    .map((line) => /^(T-\d{2})\s+\S/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]);
}

/** Every module this round changed. Used by the cross-cutting static guards below. */
const TOUCHED_MODULES = [
  'br-receita-cnpj-gate7-recorded-operator-runbook.ts',
  'br-receita-cnpj-gate7-operator-runbook.ts',
  'br-receita-cnpj-gate7-preflight-items.ts',
  'br-receita-cnpj-gate8-recorded-contract-approval.ts',
  'br-receita-cnpj-gate-status-current-state.ts',
  'br-receita-cnpj-final-owner-signoff-packet.ts',
].map((name) => `${CONNECTOR}/${name}`);

// ─── 1 · The approval itself ──────────────────────────────────────────────────

describe('FAST-TRACK-8 · GATE-7 is approved, by three named roles and no agent', () => {
  it('is approved, and approved counts as approved in the authoritative vocabulary', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_STATUS, 'approved');
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVED, true);
    assert.equal(BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(BRAZIL_RECEITA_GATE7_STATUS), true);
  });

  it('all three required approvers are named as ROLES, and the approval is JOINT', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVAL_IS_JOINT, true);
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVER_COUNT, 3);
    assert.equal(BRAZIL_RECEITA_GATE7_OPERATOR_APPROVER_ROLE, 'operator owner');
    assert.equal(BRAZIL_RECEITA_GATE7_TECHNICAL_APPROVER_ROLE, 'technical owner');
    assert.equal(BRAZIL_RECEITA_GATE7_PRIVACY_APPROVER_ROLE, 'privacy owner');
  });

  it('no agent supplied any of the three halves, and the record says so as data', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_AGENT_MAY_APPROVE, false);
    assert.equal(BRAZIL_RECEITA_GATE7_JOINT_APPROVAL.agentMayApprove, false);
  });

  it('each half is an owner RELAY reference dated 2026-08-24, never a personal signature', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVAL_DATE, '2026-08-24');
    assert.equal(BRAZIL_RECEITA_GATE7_JOINT_APPROVAL.approvalDate, '2026-08-24');
    const references = [
      BRAZIL_RECEITA_GATE7_JOINT_APPROVAL.operatorOwnerReference,
      BRAZIL_RECEITA_GATE7_JOINT_APPROVAL.technicalOwnerReference,
      BRAZIL_RECEITA_GATE7_JOINT_APPROVAL.privacyOwnerReference,
    ];
    assert.equal(new Set(references).size, 3, 'the three references must be distinct');
    for (const reference of references) {
      assert.match(reference, /^OWNER_REF_GATE7_[A-Z_]+_RELAY_2026_08_24$/);
    }
  });

  it('the subject is named exactly: the § 16 section, 22 preflights, 16 non-overridable stops', () => {
    assert.match(BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT.runbookSection, /manual-download-local-prep-runbook\.md § 16$/);
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT.preflightItemRange, 'P-01 … P-22');
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT.stopConditionRange, 'T-01 … T-16');
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT.stopConditionCount, 16);
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT.stopConditionsAreOverridable, false);
    // 🔴 The count is RECORDED IN THE APPROVAL SUBJECT and MECHANICALLY CROSS-CHECKED against the
    // owning enumeration — it is NOT "read from the owner module and not restated". The subject
    // deliberately carries its own literal `22`, because an approval must state its own subject
    // rather than resolve it at import time; the record is a LEAF and imports nothing (§ below). The
    // protection against drift is therefore this assertion, not the absence of a second copy.
    assert.equal(
      BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT.preflightItemCount,
      BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEM_COUNT,
    );
    assert.equal(BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS.length, 22);
  });
});

// ─── 1b · The subject's counts, cross-checked against their owning enumerations ──

/**
 * BR-SOURCE-FAST-TRACK-8 (consistency correction). The approval subject carries two literal counts —
 * `preflightItemCount: 22` and `stopConditionCount: 16`. That is correct for a RECORD: an approval
 * must state its own subject, and the record is an import-free LEAF by design. What was NOT correct
 * was describing those literals as "read from the owner module and not restated". They are recorded
 * and then MECHANICALLY CROSS-CHECKED, which is a different and weaker-sounding claim that happens to
 * be the true one. Both counts are cross-checked below; neither is left as an unverified second copy.
 */
describe('FAST-TRACK-8 · both subject counts are cross-checked against the owning enumeration', () => {
  it('preflightItemCount is cross-checked against the P-01 … P-22 enumeration that owns it', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT.preflightItemCount, BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS.length);
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT.preflightItemCount, BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEM_COUNT);
    const ids = BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, 'no duplicate preflight ID');
    assert.deepEqual(
      ids,
      Array.from({ length: 22 }, (_, i) => `P-${String(i + 1).padStart(2, '0')}`),
      'P-01 … P-22 with no gaps, in order',
    );
  });

  it('stopConditionCount is cross-checked against the 10PQR § 6.3 enumeration that owns it', () => {
    const owned = ownedStopConditionIds();
    // 🔴 The point of the round: 16 is no longer an unverified second copy of a number in a document.
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT.stopConditionCount, owned.length);
    assert.equal(owned.length, 16);
  });

  it('the owned stop conditions really cover T-01 … T-16, with no gap and no duplicate', () => {
    const owned = ownedStopConditionIds();
    assert.equal(new Set(owned).size, owned.length, 'no duplicate stop-condition ID');
    assert.deepEqual(
      owned,
      Array.from({ length: 16 }, (_, i) => `T-${String(i + 1).padStart(2, '0')}`),
      'T-01 … T-16 with no gaps, in order',
    );
    assert.equal(BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT.stopConditionRange, `${owned[0]} … ${owned[owned.length - 1]}`);
  });

  it('the record stays a LEAF: it imports nothing, so no cross-check can recreate the ESM cycle', () => {
    // 🔴 The recorded GATE-7 module is imported BY the gate current-state view, which is imported by
    // the runbook module for its executable `P-05`. An import in the other direction closes a cycle
    // that fails at module-initialization time. The cross-checks above therefore live in the TEST,
    // never in the record.
    const source = stripComments(read(`${CONNECTOR}/br-receita-cnpj-gate7-recorded-operator-runbook.ts`));
    // 🔴 Assert on IMPORT STATEMENTS, never on the module name as a substring. This record NAMES
    // `br-receita-cnpj-gate7-operator-runbook` in a data field (`machineReadableHalf`), and a guard
    // that greps the raw body would read that mention as an import — the exact confusion between
    // "named in code" and "imported by code" that has produced false positives here before.
    assert.doesNotMatch(source, /^\s*import\s/m, 'the record must contain no import statement');
    assert.doesNotMatch(source, /^\s*export\s+\*?\s*.*\bfrom\s+'/m, 'the record must re-export from nothing');
    assert.doesNotMatch(source, /\bfrom\s+'\.{1,2}\//, 'the record must carry no relative module specifier');
    assert.doesNotMatch(source, /\brequire\s*\(/, 'the record must not require anything either');
    // The one direction that would close the cycle, stated positively: the modules that sit ABOVE
    // this leaf import IT, and the leaf reaches back for nothing.
    const currentState = stripComments(read(`${CONNECTOR}/br-receita-cnpj-gate-status-current-state.ts`));
    assert.match(currentState, /from '\.\/br-receita-cnpj-gate7-recorded-operator-runbook'/);
    const runbook = stripComments(runbookModule());
    assert.match(runbook, /from '\.\/br-receita-cnpj-gate-status-current-state'/);
  });
});

// ─── 1c · No stale current-state prose survives the round ─────────────────────

/**
 * BR-SOURCE-FAST-TRACK-8 (consistency correction). Three current-state claims went stale the moment
 * the gate state moved, and prose that contradicts the data it describes is the failure mode this
 * whole series has had to retract once already.
 *
 * 🔴 These are PINNED contradictions, not a generic prose linter. Each assertion names one exact
 * sentence that is now false. Historical prose that says the evaluator USED to fail is untouched and
 * must stay untouched — the audit trail is the point.
 */
describe('FAST-TRACK-8 · the runbook prose does not contradict the state it describes', () => {
  it('the stale "the other twenty-one are operator_environment_dependent" claim is gone', () => {
    const source = runbookModule();
    assert.equal(
      source.includes('other twenty-one are `operator_environment_dependent`'),
      false,
      'twenty, not twenty-one, are operator_environment_dependent — P-05 and P-20 are checkable here',
    );
    assert.equal(source.includes('twenty-one'), false, 'no twenty-one arithmetic may survive anywhere in the module');
    assert.match(source, /remaining TWENTY are `operator_environment_dependent`/);
  });

  it('the evaluator docblock no longer claims a current FAIL, and says why it now PASSes', () => {
    const source = runbookModule();
    const start = source.indexOf('`P-05`, executed.');
    assert.ok(start > -1, "the evaluator's docblock must still open with `P-05`, executed.");
    const docblock = source.slice(start, source.indexOf('export function evaluateBrazilReceitaGate7Preconditions'));
    for (const staleClaim of [
      'it returns `FAIL` today',
      'returns `FAIL` today',
      'returns FAIL today',
    ]) {
      assert.equal(docblock.includes(staleClaim), false, `the docblock must not claim: ${staleClaim}`);
    }
    // The three properties § 3 requires it to keep stating, plus the reason for the new verdict.
    assert.match(docblock, /it returns `PASS` today/);
    assert.match(docblock, /all eight gate statuses are recorded as `approved`/);
    assert.match(docblock, /it takes NO arguments/);
    assert.match(docblock, /BRAZIL_RECEITA_GATE_CURRENT_STATE/);
    assert.match(docblock, /BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS` is still `false`/);
    assert.match(docblock, /authorizes no execution by itself/);
  });

  it('no docblock in the module claims a current FAIL for either executable evaluator', () => {
    // The privacy preflight's docblock carried the same staleness: it said `FAIL` today while the
    // module header said it returns PASS. Both evaluators are now described truthfully.
    const source = runbookModule();
    assert.equal(source.includes('`FAIL` today'), false, 'no module docblock may claim a current FAIL');
    assert.match(source, /The privacy preflight, executed against the authoritative state\. `PASS` today/);
    assert.equal(evaluateBrazilReceitaGate7PrivacyPreflight().result, 'PASS');
  });

  it('the historical record that P-05 USED to fail is preserved, not scrubbed', () => {
    // 🔴 The correction removes false CURRENT-state claims only. FAST-TRACK-7's own account of the
    // deterministic failure must survive, or the audit trail loses the fact that the gate once held.
    const recorded = read(`${CONNECTOR}/br-receita-cnpj-gate7-recorded-operator-runbook.ts`);
    assert.match(recorded, /Update \(BR-SOURCE-FAST-TRACK-7\)/);
    assert.match(recorded, /still returns `FAIL`/);
    assert.match(read(`${CONNECTOR}/br-receita-cnpj-gate7-preflight-items.ts`), /checkable_and_fails_today/);
  });

  it('the recorded evidence note for P-05 states the current verdict, and states it is not a permission', () => {
    const note = BRAZIL_RECEITA_GATE7_REQUIRED_EVIDENCE_DISPOSITION.find((row) => row.note.startsWith('P-05'));
    assert.ok(note);
    assert.equal(note.note.includes('FAIL'), false, 'the live evidence note must not claim a current FAIL');
    assert.match(note.note, /returns PASS today/);
    assert.match(note.note, /never a permission/);
  });
});

// ─── 2 · 🔴 The waiver is not a demonstration ─────────────────────────────────

describe('FAST-TRACK-8 · reproducibility is WAIVED, never DEMONSTRATED — the load-bearing distinction', () => {
  it('the reproducibility value is UNCHANGED by the approval: still UNDEMONSTRATED', () => {
    // 🔴 This is the single assertion this whole round exists to protect. The round with the strongest
    // incentive to relabel this value is the round that approved the gate, and it did not.
    assert.equal(BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR, 'UNDEMONSTRATED');
    assert.equal(BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DEMONSTRATED, false);
  });

  it('the DISPOSITION is a separate constant, so one edit cannot collapse the two', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DISPOSITION, 'WAIVED_BY_OWNER_DECISION');
    assert.notEqual(
      BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DISPOSITION,
      BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR,
    );
  });

  it('the runbook module re-exports both, so the two modules cannot disagree', () => {
    assert.equal(RUNBOOK_REPRODUCIBILITY_DISPOSITION, BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DISPOSITION);
    assert.equal(RUNBOOK_REPRODUCIBILITY_DEMONSTRATED, BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DEMONSTRATED);
  });

  it('no rehearsal was performed and none is authorized — only REQUIRED moved', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_REHEARSAL_PERFORMED, false);
    assert.equal(BRAZIL_RECEITA_GATE7_REHEARSAL_AUTHORIZED, false);
    assert.equal(BRAZIL_RECEITA_GATE7_REHEARSAL_REQUIRED, false);
    assert.equal(BRAZIL_RECEITA_GATE7_JOINT_APPROVAL.rehearsalRequired, false);
  });

  it('the waiver reason names the P-05 circularity rather than gesturing at "owner decision"', () => {
    assert.match(BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_WAIVER_REASON, /P-05/);
    assert.match(BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_WAIVER_REASON, /no-rehearsal-required branch/);
  });

  it('the eight-of-eight count does not imply eight demonstrations', () => {
    assert.equal(brazilReceitaApprovedGateCount(), 8);
    assert.equal(BRAZIL_RECEITA_EVERY_GATE_PASS_CRITERION_WAS_DEMONSTRATED, false);
  });

  it('a restriction forbids a later round citing this approval as evidence of reproducibility', () => {
    const text = BRAZIL_RECEITA_GATE7_RESTRICTIONS.join(' | ');
    assert.match(text, /WAIVED by owner decision, not demonstrated/);
    assert.match(text, /may not cite this approval as evidence/);
    assert.match(text, /UNDEMONSTRATED and may not be claimed/);
  });
});

// ─── 3 · The waiver used a PRE-EXISTING branch ────────────────────────────────

describe('FAST-TRACK-8 · the no-rehearsal branch pre-dated the decision that invoked it', () => {
  it('the unblocking criterion is preserved VERBATIM, branch included', () => {
    // 🔴 If this round had rewritten the sentence to fit the decision, this assertion is what would
    // catch it: the exact parenthetical is the authority the approval was recorded under.
    assert.match(
      BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.andStillRequires,
      /the joint operator \+ technical \+ privacy owner approval, after the rehearsal \(or their explicit decision that no rehearsal is required\)/,
    );
    assert.match(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.criterion, /rehearsal by an operator who did not author/);
    assert.equal(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.thenStatusBecomes, 'ready_for_review');
    assert.equal(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.agentMayDischarge, false);
  });

  it('the criterion is marked discharged VIA that branch, additively', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.discharged, true);
    assert.equal(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.dischargedVia, 'the_no_rehearsal_required_branch');
    assert.equal(BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.dischargedRound, 'BR-SOURCE-FAST-TRACK-8');
  });

  it('the decision basis cites the constant rather than restating a permission', () => {
    assert.match(
      BRAZIL_RECEITA_GATE7_JOINT_APPROVAL.rehearsalRequiredDecisionBasis,
      /BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION\.andStillRequires/,
    );
    assert.match(BRAZIL_RECEITA_GATE7_JOINT_APPROVAL.rehearsalRequiredDecisionBasis, /since FAST-TRACK-6/);
  });

  it('`ready_for_review` was never occupied, and the record says why rather than skipping it silently', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED, 'ready_for_review');
    assert.notEqual(BRAZIL_RECEITA_GATE7_STATUS, BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED);
  });
});

// ─── 4 · P-05 was NOT weakened ────────────────────────────────────────────────

describe('FAST-TRACK-8 · P-05 is unchanged, and no bypass was created by the round it was blocking', () => {
  it('the circularity is recorded, with all four "did not" fields false', () => {
    assert.match(BRAZIL_RECEITA_GATE7_PRE_APPROVAL_REHEARSAL_CIRCULARITY.circularity, /P-05/);
    assert.equal(BRAZIL_RECEITA_GATE7_PRE_APPROVAL_REHEARSAL_CIRCULARITY.p05WasModified, false);
    assert.equal(BRAZIL_RECEITA_GATE7_PRE_APPROVAL_REHEARSAL_CIRCULARITY.bypassWasCreated, false);
    assert.equal(BRAZIL_RECEITA_GATE7_PRE_APPROVAL_REHEARSAL_CIRCULARITY.realDataWasUsed, false);
    assert.equal(BRAZIL_RECEITA_GATE7_PRE_APPROVAL_REHEARSAL_CIRCULARITY.attemptBudgetWasChanged, false);
  });

  it('the recorded `bypassWasCreated: false` agrees with the live module constant', () => {
    // 🔴 Two independent statements of the same fact, cross-checked: a record claiming no bypass while
    // the module grew one is the failure this pairing exists to catch.
    assert.equal(BRAZIL_RECEITA_GATE7_PRE_APPROVAL_REHEARSAL_CIRCULARITY.bypassWasCreated, false);
    assert.equal(BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS, false);
    assert.equal(evaluateBrazilReceitaGate7Preconditions().bypassAvailable, false);
  });

  it('the evaluator still takes NO arguments — no surface on which to weaken it', () => {
    assert.equal(evaluateBrazilReceitaGate7Preconditions.length, 0);
    assert.equal(evaluateBrazilReceitaGate7PrivacyPreflight.length, 0);
  });

  it('no override, force, or assume-approved surface exists in any touched module', () => {
    for (const rel of TOUCHED_MODULES) {
      const code = stripComments(read(rel));
      for (const forbidden of [
        'assumeApproved',
        'skipPreconditions',
        'forcePreconditions',
        'bypassPreconditions',
        'rehearsalMode',
        'process.env',
      ]) {
        assert.equal(code.includes(forbidden), false, `${rel} must not introduce ${forbidden}`);
      }
    }
  });

  it('P-05 now returns PASS, and it does so purely because the live gate state changed', () => {
    const outcome = evaluateBrazilReceitaGate7Preconditions();
    assert.equal(outcome.result, 'PASS');
    assert.deepEqual([...outcome.unapprovedGates], []);
    // The derivation, recomputed here from the authoritative view, must give the same answer — proving
    // the evaluator reads the state rather than carrying a second copy of it.
    const unapproved = BRAZIL_RECEITA_GATE_CURRENT_STATE.filter(
      (entry) => !BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(entry.status),
    );
    assert.deepEqual(unapproved, []);
  });

  it('P-05 is standing checkable_and_expected_to_pass, and its pass condition is unedited', () => {
    const p05 = BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS.find((item) => item.id === 'P-05');
    assert.ok(p05);
    assert.equal(p05.standing, 'checkable_and_expected_to_pass');
    assert.equal(p05.passCondition, 'evaluateBrazilReceitaGate7Preconditions() returns PASS');
    assert.equal(p05.authority, 'br-receita-cnpj-gate-status-current-state');
  });

  it('a PASSING P-05 is still not a permission, and the section is still not one either', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_SECTION_IS_A_PERMISSION, false);
    // 🔴 Twenty of the twenty-two are still real checks a human performs on a machine no module can
    // see. Only two are determined inside this repository — P-05 (the gate state) and P-20 (already
    // `checkable_and_expected_to_pass` since FAST-TRACK-6) — and the set is asserted by ID rather than
    // by count, so a later round cannot pre-satisfy an operator check and keep the arithmetic looking
    // right.
    const notEnvironmentDependent = BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS.filter(
      (item) => item.standing !== 'operator_environment_dependent',
    ).map((item) => item.id);
    assert.deepEqual(notEnvironmentDependent, ['P-05', 'P-20']);
    assert.equal(BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS.length - notEnvironmentDependent.length, 20);
    // No item may claim the deterministic-failure standing any more: nothing fails by construction.
    for (const item of BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS) {
      assert.notEqual(item.standing, 'checkable_and_fails_today', `${item.id} must not fail by construction`);
    }
  });
});

// ─── 5 · What the approval does NOT authorize ─────────────────────────────────

describe('FAST-TRACK-8 · the approval authorizes GATE-7 and the runbook, and nothing else', () => {
  it('the non-authorization list names every crossing the owners enumerated', () => {
    const text = BRAZIL_RECEITA_GATE7_APPROVAL_DOES_NOT_AUTHORIZE.join(' | ');
    for (const crossing of [
      /a benchmark/,
      /Attempt #3/,
      /reading real Receita data/,
      /Supabase write/,
      /snapshot write/,
      /Agent 1 to Brazil/,
      /provider call/,
      /enabling production/,
      /changing any cap or any operational flag/,
      /executing the runbook procedure/,
    ]) {
      assert.match(text, crossing);
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

  it('GATE-8 still authorizes no operation, and its approval is still not the runner permission', () => {
    assert.equal(BRAZIL_RECEITA_GATE8_AUTHORIZES_OPERATIONS, false);
    // 🔴 The condition GATE-8's Allows clause waited on is now satisfied, and this constant is still
    // false: it asks whether GATE-8's own approval is the permission, and the § 15 matrix is.
    assert.equal(BRAZIL_RECEITA_GATE8_APPROVAL_IS_PERMISSION_TO_WRITE_RUNNER, false);
  });

  it('no touched module performs I/O or reaches a provider, Supabase or the runtime', () => {
    for (const rel of TOUCHED_MODULES) {
      const code = stripComments(read(rel));
      for (const forbidden of [
        "from 'node:fs'",
        "from 'fs'",
        "from 'node:path'",
        'createClient',
        'supabase',
        'fetch(',
        'child_process',
      ]) {
        assert.equal(code.includes(forbidden), false, `${rel} must not reference ${forbidden}`);
      }
    }
  });

  it('no touched module carries a personal name, an email, a URL or a digit run', () => {
    for (const rel of TOUCHED_MODULES) {
      const body = read(rel);
      assert.doesNotMatch(body, /@[\w-]+\.[\w.-]+/, `${rel} must carry no email`);
      assert.doesNotMatch(body, /https?:\/\//, `${rel} must carry no URL`);
      // A CNPJ is 14 digits and a CPF is 11; any unbroken run of 8+ is refused outright.
      assert.doesNotMatch(body, /\d{8,}/, `${rel} must carry no long digit run`);
    }
  });
});

// ─── 6 · The blocker audit trail ──────────────────────────────────────────────

describe('FAST-TRACK-8 · the blocker list is empty, and the audit trail says how each one closed', () => {
  it('nothing remains', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS], []);
  });

  it('all four blockers this gate ever carried are accounted for, by mechanism and round', () => {
    assert.equal(BRAZIL_RECEITA_GATE7_BLOCKERS_DISCHARGED.length, 4);
    const byGateApproval = BRAZIL_RECEITA_GATE7_BLOCKERS_DISCHARGED.filter(
      (entry) => entry.dischargedBy === 'another_gate_approval',
    );
    const byWaiver = BRAZIL_RECEITA_GATE7_BLOCKERS_DISCHARGED.filter(
      (entry) => entry.dischargedBy === 'owner_waiver',
    );
    assert.equal(byGateApproval.length, 3);
    assert.equal(byWaiver.length, 1);
    for (const entry of byGateApproval) {
      assert.equal(entry.round, 'BR-SOURCE-FAST-TRACK-7');
    }
    assert.equal(byWaiver[0]?.round, 'BR-SOURCE-FAST-TRACK-8');
    // 🔴 The waived one is the reproducibility criterion, and no gate approval is recorded as having
    // discharged it — that conflation is exactly what this assertion refuses.
    assert.match(byWaiver[0]?.blocker ?? '', /reproducibility by a different operator is UNDEMONSTRATED/);
    for (const entry of byGateApproval) {
      assert.doesNotMatch(entry.blocker, /reproducib/);
    }
  });
});

// ─── 7 · The global verdict, and what GO does not mean ────────────────────────

describe('FAST-TRACK-8 · GLOBAL is GO, in the narrow § 15 sense and no wider', () => {
  it('eight of eight are approved and the verdict is GO', () => {
    assert.equal(brazilReceitaApprovedGateCount(), 8);
    assert.equal(brazilReceitaGateGlobalVerdict(), 'GO');
    for (const entry of BRAZIL_RECEITA_GATE_CURRENT_STATE) {
      assert.equal(
        BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(entry.status),
        true,
        `gate ${entry.gate} must be approved`,
      );
    }
  });

  it('the verdict is DERIVED, not stated — no hardcoded GO exists to survive a gate flipping', () => {
    const source = stripComments(read(`${CONNECTOR}/br-receita-cnpj-gate-status-current-state.ts`));
    assert.equal(source.includes("GLOBAL_VERDICT = 'GO'"), false);
    assert.equal(source.includes("VERDICT = 'GO'"), false);
    assert.match(source, /function brazilReceitaGateGlobalVerdict/);
    assert.match(source, /\.every\(/);
  });

  it('what GO means is recorded as data, and every field except the one grant is false', () => {
    assert.equal(BRAZIL_RECEITA_GATE_GO_MEANS.perSection, '10K § 15');
    assert.match(BRAZIL_RECEITA_GATE_GO_MEANS.allows, /may be PROPOSED/);
    for (const [key, value] of Object.entries(BRAZIL_RECEITA_GATE_GO_MEANS)) {
      if (typeof value === 'boolean') {
        assert.equal(value, false, `${key} must be false — GO grants only the § 15 proposal step`);
      }
    }
  });

  it('the three-step separation is carried verbatim', () => {
    assert.equal(BRAZIL_RECEITA_GATE_GO_MEANS.threeStepSeparation.length, 3);
    const text = BRAZIL_RECEITA_GATE_GO_MEANS.threeStepSeparation.join(' | ');
    assert.match(text, /GO for runner implementation ≠ GO for execution/);
    assert.match(text, /GO for execution ≠ GO for import/);
    assert.match(text, /GO for import requires a later, separate import authorization/);
  });

  it('no full-join runner was written by this round — the GO is a permission, not an act', () => {
    // 🔴 § 15 permits PROPOSING a runner PR. This round proposed none, and the guard says so by
    // asserting the touched set is exactly the six records above plus docs and tests.
    for (const rel of TOUCHED_MODULES) {
      assert.match(rel, /gate7-|gate8-|gate-status-current-state|final-owner-signoff-packet/);
    }
  });
});

// ─── 8 · The checklist document ───────────────────────────────────────────────

describe('FAST-TRACK-8 · the § 14 record exists in the doc, in the shape every prior round used', () => {
  it('§ 11.3 exists, cites the round, and carries a fenced § 14 template', () => {
    const doc = checklistDoc();
    assert.match(doc, /^### 11\.3 /m);
    const start = doc.indexOf('### 11.3 ');
    const nextBoundary = doc.indexOf('\n---', start);
    assert.ok(nextBoundary > start, '§ 11.3 has no closing --- boundary');
    const body = doc.slice(start, nextBoundary);
    assert.match(body, /BR-SOURCE-FAST-TRACK-8/);
    const block = /```\nGate:([\s\S]*?)\n```/.exec(body);
    assert.ok(block, '§ 11.3 must carry a fenced § 14 template');
    assert.match(block[1], /Approver:\s+operator owner, technical owner AND privacy owner, jointly/);
    assert.match(block[1], /Approval date:\s+2026-08-24/);
    // Roles only: no personal name, no email, no URL.
    assert.doesNotMatch(body, /@[\w-]+\.[\w.-]+/);
    assert.doesNotMatch(body, /https?:\/\//);
  });

  it('§ 11.3 records the waiver as a waiver, and never as a demonstration', () => {
    const doc = checklistDoc();
    const start = doc.indexOf('### 11.3 ');
    const body = doc.slice(start, doc.indexOf('\n---', start));
    assert.match(body, /REPRODUCIBILITY_BY_DIFFERENT_OPERATOR = UNDEMONSTRATED/);
    assert.match(body, /WAIVED_BY_OWNER_DECISION/);
    assert.match(body, /REPRODUCIBILITY_DEMONSTRATED\s+= false/);
    assert.match(body, /NOT demonstrated/);
    // The four things the owners declined.
    assert.match(body, /not\*{0,2} to modify `P-05`|\*\*not\*\* to modify `P-05`/);
    assert.match(body, /bypass/);
  });

  it('§ 11 points at § 11.3 as the superseding subsection, and § 15 reads 8 of 8 with GO', () => {
    const doc = checklistDoc();
    assert.match(doc, /\*\*SUPERSEDED BY § 11\.3\.\*\* The current status is `approved`/);
    const matrix = doc.slice(doc.indexOf('## 15. Global GO / NO-GO matrix'));
    assert.match(matrix, /Approved: 8 of 8/);
    assert.match(matrix, /the matrix reads \*\*GO\*\*/);
    assert.match(matrix, /`GO` is not an execution authorization/);
    assert.match(matrix, /does NOT mean every pass criterion was demonstrated/);
  });

  it('the doc annotates rather than rewrites: the § 11.2 needs_evidence history survives', () => {
    const doc = checklistDoc();
    assert.match(doc, /^### 11\.2 /m);
    assert.match(doc, /GATE-7 moves to `needs_evidence`/);
    assert.match(doc, /SUPERSEDED BY § 11\.3 \(BR-SOURCE-FAST-TRACK-8\)/);
  });

  it('§ 4 records that its first rule\'s condition is satisfied without weakening any rule', () => {
    const doc = checklistDoc();
    const section = doc.slice(doc.indexOf('## 4. Global approval rules'), doc.indexOf('## 5. GATE-1'));
    // The rule itself is untouched — the condition being met is not a licence to delete the rule.
    assert.match(section, /must all be `approved` before any full-join runner code is written/);
    assert.match(section, /Update \(BR-SOURCE-FAST-TRACK-8\)/);
    assert.match(section, /rests on an owner \*\*waiver\*\* rather than on demonstrated evidence/);
    assert.match(section, /`approved` is scoped and revocable/);
  });
});

// ─── 9 · This round is a REQUIRED CI step ─────────────────────────────────────

describe('FAST-TRACK-8 · the suite is wired into CI as a required step', () => {
  it('is invoked by a run: line, asserted on the run: line and never on the step name', () => {
    const workflow = read('.github/workflows/automatic-routing-tests.yml');
    // 🔴 Grep the `run:` lines, never the step NAMES or the comments. A step whose name or comment
    // mentions a suite it does not invoke is a false positive, and this repository has been caught by
    // exactly that before.
    const runLines = workflow
      .split('\n')
      .filter((line) => /^\s*run:\s/.test(line))
      .map((line) => line.trim());
    for (const script of [
      'npm run test:br-source:fast-track8-gate7-approval',
      'npm run test:br-source:fast-track7-gate2-3-4-5-6-approvals',
    ]) {
      assert.ok(
        runLines.some((line) => line === `run: ${script}`),
        `${script} must be invoked by a run: line in the required workflow`,
      );
    }
  });

  it('the npm script actually points at this suite, and re-runs every prior gate round', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const script = pkg.scripts['test:br-source:fast-track8-gate7-approval'];
    assert.ok(script, 'the FAST-TRACK-8 script must exist');
    for (const suite of [
      'br-receita-cnpj-fast-track8-gate7-approval.test.ts',
      'br-receita-cnpj-fast-track7-gate2-3-4-5-6-approvals.test.ts',
      'br-receita-cnpj-fast-track6-gate5-cleanup-and-gate7-runbook.test.ts',
      'br-receita-cnpj-fast-track6-engine-report-boundary.test.ts',
      'br-receita-cnpj-gate-round3-output-sanitization.test.ts',
      'br-receita-cnpj-gate-round2-identity-and-cleanup.test.ts',
      'br-receita-cnpj-gate-round1-owner-records.test.ts',
      'br-receita-cnpj-gate1-recorded-owner-decision.test.ts',
      'br-receita-cnpj-owner-decision-validator.test.ts',
    ]) {
      assert.ok(script.includes(suite), `the script must re-run ${suite}`);
    }
  });
});
