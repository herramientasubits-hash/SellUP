/**
 * phone-reveal-credit-reservation-core.ts — Ciclo de vida PURO de la reserva de
 * créditos del reveal de teléfono (Agente 2A · AGENT2A-PHONE-WATERFALL-4E).
 *
 * POR QUÉ HACE FALTA UNA RESERVA Y NO BASTA COMPROBAR EL SALDO
 *
 * El modelo presupuestario real es por proveedor y NO tiene contador de reservado:
 * `remaining = limit_credits - consumed(provider_usage_logs)`. Dos autorizaciones que
 * arrancan una detrás de otra leen la MISMA disponibilidad y las dos pasan, porque el
 * usage log que habría delatado a la primera solo aparece cuando el proveedor ya cobró.
 * El preflight de 4D cierra el agujero "no hay saldo en absoluto", no el de
 * concurrencia.
 *
 * La reserva ocupa la EXPOSICIÓN MÁXIMA de la autorización (Apollo 8 y/o Lusha 5) desde
 * antes de que exista la corrida hasta que la operación termina. Mientras esté activa,
 * esos créditos no están disponibles para nadie más. Eso es lo que impide que dos
 * candidatos consuman la misma disponibilidad.
 *
 * DÓNDE VIVE LA ATOMICIDAD. En la migración 104
 * (`try_reserve_phone_reveal_credits`), porque serializar la disponibilidad solo se
 * puede hacer dentro de la transacción: lock de aviso por pozo + relectura de la
 * exposición activa + INSERT, todo junto. Este módulo NO reserva; describe el ciclo de
 * vida, traduce desenlaces y decide la liquidación. Es PURO: sin I/O, sin Supabase, sin
 * fetch, sin process.env, sin Date.now() salvo los relojes que llegan inyectados.
 *
 * CICLO DE VIDA (una fila por PATA)
 *
 *   reserved ──confirm(costo real | tope si no se reportó)──> confirmed
 *          └──release(la pata NO se ejecutó, demostrable)───> released
 *
 * Reglas que sostienen el contrato de dinero:
 *
 *   1. La reserva se toma ANTES de crear la corrida y ANTES de llamar a cualquier
 *      proveedor. Nunca al revés: una corrida sin reserva ya es exposición no contada.
 *   2. Si la corrida NO se puede crear (excepción, o 23505 del índice único parcial),
 *      la reserva se LIBERA. Sin eso, cada conflicto benigno dejaría 13 créditos
 *      bloqueados para siempre.
 *   3. Mientras la operación esté activa la exposición se mantiene ENTERA. No se
 *      libera parcialmente "porque Apollo ya cobró menos": la pata Lusha sigue
 *      autorizada y el servidor la ejecuta sin volver a preguntar.
 *   4. Al terminalizar se RECONCILIA contra el costo real de cada pata, por separado.
 *   5. COSTO DESCONOCIDO ⇒ se confirma el TOPE con `assumed_cap`. Nunca 0, y nunca un
 *      release: un costo que nadie reportó no es un costo de cero, y devolver esa
 *      disponibilidad sería regalar créditos que el proveedor pudo haber cobrado.
 *      Solo se libera lo que es DEMOSTRABLEMENTE no ejecutado, y para la pata Lusha esa
 *      prueba existe: `lusha_attempted_at IS NULL` en una corrida terminal, garantizado
 *      por el claim atómico.
 */

// Único import de este módulo, y es a otro core PURO: los topes por pata y el modelo
// presupuestario tienen UNA autoridad, y duplicarlos aquí es lo que permitiría que
// discrepasen.
import {
  resolvePhoneRevealCreditRequirements,
  type PhoneRevealCreditBudgetInput,
  type PhoneRevealCreditBudgetMode,
  type PhoneRevealCreditPoolState,
  type PhoneRevealCreditProviderKey,
} from './phone-reveal-credit-budget-core';

// ── Vocabularios (espejo exacto de los CHECK de la migración 104) ──

/** Estado de UNA pata reservada. */
export const PHONE_REVEAL_CREDIT_RESERVATION_STATUSES = [
  'reserved',
  'confirmed',
  'released',
] as const;

export type PhoneRevealCreditReservationStatus =
  (typeof PHONE_REVEAL_CREDIT_RESERVATION_STATUSES)[number];

/**
 * Procedencia del número confirmado. NO incluye `unknown` a propósito: una
 * confirmación siempre aterriza en una cifra, y cuando el proveedor no reportó ninguna
 * la cifra es el tope y esta columna lo dice.
 */
export const PHONE_REVEAL_CREDIT_RESERVATION_COST_TRUTHS = [
  'reported',
  'assumed_cap',
] as const;

export type PhoneRevealCreditReservationCostTruth =
  (typeof PHONE_REVEAL_CREDIT_RESERVATION_COST_TRUTHS)[number];

/**
 * Motivos de liberación. Vocabulario CERRADO y PII-free; se escribe en
 * `release_reason` y viaja al diagnóstico como código mecánico.
 */
export const PHONE_REVEAL_CREDIT_RESERVATION_RELEASE_REASONS = [
  /** La corrida no se pudo crear (excepción del store, id ausente…). */
  'run_creation_failed',
  /** El índice único parcial rechazó la corrida (23505): ya había una activa. */
  'create_conflict',
  /**
   * La corrida terminalizó y la pata NUNCA se intentó. Para Lusha lo garantiza el claim
   * atómico (`lusha_attempted_at IS NULL`); para Apollo, `apollo_attempted_at IS NULL`
   * (corrida legacy, donde Apollo no corre bajo esta autorización).
   */
  'leg_never_attempted',
  /** Barrido de reservas huérfanas: reservada, sin corrida y vencida. */
  'orphan_sweep',
] as const;

export type PhoneRevealCreditReservationReleaseReason =
  (typeof PHONE_REVEAL_CREDIT_RESERVATION_RELEASE_REASONS)[number];

// ── Petición de reserva ────────────────────────────────────────

/**
 * UNA pata a reservar, con la identidad COMPLETA de su pozo. El pozo tiene que viajar
 * porque la disponibilidad está scopeada: una regla de scope `user` solo compite con
 * las reservas de ese usuario, mientras que una `global` compite con las de todos, y
 * sumar pozos distintos daría un número que no existe.
 */
export interface PhoneRevealCreditReservationLeg {
  providerKey: PhoneRevealCreditProviderKey;
  /** Tope de la pata (Apollo 8 / Lusha 5). */
  credits: number;
  /**
   * `budget_rules.limit_credits`. `null` ⇒ NO hay presupuesto configurado: la reserva
   * se rechaza con `budget_not_configured` en vez de inventarse un techo.
   */
  limitCredits: number | null;
  consumedCredits: number;
  scopeType: 'user' | 'group' | 'role' | 'global';
  scopeId: string | null;
  periodStart: string;
  periodEnd: string;
}

export interface PhoneRevealCreditReservationRequest {
  candidateId: string;
  /** internal_users.id del operador que autorizó. */
  authorizedBy: string;
  /** Id del GRUPO: une las patas de una misma autorización. Lo genera el caller. */
  reservationGroupId: string;
  /** Todas las patas de la autorización. Se reservan ALL-OR-NOTHING. */
  legs: readonly PhoneRevealCreditReservationLeg[];
}

/** Pata ya reservada, tal como la devuelve la RPC. */
export interface PhoneRevealCreditReservedLeg {
  id: string;
  providerKey: PhoneRevealCreditProviderKey;
  creditsReserved: number;
}

/** Detalle por pata de un rechazo. PII-free: proveedor y cifras, nada más. */
export interface PhoneRevealCreditReservationLegRejection {
  providerKey: string;
  requiredCredits: number;
  /** `null` cuando no había regla o no se pudo leer. Nunca 0 en esos casos. */
  availableCredits: number | null;
}

/**
 * Desenlace de la reserva.
 *
 *   * `reserved`              — exposición ocupada; se puede crear la corrida.
 *   * `insufficient_credits`  — algún pozo no cubría su pata. NADA quedó reservado.
 *   * `budget_not_configured` — algún proveedor exigido no tiene regla de crédito.
 *   * `already_reserved`      — ese candidato ya tiene una pata reservada viva.
 *   * `unavailable`           — la reserva no se pudo evaluar (RPC ausente, error del
 *     driver, entrada inválida). FAIL-CLOSED, y deliberadamente distinto de
 *     `insufficient_credits`: no se sabe si alcanzaba.
 */
export type PhoneRevealCreditReservationOutcome =
  | {
      status: 'reserved';
      reservationGroupId: string;
      reservations: readonly PhoneRevealCreditReservedLeg[];
    }
  | {
      status: 'insufficient_credits';
      legs: readonly PhoneRevealCreditReservationLegRejection[];
    }
  | {
      status: 'budget_not_configured';
      legs: readonly PhoneRevealCreditReservationLegRejection[];
    }
  | { status: 'already_reserved' }
  | { status: 'unavailable'; detail: string | null };

/**
 * Construye las patas a reservar a partir de la modalidad y del presupuesto ya
 * resuelto. Un pozo `not_configured` viaja con `limitCredits: null` en vez de omitirse:
 * así la RPC vuelve a rechazarlo por su cuenta (defensa en profundidad) y el motivo
 * llega igual al operador si este core se salta.
 *
 * En el modelo `shared` se emite UNA pata sintética con el total de la modalidad, que
 * es exactamente lo que ese modelo exigiría. Hoy no es el modelo real (ver
 * PHONE_REVEAL_CREDIT_BUDGET_MODEL) y esta rama existe para que la diferencia sea
 * explícita y no una suposición.
 */
export function buildPhoneRevealCreditReservationLegs(args: {
  mode: PhoneRevealCreditBudgetMode;
  budget: PhoneRevealCreditBudgetInput;
}): readonly PhoneRevealCreditReservationLeg[] {
  const requirements = resolvePhoneRevealCreditRequirements(args.mode);

  if (args.budget.model === 'shared') {
    const total = requirements.reduce((sum, leg) => sum + leg.credits, 0);
    const state = args.budget.pool;
    return [
      toReservationLeg(requirements[0]?.providerKey ?? 'apollo', total, state),
    ];
  }

  const byProvider = new Map(
    args.budget.pools.map((pool) => [pool.providerKey, pool.state]),
  );
  return requirements.map((requirement) =>
    toReservationLeg(
      requirement.providerKey,
      requirement.credits,
      byProvider.get(requirement.providerKey),
    ),
  );
}

function toReservationLeg(
  providerKey: PhoneRevealCreditProviderKey,
  credits: number,
  state: PhoneRevealCreditPoolState | undefined,
): PhoneRevealCreditReservationLeg {
  if (!state || state.kind !== 'configured') {
    // Sin pozo legible no hay período ni scope que reflejar. Se emite la pata con
    // `limitCredits: null` para que el rechazo sea explícito aguas abajo; los campos de
    // identidad quedan en su valor más restrictivo (`global`, época) y NUNCA se usan,
    // porque una pata sin límite no llega al INSERT.
    return {
      providerKey,
      credits,
      limitCredits: null,
      consumedCredits: 0,
      scopeType: 'global',
      scopeId: null,
      periodStart: '1970-01-01T00:00:00.000Z',
      periodEnd: '1970-01-01T00:00:00.000Z',
    };
  }
  return {
    providerKey,
    credits,
    limitCredits: state.limitCredits,
    consumedCredits: state.consumedCredits,
    scopeType: state.scopeType,
    scopeId: state.scopeId,
    periodStart: state.periodStart,
    periodEnd: state.periodEnd,
  };
}

// ── Semántica de referencia (espejo del SQL, verificable OFFLINE) ──

/** Reserva activa de un pozo, tal como la ve la RPC dentro de la transacción. */
export interface PhoneRevealCreditActiveReservation {
  candidateId: string;
  providerKey: string;
  creditsReserved: number;
  scopeType: string;
  scopeId: string | null;
  periodStart: string;
  status: PhoneRevealCreditReservationStatus;
}

/** Identidad del pozo: proveedor + scope + período. Espejo de la clave del lock. */
function poolKey(leg: {
  providerKey: string;
  scopeType: string;
  scopeId: string | null;
  periodStart: string;
}): string {
  return `${leg.providerKey}|${leg.scopeType}|${leg.scopeId ?? ''}|${leg.periodStart}`;
}

/**
 * Semántica de REFERENCIA de `try_reserve_phone_reveal_credits`, en TypeScript puro.
 *
 * No es el camino de producción — en producción reserva la RPC, que es la única que
 * puede ser atómica — sino el espejo ejecutable de su contrato:
 *
 *   available = limit_credits - consumed_credits - SUM(reservas activas del pozo)
 *   ALL-OR-NOTHING: una sola pata sin espacio rechaza la autorización completa.
 *
 * Existe para que los casos que cuestan dinero (dos autorizaciones concurrentes con
 * saldo para una, saldo justo, saldo ausente) se puedan fijar OFFLINE, sin base de
 * datos, sin proveedores y sin un solo crédito. Un test estático comprueba que la
 * fórmula y el vocabulario de estados sigan coincidiendo con el SQL.
 */
export function simulatePhoneRevealCreditReservation(
  request: PhoneRevealCreditReservationRequest,
  activeReservations: readonly PhoneRevealCreditActiveReservation[],
): PhoneRevealCreditReservationOutcome {
  if (request.legs.length === 0) {
    return { status: 'unavailable', detail: 'legs_empty' };
  }
  if (request.legs.some((leg) => !(leg.credits > 0))) {
    return { status: 'unavailable', detail: 'leg_credits_not_positive' };
  }

  const missingBudget = request.legs.filter((leg) => leg.limitCredits === null);
  if (missingBudget.length > 0) {
    return {
      status: 'budget_not_configured',
      legs: missingBudget.map((leg) => ({
        providerKey: leg.providerKey,
        requiredCredits: leg.credits,
        availableCredits: null,
      })),
    };
  }

  const active = activeReservations.filter((r) => r.status === 'reserved');

  // Doble clic sobre el MISMO candidato: lo garantiza el índice único parcial
  // (candidate_id, provider_key) WHERE status = 'reserved'.
  if (active.some((r) => r.candidateId === request.candidateId)) {
    return { status: 'already_reserved' };
  }

  const insufficient: PhoneRevealCreditReservationLegRejection[] = [];
  for (const leg of request.legs) {
    const reserved = active
      .filter((r) => poolKey(r) === poolKey(leg))
      .reduce((sum, r) => sum + r.creditsReserved, 0);
    const available = (leg.limitCredits ?? 0) - leg.consumedCredits - reserved;
    if (available < leg.credits) {
      insufficient.push({
        providerKey: leg.providerKey,
        requiredCredits: leg.credits,
        availableCredits: available,
      });
    }
  }
  if (insufficient.length > 0) {
    return { status: 'insufficient_credits', legs: insufficient };
  }

  return {
    status: 'reserved',
    reservationGroupId: request.reservationGroupId,
    reservations: request.legs.map((leg, index) => ({
      // Id sintético y estable: esta función no habla con Postgres.
      id: `${request.reservationGroupId}:${index}:${leg.providerKey}`,
      providerKey: leg.providerKey,
      creditsReserved: leg.credits,
    })),
  };
}

// ── Liquidación contra el costo real (reconciliación) ───────────

/**
 * Hechos terminales de la corrida que deciden la liquidación. Es una proyección
 * mínima de `phone_reveal_waterfall_runs` y la cumple su propio record, así que
 * servidor y test liquidan con la MISMA función sobre la MISMA fila.
 */
export interface PhoneRevealCreditSettlementFacts {
  /** true solo si la corrida ya es terminal. Una corrida viva NO se liquida. */
  isTerminal: boolean;
  /** `apollo_attempted_at !== null`: Apollo corrió BAJO esta autorización. */
  apolloAttempted: boolean;
  /** `apollo_cost_credits`. null = no reportado. NUNCA se lee como 0. */
  apolloCostCredits: number | null;
  /** `apollo_cost_source`: solo `reported` convierte la cifra en verdad. */
  apolloCostSource: string | null;
  /** `lusha_attempted_at !== null`: garantizado por el claim atómico. */
  lushaAttempted: boolean;
  lushaCostCredits: number | null;
  lushaCostSource: string | null;
}

/** Qué hacer con UNA pata reservada. */
export type PhoneRevealCreditSettlementAction =
  | {
      action: 'confirm';
      reservationId: string;
      providerKey: string;
      credits: number;
      costTruth: PhoneRevealCreditReservationCostTruth;
    }
  | {
      action: 'release';
      reservationId: string;
      providerKey: string;
      reason: PhoneRevealCreditReservationReleaseReason;
    };

function legFacts(
  providerKey: string,
  facts: PhoneRevealCreditSettlementFacts,
): { attempted: boolean; credits: number | null; source: string | null } {
  return providerKey === 'lusha'
    ? {
        attempted: facts.lushaAttempted,
        credits: facts.lushaCostCredits,
        source: facts.lushaCostSource,
      }
    : {
        attempted: facts.apolloAttempted,
        credits: facts.apolloCostCredits,
        source: facts.apolloCostSource,
      };
}

/**
 * Decide, de forma PURA, cómo se liquida cada pata reservada de una corrida terminal.
 *
 *   * pata NO intentada           ⇒ RELEASE. Es el único caso demostrable: para Lusha lo
 *     garantiza el claim atómico y para Apollo su timestamp (null solo en la modalidad
 *     legacy, donde Apollo no corre bajo esta autorización).
 *   * pata intentada con costo REPORTADO ⇒ CONFIRM con ese costo (`reported`). Se
 *     confirma la cifra real incluso si supera el tope: ocultar un sobregiro sería peor
 *     que registrarlo.
 *   * pata intentada con costo DESCONOCIDO ⇒ CONFIRM con el TOPE (`assumed_cap`).
 *     Nunca 0 y nunca release: no reportar no es no cobrar.
 *
 * Una corrida NO terminal devuelve lista vacía: mientras la operación pueda gastar, la
 * exposición se mantiene ENTERA.
 */
export function decidePhoneRevealCreditSettlement(args: {
  facts: PhoneRevealCreditSettlementFacts;
  /** Patas que siguen `reserved`. Las ya confirmadas/liberadas no se retocan. */
  reservedLegs: readonly PhoneRevealCreditReservedLeg[];
}): readonly PhoneRevealCreditSettlementAction[] {
  if (!args.facts.isTerminal) return [];

  return args.reservedLegs.map((leg) => {
    const { attempted, credits, source } = legFacts(leg.providerKey, args.facts);

    if (!attempted) {
      return {
        action: 'release',
        reservationId: leg.id,
        providerKey: leg.providerKey,
        reason: 'leg_never_attempted',
      };
    }

    const reported =
      source === 'reported' && typeof credits === 'number' && Number.isFinite(credits);
    return {
      action: 'confirm',
      reservationId: leg.id,
      providerKey: leg.providerKey,
      credits: reported ? (credits as number) : leg.creditsReserved,
      costTruth: reported ? 'reported' : 'assumed_cap',
    };
  });
}

// ── Huérfanas ──────────────────────────────────────────────────

/**
 * Ventana tras la cual una reserva sin corrida se considera huérfana. Es holgada a
 * propósito: la reserva y el INSERT de la corrida ocurren en la misma petición, así que
 * cualquier cosa que lleve minutos separados es un fallo, no una carrera.
 */
export const PHONE_REVEAL_CREDIT_RESERVATION_ORPHAN_MINUTES = 15;

/**
 * ¿Es esta reserva una huérfana? Reservada, sin corrida asociada y creada hace más de
 * la ventana. Es exposición que nadie va a liquidar nunca.
 *
 * Fechas ilegibles ⇒ `false`: una fila que no se puede fechar NO se libera a ciegas.
 * Liberar de más devuelve créditos que quizá sí se gastaron, y este módulo prefiere
 * sobre-bloquear a sub-contabilizar.
 */
export function isPhoneRevealCreditReservationOrphan(args: {
  status: PhoneRevealCreditReservationStatus;
  runId: string | null;
  createdAtIso: string;
  nowIso: string;
  orphanMinutes?: number;
}): boolean {
  if (args.status !== 'reserved') return false;
  if (args.runId !== null) return false;

  const createdAt = new Date(args.createdAtIso).getTime();
  const now = new Date(args.nowIso).getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(now)) return false;

  const minutes = args.orphanMinutes ?? PHONE_REVEAL_CREDIT_RESERVATION_ORPHAN_MINUTES;
  return now - createdAt > minutes * 60_000;
}
