/**
 * BR Receita CNPJ — RECORDED GATE-5 output sanitization record (BR-SOURCE-GATE-ROUND-3).
 *
 * GATE-5 is the output sanitization gate (10K § 9). It has been `not_started` since 10K, and
 * BR-SOURCE-10O landed a proposal for it whose own status reads `proposed_for_owner_review`.
 *
 * ── 🔴 What this round changed, and what it did not ──────────────────────────
 *
 * 10O was blocked on two things it named honestly rather than hid. Both are now closed:
 *
 *   1. TWO RULES WERE UNENFORCEABLE FOR WANT OF A NUMBER. `OS-A19` needed the small-cell threshold
 *      `k`, and `VP-8` / `OS-A10` needed the string-length ceiling. The owner set `k = 10` and the
 *      ceiling at 64. `BRAZIL_RECEITA_GATE5_SMALL_CELL_K` and
 *      `BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH` carry them.
 *   2. NO TEST EXISTED. 10O § 5.4 wrote: "No test is written here", and 10O § 17 records that no
 *      test could be written from that document alone. GATE-5's pass criterion is that every rule be
 *      "an assertion a future test can enforce, not prose guidance" (10K § 9), which a catalogue of
 *      IDs cannot discharge. `br-receita-cnpj-gate5-output-guard` makes each rule a predicate and
 *      the round's suite asserts them.
 *
 * What this round did NOT do, and the distinction matters more than the progress:
 *
 *   · it did not write a runner, a report emitter, or a wiring from the guard into any execution
 *     path. The guard is pure and reachable only from tests. 10K § 4 forbids full-join runner code
 *     until all eight gates are approved, and eight are not.
 *   · it did not weaken BR-SOURCE-11A. The two collisions the owner values create with 11A's
 *     numeric-leaf ceiling and with the digit-run rules are RECORDED and left to the approvers
 *     (`BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS`). Editing 11A to accommodate an exact
 *     dataset-scale figure would be trading a live privacy invariant for a convenience.
 *   · it did not resolve GATE-3 or GATE-4. 10L § 9's constraint — the report schema cannot be frozen
 *     while those two are open — is why the § 6 allowlist is frozen as a SANITIZATION contract with
 *     its three contract markers still reading `not_approved` / `not_decided`.
 *
 * ── 🔴 GATE-5 status: still NOT approved, and for one exact reason ───────────
 *
 * `BRAZIL_RECEITA_GATE5_STATUS` is `ready_for_review` — 10K § 3's "evidence complete and submitted;
 * awaiting the named approver". That is NOT an approval: 10K § 15's matrix reads NO-GO for
 * `ready_for_review` exactly as it does for `not_started`.
 *
 * The single unmet criterion is the recorded joint decision. GATE-5 needs the security / privacy
 * owner AND the test owner, jointly (10K § 9), and 10K § 3 forbids the implementer of a gate's
 * subject from approving it. This round implemented the subject. It therefore cannot approve the
 * gate, and no agent may supply either half.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - approves a gate, or emits an `OwnerDecisionArtifact` section. 13A has no `gate5` section.
 *   - authorizes a run, a benchmark, real-data access, a report emission, snapshot persistence, an
 *     import, a Supabase write, a migration, a runtime path, Agent 1, Agent 2A or a provider call.
 *   - flips, reads or reproduces a writable copy of any safety invariant, cap or flag.
 *   - carries a personal name, a signature, a mail address, a real path, a CNPJ or a CPF.
 */

// ─── Status ───────────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_GATE5_STATUS = 'ready_for_review' as const;

/** Whether this record approves anything. It does not, and says so as data. */
export const BRAZIL_RECEITA_GATE5_APPROVED = false as const;

/** The joint approvers GATE-5 requires (10K § 9). Either may reject alone; approval needs both. */
export const BRAZIL_RECEITA_GATE5_SECURITY_PRIVACY_APPROVER_ROLE =
  'security/privacy owner' as const;
export const BRAZIL_RECEITA_GATE5_TEST_APPROVER_ROLE = 'test owner' as const;
export const BRAZIL_RECEITA_GATE5_APPROVAL_IS_JOINT = true as const;

/** No agent may supply either half. Recorded as data, not as a comment. */
export const BRAZIL_RECEITA_GATE5_AGENT_MAY_APPROVE = false as const;

/** The date the executable contract landed. Not an approval date — there is none. */
export const BRAZIL_RECEITA_GATE5_RECORDED_DATE = '2026-08-21' as const;

/**
 * The one criterion still unmet. Exact, and not "needs more evidence".
 *
 * 🔴 `blockedByImplementerRule` is the load-bearing field. 10K § 3 exists because a gate approved by
 * the party that built its subject is not reviewed at all.
 */
export const BRAZIL_RECEITA_GATE5_SINGLE_REMAINING_CRITERION = {
  criterion:
    'the § 14 joint approval entry from the security/privacy owner AND the test owner, recorded against this executable contract',
  blockedByImplementerRule: true,
  implementerRule: '10K § 3 — no gate may be self-approved by the author who implements its subject',
  agentMayApprove: false,
} as const;

/**
 * The substantive decisions the approvers must make INSIDE that review — named rather than assumed,
 * so a reviewer is not asked to bless a contract whose open questions are buried in it.
 */
export const BRAZIL_RECEITA_GATE5_DECISIONS_INSIDE_THE_REVIEW: readonly string[] = [
  'OD-C1 / OD-C2 are CLOSED by supersession, not by carve-out: total_rows_scanned is now an INTERNAL_EXECUTION_COUNTER_ONLY emitted on no surface. Confirm that the internal counter needs no output representation at all — a bucket was the alternative and was not taken.',
  'OD-C3 is CLOSED by renaming the residual label to `suppressed_other`. Confirm the label change carries the same meaning and that group 7 was left intact.',
  'the two § 6 output keys renamed away from a `row`-bearing spelling — `records_persisted` and `records_seen_by_family`. Confirm the rename is acceptable given that 10J § 12 and 10K § 12 still name `persisted_rows = 0` in prose, which this round did NOT edit.',
  'BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST is now EMPTY. Confirm that the allowlist-governs precedence should nevertheless be KEPT as the standing tie-break rather than deleted for being unused.',
  'the three EXCLUDED breakdowns (capital_social, opened_at, municipality) discharge the 10M § 13 bucket-boundary item by exclusion rather than by a boundary table — confirm that reading',
  'the stack-emission narrowing (OS-A34) is stricter than 10J § 15 and is adopted here as the owner directed',
  'the VP-1..VP-4 residual digit-run gap at 9, 10, 12 and 13 positions is closed today only by BR-SOURCE-11A LONG_DIGIT_RUN, not by the frozen rules — confirm 11A is load-bearing rather than redundant, and that the two contracts stay SEPARATE rather than being merged into one widened rule',
  'the residual screenshot / copy-paste surface (10O § 4 surface L) remains machine-undetectable and is mitigated only by GATE-7 operator behaviour rules',
  'whether real local file paths in a manifest are sensitive — 10O § 12 flags the question and does not answer it',
];

/**
 * 🔴 What BR-SOURCE-FAST-TRACK-6 changed about the SUBJECT of this review, and what it did not
 * change about the STATUS.
 *
 * The subject changed materially: three recorded collisions were closed, two output keys were
 * renamed, and one owner-allowed aggregate became an internal-only counter. That is a REVISION of the
 * contract the approvers must review, which is why this record names it rather than letting the
 * approvers review a superseded version.
 *
 * The status did not change and could not. `ready_for_review` is still NO-GO, the single remaining
 * criterion is still the joint security/privacy + test owner approval, and the implementer of a
 * subject still may not approve it (10K § 3). A round that improves a contract does not earn its
 * approval; if anything, a revised subject makes the previous review round moot.
 */
export const BRAZIL_RECEITA_GATE5_CONTRACT_REVISIONS = [
  {
    round: 'BR-SOURCE-FAST-TRACK-6',
    change: 'total_rows_scanned: ALLOWED -> INTERNAL_EXECUTION_COUNTER_ONLY',
    closes: ['OD-C1', 'OD-C2'] as readonly string[],
    weakenedAnInvariant: false,
  },
  {
    round: 'BR-SOURCE-FAST-TRACK-6',
    change: 'residual bucket label: other_or_suppressed_small_cell -> suppressed_other',
    closes: ['OD-C3'] as readonly string[],
    weakenedAnInvariant: false,
  },
  {
    round: 'BR-SOURCE-FAST-TRACK-6',
    change: 'output keys: persisted_rows -> records_persisted, rows_seen_by_family -> records_seen_by_family',
    closes: [] as readonly string[],
    weakenedAnInvariant: false,
  },
] as const;

/**
 * 🔴 Whether the revisions above make this gate approvable by the party that made them. They do not.
 *
 * Stated as its own constant because "we fixed everything the last review flagged" is the most
 * natural-sounding route to a self-approval, and 10K § 3 forbids it regardless of how complete the
 * fixes are.
 */
export const BRAZIL_RECEITA_GATE5_REVISIONS_EARN_AN_APPROVAL = false as const;

/**
 * Restrictions this record carries with it. An approval, if it ever comes, is bounded by these.
 */
export const BRAZIL_RECEITA_GATE5_RESTRICTIONS: readonly string[] = [
  'approving GATE-5 authorizes writing sanitization tests in a future, separately approved milestone (10K § 9 Allows) and nothing else',
  'it does not authorize executing the full join',
  'it does not authorize emitting any report from real data',
  'it does not freeze the 10J § 12 report SCHEMA — 10L § 9 forbids that while GATE-3 and GATE-4 are open, and both are',
  'it does not assign field_allowlist_version, record_identity_grain_decision or temporary_storage_mode a value other than their not-approved markers',
  'it flips no operational flag',
  'it does not make any other gate reviewable or approved',
];

// ─── The assertion catalogue, mapped onto execution ───────────────────────────

export type BrazilReceitaGate5AssertionState =
  | 'executable_and_asserted'
  | 'deferred_to_implementation'
  | 'owned_by_other_gate';

export interface BrazilReceitaGate5AssertionRecord {
  readonly id: string;
  readonly state: BrazilReceitaGate5AssertionState;
  /** Where the assertion is discharged, or which gate owns it. Never a promise. */
  readonly dischargedBy: string;
}

/**
 * `OS-A01` … `OS-A46`, every one accounted for. 10O § 5.4 assigned the IDs; this maps each to the
 * predicate that enforces it or names the reason it cannot be enforced here.
 *
 * 🔴 There are 41 IDs, not 46: 10O's catalogue skips `OS-A29` and `OS-A36` … `OS-A39`. The gaps are
 * in the source record, and closing them by renumbering would break the one-to-one traceability the
 * IDs exist for.
 *
 * 🔴 No assertion is DELETED and none is WEAKENED. Round 1 and Round 2 changed the architecture
 * around this gate — the bucket ordinal left the disk, the identity columns became TRANSIENT_ONLY —
 * and neither change makes any output assertion obsolete: an output rule about a value is unaffected
 * by that value ceasing to be persisted. `BRAZIL_RECEITA_GATE5_SUPERSEDED_ASSERTIONS` is therefore
 * empty, and it is empty as a finding rather than by omission.
 */
export const BRAZIL_RECEITA_GATE5_ASSERTION_RECORDS: readonly BrazilReceitaGate5AssertionRecord[] = [
  { id: 'OS-A01', state: 'executable_and_asserted', dischargedBy: 'findBrazilReceitaGate5DigitRunViolations / VP-1' },
  { id: 'OS-A02', state: 'executable_and_asserted', dischargedBy: 'findBrazilReceitaGate5DigitRunViolations / VP-2' },
  { id: 'OS-A03', state: 'executable_and_asserted', dischargedBy: 'findBrazilReceitaGate5DigitRunViolations / VP-3' },
  { id: 'OS-A04', state: 'executable_and_asserted', dischargedBy: 'findBrazilReceitaGate5DigitRunViolations / VP-4' },
  { id: 'OS-A05', state: 'executable_and_asserted', dischargedBy: 'findBrazilReceitaGate5DigitRunViolations / VP-5 separator stripping' },
  { id: 'OS-A06', state: 'executable_and_asserted', dischargedBy: 'containsBrazilReceitaGate5EmailMarker / VP-6' },
  { id: 'OS-A07', state: 'executable_and_asserted', dischargedBy: 'matchBrazilReceitaGate5ForbiddenKeyGroup over the closed seven groups' },
  { id: 'OS-A08', state: 'executable_and_asserted', dischargedBy: 'isBrazilReceitaGate5AllowedKey over the frozen § 6 allowlist' },
  { id: 'OS-A09', state: 'executable_and_asserted', dischargedBy: 'isBrazilReceitaGate5AdmissibleStringValue / VP-7' },
  { id: 'OS-A10', state: 'executable_and_asserted', dischargedBy: 'exceedsBrazilReceitaGate5StringLength / VP-8 at 64' },
  { id: 'OS-A11', state: 'executable_and_asserted', dischargedBy: 'isBrazilReceitaGate5AdmissibleCount / VP-9' },
  { id: 'OS-A12', state: 'executable_and_asserted', dischargedBy: 'guardBrazilReceitaGate5Report count-map branch / VP-10' },
  { id: 'OS-A13', state: 'executable_and_asserted', dischargedBy: 'denylist group 6 join_key plus the allowlist' },
  { id: 'OS-A14', state: 'executable_and_asserted', dischargedBy: 'denylist group 6 record_identity_key plus the allowlist' },
  { id: 'OS-A15', state: 'executable_and_asserted', dischargedBy: 'denylist group 6 normalized_tax_id plus the allowlist' },
  { id: 'OS-A16', state: 'executable_and_asserted', dischargedBy: 'denylist group 6 hash containers plus BR-SOURCE-11A HEX_DIGEST_LIKE' },
  { id: 'OS-A17', state: 'executable_and_asserted', dischargedBy: 'denylist group 7 raw / row / cell / payload' },
  { id: 'OS-A18', state: 'executable_and_asserted', dischargedBy: 'denylist group 7 offset' },
  { id: 'OS-A19', state: 'executable_and_asserted', dischargedBy: 'applyBrazilReceitaGate5SmallCellSuppression at k = 10' },
  { id: 'OS-A20', state: 'executable_and_asserted', dischargedBy: 'guardBrazilReceitaGate5Report VP-7 plus the static no-console guard' },
  { id: 'OS-A21', state: 'executable_and_asserted', dischargedBy: 'isBrazilReceitaGate5ErrorEnvelopeShape' },
  { id: 'OS-A22', state: 'executable_and_asserted', dischargedBy: 'isBrazilReceitaGate5AllowedKey applied key-by-key' },
  { id: 'OS-A23', state: 'executable_and_asserted', dischargedBy: 'KEY-ALLOWLIST finding on any key outside the frozen set' },
  {
    id: 'OS-A24',
    state: 'deferred_to_implementation',
    dischargedBy:
      'no human report or operator summary emitter exists; projection cannot be asserted against absent code, and 10K § 4 forbids writing it',
  },
  { id: 'OS-A25', state: 'executable_and_asserted', dischargedBy: 'guardBrazilReceitaGate5LogEvent plus the static no-console guard' },
  {
    id: 'OS-A26',
    state: 'deferred_to_implementation',
    dischargedBy:
      'the contract constant is asserted; the ASSEMBLY it governs has no implementation to assert against',
  },
  { id: 'OS-A27', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE5_EVIDENCE_FORBIDDEN_CONTENT plus the denylist' },
  { id: 'OS-A28', state: 'executable_and_asserted', dischargedBy: 'every fixture in this round is generated in-suite; no real dataset value is read' },
  { id: 'OS-A30', state: 'executable_and_asserted', dischargedBy: 'createBrazilReceitaGate5SanitizedError closed code enum' },
  { id: 'OS-A31', state: 'executable_and_asserted', dischargedBy: 'the envelope has no message field, so there is nowhere to interpolate' },
  { id: 'OS-A32', state: 'executable_and_asserted', dischargedBy: 'createBrazilReceitaGate5SanitizedError drops an unclassifiable field to null' },
  { id: 'OS-A33', state: 'executable_and_asserted', dischargedBy: 'admissibleEnumOrNull refuses a separator-bearing value' },
  { id: 'OS-A34', state: 'executable_and_asserted', dischargedBy: 'the envelope is a plain frozen record with no stack, and the contract constant is false' },
  { id: 'OS-A35', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE5_SANITIZE_AT_CONSTRUCTION plus the constructor being the only builder' },
  { id: 'OS-A40', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL maxOutputRows' },
  { id: 'OS-A41', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS snapshotPersistence' },
  { id: 'OS-A42', state: 'executable_and_asserted', dischargedBy: 'the § 6 allowlist fixes import_executed as a contract-false member' },
  { id: 'OS-A43', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS runtime' },
  { id: 'OS-A44', state: 'executable_and_asserted', dischargedBy: 'BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS agent1Brazil' },
  { id: 'OS-A45', state: 'executable_and_asserted', dischargedBy: 'createBrazilReceitaGate5SanitizedError safety_flags, every member false' },
  {
    id: 'OS-A46',
    state: 'owned_by_other_gate',
    dischargedBy:
      'GATE-6 owns cleanup on completion AND failure; BR-SOURCE-GATE-ROUND-2 made it executable in br-receita-cnpj-full-join-cleanup-coordinator',
  },
];

/**
 * Assertions Round 1 or Round 2 made obsolete. EMPTY, as a finding: an output rule about a value is
 * not obsoleted by that value ceasing to be persisted, so no supersession is honest here.
 */
export const BRAZIL_RECEITA_GATE5_SUPERSEDED_ASSERTIONS: readonly {
  readonly id: string;
  readonly replacedBy: string;
}[] = [];

/** The catalogue's own arithmetic, as data, so a test can refuse a silently dropped assertion. */
export const BRAZIL_RECEITA_GATE5_ASSERTION_TOTALS = {
  total: 41,
  executableAndAsserted: 38,
  deferredToImplementation: 2,
  ownedByOtherGate: 1,
  deleted: 0,
  weakened: 0,
} as const;
