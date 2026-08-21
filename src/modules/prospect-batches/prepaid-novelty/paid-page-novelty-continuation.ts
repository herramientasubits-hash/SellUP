/**
 * paid-page-novelty-continuation.ts — después de pagar una página, ¿tiene sentido
 * pagar la siguiente de LA MISMA rama?
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 17, 18, 19, 23.
 *
 * ── El segundo defecto económico de la QA del 2026-08-19 ──────────────────────
 *
 * El lote `e90832f9` gastó 6 peticiones en 3 ramas: DOS por rama, siempre. La
 * página 1 de cada rama rindió CERO empresas útiles nuevas —todo eran candidatos
 * históricos activos, duplicados exactos, o rechazos de precisión— y aun así la
 * corrida compró la página 2 de esa misma rama. Tres páginas se pagaron para
 * releer un pozo que la página anterior ya había demostrado seco.
 *
 * El tope de PETICIONES (`decideLushaProviderRequest`) no podía verlo: pregunta
 * «¿queda hueco y quedan peticiones?», y las dos respuestas eran «sí». Lo que
 * faltaba era mirar el RENDIMIENTO de la página que se acaba de pagar.
 *
 * ── 🔴 Por qué la parada es de RAMA y nunca de corrida (§ 19) ─────────────────
 *
 * «Una petición sin rendimiento ⇒ parar el proveedor entero» destruiría la
 * cobertura, y no es lo que la evidencia soporta: que la rama `main 11 Healthcare`
 * venga seca no dice NADA sobre `main 12 + sub 71 Pharmaceuticals Manufacturing`,
 * que consulta un universo distinto. Lo único que una página seca demuestra es
 * que SU rama, EN SU siguiente página, muy probablemente devolverá más de lo
 * mismo — porque la paginación de una misma consulta es el mismo pozo.
 *
 * Cualquier parada global más fuerte exigiría evidencia que este hito no tiene, y
 * § 19 pide reportarla como trabajo posterior en vez de implementarla a ciegas.
 *
 * ── 🔴 «Nuevas útiles» incluye el SOBRANTE de objetivo ────────────────────────
 *
 * `novelUsefulFromPage` cuenta las empresas que sobrevivieron a TODOS los filtros
 * de novedad —dedupe de corrida, guard de candidato histórico, duplicado exacto y
 * precisión de macro— aunque después el tope de aceptación de #306 las descartara
 * por sobrepasar el objetivo. Esa distinción no es cosmética: una página que
 * encontró 5 empresas buenas y sólo pudo aceptar 1 porque el objetivo se cerró es
 * el ÉXITO máximo, y contarla como «cero novedad» la calumniaría. El caso, además,
 * ya está cubierto: con el objetivo cerrado quien para es `target_reached`.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

/** Por qué esta RAMA deja de paginar. Nunca detiene la corrida. */
export type PaidBranchStopReason =
  /** La página pagada no devolvió ni una fila. Pedir otra relee el mismo vacío. */
  | 'page_empty'
  /** La página pagada devolvió filas, pero ninguna útil y nueva. */
  | 'page_zero_novelty';

export type PaidPageContinuationDecision =
  | { continueBranch: true }
  | { continueBranch: false; stopReason: PaidBranchStopReason };

export type PaidPageNoveltyState = {
  /** Filas crudas que devolvió la página que se acaba de pagar. */
  rawFromPage: number;
  /**
   * Empresas de ESTA página que pasaron dedupe + guard histórico + duplicado
   * exacto + precisión de macro. Incluye las descartadas por sobrepasar el
   * objetivo (ver cabecera).
   */
  novelUsefulFromPage: number;
};

/**
 * ¿Puede esta rama pedir su página siguiente?
 *
 * 🔴 La decisión mira SÓLO la última página pagada. No acumula, no promedia y no
 * consulta el estado de la corrida: quien conoce el hueco global y el techo de
 * peticiones es `decideLushaProviderRequest`, que se evalúa antes y sigue siendo
 * la primera puerta. Esta es la segunda, y sólo puede cerrar una rama.
 */
export function decidePaidPageContinuation(
  state: PaidPageNoveltyState,
): PaidPageContinuationDecision {
  const raw = Number.isFinite(state.rawFromPage) ? Math.trunc(state.rawFromPage) : 0;
  const novel = Number.isFinite(state.novelUsefulFromPage)
    ? Math.trunc(state.novelUsefulFromPage)
    : 0;

  if (raw <= 0) return { continueBranch: false, stopReason: 'page_empty' };
  if (novel <= 0) return { continueBranch: false, stopReason: 'page_zero_novelty' };
  return { continueBranch: true };
}
