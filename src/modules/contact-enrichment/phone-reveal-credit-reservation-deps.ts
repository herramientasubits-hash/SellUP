// Agente 2A — Reserva ATÓMICA de créditos del reveal de teléfono: I/O
// (AGENT2A-PHONE-WATERFALL-4E)
//
// Envoltorios de las tres funciones SQL de la migración 104
// (`reserve_and_create_phone_reveal_run`, `confirm_…`, `release_…`). Este módulo NO
// decide nada: el ciclo de vida y la liquidación viven en el core PURO
// (phone-reveal-credit-reservation-core.ts) y la atomicidad vive en el SQL, que es el
// único lugar donde puede existir — serializar disponibilidad exige el lock y la
// relectura dentro de la misma transacción.
//
// Por qué una RPC y no un INSERT desde aquí: entre "leer la exposición del pozo" y
// "escribir la reserva" hay una ventana, y esa ventana es exactamente el agujero que
// este hito cierra. Dos autorizaciones concurrentes con saldo para una sola tienen que
// resolverse en el servidor de base de datos o no se resuelven.
//
// FAIL-CLOSED. Cualquier fallo —función ausente porque la migración 104 no está
// aplicada, error del driver, entrada inválida, respuesta ilegible— se traduce a
// `{ status: 'unavailable' }`, NUNCA a `reserved` y nunca a `insufficient_credits`: no
// se autoriza gasto sobre una reserva que no se sabe si existe, y tampoco se le dice al
// operador que faltan créditos cuando lo que falló fue la comprobación.
//
// Contrato de privacidad heredado: no imprime teléfono / email / linkedin / nombre / id
// de contacto de proveedor / API key ni payload crudo. Solo códigos mecánicos.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type {
  PhoneRevealCreditReservationAndRunOutcome,
  PhoneRevealCreditReservationAndRunRequest,
  PhoneRevealCreditReservationCostTruth,
  PhoneRevealCreditReservationReleaseReason,
  PhoneRevealCreditReservedLeg,
  PhoneRevealCreditReservationStatus,
} from './phone-reveal-credit-reservation-core';
import {
  PHONE_REVEAL_CREDIT_PROVIDER_KEYS,
  type PhoneRevealCreditProviderKey,
} from './phone-reveal-credit-budget-core';

/** Tabla y funciones de la migración 104. service_role-only. */
export const PHONE_REVEAL_CREDIT_RESERVATIONS_TABLE =
  'phone_reveal_credit_reservations';
export const PHONE_REVEAL_CREDIT_CONFIRM_FN = 'confirm_phone_reveal_credits';
export const PHONE_REVEAL_CREDIT_RELEASE_FN = 'release_phone_reveal_credits';
/** 4F: reserva + corrida en UNA transacción. Es el camino de arranque vigente. */
export const PHONE_REVEAL_CREDIT_RESERVE_AND_CREATE_RUN_FN =
  'reserve_and_create_phone_reveal_run';
/**
 * Tabla de corridas (migración 102). Sólo se escribe DIRECTAMENTE en el camino
 * UNBOUNDED (ver `createUnbudgetedRun`); con patas configuradas la escribe la RPC, que
 * es la única que puede hacerlo en la misma transacción que la reserva.
 */
export const PHONE_REVEAL_WATERFALL_RUNS_TABLE = 'phone_reveal_waterfall_runs';

function redactDriverMessage(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : 'unknown error';
}

function toProviderKey(value: unknown): PhoneRevealCreditProviderKey | null {
  return typeof value === 'string' &&
    (PHONE_REVEAL_CREDIT_PROVIDER_KEYS as readonly string[]).includes(value)
    ? (value as PhoneRevealCreditProviderKey)
    : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // `numeric` puede llegar como string desde PostgREST.
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Traduce el envelope jsonb de `reserve_and_create_phone_reveal_run`. Comparte los
 * rechazos con la reserva sola y añade los dos desenlaces que sólo existen cuando la
 * corrida se escribe en la MISMA transacción.
 */
function parseReserveAndRunEnvelope(
  raw: unknown,
): PhoneRevealCreditReservationAndRunOutcome {
  if (!raw || typeof raw !== 'object') {
    return { status: 'unavailable', detail: 'unparseable_response' };
  }
  const envelope = raw as Record<string, unknown>;
  const status = typeof envelope.status === 'string' ? envelope.status : null;
  const runId = typeof envelope.run_id === 'string' ? envelope.run_id : null;
  const groupId =
    typeof envelope.reservation_group_id === 'string'
      ? envelope.reservation_group_id
      : null;

  switch (status) {
    case 'created': {
      const rows = Array.isArray(envelope.reservations) ? envelope.reservations : [];
      const reservations: PhoneRevealCreditReservedLeg[] = [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const entry = row as Record<string, unknown>;
        const id = typeof entry.id === 'string' ? entry.id : null;
        const providerKey = toProviderKey(entry.provider_key);
        const credits = toFiniteNumber(entry.credits_reserved);
        if (!id || !providerKey || credits === null) continue;
        reservations.push({ id, providerKey, creditsReserved: credits });
      }
      // Una creación "exitosa" sin corrida o sin grupo no es una creación: no habría a
      // qué atribuir el gasto del proveedor ni cómo correlacionar la liquidación.
      //
      // 🔴 `reservations.length === 0` YA NO invalida un `created`
      // (AGENT2A-PHONE-REVEAL-NO-BUDGET-RULE-UNLIMITED-1). Una autorización cuyos pozos
      // son todos UNBOUNDED crea corrida y ocupa CERO exposición, así que exigir al
      // menos una fila de reserva convertía el caso legítimo en `unavailable`. Lo que
      // sigue siendo obligatorio es lo que de verdad hace falta aguas abajo: `runId` y
      // `groupId`. Una llamada con patas configuradas sigue devolviendo ≥1 reserva y su
      // liquidación no cambia.
      if (!runId || !groupId) {
        return { status: 'unavailable', detail: 'created_without_rows' };
      }
      return { status: 'created', runId, reservationGroupId: groupId, reservations };
    }

    case 'already_created': {
      // Golpe idempotente. Sin `run_id` no hay corrida que devolver, y afirmar que la
      // autorización ya existe sin poder señalarla dejaría al caller sin nada que usar.
      if (!runId) {
        return { status: 'unavailable', detail: 'already_created_without_run' };
      }
      return { status: 'already_created', runId, reservationGroupId: groupId };
    }

    case 'insufficient_credits':
    case 'budget_not_configured': {
      const rows = Array.isArray(envelope.legs) ? envelope.legs : [];
      const legs = rows
        .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
        .map((row) => ({
          providerKey: typeof row.provider_key === 'string' ? row.provider_key : 'unknown',
          requiredCredits: toFiniteNumber(row.required) ?? 0,
          availableCredits: toFiniteNumber(row.available),
        }));
      return status === 'insufficient_credits'
        ? { status: 'insufficient_credits', legs }
        : { status: 'budget_not_configured', legs };
    }

    case 'already_reserved':
      return { status: 'already_reserved' };

    case 'create_conflict':
      return { status: 'create_conflict' };

    case 'invalid_input':
      return {
        status: 'unavailable',
        detail: typeof envelope.detail === 'string' ? envelope.detail : 'invalid_input',
      };

    default:
      return { status: 'unavailable', detail: 'unknown_status' };
  }
}

const UNIQUE_VIOLATION = '23505';

/**
 * Corrida ya escrita con ESTA clave de autorización. Es la relectura que convierte un
 * 23505 en un hecho comprobado en vez de una suposición.
 *
 * Tres desenlaces, deliberadamente distintos:
 *   * la clave tiene corrida DE ESTE candidato ⇒ golpe idempotente;
 *   * la clave no tiene corrida             ⇒ el conflicto fue de OTRO índice;
 *   * la lectura falla                      ⇒ no se sabe nada. Fail-closed.
 */
async function findRunByAuthorizationKey(
  authorizationKey: string,
): Promise<
  | { ok: true; run: { id: string; candidateId: string; groupId: string | null } | null }
  | { ok: false }
> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
      .select('id, candidate_id, credit_reservation_group_id')
      .eq('authorization_key', authorizationKey)
      .maybeSingle();
    if (error) {
      console.error(
        '[phone-reveal-credit-reservation] authorization key lookup failed:',
        error.message.slice(0, 200),
      );
      return { ok: false };
    }
    const row = (data ?? null) as Record<string, unknown> | null;
    if (!row) return { ok: true, run: null };
    const id = typeof row.id === 'string' ? row.id : null;
    const candidateId =
      typeof row.candidate_id === 'string' ? row.candidate_id : null;
    // Una fila ilegible NO es "no hay fila": afirmar que la clave está libre haría que
    // el caller la tratara como conflicto de otro índice y perdiera la idempotencia.
    if (!id || !candidateId) return { ok: false };
    return {
      ok: true,
      run: {
        id,
        candidateId,
        groupId:
          typeof row.credit_reservation_group_id === 'string'
            ? row.credit_reservation_group_id
            : null,
      },
    };
  } catch (err) {
    console.error(
      '[phone-reveal-credit-reservation] authorization key lookup threw:',
      redactDriverMessage(err),
    );
    return { ok: false };
  }
}

/** Clasifica un 23505 del INSERT de la corrida UNBOUNDED releyendo la clave. */
async function classifyUnbudgetedRunConflict(
  reservation: PhoneRevealCreditReservationAndRunRequest,
): Promise<PhoneRevealCreditReservationAndRunOutcome> {
  const lookup = await findRunByAuthorizationKey(reservation.authorizationKey);
  // Un conflicto que no se puede clasificar NO se traduce a `active_run_exists` ni a
  // `already_created`: los dos serían afirmaciones sobre filas que nadie leyó.
  if (!lookup.ok) {
    return { status: 'unavailable', detail: 'unbudgeted_run_conflict_unverifiable' };
  }
  if (!lookup.run) {
    // La clave está libre ⇒ el índice que reventó fue el de corrida ACTIVA por
    // candidato. Se devuelve `create_conflict` y la clasificación de aguas arriba
    // RELEE la corrida viva; este borde no la afirma
    // (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1).
    return { status: 'create_conflict' };
  }
  if (lookup.run.candidateId !== reservation.candidateId) {
    // La clave identifica UNA autorización de UN candidato. Devolver la corrida de otro
    // le atribuiría a él el gasto de este operador. Mismo veredicto que el core puro.
    return { status: 'unavailable', detail: 'authorization_key_candidate_mismatch' };
  }
  return {
    status: 'already_created',
    runId: lookup.run.id,
    reservationGroupId: lookup.run.groupId,
  };
}

/**
 * Crea la corrida SIN ocupar exposición, porque no hay exposición que ocupar
 * (AGENT2A-PHONE-REVEAL-NO-BUDGET-RULE-UNLIMITED-1).
 *
 * ── CUÁNDO SE LLEGA AQUÍ ──────────────────────────────────────────────────────
 *
 * Sólo cuando `reservation.legs` está VACÍO, y eso sólo pasa cuando NINGÚN proveedor
 * exigido tiene regla de crédito: el constructor de patas omite los pozos
 * `not_configured` y conserva los `unavailable`, así que unas patas vacías son la
 * afirmación "no hay ningún pozo interno contra el que descontar". Un fallo de lectura
 * NO llega hasta aquí: el preflight ya bloqueó con `balance_unavailable`, y si se lo
 * saltara la pata inválida seguiría viva y la RPC la rechazaría.
 *
 * ── POR QUÉ NO PASA POR LA RPC ────────────────────────────────────────────────
 *
 * `reserve_and_create_phone_reveal_run` exige `jsonb_array_length(p_legs) > 0` y su
 * primer paso rechaza cualquier pata sin límite. Llamarla con `[]` devolvería
 * `invalid_input` — es decir, bloquearía exactamente el caso que este hito autoriza —, y
 * fabricar una pata para poder llamarla sería inventar una `budget_rule` que nadie
 * configuró.
 *
 * ── POR QUÉ ESCRIBIR AQUÍ ES SEGURO ──────────────────────────────────────────
 *
 * La RPC existe por ATOMICIDAD entre dos escrituras que compiten por un saldo. Aquí no
 * hay saldo, y por lo tanto no hay nada que serializar:
 *
 *   * no existe disponibilidad configurada que dos autorizaciones puedan sobrevender;
 *   * no se escribe ninguna fila de reserva, así que no puede quedar huérfana;
 *   * el índice único parcial de UNA corrida activa por candidato (migración 102) sigue
 *     siendo el mismo árbitro de la concurrencia;
 *   * `authorization_key` y su índice único (migración 104) siguen dando idempotencia:
 *     un reintento encuentra la corrida en vez de crear una segunda;
 *   * ningún proveedor se llama sin `runId`, así que todo fallo cuesta 0 créditos.
 *
 * Lo que NO se hace aquí, a propósito: no se llama a ningún proveedor, no se escribe un
 * `provider_usage_logs` y no se registra un costo 0. Este camino elimina el TECHO
 * interno, no el precio del proveedor.
 */
async function createUnbudgetedRun(args: {
  reservation: PhoneRevealCreditReservationAndRunRequest;
  run: Record<string, unknown>;
}): Promise<PhoneRevealCreditReservationAndRunOutcome> {
  const { reservation } = args;

  // Sin clave de autorización NO se escribe. La idempotencia de este camino es
  // ENTERAMENTE la clave y su índice único: sin ella, un reintento crearía una segunda
  // corrida en vez de encontrar la primera. Mismo paso 0 que el SQL, que rechaza con
  // `missing_identity` antes de tocar nada.
  if (!reservation.authorizationKey || !reservation.authorizationKey.trim()) {
    return { status: 'unavailable', detail: 'missing_identity' };
  }

  // Las cuatro columnas que en el camino con patas escribe la RPC desde sus propios
  // parámetros (y que por eso NO viajan en `p_run`) se añaden aquí. Van AL FINAL del
  // spread a propósito: la identidad de la autorización sale de la RESERVA, que es la
  // autoridad, y ningún borrador de corrida puede sobrescribirla. Hoy ningún llamador
  // manda esas claves; el orden es la garantía de que seguirá siendo irrelevante.
  const row = {
    ...args.run,
    candidate_id: reservation.candidateId,
    authorized_by: reservation.authorizedBy,
    credit_reservation_group_id: reservation.reservationGroupId,
    authorization_key: reservation.authorizationKey,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
        .insert(row)
        .select('id, credit_reservation_group_id')
        .maybeSingle();
      if (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
          return classifyUnbudgetedRunConflict(reservation);
        }
        console.error(
          '[phone-reveal-credit-reservation] unbudgeted run insert failed, failing closed:',
          error.message.slice(0, 200),
        );
        return { status: 'unavailable', detail: 'unbudgeted_run_insert_error' };
      }
      const inserted = (data ?? null) as Record<string, unknown> | null;
      const runId = typeof inserted?.id === 'string' ? inserted.id : null;
      if (!runId) {
        // Sin id no se puede afirmar que la corrida exista, y sin corrida no hay a qué
        // atribuir el gasto de un proveedor. Mismo fail-closed que el envelope de la RPC.
        return { status: 'unavailable', detail: 'unbudgeted_run_without_id' };
      }
      const groupId =
        typeof inserted?.credit_reservation_group_id === 'string'
          ? inserted.credit_reservation_group_id
          : reservation.reservationGroupId;
      // `reservations: []` es el dato HONESTO: esta autorización no ocupó exposición.
      // El grupo se conserva igualmente porque es un id de correlación durable —une la
      // corrida con su autorización— y no una afirmación de gasto.
      return { status: 'created', runId, reservationGroupId: groupId, reservations: [] };
    } catch (err) {
      // Transporte: el INSERT puede haber hecho COMMIT y la respuesta perderse. El
      // reintento reusa la MISMA `authorization_key`, así que si escribió, el segundo
      // intento choca con su propio índice y sale `already_created` en vez de crear una
      // segunda corrida.
      const lastAttempt = attempt === 1;
      console.error(
        `[phone-reveal-credit-reservation] unbudgeted run insert threw (attempt ${
          attempt + 1
        }/2)${lastAttempt ? ', failing closed' : ', retrying with the same authorization key'}:`,
        redactDriverMessage(err),
      );
      if (lastAttempt) {
        return { status: 'unavailable', detail: 'unbudgeted_run_insert_threw' };
      }
    }
  }

  /* c8 ignore next */
  return { status: 'unavailable', detail: 'unbudgeted_run_insert_threw' };
}

/**
 * Reserva TODAS las patas Y crea la corrida en UNA transacción
 * (AGENT2A-PHONE-WATERFALL-4F).
 *
 * POR QUÉ EL REINTENTO ES SEGURO — Y NECESARIO. El fallo que 4E no podía manejar es la
 * RESPUESTA PERDIDA: la transacción hizo COMMIT y el driver, aun así, lanza. Desde aquí
 * ese caso es indistinguible de "no se ejecutó nada", así que la única salida correcta es
 * volver a llamar con la MISMA `authorizationKey`: si la primera llamada sí escribió, la
 * segunda encuentra la corrida y devuelve `already_created` sin reservar nada; si no
 * escribió, la segunda hace el trabajo. Reintentar SIN la clave sería una segunda
 * autorización, que es justo lo que no puede pasar.
 *
 * Un solo reintento: si el segundo intento también falla en el transporte, el estado
 * sigue siendo desconocido y el fail-closed (`unavailable`) es la respuesta honesta.
 * Ningún proveedor se llama sin `runId`, así que un `unavailable` no cuesta créditos.
 */
export async function reservePhoneRevealCreditsAndCreateRun(args: {
  reservation: PhoneRevealCreditReservationAndRunRequest;
  /** Payload jsonb de la fila de la corrida, ya en nombres de columna. */
  run: Record<string, unknown>;
}): Promise<PhoneRevealCreditReservationAndRunOutcome> {
  const { reservation } = args;

  // UNBOUNDED (AGENT2A-PHONE-REVEAL-NO-BUDGET-RULE-UNLIMITED-1). Cero patas significa
  // que ningún proveedor exigido tiene regla de crédito, así que no hay saldo que
  // reservar ni transacción que serializar: la corrida se crea sola. Ver
  // `createUnbudgetedRun` para por qué eso es seguro y por qué la RPC no sirve aquí.
  if (reservation.legs.length === 0) {
    return createUnbudgetedRun({ reservation, run: args.run });
  }

  const params = {
    p_candidate_id: reservation.candidateId,
    p_authorized_by: reservation.authorizedBy,
    p_authorization_key: reservation.authorizationKey,
    p_reservation_group_id: reservation.reservationGroupId,
    p_legs: reservation.legs.map((leg) => ({
      provider_key: leg.providerKey,
      // AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1 — LA OPERACIÓN VIAJA.
      //
      // Este campo faltaba, y su ausencia no era cosmética: desde la migración 124 la
      // unicidad de una pata activa es `(candidate_id, provider_key, operation_key)`, y
      // el SQL resuelve la operación con `COALESCE(leg->>'operation_key','phone_reveal')`.
      // Sin el campo, las DOS patas Lusha de una autorización con búsqueda de identidad
      // —`contact_search` (1) y `phone_reveal` (5)— aterrizaban como la MISMA operación,
      // la segunda chocaba con la primera dentro de su propia transacción, el bloque
      // interno deshacía las dos escrituras y la función devolvía `already_reserved`.
      //
      // El resultado observable era una AFIRMACIÓN FALSA: 0 corridas, 0 reservas —todo
      // revertido— y al operador se le decía «Ya hay una revelación en proceso». El
      // desglose que el core ya construía (búsqueda vs. teléfono) se perdía justo en el
      // borde de I/O, que es el único sitio donde la base puede leerlo.
      operation_key: leg.operationKey,
      credits: leg.credits,
      limit_credits: leg.limitCredits,
      consumed_credits: leg.consumedCredits,
      scope_type: leg.scopeType,
      scope_id: leg.scopeId,
      period_start: leg.periodStart,
      period_end: leg.periodEnd,
    })),
    p_run: args.run,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.rpc(
        PHONE_REVEAL_CREDIT_RESERVE_AND_CREATE_RUN_FN,
        params,
      );
      if (error) {
        // Un error REPORTADO por el servidor significa que la transacción se deshizo:
        // no hay estado a medias y reintentar no aportaría nada nuevo.
        console.error(
          '[phone-reveal-credit-reservation] reserve+create failed, failing closed:',
          error.message.slice(0, 200),
        );
        return { status: 'unavailable', detail: 'reserve_and_create_rpc_error' };
      }
      return parseReserveAndRunEnvelope(data);
    } catch (err) {
      // Transporte: la respuesta puede haberse perdido DESPUÉS del COMMIT.
      const lastAttempt = attempt === 1;
      console.error(
        `[phone-reveal-credit-reservation] reserve+create threw (attempt ${attempt + 1}/2)${
          lastAttempt ? ', failing closed' : ', retrying with the same authorization key'
        }:`,
        redactDriverMessage(err),
      );
      if (lastAttempt) {
        return { status: 'unavailable', detail: 'reserve_and_create_threw' };
      }
    }
  }

  /* c8 ignore next */
  return { status: 'unavailable', detail: 'reserve_and_create_threw' };
}

/**
 * Confirma UNA pata con lo que realmente costó. `credits` nunca es null y nunca es 0
 * como sustituto de "no reportado": el caller que no obtuvo cifra pasa el tope con
 * `assumed_cap` (lo decide el core).
 *
 * Best-effort por diseño: un fallo aquí NO puede convertir un webhook correcto de Apollo
 * en un 5xx ni degradar una recuperación válida. Deja la fila `reserved`, que es el
 * estado CONSERVADOR — la exposición sigue ocupada hasta que otro cierre la reconcilie o
 * el barrido de huérfanas la detecte.
 */
export async function confirmPhoneRevealCreditReservation(args: {
  reservationId: string;
  credits: number;
  costTruth: PhoneRevealCreditReservationCostTruth;
}): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc(PHONE_REVEAL_CREDIT_CONFIRM_FN, {
      p_reservation_id: args.reservationId,
      p_credits_confirmed: args.credits,
      p_cost_truth: args.costTruth,
    });
    if (error) {
      console.error(
        '[phone-reveal-credit-reservation] confirm failed:',
        error.message.slice(0, 200),
      );
      return false;
    }
    return data === 'confirmed' || data === 'already_confirmed';
  } catch (err) {
    console.error(
      '[phone-reveal-credit-reservation] confirm threw:',
      redactDriverMessage(err),
    );
    return false;
  }
}

/**
 * Libera UNA pata que DEMOSTRABLEMENTE no se ejecutó. No lanza: el caller la invoca en
 * caminos de compensación (la corrida no se pudo crear, 23505) donde propagar un error
 * nuevo solo empeoraría el diagnóstico.
 */
export async function releasePhoneRevealCreditReservation(args: {
  reservationId: string;
  reason: PhoneRevealCreditReservationReleaseReason;
}): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc(PHONE_REVEAL_CREDIT_RELEASE_FN, {
      p_reservation_id: args.reservationId,
      p_reason: args.reason,
    });
    if (error) {
      console.error(
        '[phone-reveal-credit-reservation] release failed:',
        error.message.slice(0, 200),
      );
      return false;
    }
    return data === 'released' || data === 'already_released';
  } catch (err) {
    console.error(
      '[phone-reveal-credit-reservation] release threw:',
      redactDriverMessage(err),
    );
    return false;
  }
}

/** Pata reservada tal como se lee de la tabla para liquidar una corrida terminal. */
export interface PhoneRevealCreditReservationRow extends PhoneRevealCreditReservedLeg {
  status: PhoneRevealCreditReservationStatus;
}

/**
 * Patas de un grupo que siguen `reserved`. Devuelve `[]` cuando no hay nada que liquidar
 * y también cuando la lectura falla: un fallo de lectura NO puede inventarse patas ni
 * liberar exposición a ciegas, y la fila queda como está para el siguiente cierre o para
 * el barrido de huérfanas.
 */
export async function findActivePhoneRevealCreditReservations(
  reservationGroupId: string,
  /**
   * `includeOperationKey` lee también `operation_key` (columna de la migración 124), que
   * es lo que permite liquidar las DOS patas de Lusha de una autorización por separado:
   * `contact_search` con los hechos de la búsqueda y `phone_reveal` con los del reveal.
   *
   * AUSENTE POR DEFECTO. Sin ella cada pata se lee como `phone_reveal` —el default de
   * la columna y lo que TODA fila anterior a la 124 realmente es— así que la
   * liquidación histórica es byte-idéntica y esta lectura no toca una columna que
   * puede no existir todavía.
   */
  options?: { includeOperationKey?: boolean },
): Promise<readonly PhoneRevealCreditReservedLeg[]> {
  const withOperationKey = options?.includeOperationKey === true;
  try {
    const admin = createSupabaseAdminClient();
    // Dos ramas con su literal propio, y no un select construido por ternario: el
    // parser de tipos de supabase-js analiza la cadena del `select` en tiempo de
    // compilación y no acepta una unión de literales.
    const rows$ = withOperationKey
      ? admin
          .from(PHONE_REVEAL_CREDIT_RESERVATIONS_TABLE)
          .select('id, provider_key, credits_reserved, status, operation_key')
          .eq('reservation_group_id', reservationGroupId)
          .eq('status', 'reserved')
      : admin
          .from(PHONE_REVEAL_CREDIT_RESERVATIONS_TABLE)
          .select('id, provider_key, credits_reserved, status')
          .eq('reservation_group_id', reservationGroupId)
          .eq('status', 'reserved');
    const { data, error } = await rows$;
    if (error) {
      console.error(
        '[phone-reveal-credit-reservation] active legs read failed:',
        error.message.slice(0, 200),
      );
      return [];
    }
    const rows = Array.isArray(data) ? data : [];
    return rows.flatMap((row) => {
      const entry = row as Record<string, unknown>;
      const id = typeof entry.id === 'string' ? entry.id : null;
      const providerKey = toProviderKey(entry.provider_key);
      const credits = toFiniteNumber(entry.credits_reserved);
      if (!id || !providerKey || credits === null) return [];
      // Vocabulario CERRADO y parseado, nunca casteado: un valor inesperado se omite y
      // la pata cae al default (`phone_reveal`) por la vía canónica
      // (`resolveReservedLegOperationKey`), en vez de viajar como una operación que el
      // contrato no reconoce.
      const operationKey =
        entry.operation_key === 'contact_search'
          ? ('contact_search' as const)
          : entry.operation_key === 'phone_reveal'
            ? ('phone_reveal' as const)
            : null;
      return [
        {
          id,
          providerKey,
          creditsReserved: credits,
          ...(operationKey ? { operationKey } : {}),
        },
      ];
    });
  } catch (err) {
    console.error(
      '[phone-reveal-credit-reservation] active legs read threw:',
      redactDriverMessage(err),
    );
    return [];
  }
}
