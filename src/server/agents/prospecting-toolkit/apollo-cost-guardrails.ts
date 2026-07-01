/**
 * Apollo cost safety guardrails (v1.16K-AC)
 *
 * Env-configurable caps para limitar exposición de créditos Apollo en QA real.
 * Defaults conservadores: 1 query por ejecución, 3 resultados por query.
 *
 * Env vars:
 *   AGENT1_APOLLO_MAX_QUERIES_PER_RUN   — max queries por wizard execution. Default: 1. Hard cap: 3.
 *   AGENT1_APOLLO_MAX_RESULTS_PER_QUERY — max results por query Apollo. Default: 3. Hard cap: 5.
 *
 * Reglas:
 * - Valor 0 o negativo → usa default.
 * - Valor mayor al hard cap → capa al hard cap.
 * - Valor no numérico → usa default.
 * - No llama Apollo. No modifica Tavily. No tiene efectos secundarios.
 */

export const APOLLO_MAX_QUERIES_DEFAULT = 1;
export const APOLLO_MAX_QUERIES_HARD_CAP = 3;
export const APOLLO_MAX_RESULTS_DEFAULT = 3;
export const APOLLO_MAX_RESULTS_HARD_CAP = 5;

function parseGuardrailInt(raw: string | undefined, fallback: number, hardCap: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, hardCap);
}

/**
 * Max Apollo Organizations queries allowed per wizard execution (cross-round global cap).
 * Reads AGENT1_APOLLO_MAX_QUERIES_PER_RUN. Default: 1. Hard cap: 3.
 */
export function resolveApolloMaxQueriesPerRun(): number {
  return parseGuardrailInt(
    process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN,
    APOLLO_MAX_QUERIES_DEFAULT,
    APOLLO_MAX_QUERIES_HARD_CAP,
  );
}

/**
 * Max results to request per Apollo Organizations query.
 * Reads AGENT1_APOLLO_MAX_RESULTS_PER_QUERY. Default: 3. Hard cap: 5.
 */
export function resolveApolloMaxResultsPerQuery(): number {
  return parseGuardrailInt(
    process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY,
    APOLLO_MAX_RESULTS_DEFAULT,
    APOLLO_MAX_RESULTS_HARD_CAP,
  );
}
