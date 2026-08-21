/**
 * provider-result-demand.ts — cuántos resultados debe pedir el proveedor de pago,
 * derivado del hueco que la capa gratuita dejó abierto.
 *
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 3, 4, 5, 6.
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * La capa previa al pago ya resolvía `residualGap` —cuántas empresas FALTAN de
 * verdad— pero la ruta Apollo nunca lo recibía: seguía pidiendo su techo fijo.
 * Con objetivo 10 y 7 empresas ya cerradas gratis, Apollo pedía 10.
 *
 * La consecuencia no era sólo económica. `run-prepaid-novelty-discovery.server.ts`
 * declaraba la ruta Apollo `partialGapSupported: false` —TODO-O-NADA— precisamente
 * porque el ejecutor de pago no sabía aceptar un objetivo reducido, así que un
 * hueco parcial se DESCARTABA entero. Esa bandera existe por la costura que este
 * módulo abre.
 *
 * 🔴 REVIEW-1 § 2 — la costura está abierta y probada, pero la ruta Apollo VIVA
 * sigue en `partialGapSupported: false` (`WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED`).
 * La capacidad es de este módulo; la activación es una decisión de producto que
 * pertenece a `AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1`, porque hoy el aporte
 * gratuito y el de pago viven en LOTES distintos. Este módulo no la enciende: sólo
 * responde honestamente al hueco que le pasen, incluido el hueco entero.
 *
 * ── 🔴 DEMANDA DE RESULTADOS ≠ RESERVA FINANCIERA (§ 5) ──────────────────────
 *
 * Este módulo dice cuántos resultados PEDIR. No dice —y no puede empezar a
 * decir— cuántos créditos reservar. P0-1 sigue abierto: no hay evidencia escrita
 * de Apollo sobre si Organization Search factura por petición, por organización
 * devuelta, por página o de ninguna forma. Derivar la reserva de este número
 * afirmaría un modelo de facturación que nadie ha confirmado, y lo haría en la
 * dirección peligrosa: hacia abajo.
 *
 * La reserva la sigue fijando `estimateCreditsForProvider(provider)`, que sólo
 * recibe el proveedor —ni objetivo, ni hueco, ni demanda— y el peor caso de la
 * modalidad (`estimateApolloTwoRoundBudget(config)`), que se deriva de
 * `maxResultsPerRound × maxRounds` y del cap de enrichment. Ninguno de los dos
 * ve un `remainingTarget`, y el ratchet estático de este corte lo defiende.
 *
 * ── 🔴 `remainingTarget`, no un segundo `residualGap` (§ 3) ──────────────────
 *
 * `residualGap` es el nombre de la capa gratuita y sigue siendo suyo. El nombre de
 * este lado ya existía en el repo —`buildRound2Hypothesis` recibe `remainingTarget`
 * desde antes de este corte— así que se reutiliza en vez de acuñar un tercero. Un
 * mismo hecho con tres nombres es cómo dos capas empiezan a discrepar sin que
 * nadie lo note.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

/** De dónde salió la demanda. Estable y grep-able. */
export type ProviderResultDemandSource =
  /** La capa previa al pago corrió y su hueco gobierna. */
  | 'prepaid_novelty_residual_gap'
  /**
   * No hubo capa previa (dep ausente, fallo degradado a null). El objetivo entero
   * es el hueco y la ruta se comporta EXACTAMENTE como antes de este corte.
   */
  | 'prepaid_layer_absent';

/**
 * Lo que el proveedor de pago debe buscar en ESTA invocación.
 *
 * 🔴 `remainingTarget <= requestedTarget` por construcción, y `providerRequired`
 * se deriva de él: no son dos hechos que puedan discrepar.
 */
export type ProviderResultDemand = {
  /** El objetivo del USUARIO. Nunca se reescribe. */
  requestedTarget: number;
  /** Empresas útiles que la capa gratuita ya cerró y PERSISTIÓ. */
  acceptedBeforeProvider: number;
  /** Lo que falta. El techo de la demanda de resultados de esta corrida. */
  remainingTarget: number;
  /** `false` ⇒ el proveedor no debe ejecutar. */
  providerRequired: boolean;
  source: ProviderResultDemandSource;
};

function sanitizeCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * La demanda de una corrida SIN capa previa al pago.
 *
 * Reproduce byte a byte el comportamiento anterior a este corte: el hueco es el
 * objetivo entero, así que ningún tope se recorta.
 */
export function fullTargetResultDemand(requestedTarget: number): ProviderResultDemand {
  const target = sanitizeCount(requestedTarget);
  return {
    requestedTarget: target,
    acceptedBeforeProvider: 0,
    remainingTarget: target,
    providerRequired: target > 0,
    source: 'prepaid_layer_absent',
  };
}

/**
 * Deriva la demanda del resultado de la capa previa al pago.
 *
 * 🔴 No recalcula el hueco: lo LEE. `residualGap` ya lo resolvió
 * `buildPrePaidNoveltyContext`, que además lo reajustó a lo REALMENTE persistido
 * (`withFreeSourcePersistenceOutcome`). Recalcularlo aquí desde `requestedTarget -
 * acceptedBeforeProvider` crearía una segunda definición que podría discrepar de
 * la primera en cuanto una de las dos cambiara.
 *
 * Lo único que se impone es la cota superior: un hueco mayor que el objetivo no
 * puede autorizar pedir más de lo que el usuario pidió.
 */
export function resolveProviderResultDemand(
  outcome: {
    requestedTarget: number;
    acceptedBeforeProvider: number;
    residualGap: number;
    providerRequired: boolean;
  } | null,
  fallbackRequestedTarget: number,
): ProviderResultDemand {
  if (outcome === null) return fullTargetResultDemand(fallbackRequestedTarget);

  const requestedTarget = sanitizeCount(outcome.requestedTarget);
  const acceptedBeforeProvider = Math.min(
    sanitizeCount(outcome.acceptedBeforeProvider),
    requestedTarget,
  );
  const remainingTarget = Math.min(sanitizeCount(outcome.residualGap), requestedTarget);

  return {
    requestedTarget,
    acceptedBeforeProvider,
    remainingTarget,
    // 🔴 Se deriva del hueco resuelto, no se copia del outcome: un `providerRequired`
    // que no coincidiera con su propio hueco es un estado imposible que no debe
    // poder viajar.
    providerRequired: remainingTarget > 0,
    source: 'prepaid_novelty_residual_gap',
  };
}

/**
 * Recorta un tope configurado a lo que de verdad falta.
 *
 * Es la ÚNICA operación que aplica la cota, y por eso vive aquí en vez de
 * repetirse como un `Math.min` suelto en cada punto de uso: tres `Math.min`
 * idénticos en tres archivos son tres sitios donde uno se puede olvidar.
 *
 * 🔴 Nunca sube un tope. Con `remainingTarget` mayor que el configurado gana el
 * configurado: la capa gratuita puede reducir la demanda, jamás ampliarla por
 * encima del techo que los guardrails ya autorizaron.
 */
export function boundByRemainingTarget(configuredCeiling: number, remainingTarget: number): number {
  const ceiling = sanitizeCount(configuredCeiling);
  const remaining = sanitizeCount(remainingTarget);
  return Math.min(ceiling, remaining);
}

/** Clave del bloque en `metadata`. */
export const PROVIDER_RESULT_DEMAND_METADATA_KEY = 'provider_result_demand' as const;

/** Bloque plano y sin PII. snake_case, como el resto de la metadata de corrida. */
export function toProviderResultDemandMetadata(
  demand: ProviderResultDemand,
): Record<string, unknown> {
  return {
    requested_target: demand.requestedTarget,
    accepted_before_provider: demand.acceptedBeforeProvider,
    remaining_target: demand.remainingTarget,
    provider_required: demand.providerRequired,
    source: demand.source,
  };
}
