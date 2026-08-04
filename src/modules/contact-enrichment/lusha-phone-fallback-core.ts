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
 * The same confirmation set the real price: Lusha support confirmed phone
 * reveal charges 5 credits per successful phone reveal, so the operator-facing
 * cap (LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS) is 5, not 1. The cap is only
 * the confirmation threshold — the billed cost still comes exclusively from
 * billing.creditsCharged.
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
  resolveFinalPhoneRevealRequestId,
  type PhoneRevealRequestId,
} from './phone-reveal-request-id-hygiene';
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
 * Credit cap the operator must accept for a single-contact
 * /v3/contacts/enrich call with reveal:["phones"].
 *
 * Lusha support confirmed phone reveal charges 5 credits per successful phone
 * reveal. Previously modelled as 1 credit, which understated the real cost in
 * the confirmation the operator sees.
 *
 * The REAL cost is always read from billing.creditsCharged; this is only the
 * confirmation threshold. A caller that accepts LESS than this cap is blocked
 * as `missing_cost_confirmation` — the cap is never lowered silently.
 */
export const LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS = 5;

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
  /**
   * Credit cap the operator accepts. Defaults to
   * LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS (5). A value BELOW that cap is
   * rejected as `missing_cost_confirmation`; a higher value is accepted.
   */
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
  /**
   * Credits Lusha actually reported for this call (billing.creditsCharged), or
   * null when nothing was reported — NEVER 0 as a stand-in for "unknown".
   *
   * Added for AGENT2A-PHONE-WATERFALL-1 so the waterfall run can record the Lusha
   * leg's cost in its OWN column without re-reading the candidate. OPTIONAL and
   * additive: it is a number/null on the paths that reached the provider and
   * absent on the paths that returned before any call, so pre-waterfall callers
   * and fixtures are unaffected. Never PII.
   */
  creditsCharged?: number | null;
  /**
   * Confidence about `creditsCharged`: 'reported' when the provider stated it,
   * 'unknown' when it did not. Same additive contract as above.
   */
  costSource?: 'reported' | 'assumed_cap' | 'unknown';
}

// ── Patch de persistencia ──────────────────────────────────────

export interface LushaPhoneFallbackPersistencePatch {
  phone?: string;
  enrichment_metadata?: ContactCandidateEnrichmentMetadata;
  phone_reveal_status: 'revealed' | 'no_phone_found' | 'error';
  phone_reveal_provider: 'lusha';
  /**
   * Id de correlación del desenlace, resuelto SIEMPRE por
   * `resolveFinalPhoneRevealRequestId` (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 10).
   *
   * Obligatorio (no opcional) a propósito: la columna debe escribirse en TODOS
   * los caminos, porque el bug que se corrige es precisamente el de omitirla y
   * dejar en la fila el id del intento APOLLO anterior junto a
   * `phone_reveal_provider = 'lusha'`. Hoy es siempre `null` — Lusha resuelve de
   * forma síncrona y no entrega ningún id de seguimiento — y ese `null` LIMPIA
   * la columna en vez de conservar lo que hubiera.
   */
  phone_reveal_request_id: PhoneRevealRequestId;
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

  // ── Modo waterfall (AGENT2A-PHONE-WATERFALL-1) ────────────────

  /**
   * `true` cuando esta llamada es la SEGUNDA PATA de un waterfall Apollo → Lusha
   * y no la acción manual que el operador dispara por sí misma.
   *
   * Cambia UNA sola cosa, y solo en los caminos en los que Lusha NO reveló: el
   * candidato NO se sobrescribe. En modo manual, un `no_phone_found` o un error de
   * Lusha son el resultado de la acción que el operador pidió, así que dejarlos en
   * el candidato (provider `lusha`, su costo, su error) es correcto. En modo
   * waterfall serían una MENTIRA sobre el estado del candidato: Apollo ya lo cerró
   * como `no_phone_found` y el proveedor con el que se resolvió el caso no es
   * Lusha, que solo intentó. Ese resultado pertenece a
   * `phone_reveal_waterfall_runs`, que es quien lo registra.
   *
   * El camino `revealed` es IDÉNTICO en los dos modos: Lusha sí reveló, así que el
   * candidato pasa a provider `lusha` + `enrichment_metadata.phone.source =
   * 'lusha_reveal'` con su costo real.
   *
   * El usage-log se escribe SIEMPRE, en los dos modos y en todos los caminos: un
   * gasto (o un intento) nunca deja de registrarse por estar en waterfall.
   *
   * Default (undefined/false) = modo manual, comportamiento validado sin cambios.
   */
  waterfallMode?: boolean;
  /**
   * `phone_reveal_waterfall_runs.id` de la corrida a la que pertenece esta pata.
   * Viaja únicamente a la metadata del usage-log (clave omitida si no se pasa),
   * para correlacionar las dos patas SIN sumar sus créditos. No es PII.
   */
  phoneRevealWaterfallId?: string | null;
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

/**
 * Persiste el desenlace en el candidato, salvo cuando estamos en la segunda pata
 * de un waterfall y Lusha NO reveló (AGENT2A-PHONE-WATERFALL-1).
 *
 * Un único punto de decisión para las CUATRO ramas que no revelan (fallo de red,
 * error HTTP, `no_phone_found` y respuesta malformada), en lugar de repetir el
 * mismo `if` cuatro veces. En modo manual siempre persiste: es exactamente el
 * comportamiento validado antes de este hito.
 */
async function persistNonRevealOutcome(
  deps: LushaPhoneFallbackCoreDeps,
  candidateId: string,
  patch: LushaPhoneFallbackPersistencePatch,
): Promise<void> {
  if (deps.waterfallMode === true) return;
  await deps.persist(candidateId, patch);
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

  // Higiene del id de correlación (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 10). El id
  // que se persiste pertenece SIEMPRE al proveedor que cierra el caso. Lusha
  // resuelve de forma síncrona y su contrato de cliente no incluye ningún
  // identificador de seguimiento, así que esto resuelve a `null` — y ese `null`
  // LIMPIA cualquier id Apollo anterior en vez de dejarlo convivir con
  // `phone_reveal_provider = 'lusha'`. Se calcula una sola vez y se usa en los
  // CINCO caminos de persistencia, para que ninguno pueda olvidarlo.
  const finalRequestId = resolveFinalPhoneRevealRequestId({
    provider: 'lusha',
    providerRequestId: null,
  });

  // 7. Single call to Lusha's /v3/contacts/enrich (reveal: ["phones"]). Never
  //    search, never waterfallReveal — enforced structurally by the client's
  //    own signature, not re-checked here.
  const result = await deps.callLusha({ contactId });

  // 7a. Network/timeout failure: no HTTP response at all, so no reported
  //     cost — never assume 0 credits.
  if (!result.ok) {
    const errorCode = 'provider_network_error';
    await persistNonRevealOutcome(deps, candidateId, {
      phone_reveal_status: 'error',
      phone_reveal_provider: 'lusha',
      phone_reveal_request_id: finalRequestId,
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
        waterfallId: deps.phoneRevealWaterfallId,
      }),
    );
    return {
      ...fail('error', errorCode),
      creditsCharged: null,
      costSource: 'unknown',
    };
  }

  // 7b. HTTP error mapped by the response classifier (402/403/404/401/429/5xx/malformed).
  if (result.candidateStatus === 'error') {
    await persistNonRevealOutcome(deps, candidateId, {
      phone_reveal_status: 'error',
      phone_reveal_provider: 'lusha',
      phone_reveal_request_id: finalRequestId,
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
        waterfallId: deps.phoneRevealWaterfallId,
      }),
    );
    return {
      ...fail('error', result.errorCode),
      creditsCharged: null,
      costSource: 'unknown',
    };
  }

  // 7c. no_phone_found: terminal, no re-reveal, no credits (mapper only
  //     reaches this branch when creditsCharged === 0).
  if (result.candidateStatus === 'no_phone_found') {
    await persistNonRevealOutcome(deps, candidateId, {
      phone_reveal_status: 'no_phone_found',
      phone_reveal_provider: 'lusha',
      phone_reveal_request_id: finalRequestId,
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
        waterfallId: deps.phoneRevealWaterfallId,
      }),
    );
    return {
      ok: true,
      status: 'no_phone_found',
      errorCode: null,
      creditsCharged: result.creditsCharged,
      costSource: result.costSource ?? 'unknown',
    };
  }

  // 7d. revealed: persist the number with source 'lusha_reveal'. Never
  //     overwrites unrelated enrichment_metadata keys.
  const phoneNumber = cleanText(result.phoneNumber);
  if (!phoneNumber) {
    // Defensive: the client should never report `revealed` without a number.
    // Treat as malformed rather than silently persisting an empty phone.
    const errorCode = 'malformed_provider_response';
    await persistNonRevealOutcome(deps, candidateId, {
      phone_reveal_status: 'error',
      phone_reveal_provider: 'lusha',
      phone_reveal_request_id: finalRequestId,
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
        waterfallId: deps.phoneRevealWaterfallId,
      }),
    );
    return {
      ...fail('error', errorCode),
      creditsCharged: null,
      costSource: 'unknown',
    };
  }

  // Camino `revealed`: IDÉNTICO en modo manual y en modo waterfall. Lusha sí
  // reveló, así que el candidato pasa legítimamente a provider `lusha` con su
  // costo real y `enrichment_metadata.phone.source = 'lusha_reveal'`.
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
    phone_reveal_request_id: finalRequestId,
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
      waterfallId: deps.phoneRevealWaterfallId,
    }),
  );
  return {
    ok: true,
    status: 'revealed',
    errorCode: null,
    creditsCharged: result.creditsCharged,
    costSource: result.costSource ?? 'unknown',
  };
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
  /**
   * Id de la corrida del waterfall cuando esta pata pertenece a una
   * (AGENT2A-PHONE-WATERFALL-1). El builder de metadata omite la clave si no
   * llega, así que el log del fallback manual no cambia de forma.
   */
  waterfallId?: string | null;
}): LushaPhoneFallbackUsageLogEntry {
  const metadataDraft = buildLushaPhoneFallbackUsageLogMetadataDraft({
    candidateId: args.candidateId,
    actorRole: args.actorRole ?? 'unknown',
    costSource: args.costSource,
    revealPhase: 'direct_enrich',
    phoneRevealWaterfallId: args.waterfallId ?? null,
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
