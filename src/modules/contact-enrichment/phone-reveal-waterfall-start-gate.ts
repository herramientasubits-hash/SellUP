// Agente 2A — AGENT2A-WATERFALL-NO-SILENT-DOWNGRADE-1
//
// Clasificación PURA del arranque del waterfall, extraída del wrapper
// 'use server' (phone-reveal-actions.ts) para que sea directamente testeable: un
// archivo 'use server' solo puede exportar async actions, así que la regla que
// decide si se ejecuta un proveedor no podía observarse sin cablear la acción
// entera.
//
// CONTRATO CENTRAL (lo que este hito cierra):
//
//   `no_waterfall` significa UNA sola cosa — el flag maestro
//   `ENABLE_PHONE_REVEAL_WATERFALL` estaba APAGADO antes de orquestar nada — y es
//   el ÚNICO estado que deja continuar el reveal Apollo legacy.
//
// Con el flag ENCENDIDO, la corrida del waterfall es PRECONDICIÓN del gasto: si
// no arranca, no corre ningún proveedor. Antes de este hito seis motivos del core
// (`feature_disabled`, `role_not_allowed`, `invalid_candidate`,
// `candidate_not_found`, `active_run_exists`, `create_conflict`) se colapsaban en
// `no_waterfall` y la operación se DEGRADABA en silencio a Apollo-only: la UI
// había autorizado un waterfall auditado de hasta 14 créditos y el servidor
// acababa ejecutando un Apollo suelto, sin corrida, sin reserva y sin
// correlación en el usage-log. Eso es lo que aquí deja de ser posible.

import {
  normalizePhoneRevealWaterfallAcceptedMaxCredits,
  type StartPhoneRevealWaterfallResult,
} from './phone-reveal-waterfall-core';

/**
 * Estados de bloqueo que viajan tal cual al resultado del server action. Son
 * estados que `RevealCandidatePhoneStatus` YA tiene y que la UI YA mapea: no se
 * amplía la superficie de la UI para bloquear, se reutiliza el motivo que el
 * operador habría leído de todos modos — pero ahora SIN llamar al proveedor.
 */
export type PhoneRevealWaterfallBlockedStatus =
  | 'unauthorized_role'
  | 'invalid_candidate'
  | 'candidate_not_found'
  | 'already_pending';

export type PhoneRevealWaterfallStartGate =
  /**
   * ÚNICO estado que permite el reveal Apollo legacy. Solo lo produce el chequeo
   * del flag maestro en el wrapper; ningún motivo del core puede alcanzarlo.
   */
  | { kind: 'no_waterfall' }
  | { kind: 'started'; runId: string }
  | { kind: 'infrastructure_unavailable'; errorCode: string }
  /**
   * El waterfall se pidió y NO puede arrancar por una condición del candidato,
   * del actor o de una autorización ya viva. Corta antes de cualquier proveedor.
   */
  | { kind: 'blocked'; status: PhoneRevealWaterfallBlockedStatus }
  | { kind: 'insufficient_credits' }
  | { kind: 'budget_not_configured' }
  | { kind: 'credit_balance_unavailable' }
  | {
      kind: 'authorization_ceiling_mismatch';
      requiredMaxCredits: number | null;
      acceptedMaxCredits: number | null;
    };

/**
 * Código PII-free para «la corrida no se pudo registrar». Deliberadamente
 * genérico: el detalle mecánico del driver va al log del servidor, no al cliente.
 */
export const WATERFALL_RUN_UNAVAILABLE_ERROR_CODE = 'waterfall_run_unavailable';

/**
 * El wrapper resolvió el flag maestro ENCENDIDO y el core, leyendo el MISMO flag,
 * respondió `feature_disabled`. Las dos lecturas salen de
 * `isPhoneRevealWaterfallEnabled()`, así que discrepar es una violación de
 * invariante, no un estado de producto: se trata como infraestructura rota y se
 * cierra el paso. Interpretarlo como «entonces no hay waterfall» es exactamente
 * la degradación silenciosa que este hito prohíbe.
 */
export const WATERFALL_FLAG_INVARIANT_ERROR_CODE =
  'waterfall_flag_invariant_violation';

type StartFailure = Extract<StartPhoneRevealWaterfallResult, { started: false }>;

/**
 * Traduce un motivo de NO-arranque del core a la decisión del wrapper.
 *
 * NINGUNA rama devuelve `no_waterfall`: con el flag encendido no existe camino de
 * vuelta a Apollo-only. El `switch` es exhaustivo a propósito — un motivo nuevo
 * rompe la compilación, porque decidir si una razón inédita puede seguir gastando
 * proveedores es una decisión de producto, no un `default` silencioso.
 */
export function classifyPhoneRevealWaterfallStartFailure(
  started: StartFailure,
): PhoneRevealWaterfallStartGate {
  switch (started.reason) {
    case 'feature_disabled':
      return {
        kind: 'infrastructure_unavailable',
        errorCode: WATERFALL_FLAG_INVARIANT_ERROR_CODE,
      };
    // El rol es la MISMA autoridad canónica que gobierna el reveal
    // (`PHONE_REVEAL_AUTHORIZED_ROLE_KEYS`), así que quien no pasa aquí tampoco
    // pasaba el gate de Apollo: el operador lee el mismo motivo que antes, y
    // ahora sin que el servidor llegue siquiera a preparar la llamada.
    case 'role_not_allowed':
      return { kind: 'blocked', status: 'unauthorized_role' };
    case 'invalid_candidate':
      return { kind: 'blocked', status: 'invalid_candidate' };
    case 'candidate_not_found':
      return { kind: 'blocked', status: 'candidate_not_found' };
    // Ya existe una autorización VIVA para este candidato. Desde
    // AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1 este motivo llega COMPROBADO:
    // el core releyó la corrida activa y la encontró. Abrir una segunda llamaría al
    // proveedor fuera de su reserva, así que no se crea otra corrida y no se reintenta.
    case 'active_run_exists':
      return { kind: 'blocked', status: 'already_pending' };
    // Los dos conflictos SIN corrida activa que los explique. Antes compartían rama con
    // `active_run_exists` sobre la premisa de que «la corrida existente ES la
    // autorización» — premisa que un 23505 no demuestra, porque la transacción se
    // deshace entera y puede no dejar corrida ninguna. Son infraestructura: 0 corridas,
    // 0 reservas, 0 proveedores, 0 créditos, y no se reintenta.
    case 'create_conflict':
    case 'reservation_conflict':
      return {
        kind: 'infrastructure_unavailable',
        errorCode: WATERFALL_RUN_UNAVAILABLE_ERROR_CODE,
      };
    // AGENT2A-PHONE-WATERFALL-4D. Dejar continuar el reveal Apollo legacy sería
    // gastar exactamente los créditos que el preflight acaba de declarar
    // indisponibles.
    case 'insufficient_credits':
      return { kind: 'insufficient_credits' };
    case 'budget_not_configured':
      return { kind: 'budget_not_configured' };
    case 'credit_balance_unavailable':
      return { kind: 'credit_balance_unavailable' };
    // AGENT2A-PHONE-WATERFALL-4F. El saldo se verificó bien; lo que no se pudo fue
    // ESCRIBIR la reserva y la corrida (migración 104 ausente, timeout,
    // credenciales…). El waterfall se autorizó y su corrida no existe.
    case 'run_creation_unavailable':
      return {
        kind: 'infrastructure_unavailable',
        errorCode: WATERFALL_RUN_UNAVAILABLE_ERROR_CODE,
      };
    // AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2. La autorización obsoleta se
    // vuelve a pedir; no se reinterpreta ni se baja al tope legacy.
    case 'authorization_ceiling_mismatch':
      return {
        kind: 'authorization_ceiling_mismatch',
        requiredMaxCredits: started.requiredMaxCredits ?? null,
        acceptedMaxCredits: started.acceptedMaxCredits ?? null,
      };
    default: {
      const exhaustive: never = started.reason;
      void exhaustive;
      return {
        kind: 'infrastructure_unavailable',
        errorCode: WATERFALL_RUN_UNAVAILABLE_ERROR_CODE,
      };
    }
  }
}

/**
 * Evento estructurado y SIN PII de cada arranque de waterfall.
 *
 * Solo booleanos, enteros y literales de motivo cerrados: nunca nombre, correo,
 * LinkedIn, teléfono, ids nativos de proveedor ni valores crudos de env. El
 * `candidateId` tampoco entra: no aporta nada que no diga el motivo y sí
 * convierte el log en un rastro por persona.
 */
export interface PhoneRevealWaterfallStartObservabilityEvent {
  event: 'phone_reveal_waterfall_start';
  outer_flag_enabled: boolean;
  core_started: boolean;
  reason: string | null;
  role_authorized: boolean;
  /** Lo que la modalidad REAL exigía. */
  required_max_credits: number | null;
  /**
   * Techo que la PERSONA aprobó, normalizado con el mismo contrato del techo duro
   * (`normalizePhoneRevealWaterfallAcceptedMaxCredits`). NUNCA se deriva de
   * `required_max_credits`: aceptar de más es legítimo —se reserva lo requerido, no lo
   * aceptado— y copiar el requerido encima borraría justo esa diferencia, que es el
   * único dato que dice hasta dónde llegaba el permiso humano.
   *
   * `null` significa «el contrato del techo no llegó a evaluarse» (el core cortó antes,
   * o el arranque lanzó), no «no había techo».
   */
  accepted_max_credits: number | null;
  run_created: boolean;
  /** El flag maestro estaba encendido y el core dijo `feature_disabled`. */
  invariant_violation: boolean;
}

/** Motivo sintético cuando el core no llegó a responder (excepción del driver). */
export const WATERFALL_START_EXCEPTION_REASON = 'driver_exception';

export function buildPhoneRevealWaterfallStartEvent(args: {
  outerFlagEnabled: boolean;
  roleAuthorized: boolean;
  /** `null` cuando el arranque lanzó y no hubo resultado que clasificar. */
  started: StartPhoneRevealWaterfallResult | null;
  /**
   * Techo que el cliente dijo haber aceptado, TAL CUAL llegó a
   * `revealCandidatePhoneAction()` / `startWaterfallRunOrBlock()`.
   *
   * POR QUÉ VIAJA HASTA AQUÍ: en el arranque EXITOSO el core no devuelve el techo
   * aceptado —solo el requerido—, porque para reservar le basta el requerido. El evento
   * antes copiaba el requerido en las dos claves y por tanto MENTÍA sobre el permiso
   * humano en cuanto los dos números diferían (requerido 13 aceptado 14 se registraba
   * como 13/13). La ejecución económica era correcta; el registro de auditoría no.
   */
  acceptedMaxCredits?: number | null;
}): PhoneRevealWaterfallStartObservabilityEvent {
  const { outerFlagEnabled, roleAuthorized, started } = args;
  if (!started) {
    return {
      event: 'phone_reveal_waterfall_start',
      outer_flag_enabled: outerFlagEnabled,
      core_started: false,
      reason: WATERFALL_START_EXCEPTION_REASON,
      role_authorized: roleAuthorized,
      required_max_credits: null,
      accepted_max_credits: null,
      run_created: false,
      invariant_violation: false,
    };
  }
  if (started.started) {
    return {
      event: 'phone_reveal_waterfall_start',
      outer_flag_enabled: outerFlagEnabled,
      core_started: true,
      reason: null,
      role_authorized: roleAuthorized,
      required_max_credits: started.maxCreditsAuthorized,
      // MISMA normalización que el techo duro que acaba de autorizar este arranque
      // (ausente / no finito ⇒ suelo conservador de 8), no una copia del requerido.
      accepted_max_credits: normalizePhoneRevealWaterfallAcceptedMaxCredits(
        args.acceptedMaxCredits,
      ),
      run_created: true,
      invariant_violation: false,
    };
  }
  return {
    event: 'phone_reveal_waterfall_start',
    outer_flag_enabled: outerFlagEnabled,
    core_started: false,
    reason: started.reason,
    role_authorized: roleAuthorized,
    // En el NO-arranque manda el core, no el crudo del cliente: `authorization_ceiling_mismatch`
    // ya devuelve los dos enteros que comparó (requerido 14 / aceptado 8 sigue siendo
    // 14 / 8), y el resto de motivos cortan ANTES de evaluar el techo, así que `null`
    // dice la verdad —no se evaluó— en vez de inventar un techo que nadie comparó.
    required_max_credits: started.requiredMaxCredits ?? null,
    accepted_max_credits: started.acceptedMaxCredits ?? null,
    run_created: false,
    invariant_violation:
      outerFlagEnabled && started.reason === 'feature_disabled',
  };
}
