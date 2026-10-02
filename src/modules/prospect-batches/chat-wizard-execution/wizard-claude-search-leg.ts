/**
 * AGENT1-CLAUDE-COMPANY-SEARCH-AUTO-1 — Claude como ÚLTIMO paso de la corrida (puro).
 *
 * Decisión de la dueña (02-10): automático, no un botón. Tras 5 corridas del piloto
 * (≈ US$0,30 por empresa nueva, peor que Tavily en tamaño confirmado) va DETRÁS de todo:
 * sólo corre si, después del banco, la capa gratuita, Tavily, Apollo y Lusha, la corrida
 * todavía no llegó a la meta, y si queda tiempo dentro de los 300 s de Vercel.
 *
 * Tope de gasto: 2 llamadas a Claude por corrida (≈ US$0,25), fijo en el piloto.
 * Escribe en el MISMO lote y suma a la misma cuenta de aceptadas. Nunca falla una
 * corrida: cualquier tropiezo ⇒ la corrida termina como sin este paso.
 */

/** Límite de una función en Vercel para la acción del asistente. */
export const WIZARD_FUNCTION_LIMIT_MS = 300_000;
/** Con menos que esto por delante no se empieza: Claude + verificar + escribir ≈ 90–140 s. */
export const CLAUDE_SEARCH_LEG_MIN_REMAINING_MS = 150_000;
/** Lo que se deja para verificar sitios, revisar duplicados, escribir y cerrar la corrida. */
export const CLAUDE_SEARCH_LEG_TAIL_MS = 90_000;
/** Tope para EMPEZAR consultas a Claude dentro del paso. */
export const CLAUDE_SEARCH_LEG_MAX_PHASE_MS = 120_000;

export type ClaudeSearchLegSkipReason =
  | 'flag_disabled'
  | 'tavily_first_reviewable_met'
  | 'target_met'
  | 'not_enough_time'
  | 'run_start_unknown';

export type ClaudeSearchLegDecision =
  | { run: true; phaseMs: number; missing: number }
  | { run: false; reason: ClaudeSearchLegSkipReason };

export function decideClaudeSearchLeg(input: {
  enabled: boolean;
  tavilyFirstSatisfied: boolean;
  target: number;
  acceptedSoFar: number;
  /** ms desde que empezó la acción del asistente; null = no se sabe. */
  elapsedMs: number | null;
}): ClaudeSearchLegDecision {
  if (!input.enabled) return { run: false, reason: 'flag_disabled' };
  if (input.tavilyFirstSatisfied) return { run: false, reason: 'tavily_first_reviewable_met' };
  const missing = input.target - input.acceptedSoFar;
  if (missing <= 0) return { run: false, reason: 'target_met' };
  if (input.elapsedMs === null) return { run: false, reason: 'run_start_unknown' };
  const remaining = WIZARD_FUNCTION_LIMIT_MS - input.elapsedMs;
  if (remaining < CLAUDE_SEARCH_LEG_MIN_REMAINING_MS) return { run: false, reason: 'not_enough_time' };
  return {
    run: true,
    missing,
    phaseMs: Math.min(CLAUDE_SEARCH_LEG_MAX_PHASE_MS, remaining - CLAUDE_SEARCH_LEG_TAIL_MS),
  };
}

export type ClaudeSearchLegOutcome =
  | { executed: false; reason: ClaudeSearchLegSkipReason | 'failed' | string }
  | {
      executed: true;
      persistedCandidates: number;
      completeValidCandidates: number | null;
      acceptedIdentities: readonly string[];
      estimatedCostUsd: number;
      proposed: number;
      passedPreFilter: number;
    };

/** La verdad del escritor del paso de Claude, en la forma que suma la aceptación final. */
export function claudeLegWriterTruth(outcome: ClaudeSearchLegOutcome): {
  completeValidCandidates: number | null;
  persistedCandidates: number;
  acceptedIdentities?: readonly string[];
} | null {
  if (!outcome.executed) return null;
  return {
    completeValidCandidates: outcome.completeValidCandidates,
    persistedCandidates: outcome.persistedCandidates,
    ...(outcome.acceptedIdentities.length > 0 ? { acceptedIdentities: outcome.acceptedIdentities } : {}),
  };
}
