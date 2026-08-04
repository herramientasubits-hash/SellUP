// Fixtures compartidas de la reserva de créditos del reveal de teléfono
// (Agente 2A · AGENT2A-PHONE-WATERFALL-4E)
//
// NO es una suite: es el cableado de crédito que las tres suites del arranque
// (waterfall completo, legacy y ausencia de infraestructura) necesitan inyectar desde
// que la reserva atómica existe. Vive en un solo sitio porque el contrato es uno: si
// mañana cambia la forma de una dep de crédito, cambia aquí y las tres suites lo
// heredan en vez de divergir.
//
// OFFLINE por construcción: la reserva se simula con la semántica de REFERENCIA del core
// puro (`simulatePhoneRevealCreditReservation`), que es el espejo del SQL. Aquí no hay
// base de datos, ni red, ni Apollo, ni Lusha, ni un solo crédito.

import {
  simulatePhoneRevealCreditReservation,
  type PhoneRevealCreditActiveReservation,
  type PhoneRevealCreditReservationOutcome,
  type PhoneRevealCreditReservationRequest,
  type PhoneRevealCreditReservedLeg,
  type PhoneRevealCreditReservationReleaseReason,
} from '../phone-reveal-credit-reservation-core';
import type {
  PhoneRevealCreditPool,
  PhoneRevealCreditPoolState,
  PhoneRevealCreditProviderKey,
} from '../phone-reveal-credit-budget-core';

/** Período de referencia de todas las fixtures. Fijo: nada aquí lee el reloj. */
export const FIXTURE_PERIOD_START = '2026-08-01T00:00:00.000Z';
export const FIXTURE_PERIOD_END = '2026-08-31T23:59:59.999Z';

/**
 * Pozo CONFIGURADO con `available` créditos disponibles. Es el default de las suites
 * porque es la situación normal en producción: hay regla de crédito y hay saldo.
 *
 * Ojo con el cambio de 4E: "sin regla configurada" ya NO es el default benigno que era
 * en 4D (`unlimited` autorizaba). Ahora bloquea, así que una suite que quiera medir otra
 * cosa tiene que inyectar un pozo con saldo.
 */
export function configuredPool(available: number): PhoneRevealCreditPoolState {
  return {
    kind: 'configured',
    limitCredits: available,
    consumedCredits: 0,
    scopeType: 'global',
    scopeId: null,
    periodStart: FIXTURE_PERIOD_START,
    periodEnd: FIXTURE_PERIOD_END,
  };
}

/** Pozos con el MISMO saldo para todos los proveedores que se pidan. */
export function poolsWith(
  available: number,
): (providerKeys: readonly PhoneRevealCreditProviderKey[]) => readonly PhoneRevealCreditPool[] {
  return (providerKeys) =>
    providerKeys.map((providerKey) => ({
      providerKey,
      state: configuredPool(available),
    }));
}

/** Saldo AMPLIO: cubre cualquier modalidad sin que la reserva sea el sujeto del test. */
export const GENEROUS_CREDITS = 1_000;

export interface CreditHarness {
  /** Fragmento de deps listo para hacer spread en las deps del arranque. */
  deps: {
    readCreditPools: (
      providerKeys: readonly PhoneRevealCreditProviderKey[],
    ) => Promise<readonly PhoneRevealCreditPool[]>;
    reserveCredits: (
      request: PhoneRevealCreditReservationRequest,
    ) => Promise<PhoneRevealCreditReservationOutcome>;
    releaseCredits: (args: {
      reservations: readonly PhoneRevealCreditReservedLeg[];
      reason: PhoneRevealCreditReservationReleaseReason;
    }) => Promise<void>;
    newReservationGroupId: () => string;
    attachReservationsToRun: (args: {
      reservationGroupId: string;
      runId: string;
    }) => Promise<void>;
  };
  /** Proveedores por los que se preguntó, en orden. Prueba QUÉ pozos se consultan. */
  poolQueries: PhoneRevealCreditProviderKey[][];
  /** Peticiones de reserva emitidas. Prueba QUÉ se reservó y por cuánto. */
  reserveRequests: PhoneRevealCreditReservationRequest[];
  /** Liberaciones ejecutadas, con su motivo. Prueba la compensación. */
  releases: {
    reservations: readonly PhoneRevealCreditReservedLeg[];
    reason: PhoneRevealCreditReservationReleaseReason;
  }[];
  /** Asociaciones corrida ↔ grupo de reserva. */
  attachments: { reservationGroupId: string; runId: string }[];
  /** Reservas vivas del "pozo" simulado. Se mutan al reservar/liberar. */
  active: PhoneRevealCreditActiveReservation[];
}

/**
 * Cableado de crédito con la semántica de referencia del SQL.
 *
 *   * `poolsFor`  — pozos por proveedor. Default: saldo amplio.
 *   * `outcome`   — fuerza un desenlace de reserva (p. ej. `unavailable`), saltándose la
 *     simulación. Sirve para fijar el fail-closed sin montar un pozo.
 *   * `active`    — reservas ya vivas en el pozo, para los casos de concurrencia.
 */
export function creditHarness(
  opts: {
    poolsFor?: (
      providerKeys: readonly PhoneRevealCreditProviderKey[],
    ) => readonly PhoneRevealCreditPool[];
    outcome?: PhoneRevealCreditReservationOutcome;
    active?: PhoneRevealCreditActiveReservation[];
    groupIds?: string[];
  } = {},
): CreditHarness {
  const poolQueries: PhoneRevealCreditProviderKey[][] = [];
  const reserveRequests: PhoneRevealCreditReservationRequest[] = [];
  const releases: CreditHarness['releases'] = [];
  const attachments: { reservationGroupId: string; runId: string }[] = [];
  const active: PhoneRevealCreditActiveReservation[] = opts.active ?? [];
  const groupIds = opts.groupIds ?? [];
  let groupCounter = 0;

  const poolsFor = opts.poolsFor ?? poolsWith(GENEROUS_CREDITS);

  return {
    poolQueries,
    reserveRequests,
    releases,
    attachments,
    active,
    deps: {
      readCreditPools: async (providerKeys) => {
        poolQueries.push([...providerKeys]);
        return poolsFor(providerKeys);
      },
      reserveCredits: async (request) => {
        reserveRequests.push(request);
        if (opts.outcome) return opts.outcome;

        const outcome = simulatePhoneRevealCreditReservation(request, active);
        if (outcome.status === 'reserved') {
          // La reserva OCUPA el pozo simulado, igual que el INSERT del SQL: es lo que
          // hace que una segunda autorización concurrente ya no quepa.
          for (const leg of request.legs) {
            active.push({
              candidateId: request.candidateId,
              providerKey: leg.providerKey,
              creditsReserved: leg.credits,
              scopeType: leg.scopeType,
              scopeId: leg.scopeId,
              periodStart: leg.periodStart,
              status: 'reserved',
            });
          }
        }
        return outcome;
      },
      releaseCredits: async (args) => {
        releases.push(args);
        // Liberar DEVUELVE la disponibilidad al pozo simulado.
        for (const leg of args.reservations) {
          const index = active.findIndex(
            (r) => r.providerKey === leg.providerKey && r.status === 'reserved',
          );
          if (index >= 0) active.splice(index, 1);
        }
      },
      newReservationGroupId: () => groupIds[groupCounter++] ?? `group-${groupCounter}`,
      attachReservationsToRun: async (args) => {
        attachments.push(args);
      },
    },
  };
}
