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
 *
 * ── AGENT2A-PHONE-REVEAL-4O-D ──────────────────────────────────
 *
 * The `revealed` path can now persist EVERY phone the response carried, in ONE
 * transaction, instead of the single scalar `UPDATE` it used before. That happens
 * only when `persistPhoneCollection` is injected — which is the case for the two
 * paths this milestone authorized (the full Apollo → Lusha waterfall leg and the
 * legacy Lusha-only continuation, both wired through `callLushaFallbackLeg`).
 * Without the dep the path is byte-for-byte what it was, so the manual admin
 * action keeps its validated behaviour and is not silently changed by a milestone
 * that was not scoped to it.
 *
 * What DOES change on every path, including the manual one, is which number ends
 * up in the scalar: the client no longer publishes `phones[0]` but the one the
 * type ranking elects, so a valid mobile in slot 1 now beats a work line in slot
 * 0. That is the binding product decision, it is deliberate, and it is the whole
 * point of the milestone.
 */

import {
  evaluateLushaPhoneFallbackEligibility,
  type LushaPhoneFallbackEligibilityReasonCode,
} from './lusha-phone-fallback-eligibility';
import type { LushaPhoneFallbackClientResult } from '@/server/integrations/lusha-phone-fallback-client';
import {
  buildLushaPhoneCollectionCapture,
  resolveLushaLegacyDedupeKey,
} from './lusha-phone-collection-capture';
import { buildCandidatePrimaryPhoneCandidates } from './candidate-phone-collection-writer';
import {
  describeCandidateLushaPhoneCollectionWrite,
  type CandidateLushaPhoneCollectionLogFields,
  type PersistCandidateLushaPhoneCollection,
} from './candidate-lusha-phone-collection-writer';
import {
  resolveFinalPhoneRevealRequestId,
  type PhoneRevealRequestId,
} from './phone-reveal-request-id-hygiene';
import {
  applyTerminalPhoneSuppression,
  buildTerminalPhoneSuppressionPatch,
  type PersistTerminalPhoneSuppression,
} from './phone-reveal-suppression-guard';
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

/**
 * `errorCode` que este core devuelve cuando la transacción de la colección
 * (migración 111) respondió `suppressed`: Lusha entregó teléfonos y COBRÓ, pero
 * todos son tombstones y ninguno se pudo persistir.
 *
 * Se exporta porque es el único código de error de esta pata que va acompañado de un
 * costo REAL, y quien contabiliza la corrida tiene que poder reconocerlo para no
 * borrar ese costo (AGENT2A-PHONE-REVEAL-4O-E1 § 10). El waterfall lo espeja en
 * `PHONE_REVEAL_WATERFALL_LUSHA_SUPPRESSED_ERROR_CODE` en vez de importar este
 * módulo — mantiene su independencia del core de Lusha — y un test estático verifica
 * que las dos constantes no se separen.
 */
export const LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE = 'phone_suppressed' as const;

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
  /**
   * Additive intersection, same convention `provider_error_code` already
   * established: the closed draft module is not touched, and the two 4O-D keys
   * are OPTIONAL, so every path that does not persist a collection logs exactly
   * the shape it logged before.
   *
   * Both new keys are PII-free by construction — `phone_collection` can only be
   * built by `describeCandidateLushaPhoneCollectionWrite`, whose return type is a
   * closed set of counts and flags, and `phone_collection_error_code` is a
   * mechanical code.
   */
  metadata: LushaPhoneFallbackUsageLogMetadataDraft & {
    provider_error_code?: string;
    phone_collection?: CandidateLushaPhoneCollectionLogFields;
    phone_collection_error_code?: string;
  };
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
   * Viaja a la metadata del usage-log (clave omitida si no se pasa) y, desde
   * 4O-D, también a `waterfall_run_id` en la procedencia de cada teléfono
   * capturado, que es donde se puede unir con la contabilidad. No es PII.
   */
  phoneRevealWaterfallId?: string | null;

  /**
   * Escritura TRANSACCIONAL de la colección de teléfonos
   * (AGENT2A-PHONE-REVEAL-4O-D). OPCIONAL a propósito.
   *
   * PRESENTE ⇒ el camino `revealed` deja de escribir el candidato con un UPDATE
   * suelto y pasa a una sola llamada que persiste, atómicamente, las filas
   * canónicas, sus procedencias, el principal, el escalar y el estado terminal.
   * Es lo que cablean las DOS rutas autorizadas por este hito (waterfall completo
   * y continuación legacy), ambas por `callLushaFallbackLeg`.
   *
   * AUSENTE ⇒ comportamiento anterior intacto, vía `persist`. El disparo manual
   * de administración queda ahí, sin cambios: no estaba en el alcance de este
   * hito y no se modifica de refilón. Consecuencia declarada: ese camino sigue
   * guardando un solo teléfono. Lo que sí mejora en él, porque vive en el
   * cliente y no aquí, es CUÁL de ellos.
   *
   * Debe LANZAR si no puede completar. Un fallo aquí es fail-closed: el candidato
   * NO se terminaliza, el usage-log sí se escribe (el gasto ocurrió), y el mismo
   * resultado es reprocesable sin volver a llamar a Lusha.
   */
  persistPhoneCollection?: PersistCandidateLushaPhoneCollection;

  /**
   * `phone_reveal_credit_reservations.id` de la pata, si el camino lo conoce.
   * Solo viaja a la procedencia. null cuando no se conoce — igual que en la
   * captura del otro proveedor, no se inventa una correlación.
   */
  phoneCollectionReservationId?: string | null;

  /**
   * Cierra el candidato como `error` + `blocked_suppressed` cuando la transacción
   * de la colección respondió `suppressed` (AGENT2A-PHONE-REVEAL-4O-E1).
   *
   * Ese resultado significa que TODOS los números que Lusha entregó —y cobró— son
   * tombstones. Hasta este hito el candidato no recibía NINGÚN rastro: se quedaba
   * en `no_phone_found`, que es exactamente el estado que vuelve a hacerlo elegible
   * para otro reveal pagado, así que el mismo número suprimido se podía volver a
   * comprar indefinidamente.
   *
   * OPCIONAL: sin ella el camino queda como antes del hito. La escritura es
   * CONDICIONAL —exige que la fila siga en el estado que autorizó esta pata— así
   * que una carrera con otro actor no puede pisar su resultado.
   */
  persistTerminalSuppression?: PersistTerminalPhoneSuppression;
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
  //
  // 4O-D: con `persistPhoneCollection` cableada, esa escritura deja de ser un
  // UPDATE suelto y pasa a ser UNA transacción que además guarda TODOS los
  // teléfonos de la respuesta. Sin la dep, el UPDATE de siempre.
  if (deps.persistPhoneCollection) {
    const elected = {
      number: phoneNumber,
      rawType: result.phoneRawType,
      phoneType: result.phoneType,
    };
    // El escalar elegido SIEMPRE forma parte de la colección. Si un cliente
    // entregara la lista vacía (o no la entregara) en un camino que sí reveló, la
    // colección se construye a partir de ese único teléfono en vez de quedarse
    // vacía: un número que ya se pagó no puede acabar sin fila porque la lista
    // llegara mal, y la migración rechaza una colección vacía de todos modos.
    const observed =
      Array.isArray(result.phones) && result.phones.length > 0
        ? result.phones
        : [elected];

    const capture = buildLushaPhoneCollectionCapture({
      phones: observed,
      primary: elected,
      context: {
        waterfallRunId: deps.phoneRevealWaterfallId ?? null,
        reservationId: deps.phoneCollectionReservationId ?? null,
        // El usage-log de ESTA pata todavía no existe cuando se construye la
        // captura, así que se declara null en vez de inventarse: la migración lo
        // admite nulo precisamente para no fabricar correlaciones.
        providerUsageLogId: null,
        observedAt: deps.nowIso,
      },
    });

    // `legacyBest` es no-nulo aquí: se construyó a partir de `phoneNumber`, que
    // esta rama ya comprobó. El fallback estructural mantiene el tipo honesto.
    const legacy = capture.legacyBest ?? {
      number: phoneNumber,
      type: result.phoneType,
      source: 'lusha_reveal' as const,
      raw_type: result.phoneRawType,
    };

    const collectionLog = (
      write: CandidateLushaPhoneCollectionLogFields | null,
    ): CandidateLushaPhoneCollectionLogFields =>
      write ??
      describeCandidateLushaPhoneCollectionWrite({
        result: null,
        duplicatePhoneCount: capture.counters.duplicate_phone_count,
        canonicalPhoneCount: capture.counters.canonical_phone_count,
        sourceCount: capture.counters.source_count,
      });

    let written;
    try {
      written = await deps.persistPhoneCollection({
        candidateId,
        phones: capture.phones,
        primaryCandidates: buildCandidatePrimaryPhoneCandidates({
          phones: capture.phones,
          primaryPreference: capture.primaryPreference,
          legacy,
        }),
        observedAt: deps.nowIso,
        terminal: {
          // El estado que autorizó esta pata. La transacción exige, bajo el lock,
          // que la fila siga en él: es el único token de pertenencia disponible,
          // porque Lusha no entrega ningún id de seguimiento.
          expectedPhoneRevealStatus: candidate.phoneRevealStatus ?? '',
          legacyPhone: legacy.number,
          legacyPhoneType: legacy.type,
          legacyRawType: legacy.raw_type,
          legacyDedupeKey: resolveLushaLegacyDedupeKey(legacy),
          revealedAt: deps.nowIso,
          completedAt: deps.nowIso,
          revealedBy: deps.actor.internalUserId,
          requestId: finalRequestId,
          costCredits: result.creditsCharged,
          costSource: result.costSource ?? 'unknown',
          attemptCount: nextAttempt,
        },
      });
    } catch {
      // FAIL-CLOSED. Lusha YA cobró, así que el gasto se registra igualmente —
      // el usage-log vive fuera de la transacción precisamente para sobrevivir al
      // fallo que describe. Lo que NO se hace es decir `revealed`: el candidato
      // sigue sin cerrar, que es el estado reprocesable y auditable. No se
      // reintenta y no se vuelve a llamar a Lusha.
      const errorCode = 'collection_persistence_unavailable';
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
          phoneCollection: collectionLog(null),
          phoneCollectionErrorCode: errorCode,
        }),
      );
      return {
        ...fail('error', errorCode),
        creditsCharged: result.creditsCharged,
        costSource: result.costSource ?? 'unknown',
      };
    }

    const describedWrite = describeCandidateLushaPhoneCollectionWrite({
      result: written,
      duplicatePhoneCount: capture.counters.duplicate_phone_count,
      canonicalPhoneCount: capture.counters.canonical_phone_count,
      sourceCount: capture.counters.source_count,
    });

    // La transacción decide si el candidato quedó cerrado. `suppressed` y
    // `stale_event` NO lo cierran a propósito, así que reportarlos como
    // `revealed` sería afirmar un estado que la base no tiene.
    if (!written.candidate_terminalized) {
      const errorCode =
        written.status === 'suppressed'
          ? LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE
          : `collection_${written.status}`;
      // 4O-E1 — supresión confirmada por la transacción: TODOS los números que
      // Lusha entregó (y cobró) son tombstones. El candidato recibe por fin el
      // rastro terminal `error` + `blocked_suppressed`, que es lo que lo saca de
      // `no_phone_found` y por tanto lo hace INELEGIBLE para otro reveal pagado
      // (`apollo_not_exhausted` en el gate canónico).
      //
      // Best-effort en el sentido estricto: si la escritura no se aplica —dep sin
      // cablear, carrera con otro actor, fallo del driver— el camino sigue siendo
      // exactamente el de antes del hito. Lo que NO se hace en ningún caso es
      // ocultar el gasto: el usage-log de abajo se escribe igual.
      if (written.status === 'suppressed') {
        await applyTerminalPhoneSuppression({
          candidateId,
          persist: deps.persistTerminalSuppression,
          patch: buildTerminalPhoneSuppressionPatch({
            // Mismo token de pertenencia que exigió la transacción: la fila tiene
            // que seguir en el estado que autorizó esta pata. Vacío ⇒ no se escribe.
            expectedStatuses: cleanText(candidate.phoneRevealStatus)
              ? [candidate.phoneRevealStatus as string]
              : [],
            nowIso: deps.nowIso,
            // El costo NO se escribe en el candidato, y eso es lo que PRESERVA el
            // gasto real. Estas columnas describen UN reveal, y el que describen aquí
            // es el de la pata anterior (Apollo cerró `no_phone_found` con su propia
            // cifra): sobrescribirlas con los créditos de Lusha borraría ese dato y
            // atribuiría el gasto al proveedor equivocado. El cargo REAL de Lusha se
            // conserva donde se contabiliza —columnas Lusha de la corrida, reserva
            // confirmada y `provider_usage_logs`—, cada pata en su sitio.
            //
            // Por la misma razón no se toca `phone_reveal_provider`: el reveal que la
            // fila describe sigue siendo el de Apollo.
          }),
        });
      }
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
          phoneCollection: describedWrite,
          phoneCollectionErrorCode: errorCode,
        }),
      );
      return {
        ...fail('error', errorCode),
        creditsCharged: result.creditsCharged,
        costSource: result.costSource ?? 'unknown',
      };
    }

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
        phoneCollection: describedWrite,
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
  /**
   * Cifras PII-free de la escritura de la colección (4O-D). Clave OMITIDA si no
   * llega, así que los caminos que no persisten colección conservan la forma de
   * metadata exacta que ya tenían.
   */
  phoneCollection?: CandidateLushaPhoneCollectionLogFields;
  /**
   * Código mecánico del fallo de persistencia, cuando lo hubo. Es distinto de
   * `provider_error_code` a propósito: Lusha respondió bien y cobró; lo que falló
   * fue guardar el resultado, y confundir las dos cosas haría ilegible la
   * conciliación del gasto.
   */
  phoneCollectionErrorCode?: string;
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
    metadata: {
      ...metadataDraft,
      ...(args.errorCode ? { provider_error_code: args.errorCode } : {}),
      ...(args.phoneCollection ? { phone_collection: args.phoneCollection } : {}),
      ...(args.phoneCollectionErrorCode
        ? { phone_collection_error_code: args.phoneCollectionErrorCode }
        : {}),
    },
  };
}
