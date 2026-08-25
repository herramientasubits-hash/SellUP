// Agente 2A — AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1
//
// Clasificación PURA del arranque LEGACY (solo-Lusha), extraída del wrapper
// 'use server' (phone-reveal-waterfall-legacy-actions.ts) para que sea directamente
// testeable: un archivo 'use server' solo puede exportar async actions, así que la
// regla que traduce un rechazo a lo que lee el operador no podía observarse sin
// cablear la acción entera. Mismo patrón, y por la misma razón, que
// phone-reveal-waterfall-start-gate.ts hace con el arranque completo.
//
// QUÉ CIERRA ESTE HITO
//
//   Un rechazo de esta ruta se veía en Producción como UNA sola frase: «Este
//   candidato ya no puede autorizarse por esta vía». Detrás de esa frase se
//   colapsaban motivos que no tienen nada que ver entre sí — una restricción de
//   privacidad, una corrida ya viva, datos insuficientes para identificar a la
//   persona en Lusha, y también una LECTURA QUE FALLÓ. El último caso es el que
//   convierte el colapso en una afirmación falsa: cuando el driver lanza, el
//   candidato sigue siendo perfectamente elegible y lo que se rompió es la
//   infraestructura, pero al operador se le decía que el candidato «ya no puede
//   autorizarse». Con eso, un incidente de Producción es indiagnosticable desde
//   fuera del proceso: el desenlace observable es el mismo para todos.
//
// A partir de aquí `not_eligible` deja de ser el cajón de sastre. El `switch` es
// EXHAUSTIVO a propósito: un motivo nuevo rompe la compilación, porque decidir qué
// se le dice a una persona sobre un motivo inédito es una decisión de producto, no
// un `default` silencioso.
//
// NO cambia ninguna puerta, ningún tope y ningún gasto: traduce, no autoriza.

import type {
  LegacyPhoneRevealStartDiagnostics,
  PhoneRevealWaterfallLegacyIneligibleReason,
  StartLegacyPhoneRevealWaterfallResult,
} from './phone-reveal-waterfall-core';

/**
 * Desenlace que ve la UI. Códigos mecánicos: la traducción a copy vive en el drawer.
 *
 * Los estados que ya existían conservan su nombre y su significado — la UI que los
 * mapea no cambia de contrato — y los nuevos son EXACTAMENTE los que antes se
 * colapsaban.
 */
export type LegacyPhoneRevealWaterfallActionStatus =
  /** Lusha entregó el teléfono. La UI recarga el candidato. */
  | 'revealed'
  /** Lusha corrió y no encontró teléfono. El candidato NO se modifica. */
  | 'no_phone_found'
  /** Lusha corrió y falló técnicamente. No significa "no existe teléfono". */
  | 'error'
  /** Se cerró SIN llamar a Lusha, ya con la corrida creada. */
  | 'closed_without_lusha'
  /** Otro disparador ya había tomado la pata en esta corrida. */
  | 'already_attempted'
  /**
   * AGENT2A-PHONE-WATERFALL-4D: el pozo de Lusha no cubre los créditos de su pata.
   * Se detectó ANTES de crear la corrida: 0 corridas, 0 llamadas a Lusha, 0 usage
   * logs, 0 créditos.
   */
  | 'insufficient_credits'
  /** Lusha no tiene regla de crédito configurada. Mismas garantías de cero efectos. */
  | 'budget_not_configured'
  /** El presupuesto no se pudo verificar. Fail-closed, mismas garantías. */
  | 'credit_balance_unavailable'
  /**
   * La escritura atómica de reserva + corrida no se pudo ejecutar, o el arranque
   * lanzó. Mismas garantías de cero efectos, y NUNCA `not_eligible`: el candidato
   * aplica y lo que falló es la infraestructura.
   */
  | 'infrastructure_unavailable'
  /** El tope aceptado quedó por debajo del que la modalidad real exige. */
  | 'authorization_changed'
  // ── Nuevos: lo que antes se colapsaba en `not_eligible` ──────────────────
  /** El flag maestro del waterfall está apagado. No es un hecho del candidato. */
  | 'feature_disabled'
  /** El actor no puede revelar teléfono. Tampoco es un hecho del candidato. */
  | 'role_not_allowed'
  /** El candidato no existe (o dejó de existir entre el render y el clic). */
  | 'candidate_not_found'
  /**
   * El candidato existe pero su ESTADO cambió respecto a lo que la vista previa
   * leyó: el reveal ya no está agotado, la evidencia no es de Apollo, el intento no
   * cerró fechado, ya hay teléfono, el candidato dejó de ser editable, o su
   * historial de corridas ya no admite una autorización nueva. En todos, la acción
   * correcta del operador es la MISMA —recargar— y ninguno afirma nada económico.
   */
  | 'candidate_state_changed'
  /** No hay con qué identificar a esta persona en Lusha (ni id propio ni búsqueda). */
  | 'missing_lusha_contact_id'
  /** Ya hay una autorización VIVA para este candidato. No se abre una segunda. */
  | 'already_pending'
  /** Tombstone de supresión confirmado. 0 corridas, 0 reservas, 0 proveedores. */
  | 'blocked_suppressed'
  /** `do_not_contact` registrado. Mismas garantías de cero efectos. */
  | 'do_not_contact'
  /**
   * La verificación de privacidad NO se pudo completar. Bloquea IGUAL que un
   * tombstone confirmado (fail-closed) pero NO afirma lo mismo: no se comprobó.
   * Decirle al operador «el candidato ya no aplica» aquí sería inventarle un hecho
   * sobre la persona a partir de una lectura que falló.
   */
  | 'privacy_check_unavailable'
  /** Entrada inválida del cliente. Único resto del cajón de sastre. */
  | 'not_eligible';

/**
 * Traduce un motivo de NO-arranque del core al desenlace que lee el operador.
 *
 * NINGUNA rama devuelve `not_eligible` para un motivo mecánico conocido: eso es
 * justo lo que este hito elimina.
 */
export function classifyLegacyPhoneRevealStartFailure(
  reason: PhoneRevealWaterfallLegacyIneligibleReason,
): LegacyPhoneRevealWaterfallActionStatus {
  switch (reason) {
    case 'feature_disabled':
      return 'feature_disabled';
    case 'role_not_allowed':
      return 'role_not_allowed';
    case 'invalid_candidate':
      return 'not_eligible';
    case 'candidate_not_found':
      return 'candidate_not_found';
    // El candidato existe; lo que ya no coincide es su ESTADO con el que la vista
    // previa leyó. Un solo desenlace porque la acción del operador es una sola
    // —recargar— y porque el motivo mecánico exacto viaja igualmente en `reason`.
    case 'apollo_not_exhausted':
    case 'apollo_evidence_missing':
    case 'apollo_outcome_not_closed':
    case 'existing_phone_present':
    case 'candidate_not_editable':
    case 'incompatible_historical_run':
    case 'previous_run_revealed_phone':
      return 'candidate_state_changed';
    case 'missing_lusha_contact_id':
      return 'missing_lusha_contact_id';
    // AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1 — AQUÍ ESTABA LA MENTIRA.
    //
    // `create_conflict` compartía rama con `active_run_exists` bajo la idea de que «la
    // corrida existente ES la autorización». Esa premisa sólo se sostiene cuando la
    // corrida EXISTE, y un conflicto de unicidad no lo demuestra: la transacción se
    // deshace entera, así que puede dejar 0 corridas y 0 reservas y llegar igualmente
    // hasta aquí. Con la premisa rota, el `already_pending` afirmaba una revelación en
    // curso que nadie podía encontrar — que es el defecto que este hito cierra.
    //
    // Ahora `active_run_exists` sólo llega COMPROBADO (el core releyó la corrida y la
    // encontró), y los dos conflictos sin corrida se van a infraestructura.
    case 'active_run_exists':
      return 'already_pending';
    case 'create_conflict':
    case 'reservation_conflict':
      return 'infrastructure_unavailable';
    case 'insufficient_credits':
      return 'insufficient_credits';
    case 'budget_not_configured':
      return 'budget_not_configured';
    case 'credit_balance_unavailable':
      return 'credit_balance_unavailable';
    case 'run_creation_unavailable':
      return 'infrastructure_unavailable';
    case 'authorization_ceiling_mismatch':
      return 'authorization_changed';
    case 'blocked_suppressed':
      return 'blocked_suppressed';
    case 'do_not_contact':
      return 'do_not_contact';
    case 'suppression_check_unavailable':
      return 'privacy_check_unavailable';
    default: {
      // Un motivo nuevo rompe la compilación. En runtime, fail-closed hacia
      // infraestructura: no se afirma nada sobre el candidato ni sobre su privacidad.
      const exhaustive: never = reason;
      void exhaustive;
      return 'infrastructure_unavailable';
    }
  }
}

/**
 * Motivo sintético cuando el core no llegó a responder porque el arranque LANZÓ.
 * El candidato no tiene nada que ver: se registra como lo que es.
 */
export const LEGACY_START_EXCEPTION_REASON = 'legacy_run_creation_failed';

/**
 * Evento estructurado y SIN PII de cada arranque legacy.
 *
 * Solo booleanos, enteros y literales cerrados: nunca nombre, correo, LinkedIn,
 * teléfono, ids nativos de proveedor ni valores crudos de env. El `candidateId`
 * tampoco entra —no aporta nada que no diga el motivo y sí convertiría el log en un
 * rastro por persona—, igual que en el evento del arranque completo.
 */
export interface LegacyPhoneRevealStartObservabilityEvent {
  event: 'phone_reveal_legacy_start_outcome';
  preview_or_start: 'start';
  outer_flag_enabled: boolean;
  role_authorized: boolean;
  identity_search_allowed: boolean;
  /** `null` = la modalidad no llegó a resolverse. */
  requires_identity_search: boolean | null;
  /** Lo que la modalidad REAL exigía. `null` = no se llegó a comparar. */
  required_max_credits: number | null;
  /**
   * Techo que la PERSONA aprobó. NUNCA se deriva de `required_max_credits`: copiar el
   * requerido encima borraría el único dato que dice hasta dónde llegaba el permiso
   * humano (AGENT2A-WATERFALL-NO-SILENT-DOWNGRADE-1-R2).
   */
  accepted_max_credits: number | null;
  /** `null` = la puerta de privacidad no llegó a evaluarse. */
  privacy_state: string | null;
  /**
   * `null` = no se llegó a consultar. Es la comprobación PREVIA, no la posterior al
   * conflicto: las dos se registran por separado desde
   * AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1.
   */
  active_run_found: boolean | null;
  history_classification: string | null;
  /**
   * ¿Chocó la escritura atómica contra un índice único?
   * (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1). `null` = no se llegó a intentar.
   *
   * Existe porque el evento del incidente decía `active_run_found = false` y
   * `reason = active_run_exists` a la vez, y desde fuera del proceso era imposible saber
   * si la contradicción venía de una carrera o de una colisión que no dejó nada escrito.
   */
  atomic_create_conflict: boolean | null;
  /** `'reservation' | 'run_create' | null`. Enum cerrado: nunca texto del driver. */
  conflict_class: string | null;
  /** Qué respondió la RE-LECTURA posterior al conflicto. `null` = no se consultó. */
  post_conflict_active_run_found: boolean | null;
  reason: string | null;
  run_created: boolean;
}

export function buildLegacyPhoneRevealStartEvent(args: {
  /**
   * `null` cuando el arranque lanzó y no hubo resultado que clasificar. Ahí el evento
   * no puede afirmar nada observado, así que todo lo observable viaja `null`.
   */
  started: StartLegacyPhoneRevealWaterfallResult | null;
  /** Flag resuelto por el wrapper, para el caso en que no hay resultado. */
  outerFlagEnabled: boolean;
  /**
   * Techo que el cliente dijo haber aceptado, TAL CUAL llegó a la server action. Viaja
   * hasta aquí porque en el arranque EXITOSO el core sólo devuelve el requerido.
   */
  acceptedMaxCredits: number | null;
}): LegacyPhoneRevealStartObservabilityEvent {
  const { started, outerFlagEnabled, acceptedMaxCredits } = args;

  if (!started) {
    return {
      event: 'phone_reveal_legacy_start_outcome',
      preview_or_start: 'start',
      outer_flag_enabled: outerFlagEnabled,
      role_authorized: false,
      identity_search_allowed: false,
      requires_identity_search: null,
      required_max_credits: null,
      accepted_max_credits: acceptedMaxCredits,
      privacy_state: null,
      active_run_found: null,
      history_classification: null,
      atomic_create_conflict: null,
      conflict_class: null,
      post_conflict_active_run_found: null,
      reason: LEGACY_START_EXCEPTION_REASON,
      run_created: false,
    };
  }

  const d: LegacyPhoneRevealStartDiagnostics = started.diagnostics;
  const base = {
    event: 'phone_reveal_legacy_start_outcome',
    preview_or_start: 'start',
    outer_flag_enabled: d.outerFlagEnabled,
    role_authorized: d.roleAuthorized,
    identity_search_allowed: d.identitySearchAllowed,
    requires_identity_search: d.requiresIdentitySearch,
    privacy_state: d.privacyState,
    active_run_found: d.activeRunFound,
    history_classification: d.historyClassification,
    atomic_create_conflict: d.atomicCreateConflict,
    conflict_class: d.conflictClass,
    post_conflict_active_run_found: d.postConflictActiveRunFound,
  } as const;

  if (started.started) {
    return {
      ...base,
      required_max_credits: started.maxCreditsAuthorized,
      accepted_max_credits: acceptedMaxCredits,
      reason: null,
      run_created: true,
    };
  }

  return {
    ...base,
    // En el NO-arranque manda el core: `authorization_ceiling_mismatch` ya devuelve los
    // dos enteros que comparó, y el resto de motivos cortan ANTES de evaluar el techo,
    // así que `null` dice la verdad —no se evaluó— en vez de inventar una comparación.
    required_max_credits: started.requiredMaxCredits ?? null,
    accepted_max_credits: started.acceptedMaxCredits ?? null,
    reason: started.reason,
    run_created: false,
  };
}
