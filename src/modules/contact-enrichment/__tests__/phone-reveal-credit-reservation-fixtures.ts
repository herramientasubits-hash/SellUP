// Fixtures compartidas de la reserva de créditos del reveal de teléfono
// (Agente 2A · AGENT2A-PHONE-WATERFALL-4E, reescritas en 4F)
//
// NO es una suite: es el cableado de crédito que las suites del arranque (waterfall
// completo, legacy y ausencia de infraestructura) necesitan inyectar desde que la
// reserva atómica existe. Vive en un solo sitio porque el contrato es uno: si mañana
// cambia la forma de una dep de crédito, cambia aquí y las suites lo heredan en vez de
// divergir.
//
// QUÉ CAMBIÓ EN 4F. La reserva y la creación de la corrida dejaron de ser dos deps
// (`reserveCredits` + `createRun`) y pasaron a ser UNA
// (`reserveCreditsAndCreateRun`), porque en producción son una sola transacción. El
// harness refleja esa unión: mantiene la tabla de corridas simulada junto al pozo, de
// modo que un `create_conflict` deshaga también la reserva — igual que el rollback real.
//
// OFFLINE por construcción: se simula con la semántica de REFERENCIA del core puro
// (`simulatePhoneRevealCreditReservationAndRun`), que es el espejo del SQL. Aquí no hay
// base de datos, ni red, ni Apollo, ni Lusha, ni un solo crédito.

import {
  simulatePhoneRevealCreditReservationAndRun,
  type PhoneRevealCreditActiveReservation,
  type PhoneRevealCreditExistingRun,
  type PhoneRevealCreditReservationAndRunOutcome,
  type PhoneRevealCreditReservationAndRunRequest,
} from '../phone-reveal-credit-reservation-core';
import {
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH,
  type PhoneRevealWaterfallRunDraft,
} from '../phone-reveal-waterfall-core';
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

/**
 * Techo ACEPTADO por el operador para las suites cuyo sujeto NO es el techo
 * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2).
 *
 * Desde R2 el arranque compara el tope que la persona aceptó contra el que la modalidad
 * exige, y por omisión asume el suelo conservador de 8 —fail-closed a propósito: un
 * cliente que no manda el tope no puede acabar autorizando el más caro—. Las suites de
 * reserva, atomicidad y presupuesto miden OTRA cosa, así que declaran explícitamente el
 * techo más alto que existe: así el gate del techo nunca es lo que las hace pasar ni
 * fallar, y lo que se reserva sigue siendo lo REQUERIDO, no esto.
 *
 * Se deriva de la constante del core, no se escribe 14 a mano: si el contrato de créditos
 * creciera, estas suites lo heredan en vez de quedarse cortas en silencio.
 */
export const ACCEPTED_CEILING_NOT_UNDER_TEST =
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH;

export interface CreditHarness {
  /** Fragmento de deps listo para hacer spread en las deps del arranque. */
  deps: {
    readCreditPools: (
      providerKeys: readonly PhoneRevealCreditProviderKey[],
    ) => Promise<readonly PhoneRevealCreditPool[]>;
    reserveCreditsAndCreateRun: (args: {
      reservation: PhoneRevealCreditReservationAndRunRequest;
      run: PhoneRevealWaterfallRunDraft;
    }) => Promise<PhoneRevealCreditReservationAndRunOutcome>;
    newReservationGroupId: () => string;
    newAuthorizationKey: () => string;
  };
  /** Proveedores por los que se preguntó, en orden. Prueba QUÉ pozos se consultan. */
  poolQueries: PhoneRevealCreditProviderKey[][];
  /** Peticiones emitidas. Prueba QUÉ se reservó, por cuánto y con qué clave. */
  reserveRequests: PhoneRevealCreditReservationAndRunRequest[];
  /** Borradores ENVIADOS. Uno por intento, se haya escrito o no. */
  runDrafts: PhoneRevealWaterfallRunDraft[];
  /** Corridas realmente ESCRITAS. Vacío tras un rollback. */
  createdRuns: PhoneRevealCreditExistingRun[];
  /** Borradores de las corridas realmente escritas. Vacío tras un rollback. */
  createdDrafts: PhoneRevealWaterfallRunDraft[];
  /** Reservas vivas del "pozo" simulado. Se mutan al reservar. */
  active: PhoneRevealCreditActiveReservation[];
}

/**
 * Cableado de crédito con la semántica de referencia del SQL.
 *
 *   * `poolsFor`      — pozos por proveedor. Default: saldo amplio.
 *   * `outcome`       — fuerza un desenlace, saltándose la simulación. Sirve para fijar
 *     el fail-closed sin montar un pozo.
 *   * `active`        — reservas ya vivas en el pozo, para los casos de concurrencia.
 *   * `existingRuns`  — corridas ya existentes: una activa produce `create_conflict`, y
 *     una con `authorizationKey` produce el golpe idempotente.
 *   * `throws`        — fallo de TRANSPORTE de la operación atómica. Modela la respuesta
 *     perdida: en producción la transacción pudo haber hecho COMMIT igualmente.
 */
export function creditHarness(
  opts: {
    poolsFor?: (
      providerKeys: readonly PhoneRevealCreditProviderKey[],
    ) => readonly PhoneRevealCreditPool[];
    outcome?: PhoneRevealCreditReservationAndRunOutcome;
    active?: PhoneRevealCreditActiveReservation[];
    existingRuns?: PhoneRevealCreditExistingRun[];
    groupIds?: string[];
    authorizationKeys?: string[];
    throws?: unknown;
  } = {},
): CreditHarness {
  const poolQueries: PhoneRevealCreditProviderKey[][] = [];
  const reserveRequests: PhoneRevealCreditReservationAndRunRequest[] = [];
  const runDrafts: PhoneRevealWaterfallRunDraft[] = [];
  const active: PhoneRevealCreditActiveReservation[] = opts.active ?? [];
  const createdRuns: PhoneRevealCreditExistingRun[] = [];
  const createdDrafts: PhoneRevealWaterfallRunDraft[] = [];
  // Tabla de corridas simulada: las preexistentes MÁS las que este harness escriba.
  const runs: PhoneRevealCreditExistingRun[] = [...(opts.existingRuns ?? [])];
  const groupIds = opts.groupIds ?? [];
  const authorizationKeys = opts.authorizationKeys ?? [];
  let groupCounter = 0;
  let keyCounter = 0;

  const poolsFor = opts.poolsFor ?? poolsWith(GENEROUS_CREDITS);

  return {
    poolQueries,
    reserveRequests,
    runDrafts,
    createdRuns,
    createdDrafts,
    active,
    deps: {
      readCreditPools: async (providerKeys) => {
        poolQueries.push([...providerKeys]);
        return poolsFor(providerKeys);
      },
      reserveCreditsAndCreateRun: async ({ reservation, run }) => {
        reserveRequests.push(reservation);
        runDrafts.push(run);
        if (opts.throws) throw opts.throws;
        if (opts.outcome) return opts.outcome;

        const outcome = simulatePhoneRevealCreditReservationAndRun(reservation, {
          activeReservations: active,
          runs,
        });

        // Solo `created` escribe. Cualquier otro desenlace deja el pozo y la tabla EXACTAMENTE
        // como estaban, que es lo que hace el rollback de la transacción real: no existe un
        // camino en el que la reserva sobreviva sin su corrida.
        if (outcome.status === 'created') {
          for (const leg of reservation.legs) {
            active.push({
              candidateId: reservation.candidateId,
              providerKey: leg.providerKey,
              creditsReserved: leg.credits,
              scopeType: leg.scopeType,
              scopeId: leg.scopeId,
              periodStart: leg.periodStart,
              status: 'reserved',
            });
          }
          const created: PhoneRevealCreditExistingRun = {
            runId: outcome.runId,
            candidateId: reservation.candidateId,
            authorizationKey: reservation.authorizationKey,
            reservationGroupId: outcome.reservationGroupId,
            isActive: true,
          };
          runs.push(created);
          createdRuns.push(created);
          createdDrafts.push(run);
        }
        return outcome;
      },
      newReservationGroupId: () => groupIds[groupCounter++] ?? `group-${groupCounter}`,
      newAuthorizationKey: () =>
        authorizationKeys[keyCounter++] ?? `authkey-${keyCounter}`,
    },
  };
}
