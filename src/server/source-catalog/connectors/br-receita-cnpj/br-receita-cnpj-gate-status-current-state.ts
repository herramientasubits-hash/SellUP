/**
 * BR Receita CNPJ — the SINGLE authoritative gate current-state view (BR-SOURCE-GATE-ROUND-3).
 *
 * ── 🔴 Why this module exists ────────────────────────────────────────────────
 *
 * The post-merge report for BR-SOURCE-GATE-ROUND-2 stated that all eight gates were `not_started`.
 * That was wrong, and it was wrong for a structural reason rather than a careless one: 10K carries a
 * per-gate `**Status today:** ...` line written when each section was authored, and every later
 * advance was recorded in a NESTED subsection (§ 5.1, § 6.1, § 7.1, § 7.2, § 8.1, § 10.1, § 12.1)
 * without editing the line above it. A reader — or a tool — that stops at the per-section line reads
 * five stale `not_started`s and reports them in good faith.
 *
 * History is not rewritten to fix that. 10K keeps its original lines and its dated updates, and each
 * stale line is now explicitly annotated `SUPERSEDED BY §X.Y`. This module is the machine-readable
 * half of the same fix: ONE place a consumer reads the current state, and a guard that refuses a
 * 10K whose per-section prose contradicts it silently.
 *
 * ── What is authoritative, and what is not ──────────────────────────────────
 *
 * The per-gate `recorded*` modules are the authority for their own gate's status. This module is a
 * VIEW: it imports each of them rather than restating a value, so it cannot drift from them. The only
 * field it states on its own is GATE-1's status, whose module records an approval date and
 * restrictions but no status constant.
 *
 * 🔴 GATE-7 stopped being an exception in BR-SOURCE-FAST-TRACK-6. Round 3 stated its status inline
 * because nothing had advanced it and it owned no recorded module; the runbook section landing gave it
 * one, so the value now comes from `br-receita-cnpj-gate7-recorded-operator-runbook` like every other
 * gate's. Its status moved from `not_started` to `blocked` — both NO-GO, and the move is a statement
 * about REVIEWABILITY, not about permission.
 *
 * ── This module NEVER ────────────────────────────────────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - advances, approves or downgrades a gate. It reports; the recorded modules decide.
 *   - derives GO from anything other than "every gate approved".
 */

import { BRAZIL_RECEITA_GATE2_STATUS } from './br-receita-cnpj-gate2-recorded-owner-decision';
import { BRAZIL_RECEITA_GATE3_STATUS } from './br-receita-cnpj-gate3-recorded-field-policy';
import { BRAZIL_RECEITA_GATE4_STATUS } from './br-receita-cnpj-gate4-recorded-identity-grain';
import { BRAZIL_RECEITA_GATE5_STATUS } from './br-receita-cnpj-gate5-recorded-output-sanitization';
import { BRAZIL_RECEITA_GATE6_STATUS } from './br-receita-cnpj-gate6-recorded-cleanup-contract';
import { BRAZIL_RECEITA_GATE7_STATUS } from './br-receita-cnpj-gate7-recorded-operator-runbook';
import { BRAZIL_RECEITA_GATE8_STATUS } from './br-receita-cnpj-gate8-recorded-contract-approval';

// ─── The status vocabulary ────────────────────────────────────────────────────

/**
 * The full status vocabulary in force, which is 10K § 3's seven PLUS the two the recorded owner
 * rounds introduced.
 *
 * 🔴 `needs_owner_confirmation` and `needs_owner_decision` are NOT in 10K § 3's original enum. Round
 * 1 and Round 2 used them anyway — correctly, because neither `needs_evidence` ("evidence gathering
 * is incomplete") nor `blocked` ("an external dependency prevents review") describes a gate whose
 * evidence is complete and whose only gap is a named human's answer. The two statuses are recorded
 * here and added to 10K § 3 rather than left as vocabulary that exists in practice and not in the
 * model. Both are NO-GO, exactly as `not_started` is.
 */
export const BRAZIL_RECEITA_GATE_STATUSES = [
  'not_started',
  'needs_evidence',
  'needs_owner_confirmation',
  'needs_owner_decision',
  'ready_for_review',
  'approved',
  'APPROVED_AS_CONTRACT',
  'rejected',
  'blocked',
  'superseded',
] as const;

export type BrazilReceitaGateStatus = (typeof BRAZIL_RECEITA_GATE_STATUSES)[number];

/**
 * The three statuses the recorded rounds added to 10K § 3's original seven.
 *
 * 🔴 `APPROVED_AS_CONTRACT` is the one most easily misread as plain `approved`. It is GATE-8's, and
 * it is deliberately narrower: its *Allows* clause is conditional on every other gate being
 * approved, and six are not. It counts toward the approved TALLY and does not, on its own, permit
 * anything.
 */
export const BRAZIL_RECEITA_GATE_STATUSES_ADDED_AFTER_10K: readonly BrazilReceitaGateStatus[] = [
  'needs_owner_confirmation',
  'needs_owner_decision',
  'APPROVED_AS_CONTRACT',
];

/**
 * The statuses that count as approved. Everything else — every one, including `ready_for_review`
 * and both `needs_owner_*` statuses — is NO-GO (10K § 15).
 */
export const BRAZIL_RECEITA_GATE_APPROVED_STATUSES: readonly BrazilReceitaGateStatus[] = [
  'approved',
  'APPROVED_AS_CONTRACT',
];

// ─── GATE-1, the one gate that owns no status constant of its own ─────────────

/**
 * GATE-1's status. Its recorded module carries the approver role, the approval date and the
 * restrictions, but no status constant, so the value is stated here and 10K § 5 is its source.
 */
export const BRAZIL_RECEITA_GATE1_STATUS: BrazilReceitaGateStatus = 'approved';

// ─── The current state ────────────────────────────────────────────────────────

export interface BrazilReceitaGateCurrentState {
  readonly gate: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  readonly status: BrazilReceitaGateStatus;
  /** The 10K subsection that most recently set this status. The provenance, not a summary. */
  readonly recordedIn: string;
  /** The per-gate module that owns the value, or `null` when this view states it. */
  readonly owningModule: string | null;
}

/**
 * The authoritative current view. A consumer reads THIS, never a `Status today` line.
 *
 * 🔴 Six of the eight are not approved, so the 10K § 15 matrix reads NO-GO. Three gates having
 * advanced their status is progress in REVIEWABILITY, not in permission.
 */
export const BRAZIL_RECEITA_GATE_CURRENT_STATE: readonly BrazilReceitaGateCurrentState[] = [
  { gate: 1, status: BRAZIL_RECEITA_GATE1_STATUS, recordedIn: '§ 5.1', owningModule: null },
  {
    gate: 2,
    status: BRAZIL_RECEITA_GATE2_STATUS as BrazilReceitaGateStatus,
    recordedIn: '§ 6.1',
    owningModule: 'br-receita-cnpj-gate2-recorded-owner-decision',
  },
  {
    gate: 3,
    status: BRAZIL_RECEITA_GATE3_STATUS as BrazilReceitaGateStatus,
    recordedIn: '§ 7.2',
    owningModule: 'br-receita-cnpj-gate3-recorded-field-policy',
  },
  {
    gate: 4,
    status: BRAZIL_RECEITA_GATE4_STATUS as BrazilReceitaGateStatus,
    recordedIn: '§ 8.1',
    owningModule: 'br-receita-cnpj-gate4-recorded-identity-grain',
  },
  {
    gate: 5,
    status: BRAZIL_RECEITA_GATE5_STATUS as BrazilReceitaGateStatus,
    recordedIn: '§ 9.1',
    owningModule: 'br-receita-cnpj-gate5-recorded-output-sanitization',
  },
  {
    gate: 6,
    status: BRAZIL_RECEITA_GATE6_STATUS as BrazilReceitaGateStatus,
    recordedIn: '§ 10.1',
    owningModule: 'br-receita-cnpj-gate6-recorded-cleanup-contract',
  },
  {
    gate: 7,
    status: BRAZIL_RECEITA_GATE7_STATUS as BrazilReceitaGateStatus,
    recordedIn: '§ 11.1',
    owningModule: 'br-receita-cnpj-gate7-recorded-operator-runbook',
  },
  {
    gate: 8,
    status: BRAZIL_RECEITA_GATE8_STATUS as BrazilReceitaGateStatus,
    recordedIn: '§ 12.1',
    owningModule: 'br-receita-cnpj-gate8-recorded-contract-approval',
  },
];

/**
 * The gates whose 10K per-section `Status today` line is STALE and therefore requires an explicit
 * `SUPERSEDED BY` annotation. Derived from the state above rather than listed by hand, so a future
 * status change cannot leave this behind.
 */
export const BRAZIL_RECEITA_GATES_WITH_SUPERSEDED_SECTION_STATUS: readonly number[] =
  BRAZIL_RECEITA_GATE_CURRENT_STATE.filter(
    (entry) => entry.status !== 'not_started' && entry.gate !== 1,
  ).map((entry) => entry.gate);

/**
 * The global verdict. `GO` requires EVERY gate approved; anything else is NO-GO. Stated as a
 * derivation and not as a constant, because a hardcoded verdict is one that survives a gate flipping.
 */
export function brazilReceitaGateGlobalVerdict(): 'GO' | 'NO-GO' {
  return BRAZIL_RECEITA_GATE_CURRENT_STATE.every((entry) =>
    BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(entry.status),
  )
    ? 'GO'
    : 'NO-GO';
}

/** How many gates are approved today. A count, so a report cannot round it up in prose. */
export function brazilReceitaApprovedGateCount(): number {
  return BRAZIL_RECEITA_GATE_CURRENT_STATE.filter((entry) =>
    BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(entry.status),
  ).length;
}

/**
 * `GATE-8 approved AS A CONTRACT` is the reading most likely to be taken as permission. It is not:
 * its Allows clause is conditional on every other gate being approved, and six are not.
 */
export const BRAZIL_RECEITA_GATE8_APPROVAL_IS_PERMISSION_TO_WRITE_RUNNER = false as const;
