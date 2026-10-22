/**
 * wizard-run-time-plan.ts — EL reparto de los 300 s de una corrida del asistente,
 * en un solo lugar (AGENT1-CRITERIA-QUICK-WINS-2 § 2).
 *
 * ── El defecto ───────────────────────────────────────────────────────────────
 *
 * Los límites vivían sueltos en dos módulos (45 s, 60 s, 140 s, 150 s, 200 s…) y
 * ninguno miraba a los demás. El tramo de Tavily corría SIEMPRE sus 3 rondas sin
 * mirar el reloj: si la capa gratuita, el rescate y el banco ya habían gastado
 * tiempo, Tavily terminaba pasados los 140 s y Apollo ya no arrancaba. La corrida
 * cerraba con «sin tiempo» y el vendedor veía pocas o ninguna empresa (en el
 * historial, `apollo_not_started: no_time` y Claude `not_enough_time` 8 veces).
 *
 * ── El arreglo ───────────────────────────────────────────────────────────────
 *
 * Una tabla con TODOS los hitos medidos desde el inicio de la acción, y las
 * decisiones que se derivan de ella. Los módulos de cada tramo re-exportan sus
 * constantes desde aquí con los mismos nombres y valores de siempre; lo único
 * nuevo es que las rondas de Tavily se ajustan al tiempo que queda antes del
 * arranque de Apollo.
 *
 * Puro: sin I/O, sin env, sin reloj (el llamador pasa el tiempo transcurrido).
 */

export const WIZARD_RUN_TIME_PLAN = {
  /** Límite de una función en Vercel para la acción del asistente. */
  functionLimitMs: 300_000,
  /** Rescate de las sin web de la capa gratuita, antes de Tavily. */
  freeLayerRescueWindowMs: 45_000,
  /** Lo que ese rescate deja libre antes del arranque de Apollo (Tavily + revisión). */
  freeLayerRescueReserveMs: 60_000,
  /** Rondas máximas de Tavily, y lo que se presupuesta por ronda (búsqueda + verificar). */
  tavilyMaxRounds: 3,
  tavilyRoundBudgetMs: 30_000,
  /** Revisión de Claude dentro de la corrida, tras Tavily. */
  inlineReviewWindowMs: 60_000,
  inlineReviewMinWindowMs: 15_000,
  /** Apollo sólo empieza antes de esto: su evaluación usa ~150 s. */
  apolloStartLimitMs: 140_000,
  /** Lusha, detrás de Apollo, sólo empieza antes de esto. */
  lushaStartLimitMs: 200_000,
  /** «Claude busca empresas», al final: tiempo mínimo por delante, cola y tope de fase. */
  claudeSearchMinRemainingMs: 150_000,
  claudeSearchTailMs: 90_000,
  claudeSearchMaxPhaseMs: 120_000,
} as const;

/**
 * Rondas de Tavily que caben sin empujar el arranque de Apollo más allá de su
 * límite, dejando la ventana mínima de revisión de Claude. Nunca menos de 1 (si
 * Apollo ya no va a poder arrancar, una ronda de Tavily es lo único que queda) y
 * nunca más del máximo. Sin reloj conocido ⇒ el máximo, como antes.
 */
export function resolveTavilyFirstMaxRounds(elapsedMs: number | null): number {
  const plan = WIZARD_RUN_TIME_PLAN;
  if (elapsedMs === null || !Number.isFinite(elapsedMs)) return plan.tavilyMaxRounds;
  const available = plan.apolloStartLimitMs - plan.inlineReviewMinWindowMs - Math.max(0, elapsedMs);
  const rounds = Math.floor(available / plan.tavilyRoundBudgetMs);
  return Math.max(1, Math.min(plan.tavilyMaxRounds, rounds));
}
