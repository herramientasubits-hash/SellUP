/**
 * lusha-prospecting-contract.ts — el contrato de facturación y paginación de
 * `POST /v3/companies/prospecting`, en UN solo sitio.
 *
 * AGENT1-LUSHA-CUT-L5-BILLING-BLOCKS-AND-PAGE-SIZE §§ 2, 4, 5, 6, 20, 21.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * Hasta CUT-L4 la economía de Prospecting se sostenía sobre una observación, no
 * sobre un contrato: el microbenchmark Q3F-5R vio `creditsCharged=1` en tres
 * peticiones de `size=10` y el repo dedujo «1 crédito por petición». Esa
 * deducción era CORRECTA por accidente —10 resultados caben en un bloque— y se
 * rompía en silencio en cuanto alguien subiera el tamaño de página.
 *
 * El soporte HUMANO de Lusha confirmó el contrato real:
 *
 *     0 resultados devueltos → mínimo 1 crédito de consulta
 *     1–25 resultados        → 1 crédito
 *     26–50 resultados       → 2 créditos
 *
 * es decir, `max(1, ceil(resultados / 25))`: la facturación es por BLOQUES de 25,
 * no por petición y no por resultado.
 *
 * ── 🔴 Lo que este módulo NO es ──────────────────────────────────────────────
 *
 * NO es la autoridad de liquidación. `billing.creditsCharged` de la respuesta
 * sigue siendo lo que de verdad se cobró, y ninguna función de aquí lo sustituye,
 * lo repara ni lo recorta. Lo que este módulo produce es lo ESPERADO, y sirve
 * para tres cosas distintas que no deben colapsarse en un solo número (§ 7):
 *
 *   · RESPONSABILIDAD DE LA PETICIÓN — el techo antes de que exista respuesta,
 *     derivado del `size` solicitado. Es lo que se reserva.
 *   · CARGO ESPERADO — derivado de los resultados que la respuesta trajo.
 *   · CARGO REAL — `billing.creditsCharged`. Verdad, siempre.
 *
 * Que el esperado y el real discrepen es un HECHO observable que hay que
 * publicar (§ 8), no un error que corregir.
 *
 * Puro: sin env, sin I/O, sin cliente de proveedor, sin DB, sin reloj.
 */

/** Resultados que caben en UN bloque de facturación. Contrato HUMANO. */
export const LUSHA_PROSPECTING_BILLING_BLOCK_SIZE = 25;

/**
 * Tamaño de página MÍNIMO que el proveedor acepta.
 *
 * Observado en el smoke test Q3F-5E: la API responde HTTP 400
 * («pagination.size must not be less than 10») a cualquier valor menor.
 */
export const LUSHA_PROSPECTING_MIN_PAGE_SIZE = 10;

/** Tamaño de página MÁXIMO que el proveedor acepta. Contrato HUMANO. */
export const LUSHA_PROSPECTING_MAX_PAGE_SIZE = 50;

/**
 * Tamaño de página que la ruta PAGADA de Agente 1 solicita en producción.
 *
 * 🔴 25 y no 50, y el motivo es económico, no técnico (§ 3). Con 25 el proveedor
 * no puede devolver más de un bloque, así que la petición cuesta a lo sumo 1
 * crédito; después SellUp inspecciona, deduplica y sólo compra otro bloque si
 * queda hueco. Con 50 el proveedor puede devolver 26–50 y cobrar 2 créditos de
 * golpe, incluso cuando las primeras 25 empresas ya cerraban el objetivo.
 *
 * Este corte optimiza SOBRE-COMPRA MÍNIMA, no número mínimo de llamadas HTTP.
 *
 * 🔴 No es el mismo número que `LUSHA_PREVIEW_SIZE` (10) y no debe unificarse con
 * él: el preview pagado sigue incapacitado y su tamaño histórico se conserva
 * intacto para que este corte no lo reactive por la puerta de atrás.
 */
export const LUSHA_PROSPECTING_PAGE_SIZE = LUSHA_PROSPECTING_BILLING_BLOCK_SIZE;

/**
 * Páginas que el PROVEEDOR permite. Contrato HUMANO.
 *
 * 🔴 Capacidad del proveedor, NO política de producto (§ 14). SellUp pagina 2
 * páginas por rama y este corte no lo cambia. Esta constante existe para que la
 * validación de límites del cliente tenga contra qué comparar, no para que nadie
 * la lea como un objetivo.
 */
export const LUSHA_PROSPECTING_MAX_PROVIDER_PAGES = 1000;

/**
 * Índice de página máximo aceptable.
 *
 * 🔴 La convención de página de Lusha V3 es BASE 0 (OpenAPI oficial, Q3F-5N), así
 * que 1000 páginas son los índices 0…999. Se deriva en vez de escribirse para que
 * la convención quede dicha una sola vez y no se invente una base nueva (§ 20).
 */
export const LUSHA_PROSPECTING_MAX_PROVIDER_PAGE_INDEX =
  LUSHA_PROSPECTING_MAX_PROVIDER_PAGES - 1;

/** Resultados totales que el proveedor puede paginar. Contrato HUMANO. */
export const LUSHA_PROSPECTING_MAX_PROVIDER_RESULTS = 50_000;

/**
 * ¿Es `value` un entero finito? Ni `NaN`, ni `Infinity`, ni fraccionario.
 *
 * Se aísla porque las tres entradas inválidas del corte (§ 25) son exactamente
 * éstas y `Number.isInteger` ya las rechaza todas; tenerlo con nombre evita que
 * cada validador improvise su propia versión a medias.
 */
function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Créditos que el contrato dice que UNA página con `resultsReturned` resultados
 * debió costar.
 *
 *     0  → 1      (una consulta ejecutada nunca es gratis, § 10)
 *     1  → 1
 *     25 → 1
 *     26 → 2
 *     50 → 2
 *
 * 🔴 `null` —no 0, no 1— cuando la entrada no puede representar los resultados de
 * una página válida: negativa, fraccionaria, `NaN`, `Infinity` o mayor que el
 * máximo del proveedor. Devolver un número ahí convertiría basura en una
 * afirmación económica, que es justo lo que este corte prohíbe (§ 5).
 *
 * 🔴 Y esto NO es «lo que se cobró». Es lo que el contrato esperaba. La verdad de
 * liquidación es `billing.creditsCharged`.
 */
export function expectedLushaProspectingCreditsForReturnedResults(
  resultsReturned: number | null | undefined,
): number | null {
  if (!isFiniteInteger(resultsReturned)) return null;
  if (resultsReturned < 0) return null;
  if (resultsReturned > LUSHA_PROSPECTING_MAX_PAGE_SIZE) return null;
  return Math.max(1, Math.ceil(resultsReturned / LUSHA_PROSPECTING_BILLING_BLOCK_SIZE));
}

/**
 * Responsabilidad MÁXIMA de una petición, derivada del `size` solicitado.
 *
 *     size 1  → 1
 *     size 10 → 1
 *     size 25 → 1
 *     size 26 → 2
 *     size 50 → 2
 *
 * Existe porque la reserva ocurre ANTES de que haya resultados (§ 6): en ese
 * instante lo único que se sabe es cuántos resultados se pidieron, y el peor caso
 * es que el proveedor los devuelva todos.
 *
 * 🔴 El dominio empieza en 1, no en el mínimo del proveedor (10). Que la API
 * rechace `size=5` es una regla de DESPACHO y vive en el cliente; preguntarle a
 * esta función cuánto costaría una página de 5 resultados tiene respuesta —1— y
 * confundir las dos validaciones haría que el techo dependiera de si el proveedor
 * cambia su mínimo.
 *
 * `null` para 0, negativos, fraccionarios, `NaN`, `Infinity` y > 50.
 */
export function expectedLushaProspectingCreditsForPageSize(
  size: number | null | undefined,
): number | null {
  if (!isFiniteInteger(size)) return null;
  if (size < 1) return null;
  if (size > LUSHA_PROSPECTING_MAX_PAGE_SIZE) return null;
  return Math.max(1, Math.ceil(size / LUSHA_PROSPECTING_BILLING_BLOCK_SIZE));
}

/**
 * ¿Puede este `size` viajar al proveedor?
 *
 * Es una pregunta DISTINTA de la de responsabilidad: aquí sí manda el mínimo del
 * proveedor, porque una petición de `size=5` no cuesta 1 crédito — no llega a
 * ejecutarse, la API la rechaza con 400 (§ 20).
 */
export function isDispatchableLushaProspectingPageSize(
  size: number | null | undefined,
): boolean {
  if (!isFiniteInteger(size)) return false;
  return size >= LUSHA_PROSPECTING_MIN_PAGE_SIZE && size <= LUSHA_PROSPECTING_MAX_PAGE_SIZE;
}

/**
 * ¿Puede este índice de página viajar al proveedor?
 *
 * Base 0. Un índice negativo, fraccionario o por encima de
 * `LUSHA_PROSPECTING_MAX_PROVIDER_PAGE_INDEX` no se envía.
 */
export function isDispatchableLushaProspectingPage(
  page: number | null | undefined,
): boolean {
  if (!isFiniteInteger(page)) return false;
  return page >= 0 && page <= LUSHA_PROSPECTING_MAX_PROVIDER_PAGE_INDEX;
}

/**
 * ¿Esta coordenada `(page, size)` cae fuera de la ventana de 50.000 resultados?
 *
 * Con base 0, la página `p` de tamaño `s` alcanza el resultado número
 * `(p + 1) * s`. Si ese número supera el máximo del proveedor, la petición pide
 * más allá de lo que Lusha puede paginar.
 *
 * 🔴 Guarda de invariante del PROVEEDOR (§ 21), no un objetivo: SellUp pide como
 * mucho la página 1, y ninguna corrida real se acerca ni de lejos a este límite.
 * Está para que un cambio futuro de paginación no lo rebase sin que nadie lo vea.
 */
export function exceedsLushaProspectingResultWindow(
  page: number | null | undefined,
  size: number | null | undefined,
): boolean {
  if (!isFiniteInteger(page) || !isFiniteInteger(size)) return false;
  if (page < 0 || size < 1) return false;
  return (page + 1) * size > LUSHA_PROSPECTING_MAX_PROVIDER_RESULTS;
}

// ── Contraste esperado ↔ real (§§ 7, 8, 9) ───────────────────────────────────

/**
 * El contraste de UNA petición pagada entre lo que el contrato esperaba y lo que
 * el proveedor liquidó.
 *
 * `matchesContract` es `null` —no `false`— cuando falta cualquiera de los dos
 * lados: sin `creditsCharged` numérico (CUT-L2 lo llama certeza `unknown`) no hay
 * discrepancia que afirmar, y tratarla como incumplimiento pararía corridas por
 * una ausencia de información.
 */
export type LushaProspectingBillingContrast = {
  /** Techo derivado del `size` pedido. `null` si el tamaño no era representable. */
  requestLiabilityCredits: number | null;
  /** Cargo esperado según los resultados devueltos. `null` si no era representable. */
  expectedCredits: number | null;
  /** Cargo REAL del proveedor. Nunca se deriva ni se repara. */
  actualCredits: number | null;
  /** `null` = indeterminable. `false` = incumplimiento observado. */
  matchesContract: boolean | null;
  /** El cargo real superó lo que la petición tenía reservado. */
  exceedsRequestLiability: boolean;
};

/**
 * Compara esperado con real SIN tocar el real.
 *
 * 🔴 `actualCredits` sale tal cual de `creditsCharged`. Si Lusha dice 0 en una
 * consulta que el contrato tasa en 1, aquí se registra 0 y `matchesContract`
 * pasa a `false` (§ 23). Subirlo a 1 sería inventar un cargo que nadie hizo.
 *
 * 🔴 `exceedsRequestLiability` es la única señal que habla de dinero YA gastado
 * por encima de lo reservado (§ 9). No se puede deshacer; lo que se puede es
 * dejar de comprar más.
 */
export function evaluateLushaProspectingBillingContrast(input: {
  requestedPageSize: number | null | undefined;
  resultsReturned: number | null | undefined;
  creditsCharged: number | null | undefined;
}): LushaProspectingBillingContrast {
  const requestLiabilityCredits = expectedLushaProspectingCreditsForPageSize(
    input.requestedPageSize,
  );
  const expectedCredits = expectedLushaProspectingCreditsForReturnedResults(
    input.resultsReturned,
  );
  const actualCredits =
    isFiniteInteger(input.creditsCharged) && input.creditsCharged >= 0
      ? input.creditsCharged
      : null;

  const matchesContract =
    actualCredits === null || expectedCredits === null
      ? null
      : actualCredits === expectedCredits;

  const exceedsRequestLiability =
    actualCredits !== null &&
    requestLiabilityCredits !== null &&
    actualCredits > requestLiabilityCredits;

  return {
    requestLiabilityCredits,
    expectedCredits,
    actualCredits,
    matchesContract,
    exceedsRequestLiability,
  };
}

/**
 * ¿Debe la corrida DEJAR de comprar páginas tras esta petición?
 *
 * Sí ante un incumplimiento observado (`matchesContract === false`) y sí ante un
 * cargo por encima de la responsabilidad de la petición. Ante `null` —certeza
 * desconocida— NO: la ausencia de importe ya la gobierna CUT-L2 y convertirla en
 * parada aquí duplicaría esa política con otro criterio.
 */
export function shouldStopPaidPaginationOnBillingContrast(
  contrast: LushaProspectingBillingContrast,
): boolean {
  return contrast.matchesContract === false || contrast.exceedsRequestLiability;
}
