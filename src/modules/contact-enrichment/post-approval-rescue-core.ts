// Agente 2A — PARIDAD DE RESCATE del reveal en la ficha del contacto OFICIAL
// (AGENT2A-POST-APPROVAL-RESCUE-PARITY)
//
// ═══════════════════════════════════════════════════════════════
// EL DEFECTO QUE ESTE MÓDULO CIERRA
// ═══════════════════════════════════════════════════════════════
//
// La ficha del CANDIDATO tiene CUATRO superficies para conseguir un teléfono, y el operador las
// usa en cascada:
//
//   1. el reveal principal            → waterfall Apollo → Lusha  (`revealCandidatePhoneAction`)
//   2. la revisión manual del resultado → `recoverCandidatePhoneRevealNowAction`
//   3. la continuación a Lusha          → `startLegacyPhoneRevealWaterfallAction`
//   4. «Buscar más números»             → `searchMoreCandidatePhonesAction`
//
// La ficha del CONTACTO OFICIAL sólo tenía la 1. Y la 1, por sí sola, es asíncrona: Apollo acepta
// y contesta por webhook. Si ese webhook tarda, se pierde, o vuelve sin número, en la ficha del
// contacto NO HABÍA NADA que pudiera mover el caso — ni desatascarlo, ni continuar a Lusha, ni
// pedir números adicionales. Por eso «se queda cargando y no encuentra teléfono»: no era un
// spinner mal pintado, era una pantalla sin salidas.
//
// ── LO QUE ESTE MÓDULO NO HACE, Y ES SU RAZÓN DE SER ───────────
//
// No construye un segundo waterfall, ni un segundo Search More, ni un segundo recovery. Las
// cuatro tuberías ya existen, están probadas y están keyed por `candidateId`. Este hito resuelve
// el candidato fuente del contacto —con la MISMA prueba durable de #352— y DELEGA. Aquí sólo se
// decide QUÉ ofrecer; el precio, el presupuesto, la reserva, la privacidad y el claim atómico
// siguen viviendo donde ya vivían.
//
// Sin red, sin DB, sin auth, sin reloj y sin un solo import de servidor.

import {
  classifyCandidateRevealDurableState,
  type CandidateRevealDurableState,
} from './post-approval-reveal-core';

// ── Entrada ────────────────────────────────────────────────────

/**
 * Vista previa de la continuación a Lusha, tal cual la devuelve
 * `getLegacyPhoneRevealAuthorizationPreviewAction`. NO se recalcula nada de ella: el tope que el
 * operador lee es el que el servidor exigirá.
 */
export interface LegacyContinuationPreview {
  readonly eligible: boolean;
  readonly maxCredits: number | null;
  readonly requiresIdentitySearch: boolean;
}

/**
 * Resumen del preflight de «Buscar más números», tal cual lo devuelve
 * `getSearchMorePhonesPreflightAction`. `available` es la decisión del propio subsistema —flag,
 * rol, presupuesto, plan—: aquí no se re-deriva, se respeta.
 */
export interface SearchMorePreflight {
  readonly available: boolean;
  readonly maxCredits: number | null;
}

export interface OfficialContactRescueInput {
  /** Estado durable del reveal del candidato fuente. */
  readonly revealState: CandidateRevealDurableState;
  /** ¿El contacto ya tiene algún teléfono vivo? Cambia qué rescate tiene sentido, no si lo hay. */
  readonly contactHasPhone: boolean;
  /**
   * ¿Hay un identificador recuperable de Apollo (`apollo_http_request_id`)? Sin él la revisión
   * manual no tiene a qué preguntar: el recovery es un `GET /webhook_result/{id}`.
   */
  readonly hasRecoveryHandle: boolean;
  readonly legacy: LegacyContinuationPreview | null;
  readonly searchMore: SearchMorePreflight | null;
}

// ── Salida ─────────────────────────────────────────────────────

/**
 * Qué puede hacer el operador AHORA, además del reveal principal. Las tres son independientes:
 * un caso atascado puede admitir revisión manual y todavía no admitir Lusha.
 */
export interface OfficialContactRescueView {
  /**
   * Revisar AHORA el resultado de un Apollo en vuelo. GRATIS por contrato del recovery: no inicia
   * un reveal, hace como máximo UN `GET` al endpoint de resultado. Es la salida del «se queda
   * cargando».
   */
  readonly recovery: { readonly available: boolean };
  /**
   * Continuar a Lusha cuando Apollo cerró sin número. `maxCredits` es el tope LEÍDO, que viaja al
   * servidor como límite superior duro.
   */
  readonly lushaContinuation: {
    readonly available: boolean;
    readonly maxCredits: number | null;
    readonly requiresIdentitySearch: boolean;
  };
  /** Buscar números ADICIONALES en Lusha. Existe aunque ya haya un teléfono: ése es su caso. */
  readonly searchMore: { readonly available: boolean; readonly maxCredits: number | null };
}

const NOTHING: OfficialContactRescueView = {
  recovery: { available: false },
  lushaContinuation: { available: false, maxCredits: null, requiresIdentitySearch: false },
  searchMore: { available: false, maxCredits: null },
};

/**
 * Decide las tres ofertas de rescate.
 *
 * Cada una tiene su propia condición porque cada una responde a una pregunta distinta, y
 * colapsarlas en «¿el reveal terminó?» es justamente lo que dejaba la pantalla sin salidas:
 *
 *   * REVISIÓN MANUAL — sólo mientras el reveal está EN VUELO y hay identificador recuperable.
 *     Es la única acción que tiene sentido sobre un caso atascado, y es la única gratis. Sobre un
 *     caso ya terminal no hay nada que recuperar: el resultado ya está escrito.
 *
 *   * CONTINUACIÓN A LUSHA — sólo cuando el reveal YA cerró y cerró SIN número
 *     (`no_phone_found` o `error`), y el subsistema legacy dice que es elegible. Ofrecerla con
 *     Apollo todavía en vuelo compraría Lusha para una pregunta que Apollo aún puede contestar
 *     gratis; ofrecerla tras un `revealed` compraría un número que ya está pagado.
 *
 *   * BUSCAR MÁS NÚMEROS — sólo cuando el reveal ya NO está en vuelo. A diferencia de las otras
 *     dos, sigue teniendo sentido con teléfono presente: su propósito es precisamente el número
 *     adicional. Lo decide su propio preflight; aquí sólo se le impide pisar una corrida viva.
 *
 * Fail-closed en bloque: un estado durable ilegible no ofrece NADA. Sobre un candidato cuyo
 * estado nadie entiende no se autoriza ni una llamada gratis.
 */
export function classifyOfficialContactRescue(
  input: OfficialContactRescueInput,
): OfficialContactRescueView {
  const state = input.revealState;
  if (state === 'unreadable') return NOTHING;

  const inFlight = state === 'in_flight';
  const closedWithoutPhone = state === 'terminal_no_phone' || state === 'terminal_failed';

  return {
    recovery: { available: inFlight && input.hasRecoveryHandle },
    lushaContinuation: {
      available: closedWithoutPhone && !input.contactHasPhone && input.legacy?.eligible === true,
      maxCredits: input.legacy?.maxCredits ?? null,
      requiresIdentitySearch: input.legacy?.requiresIdentitySearch === true,
    },
    searchMore: {
      available: !inFlight && input.searchMore?.available === true,
      maxCredits: input.searchMore?.maxCredits ?? null,
    },
  };
}

/** ¿Alguna de las tres se puede accionar? Si no, la ficha no pinta la sección de rescate. */
export function hasAnyOfficialContactRescue(view: OfficialContactRescueView): boolean {
  return (
    view.recovery.available || view.lushaContinuation.available || view.searchMore.available
  );
}

/** Atajo para el llamador: clasifica desde el valor CRUDO de la columna, sin repetir el mapeo. */
export function classifyOfficialContactRescueFromStatus(
  rawStatus: string | null | undefined,
  rest: Omit<OfficialContactRescueInput, 'revealState'>,
): OfficialContactRescueView {
  return classifyOfficialContactRescue({
    ...rest,
    revealState: classifyCandidateRevealDurableState(rawStatus),
  });
}
