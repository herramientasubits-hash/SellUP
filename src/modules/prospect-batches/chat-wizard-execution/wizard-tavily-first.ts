/**
 * AGENT1-TAVILY-FIRST-1 — Tavily primero; Apollo → Lusha sólo para lo que falte
 * (puro).
 *
 * Decisión de la dueña (01-10): Tavily es gratis (1.000 créditos al mes), así que
 * va primero en toda corrida del modo automático. Opción C: la corrida termina
 * con Tavily si deja al menos tantas empresas PARA REVISAR (no duplicadas ni
 * descartadas) como el objetivo; si no, Apollo completa en la misma corrida y,
 * detrás, Lusha como siempre.
 *
 * Por qué «para revisar» y no «aceptadas»: el tamaño de una empresa de Tavily
 * lo completa Claude DESPUÉS de la corrida (rescate en `after()`), así que al
 * decidir casi ninguna cuenta todavía como aceptada. Decidir por aceptadas
 * llamaría siempre a Apollo y Tavily sólo sumaría costo de Claude. El conteo de
 * `accepted_for_target` no cambia: sigue diciendo la verdad medida.
 *
 * Nunca falla una corrida: cualquier tropiezo de Tavily ⇒ Apollo como siempre.
 */

import type { TavilyMonthlyCreditsVerdict } from '@/server/agents/prospecting-toolkit/tavily-monthly-credits';

/** Rondas del tramo de Tavily: deja tiempo a Apollo dentro de los 300 s. */
export const TAVILY_FIRST_MAX_ROUNDS = 2;

export type TavilyFirstSkipReason =
  | 'monthly_free_credits_exhausted'
  | 'tavily_not_configured'
  | 'pilot_budget_blocked';

export type TavilyFirstOutcome =
  /** Tavily dejó suficientes para revisar: Apollo y Lusha no corrieron. */
  | { outcome: 'satisfied'; reviewable: number; target: number }
  /** Tavily dejó pocas: Apollo completó en la misma corrida. */
  | { outcome: 'apollo_completed'; reviewable: number | null; target: number }
  /** Tavily no corrió; la corrida fue Apollo como siempre. */
  | { outcome: 'skipped'; skipReason: TavilyFirstSkipReason }
  /** Tavily falló a mitad; la corrida siguió con Apollo. */
  | { outcome: 'failed' };

export function resolveTavilyFirstPrecheck(input: {
  tavilyConfigured: boolean;
  monthly: TavilyMonthlyCreditsVerdict | null;
}): TavilyFirstSkipReason | null {
  if (!input.tavilyConfigured) return 'tavily_not_configured';
  // `null` = no se pudo leer: no bloquea (con el plan gratis Tavily no cobra al agotarse).
  if (input.monthly?.status === 'exhausted') return 'monthly_free_credits_exhausted';
  return null;
}

/** ¿Basta lo que dejó Tavily? `null` (no se pudo contar) ⇒ no basta: Apollo completa. */
export function isTavilyFirstSatisfied(reviewable: number | null, target: number): boolean {
  return reviewable !== null && reviewable >= target;
}

export type WriterTruthLike = {
  completeValidCandidates: number | null | undefined;
  persistedCandidates: number;
  acceptedIdentities?: readonly string[];
};

/**
 * La verdad del escritor de los dos tramos de pago (Tavily + Apollo) sumada.
 * `null` en cualquiera de los dos ⇒ `null` (no medido): sumar un no-medido a un
 * medido sería inventar una cifra.
 */
export function combineWriterTruths(a: WriterTruthLike, b: WriterTruthLike | null): WriterTruthLike {
  if (!b) return a;
  const complete =
    a.completeValidCandidates == null || b.completeValidCandidates == null
      ? null
      : a.completeValidCandidates + b.completeValidCandidates;
  const identities = [...(a.acceptedIdentities ?? []), ...(b.acceptedIdentities ?? [])];
  return {
    completeValidCandidates: complete,
    persistedCandidates: a.persistedCandidates + b.persistedCandidates,
    ...(identities.length > 0 ? { acceptedIdentities: identities } : {}),
  };
}
