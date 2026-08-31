/**
 * BR-SOURCE CUT D — the RUN-SCOPED state of the fiscal-identity PROMOTION capability.
 *
 * ── The defect this file exists to close ────────────────────────────────────
 *
 * There are TWO migrations under the promotion, and they are separate deployables:
 *
 *   · migration 126 — the batch identity epoch and `read_batch_identity_snapshot`;
 *   · migration 133 — `promote_candidate_fiscal_identity_fenced`.
 *
 * Production applied the first and not yet the second, which is precisely the
 * deployment window between merging this cut and applying its migration. In that
 * window the snapshot read SUCCEEDS — a non-null epoch — and only the promotion
 * answers `42883 / PGRST202`. The runner read that answer as a capability that had
 * been observed alive and then vanished, failed CLOSED as `promotion_capability_lost`,
 * left the candidate UNADJUDICATED, and so the exact-CNPJ second pass never ran:
 * CUT C's shipped enrichment regressed for every deployment in that window.
 *
 * 🔴 A non-null epoch proves migration 126. It proves NOTHING about 133. The only
 * evidence that the promotion exists is the promotion itself having ANSWERED, and
 * that evidence is what this state records.
 *
 * ── The two invariants, both preserved ──────────────────────────────────────
 *
 *   A. Before 133 has ever been observed in this run, `capability_absent` from the
 *      promotion is the migration being unapplied: `CAPABILITY_ABSENT`, adjudicated,
 *      CUT C's transient enrichment survives, and NOTHING is persisted.
 *
 *   B. Once the promotion has really answered, the capability is PRESENT and cannot
 *      un-exist. A later `capability_absent` is a deployment inconsistency — a stale
 *      schema cache, a dropped function — and fails CLOSED. This is what stops the
 *      fence evaporating halfway through a batch.
 *
 * ── 🔴 Why the state is RUN-scoped and not per candidate ────────────────────
 *
 * Because invariant B is about a run: candidate 1 proving 133 alive is exactly what
 * makes candidate 7's `capability_absent` a deployment inconsistency rather than an
 * unapplied migration. A per-call state would answer `CAPABILITY_ABSENT` for every
 * candidate after the first proof and re-open the hole B closes. The caller threads
 * it between candidates, the same way it threads the identity photograph.
 *
 * Monotone by construction: `PRESENT` is terminal. Nothing here reaches a database,
 * nothing here carries a row value, and there is no flag or setting that reorders it.
 */

/**
 * What THIS run has established about migration 133.
 *
 * `UNKNOWN` — the promotion has not answered yet. Absence is still possible proof.
 * `ABSENT`  — the promotion PROVED itself missing and has never answered otherwise.
 * `PRESENT` — the promotion answered. Terminal: it can never go back to the others.
 */
export type PromotionCapabilityState = 'UNKNOWN' | 'ABSENT' | 'PRESENT';

/**
 * What ONE transport result says about the promotion's existence.
 *
 * `UNPROVEN` is the honest third answer and the reason this is not a boolean: a
 * client without `.rpc`, a throw before the wire and a driver error with no code
 * never reached the function, so they can prove neither presence nor absence.
 */
export type PromotionCapabilityObservation = 'PRESENT' | 'ABSENT' | 'UNPROVEN';

export const INITIAL_PROMOTION_CAPABILITY_STATE: PromotionCapabilityState = 'UNKNOWN';

/**
 * Folds one observation into the run's state. Pure, total, and MONOTONE.
 *
 * 🔴 `PRESENT` absorbs everything. Returning `ABSENT` from `PRESENT` is the whole
 * failure mode invariant B forbids, so it is not reachable from here — the caller
 * cannot produce it by ordering its calls differently.
 */
export function advancePromotionCapabilityState(
  state: PromotionCapabilityState,
  observation: PromotionCapabilityObservation,
): PromotionCapabilityState {
  if (state === 'PRESENT') return 'PRESENT';
  if (observation === 'PRESENT') return 'PRESENT';
  if (observation === 'ABSENT') return 'ABSENT';
  return state;
}

/**
 * May a `capability_absent` answer be read as "migration 133 is not applied"?
 *
 * Only while the run has never seen the promotion answer. `UNKNOWN` and `ABSENT`
 * both qualify — a second absence in the same unapplied deployment is the same
 * fact, not a degradation.
 */
export function promotionAbsenceIsCredible(state: PromotionCapabilityState): boolean {
  return state !== 'PRESENT';
}

/**
 * The contract, as data, so a suite asserts the policy instead of re-reading it.
 */
export const PROMOTION_CAPABILITY_STATE_CONTRACT = {
  milestone: 'BR-PRODUCTION-RELEASE-PREP',
  states: ['UNKNOWN', 'ABSENT', 'PRESENT'] as const,
  initial: 'UNKNOWN',
  /** 🔴 The two separate migrations are never conflated. */
  inferredFromFenceCapability: false,
  inferredFromSnapshotEpoch: false,
  /** Only the promotion having ANSWERED proves the promotion exists. */
  provenOnlyByPromotionResponse: true,
  /** `PRESENT` is terminal. */
  monotone: true,
  presentCanDegradeToAbsent: false,
  /** Run-scoped: threaded across candidates by the caller. */
  scope: 'run',
  /** Nothing here is a row value, a flag or an operator setting. */
  carriesRowValues: false,
  isFlagControlled: false,
} as const;
