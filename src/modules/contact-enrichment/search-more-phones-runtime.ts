// Agente 2A — «Buscar más números»: EL RUNTIME
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// ═══════════════════════════════════════════════════════════════════
// ORDEN DE LA SECUENCIA, Y POR QUÉ ES ESE
// ═══════════════════════════════════════════════════════════════════
//
// Barato→caro, fail-closed en cada paso, y NADA que cueste dinero antes de que exista una
// reserva. La secuencia es la MISMA que la ruta `legacy_lusha_only` ya ejecuta —no una
// versión aproximada de ella— y por eso reutiliza sus piezas en vez de copiarlas:
//
//   1. PLAN sobre estado RECARGADO (`readSearchMorePreflight`). El plan que el navegador
//      mostró no se acepta: se vuelve a derivar aquí de los hechos de la base.
//   2. PRESUPUESTO + RESERVA + CORRIDA en UNA transacción
//      (`reserveWaterfallCreditsAndCreateRunOrBlock` → `reserve_and_create_phone_reveal_run`
//      de la migración 104). Sin exposición reservada NO hay corrida, y sin corrida no hay
//      llamada a Lusha, ni usage-log, ni créditos.
//   3. PRIVACIDAD, otra vez (`checkPhoneRevealPrivacyGate`). Ya se resolvió en el paso 1;
//      se vuelve a resolver DESPUÉS de crear la corrida porque entre el preflight y este
//      instante pueden haber pasado minutos y una DSAR registrada en ese hueco tiene que
//      ganar. Bloquea ⇒ 0 llamadas y la corrida se cierra `aborted`.
//   4. CLAIM ATÓMICO de la pata (`claimLushaAttempt`): UN `UPDATE` condicional sobre
//      `lusha_attempted_at IS NULL`. Es la tercera y última barrera de idempotencia, y la
//      única que sobrevive a dos procesos distintos observando la misma corrida.
//   5. UNA llamada a Lusha, por id NATIVO. Sin retry.
//   6. USAGE-LOG. Se escribe SIEMPRE que Lusha se llamó, ANTES de intentar persistir, y
//      fuera de la transacción de la 122 precisamente para sobrevivir a un fallo de ésta.
//   7. APPEND (`append_candidate_search_more_phones`, migración 122). Re-comprueba la
//      supresión por PERSONA bajo el lock: si bloquea ahí, el NÚMERO se retiene y el COSTO
//      se conserva ENTERO.
//   8. CIERRE de la corrida con el patch del clasificador puro. El `updateWaterfallRun`
//      compartido dispara la LIQUIDACIÓN de la reserva por el mismo camino que el resto del
//      subsistema.
//
// ═══════════════════════════════════════════════════════════════════
// LAS TRES BARRERAS DE IDEMPOTENCIA, Y NINGUNA NUEVA
// ═══════════════════════════════════════════════════════════════════
//
// Dos clics, un reintento del navegador o un replay de red NO pueden producir dos llamadas a
// Lusha. Eso ya está garantizado por primitivas que existen, y no se añade un cuarto sistema:
//
//   * `authorization_key` — se genera ANTES de la operación y la capa de I/O reenvía la
//     MISMA en su único reintento. Una respuesta perdida tras el COMMIT devuelve
//     `already_created`, no una segunda autorización;
//   * ÍNDICE ÚNICO PARCIAL de corrida activa por candidato (migración 102) — vive DENTRO de
//     la transacción, así que la segunda invocación es rechazada ANTES de pagar, no después.
//     Se traduce a `active_run_exists`, y esa rama NO libera nada: la exposición que
//     encontró pertenece a la corrida que ganó;
//   * CLAIM ATÓMICO — `UPDATE … WHERE lusha_attempted_at IS NULL`. El segundo actualiza 0
//     filas y sale sin llamar a nadie.
//
// ═══════════════════════════════════════════════════════════════════
// LO QUE ESTE MÓDULO NO HACE, NUNCA
// ═══════════════════════════════════════════════════════════════════
//
//   * NO llama a Apollo, ni escribe un usage-log de Apollo, ni inventa `apollo_attempted_at`;
//   * NO usa la búsqueda GENERAL de personas de Lusha. La entrada es el id nativo
//     `source_contact_id` y sólo cuando `source = 'lusha'`. No hay nombre, ni email, ni
//     empresa, ni LinkedIn, ni enlace difuso;
//   * NO reescribe `phone_reveal_provider` / `…_requested_at` / `…_completed_at` /
//     `…_cost_credits` / `…_cost_source` ni el historial del reveal: esas columnas describen
//     la autorización INICIAL, y la 122 no las toca en ninguna rama;
//   * NO aprueba el candidato, NO escribe en el contacto oficial, NO escribe en HubSpot y NO
//     actúa en lote: la entrada es escalar, así que no hay forma de pedir un batch;
//   * NO reintenta la llamada al proveedor.
//
// PRIVACIDAD: no imprime teléfono, email, nombre, LinkedIn, id de contacto de proveedor ni
// API key. Sólo códigos mecánicos y el mensaje recortado del driver.

import {
  isLushaPhoneRevealFallbackEnabled,
  resolveLushaSearchTimeoutMs,
} from '@/lib/feature-flags.server';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import { enrichLushaContactPhonesForFallback } from '@/server/integrations/lusha-phone-fallback-client';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { readPhoneRevealCreditPools } from './phone-reveal-credit-budget-deps';
import { reservePhoneRevealCreditsAndCreateRun } from './phone-reveal-credit-reservation-deps';
import { checkPhoneRevealPrivacyGate } from './phone-reveal-privacy-gate';
import {
  reserveWaterfallCreditsAndCreateRunOrBlock,
  type PhoneRevealWaterfallLushaOutcome,
  type PhoneRevealWaterfallRunDraft,
} from './phone-reveal-waterfall-core';
import {
  claimLushaAttempt,
  updateWaterfallRun,
} from './phone-reveal-waterfall-deps';
import { buildCandidatePrimaryPhoneCandidates } from './candidate-phone-collection-writer';
import { buildLushaPhoneCollectionCapture } from './lusha-phone-collection-capture';
import { appendCandidateSearchMorePhones } from './candidate-search-more-phone-append-persistence';
import { readSearchMorePreflight } from './search-more-phones-read';
import {
  resolveSearchMoreOutcome,
  type SearchMoreOutcome,
  type SearchMorePersistStatus,
  type SearchMoreProviderCallOutcome,
} from './search-more-phones-core';
import {
  SEARCH_MORE_MAX_CREDITS,
  type SearchMoreIneligibleReason,
} from './search-more-phones-planner';

/** `operation_key` PROPIO. Nunca se mezcla con el del reveal ni con el de Apollo. */
export const SEARCH_MORE_LUSHA_OPERATION_KEY = 'contact_phone_search_more';

/**
 * Desenlace del runtime. `not_started` cubre TODO lo que ocurrió antes de que existiera una
 * corrida: en esos caminos hay 0 llamadas, 0 reservas confirmadas y 0 créditos, y el motivo
 * dice cuál de ellos fue.
 */
export type SearchMoreRuntimeOutcome =
  | 'new_phones_found'
  | 'no_new_phones'
  | 'privacy_blocked'
  | 'provider_error'
  /** Otro disparador ya tomó la pata de esta corrida. 0 llamadas nuevas. */
  | 'already_attempted'
  /** No se creó corrida. Ver `reason`. */
  | 'not_started';

export interface SearchMoreRuntimeResult {
  readonly outcome: SearchMoreRuntimeOutcome;
  /** Código mecánico PII-free. `null` en los caminos que terminaron bien. */
  readonly reason: string | null;
  /** Tope que quedó autorizado (5), o `null` si no se creó corrida. */
  readonly maxCreditsAuthorized: number | null;
  /** Cuántos números ADICIONALES se añadieron. 0 en todo lo que no sea éxito. */
  readonly newDistinctPhoneCount: number;
  /**
   * El desenlace que se ESCRIBIÓ en `lusha_outcome`. `null` cuando la pata nunca se
   * intentó.
   *
   * Viaja hasta el llamador porque es el ÚNICO dato que separa los dos casos que producen
   * «0 números nuevos», y separarlos es todo el punto del vocabulario de la 122:
   *
   *   * `no_phone_found`        — Lusha contestó y NO tiene teléfono para esa persona;
   *   * `no_new_distinct_phone` — Lusha contestó, se le COBRÓ, y todos sus números ya
   *                               estaban guardados.
   *
   * Sin este campo la UI tendría que adivinar, y adivinar mal significa decirle al operador
   * «no encontramos números en Lusha» cuando Lusha sí los tiene — son los que ya ve.
   *
   * Es PII-free: un valor de un vocabulario cerrado de cuatro cadenas.
   */
  readonly lushaOutcome: PhoneRevealWaterfallLushaOutcome | null;
  /** true SÓLO si se llegó a llamar a Lusha. Es lo que auditan los tests de gasto. */
  readonly lushaCalled: boolean;
}

const NOT_STARTED = (reason: string): SearchMoreRuntimeResult => ({
  outcome: 'not_started',
  reason,
  maxCreditsAuthorized: null,
  newDistinctPhoneCount: 0,
  lushaOutcome: null,
  lushaCalled: false,
});

/**
 * Cierra la corrida y devuelve el resultado del runtime.
 *
 * `updateWaterfallRun` es el ÚNICO paso por el que pasan todos los cierres del subsistema, y
 * por eso es donde ya está enganchada la reconciliación de la reserva: un patch TERMINAL
 * dispara la liquidación pata por pata (costo reportado ⇒ confirm con esa cifra; costo
 * desconocido ⇒ confirm con el TOPE, nunca 0 y nunca release; pata no intentada ⇒ release).
 * Al reusarlo, «liquidar sin fallo silencioso» no es código nuevo de este hito: es la
 * propiedad que ese camino ya tiene.
 */
async function closeRunWith(
  runId: string,
  outcome: SearchMoreOutcome,
  reason: string | null,
): Promise<SearchMoreRuntimeResult> {
  await updateWaterfallRun(runId, outcome.patch);
  return {
    outcome: outcome.result,
    reason,
    maxCreditsAuthorized: SEARCH_MORE_MAX_CREDITS,
    newDistinctPhoneCount: outcome.newDistinctPhoneCount,
    // Se LEE del patch que acaba de escribirse, no se vuelve a derivar: así lo que el
    // llamador recibe y lo que el ledger guarda no pueden discrepar.
    lushaOutcome: outcome.patch.lushaOutcome ?? null,
    // Todo lo que llega a un `SearchMoreOutcome` ocurrió DESPUÉS del claim, así que Lusha se
    // llamó — con una excepción: el bloqueo de privacidad PREVIO, que no pasa por aquí.
    lushaCalled: true,
  };
}

/**
 * EJECUTA una corrida `search_more` para UN candidato.
 *
 * Puede gastar hasta 5 créditos de LUSHA, y sólo si todos los gates pasan. Nunca gasta
 * créditos de Apollo: la modalidad reserva exclusivamente el pozo de Lusha.
 */
export async function executeSearchMorePhonesForCandidate(args: {
  candidateId: string;
  actor: { internalUserId: string; roleKey: string | null };
}): Promise<SearchMoreRuntimeResult> {
  const { candidateId, actor } = args;

  // El permiso de PRODUCTO es el del fallback de Lusha, que es el kill switch real de
  // cualquier reveal de Lusha. NO se lee `ENABLE_PHONE_REVEAL_WATERFALL`: ese flag gobierna
  // la UX del waterfall Apollo→Lusha, no la existencia de esta operación — la misma
  // distinción que fijó 4O-F-R2.
  const featureEnabled = isLushaPhoneRevealFallbackEnabled();

  // ── 1. PLAN sobre estado RECARGADO ───────────────────────────
  // Lo que el navegador envió NO participa: ni el proveedor, ni el techo, ni el id nativo,
  // ni el estado de privacidad. Todo sale de la base, ahora.
  let preflight: Awaited<ReturnType<typeof readSearchMorePreflight>>;
  try {
    preflight = await readSearchMorePreflight({
      candidateId,
      featureEnabled,
      actorRoleKey: actor.roleKey,
    });
  } catch (err) {
    // FAIL-CLOSED. Una lectura que falló no autoriza nada, y se registra como fallo de
    // infraestructura y NO como «no elegible»: el candidato puede aplicar perfectamente.
    console.error(
      '[search-more-phones] preflight read failed, failing closed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return NOT_STARTED('preflight_unavailable');
  }

  const { facts, summary } = preflight;
  if (!summary.plan.eligible) {
    return NOT_STARTED(
      (summary.plan.reason ?? 'not_eligible') satisfies
        | SearchMoreIneligibleReason
        | 'not_eligible',
    );
  }

  // El id nativo se resuelve del ESTADO RECARGADO, y el plan ya garantizó que existe. Se
  // vuelve a comprobar porque de aquí sale el único argumento que viaja a Lusha, y un
  // `null` colándose se traduciría en una llamada sin identidad.
  const lushaContactId = facts.sourceContactId;
  if (!lushaContactId) {
    return NOT_STARTED('missing_person_identity');
  }

  // ── 2. PRESUPUESTO + RESERVA + CORRIDA, en UNA transacción ───
  const nowIso = new Date().toISOString();
  const buildRun = (
    reservationGroupId: string,
  ): PhoneRevealWaterfallRunDraft => ({
    candidateId,
    // `lusha_pending` y no `authorized`: es uno de los dos estados desde los que
    // `claimLushaAttempt` acepta el claim (`PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES`).
    // Nacer en `authorized` dejaría la corrida viva y la pata inalcanzable.
    status: 'lusha_pending',
    runMode: 'search_more',
    authorizedAt: nowIso,
    authorizedBy: actor.internalUserId,
    authorizedByRole: actor.roleKey,
    maxCreditsAuthorized: SEARCH_MORE_MAX_CREDITS,
    // Apollo NO se ejecuta bajo esta autorización: su timestamp no se inventa. Y a
    // diferencia de la modalidad legacy, tampoco se transcribe un `apollo_outcome`
    // histórico: aquí no hay ninguno que demostrar — el candidato tiene teléfono, no un
    // `no_phone_found`. Las dos claves se OMITEN en vez de viajar como null.
    apolloAttemptedAt: null,
    lushaEligible: true,
    lushaSkippedReason: null,
    creditReservationGroupId: reservationGroupId,
  });

  let gate: Awaited<ReturnType<typeof reserveWaterfallCreditsAndCreateRunOrBlock>>;
  try {
    gate = await reserveWaterfallCreditsAndCreateRunOrBlock({
      // SÓLO el pozo de Lusha se lee y sólo el de Lusha se ocupa. El presupuesto de Apollo
      // no puede bloquear esta operación ni quedar reservado por ella.
      mode: 'search_more_lusha',
      candidateId,
      authorizedBy: actor.internalUserId,
      deps: {
        readCreditPools: (providerKeys) =>
          readPhoneRevealCreditPools(providerKeys, actor.internalUserId),
        reserveCreditsAndCreateRun: ({ reservation, run }) =>
          reservePhoneRevealCreditsAndCreateRun({
            reservation,
            run: {
              status: run.status,
              run_mode: run.runMode,
              authorized_at: run.authorizedAt,
              authorized_by_role: run.authorizedByRole,
              max_credits_authorized: run.maxCreditsAuthorized,
              apollo_attempted_at: run.apolloAttemptedAt,
              lusha_eligible: run.lushaEligible,
              lusha_skipped_reason: run.lushaSkippedReason,
            },
          }),
        newReservationGroupId: () => crypto.randomUUID(),
        // La clave de idempotencia de ESTA autorización. Se genera antes de la operación:
        // es la condición para que el reintento de la capa de I/O sea idempotente en vez de
        // una segunda autorización.
        newAuthorizationKey: () => crypto.randomUUID(),
      },
      buildRun,
    });
  } catch (err) {
    console.error(
      '[search-more-phones] run creation failed, failing closed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return NOT_STARTED('run_creation_unavailable');
  }

  if (!gate.started) {
    // NINGUNA de estas ramas libera nada, y eso es correcto en las dos direcciones: si la
    // reserva no se escribió no hay nada que liberar, y si `active_run_exists` la exposición
    // que se encontró pertenece a la corrida que ganó la carrera — liberarla dejaría a la
    // corrida viva con su gasto autorizado y sin respaldo.
    return NOT_STARTED(gate.reason);
  }

  const runId = gate.runId;

  // ── 3. PRIVACIDAD, otra vez y bajo un reloj nuevo ────────────
  // Fail-closed: `check_unavailable` bloquea IGUAL que un tombstone confirmado, pero se
  // registra distinto. La corrida se cierra `aborted` y la liquidación libera la reserva
  // porque la pata nunca se intentó (`lusha_attempted_at IS NULL`): 0 llamadas, 0 créditos.
  const privacy = await checkPhoneRevealPrivacyGate(candidateId);
  if (privacy !== 'clear') {
    await updateWaterfallRun(runId, {
      status: 'aborted',
      lushaSkippedReason: 'suppressed',
      finalProvider: 'none',
      errorCode:
        privacy === 'check_unavailable'
          ? 'suppression_check_unavailable'
          : privacy === 'do_not_contact'
            ? 'do_not_contact'
            : 'blocked_suppressed',
      completedAt: new Date().toISOString(),
    });
    return {
      outcome: 'privacy_blocked',
      reason: privacy,
      maxCreditsAuthorized: SEARCH_MORE_MAX_CREDITS,
      newDistinctPhoneCount: 0,
      // La pata NUNCA se intentó, así que no hay desenlace de Lusha que reportar. `null` y
      // no `error`: `error` afirmaría una llamada que no salió.
      lushaOutcome: null,
      lushaCalled: false,
    };
  }

  // ── 4. CLAIM ATÓMICO ────────────────────────────────────────
  let claimed: boolean;
  try {
    claimed = await claimLushaAttempt(runId);
  } catch (err) {
    // No se sabe si el claim quedó sellado, así que NO se llama a Lusha. La corrida se deja
    // como está: la reconciliación de huérfanas y el TTL de 24 h la recogen.
    console.error(
      '[search-more-phones] lusha claim failed, provider not called:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return {
      outcome: 'not_started',
      reason: 'claim_unavailable',
      maxCreditsAuthorized: SEARCH_MORE_MAX_CREDITS,
      newDistinctPhoneCount: 0,
      lushaOutcome: null,
      lushaCalled: false,
    };
  }
  if (!claimed) {
    // Otro disparador ya la tomó. No se llama, no se escribe y NO se cierra la corrida: es
    // suya, y cerrarla le robaría el cierre al que sí está pagando.
    return {
      outcome: 'already_attempted',
      reason: 'lusha_claim_lost',
      maxCreditsAuthorized: SEARCH_MORE_MAX_CREDITS,
      newDistinctPhoneCount: 0,
      lushaOutcome: null,
      lushaCalled: false,
    };
  }

  // ── 5. UNA llamada a Lusha, por id NATIVO ───────────────────
  const apiKey = await getLushaApiKey();
  if (!apiKey) {
    // La clave falta: NO se llamó a nadie, así que no hay costo. Se cierra como error y la
    // liquidación confirma con el TOPE, porque el claim ya selló `lusha_attempted_at` y el
    // core de liquidación no puede saber, desde la fila, que la llamada no salió. Es la
    // dirección CONSERVADORA: se sobreestima la ocupación, nunca se regala.
    return closeRunWith(
      runId,
      resolveSearchMoreOutcome({
        providerOutcome: 'error',
        persistStatus: null,
        newDistinctPhoneCount: 0,
        costCredits: null,
        nowIso: new Date().toISOString(),
      }),
      'lusha_api_key_missing',
    ).then((result) => ({ ...result, lushaCalled: false }));
  }

  // `enrichLushaContactPhonesForFallback` es la ÚNICA vía sancionada, y es de ENRIQUECIMIENTO
  // POR ID: `POST /v3/contacts/enrich` con el id nativo. NO existe aquí ninguna llamada a la
  // búsqueda general de personas de Lusha, y por eso este módulo no importa su cliente.
  const response = await enrichLushaContactPhonesForFallback({
    apiKey,
    timeoutMs: resolveLushaSearchTimeoutMs(),
    contactId: lushaContactId,
    allowPhoneReveal: true,
  });

  // ── 6. USAGE-LOG ────────────────────────────────────────────
  // Se escribe SIEMPRE que la llamada salió, y ANTES de persistir: vive fuera de la
  // transacción de la 122 precisamente para sobrevivir a un fallo de ésta. Es lo que impide
  // que un cobro real desaparezca del ledger porque la escritura posterior falló.
  //
  // ── EL DESENLACE NO SE INFIERE DEL NÚMERO DE TELÉFONOS ───────
  //
  // `ok: false` cubre SÓLO el timeout y el error de red. TODA respuesta HTTP —incluidos
  // 402, 429, 401, 403, 404 y 5xx— vuelve con `ok: true`, `phones: []` y un MAPEO que
  // declara `candidateStatus: 'error'` con su `errorCode`.
  //
  // Así que leer `phones.length === 0` como «Lusha no tiene teléfono» registraría un 429 o
  // un 5xx como `no_phone_found`. Eso es exactamente la mentira que §10 prohíbe —afirmaría
  // un hecho sobre la PERSONA a partir de un fallo de TRANSPORTE— y además agotaría a Lusha
  // para ese candidato (§18), retirando el CTA para siempre por una caída pasajera.
  //
  // El veredicto lo da el clasificador (`mapLushaPhoneRevealResponseToInternalStatus`), que
  // ya distingue las nueve situaciones. Aquí sólo se traduce.
  const providerFailed = !response.ok || response.candidateStatus === 'error';
  const creditsCharged = response.ok ? response.creditsCharged : null;
  await logSearchMoreUsage({
    candidateId,
    runId,
    actor,
    // `usageStatus` del clasificador cuando la respuesta llegó: distingue `rate_limited` y
    // `quota_exceeded` de un `error` genérico, que es la granularidad que el ledger ya tiene
    // para esta pata y que colapsar aquí perdería.
    usageStatus: response.ok ? response.usageStatus : 'error',
    creditsCharged,
    // El código REAL del proveedor (`rate_limited`, `insufficient_credits`,
    // `provider_auth_error`…) y no un `provider_error` genérico. Sin esto, diagnosticar por
    // qué falló una compra exigiría leer los logs de Lusha.
    errorCode: response.ok
      ? response.errorCode
      : 'provider_network_error',
  });

  if (providerFailed) {
    // `error` y NO `no_phone_found`: ni un fallo de red ni un 429 ni un 5xx son evidencia de
    // que Lusha no tenga teléfono para esa persona, y registrarlo como tal mentiría en el
    // ledger Y agotaría la fuente por un motivo que no lo justifica.
    return closeRunWith(
      runId,
      resolveSearchMoreOutcome({
        providerOutcome: 'error',
        persistStatus: null,
        newDistinctPhoneCount: 0,
        // El costo se conserva tal como lo reportó el proveedor. En 402 y 429 el mapeo deja
        // `costSource: null` porque nada se cobró, pero no se fuerza un 0 aquí: la
        // liquidación decide, y su regla —desconocido ⇒ el TOPE— es la conservadora.
        costCredits: creditsCharged,
        nowIso: new Date().toISOString(),
      }),
      response.ok ? (response.errorCode ?? 'provider_error') : 'provider_network_error',
    );
  }

  const providerOutcome: SearchMoreProviderCallOutcome =
    response.phones.length > 0 ? 'revealed' : 'no_phone_found';

  if (providerOutcome === 'no_phone_found') {
    // Lusha contestó y no tiene teléfono. NO se llama a la 122: no hay nada que añadir, y
    // fabricar un `no_incoming_phones` que la base nunca produjo sería inventar un hecho.
    // El costo se registra igual — contestar «no tengo» también se cobra.
    return closeRunWith(
      runId,
      resolveSearchMoreOutcome({
        providerOutcome: 'no_phone_found',
        persistStatus: null,
        newDistinctPhoneCount: 0,
        costCredits: creditsCharged,
        nowIso: new Date().toISOString(),
      }),
      null,
    );
  }

  // ── 7. COLECCIÓN + APPEND ───────────────────────────────────
  // La captura la construye el MISMO `buildLushaPhoneCollectionCapture` que usa el reveal:
  // TODOS los teléfonos de la respuesta (no sólo el primero), el mismo número en varios
  // formatos colapsado en UNA fila canónica, el mismo ranking de tipos, y `source_event_key`
  // sin la posición en el array — para que un reordenamiento de Lusha entre dos intentos no
  // fabrique procedencias nuevas.
  const observedAt = new Date().toISOString();
  const capture = buildLushaPhoneCollectionCapture({
    phones: response.phones,
    // El escalar que el cliente ya eligió por RANKING de tipo, no por posición.
    primary:
      response.phoneNumber !== null
        ? {
            number: response.phoneNumber,
            phoneType: response.phoneType,
            rawType: response.phoneRawType,
          }
        : null,
    context: {
      waterfallRunId: runId,
      // El id de la reserva no viaja hasta aquí: la liquidación la resuelve por
      // `credit_reservation_group_id` de la corrida. `null` en vez de inventar una
      // correlación, misma convención que la captura del otro proveedor.
      reservationId: null,
      // El usage-log ya se escribió, pero `logProviderUsage` no devuelve su id, así que no
      // se puede correlacionar por fila. `null` es el dato honesto; la corrida es la
      // correlación que sí existe.
      providerUsageLogId: null,
      observedAt,
    },
  });

  let persistStatus: SearchMorePersistStatus;
  let newDistinct = 0;
  try {
    const written = await appendCandidateSearchMorePhones({
      candidateId,
      observedAt,
      phones: capture.phones,
      primaryCandidates: buildCandidatePrimaryPhoneCandidates({
        phones: capture.phones,
        primaryPreference: capture.primaryPreference,
        // `legacyBest` es no-nulo en esta rama: se construyó de una respuesta con al menos
        // un teléfono. El fallback estructural mantiene el tipo honesto sin fabricar nada.
        legacy:
          capture.legacyBest ?? {
            number: response.phoneNumber ?? '',
            type: response.phoneType,
            source: 'lusha_reveal',
            raw_type: response.phoneRawType,
          },
      }),
    });
    persistStatus = written.status;
    newDistinct = written.new_distinct_phone_count;
  } catch (err) {
    // Lusha YA cobró y el usage-log YA está escrito, así que el gasto está a salvo. Lo que
    // no se hace es afirmar un desenlace de datos que no se obtuvo.
    console.error(
      '[search-more-phones] append failed, spend already recorded:',
      err instanceof Error ? err.message : 'unknown error',
    );
    persistStatus = 'unavailable';
  }

  // ── 8. CIERRE ───────────────────────────────────────────────
  // El clasificador PURO decide qué se AFIRMA. Aquí es donde `no_new_distinct_phone` nace:
  // `persisted` con `new_distinct_phone_count = 0` significa que Lusha contestó, se le
  // cobró, y todos sus números ya estaban.
  return closeRunWith(
    runId,
    resolveSearchMoreOutcome({
      providerOutcome: 'revealed',
      persistStatus,
      newDistinctPhoneCount: newDistinct,
      costCredits: creditsCharged,
      nowIso: new Date().toISOString(),
    }),
    persistStatus === 'suppressed' ? 'blocked_suppressed' : null,
  );
}

/**
 * Escribe el usage-log de la pata.
 *
 * `operation_key` PROPIO (`contact_phone_search_more`): nunca se mezcla con el del reveal de
 * Lusha ni con el `person_phone_reveal` de Apollo, así que los créditos de esta operación
 * quedan en filas separadas y jamás sumados a los de otra. `phone_reveal_waterfall_id` en la
 * metadata correlaciona con la corrida REAL, y `computeEffectiveConsumption` deduplica contra
 * la reserva confirmada — una llamada de 5 créditos consume 5, nunca 10.
 *
 * BEST-EFFORT en su fallo: si el log no se puede escribir NO se aborta la operación, porque
 * abortar tampoco devolvería el crédito que Lusha ya cobró. Se registra el fallo sin PII y la
 * liquidación de la reserva sigue siendo la que ocupa el presupuesto.
 */
async function logSearchMoreUsage(args: {
  candidateId: string;
  runId: string;
  actor: { internalUserId: string; roleKey: string | null };
  /**
   * Status del clasificador del proveedor, NO un booleano. `rate_limited` y
   * `quota_exceeded` son clases propias en el ledger de esta pata desde
   * LUSHA-PHONE-FALLBACK-1S, y colapsarlas en `error` perdería justo la distinción que
   * permite saber si un fallo fue del plan, del ritmo o del proveedor.
   */
  usageStatus: 'success' | 'error' | 'rate_limited' | 'quota_exceeded';
  creditsCharged: number | null;
  errorCode: string | null;
}): Promise<void> {
  try {
    await logProviderUsage({
      provider_key: 'lusha',
      operation_key: SEARCH_MORE_LUSHA_OPERATION_KEY,
      credits_used: args.creditsCharged ?? undefined,
      status: args.usageStatus,
      error_code: args.errorCode ?? undefined,
      triggered_by: args.actor.internalUserId,
      results_returned: args.usageStatus === 'success' ? 1 : 0,
      metadata: {
        candidate_id: args.candidateId,
        phone_reveal_waterfall_id: args.runId,
        run_mode: 'search_more',
        actor_role: args.actor.roleKey,
      },
    });
  } catch (err) {
    console.error(
      '[search-more-phones] usage log failed, spend still reserved:',
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}
