/**
 * run-deadline.ts — el plazo COMPARTIDO de una invocación.
 *
 * AGENT1-APOLLO-CONTINUATION-COMPLETES § 2.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * El corte anterior declaraba «150 s de evaluación + 150 s de etapas
 * posteriores = 300 s» y lo comprobaba en una ASERCIÓN. Eso no es un plazo, es
 * una cuenta: nada impedía que la evaluación se pasara, y nada obligaba a las
 * etapas posteriores a caber. Dos agujeros concretos:
 *
 *   1. la guarda se consultaba ANTES de cada tanda, así que una tanda que
 *      arrancaba a falta de un instante se ejecutaba entera. Con
 *      `verifyWebsite` (8 s) y `checkCompanyDuplicate` (8 s) SECUENCIALES por
 *      organización, esa tanda podía durar ~16 s y llevarse la corrida a ~316 s;
 *   2. la «reserva posterior» no la hacía cumplir nadie.
 *
 * Aquí el plazo es UN objeto que viaja por toda la invocación. Cada etapa
 * pregunta si le queda sitio ANTES de empezar, contando lo que la etapa puede
 * tardar EN EL PEOR CASO y dejando siempre el margen de salida intacto.
 *
 * Puro: el reloj se inyecta. Ni `Date.now()` ni temporizadores.
 */

/** Límite real de una invocación de la plataforma. */
export const RUNTIME_INVOCATION_LIMIT_MS = 300_000;

/**
 * Margen intocable para escribir el checkpoint de pausa, encolar la
 * continuación y devolver la respuesta.
 *
 * Es lo ÚNICO que garantiza que una pausa sea recuperable: si la corrida se
 * queda sin tiempo para escribir su propio estado, el trabajo ya pagado se
 * pierde igual que antes del corte.
 */
export const EXIT_RESERVE_MS = 20_000;

/**
 * Peor caso de UNA tanda de evaluación.
 *
 * `assessCandidate` espera, por organización y en serie, la verificación del
 * sitio (8 s de tope) y la comprobación de duplicados (8 s de tope). Las
 * organizaciones de una tanda corren solapadas, así que la tanda dura lo que la
 * más lenta: ~16 s. Se redondea hacia arriba a propósito.
 */
export const ASSESSMENT_WAVE_WORST_CASE_MS = 18_000;

/**
 * Peor caso de UN enrichment pagado, incluido su registro económico.
 *
 * Se reserva por enrichment PENDIENTE, no una sola vez: cinco enrichments no
 * caben en el hueco de uno.
 */
export const ENRICHMENT_WORST_CASE_MS = 15_000;

/**
 * Peor caso de la escritura del lote: gates finales, writer y checkpoint.
 *
 * Es la etapa que NO puede quedarse sin tiempo, porque a esa altura ya se
 * gastaron créditos y lo que está en juego es que el gasto produzca filas.
 */
export const PERSISTENCE_WORST_CASE_MS = 45_000;

export type RunDeadline = {
  /** Milisegundos hasta el límite duro. Puede ser negativo si ya se pasó. */
  remainingMs: () => number;
  /**
   * ¿Cabe una etapa que en el PEOR caso tarda `worstCaseMs`, dejando intacto el
   * margen de salida?
   */
  hasRoomFor: (worstCaseMs: number) => boolean;
  /**
   * Tope que se le puede dar a UNA operación de red ahora mismo, sin comerse el
   * margen de salida. Nunca por encima de `preferredMs`, nunca negativo.
   */
  operationTimeoutMs: (preferredMs: number) => number;
};

export function createRunDeadline(input: {
  now: () => number;
  startedAtMs: number;
  limitMs?: number;
  exitReserveMs?: number;
}): RunDeadline {
  const limitMs = input.limitMs ?? RUNTIME_INVOCATION_LIMIT_MS;
  const exitReserveMs = input.exitReserveMs ?? EXIT_RESERVE_MS;

  const remainingMs = () => limitMs - (input.now() - input.startedAtMs);

  return {
    remainingMs,
    hasRoomFor: (worstCaseMs) => remainingMs() >= worstCaseMs + exitReserveMs,
    operationTimeoutMs: (preferredMs) => {
      const usable = remainingMs() - exitReserveMs;
      if (usable <= 0) return 0;
      return Math.min(preferredMs, usable);
    },
  };
}

/**
 * Reserva que la corrida debe conservar para TERMINAR lo que ya costó créditos:
 * los enrichments que todavía puede ejecutar más la escritura del lote.
 *
 * Se calcula con los enrichments PENDIENTES —no con el cap— porque una corrida
 * que ya gastó cuatro de cinco no necesita hueco para cinco.
 */
export function downstreamReserveMs(pendingEnrichments: number): number {
  const enrichments = Math.max(0, pendingEnrichments);
  return enrichments * ENRICHMENT_WORST_CASE_MS + PERSISTENCE_WORST_CASE_MS;
}
