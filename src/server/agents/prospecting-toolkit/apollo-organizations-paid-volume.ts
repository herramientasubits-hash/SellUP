/**
 * apollo-organizations-paid-volume.ts — el VOLUMEN que Apollo devolvió y cobró,
 * leído ANTES de que nada local lo recorte.
 *
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-1 · P0-4.
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * La contabilidad agregada de `organizations_search` se derivaba de
 * `paginated.organizations`, que NO es lo que el proveedor devolvió: es lo que
 * quedó después de dos operaciones puramente locales —el dedupe entre páginas y
 * el truncado por `maxCandidates`—. Con dos páginas de 10 y un tope de 10
 * candidatos, Apollo devolvió 20 filas y la fila económica declaraba 10. La
 * reconciliación registraba, literalmente, la mitad del volumen pagado.
 *
 * La autoridad correcta ya existía y estaba a la vista: cada página exitosa
 * registra su propio `resultsReturned` en el ledger por página
 * (`ApolloPageOutcome` / `apollo_page_logs`), tomado del cuerpo normalizado antes
 * de tocar el acumulador. Sumar ESO es sumar lo que salió del proveedor.
 *
 * ── 🔴 Esto sigue siendo una ESTIMACIÓN, y lo dice ───────────────────────────
 *
 * P0-1 —el contrato de facturación escrito de Apollo para Organization Search—
 * sigue sin confirmación externa. Este módulo NO decide que la búsqueda sea
 * gratuita, ni que se cobre por petición, ni que se cobre por resultado, ni que
 * el volumen mostrado sean los créditos facturados. Arregla de qué CIFRA se
 * deriva la contabilidad, no bajo qué contrato se factura, y publica esa
 * distinción en la propia metadata: `provider_reported: false`.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

/** Lo mínimo que hace falta leer de una página ya intentada. */
export type ApolloPaidPageObservation = {
  status: 'success' | 'error' | 'rate_limited' | 'indeterminate';
  resultsReturned: number;
  /**
   * AGENT1-APOLLO-NET-NEW-PAGINATION § 5 — créditos YA calculados para esta
   * página bajo el modelo real de facturación (1 por página no vacía, 0 si
   * vino vacía). Ésta es la cifra que debe convertirse en `credits_used`, NUNCA
   * `resultsReturned`: sumar resultados vuelve a facturar por fila devuelta.
   */
  estimatedCredits: number;
};

/** De dónde sale la cifra. Estable y grep-able. */
export const APOLLO_PAID_VOLUME_SOURCE = 'apollo_page_outcomes_pre_truncation' as const;

/**
 * Bajo qué modelo se interpreta ese volumen como créditos.
 *
 * 🔴 El nombre dice explícitamente que el proveedor no lo ha confirmado. Un
 * consumidor que lo lea no puede confundirlo con la factura.
 */
export const APOLLO_PAID_VOLUME_ESTIMATE_BASIS =
  'results_volume_model_provider_unconfirmed' as const;

export type ApolloPaidResultsVolume = {
  /** Filas que el proveedor devolvió, sumadas sobre las páginas exitosas. */
  resultsVolume: number;
  /** Cuántas páginas exitosas entraron en la suma. */
  pagesCounted: number;
  /**
   * AGENT1-APOLLO-NET-NEW-PAGINATION § 5 — créditos REALES a facturar: la suma
   * de `estimatedCredits` por página (1 por página no vacía, 0 si vino vacía).
   * Es la única cifra que debe alimentar `creditsForApolloOperation`; jamás
   * `resultsVolume`, que es un conteo de FILAS, no de créditos.
   */
  creditsCharged: number;
  source: typeof APOLLO_PAID_VOLUME_SOURCE;
  /** Nunca `true` en este hito: Apollo no reporta créditos por esta operación. */
  providerReported: false;
  estimateBasis: typeof APOLLO_PAID_VOLUME_ESTIMATE_BASIS;
};

/**
 * Suma el volumen devuelto por el proveedor y los créditos REALES a facturar.
 *
 * Sólo las páginas EXITOSAS aportan: una página con error, con cuota agotada o
 * indeterminada no trajo filas, y las suyas ya se registran en 0. Fabricar un
 * volumen para ellas sería inventar un cargo que nadie observó — exactamente lo
 * que el punto C de las pruebas prohíbe.
 *
 * Una página vacía aporta 0 filas y 0 créditos. Eso NO afirma que costara cero
 * por decisión de este módulo: afirma que devolvió cero filas, que es lo único
 * observado, y bajo el modelo confirmado por Apollo Support (1 crédito por
 * página NO vacía) eso también es 0 créditos.
 */
export function resolveApolloPaidResultsVolume(
  pageObservations: readonly ApolloPaidPageObservation[],
): ApolloPaidResultsVolume {
  let resultsVolume = 0;
  let creditsCharged = 0;
  let pagesCounted = 0;

  for (const observation of pageObservations) {
    if (observation.status !== 'success') continue;
    if (!Number.isFinite(observation.resultsReturned)) continue;
    resultsVolume += Math.max(0, Math.trunc(observation.resultsReturned));
    if (Number.isFinite(observation.estimatedCredits)) {
      creditsCharged += Math.max(0, Math.trunc(observation.estimatedCredits));
    }
    pagesCounted++;
  }

  return {
    resultsVolume,
    pagesCounted,
    creditsCharged,
    source: APOLLO_PAID_VOLUME_SOURCE,
    providerReported: false,
    estimateBasis: APOLLO_PAID_VOLUME_ESTIMATE_BASIS,
  };
}

/** Clave del bloque en `metadata`. */
export const APOLLO_PAID_VOLUME_METADATA_KEY = 'apollo_paid_volume' as const;

/**
 * Bloque plano para `provider_usage_logs.metadata`.
 *
 * Publica las DOS cifras y su diferencia: la pagada y la que quedó tras el
 * recorte local. Sin las dos juntas, quien audite no puede distinguir «Apollo
 * devolvió poco» de «devolvió mucho y lo truncamos».
 */
export function toApolloPaidVolumeMetadata(
  volume: ApolloPaidResultsVolume,
  collectedAfterLocalFilters: number,
): Record<string, unknown> {
  return {
    paid_results_volume: volume.resultsVolume,
    pages_counted: volume.pagesCounted,
    credits_charged: volume.creditsCharged,
    collected_after_local_filters: collectedAfterLocalFilters,
    discarded_by_local_dedupe_or_truncation: Math.max(
      0,
      volume.resultsVolume - collectedAfterLocalFilters,
    ),
    source: volume.source,
    provider_reported: volume.providerReported,
    estimate_basis: volume.estimateBasis,
  };
}
