/**
 * BR Receita CNPJ — the EXECUTABLE GATE-7 operator runbook (BR-SOURCE-FAST-TRACK-6).
 *
 * GATE-7 is the operator runbook gate (10K § 11). BR-SOURCE-10PQR § 6 landed its CONTRACT — the
 * twenty-two-item preflight `P-01` … `P-22`, sixteen non-overridable stop conditions `T-01` … `T-16`,
 * the closed permitted-evidence list, and the twenty assertions `OR-A01` … `OR-A20` — and was
 * explicit that **the runbook section itself does not exist**. 10K § 11's *Expected artifacts* asks
 * for a runbook SECTION; a contract describing the shape of one is not that artifact.
 *
 * This module is the machine-readable half of the section that now exists. The prose half is
 * `docs/source-catalog/br-receita-cnpj-manual-download-local-prep-runbook.md` § 16 — an EXTENSION of
 * the existing manual-download / local-prep runbook, never a competing document (10K § 11).
 *
 * ── 🔴 What "executable" means here, and what it does not ────────────────────
 *
 * The preflight EVALUATOR is executable: it reads the authoritative gate current-state view and
 * returns a verdict. Everything else is a closed enumeration a human follows and a test can assert.
 *
 * It does NOT mean the procedure can be executed by calling this module. Nothing here opens a file,
 * reads a manifest, measures memory, deletes an artifact, or starts a run — because a runbook whose
 * steps an agent could perform is a runbook an agent could perform, and 10PQR § 6.1 restricts
 * execution to a named authorized HUMAN operator with no "on behalf of" clause.
 *
 * ── 🔴 Today's verdict, and why it is the correct one ────────────────────────
 *
 * `evaluateBrazilReceitaGate7Preconditions()` still returns `FAIL` today — but as of
 * BR-SOURCE-FAST-TRACK-7, for a different and single reason: GATE-2, GATE-5 and GATE-6 are now
 * `approved`, so `unapprovedBlockingGates` is empty, but the evaluator checks the current state of
 * ALL EIGHT gates including GATE-7's own, and GATE-7 itself is not `approved`
 * (`BRAZIL_RECEITA_GATE7_STATUS` is `needs_evidence`). `evaluateBrazilReceitaGate7PrivacyPreflight()`
 * now returns `PASS`, because all five contracts it checks — owned by GATE-2 … GATE-6 — are approved.
 * Neither function was edited to produce these outcomes: both are unconditional derivations from
 * `BRAZIL_RECEITA_GATE_CURRENT_STATE`, and there is deliberately no parameter, option, environment
 * read or override that could produce any other verdict. A bypass is the one feature this module must
 * not have.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - approves a gate, advances a gate, or reports an unapproved gate as approved.
 *   - authorizes a run, a rehearsal, a benchmark, real-data access, a report emission, snapshot
 *     persistence, an import, a Supabase write, a migration, a runtime path, Agent 1, Agent 2A or a
 *     provider call.
 *   - changes an attempt budget, a resource cap, a flag, or a cleanup policy. It READS ceilings from
 *     the records that own them and restates none of them.
 *   - carries a real local path, a manifest, a file name, a CNPJ, a CPF, a personal name or a
 *     signature.
 */

import {
  BRAZIL_RECEITA_GATE_APPROVED_STATUSES,
  BRAZIL_RECEITA_GATE_CURRENT_STATE,
  type BrazilReceitaGateStatus,
} from './br-receita-cnpj-gate-status-current-state';
import {
  BRAZIL_RECEITA_GATE2_APPROVED_CAPS,
  BRAZIL_RECEITA_GATE2_OPERATOR_SUPPLIED_AT_INVOCATION,
  BRAZIL_RECEITA_GATE2_OWNER_DECIDED_CAPS_CLASSIFICATION,
  BRAZIL_RECEITA_GATE2_WORKSPACE_CONSTRAINTS,
} from './br-receita-cnpj-gate2-recorded-owner-decision';
import {
  BRAZIL_RECEITA_GATE6_COMPLETED_REQUIRES,
  BRAZIL_RECEITA_GATE6_FORBIDDEN_IN_SUMMARY,
  BRAZIL_RECEITA_GATE6_PERMITTED_RESIDUAL_SUMMARY,
  BRAZIL_RECEITA_GATE6_STATUS_DISPOSITION,
  BRAZIL_RECEITA_GATE6_SUCCESS_WITH_RESIDUE_PERMITTED,
  BRAZIL_RECEITA_GATE6_TERMINATING_PATHS,
} from './br-receita-cnpj-gate6-recorded-cleanup-contract';
import {
  BRAZIL_RECEITA_GATE7_REHEARSAL_AUTHORIZED as RECORDED_REHEARSAL_AUTHORIZED,
  BRAZIL_RECEITA_GATE7_REHEARSAL_PERFORMED as RECORDED_REHEARSAL_PERFORMED,
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR as RECORDED_REPRODUCIBILITY,
  BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION as RECORDED_RUNBOOK_SECTION,
  BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION_EXISTS as RECORDED_RUNBOOK_SECTION_EXISTS,
} from './br-receita-cnpj-gate7-recorded-operator-runbook';
import { BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED } from './br-receita-cnpj-real-benchmark-attempt-ledger';
import {
  BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_BEFORE_START,
  BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_RESERVE,
} from './br-receita-cnpj-full-join-free-disk';
import {
  BR_RECEITA_CNPJ_NATIONAL_PART_COUNT,
  BR_RECEITA_CNPJ_OPTIONAL_FILE_TYPES,
  BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
} from './br-receita-cnpj-manifest';

// ─── Where the section lives ──────────────────────────────────────────────────

/**
 * The section's existence and location, RE-EXPORTED from the recorded module that owns them.
 *
 * 🔴 Not defined here, and the reason is structural rather than stylistic. This module imports the
 * gate current-state view for its executable `P-05`, and that view imports the recorded GATE-7 module
 * for GATE-7's status. A definition here plus an import there would close an ESM cycle that fails at
 * module-initialization time. One owner, re-exported, so there is no second copy to drift.
 */
export const BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION_EXISTS = RECORDED_RUNBOOK_SECTION_EXISTS;
export const BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION = RECORDED_RUNBOOK_SECTION;

/**
 * 🔴 A section is a PROCEDURE, never a PERMISSION (10K § 11 *Does NOT allow*).
 *
 * The single most likely misreading of this milestone is that a complete runbook makes a run
 * possible. It does not: executing requires the separate, explicit authorization of a future
 * milestone, which no gate in this series grants and which this module cannot grant.
 */
export const BRAZIL_RECEITA_GATE7_SECTION_IS_A_PERMISSION = false as const;

// ─── § 16.1 who may operate ───────────────────────────────────────────────────

/** The only actor class that may execute the procedure. One value, and no second one. */
export const BRAZIL_RECEITA_GATE7_PERMITTED_OPERATOR_CLASS =
  'named_authorized_human_operator' as const;

/**
 * Actor classes that may never execute it. The last entry is the one that matters most: a human
 * delegating the procedure to an agent is an AGENT executing it, and 10PQR § 6.1 closes that door
 * explicitly rather than leaving it to good intentions.
 */
export const BRAZIL_RECEITA_GATE7_FORBIDDEN_OPERATOR_CLASSES: readonly string[] = [
  'agent',
  'automation',
  'ci_runner',
  'cron_or_scheduled_job',
  'background_task',
  'agent_acting_on_behalf_of_a_human',
];

/** An operator may not also be the sole approver of this gate (10K § 3 implementer rule). */
export const BRAZIL_RECEITA_GATE7_OPERATOR_MAY_BE_SOLE_APPROVER = false as const;

/**
 * Decides whether a claimed actor may execute. Mechanical rather than advisory, because "clearly
 * stated" and "checkable" are not the same property and only the second one survives a busy day.
 *
 * Fail-closed twice over: an actor class this module does not RECOGNIZE is refused, and the
 * "on behalf of" class is refused even though it names a human.
 */
export function brazilReceitaGate7ActorMayExecute(actorClass: string): boolean {
  if (BRAZIL_RECEITA_GATE7_FORBIDDEN_OPERATOR_CLASSES.includes(actorClass)) return false;
  return actorClass === BRAZIL_RECEITA_GATE7_PERMITTED_OPERATOR_CLASS;
}

// ─── § 16.2 the preconditions, evaluated ──────────────────────────────────────

/**
 * The gates GATE-7's own contract names as blocking it: GATE-2, GATE-5 and GATE-6 (10K § 11 update,
 * 10PQR § 6.2). `P-05` is stricter still and requires ALL eight, which is why the evaluator below
 * checks the whole state and reports both answers.
 */
export const BRAZIL_RECEITA_GATE7_BLOCKING_GATES: readonly number[] = [2, 5, 6];

export type BrazilReceitaGate7PreconditionResult = 'PASS' | 'FAIL';

export interface BrazilReceitaGate7UnapprovedGate {
  readonly gate: number;
  readonly status: BrazilReceitaGateStatus;
}

export interface BrazilReceitaGate7PreconditionOutcome {
  readonly result: BrazilReceitaGate7PreconditionResult;
  /** Every gate not in an approved status. `P-05` requires this to be empty. */
  readonly unapprovedGates: readonly BrazilReceitaGate7UnapprovedGate[];
  /** The subset of the above that GATE-7's own contract names as blocking it. */
  readonly unapprovedBlockingGates: readonly BrazilReceitaGate7UnapprovedGate[];
  /** Whether a bypass was available. Always `false`; returned so a caller can assert it. */
  readonly bypassAvailable: false;
}

/**
 * `P-05`, executed. Reads the authoritative current-state view and refuses to proceed unless every
 * gate is approved.
 *
 * 🔴 Three properties, each of which is the whole point:
 *
 *   · it takes NO arguments. There is no options object, no `force`, no `assumeApproved`, no
 *     environment read — so there is no surface on which a future caller could weaken it.
 *   · it derives from `BRAZIL_RECEITA_GATE_CURRENT_STATE`, which itself imports each per-gate
 *     recorded module. A gate cannot be reported approved here without its owning module saying so.
 *   · it returns `FAIL` today, and that is the CORRECT answer. A procedure whose first step fails is
 *     the gate working.
 */
export function evaluateBrazilReceitaGate7Preconditions(): BrazilReceitaGate7PreconditionOutcome {
  const unapprovedGates = BRAZIL_RECEITA_GATE_CURRENT_STATE.filter(
    (entry) => !BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(entry.status),
  ).map((entry) => ({ gate: entry.gate as number, status: entry.status }));

  const unapprovedBlockingGates = unapprovedGates.filter((entry) =>
    BRAZIL_RECEITA_GATE7_BLOCKING_GATES.includes(entry.gate),
  );

  return {
    result: unapprovedGates.length === 0 ? 'PASS' : 'FAIL',
    unapprovedGates,
    unapprovedBlockingGates,
    bypassAvailable: false,
  };
}

/** Whether any bypass, override, or "proceed anyway" path exists. It does not. */
export const BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS = false as const;

// ─── § 16.3 the preflight, item by item ───────────────────────────────────────

/**
 * `P-01` … `P-22`, re-exported from the module that owns them.
 *
 * The enumeration lives in `br-receita-cnpj-gate7-preflight-items` because it is the part of this
 * contract an operator actually re-reads, and it is re-exported here so a consumer of the runbook
 * contract still finds it in one place.
 */
export {
  BRAZIL_RECEITA_GATE7_FAILED_PREFLIGHT_ITEM_IS_A_STOP,
  BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS,
  BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEM_COUNT,
  BRAZIL_RECEITA_GATE7_WARNING_IS_EVER_A_PASS,
  type BrazilReceitaGate7PreflightItem,
  type BrazilReceitaGate7PreflightStanding,
} from './br-receita-cnpj-gate7-preflight-items';

// ─── § 16.4 the resource preflight ────────────────────────────────────────────

/**
 * How to read a ceiling. GATE-2's own record classifies its numbers as OWNER DECISION values and not
 * observed measurements, and this field carries that classification forward rather than letting a
 * runbook reader mistake a decision for a proven envelope.
 */
export type BrazilReceitaGate7CeilingKind = 'owner_decision_value' | 'standing_proposal_value';

export interface BrazilReceitaGate7ResourceCheck {
  readonly signal: string;
  readonly ceiling: number;
  readonly kind: BrazilReceitaGate7CeilingKind;
  readonly authority: string;
  /** Whether the operator must supply this cap explicitly at invocation, every run. */
  readonly operatorSuppliedAtInvocation: boolean;
}

/**
 * The ten GATE-2 ceilings plus the two free-disk thresholds, each verified BEFORE execution.
 *
 * 🔴 Every `ceiling` below is READ from its owning record — there is not one literal number in this
 * array. A runbook that restates a cap is a runbook that can disagree with the approval it claims to
 * follow, and the round's suite asserts each value against its owner.
 */
export const BRAZIL_RECEITA_GATE7_RESOURCE_PREFLIGHT_CHECKS: readonly BrazilReceitaGate7ResourceCheck[] =
  [
    {
      signal: 'rss',
      ceiling: BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxRssBytes,
      kind: 'owner_decision_value',
      authority: 'BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxRssBytes',
      operatorSuppliedAtInvocation: false,
    },
    {
      signal: 'heap_used',
      ceiling: BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxHeapUsedBytes,
      kind: 'owner_decision_value',
      authority: 'BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxHeapUsedBytes',
      operatorSuppliedAtInvocation: false,
    },
    {
      signal: 'external_memory',
      ceiling: BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxExternalMemoryBytes,
      kind: 'owner_decision_value',
      authority: 'BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxExternalMemoryBytes',
      operatorSuppliedAtInvocation: false,
    },
    {
      signal: 'runtime',
      ceiling: BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxRuntimeMs,
      kind: 'owner_decision_value',
      authority: 'BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxRuntimeMs',
      operatorSuppliedAtInvocation: false,
    },
    {
      signal: 'phase_runtime',
      ceiling: BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxPhaseRuntimeMs,
      kind: 'owner_decision_value',
      authority: 'BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxPhaseRuntimeMs',
      operatorSuppliedAtInvocation: false,
    },
    {
      signal: 'temporary_storage',
      ceiling: BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxTemporaryStorageBytes,
      kind: 'owner_decision_value',
      authority: 'BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxTemporaryStorageBytes',
      operatorSuppliedAtInvocation: false,
    },
    {
      signal: 'rows_read',
      ceiling: BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxRowsRead,
      kind: 'owner_decision_value',
      authority: 'BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxRowsRead',
      operatorSuppliedAtInvocation: false,
    },
    {
      signal: 'files_opened',
      ceiling: BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxFilesOpened,
      kind: 'owner_decision_value',
      authority: 'BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxFilesOpened',
      operatorSuppliedAtInvocation: true,
    },
    {
      signal: 'bytes_read',
      ceiling: BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxBytesRead,
      kind: 'owner_decision_value',
      authority: 'BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxBytesRead',
      operatorSuppliedAtInvocation: true,
    },
    {
      signal: 'join_keys_in_memory',
      ceiling: BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxJoinKeysInMemory,
      kind: 'owner_decision_value',
      authority: 'BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxJoinKeysInMemory',
      operatorSuppliedAtInvocation: true,
    },
    {
      signal: 'minimum_free_disk_before_start',
      ceiling: BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_BEFORE_START,
      kind: 'standing_proposal_value',
      authority: 'BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_BEFORE_START',
      operatorSuppliedAtInvocation: true,
    },
    {
      signal: 'minimum_free_disk_reserve',
      ceiling: BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_RESERVE,
      kind: 'standing_proposal_value',
      authority: 'BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_RESERVE',
      operatorSuppliedAtInvocation: true,
    },
  ];

/**
 * 🔴 A ceiling is a DECISION, not a measurement. Carried forward verbatim from GATE-2's own
 * classification so the runbook cannot present a chosen bound as a proven envelope.
 */
export const BRAZIL_RECEITA_GATE7_CEILING_CLASSIFICATION =
  BRAZIL_RECEITA_GATE2_OWNER_DECIDED_CAPS_CLASSIFICATION;

/** The caps the operator must pass explicitly on every run, however written-down they are. */
export const BRAZIL_RECEITA_GATE7_OPERATOR_SUPPLIED_CAPS =
  BRAZIL_RECEITA_GATE2_OPERATOR_SUPPLIED_AT_INVOCATION;

// ─── § 16.5 the workspace preflight ───────────────────────────────────────────

/**
 * The workspace constraints, imported rather than restated. 10K § 14 forbids a real path in an
 * approval record and this module holds none: every entry is a CONSTRAINT the operator resolves
 * against, and the resolved directory is never learned here nor reported anywhere.
 */
export const BRAZIL_RECEITA_GATE7_WORKSPACE_PREFLIGHT = BRAZIL_RECEITA_GATE2_WORKSPACE_CONSTRAINTS;

/** The resolved local path may never appear in a sanitized report, on any surface. */
export const BRAZIL_RECEITA_GATE7_LOCAL_PATH_MAY_APPEAR_IN_REPORTS = false as const;

/** What the operator confirms about the workspace, in order, before anything is created. */
export const BRAZIL_RECEITA_GATE7_WORKSPACE_CONFIRMATIONS: readonly string[] = [
  'the directory is outside the repository and outside every worktree of it',
  'the directory is outside $HOME',
  'the directory is outside the dataset root',
  'no component of the path is a symlink',
  'the directory mode is 0700',
  'every file the run creates is mode 0600',
  'no cloud sync, backup agent, or file-sharing client watches the directory',
];

// ─── § 16.6 the dataset and manifest preflight ────────────────────────────────

/** The families the run requires, and the multipart count a full national period carries. */
export const BRAZIL_RECEITA_GATE7_REQUIRED_FAMILIES = BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES;
export const BRAZIL_RECEITA_GATE7_LOOKUP_FAMILIES = BR_RECEITA_CNPJ_OPTIONAL_FILE_TYPES;
export const BRAZIL_RECEITA_GATE7_NATIONAL_PART_COUNT = BR_RECEITA_CNPJ_NATIONAL_PART_COUNT;

/**
 * Families whose PRESENCE is a hard stop, not a warning to note and continue past.
 *
 * 🔴 These are person-linked, which is what makes their presence a GATE-1 problem rather than a data
 * problem: the legal approval on record covers company and establishment registry material, and a
 * person-linked family in the folder means the run would be processing something nobody approved.
 */
export const BRAZIL_RECEITA_GATE7_FORBIDDEN_FAMILIES: readonly string[] = [
  'socios',
  'qsa',
  'cpf',
  'person_linked_any',
];

/** What the operator verifies about the dataset before the run. Any miss is a hard stop. */
export const BRAZIL_RECEITA_GATE7_DATASET_PREFLIGHT: readonly string[] = [
  'the publication period matches the one the authorization names',
  'every declared family is an approved family',
  'the Empresas multipart set is COMPLETE for the period',
  'the Estabelecimentos multipart set is COMPLETE for the period',
  'the required lookup families are present',
  'no Socios family is present',
  'no QSA family is present',
  'no CPF or person-linked family is present',
  'the manifest is a LOCAL FILE manifest; a URL manifest is refused',
  'no archive extension appears among the declared data files',
];

/** An unexpected family is terminal. Stated as data so no future caller can downgrade it. */
export const BRAZIL_RECEITA_GATE7_UNEXPECTED_FAMILY_DISPOSITION = 'HARD_STOP' as const;

// ─── § 16.7 the privacy preflight ─────────────────────────────────────────────

export interface BrazilReceitaGate7PrivacyContractCheck {
  readonly contract: string;
  readonly owningGate: number;
  readonly requiredStatus: 'approved';
}

/**
 * The five approved contracts a future execution depends on. Every one must be `approved` — not
 * `ready_for_review`, not `needs_owner_confirmation`, not "recorded".
 *
 * 🔴 There is no operator discretion here, and that is deliberate. An operator who can decide that a
 * `ready_for_review` contract is "good enough" has replaced the gate model with a judgement call,
 * which is the one substitution 10K § 4 forbids in every one of its clauses.
 */
export const BRAZIL_RECEITA_GATE7_PRIVACY_PREFLIGHT_CONTRACTS: readonly BrazilReceitaGate7PrivacyContractCheck[] =
  [
    { contract: 'temporary_metadata_envelope', owningGate: 2, requiredStatus: 'approved' },
    { contract: 'field_survival_allowlist', owningGate: 3, requiredStatus: 'approved' },
    { contract: 'exact_identity_grain', owningGate: 4, requiredStatus: 'approved' },
    { contract: 'output_sanitization', owningGate: 5, requiredStatus: 'approved' },
    { contract: 'executable_cleanup', owningGate: 6, requiredStatus: 'approved' },
  ];

export interface BrazilReceitaGate7PrivacyPreflightOutcome {
  readonly result: BrazilReceitaGate7PreconditionResult;
  readonly unapprovedContracts: readonly {
    readonly contract: string;
    readonly owningGate: number;
    readonly status: BrazilReceitaGateStatus;
  }[];
  readonly operatorDiscretionAvailable: false;
}

/**
 * The privacy preflight, executed against the authoritative state. `FAIL` today: four of the five
 * owning gates are unapproved.
 */
export function evaluateBrazilReceitaGate7PrivacyPreflight(): BrazilReceitaGate7PrivacyPreflightOutcome {
  const unapprovedContracts = BRAZIL_RECEITA_GATE7_PRIVACY_PREFLIGHT_CONTRACTS.flatMap((check) => {
    const entry = BRAZIL_RECEITA_GATE_CURRENT_STATE.find((state) => state.gate === check.owningGate);
    if (entry === undefined) return [];
    if (BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(entry.status)) return [];
    return [{ contract: check.contract, owningGate: check.owningGate, status: entry.status }];
  });

  return {
    result: unapprovedContracts.length === 0 ? 'PASS' : 'FAIL',
    unapprovedContracts,
    operatorDiscretionAvailable: false,
  };
}

// ─── § 16.8 live monitoring ───────────────────────────────────────────────────

/** The signals the operator watches, each with the ceiling record that bounds it. */
export const BRAZIL_RECEITA_GATE7_MONITORED_SIGNALS: readonly string[] = [
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
];

/**
 * What happens on a ceiling breach. Three steps, in order, and none of them is "reduce the load and
 * carry on".
 */
export const BRAZIL_RECEITA_GATE7_BREACH_PROCEDURE: readonly string[] = [
  'stop the run',
  'run cleanup and verify it',
  'record the outcome as a terminal failure',
];

/** `OR-A20`. A retry is a new deliberate act preceded by the full preflight, never a re-run. */
export const BRAZIL_RECEITA_GATE7_AUTOMATIC_RETRY_PERMITTED = false as const;

/**
 * 🔴 The attempt budget, READ and not changed.
 *
 * `BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED` is `false` and stays `false`. This module
 * imports it rather than restating it, so a reader can see there is no second copy to flip, and this
 * round records no decision that would change it. Only a later explicit owner decision can.
 */
export const BRAZIL_RECEITA_GATE7_ATTEMPT_3_ALLOWED = BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED;
export const BRAZIL_RECEITA_GATE7_CHANGES_THE_ATTEMPT_BUDGET = false as const;

// ─── § 16.9 output review ─────────────────────────────────────────────────────

/** What the operator may review after the run. Sanitized aggregate output, and nothing else. */
export const BRAZIL_RECEITA_GATE7_OUTPUT_REVIEW_PERMITTED: readonly string[] = [
  'the sanitized aggregate JSON report, after the sanitizer boundary',
  'the sanitized cleanup summary',
  'the all-false safety booleans',
  'the controlled exit code and the controlled error_code enum',
  'the preflight completion state, item by item, pass or fail',
];

/**
 * What the operator may never do with output. `no_manual_editing_of_a_report_to_make_it_pass` is the
 * entry that exists because it has to: a report edited into compliance is the one failure mode no
 * sanitizer can catch, and it is indistinguishable from a passing report afterwards.
 */
export const BRAZIL_RECEITA_GATE7_OUTPUT_REVIEW_FORBIDDEN: readonly string[] = [
  'copying or pasting a raw row',
  'screenshotting raw data, or the run terminal at all',
  'manually editing a report to make it pass',
  'enabling a hidden debug or verbose output mode',
  'reading or sharing a path value',
  'reading or sharing a stack',
  'reading or sharing an identifier of any length',
  'keeping a sample "just one example"',
];

// ─── § 16.10 cleanup ──────────────────────────────────────────────────────────

/** The cleanup contract, imported from GATE-6 rather than restated. */
export const BRAZIL_RECEITA_GATE7_CLEANUP_TERMINATING_PATHS =
  BRAZIL_RECEITA_GATE6_TERMINATING_PATHS;
export const BRAZIL_RECEITA_GATE7_CLEANUP_COMPLETED_REQUIRES =
  BRAZIL_RECEITA_GATE6_COMPLETED_REQUIRES;
export const BRAZIL_RECEITA_GATE7_CLEANUP_STATUS_DISPOSITION =
  BRAZIL_RECEITA_GATE6_STATUS_DISPOSITION;
export const BRAZIL_RECEITA_GATE7_SUCCESS_WITH_RESIDUE_PERMITTED =
  BRAZIL_RECEITA_GATE6_SUCCESS_WITH_RESIDUE_PERMITTED;

/** What the operator verifies after cleanup runs. All three, on every terminal path. */
export const BRAZIL_RECEITA_GATE7_CLEANUP_VERIFICATIONS: readonly string[] = [
  'every owned temporary artifact is ABSENT, verified rather than assumed deleted',
  'every handle the run opened is closed',
  'zero residual entries across every registered unit',
];

/** A cleanup failure is terminal. `OR-A13`: verification is a recorded step, not an assumption. */
export const BRAZIL_RECEITA_GATE7_CLEANUP_FAILURE_IS_TERMINAL = true as const;

// ─── § 16.11 signoff ──────────────────────────────────────────────────────────

/** The only kinds of value a run signoff may carry. Closed. */
export const BRAZIL_RECEITA_GATE7_SIGNOFF_PERMITTED_VALUE_KINDS = [
  'controlled_enum',
  'boolean',
  'gate5_permitted_aggregate_count',
  'safe_timestamp',
  'approved_status_code',
] as const;

export type BrazilReceitaGate7SignoffValueKind =
  (typeof BRAZIL_RECEITA_GATE7_SIGNOFF_PERMITTED_VALUE_KINDS)[number];

/** What a signoff may never carry, on any channel including chat, tickets and review comments. */
export const BRAZIL_RECEITA_GATE7_SIGNOFF_FORBIDDEN_VALUE_KINDS: readonly string[] = [
  'path',
  'identifier',
  'source_value',
  'stack',
  'row_sample',
  ...BRAZIL_RECEITA_GATE6_FORBIDDEN_IN_SUMMARY,
];

/** What a sanitized residual summary may still carry after a failure, per GATE-6. */
export const BRAZIL_RECEITA_GATE7_SIGNOFF_PERMITTED_RESIDUAL_SUMMARY =
  BRAZIL_RECEITA_GATE6_PERMITTED_RESIDUAL_SUMMARY;

/**
 * Decides whether a claimed signoff value kind is admissible. Fail-closed: a kind this module does
 * not recognize is refused, so a novel field name cannot pass by not being on the forbidden list.
 */
export function brazilReceitaGate7SignoffValueKindIsAdmissible(kind: string): boolean {
  if (BRAZIL_RECEITA_GATE7_SIGNOFF_FORBIDDEN_VALUE_KINDS.includes(kind)) return false;
  return (BRAZIL_RECEITA_GATE7_SIGNOFF_PERMITTED_VALUE_KINDS as readonly string[]).includes(kind);
}

// ─── Reproducibility ──────────────────────────────────────────────────────────

/**
 * 🔴 The claim this round must NOT make: reproducibility by a different operator is UNDEMONSTRATED.
 *
 * Re-exported from the recorded module for the same cycle-avoidance reason as the section facts
 * above. 10K § 11's pass criteria require the runbook to be *reproducible by a different operator
 * without tacit knowledge*, and only an authorized rehearsal by an operator who did not write the
 * section can show that. None is authorized and none was performed.
 */
export const BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR = RECORDED_REPRODUCIBILITY;
export const BRAZIL_RECEITA_GATE7_REHEARSAL_PERFORMED = RECORDED_REHEARSAL_PERFORMED;
export const BRAZIL_RECEITA_GATE7_REHEARSAL_AUTHORIZED = RECORDED_REHEARSAL_AUTHORIZED;

// ─── The assertion catalogue ──────────────────────────────────────────────────

export type BrazilReceitaGate7AssertionState =
  | 'executable_and_asserted'
  | 'operator_behaviour_rule'
  | 'deferred_to_rehearsal';

export interface BrazilReceitaGate7AssertionRecord {
  readonly id: string;
  readonly state: BrazilReceitaGate7AssertionState;
  readonly dischargedBy: string;
}

/**
 * `OR-A01` … `OR-A20`, every one accounted for.
 *
 * 🔴 `operator_behaviour_rule` is not a weaker form of `executable_and_asserted` — it is the honest
 * label for a rule no assertion can reach. Three of the twenty carry it. 10O § 4 surface L recorded
 * that screenshots and terminal pastes are undetectable by any code, so the rules covering them are
 * the mitigation OF RECORD, and calling them executable would be the most comfortable lie available
 * here. `OR-A12` carries it for a different reason: a *recorded operator action* is a human act, and
 * no constant can represent having taken one.
 */
export const BRAZIL_RECEITA_GATE7_ASSERTION_RECORDS: readonly BrazilReceitaGate7AssertionRecord[] = [
  { id: 'OR-A01', state: 'executable_and_asserted', dischargedBy: 'brazilReceitaGate7ActorMayExecute' },
  { id: 'OR-A02', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS action / passCondition, asserted non-empty for all 22' },
  { id: 'OR-A03', state: 'executable_and_asserted', dischargedBy: 'P-05 standing is checkable_and_fails_today and the evaluator gates the whole procedure' },
  { id: 'OR-A04', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE7_FAILED_PREFLIGHT_ITEM_IS_A_STOP' },
  { id: 'OR-A05', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE7_WORKSPACE_PREFLIGHT outsideRepository plus P-06 and P-09' },
  { id: 'OR-A06', state: 'executable_and_asserted', dischargedBy: 'P-08 pass condition, and the manifest validator that owns it' },
  { id: 'OR-A07', state: 'executable_and_asserted', dischargedBy: 'P-07 pass condition plus BRAZIL_RECEITA_GATE7_FORBIDDEN_FAMILIES' },
  { id: 'OR-A08', state: 'executable_and_asserted', dischargedBy: 'P-22 pass condition' },
  { id: 'OR-A09', state: 'executable_and_asserted', dischargedBy: 'P-16 and P-17; no import path is reachable from this module' },
  { id: 'OR-A10', state: 'executable_and_asserted', dischargedBy: 'P-15; this module performs no I/O and holds no client' },
  { id: 'OR-A11', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS and the argument-free evaluator' },
  { id: 'OR-A12', state: 'operator_behaviour_rule', dischargedBy: 'a recorded operator action is a human act; no code can represent having taken it' },
  { id: 'OR-A13', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE7_CLEANUP_VERIFICATIONS plus GATE-6 completedRequires' },
  { id: 'OR-A14', state: 'executable_and_asserted', dischargedBy: 'guardBrazilReceitaGate5Report / guardBrazilReceitaGate5RenderedOutput precede review' },
  { id: 'OR-A15', state: 'executable_and_asserted', dischargedBy: 'the GATE-6 artifact lifecycles, imported rather than restated' },
  { id: 'OR-A16', state: 'executable_and_asserted', dischargedBy: 'brazilReceitaGate7SignoffValueKindIsAdmissible' },
  { id: 'OR-A17', state: 'operator_behaviour_rule', dischargedBy: '10O § 4 surface L is machine-undetectable; the rule is the mitigation of record' },
  { id: 'OR-A18', state: 'operator_behaviour_rule', dischargedBy: 'same surface; the signoff guard covers the machine-emitted half only' },
  { id: 'OR-A19', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE7_WARNING_IS_EVER_A_PASS' },
  { id: 'OR-A20', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE7_AUTOMATIC_RETRY_PERMITTED' },
];

/** The catalogue's own arithmetic, so a silently dropped assertion fails a test. */
export const BRAZIL_RECEITA_GATE7_ASSERTION_TOTALS = {
  total: 20,
  executableAndAsserted: 17,
  operatorBehaviourRule: 3,
  deferredToRehearsal: 0,
} as const;
