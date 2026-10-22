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

// AGENT1-CRITERIA-QUICK-WINS-2 § 2 — los tiempos salen del plan único de la corrida.
import { WIZARD_RUN_TIME_PLAN } from './wizard-run-time-plan';

/** Límite de una función en Vercel para la acción del asistente. */
export const WIZARD_FUNCTION_LIMIT_MS = WIZARD_RUN_TIME_PLAN.functionLimitMs;
/** Con menos que esto por delante no se empieza: Claude + verificar + escribir ≈ 90–140 s. */
export const CLAUDE_SEARCH_LEG_MIN_REMAINING_MS = WIZARD_RUN_TIME_PLAN.claudeSearchMinRemainingMs;
/** Lo que se deja para verificar sitios, revisar duplicados, escribir y cerrar la corrida. */
export const CLAUDE_SEARCH_LEG_TAIL_MS = WIZARD_RUN_TIME_PLAN.claudeSearchTailMs;
/** Tope para EMPEZAR consultas a Claude dentro del paso. */
export const CLAUDE_SEARCH_LEG_MAX_PHASE_MS = WIZARD_RUN_TIME_PLAN.claudeSearchMaxPhaseMs;

export type ClaudeSearchLegSkipReason =
  | 'flag_disabled'
  | 'tavily_first_reviewable_met'
  | 'target_met'
  | 'not_enough_time'
  | 'run_start_unknown'
  /**
   * AGENT1-AUDIT-WS2 § F — el lote ya está en el tope de entrega (máximo 10 por
   * búsqueda): nada de lo que Claude encontrara cabría, y se pagaría igual.
   */
  | 'lot_at_delivery_cap';

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
  /**
   * AGENT1-AUDIT-WS2 § F — ¿el lote ya llegó al tope de entrega? Ausente ⇒ `false`
   * (sin tope configurado o sin conteo: se sigue como antes).
   */
  lotAtDeliveryCap?: boolean;
}): ClaudeSearchLegDecision {
  if (!input.enabled) return { run: false, reason: 'flag_disabled' };
  if (input.tavilyFirstSatisfied) return { run: false, reason: 'tavily_first_reviewable_met' };
  const missing = input.target - input.acceptedSoFar;
  if (missing <= 0) return { run: false, reason: 'target_met' };
  if (input.lotAtDeliveryCap === true) return { run: false, reason: 'lot_at_delivery_cap' };
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
      /** «Competidores»: las que Claude propuso sin sitio web (sólo nombre y frase). */
      withoutWebsite?: ReadonlyArray<{ name: string; evidence: string | null; sourceUrl: string | null }>;
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
