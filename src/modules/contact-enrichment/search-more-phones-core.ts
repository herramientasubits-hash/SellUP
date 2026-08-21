// Agente 2A — DESENLACE de una corrida «Buscar más números»
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// ═══════════════════════════════════════════════════════════════════
// QUÉ DECIDE
// ═══════════════════════════════════════════════════════════════════
//
// Traduce «qué contestó el proveedor» + «qué se pudo guardar» en el patch con el que la
// corrida se CIERRA. Es la pieza donde se decide qué se AFIRMA en el ledger, y por eso está
// separada del cableado: la diferencia entre `no_phone_found` y `no_new_distinct_phone` no
// es un detalle de formato, es la diferencia entre afirmar que el proveedor no tiene
// teléfono para esa persona y afirmar que lo tiene y ya lo teníamos.
//
// PURO: sin I/O, sin env, sin reloj propio (el instante entra como argumento), sin
// `console`. Se prueba offline.
//
// ═══════════════════════════════════════════════════════════════════
// LO QUE ESTE MÓDULO NO HACE
// ═══════════════════════════════════════════════════════════════════
//
//   * NO liquida la reserva. Eso lo hace el mismo camino que ya lo hace para el waterfall,
//     al volverse terminal la corrida, y no se duplica aquí;
//   * NO escribe el usage log. El costo lo reporta el proveedor y se registra donde ya se
//     registra;
//   * NO toca el candidato. El estado terminal del reveal es de OTRA autorización y una
//     corrida `search_more` no lo reescribe — ver la migración 122;
//   * NO decide elegibilidad. Eso es del planificador.

import type { PhoneRevealWaterfallRunPatch } from './phone-reveal-waterfall-core';

// ═══════════════════════════════════════════════════════════════════
// 1. Lo que el proveedor contestó
// ═══════════════════════════════════════════════════════════════════

/**
 * Desenlace CRUDO de la llamada, antes de saber cuántos números eran nuevos. Es
 * deliberadamente más pobre que el desenlace final: `revealed` aquí sólo significa «el
 * proveedor devolvió al menos un número», no «SellUp ganó un número».
 */
export type SearchMoreProviderCallOutcome =
  /** El proveedor devolvió al menos un número. */
  | 'revealed'
  /** El proveedor contestó y no tiene teléfono para esa persona. */
  | 'no_phone_found'
  /** Fallo técnico: red, HTTP, respuesta malformada. NO es un hecho sobre la persona. */
  | 'error';

/**
 * Desenlace de la ESCRITURA, tal como lo devuelve
 * `append_candidate_search_more_phones` (migración 122).
 */
export type SearchMorePersistStatus =
  | 'persisted'
  | 'no_incoming_phones'
  /** La supresión por persona o por número bloqueó bajo el lock. */
  | 'suppressed'
  | 'candidate_not_eligible'
  | 'invalid_input'
  /** La escritura no se pudo ejecutar (función ausente, timeout, permisos). */
  | 'unavailable';

export interface SearchMoreOutcomeInput {
  providerOutcome: SearchMoreProviderCallOutcome;
  /**
   * Desenlace de la escritura. `null` cuando NO se llegó a escribir porque el proveedor no
   * devolvió números — no se inventa un `no_incoming_phones` que la base nunca produjo.
   */
  persistStatus: SearchMorePersistStatus | null;
  /**
   * Números DISTINTOS que la colección no tenía antes, DERIVADO por la migración 122. Sólo
   * es significativo cuando `persistStatus === 'persisted'`.
   */
  newDistinctPhoneCount: number;
  /** Costo que el proveedor reportó. `null` = no reportado, NUNCA 0. */
  costCredits: number | null;
  nowIso: string;
}

// ═══════════════════════════════════════════════════════════════════
// 2. El desenlace
// ═══════════════════════════════════════════════════════════════════

export interface SearchMoreOutcome {
  /** Patch con el que la corrida se cierra. */
  patch: PhoneRevealWaterfallRunPatch;
  /**
   * Qué se le dice al operador. Vocabulario cerrado; cada valor tiene su copy en
   * `search-more-phones-copy.ts`.
   */
  result:
    | 'new_phones_found'
    | 'no_new_phones'
    | 'privacy_blocked'
    | 'provider_error';
  /** Cuántos números adicionales se añadieron. 0 en todo lo que no sea éxito. */
  newDistinctPhoneCount: number;
}

/**
 * Confianza del costo. Un número finito (incluido 0 explícito) es `reported`; la AUSENCIA
 * de dato es `unknown`, nunca 0 — no reportar no es lo mismo que no cobrar.
 */
function costSourceOf(credits: number | null): 'reported' | 'unknown' {
  return typeof credits === 'number' && Number.isFinite(credits) ? 'reported' : 'unknown';
}

/**
 * EL clasificador. El orden de las ramas es el orden de la verdad: primero los casos en los
 * que NO se puede afirmar nada sobre los datos (error, privacidad), y sólo después los que
 * describen lo que el proveedor tiene.
 *
 * La corrida se cierra SIEMPRE. Una corrida `search_more` que quedara viva bloquearía la
 * siguiente por el índice único parcial de la migración 102, así que dejarla abierta ante un
 * desenlace inesperado convertiría un fallo en una inhabilitación permanente del botón.
 */
export function resolveSearchMoreOutcome(
  input: SearchMoreOutcomeInput,
): SearchMoreOutcome {
  const costSource = costSourceOf(input.costCredits);
  // `lusha_attempted_at` NO viaja aquí: lo sella el CLAIM ATÓMICO
  // (`UPDATE … WHERE lusha_attempted_at IS NULL`) ANTES de llamar al proveedor, y ese orden
  // es justamente lo que hace que la pata se ejecute a lo sumo una vez. Volver a escribirlo
  // al cerrar movería la marca de «se reclamó» a «se terminó» y perdería la garantía.
  const base = {
    lushaCostCredits: input.costCredits,
    lushaCostSource: costSource,
    completedAt: input.nowIso,
  } satisfies Partial<PhoneRevealWaterfallRunPatch>;

  // ── Fallo técnico ────────────────────────────────────────────
  // `error` y NO `no_phone_found`: un fallo de red no es evidencia de que el proveedor no
  // tenga teléfono, y registrarlo como tal cerraría la puerta a un reintento legítimo y
  // mentiría en el ledger sobre lo que se sabe de esa persona.
  if (input.providerOutcome === 'error') {
    return {
      patch: {
        ...base,
        status: 'error',
        lushaOutcome: 'error',
        finalProvider: 'none',
        errorCode: 'provider_error',
      },
      result: 'provider_error',
      newDistinctPhoneCount: 0,
    };
  }

  // ── Bloqueo de privacidad bajo el lock ───────────────────────
  // El proveedor YA cobró cuando esto ocurre, así que el costo se registra ENTERO: lo que
  // se retiene es el NÚMERO, nunca el gasto. Registrar 0 aquí perdería un cobro real.
  if (input.persistStatus === 'suppressed') {
    return {
      patch: {
        ...base,
        status: 'aborted',
        lushaOutcome: 'no_new_distinct_phone',
        lushaSkippedReason: 'suppressed',
        finalProvider: 'none',
        errorCode: 'blocked_suppressed',
      },
      result: 'privacy_blocked',
      newDistinctPhoneCount: 0,
    };
  }

  // Una escritura que no se pudo ejecutar NO es «no hay números nuevos»: el proveedor
  // contestó y quizá con números, y no se sabe qué habría pasado. Se cierra como error para
  // no afirmar un hecho que no se obtuvo, y el costo se conserva igual.
  if (
    input.persistStatus === 'unavailable' ||
    input.persistStatus === 'invalid_input' ||
    input.persistStatus === 'candidate_not_eligible'
  ) {
    return {
      patch: {
        ...base,
        status: 'error',
        lushaOutcome: 'error',
        finalProvider: 'none',
        errorCode: 'persist_unavailable',
      },
      result: 'provider_error',
      newDistinctPhoneCount: 0,
    };
  }

  // ── El proveedor no tiene teléfono ───────────────────────────
  if (input.providerOutcome === 'no_phone_found') {
    return {
      patch: {
        ...base,
        status: 'exhausted',
        lushaOutcome: 'no_phone_found',
        finalProvider: 'none',
        errorCode: null,
      },
      result: 'no_new_phones',
      newDistinctPhoneCount: 0,
    };
  }

  // ── El proveedor contestó con números ────────────────────────
  const added = Number.isInteger(input.newDistinctPhoneCount)
    ? Math.max(0, input.newDistinctPhoneCount)
    : 0;

  if (added === 0) {
    // AQUÍ vive el desenlace que sólo esta operación puede producir: Lusha contestó, se
    // cobró, y todos sus números ya estaban. `exhausted` describe la corrida (no queda nada
    // que sacar de esta fuente) y `no_new_distinct_phone` describe el hecho, sin decir que
    // el proveedor no tenga teléfono — lo tiene, y es el mismo.
    //
    // `finalProvider: 'none'` porque NINGÚN proveedor produjo un número que SellUp no
    // tuviera. La procedencia adicional que la fila de teléfono sí ganó vive en
    // `contact_enrichment_candidate_phone_sources`, que es su sitio.
    return {
      patch: {
        ...base,
        status: 'exhausted',
        lushaOutcome: 'no_new_distinct_phone',
        finalProvider: 'none',
        errorCode: null,
      },
      result: 'no_new_phones',
      newDistinctPhoneCount: 0,
    };
  }

  return {
    patch: {
      ...base,
      status: 'completed_lusha',
      lushaOutcome: 'revealed',
      finalProvider: 'lusha',
      errorCode: null,
    },
    result: 'new_phones_found',
    newDistinctPhoneCount: added,
  };
}
