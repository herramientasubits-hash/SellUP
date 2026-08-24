/**
 * BR Receita CNPJ — RECORDED GATE-7 operator runbook record (BR-SOURCE-FAST-TRACK-6; dependency
 * blockers reassessed BR-SOURCE-FAST-TRACK-7 — GATE-7 is NOT approved).
 *
 * GATE-7 is the operator runbook gate (10K § 11). It has been `not_started` since 10K, and until this
 * round it had no recorded module at all — `br-receita-cnpj-gate-status-current-state` stated its
 * status inline precisely because nothing had advanced it.
 *
 * ── 🔴 What advanced, and what the status is NOT ─────────────────────────────
 *
 * What advanced is the one artifact 10K § 11 asks for and 10PQR § 6 could not deliver: **the runbook
 * SECTION now exists** — `docs/…-manual-download-local-prep-runbook.md` § 16, an extension of the
 * existing runbook, plus its machine-readable half in `br-receita-cnpj-gate7-operator-runbook`.
 * 10PQR § 6.2's own list of what remains before GATE-7 can move names that section FIRST.
 *
 * The status is NOT `ready_for_review`, and inventing it would be the exact failure this series has
 * guarded against for three rounds. 10PQR § 6.2 lists four things that must be true, and three of
 * them are gates:
 *
 *   1. the runbook SECTION exists                                    → DONE, this round
 *   2. GATE-2 approved   → today `needs_owner_confirmation`          → NOT DONE
 *   3. GATE-5 approved   → today `ready_for_review`                  → NOT DONE
 *   4. GATE-6 approved   → today `ready_for_review`                  → NOT DONE
 *
 * ── 🔴 Why `blocked` is the exactly-correct status, and not a softer one ─────
 *
 * 10K § 3 defines `blocked` as "an external dependency (legal, **another gate**, an unresolved leak)
 * prevents review". Three unapproved upstream gates are precisely that dependency, and 10K § 11's own
 * update says so in those words: "GATE-2, GATE-5, and GATE-6 all still block it."
 *
 * The three statuses one might reach for instead are each wrong for a stateable reason:
 *
 *   · `not_started` is now FALSE. Evidence exists: the section, the executable preflight, the
 *     resource and privacy evaluators, and the OR-A01…OR-A20 catalogue mapped onto them. Reporting
 *     `not_started` would understate the state as badly as `ready_for_review` overstates it.
 *   · `needs_evidence` would be wrong about WHAT is missing. Nothing about this gate's own evidence is
 *     incomplete or inconclusive; what is missing is three other gates' approvals.
 *   · `ready_for_review` is forbidden by the dependency contract. § 4's approval-order rule makes a
 *     gate unreviewable while its dependencies are unapproved, and 10K § 3 forbids approval by
 *     inference — which is what "the document is done, so review it" would amount to here.
 *
 * `blocked` is NO-GO, exactly as `not_started` is (10K § 15). It advances nothing.
 *
 * ── 🔴 One evidence item is not merely missing — it is UNDEMONSTRABLE today ──
 *
 * 10K § 11's pass criteria require the runbook to be *reproducible by a different operator without
 * tacit knowledge*. That cannot be shown by any document, however complete: it needs a rehearsal by
 * an operator who did not author the section, and no rehearsal is authorized. It is recorded as
 * `UNDEMONSTRATED` rather than folded into the three gate blockers, because unblocking the gates does
 * not discharge it.
 *
 * ── 🔴 Update (BR-SOURCE-FAST-TRACK-7) — three of the four blockers are GONE; status moves to
 *      `needs_evidence`, NOT `ready_for_review` and NOT `approved` ──────────
 *
 * GATE-2, GATE-5 and GATE-6 are now `approved` (recorded elsewhere, this same round). That is exactly
 * the dependency `blocked` named: 10K § 3 defines `blocked` as "an external dependency (legal,
 * another gate, an unresolved leak) prevents review", and with those three gates approved, that
 * specific dependency no longer exists. `blocked` is therefore no longer the correct status.
 *
 * The fourth blocker — `REPRODUCIBILITY_BY_DIFFERENT_OPERATOR = UNDEMONSTRATED` — is untouched. No
 * rehearsal happened in this round, and none is authorized. Reasoning through 10K § 3's own
 * vocabulary against what actually remains:
 *
 *   - `blocked` no longer fits: the gates that were the external dependency are approved.
 *   - `ready_for_review` does not fit either: it asserts evidence is COMPLETE, and 10K § 11's own pass
 *     criterion — "reproducible by a different operator without tacit knowledge" — is exactly the
 *     evidence item that is missing. Asserting completeness while that item is undemonstrated would
 *     repeat the error this series has already had to retract once (§ 9.1 → § 9.2).
 *   - `needs_owner_decision` / `needs_owner_confirmation` do not fit: both describe a state where the
 *     ONLY gap is a named human's ANSWER to an already-posed question. What is missing here is not an
 *     answer — GATE-7's three approvers have not been asked a question they could answer today — it
 *     is a REHEARSAL, i.e. more evidence to gather. That is precisely `needs_evidence`'s own
 *     definition: "evidence gathering started but is incomplete or inconclusive".
 *   - `needs_evidence` fits: the section, the executable preflight, and the resource/privacy
 *     evaluators are all evidence already gathered; the reproducibility rehearsal is the one piece
 *     that remains ungathered. Nothing here is an operator's decision to make — it is a rehearsal
 *     nobody has performed or authorized.
 *
 * `evaluateBrazilReceitaGate7Preconditions()` still returns `FAIL` — but now for a different, single
 * reason: GATE-7 checks the current state of ALL EIGHT gates including its OWN, and GATE-7 itself is
 * not `approved`. `evaluateBrazilReceitaGate7PrivacyPreflight()` now returns `PASS`, because all five
 * of the contracts it checks (owned by GATE-2 … GATE-6) are approved. Neither evaluator was edited to
 * produce these outcomes — both are unconditional derivations from
 * `BRAZIL_RECEITA_GATE_CURRENT_STATE`, which itself imports each gate's own recorded module.
 *
 * `needs_evidence` is NO-GO, exactly as `blocked` and `not_started` are (§ 15). This update advances
 * GATE-7's reviewability and nothing else. `BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED` stays
 * imported and `false`; no rehearsal, run, or attempt-budget change is authorized by this update.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - approves a gate, or emits an `OwnerDecisionArtifact` section. 13A has no `gate7` section.
 *   - authorizes a run, a rehearsal, a benchmark, real-data access, a report emission, snapshot
 *     persistence, an import, a Supabase write, a migration, a runtime path, Agent 1, Agent 2A or a
 *     provider call.
 *   - flips, reads or reproduces a writable copy of any safety invariant, cap, flag or attempt budget.
 *   - carries a personal name, a signature, a mail address, a real path, a CNPJ or a CPF.
 *
 * ── 🔴 Why this module imports NOTHING, and why that is structural ───────────
 *
 * It is a LEAF on purpose. `br-receita-cnpj-gate-status-current-state` imports this module for
 * GATE-7's status, and `br-receita-cnpj-gate7-operator-runbook` imports that view for its executable
 * `P-05`. If this record reached back into the runbook module the three would form a cycle, and under
 * ESM a cycle in this direction fails at module-initialization time rather than at review time.
 *
 * So the facts the two modules SHARE are owned here — the section's existence and location, the
 * reproducibility claim, and the rehearsal flags — and the runbook module re-exports them. One owner,
 * one value, no second copy that could drift, and no cycle.
 */

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * 🔴 `needs_evidence`, per 10K § 3's own definition, as of BR-SOURCE-FAST-TRACK-7. NO-GO, and not a
 * partial approval of any kind. See the module header for the full elimination reasoning against
 * `blocked`, `ready_for_review`, `needs_owner_decision` and `needs_owner_confirmation`.
 */
export const BRAZIL_RECEITA_GATE7_STATUS = 'needs_evidence' as const;

/** Whether this record approves anything. It does not, and says so as data. */
export const BRAZIL_RECEITA_GATE7_APPROVED = false as const;

/** The status this record explicitly REFUSES to claim, and the reason, both assertable. */
export const BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED = 'ready_for_review' as const;
export const BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED_REASON =
  'ready_for_review asserts evidence is COMPLETE; reproducibility by a different operator remains UNDEMONSTRATED, which is exactly the evidence item 10K § 11s own pass criterion names as missing' as const;

/** The status this record ALSO refuses to claim now that the three dependency gates are approved. */
export const BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED_BLOCKED = 'blocked' as const;
export const BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED_BLOCKED_REASON =
  'blocked requires an external dependency preventing review; GATE-2, GATE-5 and GATE-6 are now approved, so that specific dependency no longer exists' as const;

/** The joint approvers GATE-7 requires (10K § 11). Any one may reject alone; approval needs all three. */
export const BRAZIL_RECEITA_GATE7_OPERATOR_APPROVER_ROLE = 'operator owner' as const;
export const BRAZIL_RECEITA_GATE7_TECHNICAL_APPROVER_ROLE = 'technical owner' as const;
export const BRAZIL_RECEITA_GATE7_PRIVACY_APPROVER_ROLE = 'privacy owner' as const;
export const BRAZIL_RECEITA_GATE7_APPROVAL_IS_JOINT = true as const;
export const BRAZIL_RECEITA_GATE7_APPROVER_COUNT = 3 as const;

/** No agent may supply any of the three. Recorded as data, not as a comment. */
export const BRAZIL_RECEITA_GATE7_AGENT_MAY_APPROVE = false as const;

/** The date the runbook section landed. Not an approval date — there is none. */
export const BRAZIL_RECEITA_GATE7_RECORDED_DATE = '2026-08-21' as const;

// ─── The runbook section — the facts this record and the runbook module share ──

/** The runbook section exists. This is the fact 10PQR § 6 could not record. */
export const BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION_EXISTS = true as const;

/**
 * Where it lives, and what it extends. 10K § 11 requires an EXTENSION of the manual-download /
 * local-prep runbook rather than a competing document, so the host document is named as data and a
 * static test asserts the section is actually present in it.
 */
export const BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION = {
  document: 'docs/source-catalog/br-receita-cnpj-manual-download-local-prep-runbook.md',
  section: '16',
  extendsExistingRunbook: true,
  isACompetingDocument: false,
  machineReadableHalf: 'br-receita-cnpj-gate7-operator-runbook',
} as const;

/**
 * 🔴 The claim this round must NOT make.
 *
 * 10K § 11's pass criteria require the runbook to be *reproducible by a different operator without
 * tacit knowledge*. A complete section is a necessary condition for that and not a demonstration of
 * it: only an authorized rehearsal, by an operator who did not write the section, against real
 * ceilings, can show the steps carry no tacit knowledge. No rehearsal is authorized, none was
 * performed, and claiming reproducibility from the existence of a document would be exactly the kind
 * of unproved claim this series has already had to retract once.
 */
export const BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR = 'UNDEMONSTRATED' as const;

/** No rehearsal was performed, and none is authorized by the existence of the section. */
export const BRAZIL_RECEITA_GATE7_REHEARSAL_PERFORMED = false as const;
export const BRAZIL_RECEITA_GATE7_REHEARSAL_AUTHORIZED = false as const;

// ─── What advanced ────────────────────────────────────────────────────────────

/** The 10PQR § 6.2 item this round discharges, and the only one it discharges. */
export const BRAZIL_RECEITA_GATE7_ADVANCED_THIS_ROUND = {
  item: 'the runbook SECTION itself must exist',
  discharged: BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION_EXISTS,
  artifact: BRAZIL_RECEITA_GATE7_RUNBOOK_SECTION,
  advancesEvidence: true,
  advancesPermission: false,
} as const;

/**
 * 10K § 11's *Required evidence*, item by item, against what now exists.
 *
 * 🔴 `present` here means the RUNBOOK STEP exists and has a definite pass condition — never that the
 * check has been performed. No check has been performed against real data, and none is authorized.
 */
export const BRAZIL_RECEITA_GATE7_REQUIRED_EVIDENCE_DISPOSITION = [
  { evidence: 'preflight checklist confirming every gate is approved and recorded', present: true, note: 'P-05, executable; returns FAIL today' },
  { evidence: 'disk / memory check against the GATE-2 ceilings', present: true, note: 'P-12, P-13; ceilings imported, not restated' },
  { evidence: 'local path check — controlled folder outside the repo', present: true, note: 'P-06 plus the workspace confirmations' },
  { evidence: 'manifest check — local file manifest only, never a URL', present: true, note: 'P-08' },
  { evidence: 'forbidden-family check — no socios / QSA / CPF / person files', present: true, note: 'P-07; presence is a HARD STOP' },
  { evidence: 'explicit dry-run confirmation step', present: true, note: 'P-22' },
  { evidence: 'live monitoring instructions', present: true, note: 'ten signals; a warning is never a pass' },
  { evidence: 'cleanup verification steps', present: true, note: 'GATE-6 contract imported; failure is terminal' },
  { evidence: 'a report location outside the repository', present: true, note: 'P-06, P-09, and the workspace constraints' },
  { evidence: 'a sensitive scan of the report', present: true, note: 'the GATE-5 guard runs before the report is read' },
  { evidence: 'post-run deletion rules for temporary material', present: true, note: 'the GATE-6 artifact lifecycles' },
  { evidence: 'a final signoff template recording the aggregate result only', present: true, note: 'the closed signoff value kinds and their guard' },
] as const;

// ─── What remains ─────────────────────────────────────────────────────────────

export interface BrazilReceitaGate7Blocker {
  readonly blocker: string;
  readonly kind: 'unapproved_dependency_gate' | 'undemonstrated_pass_criterion';
  readonly dischargeableByAnAgent: false;
  readonly dischargeableByADocument: boolean;
}

/**
 * The exact remaining blocker. ONE, as of BR-SOURCE-FAST-TRACK-7, and no agent can discharge it.
 *
 * 🔴 The three `unapproved_dependency_gate` blockers this array carried through FAST-TRACK-6 are GONE:
 * GATE-2, GATE-5 and GATE-6 are all now `approved`. What remains is the ONE blocker that was always
 * different in kind: approving those three gates unblocks the REVIEW; it does not demonstrate
 * reproducibility. GATE-7's own approvers still decide whether the section plus three approved
 * upstream gates is enough to review, or whether they require a rehearsal first. That is their call,
 * and this record does not make it for them.
 */
export const BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS: readonly BrazilReceitaGate7Blocker[] = [
  {
    blocker:
      'reproducibility by a different operator is UNDEMONSTRATED; only an authorized rehearsal can show it, and none is authorized',
    kind: 'undemonstrated_pass_criterion',
    dischargeableByAnAgent: false,
    dischargeableByADocument: false,
  },
];

/**
 * The three dependency-gate blockers that were once here, kept for the audit trail so a reader can
 * see exactly what was discharged and by which round. None of these three is a `4A`/`4B`/`4C`-style
 * sub-decision of GATE-7's own — each is simply a different gate's OWN recorded approval.
 */
export const BRAZIL_RECEITA_GATE7_DEPENDENCY_BLOCKERS_DISCHARGED_BY_FAST_TRACK_7: readonly string[] = [
  'GATE-2 approved (was needs_owner_confirmation)',
  'GATE-5 approved (was ready_for_review)',
  'GATE-6 approved (was ready_for_review)',
];

/** An alias for readers of this record. Same constant, so the two cannot disagree. */
export const BRAZIL_RECEITA_GATE7_REPRODUCIBILITY =
  BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR;

/**
 * The criterion that would move GATE-7 from `needs_evidence` to `ready_for_review`, stated exactly
 * rather than as "more evidence". Updated by BR-SOURCE-FAST-TRACK-7: the dependency-gate criterion
 * this constant named through FAST-TRACK-6 is discharged (see
 * `BRAZIL_RECEITA_GATE7_DEPENDENCY_BLOCKERS_DISCHARGED_BY_FAST_TRACK_7`); what remains is evidence,
 * not another gate's approval.
 */
export const BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION = {
  criterion:
    'a rehearsal by an operator who did not author the runbook section, against real ceilings, demonstrating reproducibility without tacit knowledge',
  thenStatusBecomes: 'ready_for_review',
  andStillRequires:
    'the joint operator + technical + privacy owner approval, after the rehearsal (or their explicit decision that no rehearsal is required)',
  agentMayDischarge: false,
} as const;

// ─── Restrictions ─────────────────────────────────────────────────────────────

/** The bounds this record carries, enumerated per 10K § 14. */
export const BRAZIL_RECEITA_GATE7_RESTRICTIONS: readonly string[] = [
  'this record approves no gate; needs_evidence is NO-GO in the § 15 matrix, exactly as blocked and not_started are',
  'the runbook section is a PROCEDURE, never a PERMISSION (10K § 11 Does NOT allow)',
  'the implementer of this subject may not approve this gate',
  'no rehearsal is performed and none is authorized',
  'no run, dry-run, benchmark or attempt-budget change is authorized, and ATTEMPT_3_ALLOWED stays false',
  'no real Receita data is read; no manifest, path or file name is learned or recorded',
  'no operational flag is flipped and no resource cap is edited',
  'no migration is authored or applied, and no Supabase write of any kind is authorized',
  'reproducibility by a different operator remains UNDEMONSTRATED and may not be claimed',
  'only a named authorized human operator may ever execute the procedure — never an agent, and never on behalf of a human',
  // BR-SOURCE-FAST-TRACK-7.
  'GATE-2, GATE-5 and GATE-6 becoming approved unblocks the REVIEW; it does not demonstrate reproducibility, and this record does not claim it does',
];
