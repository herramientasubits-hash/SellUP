/**
 * BR Receita CNPJ — RECORDED GATE-7 operator runbook record (BR-SOURCE-FAST-TRACK-6; dependency
 * blockers reassessed BR-SOURCE-FAST-TRACK-7; JOINT OWNER APPROVAL recorded BR-SOURCE-FAST-TRACK-8 —
 * GATE-7 is `approved`).
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
 * ── 🔴 Update (BR-SOURCE-FAST-TRACK-8) — GATE-7 is APPROVED, and the reproducibility criterion is
 *      WAIVED BY OWNER DECISION rather than DEMONSTRATED ─────────────────────
 *
 * The operator owner, the technical owner and the privacy owner have JOINTLY approved, by owner relay
 * recorded 2026-08-24. The subject is named rather than implied: the § 16 runbook section, its
 * twenty-two preflight items `P-01` … `P-22`, and its sixteen non-overridable stop conditions
 * `T-01` … `T-16`.
 *
 * 🔴 **The one thing this record must not be misread as.** Reproducibility by a different operator is
 * still `UNDEMONSTRATED`. It was not demonstrated, and it was not quietly re-labelled: the three
 * approvers exercised their own contract's explicit alternative and decided that the pre-approval
 * rehearsal is NOT REQUIRED. `BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.andStillRequires` has carried
 * that branch since FAST-TRACK-6 — "…after the rehearsal (**or their explicit decision that no
 * rehearsal is required**)" — so the waiver is a path the contract already contained, not one invented
 * for this round. The distinction is recorded as data, in
 * `BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DISPOSITION` = `WAIVED_BY_OWNER_DECISION` beside
 * `BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DEMONSTRATED` = `false`, so no later reader can collapse a
 * waiver into a demonstration.
 *
 * ── 🔴 Why a pre-approval rehearsal could not have been run, and why that is not a loophole ──
 *
 * `P-05` — first in substance, fifth in numbering — requires EVERY gate to be recorded as approved,
 * GATE-7's own included. A rehearsal performed before GATE-7's approval therefore stops at `P-05` by
 * construction, and it stops there CORRECTLY: `P-05` takes no argument, reads no environment, offers
 * no override, and `BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS` is `false`. Demonstrating
 * reproducibility beforehand would have required bypassing the one item whose lack of a bypass is
 * this gate's strongest property.
 *
 * The owners were given exactly that reading and decided against changing `P-05`, against a bypass,
 * against a rehearsal on real data, and against touching the attempt budget. What they changed is the
 * only thing that was theirs to change: whether the rehearsal is a precondition of THEIR approval.
 * Nothing in `P-05` was edited by this round.
 *
 * ── 🔴 Why the status goes straight to `approved` and never occupies `ready_for_review` ──
 *
 * `BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION` describes a rehearsal moving the gate to
 * `ready_for_review` with joint approval following it. That is one of the two paths it names; this is
 * the other. The waiver and the approval arrived in ONE decision, so there was no interval in which
 * evidence stood complete and an approver was still awaited — the only state `ready_for_review`
 * describes (10K § 3). Recording a `ready_for_review` the gate never occupied would be a fabricated
 * step in the audit trail.
 *
 * ── 🔴 What the approval does NOT do ─────────────────────────────────────────
 *
 * It approves GATE-7 and the operator runbook, and nothing else. It authorizes no benchmark, no
 * Attempt #3, no real data, no Supabase, no snapshot, no Agent 1 Brazil, no provider, no production,
 * and it modifies no cap and no flag. `BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED` stays `false`
 * with no reset path. The enumeration is data, in `BRAZIL_RECEITA_GATE7_APPROVAL_DOES_NOT_AUTHORIZE`.
 *
 * With eight of eight gates approved, `brazilReceitaGateGlobalVerdict()` now returns `GO` — which
 * 10K § 15 defines as "may propose a future runner implementation PR — still no execution". GO for a
 * runner proposal is not GO for execution, and GO for execution is not GO for import; that three-step
 * separation is untouched by this approval.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - emits an `OwnerDecisionArtifact` section. 13A has no `gate7` section.
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
 * 🔴 `approved`, as of BR-SOURCE-FAST-TRACK-8, by the joint decision of all three required owners.
 * See the module header for why the gate never occupies `ready_for_review`, and for the exact standing
 * of the reproducibility criterion — WAIVED by owner decision, never demonstrated.
 */
export const BRAZIL_RECEITA_GATE7_STATUS = 'approved' as const;

/** Whether this record approves anything. It does, as of BR-SOURCE-FAST-TRACK-8. */
export const BRAZIL_RECEITA_GATE7_APPROVED = true as const;

/**
 * The status FAST-TRACK-6 and FAST-TRACK-7 refused to claim, kept as the audit trail of what those
 * rounds would not assert. Still not the status today: the gate is `approved`, having skipped
 * `ready_for_review` entirely because the waiver and the approval were one decision.
 */
export const BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED = 'ready_for_review' as const;
export const BRAZIL_RECEITA_GATE7_STATUS_NOT_CLAIMED_REASON =
  'ready_for_review asserts evidence is COMPLETE and a named approver is still awaited; reproducibility by a different operator was never demonstrated, and once the joint approval arrived no approver was awaited, so the gate never occupied this status' as const;

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

/** The date the runbook section landed. Not the approval date — see below for that. */
export const BRAZIL_RECEITA_GATE7_RECORDED_DATE = '2026-08-21' as const;

/** The date the joint operator + technical + privacy owner approval was relayed and recorded. */
export const BRAZIL_RECEITA_GATE7_APPROVAL_DATE = '2026-08-24' as const;

/**
 * The joint approval, recorded (BR-SOURCE-FAST-TRACK-8).
 *
 * Each of the three halves is an owner RELAY — the evidentiary form every prior approval in this
 * series used — never a personal signature: no name, no email, no message id, no URL, and no
 * timestamp more precise than the date.
 *
 * 🔴 `rehearsalRequired: false` is the substantive decision inside this approval, and it is the field
 * a reader is most likely to skim past. It does not say a rehearsal happened, and it does not say
 * reproducibility was shown. It says the three approvers decided the rehearsal is not a precondition
 * of their approval — the branch their own unblocking criterion has always offered.
 */
export const BRAZIL_RECEITA_GATE7_JOINT_APPROVAL = {
  approvalDate: '2026-08-24',
  operatorOwnerReference: 'OWNER_REF_GATE7_OPERATOR_OWNER_RELAY_2026_08_24',
  technicalOwnerReference: 'OWNER_REF_GATE7_TECHNICAL_OWNER_RELAY_2026_08_24',
  privacyOwnerReference: 'OWNER_REF_GATE7_PRIVACY_OWNER_RELAY_2026_08_24',
  rehearsalRequired: false,
  rehearsalRequiredDecisionBasis:
    'BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION.andStillRequires has named this branch since FAST-TRACK-6: joint approval after the rehearsal, OR the approvers explicit decision that no rehearsal is required',
  agentMayApprove: false,
} as const;

/**
 * What the three owners approved, named exactly. An approval whose subject is left implicit is an
 * approval a later round can quietly widen.
 */
export const BRAZIL_RECEITA_GATE7_APPROVAL_SUBJECT = {
  runbookSection: 'docs/source-catalog/br-receita-cnpj-manual-download-local-prep-runbook.md § 16',
  preflightItemRange: 'P-01 … P-22',
  preflightItemCount: 22,
  stopConditionRange: 'T-01 … T-16',
  stopConditionCount: 16,
  stopConditionsAreOverridable: false,
} as const;

/**
 * The crossings this approval does NOT authorize, enumerated by the owners themselves.
 *
 * 🔴 This list is the reason the approval could be recorded at all. GATE-7 is the runbook gate: a
 * procedure, never a permission (10K § 11 *Does NOT allow*). Every entry below stays forbidden.
 */
export const BRAZIL_RECEITA_GATE7_APPROVAL_DOES_NOT_AUTHORIZE: readonly string[] = [
  'a benchmark',
  'Attempt #3, or any change to the attempt budget',
  'reading real Receita data',
  'any Supabase write',
  'any Brazil snapshot write',
  'connecting Agent 1 to Brazil',
  'any provider call',
  'enabling production',
  'changing any cap or any operational flag',
  'executing the runbook procedure — that needs the separate, explicit authorization of a future milestone',
];

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
 * 🔴 The claim this record must NOT make, and still does not make after the approval.
 *
 * 10K § 11's pass criteria require the runbook to be *reproducible by a different operator without
 * tacit knowledge*. A complete section is a necessary condition for that and not a demonstration of
 * it: only a rehearsal, by an operator who did not write the section, against real ceilings, can show
 * the steps carry no tacit knowledge. No rehearsal was performed and none is authorized.
 *
 * 🔴 BR-SOURCE-FAST-TRACK-8 approved the gate WITHOUT changing this value, and that is deliberate.
 * The three owners waived the rehearsal as a precondition of their approval; they did not, and could
 * not, demonstrate the criterion by deciding about it. `UNDEMONSTRATED` therefore stays exactly as it
 * was, and the waiver is recorded next to it rather than on top of it.
 */
export const BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR = 'UNDEMONSTRATED' as const;

/**
 * How the criterion was DISPOSED of, as distinct from what its evidentiary state is. Two fields,
 * because one field would let a reader collapse them: the disposition is a decision, the value above
 * is a fact, and they disagree on purpose.
 */
export const BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DISPOSITION = 'WAIVED_BY_OWNER_DECISION' as const;
export const BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_DEMONSTRATED = false as const;
export const BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_WAIVER_REASON =
  'P-05 requires every gate approved, GATE-7 included, so a pre-approval rehearsal stops at P-05 by construction; the three owners declined to change P-05, declined a bypass, and instead exercised their own unblocking criterions explicit no-rehearsal-required branch' as const;

/** No rehearsal was performed, and none is authorized — the approval changes neither. */
export const BRAZIL_RECEITA_GATE7_REHEARSAL_PERFORMED = false as const;
export const BRAZIL_RECEITA_GATE7_REHEARSAL_AUTHORIZED = false as const;

/** Whether the owners require one before their approval stands. They decided not (FAST-TRACK-8). */
export const BRAZIL_RECEITA_GATE7_REHEARSAL_REQUIRED = false as const;

/**
 * 🔴 The circularity the owners were asked to rule on, recorded so the decision cannot later be
 * mistaken for an oversight — or for a bypass.
 *
 * `p05WasModified` and `bypassWasCreated` are the two fields that matter: both `false`, and a static
 * test asserts them against `BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS`.
 */
export const BRAZIL_RECEITA_GATE7_PRE_APPROVAL_REHEARSAL_CIRCULARITY = {
  circularity:
    'P-05 requires all eight gates approved before the procedure may proceed; GATE-7 is one of the eight, so a rehearsal intended to demonstrate reproducibility BEFORE GATE-7 is approved halts at P-05',
  p05WasModified: false,
  bypassWasCreated: false,
  realDataWasUsed: false,
  attemptBudgetWasChanged: false,
  resolvedBy: 'the GATE-7 owners explicit decision that a pre-approval rehearsal is not required',
} as const;

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
 * The remaining blockers. NONE, as of BR-SOURCE-FAST-TRACK-8.
 *
 * 🔴 Empty is not the same as "every criterion was met by evidence". The three
 * `unapproved_dependency_gate` blockers were discharged by those gates' own approvals in
 * FAST-TRACK-7; the fourth — the `undemonstrated_pass_criterion` — was discharged by the owners'
 * WAIVER, recorded above, and not by a demonstration.
 * `BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR` still reads `UNDEMONSTRATED`, and a
 * reader who wants to know how this array emptied must look at
 * `BRAZIL_RECEITA_GATE7_BLOCKERS_DISCHARGED` to find out which mechanism closed each one.
 */
export const BRAZIL_RECEITA_GATE7_REMAINING_BLOCKERS: readonly BrazilReceitaGate7Blocker[] = [];

/** How each blocker this gate ever carried was closed, and by which round. The audit trail. */
export const BRAZIL_RECEITA_GATE7_BLOCKERS_DISCHARGED: readonly {
  readonly blocker: string;
  readonly dischargedBy: 'another_gate_approval' | 'owner_waiver';
  readonly round: string;
}[] = [
  { blocker: 'GATE-2 approved (was needs_owner_confirmation)', dischargedBy: 'another_gate_approval', round: 'BR-SOURCE-FAST-TRACK-7' },
  { blocker: 'GATE-5 approved (was ready_for_review)', dischargedBy: 'another_gate_approval', round: 'BR-SOURCE-FAST-TRACK-7' },
  { blocker: 'GATE-6 approved (was ready_for_review)', dischargedBy: 'another_gate_approval', round: 'BR-SOURCE-FAST-TRACK-7' },
  {
    blocker:
      'reproducibility by a different operator is UNDEMONSTRATED; only a rehearsal can show it, and none is authorized',
    dischargedBy: 'owner_waiver',
    round: 'BR-SOURCE-FAST-TRACK-8',
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
 * The criterion that stood between `needs_evidence` and approval, kept VERBATIM and now DISCHARGED.
 *
 * 🔴 It is preserved unedited on purpose. Its `andStillRequires` clause is the authority under which
 * BR-SOURCE-FAST-TRACK-8's approval was recorded — the parenthetical "or their explicit decision that
 * no rehearsal is required" — and rewriting the sentence after invoking it would destroy the evidence
 * that the branch pre-existed the decision rather than being written to fit it. The `discharged` and
 * `dischargedVia` fields below are additive.
 */
export const BRAZIL_RECEITA_GATE7_UNBLOCKING_CRITERION = {
  criterion:
    'a rehearsal by an operator who did not author the runbook section, against real ceilings, demonstrating reproducibility without tacit knowledge',
  thenStatusBecomes: 'ready_for_review',
  andStillRequires:
    'the joint operator + technical + privacy owner approval, after the rehearsal (or their explicit decision that no rehearsal is required)',
  agentMayDischarge: false,
  discharged: true,
  dischargedVia: 'the_no_rehearsal_required_branch',
  dischargedRound: 'BR-SOURCE-FAST-TRACK-8',
} as const;

// ─── Restrictions ─────────────────────────────────────────────────────────────

/** The bounds this record carries, enumerated per 10K § 14. */
export const BRAZIL_RECEITA_GATE7_RESTRICTIONS: readonly string[] = [
  'the runbook section is a PROCEDURE, never a PERMISSION (10K § 11 Does NOT allow)',
  'no rehearsal is performed and none is authorized',
  'no run, dry-run, benchmark or attempt-budget change is authorized, and ATTEMPT_3_ALLOWED stays false',
  'no real Receita data is read; no manifest, path or file name is learned or recorded',
  'no operational flag is flipped and no resource cap is edited',
  'no migration is authored or applied, and no Supabase write of any kind is authorized',
  'reproducibility by a different operator remains UNDEMONSTRATED and may not be claimed',
  'only a named authorized human operator may ever execute the procedure — never an agent, and never on behalf of a human',
  // BR-SOURCE-FAST-TRACK-7.
  'GATE-2, GATE-5 and GATE-6 becoming approved unblocks the REVIEW; it does not demonstrate reproducibility, and this record does not claim it does',
  // BR-SOURCE-FAST-TRACK-8.
  'this approval covers the § 16 section, P-01…P-22 and T-01…T-16 exactly as recorded; it widens no step, relaxes no stop condition, and makes none of the sixteen overridable',
  'the reproducibility criterion is WAIVED by owner decision, not demonstrated; a later round may not cite this approval as evidence that the runbook was shown reproducible',
  'P-05 is unchanged and still has no bypass; it returns PASS only because every gate is now recorded approved, and a PASSING P-05 authorizes no execution on its own',
  'GLOBAL becoming GO means only what 10K § 15 says it means — a future runner implementation PR may be PROPOSED, still with no execution, no import, and no Brazil enablement',
];
