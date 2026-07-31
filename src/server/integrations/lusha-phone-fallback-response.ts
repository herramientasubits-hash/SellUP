/**
 * lusha-phone-fallback-response.ts — Pure response interpreter for the FUTURE
 * Lusha phone reveal fallback (Agente 2A · LUSHA-PHONE-FALLBACK-1S).
 *
 * Mirrors the shape convention of apollo-phone-reveal-response.ts
 * (raw provider response → internal status) and reuses the same HTTP-status
 * vocabulary lusha-client.ts's mapLushaHttpError already established for
 * other Lusha V3 endpoints, WITHOUT importing or modifying that file — this
 * module is entirely new and self-contained so the existing email-only
 * enrichLushaContactsV3 path stays untouched.
 *
 * Pure: no fetch, no env, no DB, no logging. Never returns a raw phone number,
 * email, or LinkedIn value — only opaque status/cost fields and a phone
 * COUNT. Extracting the actual phone value is deferred to the live
 * implementation, once the Lusha ticket resolves and this scaffold's
 * feature flag / eligibility gate are wired to a real caller.
 */

export type LushaPhoneFallbackCandidateStatus = 'revealed' | 'no_phone_found' | 'error';

export type LushaPhoneFallbackUsageStatus =
  | 'success'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'error';

export type LushaPhoneFallbackCostSource = 'reported' | 'assumed_cap' | 'unknown';

export type LushaPhoneFallbackErrorCode =
  | 'insufficient_credits'
  | 'rate_limited'
  | 'invalid_contact_id'
  | 'provider_auth_error'
  | 'provider_permission_error'
  | 'provider_error'
  | 'malformed_provider_response';

/** Set only when a 200 response reported phones with 0 credits charged. */
export type LushaPhoneFallbackAvailabilitySource = 'already_available';

export interface LushaPhoneFallbackStatusMapping {
  candidateStatus: LushaPhoneFallbackCandidateStatus;
  usageStatus: LushaPhoneFallbackUsageStatus;
  costSource: LushaPhoneFallbackCostSource | null;
  errorCode: LushaPhoneFallbackErrorCode | null;
  availabilitySource: LushaPhoneFallbackAvailabilitySource | null;
  /** Count only — the raw phone value is never parsed into this mapping. */
  phonesReturned: number;
}

interface RawLushaPhoneFallbackSuccessBody {
  results?: Array<{ phones?: unknown[] }>;
  billing?: { creditsCharged?: number };
}

function buildErrorMapping(
  usageStatus: LushaPhoneFallbackUsageStatus,
  errorCode: LushaPhoneFallbackErrorCode,
): LushaPhoneFallbackStatusMapping {
  return {
    candidateStatus: 'error',
    usageStatus,
    costSource: null,
    errorCode,
    availabilitySource: null,
    phonesReturned: 0,
  };
}

/**
 * Maps an HTTP status + parsed JSON body from Lusha's /v3/contacts/enrich
 * (reveal: ["phones"]) into an internal candidate/usage status.
 *
 * Table (per LUSHA-PHONE-FALLBACK-1S spec):
 *   200 + phones + creditsCharged>0  → revealed   / success        / reported
 *   200 + phones + creditsCharged=0  → revealed   / success        / reported (already_available)
 *   200 + no phones + creditsCharged=0 → no_phone_found / success   / reported
 *   402 → error / quota_exceeded / insufficient_credits
 *   429 → error / rate_limited   / rate_limited
 *   404 → error / error          / invalid_contact_id
 *   401 → error / error          / provider_auth_error
 *   403 → error / error          / provider_permission_error (account/plan lacks the entitlement)
 *   5xx → error / error          / provider_error
 *   malformed / unexpected shape → error / error / malformed_provider_response
 *
 * Never infers credits_used=0 unless the provider response explicitly reports
 * it — an ambiguous or missing billing.creditsCharged is treated as malformed
 * rather than assumed.
 */
export function mapLushaPhoneRevealResponseToInternalStatus(
  httpStatus: number,
  body: unknown,
): LushaPhoneFallbackStatusMapping {
  if (httpStatus === 402) return buildErrorMapping('quota_exceeded', 'insufficient_credits');
  if (httpStatus === 429) return buildErrorMapping('rate_limited', 'rate_limited');
  if (httpStatus === 404) return buildErrorMapping('error', 'invalid_contact_id');
  if (httpStatus === 401) return buildErrorMapping('error', 'provider_auth_error');
  // Account/plan lacks the entitlement for `reveal:["phones"]`. Fail-closed:
  // never treated as a generic malformed response, so the operator sees a
  // distinct, actionable code instead of "unexpected shape".
  if (httpStatus === 403) return buildErrorMapping('error', 'provider_permission_error');
  if (httpStatus >= 500) return buildErrorMapping('error', 'provider_error');
  if (httpStatus !== 200) return buildErrorMapping('error', 'malformed_provider_response');

  if (body === null || typeof body !== 'object') {
    return buildErrorMapping('error', 'malformed_provider_response');
  }

  const raw = body as RawLushaPhoneFallbackSuccessBody;
  const creditsCharged = raw.billing?.creditsCharged;
  if (typeof creditsCharged !== 'number' || !Number.isFinite(creditsCharged) || creditsCharged < 0) {
    return buildErrorMapping('error', 'malformed_provider_response');
  }

  const firstResult = Array.isArray(raw.results) ? raw.results[0] : undefined;
  const phones = firstResult && Array.isArray(firstResult.phones) ? firstResult.phones : [];
  const phonesReturned = phones.length;

  if (phonesReturned > 0 && creditsCharged > 0) {
    return {
      candidateStatus: 'revealed',
      usageStatus: 'success',
      costSource: 'reported',
      errorCode: null,
      availabilitySource: null,
      phonesReturned,
    };
  }
  if (phonesReturned > 0 && creditsCharged === 0) {
    return {
      candidateStatus: 'revealed',
      usageStatus: 'success',
      costSource: 'reported',
      errorCode: null,
      availabilitySource: 'already_available',
      phonesReturned,
    };
  }
  if (phonesReturned === 0 && creditsCharged === 0) {
    return {
      candidateStatus: 'no_phone_found',
      usageStatus: 'success',
      costSource: 'reported',
      errorCode: null,
      availabilitySource: null,
      phonesReturned: 0,
    };
  }

  // phonesReturned === 0 && creditsCharged > 0 is not in the confirmed status
  // table — fail loud instead of guessing a candidate status for it.
  return buildErrorMapping('error', 'malformed_provider_response');
}
