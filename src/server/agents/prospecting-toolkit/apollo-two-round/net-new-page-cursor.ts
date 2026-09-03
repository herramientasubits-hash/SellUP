/**
 * net-new-page-cursor.ts — cursor de página NET-NEW por PLAN DE BÚSQUEDA.
 *
 * A1-APOLLO-NET-NEW-PAGINATION-V2.
 *
 * La corrida live que motivó este corte pidió, con el mismo plan de búsqueda:
 *
 *   ronda 1 · páginas 1, 2, 3, 4
 *   ronda 2 · páginas 2, 3, 4, 5
 *
 * Tres de las cuatro páginas de la ronda 2 eran páginas que la ronda 1 ya había
 * pagado. La causa no es el motor de paginación —dentro de una invocación nunca
 * repite página— sino la unidad lógica con la que se elige la página de ARRANQUE
 * de la ronda 2: hasta este corte era un literal (`2`), bajo el supuesto de que
 * una ronda nueva estrena universo de páginas.
 *
 * No lo estrena. La unidad lógica del universo de páginas es el PLAN DE BÚSQUEDA
 * —`search_plan_fingerprint`, la huella del body efectivo SIN `page`, que ya
 * existe como `filtersFingerprint` en el contrato y como `requestFingerprint` en
 * la búsqueda paginada—. La ronda es sólo una etapa de ejecución de ese plan:
 *
 *     mismo fingerprint + ronda nueva  ≠  universo de páginas nuevo
 *     fingerprint distinto             =  universo de páginas independiente
 *
 * Este módulo es puro: sin I/O, sin reloj, sin env. Sólo traduce desenlaces de
 * página observados a «cuál es la primera página que este plan todavía no ha
 * consumido».
 *
 * 🔴 Este módulo NO decide gasto ni toca la facturación. Bajo el modelo vigente
 * (1 crédito por página NO VACÍA, 0 por página vacía) el objetivo es exactamente
 * el contrario: con el MISMO techo de páginas y créditos, que las páginas que se
 * pagan sean páginas nuevas.
 */

// ─── Desenlace de una página, reducido a lo que el cursor necesita ────────────

/**
 * Un desenlace de página tal como lo publica `ApolloPageOutcome`
 * (`apollo-organizations-paginated-search.ts`), reducido a los tres campos que
 * deciden si esa página quedó consumida.
 */
export type ApolloPageConsumptionOutcome = {
  page: number;
  status: 'success' | 'error' | 'rate_limited' | 'indeterminate';
  billingState: 'not_charged' | 'charged' | 'unknown';
};

/**
 * ¿Esta página quedó CONSUMIDA, es decir, no puede volver a pedirse como si
 * fuera nueva?
 *
 * Fail-closed a propósito, y en la dirección que protege el dinero:
 *
 *   - `success`      — la página se entregó. Cuenta aunque haya venido VACÍA y
 *                      por tanto `not_charged` (§ #380): volver a pedirla
 *                      devolvería lo mismo, o peor, ya no vendría vacía y se
 *                      pagaría por contenido que el plan ya recorrió.
 *   - `indeterminate`— el desenlace nunca se confirmó y Apollo pudo cobrarla.
 *                      Se trata como consumida: «todavía no aparece como
 *                      charged» NO es permiso para volver a pedirla.
 *   - `charged` / `unknown` — hay exposición de cobro registrada. Igual.
 *
 * Lo único que NO consume es una página cuyo fallo dejó constancia explícita de
 * que Apollo no llegó a cobrarla (`not_charged`) y que tampoco se entregó: un
 * `durable_fence_write_failed` antes del envío, o un rechazo pre-cobro. Ésa sí
 * está genuinamente disponible.
 *
 * 🔴 Esta función NO sustituye a la valla durable de página
 * (`page-fence.ts`). La valla sigue siendo quien BLOQUEA una invocación entera
 * cuando un plan tiene una página `request_started`/`indeterminate` sin
 * reconciliar; este cursor sólo elige por dónde seguir cuando sí se puede
 * seguir.
 */
export function isApolloPageConsumed(outcome: ApolloPageConsumptionOutcome): boolean {
  if (!Number.isFinite(outcome.page) || outcome.page < 1) return false;
  if (outcome.status === 'success' || outcome.status === 'indeterminate') return true;
  return outcome.billingState !== 'not_charged';
}

// ─── Consumo por plan ─────────────────────────────────────────────────────────

/** Lo que UNA búsqueda dejó consumido, medido sobre desenlaces observados. */
export type ApolloSearchPlanPageConsumption = {
  /**
   * Huella del plan que la PROPIA búsqueda declaró (`request_fingerprint`), si la
   * declaró.
   *
   * `null` cuando la búsqueda no la publica. No es la clave con la que el cursor
   * indexa —esa es la del plan que la ronda construyó, ver el orquestador— sino
   * la comprobación cruzada: si la búsqueda dice pertenecer a OTRO plan, sus
   * páginas no se atribuyen a éste.
   */
  searchPlanFingerprint: string | null;
  /** Páginas consumidas, ascendentes y sin repetidos. */
  consumedPages: number[];
  /** La más alta de `consumedPages`. `null` cuando ninguna página quedó consumida. */
  lastConsumedPage: number | null;
};

/**
 * Reduce los desenlaces de UNA invocación al consumo de su plan.
 *
 * Los reintentos de la misma página (varios `attempt`) colapsan a una sola
 * entrada: el cursor cuenta páginas, no intentos.
 */
export function summarizeApolloSearchPlanPageConsumption(
  searchPlanFingerprint: string | null,
  outcomes: readonly ApolloPageConsumptionOutcome[],
): ApolloSearchPlanPageConsumption {
  const consumed = new Set<number>();
  for (const outcome of outcomes) {
    if (isApolloPageConsumed(outcome)) consumed.add(Math.floor(outcome.page));
  }
  const consumedPages = [...consumed].sort((a, b) => a - b);
  return {
    searchPlanFingerprint,
    consumedPages,
    lastConsumedPage: consumedPages.length === 0 ? null : consumedPages[consumedPages.length - 1]!,
  };
}

// ─── Cursor acumulado de la corrida ───────────────────────────────────────────

/**
 * Página más alta consumida por cada plan de búsqueda de la corrida.
 *
 * Inmutable por contrato: `withApolloSearchPlanPageConsumption` devuelve un mapa
 * NUEVO. Un cursor que se mutara en sitio podría avanzar por efecto de una rama
 * que después no llegó a ejecutarse.
 */
export type ApolloSearchPlanPageCursors = ReadonlyMap<string, number>;

export const EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS: ApolloSearchPlanPageCursors = new Map();

/** Incorpora el consumo de una ronda al cursor. Monótono: nunca retrocede. */
export function withApolloSearchPlanPageConsumption(
  cursors: ApolloSearchPlanPageCursors,
  consumption: {
    searchPlanFingerprint: string | null;
    lastConsumedPage: number | null;
  } | null,
): ApolloSearchPlanPageCursors {
  if (consumption === null) return cursors;
  const { searchPlanFingerprint, lastConsumedPage } = consumption;
  if (typeof searchPlanFingerprint !== 'string' || searchPlanFingerprint.length === 0) {
    return cursors;
  }
  if (typeof lastConsumedPage !== 'number' || !Number.isFinite(lastConsumedPage)) {
    return cursors;
  }
  const page = Math.floor(lastConsumedPage);
  if (page < 1) return cursors;

  const current = cursors.get(searchPlanFingerprint);
  if (typeof current === 'number' && current >= page) return cursors;

  const next = new Map(cursors);
  next.set(searchPlanFingerprint, page);
  return next;
}

/**
 * Primera página que ESTE plan de búsqueda todavía no ha consumido.
 *
 * `nextPage = última página consumida del plan + 1`.
 *
 * Un plan del que no consta consumo alguno devuelve 1: un fingerprint distinto
 * es un universo de paginación INDEPENDIENTE y no hereda el cursor de otro plan.
 * Nunca se adivina un número mayor por el hecho de que otro plan haya avanzado.
 */
export function resolveApolloNextNetNewPage(
  cursors: ApolloSearchPlanPageCursors,
  searchPlanFingerprint: string | null,
): number {
  if (typeof searchPlanFingerprint !== 'string' || searchPlanFingerprint.length === 0) return 1;
  const last = cursors.get(searchPlanFingerprint);
  if (typeof last !== 'number' || !Number.isFinite(last) || last < 1) return 1;
  return Math.floor(last) + 1;
}
