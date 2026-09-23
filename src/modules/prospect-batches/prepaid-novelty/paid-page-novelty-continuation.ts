/**
 * paid-page-novelty-continuation.ts — después de pagar una página, ¿tiene sentido
 * pagar la siguiente de LA MISMA rama?
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 17, 18, 19, 23.
 * AGENT1-LUSHA-PAGE-NOVELTY-POLICY-1 — la revisión que este fichero recoge.
 *
 * ── 🔴 Lo que cambia, y por qué ───────────────────────────────────────────────
 *
 * Hasta este corte, una página NO VACÍA cuya novedad local fuese cero cerraba la
 * rama con `page_zero_novelty`. La justificación era económica y razonable: el
 * lote `e90832f9` gastó tres páginas releyendo pozos que la página anterior ya
 * había demostrado secos.
 *
 * Su premisa, en cambio, era una APUESTA, y la cabecera anterior la declaraba
 * como tal: «una página seca demuestra que SU rama, EN SU siguiente página, MUY
 * PROBABLEMENTE devolverá más de lo mismo». Nuestra propia operación produjo el
 * contraejemplo, con el mismo país, la misma macro y el mismo plan de una rama
 * (lote `54f94a91`, 2026-09-22):
 *
 *     página 0 → 25 crudas · 17 ya vistas ·  8 novedosas · 3 útiles
 *     página 1 → 25 crudas ·  7 ya vistas · 18 novedosas · 2 útiles
 *
 * La página 1 rindió MÁS novedad que la 0 y aportó 2 útiles. La paginación de una
 * misma consulta no es un pozo homogéneo: el orden del proveedor no está
 * correlacionado con lo que nosotros ya conocemos, y «ya la vimos» habla de
 * NUESTRO historial, no del contenido de la página siguiente.
 *
 * Y el coste de la apuesta se midió en el lote `9a5ac2c8` (2026-09-23): la rama
 * paró con `page_zero_novelty` tras UNA de las DOS peticiones que su reserva ya
 * había autorizado y pagado por adelantado. No se ahorró presupuesto —estaba
 * reservado—: se dejó sin usar.
 *
 * ── Lo que esta política NO cambia ───────────────────────────────────────────
 *
 * 🔴 No sube páginas, ni peticiones máximas, ni presupuesto. Las puertas que
 * acotan el gasto siguen siendo las mismas y siguen estando ANTES que ésta:
 *
 *   · `decideLushaProviderRequest` — techo de PETICIONES (ramas × páginas, el
 *     mismo del que sale la reserva) y techo de filas crudas;
 *   · la reserva atómica del período, que ninguna página puede rebasar;
 *   · `runStopped` — fallo del proveedor, anomalía de facturación, cancelación;
 *   · el propio bucle, acotado por `LUSHA_PENDING_REVIEW_MAX_PAGES`.
 *
 * 🔴 Consecuencia declarada: el consumo EFECTIVO puede subir hasta el límite que
 * ya existía. Una corrida que antes gastaba 1 de 2 créditos reservados puede
 * gastar ahora los 2. El techo no se mueve; lo que se deja de hacer es devolver
 * sin usar una petición que la reserva ya había comprometido.
 *
 * ── 🔴 Por qué la parada es de RAMA y nunca de corrida (§ 19) ─────────────────
 *
 * Que la rama `main 11 Healthcare` venga vacía no dice NADA sobre
 * `main 12 + sub 71 Pharmaceuticals Manufacturing`: consultan universos
 * distintos. Esta decisión sólo puede cerrar una rama, jamás la corrida.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

/** Por qué esta RAMA deja de paginar. Nunca detiene la corrida. */
export type PaidBranchStopReason =
  /** La página pagada no devolvió ni una fila. Pedir otra relee el mismo vacío. */
  | 'page_empty'
  /**
   * El PROVEEDOR declaró que no queda más que paginar, con una señal FIABLE.
   *
   * 🔴 Hoy ningún llamador la alimenta, y es deliberado. La única candidata en la
   * ruta de descubrimiento de empresas es `totalAvailable`, y no cumple el
   * requisito de fiabilidad:
   *
   *   · el cliente la extrae de `raw.total` / `raw.totalResults` bajo un comentario
   *     que dice literalmente «Response shape not confirmed in live test»;
   *   · lo ÚNICO confirmado en vivo es `pagination.total`, y sólo en la ruta de
   *     CONTACTOS (17B.4W.2), que es otra respuesta y otro endpoint;
   *   · en 15 corridas reales de `company_prospecting_v3` no se persistió ni una
   *     sola observación del campo: no sabemos si viene, ni qué cuenta cuando
   *     viene (¿resultados del filtro?, ¿de la página?, ¿con o sin exclusiones?).
   *
   * Sin esa verificación, interpretarla como agotamiento sería inventar una
   * parada, y usarla para pedir de más sería peor. El contrato queda abierto para
   * cuando la señal esté verificada; hasta entonces, NADIE la pasa.
   */
  | 'provider_reported_exhaustion';

export type PaidPageContinuationDecision =
  | { continueBranch: true }
  | { continueBranch: false; stopReason: PaidBranchStopReason };

export type PaidPageNoveltyState = {
  /** Filas crudas que devolvió la página que se acaba de pagar. */
  rawFromPage: number;
  /**
   * Empresas de ESTA página que pasaron dedupe + guard histórico + duplicado
   * exacto + precisión de macro. Incluye las descartadas por sobrepasar el
   * objetivo.
   *
   * 🔴 Desde AGENT1-LUSHA-PAGE-NOVELTY-POLICY-1 este número YA NO DECIDE. Se
   * conserva en la entrada porque la telemetría publica el rendimiento por
   * página y porque su lectura —cuánto rindió lo que ya se pagó— sigue siendo la
   * pregunta que el operador necesita responder. Lo que dejó de hacer es cerrar
   * la rama.
   */
  novelUsefulFromPage: number;
  /**
   * ¿El proveedor declaró agotamiento con una señal FIABLE? Ausente ⇒ no se sabe,
   * y no saberlo nunca para. Ver `provider_reported_exhaustion`.
   */
  providerReportedExhaustion?: boolean;
};

/**
 * ¿Puede esta rama pedir su página siguiente?
 *
 * 🔴 La decisión mira SÓLO la última página pagada y la señal del proveedor. No
 * acumula, no promedia y no consulta el estado de la corrida: quien conoce el
 * hueco global y el techo de peticiones es `decideLushaProviderRequest`, que se
 * evalúa ANTES y sigue siendo la primera puerta. Ésta es la segunda, y sólo
 * puede cerrar una rama.
 *
 * Orden de las dos negativas: primero el vacío observado —una página sin filas
 * es un hecho, no una inferencia—, después la declaración del proveedor.
 */
export function decidePaidPageContinuation(
  state: PaidPageNoveltyState,
): PaidPageContinuationDecision {
  const raw = Number.isFinite(state.rawFromPage) ? Math.trunc(state.rawFromPage) : 0;

  if (raw <= 0) return { continueBranch: false, stopReason: 'page_empty' };
  if (state.providerReportedExhaustion === true) {
    return { continueBranch: false, stopReason: 'provider_reported_exhaustion' };
  }
  // 🔴 Cero novedad local NO para. La página siguiente es del proveedor; «ya la
  // vimos» es una propiedad de NUESTRO historial y no predice su contenido.
  return { continueBranch: true };
}
