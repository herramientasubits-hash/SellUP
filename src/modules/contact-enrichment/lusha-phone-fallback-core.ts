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
 *
 * ── AGENT2A-PHONE-REVEAL-4O-F ──────────────────────────────────
 *
 * El disparo MANUAL de administración pasa a inyectar esa misma dependencia, así que
 * deja de tirar los teléfonos que la respuesta ya traía —y por los que ya se pagó— y
 * pasa por la MISMA transacción, con las MISMAS reglas de normalización, deduplicación
 * entre proveedores, elección de principal y protección de tombstones. No se duplica ni
 * una regla: lo único que cambia es qué rutas cablean la dep. Sigue siendo UNA llamada
 * al proveedor, UN evento de facturación y UN principal determinista.
 *
 * Y por eso la puerta de privacidad POSTERIOR a la respuesta se evalúa ahora ANTES de
 * bifurcar entre las dos escrituras: la transacción re-comprueba tombstones y supresión
 * por persona bajo el lock, pero no lee `do_not_contact`, así que dejarla dentro de la
 * rama escalar habría hecho que cablear la colección perdiera esa protección en vuelo.
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
  SUPPRESSION_BLOCKED_ERROR_CODE,
  SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
  type PersistTerminalPhoneSuppression,
} from './phone-reveal-suppression-guard';
// Vocabulario del veredicto de la puerta de privacidad (4O-E3). Import de SOLO TIPO:
// el core sigue siendo puro y no arrastra el cliente admin del módulo de la puerta.
import type { PhoneRevealWaterfallSuppressionState } from './phone-reveal-waterfall-core';
import {
  buildLushaPhoneFallbackUsageLogMetadataDraft,
  LUSHA_PHONE_FALLBACK_OPERATION_KEY,
  LUSHA_PHONE_FALLBACK_PROVIDER_KEY,
  type LushaPhoneFallbackUsageLogMetadataDraft,
} from '@/modules/usage-tracking/lusha-phone-fallback-usage-log-draft';
import type { ContactCandidateEnrichmentMetadata, ContactSource } from './types';
import {
  buildPhoneRevealLushaAttemptOutcomeEvent,
  type PhoneRevealLushaAttemptOutcomeEvent,
  type PhoneRevealLushaAttemptResult,
  type PhoneRevealLushaIdentitySource,
} from './phone-reveal-lusha-attempt-diagnostics';

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
  /**
   * Id NATIVO de Lusha ya resuelto por el paso de identidad de ESTA autorización
   * (AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1).
   *
   * POR QUÉ EXISTE. El core del waterfall resuelve la identidad —buscándola y
   * pagándola, o reusando la persistida— y la pasa a la pata como `lushaContactId`.
   * Hasta este hito el ejecutor de la pata NO recibía ese parámetro y su lector del
   * candidato tampoco consultaba `contact_provider_identities`, así que el id
   * recién resuelto se PERDÍA entre los dos módulos: `resolveLushaContactId`
   * devolvía null para todo candidato nacido fuera de Lusha, la elegibilidad
   * fallaba `missing_lusha_contact_id` ANTES de emitir un solo byte, y la corrida
   * se cerraba con el genérico `lusha_reveal_error`. Ese es exactamente el
   * desenlace de la corrida real 2a49e0f7 (identidad resuelta y persistida, reveal
   * en error, 0 peticiones emitidas).
   *
   * SCOPED POR PROVEEDOR EN ORIGEN: sólo lo rellena el resolutor de identidad, que
   * consulta `provider_key = 'lusha'`. Nunca puede transportar un id de Apollo, y
   * por eso no necesita la condición `source === 'lusha'` que sí protege al
   * `source_contact_id` del candidato.
   */
  resolvedLushaContactId?: string;
}

/** Read-only projection of the candidate needed to evaluate + run the fallback. */
export interface LushaPhoneFallbackCandidateRecord {
  id: string;
  /** contact_enrichment_candidates.status raw value (pending_review/approved/discarded/duplicate). */
  status: string | null;
  source: ContactSource | null;
  sourceContactId: string | null;
  /**
   * Id NATIVO de Lusha resuelto y persistido en `contact_provider_identities`
   * (AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1). Solo lo rellena el lector
   * que consulta esa tabla con `provider_key = 'lusha'`, así que por construcción
   * NUNCA puede transportar el id de otro proveedor.
   *
   * Es lo que permite que un candidato nacido en Apollo llegue a la pata de Lusha sin
   * que `source` ni `source_contact_id` cambien de significado.
   */
  lushaProviderContactId?: string | null;
  existingPhone: string | null;
  phoneRevealStatus: string | null;
  phoneRevealAttemptCount: number | null;
  enrichmentMetadata: ContactCandidateEnrichmentMetadata;
  /**
   * AGENT2A-APPROVED-CANDIDATE-LUSHA-LEG — `matched_contacts_id`: el contacto oficial que la
   * aprobación registró. Es lo que permite que un candidato `approved` siga siendo editable PARA
   * TELÉFONO: sin destino registrado no hay dónde proyectar lo que se compraría, y la puerta
   * vuelve a bloquear.
   */
  matchedContactsId?: string | null;
}

// ── Resultado ──────────────────────────────────────────────────

export type LushaPhoneFallbackActionStatus =
  | Exclude<LushaPhoneFallbackEligibilityReasonCode, 'eligible'>
  | 'invalid_candidate'
  | 'candidate_not_found'
  | 'revealed'
  | 'no_phone_found'
  // ── Puerta de privacidad (AGENT2A-PHONE-REVEAL-4O-E3) ────────
  //
  // Vocabulario REUTILIZADO, no inventado: son exactamente los códigos que el
  // webhook, el recovery y la pata Lusha del waterfall ya escriben. Un
  // `manual_suppressed` o un `privacy_block` paralelos harían que el mismo hecho
  // se llamara de dos formas según quién disparara la llamada.
  | typeof SUPPRESSION_BLOCKED_ERROR_CODE
  | 'do_not_contact'
  | typeof SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE
  // ── Contabilidad durable (AGENT2A-PHONE-REVEAL-4O-F-R2) ──────
  //
  // Desde R2 el disparo manual se ejecuta sobre la infraestructura
  // `legacy_lusha_only`: reserva atómica de créditos + corrida real. Eso le da tres
  // desenlaces que ANTES no podía tener, porque antes no había gate presupuestal
  // alguno (auditoría 4O-F-M0: ACCOUNTING sí, ENFORCEMENT no) y la llamada salía
  // directa al proveedor.
  //
  // Vocabulario REUTILIZADO de `LegacyPhoneRevealWaterfallActionStatus`, no inventado:
  // los dos disparos de Lusha nombran el mismo hecho igual. Ninguno se colapsa en
  // `error` ni en un motivo de elegibilidad, porque decirle al operador que el
  // candidato no aplica cuando aplica perfectamente y lo que falta es saldo describe
  // un problema que no tuvo.
  //
  // En los tres: 0 llamadas al proveedor, 0 usage-logs, 0 créditos.
  | 'insufficient_credits'
  | 'budget_not_configured'
  | 'credit_balance_unavailable'
  /**
   * La reserva + corrida atómica no se pudo ejecutar (migración 104 ausente, timeout).
   * Fail-closed, y NUNCA un motivo de elegibilidad: falló la infraestructura.
   */
  | 'infrastructure_unavailable'
  /**
   * Ya hay una operación pagada VIVA para este candidato. Es el desenlace del
   * single-flight: de tres invocaciones concurrentes idénticas, dos aterrizan aquí sin
   * llamar al proveedor. Antes de R2 las tres pagaban.
   */
  | 'already_attempted'
  | 'error';

export interface LushaPhoneFallbackActionResult {
  ok: boolean;
  status: LushaPhoneFallbackActionStatus;
  /** Safe (no-PII) error code when status = 'error'. null otherwise. */
  errorCode: string | null;
  /**
   * ¿Salió una petición HTTP hacia Lusha en esta invocación?
   * (AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1)
   *
   * Es el hecho que la liquidación necesitaba y no tenía. Hasta este hito lo más
   * parecido que existía era el CLAIM de la pata (`lusha_attempted_at`), que se
   * toma ANTES de esta función y por tanto también se toma cuando la pata muere en
   * su propio gate de elegibilidad sin emitir un solo byte. Con esa señal, una
   * corrida que nunca llamó al proveedor confirmaba su reserva al tope
   * (`assumed_cap`) — 5 créditos por una petición inexistente, que es exactamente
   * lo que le pasó a la corrida real 2a49e0f7.
   *
   * `false` NO afirma «el proveedor no cobró» en general: afirma algo más fuerte y
   * comprobable desde este proceso — «no hubo petición que pudiera cobrarse». Un
   * timeout o un error de red SÍ cuentan como emitida (`true`), porque ahí los
   * bytes ya salieron y el cobro es indeterminable desde aquí.
   *
   * OPCIONAL en el tipo para no romper fixtures anteriores al hito; el core la
   * rellena SIEMPRE.
   */
  requestEmitted?: boolean;
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
  /**
   * Emite el diagnóstico estructurado y SIN PII de la pata
   * (AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1).
   *
   * OPCIONAL: sin la dep no se construye ni se emite nada y el comportamiento es
   * exactamente el anterior al hito. Su fallo NUNCA cambia el desenlace: el core lo
   * envuelve en un catch acotado.
   */
  logRevealAttemptOutcome?: (
    event: PhoneRevealLushaAttemptOutcomeEvent,
  ) => Promise<void>;

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
   * Desde AGENT2A-PHONE-REVEAL-4O-F la cablean las TRES rutas que llegan a Lusha:
   * el waterfall completo y la continuación legacy (ambas por `callLushaFallbackLeg`)
   * y el disparo MANUAL de administración (`lusha-phone-fallback-actions.ts`). Las
   * tres pasan por la misma transacción y por las mismas reglas.
   *
   * AUSENTE ⇒ comportamiento anterior intacto, vía `persist`. Se conserva como
   * contrato porque es lo que mantiene el core probable sin base de datos y lo que
   * permite verificar, caso por caso, que la rama escalar no cambió de forma; ninguna
   * ruta de producción lo ejerce ya.
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

  /**
   * Puerta de PRIVACIDAD previa (y posterior) a la llamada
   * (AGENT2A-PHONE-REVEAL-4O-E3).
   *
   * Hasta este hito el disparo MANUAL llamaba a Lusha sin consultar ni la supresión
   * ni `do_not_contact`: la re-comprobación existía solo en el waterfall, así que
   * una persona con DSAR registrada —o marcada como no contactable— se podía revelar
   * igualmente, pagando el crédito. La misma función que ya usa el waterfall
   * (`checkPhoneRevealPrivacyGate`) se cablea ahora aquí, así que las dos rutas
   * aplican LAS MISMAS reglas y la MISMA precedencia.
   *
   * Se consulta DOS veces y por razones distintas:
   *
   *   1. ANTES de `callLusha` — bloquea con 0 llamadas y 0 créditos;
   *   2. DESPUÉS de una respuesta `revealed`, justo antes de escribir el número —
   *      cierra la ventana en la que una DSAR se registra MIENTRAS Lusha responde.
   *      Ahí el crédito YA se gastó: se retiene el número, nunca el cargo.
   *
   * OPCIONAL: sin cablear, el camino queda EXACTAMENTE como antes del hito. La pata
   * del waterfall no la inyecta a propósito — su core ya ejecutó esta misma puerta
   * antes de autorizar la corrida, y su escritura va por la transacción de la
   * migración 113, que vuelve a comprobar la supresión bajo el lock.
   */
  checkPrivacyGate?: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallSuppressionState>;
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
/**
 * Id con el que se le pide el teléfono a Lusha. DOS orígenes, y ninguno de los dos
 * puede ser un id ajeno:
 *
 *   1. la identidad provider-native persistida para `lusha` — resuelta pagando una
 *      búsqueda en una corrida anterior o en esta misma;
 *   2. el `source_contact_id` del propio candidato, SOLO si nació en Lusha.
 *
 * La condición `source === 'lusha'` del segundo caso sigue intacta y sigue siendo la
 * que impide que el id de Apollo se reenvíe a Lusha (HTTP 422 del RCA del reveal
 * asíncrono). El primer caso no la necesita porque su columna ya está scopeada por
 * proveedor en origen.
 */
function resolveLushaContactId(
  candidate: LushaPhoneFallbackCandidateRecord,
  /**
   * Identidad resuelta EN ESTA autorización, inyectada por el core del waterfall.
   * Tiene precedencia sobre la proyectada en el candidato porque es la más
   * reciente: cuando las dos existen describen la misma fila de
   * `contact_provider_identities`, y cuando sólo existe ésta es porque la búsqueda
   * acaba de pagarse en esta misma corrida.
   */
  injectedIdentityId?: string | null,
): { contactId: string | null; source: PhoneRevealLushaIdentitySource } {
  const injected = cleanText(injectedIdentityId ?? null);
  if (injected) return { contactId: injected, source: 'run_identity_search' };

  const resolvedIdentity = cleanText(candidate.lushaProviderContactId ?? null);
  if (resolvedIdentity) {
    return { contactId: resolvedIdentity, source: 'persisted_identity' };
  }

  if (candidate.source !== 'lusha') return { contactId: null, source: 'none' };
  const native = cleanText(candidate.sourceContactId);
  return native
    ? { contactId: native, source: 'candidate_native' }
    : { contactId: null, source: 'none' };
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
/**
 * Testigo de emisión. Un objeto y no un booleano devuelto porque el cuerpo del core
 * tiene DIEZ puntos de retorno y sellar el hecho en cada uno los volvería a poner de
 * acuerdo a mano — que es la clase de acuerdo que se rompe en el siguiente hito. Aquí
 * el testigo se marca en el ÚNICO punto donde puede ser cierto (la línea que llama al
 * proveedor) y el envoltorio lo estampa una sola vez sobre cualquier resultado.
 */
interface LushaPhoneFallbackEmissionWitness {
  emitted: boolean;
  /** De dónde salió el id nativo. `none` hasta que el resolutor decide. */
  identitySource: PhoneRevealLushaIdentitySource;
  /** Status HTTP exacto; el constructor del evento lo degrada a clase. */
  httpStatus: number | null;
  /** Hubo respuesta pero su cuerpo no encaja con ningún contrato conocido. */
  responseUnparseable: boolean;
  /** El proveedor no contestó a tiempo. Los bytes YA salieron. */
  timedOut: boolean;
}

/**
 * Envoltorio que sella `requestEmitted` sobre el resultado del core
 * (AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1). No decide nada más: el contrato
 * observable de `runLushaPhoneFallbackReveal` es el de siempre más ese campo.
 */
export async function runLushaPhoneFallbackReveal(
  input: LushaPhoneFallbackActionInput,
  deps: LushaPhoneFallbackCoreDeps,
): Promise<LushaPhoneFallbackActionResult> {
  const witness: LushaPhoneFallbackEmissionWitness = {
    emitted: false,
    identitySource: 'none',
    httpStatus: null,
    responseUnparseable: false,
    timedOut: false,
  };
  const result = await runLushaPhoneFallbackRevealInner(input, deps, witness);
  const sealed: LushaPhoneFallbackActionResult = {
    ...result,
    requestEmitted: witness.emitted,
  };

  // Diagnóstico estructurado y SIN PII, emitido desde UN SOLO punto
  // (AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1). Va aquí y no en cada retorno del
  // core justamente porque el core tiene diez: sellarlo en cada uno los volvería a
  // poner de acuerdo a mano, y el camino que se olvidara sería el próximo
  // `lusha_reveal_error` sin explicación.
  //
  // Best-effort ACOTADO: un diagnóstico que falla no puede cambiar el desenlace de una
  // operación pagada ni convertir un reveal exitoso en un error.
  if (deps.logRevealAttemptOutcome) {
    try {
      await deps.logRevealAttemptOutcome(
        buildPhoneRevealLushaAttemptOutcomeEvent({
          requestEmitted: witness.emitted,
          httpStatus: witness.httpStatus,
          providerErrorCode: sealed.errorCode ?? null,
          responseUnparseable: witness.responseUnparseable,
          identitySource: witness.identitySource,
          creditsReported:
            sealed.costSource === 'reported' &&
            typeof sealed.creditsCharged === 'number'
              ? sealed.creditsCharged
              : null,
          costTruth: sealed.costSource ?? 'unknown',
          result: resolveAttemptResult(sealed.status, witness),
        }),
      );
    } catch {
      // Silencio acotado y deliberado, misma convención que el sello de auditoría de
      // la búsqueda de identidad.
    }
  }

  return sealed;
}

/**
 * Desenlace del intento, en el vocabulario del diagnóstico. `timeout` sale del testigo
 * y no del status porque el core lo colapsa —correctamente— en el mismo
 * `provider_network_error` que una red caída: para el CANDIDATO son lo mismo, para
 * quien depura no.
 */
function resolveAttemptResult(
  status: LushaPhoneFallbackActionStatus,
  witness: LushaPhoneFallbackEmissionWitness,
): PhoneRevealLushaAttemptResult {
  if (status === 'revealed') return 'revealed';
  if (status === 'no_phone_found') return 'no_phone';
  if (witness.timedOut) return 'timeout';
  return 'error';
}

async function runLushaPhoneFallbackRevealInner(
  input: LushaPhoneFallbackActionInput,
  deps: LushaPhoneFallbackCoreDeps,
  witness: LushaPhoneFallbackEmissionWitness,
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
  const identity = resolveLushaContactId(candidate, input.resolvedLushaContactId);
  const lushaContactId = identity.contactId;
  witness.identitySource = identity.source;
  const eligibility = evaluateLushaPhoneFallbackEligibility({
    candidateStatus: candidate.status,
    // Neither column exists on contact_enrichment_candidates today — the gate
    // treats absence as "no terminal review/archive state", which matches the
    // real schema (see lusha-phone-fallback-eligibility.ts doc comment).
    candidateReviewStatus: null,
    candidateArchivedAt: null,
    // AGENT2A-APPROVED-CANDIDATE-LUSHA-LEG: el destino registrado por la aprobación. `undefined`
    // (un lector que aún no lo trae) se normaliza a `null`, que es fail-closed sobre un candidato
    // aprobado — nunca abre la puerta por omisión.
    officialContactId: candidate.matchedContactsId ?? null,
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

  // 6b. PUERTA DE PRIVACIDAD, ANTES de la llamada (4O-E3).
  //
  // Va después del gate canónico —que es puro y no hace I/O, así que comprobarlo
  // primero no cuesta nada— y ANTES de cualquier contacto con el proveedor. El
  // efecto de un bloqueo aquí es exacto: 0 llamadas a Lusha, 0 créditos, 0
  // mutaciones del candidato. No se escribe ningún estado terminal: la señal que
  // impide el siguiente intento es el tombstone DURADERO en sí, que esta misma
  // puerta vuelve a leer, no un rastro que haya que recordar escribir.
  //
  // Precedencia (documentada en phone-reveal-privacy-gate.ts): do_not_contact gana a
  // la supresión. Las dos bloquean por igual y con el mismo costo — cero —, así que
  // lo único que decide el orden es qué etiqueta se registra, y es SIEMPRE la misma.
  if (deps.checkPrivacyGate) {
    const gate = await deps.checkPrivacyGate(candidateId);
    if (gate !== 'clear') {
      const blockedStatus =
        gate === 'do_not_contact'
          ? 'do_not_contact'
          : gate === 'blocked_suppressed'
            ? SUPPRESSION_BLOCKED_ERROR_CODE
            : SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE;
      await deps.logUsage(
        buildUsageLogEntry({
          candidateId,
          actorId: deps.actor.internalUserId,
          actorRole: deps.actor.roleKey,
          // `check_unavailable` es un fallo de lectura y se registra como error;
          // los otros dos no fallaron: se rehusaron, que es un desenlace correcto.
          usageStatus:
            gate === 'check_unavailable' ? 'error' : 'success',
          // 0 y no null: null significa «no se sabe cuánto costó». Aquí se sabe con
          // certeza, porque no se llamó al proveedor.
          creditsUsed: 0,
          costSource: 'reported',
          errorCode: blockedStatus,
          waterfallId: deps.phoneRevealWaterfallId,
        }),
      );
      return {
        ...fail(blockedStatus, blockedStatus),
        creditsCharged: 0,
        costSource: 'reported',
      };
    }
  }

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
  // ÚNICO punto del core en el que unos bytes salen hacia Lusha. El testigo se marca
  // ANTES del await a propósito: si `callLusha` lanza o expira, la petición YA se
  // emitió y el costo es indeterminable — no inexistente.
  witness.emitted = true;
  const result = await deps.callLusha({ contactId });

  // Hechos observables de la respuesta, sellados en el testigo para el diagnóstico.
  // Ninguno es PII: un status, dos booleanos.
  if (result.ok) {
    witness.httpStatus = result.httpStatus;
    witness.responseUnparseable = result.errorCode === 'malformed_provider_response';
  } else if (result.failureKind === 'preflight') {
    // El cliente rechazó ANTES del fetch: no salieron bytes. Se corrige el testigo,
    // que se había marcado de forma optimista en la línea de la llamada.
    witness.emitted = false;
  } else {
    witness.timedOut = result.failureKind === 'timeout';
  }

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

  // ── Puerta de privacidad, DESPUÉS de la respuesta (4O-E3) ──────
  //
  // La llamada a Lusha es síncrona pero no instantánea, y una DSAR registrada
  // MIENTRAS el proveedor respondía dejaría el número borrado de vuelta en el campo
  // visible. Se vuelve a leer el estado duradero justo antes de escribir NADA.
  //
  // AGENT2A-PHONE-REVEAL-4O-F — esta puerta se evalúa ANTES de bifurcar entre la
  // escritura transaccional de la colección y el UPDATE escalar, y no dentro de una
  // sola de las dos ramas. La transacción (migraciones 111 + 113) vuelve a comprobar,
  // bajo el lock, los tombstones POR NÚMERO y la supresión POR PERSONA, pero NO lee
  // `do_not_contact`: dejar la puerta después de la bifurcación haría que cablear la
  // colección en el disparo manual perdiera, en silencio, la protección de
  // `do_not_contact` en vuelo que 4O-E3 añadió a este mismo camino.
  //
  // Para la pata del waterfall esto es un no-op EXACTO: no inyecta `checkPrivacyGate`
  // —su core ya ejecutó esta misma puerta antes de autorizar la corrida— así que el
  // bloque entero sigue sin ejecutarse allí.
  //
  // El crédito YA se gastó. Lo que se retiene es el NÚMERO, nunca el cargo: el
  // usage-log de abajo lleva los créditos REALES que Lusha reportó, y en el caso de
  // supresión el cierre terminal deja el rastro sin tocar las columnas de costo del
  // candidato —que describen el reveal de la pata anterior— tal y como fijó 4O-E1.
  if (deps.checkPrivacyGate) {
    const gateAfter = await deps.checkPrivacyGate(candidateId);
    if (gateAfter !== 'clear') {
      const blockedStatus =
        gateAfter === 'do_not_contact'
          ? 'do_not_contact'
          : gateAfter === 'blocked_suppressed'
            ? SUPPRESSION_BLOCKED_ERROR_CODE
            : SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE;

      // Solo la supresión CONFIRMADA deja rastro terminal: es un veredicto de
      // privacidad definitivo y es lo que saca al candidato del estado que lo hace
      // elegible para otro reveal pagado. Un `do_not_contact` o una lectura que
      // falló no afirman eso, así que no cierran nada — el siguiente intento lo para
      // la puerta PREVIA, con 0 créditos.
      if (gateAfter === 'blocked_suppressed') {
        await applyTerminalPhoneSuppression({
          candidateId,
          persist: deps.persistTerminalSuppression,
          patch: buildTerminalPhoneSuppressionPatch({
            // Mismo token de pertenencia que usa la transacción: la fila tiene que
            // seguir en el estado que autorizó este intento. Vacío ⇒ no se escribe.
            expectedStatuses: cleanText(candidate.phoneRevealStatus)
              ? [candidate.phoneRevealStatus as string]
              : [],
            nowIso: deps.nowIso,
          }),
        });
      }

      await deps.logUsage(
        buildUsageLogEntry({
          candidateId,
          actorId: deps.actor.internalUserId,
          actorRole: deps.actor.roleKey,
          usageStatus: 'success',
          // El gasto REAL, íntegro: la llamada ocurrió y se cobró.
          creditsUsed: result.creditsCharged,
          costSource: result.costSource ?? 'unknown',
          errorCode: blockedStatus,
          waterfallId: deps.phoneRevealWaterfallId,
        }),
      );
      return {
        ...fail(blockedStatus, blockedStatus),
        creditsCharged: result.creditsCharged,
        costSource: result.costSource ?? 'unknown',
      };
    }
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

  // Sin `persistPhoneCollection` cableada: UPDATE escalar de siempre. La puerta de
  // privacidad posterior a la respuesta ya se evaluó ARRIBA, común a las dos ramas.
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
