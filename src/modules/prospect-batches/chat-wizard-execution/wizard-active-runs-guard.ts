/**
 * AGENT1-AUDIT-WS2 § 9 — las reglas de concurrencia de corridas, también en el
 * SERVIDOR (puro).
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * «Máximo 3 corridas a la vez» y «nunca dos del mismo país × industria» vivían SÓLO
 * en el almacén del navegador (`agent-runs-store.ts`). Dos pestañas, dos equipos o
 * una llamada directa a la ruta las saltaban: dos corridas iguales peleaban por las
 * mismas empresas y pagaban dos veces la misma búsqueda.
 *
 * ── Con qué se decide (sin migración nueva) ──────────────────────────────────
 *
 *   · corridas activas — filas de `agent1_run_progress` (migración 143) de la
 *     persona tocadas hace poco: la corrida anota su etapa al empezar y la borra al
 *     terminar. Una invocación vive como mucho 300 s, así que una fila más vieja
 *     que `ACTIVE_RUN_WINDOW_MS` es de un proceso muerto y no cuenta;
 *   · país × industria — el lote de esas corridas (`prospect_batches`, por
 *     `client_request_id`): `country_code` y `metadata.industry_id`. Sólo para
 *     búsquedas por criterios: competidores, proveedores y árbol son otra búsqueda
 *     (en el navegador su clave es la empresa de referencia).
 *
 * Límite conocido: una corrida que todavía no creó su lote (los primeros segundos)
 * cuenta para el máximo pero no para país × industria.
 */

/** Las mismas que el navegador (`AGENT_RUNS_MAX_CONCURRENT`). */
export const SERVER_MAX_CONCURRENT_RUNS = 3;

/**
 * Antigüedad máxima de la última etapa anotada para considerar viva una corrida.
 * Holgado sobre los 300 s de una invocación: una etapa larga (Apollo) no anota nada
 * durante minutos.
 */
export const ACTIVE_RUN_WINDOW_MS = 6 * 60 * 1000;

export type ActiveRunBatch = {
  clientRequestId: string;
  countryCode: string | null;
  industryId: string | null;
  /** `metadata.search_mode` del lote (`competitors`, `suppliers`, `corporate_tree`) o `null`. */
  searchMode: string | null;
};

export type ActiveRunsConflict = 'max_concurrent' | 'same_country_industry';

export function decideActiveRunsConflict(input: {
  currentClientRequestId: string;
  /** `client_request_id` de las corridas activas de la persona (incluida, quizá, ésta). */
  activeRunIds: readonly string[];
  activeBatches: readonly ActiveRunBatch[];
  current: { countryCode: string; industryId: string; isCriteriaSearch: boolean };
  maxConcurrent?: number;
}): ActiveRunsConflict | null {
  // Un reintento de la MISMA corrida nunca choca consigo mismo.
  const others = new Set(input.activeRunIds.filter((id) => id !== input.currentClientRequestId));
  if (others.size >= (input.maxConcurrent ?? SERVER_MAX_CONCURRENT_RUNS)) return 'max_concurrent';
  if (!input.current.isCriteriaSearch) return null;
  const clash = input.activeBatches.some(
    (batch) =>
      others.has(batch.clientRequestId) &&
      batch.searchMode === null &&
      batch.countryCode === input.current.countryCode &&
      batch.industryId === input.current.industryId,
  );
  return clash ? 'same_country_industry' : null;
}

export const ACTIVE_RUNS_CONFLICT_MESSAGES: Readonly<Record<ActiveRunsConflict, string>> = {
  max_concurrent:
    'Ya tienes 3 búsquedas en curso. Espera a que termine alguna antes de lanzar otra.',
  same_country_industry:
    'Ya tienes una búsqueda en curso para este país e industria. Espera a que termine: las dos pelearían por las mismas empresas.',
};
