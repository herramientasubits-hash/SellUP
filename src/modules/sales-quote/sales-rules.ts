/**
 * Reglas comerciales de Ventas sobre la cotización 2027.
 *
 * Van aparte del motor (`engine-2027.ts`), que es idéntico al cotizador
 * original: estas son decisiones de Ventas que se aplican antes de calcular,
 * en la pantalla y en el servidor.
 *
 * - LMS AI es parte de Aprendizaje: no se vende solo (Rubén Candia, 24-11).
 *   Si se quita Aprendizaje, se quita LMS AI.
 */
import { normalizeQuote2027Input, type Quote2027Input } from './engine-2027';

export const LMS_AI_REQUIRES_LEARNING_MESSAGE = 'LMS AI es parte de Aprendizaje: inclúyelo o quita LMS AI.';

/** Las reglas de la pantalla del motor más las de Ventas. */
export function applySalesRules2027(input: Quote2027Input): Quote2027Input {
  const next = normalizeQuote2027Input(input);
  if (!next.includeLearning && (next.lmsAi.tier || next.lmsAi.packs)) {
    return { ...next, lmsAi: { tier: null, packs: 0 } };
  }
  return next;
}

/** ¿La cotización trae LMS AI sin Aprendizaje? (el servidor la rechaza). */
export function hasLmsAiWithoutLearning(input: Quote2027Input): boolean {
  const normalized = normalizeQuote2027Input(input);
  return !normalized.includeLearning && normalized.lmsAi.tier !== null;
}
