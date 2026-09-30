/**
 * Agente 1 · Rescate con Claude — cuánto tiempo queda (puro).
 *
 * `after()` corre DENTRO de la misma función de Vercel que la búsqueda (límite
 * 300 s; la E2E CO×Tecnología del 20-09 murió ahí). Si Vercel corta el rescate a
 * la mitad, las llamadas en curso a Anthropic se cobran sin quedar registradas y
 * las marcas «en proceso» quedan colgadas. Por eso el plazo para EMPEZAR empresas
 * se cuenta desde que empezó la búsqueda, con margen para que las que ya están en
 * curso terminen (hasta ~3 peticiones de 60 s en el peor caso raro; ~10 s típico).
 */

export const VERCEL_FUNCTION_LIMIT_MS = 300_000;
/** Margen para que terminen las empresas en curso y se registre su gasto. */
export const RESCUE_IN_FLIGHT_MARGIN_MS = 90_000;
/** Menos que esto no vale la pena empezar: se deja para el botón del lote. */
export const RESCUE_MIN_USEFUL_WINDOW_MS = 20_000;
/** Tope propio del rescate aunque sobre tiempo. */
export const RESCUE_MAX_WINDOW_MS = 200_000;

export function computeBackgroundRescueDeadlineMs(actionStartedAtMs: number, nowMs: number): number | null {
  const elapsed = Math.max(0, nowMs - actionStartedAtMs);
  const window = Math.min(RESCUE_MAX_WINDOW_MS, VERCEL_FUNCTION_LIMIT_MS - RESCUE_IN_FLIGHT_MARGIN_MS - elapsed);
  return window >= RESCUE_MIN_USEFUL_WINDOW_MS ? window : null;
}
