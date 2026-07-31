/**
 * lusha-phone-fallback-core.ts — Pure, dependency-injected orchestration for
 * the LIVE Lusha phone reveal fallback (Agente 2A · LUSHA-PHONE-FALLBACK-1).
 *
 * Manual, admin-only, single-candidate action offered ONLY after Apollo's own
 * phone reveal already returned `no_phone_found`. Reuses, UNCHANGED, the gate
 * from LUSHA-PHONE-FALLBACK-1S (evaluateLushaPhoneFallbackEligibility) and the
 * phone-scoped client (enrichLushaContactPhonesForFallback) from the scaffold.
 *
 * Lusha support confirmed the two facts the eligibility gate's doc comment
 * described as an open ticket: a `v1.`-prefixed V3 contact id can be reused
 * later for /v3/contacts/enrich, and `reveal:["phones"]` requires no
 * entitlement beyond Enrich Contacts access + sufficient credits (a 403 is
 * handled fail-closed as `provider_permission_error` regardless). The two
 * constants below encode that confirmation; every caller reads them from here
 * instead of a hardcoded literal inside the gate itself, so a future reversal
 * only requires flipping one constant.
 *
 * Pure: no I/O directly. Candidate load, the actual Lusha call, persistence
 * and the usage-log write are all injected. Legal/product contract enforced
 * here (never by a migration):
 *   * single candidateId, never an array — no bulk
 *   * confirmCost === true mandatory
 *   * admin-only (mirrors evaluateLushaPhoneFallbackEligibility's role gate)
 *   * only /v3/contacts/enrich via the phone-scoped client — no search, no
 *     waterfallReveal
 *   * no HubSpot write, no automatic retry
 *   * a Lusha contact id is only trusted when the candidate's own source is
 *     'lusha' — a candidate sourced from Apollo (or elsewhere) never forwards
 *     its source_contact_id to Lusha, the same anti-cross-contamination rule
 *     phone-reveal-core.ts applies in the opposite direction for Apollo
 */

import {
  evaluateLushaPhoneFallbackEligibility,
  type LushaPhoneFallbackEligibilityReasonCode,
} from './lusha-phone-fallback-eligibility';
import type { LushaPhoneFallbackClientResult } from '@/server/integrations/lusha-phone-fallback-client';
import {
  buildLushaPhoneFallbackUsageLogMetadataDraft,
  LUSHA_PHONE_FALLBACK_OPERATION_KEY,
  LUSHA_PHONE_FALLBACK_PROVIDER_KEY,
  type LushaPhoneFallbackUsageLogMetadataDraft,
} from '@/modules/usage-tracking/lusha-phone-fallback-usage-log-draft';
import type { ContactCandidateEnrichmentMetadata, ContactSource } from './types';

// ── Constantes ─────────────────────────────────────────────────

/**
 * Facts confirmed by Lusha support (2026-07-31): a `v1.`-prefixed V3 contact
 * id may be reused later for /v3/contacts/enrich. See module doc. Flip to
 * `false` only on an explicit reversal from a later support ticket.
 */
export const LUSHA_CONTACT_ID_REUSE_CONFIRMED = true;

/**
 * Facts confirmed by Lusha support (2026-07-31): `reveal:["phones"]` requires
 * no entitlement beyond Enrich Contacts access + sufficient credits. A 403 is
 * still handled fail-closed as `provider_permission_error` if the account/plan
 * turns out to lack it in practice. See module doc.
 */
export const LUSHA_PHONE_ENTITLEMENT_CONFIRMED = true;

/** Roles authorized to trigger the fallback — admin only (narrower than Apollo). */
export const LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS: readonly string[] = ['admin'];

/**
 * Conservative default credit cap shown to the operator for a single-contact
 * /v3/contacts/enrich call with reveal:["phones"]. The REAL cost is always
 * read from billing.creditsCharged; this is only the confirmation threshold.
 */
export const LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS = 1;

/** operation_key/provider_key re-exported for callers that only need the core. */
export {
  LUSHA_PHONE_FALLBACK_OPERATION_KEY,
  LUSHA_PHONE_FALLBACK_PROVIDER_KEY,
};

// ── Entrada / candidato ────────────────────────────────────────

export interface LushaPhoneFallbackActionInput {
  candidateId: string;
  /** Explicit human cost confirmation. Must be exactly `true`. */
  confirmCost: boolean;
  /** Credit cap the operator accepts. Default LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS. */
  expectedMaxCredits?: number;
}

/** Read-only projection of the candidate needed to evaluate + run the fallback. */
export interface LushaPhoneFallbackCandidateRecord {
  id: string;
  /** contact_enrichment_candidates.status raw value (pending_review/approved/discarded/duplicate). */
  status: string | null;
  source: ContactSource | null;
  sourceContactId: string | null;
  existingPhone: string | null;
  phoneRevealStatus: string | null;
  phoneRevealAttemptCount: number | null;
  enrichmentMetadata: ContactCandidateEnrichmentMetadata;
}

// ── Resultado ──────────────────────────────────────────────────

export type LushaPhoneFallbackActionStatus =
  | Exclude<LushaPhoneFallbackEligibilityReasonCode, 'eligible'>
  | 'invalid_candidate'
  | 'candidate_not_found'
  | 'revealed'
  | 'no_phone_found'
  | 'error';

export interface LushaPhoneFallbackActionResult {
  ok: boolean;
  status: LushaPhoneFallbackActionStatus;
  /** Safe (no-PII) error code when status = 'error'. null otherwise. */
  errorCode: string | null;
}

// ── Patch de persistencia ──────────────────────────────────────

export interface LushaPhoneFallbackPersistencePatch {
  phone?: string;
  enrichment_metadata?: ContactCandidateEnrichmentMetadata;
  phone_reveal_status: 'revealed' | 'no_phone_found' | 'error';
  phone_reveal_provider: 'lusha';
  phone_revealed_at: string | null;
  phone_reveal_completed_at: string;
  phone_revealed_by: string;
  phone_reveal_cost_credits: number | null;
  phone_reveal_cost_source: 'reported' | 'assumed_cap' | 'unknown';
  phone_reveal_error_code: string | null;
  phone_reveal_attempt_count: number;
}

export interface LushaPhoneFallbackUsageLogEntry {
  operationKey: typeof LUSHA_PHONE_FALLBACK_OPERATION_KEY;
  provider: typeof LUSHA_PHONE_FALLBACK_PROVIDER_KEY;
  triggeredBy: string;
  creditsUsed: number | null;
  status: 'success' | 'error' | 'rate_limited' | 'quota_exceeded';
  errorCode: string | null;
  metadata: LushaPhoneFallbackUsageLogMetadataDraft & { provider_error_code?: string };
}

// ── Deps inyectadas ────────────────────────────────────────────

export interface LushaPhoneFallbackCoreDeps {
  flagEnabled: boolean;
  actor: { internalUserId: string; roleKey: string | null };
  nowIso: string;
  loadCandidate: (candidateId: string) => Promise<LushaPhoneFallbackCandidateRecord | null>;
  callLusha: (params: { contactId: string }) => Promise<LushaPhoneFallbackClientResult>;
  persist: (candidateId: string, patch: LushaPhoneFallbackPersistencePatch) => Promise<void>;
  logUsage: (entry: LushaPhoneFallbackUsageLogEntry) => Promise<void>;
}

// ── Helpers puros ──────────────────────────────────────────────

function fail(
  status: LushaPhoneFallbackActionStatus,
  errorCode: string | null = null,
): LushaPhoneFallbackActionResult {
  return { ok: false, status, errorCode };
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A Lusha contact id is only trusted when the candidate's own source is
 * 'lusha'. A candidate sourced from Apollo (or elsewhere) never forwards its
 * source_contact_id to Lusha — that id lives in a different provider's id
 * space (fail-closed anti-cross-contamination, mirrors the Apollo core's
 * equivalent guard in the opposite direction).
 */
function resolveLushaContactId(candidate: LushaPhoneFallbackCandidateRecord): string | null {
  if (candidate.source !== 'lusha') return null;
  return cleanText(candidate.sourceContactId);
}

// ── Orquestación pura ──────────────────────────────────────────

/**
 * Runs the manual, admin-only, single-candidate Lusha phone reveal fallback.
 * All fail-closed validations run BEFORE any Lusha call or DB write, in
 * order barato→caro. With the flag off or the actor unauthorized, returns
 * immediately without loading the candidate or touching any other dep.
 */
export async function runLushaPhoneFallbackReveal(
  input: LushaPhoneFallbackActionInput,
  deps: LushaPhoneFallbackCoreDeps,
): Promise<LushaPhoneFallbackActionResult> {
  // 1. Flag OFF → nothing else runs.
  if (!deps.flagEnabled) return fail('feature_disabled');

  // 2. Admin-only, resolved before any DB read.
  if (
    !deps.actor.roleKey ||
    !LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS.includes(deps.actor.roleKey)
  ) {
    return fail('unauthorized_role');
  }

  // 3. candidateId valid and single (no bulk: the input type is already scalar).
  const candidateId = cleanText(
    typeof input.candidateId === 'string' ? input.candidateId : null,
  );
  if (!candidateId) return fail('invalid_candidate');

  // 4. Load candidate.
  const candidate = await deps.loadCandidate(candidateId);
  if (!candidate) return fail('candidate_not_found');

  // 5. Cost confirmation + cap, resolved before the canonical gate.
  const acceptedMax =
    typeof input.expectedMaxCredits === 'number' && Number.isFinite(input.expectedMaxCredits)
      ? input.expectedMaxCredits
      : LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS;
  const hasConfirmedCost =
    input.confirmCost === true && acceptedMax >= LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS;

  // 6. Canonical eligibility gate (LUSHA-PHONE-FALLBACK-1S, unchanged).
  const lushaContactId = resolveLushaContactId(candidate);
  const eligibility = evaluateLushaPhoneFallbackEligibility({
    candidateStatus: candidate.status,
    // Neither column exists on contact_enrichment_candidates today — the gate
    // treats absence as "no terminal review/archive state", which matches the
    // real schema (see lusha-phone-fallback-eligibility.ts doc comment).
    candidateReviewStatus: null,
    candidateArchivedAt: null,
    phoneRevealStatus: candidate.phoneRevealStatus,
    hasExistingPhone: !!cleanText(candidate.existingPhone),
    hasLushaContactId: !!lushaContactId,
    lushaContactIdReuseConfirmed: LUSHA_CONTACT_ID_REUSE_CONFIRMED,
    lushaPhoneEntitlementConfirmed: LUSHA_PHONE_ENTITLEMENT_CONFIRMED,
    featureFlagEnabled: deps.flagEnabled,
    actorRole: deps.actor.roleKey,
    hasConfirmedCost,
    isBulkAction: false,
  });
  if (!eligibility.eligible) {
    // `eligible` is false here, so reasonCode is guaranteed to be one of the
    // blocking codes (never 'eligible') — TS can't narrow across the two
    // separate fields, hence the cast.
    return fail(
      eligibility.reasonCode as Exclude<LushaPhoneFallbackEligibilityReasonCode, 'eligible'>,
    );
  }

  // `lushaContactId` is non-null here: `missing_lusha_contact_id` would have
  // short-circuited eligibility above otherwise.
  const contactId = lushaContactId as string;
  const nextAttempt = (candidate.phoneRevealAttemptCount ?? 0) + 1;

  // 7. Single call to Lusha's /v3/contacts/enrich (reveal: ["phones"]). Never
  //    search, never waterfallReveal — enforced structurally by the client's
  //    own signature, not re-checked here.
  const result = await deps.callLusha({ contactId });

  // 7a. Network/timeout failure: no HTTP response at all, so no reported
  //     cost — never assume 0 credits.
  if (!result.ok) {
    const errorCode = 'provider_network_error';
    await deps.persist(candidateId, {
      phone_reveal_status: 'error',
      phone_reveal_provider: 'lusha',
      phone_revealed_at: null,
      phone_reveal_completed_at: deps.nowIso,
      phone_revealed_by: deps.actor.internalUserId,
      phone_reveal_cost_credits: null,
      phone_reveal_cost_source: 'unknown',
      phone_reveal_error_code: errorCode,
      phone_reveal_attempt_count: nextAttempt,
    });
    await deps.logUsage(
      buildUsageLogEntry({
        candidateId,
        actorId: deps.actor.internalUserId,
        actorRole: deps.actor.roleKey,
        usageStatus: 'error',
        creditsUsed: null,
        costSource: 'unknown',
        errorCode,
      }),
    );
    return fail('error', errorCode);
  }

  // 7b. HTTP error mapped by the response classifier (402/403/404/401/429/5xx/malformed).
  if (result.candidateStatus === 'error') {
    await deps.persist(candidateId, {
      phone_reveal_status: 'error',
      phone_reveal_provider: 'lusha',
      phone_revealed_at: null,
      phone_reveal_completed_at: deps.nowIso,
      phone_revealed_by: deps.actor.internalUserId,
      // Never assumed: an error response never reports a real cost.
      phone_reveal_cost_credits: null,
      phone_reveal_cost_source: 'unknown',
      phone_reveal_error_code: result.errorCode,
      phone_reveal_attempt_count: nextAttempt,
    });
    await deps.logUsage(
      buildUsageLogEntry({
        candidateId,
        actorId: deps.actor.internalUserId,
        actorRole: deps.actor.roleKey,
        usageStatus: result.usageStatus,
        creditsUsed: null,
        costSource: 'unknown',
        errorCode: result.errorCode,
      }),
    );
    return fail('error', result.errorCode);
  }

  // 7c. no_phone_found: terminal, no re-reveal, no credits (mapper only
  //     reaches this branch when creditsCharged === 0).
  if (result.candidateStatus === 'no_phone_found') {
    await deps.persist(candidateId, {
      phone_reveal_status: 'no_phone_found',
      phone_reveal_provider: 'lusha',
      phone_revealed_at: null,
      phone_reveal_completed_at: deps.nowIso,
      phone_revealed_by: deps.actor.internalUserId,
      phone_reveal_cost_credits: result.creditsCharged,
      phone_reveal_cost_source: result.costSource ?? 'unknown',
      phone_reveal_error_code: null,
      phone_reveal_attempt_count: nextAttempt,
    });
    await deps.logUsage(
      buildUsageLogEntry({
        candidateId,
        actorId: deps.actor.internalUserId,
        actorRole: deps.actor.roleKey,
        usageStatus: 'success',
        creditsUsed: result.creditsCharged,
        costSource: result.costSource ?? 'unknown',
        errorCode: null,
      }),
    );
    return { ok: true, status: 'no_phone_found', errorCode: null };
  }

  // 7d. revealed: persist the number with source 'lusha_reveal'. Never
  //     overwrites unrelated enrichment_metadata keys.
  const phoneNumber = cleanText(result.phoneNumber);
  if (!phoneNumber) {
    // Defensive: the client should never report `revealed` without a number.
    // Treat as malformed rather than silently persisting an empty phone.
    const errorCode = 'malformed_provider_response';
    await deps.persist(candidateId, {
      phone_reveal_status: 'error',
      phone_reveal_provider: 'lusha',
      phone_revealed_at: null,
      phone_reveal_completed_at: deps.nowIso,
      phone_revealed_by: deps.actor.internalUserId,
      phone_reveal_cost_credits: null,
      phone_reveal_cost_source: 'unknown',
      phone_reveal_error_code: errorCode,
      phone_reveal_attempt_count: nextAttempt,
    });
    await deps.logUsage(
      buildUsageLogEntry({
        candidateId,
        actorId: deps.actor.internalUserId,
        actorRole: deps.actor.roleKey,
        usageStatus: 'error',
        creditsUsed: null,
        costSource: 'unknown',
        errorCode,
      }),
    );
    return fail('error', errorCode);
  }

  await deps.persist(candidateId, {
    phone: phoneNumber,
    enrichment_metadata: {
      ...candidate.enrichmentMetadata,
      phone: {
        number: phoneNumber,
        type: result.phoneType,
        source: 'lusha_reveal',
        raw_type: result.phoneRawType,
      },
    },
    phone_reveal_status: 'revealed',
    phone_reveal_provider: 'lusha',
    phone_revealed_at: deps.nowIso,
    phone_reveal_completed_at: deps.nowIso,
    phone_revealed_by: deps.actor.internalUserId,
    phone_reveal_cost_credits: result.creditsCharged,
    phone_reveal_cost_source: result.costSource ?? 'unknown',
    phone_reveal_error_code: null,
    phone_reveal_attempt_count: nextAttempt,
  });
  await deps.logUsage(
    buildUsageLogEntry({
      candidateId,
      actorId: deps.actor.internalUserId,
      actorRole: deps.actor.roleKey,
      usageStatus: 'success',
      creditsUsed: result.creditsCharged,
      costSource: result.costSource ?? 'unknown',
      errorCode: null,
    }),
  );
  return { ok: true, status: 'revealed', errorCode: null };
}

// ── Constructor del log de uso (sin PII) ───────────────────────

function buildUsageLogEntry(args: {
  candidateId: string;
  actorId: string;
  actorRole: string | null;
  usageStatus: 'success' | 'error' | 'rate_limited' | 'quota_exceeded';
  creditsUsed: number | null;
  costSource: 'reported' | 'assumed_cap' | 'unknown';
  errorCode: string | null;
}): LushaPhoneFallbackUsageLogEntry {
  const metadataDraft = buildLushaPhoneFallbackUsageLogMetadataDraft({
    candidateId: args.candidateId,
    actorRole: args.actorRole ?? 'unknown',
    costSource: args.costSource,
    revealPhase: 'direct_enrich',
  });
  return {
    operationKey: LUSHA_PHONE_FALLBACK_OPERATION_KEY,
    provider: LUSHA_PHONE_FALLBACK_PROVIDER_KEY,
    triggeredBy: args.actorId,
    creditsUsed: args.creditsUsed,
    status: args.usageStatus,
    errorCode: args.errorCode,
    metadata: args.errorCode
      ? { ...metadataDraft, provider_error_code: args.errorCode }
      : metadataDraft,
  };
}
