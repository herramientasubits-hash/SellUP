/**
 * BR Receita CNPJ — RECORDED GATE-1 owner decision (BR-SOURCE-GATE1-RECORD).
 *
 * BR-SOURCE-13A made "is this owner artifact complete, consistent and safe?" executable, and PR
 * #317 added its `gate1` section plus the `GATE2_CANNOT_PRECEDE_GATE1` ordering rule. Both were
 * exercised only against 13C's SYNTHETIC fixtures, which say so about themselves in their own
 * header: "they are not owner decisions". So the repository had an executable *shape* for a Gate-1
 * approval and no executable *record* of one.
 *
 * This module is that record, and nothing more: the human legal/privacy owner reviewed the Brazil /
 * Receita scope and decided that development may continue because legal/privacy coverage is
 * considered satisfied. It is kept apart from 13C precisely because 13C is synthetic-only — mixing
 * a real decision into a fixture builder would falsify that module's central rule.
 *
 * ── What this record IS ──────────────────────────────────────────────────────
 * The GATE-1 section of a § 14 approval entry, expressed as data so 13A can evaluate it instead of
 * a reader eyeballing prose. `gate1Approved: true` here comes from the recorded human decision and
 * from nothing else.
 *
 * ── What this record is NOT ──────────────────────────────────────────────────
 * Every other section is DELIBERATELY ABSENT. GATE-2 … GATE-8 and the cap/input policy are
 * `not_started`, so this artifact carries no section for them, and 13A therefore reads them
 * unapproved by absence. The consequence is intended and load-bearing:
 *
 *   - `gate1Approved`                                 → true
 *   - `gate2Approved` / `gate7Approved`               → false
 *   - `capInputPolicyApproved`                        → false
 *   - `controlledExecutionAttemptAuthorized`          → false
 *   - `status` / `goNoGo`                             → `invalid` / `NO_GO`
 *   - `canProceedToControlledExecutionPreflight`      → false
 *
 * A whole-artifact `NO_GO` is the CORRECT verdict for this record, not a defect in it: the 10K § 15
 * matrix reads NO-GO while any gate is `not_started`, and seven still are. Reading this module's
 * `NO_GO` as "Gate-1 failed" inverts its meaning — Gate-1 is the one section that passes.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access. Its only
 *     import is a TYPE import, so it contributes no executable dependency to any caller.
 *   - approves, or carries a section for, any gate other than GATE-1.
 *   - authorizes execution, a benchmark, a benchmark retry, real-data access, a manifest / CSV /
 *     ZIP / row read, snapshot output, persistence, an import, a Supabase write, a migration, a
 *     runtime path, Agent 1, or a provider call.
 *   - resets, reads or influences the real-benchmark attempt ledger.
 *   - carries a personal name, a signature, a mail address, a real path, a host, a credential, a
 *     cap number, a CNPJ or a CPF. Roles only, per 10K § 14's recording rules.
 *
 * Every builder returns a freshly constructed object, so no caller can mutate a shared record.
 */

import type { OwnerDecisionArtifact } from './br-receita-cnpj-owner-decision-validator';

// ─── The decision ─────────────────────────────────────────────────────────────

/**
 * The approver, as a ROLE. 10K § 14 forbids a personal signature or a mail address, and 10K § 5
 * forbids an approver who is also the implementer or the technical-design author. The role is
 * recorded; the identity behind it deliberately is not, here or anywhere in this repository.
 */
export const BRAZIL_RECEITA_GATE1_APPROVER_ROLE = 'legal/privacy owner' as const;

/** The date the human decision was relayed and recorded. */
export const BRAZIL_RECEITA_GATE1_APPROVAL_DATE = '2026-08-21' as const;

/**
 * How the licence question stands, split into the two things it is easy to collapse into one.
 *
 * The official metadata surfaces CONFLICTED — BR-SOURCE-1 recorded CC BY-ND 3.0, BR-LEGAL-0
 * surfaced a possible CC BY-NC-ND 3.0 Brasil variant, and that historical evidence is preserved
 * unchanged. What the human owner supplied is a DISPOSITION over that evidence, not a resolution of
 * it: development may continue. No agent determined which licence governs, and this module must not
 * be read as recording that it did.
 */
export const BRAZIL_RECEITA_GATE1_LICENCE_METADATA_HISTORY =
  'CONFLICTING_OFFICIAL_METADATA' as const;
export const BRAZIL_RECEITA_GATE1_LEGAL_PRIVACY_OWNER_DISPOSITION =
  'accepted_for_continuation_of_development' as const;
export const BRAZIL_RECEITA_GATE1_LICENCE_RESOLVED_BY_AGENT = false as const;

/**
 * The GATE-1 restrictions, ENUMERATED rather than summarized — 10K § 5's pass criteria require
 * exactly that, and a summarized restriction is how a bound quietly widens.
 *
 * Every entry restates a boundary the Brazil contract already established. None is new: this record
 * carries the existing restrictions forward, it does not legislate additional ones.
 */
export const BRAZIL_RECEITA_GATE1_RESTRICTIONS: readonly string[] = [
  'no socios file family, rejected by file-family name before any read',
  'no QSA file family, rejected by file-family name before any read',
  'no CPF, in any form, including hashed, truncated or fingerprinted',
  'no explicitly person-linked Receita file family',
  'no automatic production enablement',
  'no Supabase write and no import authorization implied by GATE-1',
  'no Agent 1 Brazil enablement implied by GATE-1',
  'no provider write implied by GATE-1',
  'downstream gates remain independently required and are not approved by this decision',
  'privacy and sanitization controls remain mandatory',
  'any downstream persistence or output must satisfy its own gates',
] as const;

/**
 * The seven GATE-1 required-evidence confirmations of 10K § 5, and how the human decision maps onto
 * them.
 *
 * ⚠️ The label `R1 … R7` is NOT a pre-existing identifier in any BR-SOURCE document. It is bound
 * here to the seven § 5 required-evidence bullets because that is the only seven-item requirement
 * set the GATE-1 contract defines. The owner should confirm the binding.
 *
 * The owner's decision was given over the scope AS A WHOLE — it did not restate these seven
 * confirmations individually. `accepted_as_part_of_whole_scope_decision` records that faithfully:
 * the confirmation is covered by the owner's acceptance, and it is not a granular per-item finding
 * that the owner separately articulated. Recording it as anything stronger would manufacture a
 * permission the human response does not supply.
 */
export const BRAZIL_RECEITA_GATE1_REQUIRED_EVIDENCE_DISPOSITION = [
  {
    id: 'R1',
    requirement:
      'a full local join dry-run may process the empresas and estabelecimentos file families locally, without persistence',
    disposition: 'accepted_as_part_of_whole_scope_decision',
  },
  {
    id: 'R2',
    requirement: 'full_dataset_processed = true is acceptable for a dry-run only',
    disposition: 'accepted_as_part_of_whole_scope_decision',
  },
  {
    id: 'R3',
    requirement: 'import_executed must remain false regardless of dry-run outcome',
    disposition: 'accepted_as_part_of_whole_scope_decision',
  },
  {
    id: 'R4',
    requirement:
      'CNPJ basico and full CNPJ are both categorically non-printable and non-persistible, with no hash, truncation or fingerprint of either anywhere',
    disposition: 'accepted_as_part_of_whole_scope_decision',
  },
  {
    id: 'R5',
    requirement:
      'treatment of MEI / empresario individual / natural-person-risk records, currently excluded by default',
    disposition: 'accepted_as_part_of_whole_scope_decision',
  },
  {
    id: 'R6',
    requirement:
      'socios / QSA / CPF and every person file family remain categorically out of scope',
    disposition: 'accepted_as_part_of_whole_scope_decision',
  },
  {
    id: 'R7',
    requirement: 'the LGPD basis for local full-dataset processing, and the licence review outcome',
    disposition: 'accepted_as_part_of_whole_scope_decision_over_conflicting_licence_metadata',
  },
] as const satisfies readonly {
  readonly id: string;
  readonly requirement: string;
  readonly disposition: string;
}[];

/**
 * Historical Brazil qualification and benchmark work ran under SEPARATE, explicit authorizations.
 * This Gate-1 approval is forward-looking only, and the three statements below are the ones a
 * future reader is most likely to get backwards.
 *
 * The attempt budget in particular is untouched: `..._ATTEMPT_3_ALLOWED` is the literal `false` in
 * `br-receita-cnpj-real-benchmark-attempt-ledger.ts`, that module exposes no reset path by
 * construction, and this record neither imports it nor reproduces a writable copy of its counter.
 */
export const BRAZIL_RECEITA_GATE1_HISTORICAL_EXECUTION_CLAUSE = {
  retroactivelyApprovesPriorExecutions: false,
  modifiesHistoricalAuditRecord: false,
  resetsBenchmarkAttemptBudget: false,
} as const;

// ─── The artifact ─────────────────────────────────────────────────────────────

/**
 * The recorded GATE-1 owner decision, shaped for BR-SOURCE-13A.
 *
 * `expirationOrReviewDate` carries a review CONDITION rather than a calendar date: the human
 * response supplied no expiry, and inventing one would be manufacturing an owner decision. The
 * condition is the narrowest honest value — the approval is reviewed at the next governance round —
 * and an owner may replace it with a calendar date, which is recorded as an open follow-up.
 *
 * Returns a new object on every call.
 */
export function buildBrazilReceitaGate1RecordedOwnerDecisionArtifact(): OwnerDecisionArtifact {
  return {
    gate1: {
      decisionValue: 'approved',
      legalPrivacyOwnerRole: 'LEGAL_PRIVACY_OWNER',
      ownerReference: 'OWNER_REF_GATE1_LEGAL_PRIVACY_OWNER_RELAY_2026_08_21',
      decisionDate: BRAZIL_RECEITA_GATE1_APPROVAL_DATE,
      expirationOrReviewDate: 'REVIEW_REQUIRED_AT_NEXT_GOVERNANCE_ROUND_GATE2_GATE3_GATE8',
      dryRunImportScopeSeparationReference:
        'DOC_BR_SOURCE_10K_SECTION_5_DRY_RUN_SCOPE_SEPARATED_FROM_IMPORT_SCOPE',
      evidencePacketReference: 'DOC_BR_RECEITA_CNPJ_FULL_JOIN_GATE_EVIDENCE_PACKET',
      stopConditionsAccepted: true,
    },
    // GATE-2, GATE-7, cap/input policy and the controlled execution attempt are intentionally
    // absent. They are `not_started`; 13A reads an absent section as unapproved, which is the
    // fail-closed reading this record wants.
  };
}
