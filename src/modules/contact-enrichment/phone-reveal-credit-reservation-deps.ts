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
      // Una creación "exitosa" sin corrida, sin grupo o sin patas no es una creación: no
      // habría nada que liquidar ni a qué atribuir el gasto del proveedor.
      if (!runId || !groupId || reservations.length === 0) {
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
  const params = {
    p_candidate_id: reservation.candidateId,
    p_authorized_by: reservation.authorizedBy,
    p_authorization_key: reservation.authorizationKey,
    p_reservation_group_id: reservation.reservationGroupId,
    p_legs: reservation.legs.map((leg) => ({
      provider_key: leg.providerKey,
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
