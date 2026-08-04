// Agente 2A — Reserva ATÓMICA de créditos del reveal de teléfono: I/O
// (AGENT2A-PHONE-WATERFALL-4E)
//
// Envoltorios de las tres funciones SQL de la migración 104. Este módulo NO decide
// nada: el ciclo de vida y la liquidación viven en el core PURO
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
  PhoneRevealCreditReservationCostTruth,
  PhoneRevealCreditReservationOutcome,
  PhoneRevealCreditReservationReleaseReason,
  PhoneRevealCreditReservationRequest,
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
export const PHONE_REVEAL_CREDIT_RESERVE_FN = 'try_reserve_phone_reveal_credits';
export const PHONE_REVEAL_CREDIT_CONFIRM_FN = 'confirm_phone_reveal_credits';
export const PHONE_REVEAL_CREDIT_RELEASE_FN = 'release_phone_reveal_credits';

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
 * Traduce el envelope jsonb de `try_reserve_phone_reveal_credits`. Una respuesta que no
 * se puede interpretar es `unavailable`: es lo que impide que un cambio de forma en el
 * SQL se lea silenciosamente como una autorización.
 */
function parseReserveEnvelope(raw: unknown): PhoneRevealCreditReservationOutcome {
  if (!raw || typeof raw !== 'object') {
    return { status: 'unavailable', detail: 'unparseable_response' };
  }
  const envelope = raw as Record<string, unknown>;
  const status = typeof envelope.status === 'string' ? envelope.status : null;

  switch (status) {
    case 'reserved': {
      const groupId =
        typeof envelope.reservation_group_id === 'string'
          ? envelope.reservation_group_id
          : null;
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
      // Una reserva "exitosa" sin id o sin patas no es una reserva: no habría nada que
      // liberar ni que confirmar, y la exposición quedaría sin dueño.
      if (!groupId || reservations.length === 0) {
        return { status: 'unavailable', detail: 'reserved_without_rows' };
      }
      return { status: 'reserved', reservationGroupId: groupId, reservations };
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

    case 'invalid_input':
      return {
        status: 'unavailable',
        detail:
          typeof envelope.detail === 'string' ? envelope.detail : 'invalid_input',
      };

    default:
      return { status: 'unavailable', detail: 'unknown_status' };
  }
}

/**
 * Reserva TODAS las patas de una autorización, all-or-nothing. Nunca lanza: el
 * fail-closed es un desenlace (`unavailable`), no una excepción, para que el caller
 * pueda liberar/abortar con un código mecánico en vez de propagar un error de driver.
 */
export async function reservePhoneRevealCredits(
  request: PhoneRevealCreditReservationRequest,
): Promise<PhoneRevealCreditReservationOutcome> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc(PHONE_REVEAL_CREDIT_RESERVE_FN, {
      p_candidate_id: request.candidateId,
      p_authorized_by: request.authorizedBy,
      p_reservation_group_id: request.reservationGroupId,
      p_legs: request.legs.map((leg) => ({
        provider_key: leg.providerKey,
        credits: leg.credits,
        limit_credits: leg.limitCredits,
        consumed_credits: leg.consumedCredits,
        scope_type: leg.scopeType,
        scope_id: leg.scopeId,
        period_start: leg.periodStart,
        period_end: leg.periodEnd,
      })),
    });

    if (error) {
      console.error(
        '[phone-reveal-credit-reservation] reserve failed, failing closed:',
        error.message.slice(0, 200),
      );
      return { status: 'unavailable', detail: 'reserve_rpc_error' };
    }
    return parseReserveEnvelope(data);
  } catch (err) {
    console.error(
      '[phone-reveal-credit-reservation] reserve threw, failing closed:',
      redactDriverMessage(err),
    );
    return { status: 'unavailable', detail: 'reserve_threw' };
  }
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

/** Libera TODAS las patas de un grupo. Se usa cuando la corrida no llegó a existir. */
export async function releasePhoneRevealCreditReservationGroup(args: {
  reservations: readonly PhoneRevealCreditReservedLeg[];
  reason: PhoneRevealCreditReservationReleaseReason;
}): Promise<void> {
  await Promise.all(
    args.reservations.map((leg) =>
      releasePhoneRevealCreditReservation({
        reservationId: leg.id,
        reason: args.reason,
      }),
    ),
  );
}

/**
 * Asocia las patas del grupo a la corrida recién creada. La asociación AUTORITATIVA es
 * la inversa (`phone_reveal_waterfall_runs.credit_reservation_group_id`, escrita dentro
 * del INSERT de la corrida), así que este UPDATE es la cara de conveniencia: sirve para
 * detectar huérfanas y para consultar desde la reserva. Un fallo se registra y no
 * detiene nada — la corrida ya sabe a qué grupo pertenece.
 */
export async function attachPhoneRevealCreditReservationsToRun(args: {
  reservationGroupId: string;
  runId: string;
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from(PHONE_REVEAL_CREDIT_RESERVATIONS_TABLE)
      .update({ run_id: args.runId })
      .eq('reservation_group_id', args.reservationGroupId)
      .is('run_id', null);
    if (error) {
      console.error(
        '[phone-reveal-credit-reservation] run attach failed (association is authoritative on the run row):',
        error.message.slice(0, 200),
      );
    }
  } catch (err) {
    console.error(
      '[phone-reveal-credit-reservation] run attach threw:',
      redactDriverMessage(err),
    );
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
): Promise<readonly PhoneRevealCreditReservedLeg[]> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from(PHONE_REVEAL_CREDIT_RESERVATIONS_TABLE)
      .select('id, provider_key, credits_reserved, status')
      .eq('reservation_group_id', reservationGroupId)
      .eq('status', 'reserved');
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
      return [{ id, providerKey, creditsReserved: credits }];
    });
  } catch (err) {
    console.error(
      '[phone-reveal-credit-reservation] active legs read threw:',
      redactDriverMessage(err),
    );
    return [];
  }
}
