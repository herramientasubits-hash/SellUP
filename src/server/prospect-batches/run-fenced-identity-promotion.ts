/**
 * BR-SOURCE CUT D — the decision loop for a fenced fiscal-identity PROMOTION.
 *
 * `runFencedPersistence` is the model and the reason this is a separate file: the
 * two operations share a fence but not a shape. That one admits NEW rows and
 * advances a batch; this one adds a fiscal identity to a row that ALREADY exists,
 * which is a different question with different refusals.
 *
 * ── The algorithm ───────────────────────────────────────────────────────────
 *
 *   compose the fiscal identity key with the CANONICAL authority
 *     unusable                       ⇒ INVALID_IDENTITY, zero writes
 *   compose the recomputed identity_key with the CANONICAL authority
 *     unusable, or not tax-scoped    ⇒ INVALID_IDENTITY, zero writes
 *   this run already promoted it     ⇒ FISCAL_IDENTITY_CONFLICT, zero writes
 *   the candidate already holds one  ⇒ same key: ALREADY_SAME_IDENTITY
 *                                      other key: FISCAL_IDENTITY_CONFLICT
 *   evaluate with the authority of B23  ← `evaluateCandidateIdentity`, never another
 *     a batch peer IS this fiscal identity ⇒ FISCAL_IDENTITY_CONFLICT
 *   no epoch (migration 126)         ⇒ 133 already answered: ERROR (fail closed)
 *                                      proven-absent:      CAPABILITY_ABSENT
 *                                      otherwise:          ERROR (fail closed)
 *   dry run                          ⇒ SKIPPED_DRY_RUN, after all the refusals above
 *   promote, fenced against THAT photograph's epoch
 *     promoted / already_same        ⇒ done
 *     stale                          ⇒ RELOAD, RE-EVALUATE, retry
 *     retries exhausted              ⇒ STALE_IDENTITY_EPOCH, fail closed
 *     no such function (migration 133) ⇒ never observed in this run: CAPABILITY_ABSENT
 *                                        observed before:            ERROR (fail closed)
 *
 * 🔴 The re-evaluation after `stale` is not cosmetic, and it is the reason a
 * bounded retry is safe: the candidate that was promotable against the old
 * photograph may have become a fiscal conflict against the new one — a competing
 * writer promoting the SAME CNPJ onto a DIFFERENT candidate is precisely the race
 * this cut exists to lose safely.
 *
 * ── 🔴 Only TIER 1 blocks a promotion ───────────────────────────────────────
 *
 * `evaluateCandidateIdentity` can also answer `hard_duplicate` at TIER 2/3/4
 * (domain, provider id, LinkedIn) — but those signals did not CHANGE. They were
 * already true before the promotion and they will still be true after it, so
 * refusing here would be this cut silently re-adjudicating an admission decision
 * that belongs to the writer, not to an enrichment pass. What the promotion
 * creates is a fiscal identity, so what can block it is another row that already
 * IS that fiscal identity — TIER 1, and nothing else.
 *
 * `distinct_strong_conflict` (TIER 0) does not block either, and that is the same
 * rule read from the other side: a peer with a CONTRADICTORY fiscal identity is
 * evidence that the two are different legal persons, which is exactly the case
 * where both must be allowed to exist.
 *
 * ── 🔴 CAPABILITY_ABSENT keeps CUT C intact, and nothing more ───────────────
 *
 * While a migration this cut needs is unapplied the database says so (42883 /
 * PGRST202) and the caller keeps EXACTLY the CUT C behaviour: the resolved
 * identity stays transient and the enrichment still happens. Refusing to enrich in
 * that window would REGRESS a shipped cut for every deployment between merge and
 * apply. It is not a flag, nobody can turn it on, and the moment the migrations
 * apply the branch is unreachable.
 *
 * 🔴 There are TWO migrations, and each has its OWN proof of absence:
 *
 *   · 126 — the epoch and the snapshot read. `epoch === null` on its own has
 *     always been the trap (a failed query, an invisible batch or an unsupported
 *     client produce it too), so the authorization is
 *     `isProvenFenceCapabilityAbsent`, imported from the fenced-persistence module
 *     rather than restated, and everything else fails CLOSED as `ERROR`.
 *   · 133 — the promotion function itself. A non-null epoch says NOTHING about it,
 *     and production ran with 126 applied and 133 not. Its proof is the run-scoped
 *     `PromotionCapabilityState`: an absence is credible until the promotion has
 *     ANSWERED, and never again afterwards.
 *
 * The implication runs ONE way: 133 depends on 126, so a run that observed 133 has
 * observed 126 too, and a later photograph claiming 126 absent fails CLOSED as
 * well. 126 alone still proves nothing about 133 — that is the whole defect.
 *
 * ── 🔴 The capability is MONOTONE, per RUN ──────────────────────────────────
 *
 * Once the promotion has really answered, `PRESENT` is terminal: a later "that
 * function does not exist" is a deployment inconsistency — a stale schema cache, a
 * dropped function — and fails CLOSED as `promotion_capability_lost`. That is what
 * stops the fence evaporating halfway through a batch. The state is threaded by the
 * caller between candidates, exactly like the identity photograph, because the
 * invariant is about the RUN and not about one call.
 *
 * ── 🔴 Privacy (§ 6) ────────────────────────────────────────────────────────
 *
 * Nothing this module returns can carry a CNPJ: a status, a category reason, two
 * epoch numbers and three booleans. A conflict does not report the colliding
 * identifier, so an unresolvable candidate cannot leak the identity it was
 * refused. The fiscal key it composes internally is never returned, never logged
 * and never persisted.
 *
 * Never throws.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES,
  evaluateCandidateIdentity,
  type BatchIdentityRegistry,
  type RegisteredBatchIdentity,
} from '@/server/agents/prospecting-toolkit/batch-identity-registry';
import type { CompanyIdentityEvidence } from '@/server/agents/prospecting-toolkit/company-identity-evidence';
import {
  buildFiscalIdentityKeyFromRaw,
  resolveFiscalCountryScope,
} from '@/server/agents/prospecting-toolkit/fiscal-identity';
import { buildProspectCandidateIdentityKey } from '@/server/agents/prospecting-toolkit/prospect-candidate-identity-key';
import { MAX_IDENTITY_EPOCH_RETRIES } from './batch-identity-fence';
import { isProvenFenceCapabilityAbsent } from './batch-identity-fenced-persistence';
import {
  loadBatchIdentityRegistry,
  type BatchIdentitySeedOutcome,
} from './batch-identity-registry-store';
import {
  observedPromotionCapability,
  promoteCandidateFiscalIdentityFenced,
  type FencedIdentityPromotionRpcResult,
} from './candidate-fiscal-identity-promotion';
import {
  advancePromotionCapabilityState,
  INITIAL_PROMOTION_CAPABILITY_STATE,
  promotionAbsenceIsCredible,
  type PromotionCapabilityState,
} from './promotion-capability-state';

/** The closed outcome set. Nothing here is a row value. */
export type FencedIdentityPromotionStatus =
  /** The identity is now DURABLE on the candidate, and the epoch advanced by 1. */
  | 'PROMOTED'
  /** The candidate already stored exactly this identity. Zero writes. Idempotent. */
  | 'ALREADY_SAME_IDENTITY'
  /** Not adjudicated. Either the row or a batch peer already claims a fiscal identity. */
  | 'FISCAL_IDENTITY_CONFLICT'
  /** Lost the race more times than the bounded retry allows. Zero writes. */
  | 'STALE_IDENTITY_EPOCH'
  /** No such candidate IN THIS BATCH. Zero writes. */
  | 'CANDIDATE_NOT_FOUND'
  /** The identity itself is unusable, so no promotion is even attempted. */
  | 'INVALID_IDENTITY'
  /** The CUT D migration is not applied. The caller keeps the CUT C behaviour. */
  | 'CAPABILITY_ABSENT'
  /** Live-shadow: every refusal was evaluated, and then nothing was written. */
  | 'SKIPPED_DRY_RUN'
  /** An operational failure, sanitised. Never a claim about the company. */
  | 'ERROR';

export interface FencedIdentityPromotionResult {
  readonly status: FencedIdentityPromotionStatus;
  /** A CATEGORY, always safe to log. Never a fiscal identifier, a name or a driver message. */
  readonly reason: string;
  /** True only when a row actually changed. */
  readonly mutated: boolean;
  /**
   * May the caller go on using this identity downstream?
   *
   * 🔴 True for `PROMOTED` and `ALREADY_SAME_IDENTITY` because the identity is
   * durable and uncontested; true for `CAPABILITY_ABSENT` and `SKIPPED_DRY_RUN`
   * because those are the two states in which CUT D is deliberately inert and CUT
   * C's behaviour must survive unchanged. False for every refusal — a conflict, a
   * lost race or an error must never become an exact lookup on an identity nobody
   * adjudicated (CASE 13).
   */
  readonly adjudicated: boolean;
  /** Photograph the caller should carry into the next candidate. */
  readonly snapshot: BatchIdentitySeedOutcome;
  /**
   * What this RUN now knows about migration 133, to carry into the next candidate.
   *
   * 🔴 Threaded exactly like `snapshot`, and for the same reason: candidate 1
   * proving the promotion alive is what makes candidate 7's `capability_absent` a
   * deployment inconsistency instead of an unapplied migration. Dropping it on
   * the floor between candidates re-opens that hole.
   */
  readonly promotionCapability: PromotionCapabilityState;
  readonly telemetry: {
    readonly identityEpochInitial: number | null;
    readonly identityEpochFinal: number | null;
    readonly identityEpochStaleRetries: number;
    readonly identityEpochRetryExhausted: boolean;
    readonly identityPromotionCapabilityAbsent: boolean;
  };
}

/** Evidence for a candidate whose row signals are unknown. Only the fiscal tier can decide. */
function fiscalOnlyEvidence(
  fiscalIdentityKey: string,
  countryNamespace: string | null,
): CompanyIdentityEvidence {
  return {
    countryNamespace,
    fiscalIdentityKey,
    normalizedDomain: null,
    providerEntityKey: null,
    normalizedLinkedInCompany: null,
    canonicalName: null,
  };
}

function registryOfPeers(
  snapshot: BatchIdentitySeedOutcome,
  candidateId: string,
): BatchIdentityRegistry {
  return {
    batchId: snapshot.registry.batchId,
    entries: snapshot.registry.entries.filter((e) => e.candidateId !== candidateId),
  };
}

function entryFor(
  snapshot: BatchIdentitySeedOutcome,
  candidateId: string,
): RegisteredBatchIdentity | undefined {
  return snapshot.registry.entries.find((e) => e.candidateId === candidateId);
}

/**
 * The photograph the NEXT candidate should decide against, after a promotion.
 *
 * The epoch advances and the promoted row's entry now carries its fiscal key — so
 * a second candidate of the same run resolving to the same establishment sees a
 * TIER 1 peer and is refused, without a second database read. Exactly the trick
 * `runFencedPersistence` uses after an insert: the writer already knows what it
 * just wrote.
 */
function snapshotAfterPromotion(
  snapshot: BatchIdentitySeedOutcome,
  candidateId: string,
  promotedEvidence: CompanyIdentityEvidence,
  nextEpoch: number,
): BatchIdentitySeedOutcome {
  const existing = entryFor(snapshot, candidateId);
  const entries = existing
    ? snapshot.registry.entries.map((e) =>
        e.candidateId === candidateId ? { candidateId, evidence: promotedEvidence } : e,
      )
    : [...snapshot.registry.entries, { candidateId, evidence: promotedEvidence }];
  return {
    ...snapshot,
    epoch: nextEpoch,
    registry: { batchId: snapshot.registry.batchId, entries },
  };
}

export type RunFencedIdentityPromotionArgs = {
  client: SupabaseClient;
  batchId: string;
  candidateId: string;
  /** The country the identity is scoped to. Without it there is no fiscal identity at all. */
  countryCode: string | null | undefined;
  /** The canonical identifier the resolver produced. Not normalized again here. */
  taxIdentifier: string;
  /** The candidate's display name, for the recomputed `identity_key`. */
  candidateName: string | null | undefined;
  /** The photograph to decide against. The caller carries it between candidates. */
  snapshot: BatchIdentitySeedOutcome;
  /**
   * Fiscal identity keys this RUN already promoted.
   *
   * 🔴 Needed because the durable check cannot cover the window in which CUT D is
   * inert: with the migration unapplied nothing is persisted, so a second
   * candidate resolving to the same establishment would find no peer holding it
   * and both would claim the same company. The run's own memory closes that, and
   * it closes it in BOTH windows — it is not a substitute for the fence, it is
   * the part of the answer the fence cannot give while it does not exist.
   */
  promotedFiscalKeys?: ReadonlySet<string>;
  /**
   * What the RUN already established about migration 133. Defaults to `UNKNOWN`.
   *
   * 🔴 Never derived from the snapshot's epoch or from `fenceCapabilityAbsent`:
   * migration 126 and migration 133 are separate deployables and production ran
   * with the first applied and the second not.
   */
  promotionCapability?: PromotionCapabilityState;
  /** Live-shadow: evaluate every refusal, write nothing. */
  dryRun?: boolean;
  maxRetries?: number;
  /** Injectable ONLY for tests; production uses `loadBatchIdentityRegistry`. */
  reloadSnapshot?: (
    client: SupabaseClient,
    batchId: string,
  ) => Promise<BatchIdentitySeedOutcome>;
  /** Injectable ONLY for tests; production uses the fenced RPC. */
  promote?: typeof promoteCandidateFiscalIdentityFenced;
};

/**
 * Makes ONE resolved fiscal identity durable, under the batch's optimistic fence.
 *
 * Never throws: a conflict, a lost race and an unapplied migration are OUTCOMES,
 * and turning any of them into an exception would kill a batch for the contention
 * this mechanism exists to tolerate.
 */
export async function runFencedIdentityPromotion(
  args: RunFencedIdentityPromotionArgs,
): Promise<FencedIdentityPromotionResult> {
  const maxRetries = args.maxRetries ?? MAX_IDENTITY_EPOCH_RETRIES;
  const reload = args.reloadSnapshot ?? loadBatchIdentityRegistry;
  const promote = args.promote ?? promoteCandidateFiscalIdentityFenced;
  const dryRun = args.dryRun ?? false;

  let snapshot = args.snapshot;
  let staleRetries = 0;
  let promotionCapability =
    args.promotionCapability ?? INITIAL_PROMOTION_CAPABILITY_STATE;

  const done = (
    status: FencedIdentityPromotionStatus,
    reason: string,
    extra: { mutated?: boolean; adjudicated?: boolean; retryExhausted?: boolean } = {},
  ): FencedIdentityPromotionResult => ({
    status,
    reason,
    mutated: extra.mutated ?? false,
    adjudicated: extra.adjudicated ?? false,
    snapshot,
    promotionCapability,
    telemetry: {
      identityEpochInitial: args.snapshot.epoch,
      identityEpochFinal: snapshot.epoch,
      identityEpochStaleRetries: staleRetries,
      identityEpochRetryExhausted: extra.retryExhausted ?? false,
      identityPromotionCapabilityAbsent: status === 'CAPABILITY_ABSENT',
    },
  });

  // ── 1. The identity, composed by the CANONICAL authority. Zero I/O. ────────
  const fiscalIdentityKey = buildFiscalIdentityKeyFromRaw({
    value: args.taxIdentifier,
    countryCode: args.countryCode,
  });
  if (fiscalIdentityKey === null) {
    // No country, or an identifier that canonicalizes to nothing usable. A bare
    // fiscal number is not a global identity (CUT-3B1 § 8), so this is a refusal
    // and never a promotion of "whatever we have".
    return done('INVALID_IDENTITY', 'fiscal_identity_key_not_composable');
  }

  // ── 2. The recomputed `identity_key`. Also the canonical authority. ────────
  //
  // 🔴 The persisted key must MOVE with the identifier. A promotion that changed
  // one and not the other would leave the row describing the pre-resolution
  // candidate forever, which is one of the four defects this cut closes — so a
  // key that did not come out tax-scoped is a refusal, not a best effort.
  const identityKey = buildProspectCandidateIdentityKey({
    name: args.candidateName ?? null,
    taxIdentifier: args.taxIdentifier,
    countryCode: args.countryCode ?? null,
  });
  if (identityKey === null || !identityKey.startsWith('tax:')) {
    return done('INVALID_IDENTITY', 'identity_key_not_fiscally_scoped');
  }

  if (args.promotedFiscalKeys?.has(fiscalIdentityKey)) {
    return done('FISCAL_IDENTITY_CONFLICT', 'run_already_promoted_this_fiscal_identity');
  }

  const countryNamespace = resolveFiscalCountryScope(args.countryCode)?.namespace ?? null;

  for (let attempt = 0; ; attempt += 1) {
    // ── 3. What the candidate itself already claims. ────────────────────────
    const own = entryFor(snapshot, args.candidateId);
    if (own && own.evidence.fiscalIdentityKey !== null) {
      if (own.evidence.fiscalIdentityKey === fiscalIdentityKey) {
        return done('ALREADY_SAME_IDENTITY', 'candidate_already_holds_this_identity', {
          adjudicated: true,
        });
      }
      // 🔴 Source-supplied fiscal data is never overwritten by a resolved guess.
      return done('FISCAL_IDENTITY_CONFLICT', 'candidate_holds_a_different_fiscal_identity');
    }

    // ── 4. The batch, judged by the authority of CUT-3B23. ──────────────────
    const promotedEvidence: CompanyIdentityEvidence = own
      ? { ...own.evidence, fiscalIdentityKey, countryNamespace: own.evidence.countryNamespace ?? countryNamespace }
      : fiscalOnlyEvidence(fiscalIdentityKey, countryNamespace);

    const decision = evaluateCandidateIdentity(
      registryOfPeers(snapshot, args.candidateId),
      promotedEvidence,
    );
    if (decision.action === 'hard_duplicate' && decision.matchedTier === 1) {
      return done('FISCAL_IDENTITY_CONFLICT', 'batch_peer_holds_this_fiscal_identity');
    }

    // ── 5. Can this be fenced at all? ───────────────────────────────────────
    if (snapshot.epoch === null) {
      // 🔴 The same monotonicity, one migration down. Migration 133 DEPENDS on 126, so a run in
      // which the promotion has already ANSWERED has proven 126 applied as well. A photograph
      // arriving after that and claiming 126 absent is a deployment inconsistency, exactly like a
      // promotion that vanishes mid-flight — reachable on a `stale` retry, whose reload is a fresh
      // read — and it fails CLOSED. Without this, the retry path could still hand back an
      // `adjudicated` outcome on the strength of an absence the run had already contradicted.
      if (!promotionAbsenceIsCredible(promotionCapability)) {
        return done('ERROR', 'identity_fence_capability_lost');
      }
      if (isProvenFenceCapabilityAbsent(snapshot)) {
        return done('CAPABILITY_ABSENT', 'identity_fence_migration_not_applied', {
          adjudicated: true,
        });
      }
      return done('ERROR', 'batch_identity_snapshot_unavailable');
    }

    if (dryRun) {
      return done('SKIPPED_DRY_RUN', 'dry_run_no_write_issued', { adjudicated: true });
    }

    // ── 6. The fenced write. ────────────────────────────────────────────────
    const outcome: FencedIdentityPromotionRpcResult = await promote(args.client, {
      batchId: args.batchId,
      candidateId: args.candidateId,
      expectedEpoch: snapshot.epoch,
      taxIdentifier: args.taxIdentifier,
      identityKey,
      blockingStatuses: BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES,
    });

    // 🔴 Folded BEFORE any branch reads it, so every outcome below — including a
    // `stale` retry that then loses the function — decides against what this run
    // has actually observed about migration 133.
    promotionCapability = advancePromotionCapabilityState(
      promotionCapability,
      observedPromotionCapability(outcome),
    );

    if (outcome.status === 'promoted') {
      snapshot = snapshotAfterPromotion(
        snapshot,
        args.candidateId,
        promotedEvidence,
        outcome.nextEpoch,
      );
      return done('PROMOTED', 'fiscal_identity_persisted_under_fence', {
        mutated: true,
        adjudicated: true,
      });
    }

    if (outcome.status === 'already_same_identity') {
      return done('ALREADY_SAME_IDENTITY', 'row_already_holds_this_identity', {
        adjudicated: true,
      });
    }

    if (outcome.status === 'fiscal_identity_conflict') {
      return done('FISCAL_IDENTITY_CONFLICT', `db_${outcome.conflict}`);
    }

    if (outcome.status === 'candidate_not_found') {
      return done('CANDIDATE_NOT_FOUND', 'candidate_not_in_this_batch');
    }

    if (outcome.status === 'invalid_input') {
      return done('INVALID_IDENTITY', 'promotion_rejected_input');
    }

    if (outcome.status === 'capability_absent') {
      // 🔴 WHICH migration is missing decides this, and only ONE of the two
      // answers is a degradation.
      //
      // A non-null epoch proves migration 126 — nothing more. Migration 133 is a
      // separate deployable, and production ran with 126 applied and 133 not: the
      // exact window between merging this cut and applying it. Reading that as
      // "the fence evaporated mid-flight" is what regressed CUT C's shipped
      // enrichment for every deployment in the window, because the candidate was
      // left unadjudicated and the exact-CNPJ second pass never ran.
      //
      // So: while this run has NEVER seen the promotion answer, an absence is the
      // migration being unapplied — CUT C survives, nothing is persisted. Once the
      // promotion HAS answered, `promotionCapability` is `PRESENT`, absence is a
      // deployment inconsistency (stale schema cache, a dropped function) and this
      // fails CLOSED. `PRESENT` is terminal, so no ordering of calls can soften it.
      if (promotionAbsenceIsCredible(promotionCapability)) {
        return done('CAPABILITY_ABSENT', 'promotion_migration_not_applied', {
          adjudicated: true,
        });
      }
      return done('ERROR', 'promotion_capability_lost');
    }

    if (outcome.status === 'stale' || outcome.status === 'batch_not_found') {
      // `batch_not_found` retries down the same path as `stale`: the batch may
      // simply not be visible to this session yet. If it still is not, the bound
      // runs out and the answer is a closed failure, which is correct.
      staleRetries += 1;
      if (attempt >= maxRetries) {
        return done('STALE_IDENTITY_EPOCH', 'identity_epoch_retry_exhausted', {
          retryExhausted: true,
        });
      }
      // 🔴 The WHOLE photograph is reloaded and the decision is retaken. Reusing
      // `current_epoch` without re-reading the rows would declare a new epoch over
      // an old state — the original race, inverted.
      snapshot = await reload(args.client, args.batchId);
      continue;
    }

    return done('ERROR', `promotion_failed_${outcome.code}`);
  }
}

/**
 * The contract this loop satisfies, as data — so a suite asserts the policy
 * instead of a reviewer re-reading the branches each time one moves.
 */
export const FENCED_IDENTITY_PROMOTION_CONTRACT = {
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-D',
  // ── The write ────────────────────────────────────────────────────────────
  usesBareTaxIdentifierUpdate: false,
  writesThroughFencedRpc: true,
  epochFenced: true,
  advancesEpochOnPromotion: true,
  advancesEpochOnNoOp: false,
  rewritesIdentityKeyWithIdentifier: true,
  requiresIdentityKey: true,
  scopesCandidateLookupByBatch: true,
  // ── Identity policy ──────────────────────────────────────────────────────
  identityAuthority: 'batch-identity-registry.evaluateCandidateIdentity',
  fiscalKeyAuthority: 'fiscal-identity.buildFiscalIdentityKeyFromRaw',
  identityKeyAuthority: 'prospect-candidate-identity-key.buildProspectCandidateIdentityKey',
  implementsSecondIdentityEvaluator: false,
  onlyTierOneBlocksPromotion: true,
  overwritesCandidateSuppliedTaxIdentifier: false,
  // ── Concurrency ──────────────────────────────────────────────────────────
  reEvaluatesAfterStale: true,
  fallsBackToUnfencedWriteAfterRetries: false,
  degradedSnapshotAuthorizesWrite: false,
  observedCapabilityCanDegrade: false,
  /** 🔴 The promotion's capability is tracked per RUN, never per call. */
  promotionCapabilityIsRunScoped: true,
  /** …and never inferred from migration 126's fence, which is a different deployable. */
  infersPromotionCapabilityFromFenceCapability: false,
  /** An absence the run has not contradicted keeps CUT C intact instead of failing it. */
  unobservedPromotionAbsencePreservesCutC: true,
  // ── Output ───────────────────────────────────────────────────────────────
  returnsClosedStatusSet: true,
  returnsFiscalIdentifier: false,
  forwardsDriverMessages: false,
  throwsOnFailure: false,
} as const;
