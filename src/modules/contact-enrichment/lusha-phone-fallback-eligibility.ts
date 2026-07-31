/**
 * lusha-phone-fallback-eligibility.ts — Pure eligibility gate for the FUTURE,
 * manual, single-candidate Lusha phone reveal fallback (Agente 2A ·
 * LUSHA-PHONE-FALLBACK-1S).
 *
 * Context: Apollo phone reveal is closed/live. Lusha phone reveal is
 * separately approved as a manual fallback (Legal/Compliance GO, Product GO,
 * Spend GO conditioned) ONLY after a candidate's Apollo reveal already
 * returned `no_phone_found`. Scope: single candidate, manual, no bulk, no
 * automatic retry, no HubSpot write.
 *
 * A senior Lusha support ticket must still confirm two open questions before
 * this can go live: whether a `v1.`-prefixed contact id can be reused
 * days/weeks later (`lushaContactIdReuseConfirmed`), and whether
 * `reveal:["phones"]` requires an additional entitlement
 * (`lushaPhoneEntitlementConfirmed`). Both inputs represent facts the ticket
 * must confirm, so no real caller can truthfully set either to `true` until
 * the ticket resolves — today's production callers therefore always hit
 * `waiting_lusha_ticket` (both unconfirmed) or one of the two narrower codes
 * below, never `eligible`. This module does not hardcode that as an
 * unconditional constant: it evaluates exactly the inputs it is given, which
 * keeps every branch — including the eligible path — reachable and testable.
 *
 * Pure: no I/O, no DB, no provider call, no process.env read. The resolved
 * feature-flag value is injected via `featureFlagEnabled` (see
 * isLushaPhoneRevealFallbackEnabled in src/lib/feature-flags.server.ts) so
 * this module stays trivially unit-testable. Checks run in a fixed, testable
 * order and return at the first blocking condition — mirrors the ordered-gate
 * convention in apollo-enrichment-eligibility-gate.ts.
 */

/**
 * Structured reason the fallback was not offered. Every non-`eligible` value
 * means: 0 Lusha calls, 0 credits, no UI action surfaced.
 */
export type LushaPhoneFallbackEligibilityReasonCode =
  | 'feature_disabled'
  | 'unauthorized_role'
  | 'bulk_not_allowed'
  | 'candidate_not_editable'
  | 'apollo_not_exhausted'
  | 'existing_phone_present'
  | 'missing_lusha_contact_id'
  | 'waiting_lusha_ticket'
  | 'lusha_id_reuse_unconfirmed'
  | 'entitlement_unconfirmed'
  | 'missing_cost_confirmation'
  | 'eligible';

/**
 * Evaluation order, declared as data so precedence is testable and readable
 * without tracing branches (same convention as APOLLO_ENRICHMENT_GATE_ORDER).
 */
export const LUSHA_PHONE_FALLBACK_ELIGIBILITY_GATE_ORDER: readonly LushaPhoneFallbackEligibilityReasonCode[] =
  [
    'feature_disabled',
    'unauthorized_role',
    'bulk_not_allowed',
    'candidate_not_editable',
    'apollo_not_exhausted',
    'existing_phone_present',
    'missing_lusha_contact_id',
    'waiting_lusha_ticket',
    'lusha_id_reuse_unconfirmed',
    'entitlement_unconfirmed',
    'missing_cost_confirmation',
  ] as const;

/**
 * Statuses/review-statuses treated as terminal (candidate no longer editable).
 * Deliberately conservative for a scaffold: widen only when a concrete
 * candidateStatus/candidateReviewStatus vocabulary is wired to this gate.
 */
const TERMINAL_CANDIDATE_STATE_VALUES: ReadonlySet<string> = new Set([
  'approved',
  'rejected',
  'discarded',
  'archived',
]);

/**
 * Roles authorized to see/trigger the fallback. Deliberately the MOST
 * restrictive option (admin only) rather than mirroring Apollo's
 * admin + commercial_manager pair.
 *
 * TODO(LUSHA-PHONE-FALLBACK): if business decides to equalize with Apollo's
 * PHONE_REVEAL_AUTHORIZED_ROLE_KEYS, widen this in a later, separate block —
 * not implicitly here.
 */
const LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS: ReadonlySet<string> = new Set([
  'admin',
]);

export interface LushaPhoneFallbackEligibilityInput {
  candidateStatus: string | null;
  candidateReviewStatus: string | null;
  candidateArchivedAt: string | null;
  /** Apollo's phone_reveal_status vocabulary value for this candidate. */
  phoneRevealStatus: string | null;
  hasExistingPhone: boolean;
  hasLushaContactId: boolean;
  /** True only once the pending Lusha ticket confirms id reuse is safe. */
  lushaContactIdReuseConfirmed: boolean;
  /** True only once the pending Lusha ticket confirms the entitlement exists. */
  lushaPhoneEntitlementConfirmed: boolean;
  featureFlagEnabled: boolean;
  actorRole: string | null;
  hasConfirmedCost: boolean;
  isBulkAction: boolean;
}

export interface LushaPhoneFallbackEligibilityResult {
  eligible: boolean;
  reasonCode: LushaPhoneFallbackEligibilityReasonCode;
}

/**
 * Evaluates whether the Lusha phone reveal fallback should be offered for one
 * candidate. Eligible only when every gate below passes, in order.
 */
export function evaluateLushaPhoneFallbackEligibility(
  input: LushaPhoneFallbackEligibilityInput,
): LushaPhoneFallbackEligibilityResult {
  if (!input.featureFlagEnabled) {
    return { eligible: false, reasonCode: 'feature_disabled' };
  }
  if (!input.actorRole || !LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS.has(input.actorRole)) {
    return { eligible: false, reasonCode: 'unauthorized_role' };
  }
  if (input.isBulkAction) {
    return { eligible: false, reasonCode: 'bulk_not_allowed' };
  }
  if (
    input.candidateArchivedAt !== null ||
    (input.candidateReviewStatus !== null &&
      TERMINAL_CANDIDATE_STATE_VALUES.has(input.candidateReviewStatus)) ||
    (input.candidateStatus !== null && TERMINAL_CANDIDATE_STATE_VALUES.has(input.candidateStatus))
  ) {
    return { eligible: false, reasonCode: 'candidate_not_editable' };
  }
  if (input.phoneRevealStatus !== 'no_phone_found') {
    return { eligible: false, reasonCode: 'apollo_not_exhausted' };
  }
  if (input.hasExistingPhone) {
    return { eligible: false, reasonCode: 'existing_phone_present' };
  }
  if (!input.hasLushaContactId) {
    return { eligible: false, reasonCode: 'missing_lusha_contact_id' };
  }
  if (!input.lushaContactIdReuseConfirmed && !input.lushaPhoneEntitlementConfirmed) {
    // Neither open ticket question has been confirmed yet — the whole ticket
    // is still pending, not just one specific fact.
    return { eligible: false, reasonCode: 'waiting_lusha_ticket' };
  }
  if (!input.lushaContactIdReuseConfirmed) {
    return { eligible: false, reasonCode: 'lusha_id_reuse_unconfirmed' };
  }
  if (!input.lushaPhoneEntitlementConfirmed) {
    return { eligible: false, reasonCode: 'entitlement_unconfirmed' };
  }
  if (!input.hasConfirmedCost) {
    return { eligible: false, reasonCode: 'missing_cost_confirmation' };
  }
  return { eligible: true, reasonCode: 'eligible' };
}
