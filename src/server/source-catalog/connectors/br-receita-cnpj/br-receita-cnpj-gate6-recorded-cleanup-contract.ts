/**
 * BR Receita CNPJ — RECORDED GATE-6 cleanup contract (BR-SOURCE-GATE-ROUND-2).
 *
 * GATE-6 is the failure-cleanup gate (10K § 10): cleanup on completion AND failure, with cleanup
 * failure as a terminal state. It has been `not_started` since 10K, and 10PQR § 4–§ 5 landed a
 * proposal for it whose own status reads `proposed_for_owner_review`.
 *
 * ── 🔴 What this round changed, and what it did not ──────────────────────────
 *
 * The 10PQR proposal was blocked on something real: it stated its contract "conditionally on
 * GATE-2, because what must be destroyed is bounded by what may exist", and two of its assertions
 * were unenforceable until the envelope was chosen. Round 1 chose the envelope — Option C, with a
 * complete numeric ceiling set and a recorded cleanup contract (`verified_deletion_required` on both
 * paths, both terminal states terminal, `successWithResiduePermitted: false`).
 *
 * So the boundedness condition is satisfied, and what remained was that GATE-6's pass criteria are
 * claims about BEHAVIOUR — "cleanup failure is terminal", "it never reports success with residue" —
 * which a document cannot discharge. This round makes them executable:
 *
 *   `br-receita-cnpj-full-join-cleanup-coordinator` — owns units, drives their own verified
 *     deletions, latches terminal states, and has no code path from residue to `completed`.
 *   `br-receita-cnpj-full-join-cleanup-units`       — the adapters, which preserve the `failed` /
 *     `unverified` and `deleted` / `verifiedAbsent` distinctions instead of flattening them.
 *   partition workspace `dispose()`                 — the idempotence defect fixed: a second dispose
 *     of a verifiably-removed workspace reported `unverified` ("nobody can say"), which is a repeat
 *     call downgrading a verified success. It now reports `not_needed`, verified absent.
 *
 * ── 🔴 GATE-6 status: still NOT approved, and for one exact reason ───────────
 *
 * `BRAZIL_RECEITA_GATE6_STATUS` is `ready_for_review`. That is a real advance — 10K § 3 defines it as
 * "evidence complete and submitted; awaiting the named approver" — and it is NOT an approval: § 15's
 * matrix reads NO-GO for `ready_for_review` exactly as it does for `not_started`.
 *
 * The single unmet criterion is the recorded joint decision itself:
 * `BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION`. GATE-6 needs the technical owner AND the
 * operator owner, jointly (10K § 10), and 10K § 3 forbids the implementer of a gate's subject from
 * approving it. This round implemented the subject. It therefore cannot approve the gate, and saying
 * otherwise would violate the rule that most directly protects this gate.
 *
 * There is one substantive decision inside that review, and it is named rather than assumed: 10PQR
 * § 4.2 recommended DELETE and would admit quarantine only under an approved GATE-2 envelope. This
 * implementation does DELETE and offers no quarantine path. That is the proposal's recommendation
 * built, not a new decision — but it is the proposal's, not the owners', until they say so.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access. Its only
 *     imports are TYPE-level.
 *   - approves a gate, or emits an `OwnerDecisionArtifact` section. 13A has no `gate6` section.
 *   - authorizes a run, a benchmark, real-data access, snapshot persistence, an import, a Supabase
 *     write, a migration, a runtime path, Agent 1, Agent 2A or a provider call.
 *   - flips, reads or reproduces a writable copy of any safety invariant, cap or flag.
 *   - carries a personal name, a signature, a mail address, a real path, a CNPJ or a CPF.
 */

import type { BrazilReceitaCleanupFailureCode } from './br-receita-cnpj-full-join-cleanup-coordinator';
import type { BrazilReceitaFullJoinCleanupStatus } from './br-receita-cnpj-full-join-cleanup';

// ─── Status ───────────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_GATE6_STATUS = 'ready_for_review' as const;

/** Whether this record approves anything. It does not, and says so as data. */
export const BRAZIL_RECEITA_GATE6_APPROVED = false as const;

/**
 * The joint approvers GATE-6 requires (10K § 10): technical owner AND operator owner. 10PQR also
 * named the escalation pair this gate's required evidence left implicit — the privacy owner joins for
 * a leak-class outcome — and that is carried here rather than dropped.
 */
export const BRAZIL_RECEITA_GATE6_TECHNICAL_APPROVER_ROLE = 'technical owner' as const;
export const BRAZIL_RECEITA_GATE6_OPERATOR_APPROVER_ROLE = 'operator owner' as const;
export const BRAZIL_RECEITA_GATE6_LEAK_CLASS_ESCALATION_ROLE = 'privacy owner' as const;
export const BRAZIL_RECEITA_GATE6_APPROVAL_IS_JOINT = true as const;

/** The date the executable contract landed. Not an approval date — there is none. */
export const BRAZIL_RECEITA_GATE6_RECORDED_DATE = '2026-08-21' as const;

/**
 * The one criterion still unmet. Exact, and not "needs more evidence".
 *
 * 🔴 `blockedByImplementerRule` is the load-bearing field. It is not a technicality: 10K § 3 exists
 * because a gate approved by the party that built its subject is not reviewed at all.
 */
export const BRAZIL_RECEITA_GATE6_SINGLE_REMAINING_CRITERION = {
  criterion:
    'the § 14 joint approval entry from the technical owner AND the operator owner, recorded against this executable contract',
  blockedByImplementerRule: true,
  implementerRule: '10K § 3 — no gate may be self-approved by the author who implements its subject',
  substantiveDecisionInsideTheReview:
    '10PQR § 4.2 recommended DELETE and would admit quarantine only under an approved GATE-2 envelope; this implementation does DELETE and offers no quarantine path. The owners confirm or reject that.',
  agentMayApprove: false,
} as const;

// ─── The cleanup contract, as executed ────────────────────────────────────────

/**
 * The four statuses, and which are terminal. Mirrors the GATE-2 recorded cleanup contract exactly
 * rather than restating it loosely — a second, looser copy is how `failed` becomes retryable.
 */
export const BRAZIL_RECEITA_GATE6_STATUS_DISPOSITION: Readonly<
  Record<BrazilReceitaFullJoinCleanupStatus, { readonly terminal: boolean; readonly success: boolean }>
> = {
  not_needed: { terminal: true, success: true },
  completed: { terminal: true, success: true },
  failed: { terminal: true, success: false },
  not_executed: { terminal: true, success: false },
};

/** The invariant the whole gate turns on, as an assertable constant. */
export const BRAZIL_RECEITA_GATE6_SUCCESS_WITH_RESIDUE_PERMITTED = false as const;

/**
 * What `completed` requires, enumerated. Every condition is a conjunct in the coordinator's success
 * gate, so this list is a description of code rather than an aspiration about it.
 */
export const BRAZIL_RECEITA_GATE6_COMPLETED_REQUIRES: readonly string[] = [
  'every registered unit attempted its own deletion',
  'every registered unit verified absence after deleting, not merely reported a successful unlink',
  'zero residual entries across all units',
  'zero failure codes',
] as const;

/**
 * The failure codes, each mapped to what an operator must understand from it. Machine codes only;
 * never a path, a file name or a dataset value.
 */
export const BRAZIL_RECEITA_GATE6_FAILURE_CODE_MEANING: Readonly<
  Record<BrazilReceitaCleanupFailureCode, string>
> = {
  unit_deletion_failed: 'a unit could not attempt or complete its deletion; manual cleanup required',
  unit_deletion_unverified:
    'a deletion ran but absence could not be confirmed; nobody may claim the material is gone',
  residual_entries_present:
    'entries the engine did not create were found in its own workspace and deliberately left in place',
  unit_destroy_threw: 'a unit threw, so it made no verifiable claim about its own artifact',
  cleanup_never_invoked: 'cleanup was required and never ran; the run is abandoned, not clean',
};

/**
 * The terminating paths GATE-6's required evidence enumerates, and how the executable contract
 * covers each.
 *
 * `covers` is a claim about the CONTRACT, not about a runner: there is no runner, and every path
 * below routes through the same coordinator, which is what makes one contract enough for all of
 * them. What a future runner still owes is DETECTING each path and calling cleanup — that obligation
 * is recorded in `BRAZIL_RECEITA_GATE6_RUNNER_OBLIGATIONS`.
 */
export const BRAZIL_RECEITA_GATE6_TERMINATING_PATHS = [
  { path: 'normal_completion', cleanupRequired: true, coveredBy: 'runCleanup' },
  { path: 'error_manifest_invalid', cleanupRequired: true, coveredBy: 'runCleanup' },
  { path: 'error_layout_mismatch', cleanupRequired: true, coveredBy: 'runCleanup' },
  { path: 'error_forbidden_file_family', cleanupRequired: true, coveredBy: 'runCleanup' },
  { path: 'error_unexpected_parser_error', cleanupRequired: true, coveredBy: 'runCleanup' },
  { path: 'operator_cancellation', cleanupRequired: true, coveredBy: 'runCleanup' },
  { path: 'memory_limit_reached', cleanupRequired: true, coveredBy: 'runCleanup' },
  { path: 'disk_limit_reached', cleanupRequired: true, coveredBy: 'runCleanup' },
  { path: 'privacy_assertion_failure', cleanupRequired: true, coveredBy: 'runCleanup' },
  { path: 'process_crash', cleanupRequired: true, coveredBy: 'reportNotExecuted' },
] as const;

/**
 * What survives a run, and what must be destroyed. The private artifact is the only entry that can
 * survive the PROCESS, and it cannot survive a declared-completed CLEANUP — which is the distinction
 * § 16 of the Round-2 brief asks to be kept.
 */
export const BRAZIL_RECEITA_GATE6_ARTIFACT_LIFECYCLES = [
  {
    artifactClass: 'partition_workspace',
    maySurviveProcess: false,
    maySurviveCompletedCleanup: false,
    lifecycle: 'run_lifetime',
  },
  {
    artifactClass: 'private_metric_artifact',
    maySurviveProcess: true,
    maySurviveCompletedCleanup: false,
    lifecycle: 'ttl_bounded_default_1h_ceiling_24h_disabled_by_default',
  },
  {
    artifactClass: 'snapshot_output',
    maySurviveProcess: false,
    maySurviveCompletedCleanup: false,
    lifecycle: 'does_not_exist_max_output_rows_is_zero_and_the_sink_is_null',
  },
] as const;

/** What a sanitized summary may still contain after a failure. Counts and enums; nothing else. */
export const BRAZIL_RECEITA_GATE6_PERMITTED_RESIDUAL_SUMMARY: readonly string[] = [
  'cleanup status enum',
  'cleanup required boolean',
  'unit counts',
  'residual entry counts',
  'failure code enums',
  'artifact counts by kind',
] as const;

export const BRAZIL_RECEITA_GATE6_FORBIDDEN_IN_SUMMARY: readonly string[] = [
  'a filesystem path',
  'a file name',
  'an artifact name',
  'a directory name',
  'an environment variable',
  'any dataset value',
  'a CNPJ, a básico, or any derivative of either',
] as const;

// ─── Safety properties this round did NOT relax ───────────────────────────────

/**
 * The safety properties the cleanup path preserves, each owned elsewhere and asserted against its
 * real owner by test rather than against this record's copy.
 */
export const BRAZIL_RECEITA_GATE6_PRESERVED_PROPERTIES = {
  supabaseWritesOnAnyPath: 0,
  automaticRetryWithoutOperator: false,
  deletesOnlyOwnedPaths: true,
  recursiveParentDeletion: false,
  symlinkSafety: 'lstat_based_dangling_link_counts_as_present',
  repositoryHomeAndDatasetRootExcluded: true,
  cleanupAcceptsAPathFromACaller: false,
  callableAfterPartialInitialization: true,
  callableAfterEngineFailure: true,
  idempotent: true,
} as const;

/**
 * What a FUTURE runner still owes GATE-6. Enumerated so "the contract is executable" is not mistaken
 * for "the runner is done" — there is no runner, and GATE-8's *Allows* clause forbids writing one
 * while any gate is unapproved.
 */
export const BRAZIL_RECEITA_GATE6_RUNNER_OBLIGATIONS: readonly string[] = [
  'detect each terminating path and invoke cleanup on it',
  'register every unit BEFORE creating its artifact',
  'call reportNotExecuted on an abandoned run rather than leaving no cleanup record',
  'surface the terminal status to the operator, including the fact that manual cleanup is required',
  'never re-read data on a retry path without an explicit operator action',
] as const;

// ─── Restrictions ─────────────────────────────────────────────────────────────

/** The bounds this record carries, enumerated per 10K § 14. */
export const BRAZIL_RECEITA_GATE6_RESTRICTIONS: readonly string[] = [
  'this record approves no gate; ready_for_review is NO-GO in the § 15 matrix',
  'the implementer of this subject may not approve this gate',
  'no operational flag is flipped, and the temporary-storage policy constant stays false',
  'no runner is written, and no run is authorized',
  'no real Receita data is read and no benchmark is executed',
  'cleanup deletes only paths its owning module created; no path is ever accepted from a caller',
  'quarantine is not implemented and is not authorized',
  'a failed or not_executed cleanup is terminal and may not be upgraded by a retry',
  'no Supabase write on any cleanup path, on success or on failure',
  'downstream and sibling gates remain independently required',
] as const;
