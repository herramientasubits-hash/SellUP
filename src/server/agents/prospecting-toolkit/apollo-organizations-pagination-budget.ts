/**
 * A1-APOLLO-WIZARD-1 — Presupuesto y paginación de Apollo Organization Search.
 *
 * Puro y determinista: sin env, sin reloj propio, sin fetch. El tiempo entra
 * como parámetro (`elapsedMs`) para que el agotamiento temporal sea testeable.
 *
 * Los límites del contrato de Apollo (per_page ≤ 100, ≤ 500 páginas, 50.000
 * resultados visibles) son el TECHO ABSOLUTO, no el presupuesto. El presupuesto
 * real de una ejecución del wizard se deriva de los guardrails que ya gobiernan
 * Apollo en el repo (apollo-cost-guardrails), no de números nuevos escondidos
 * aquí. Una ejecución del wizard no debe llegar nunca a cientos de páginas.
 */

import {
  resolveApolloMaxQueriesPerRun,
  resolveApolloMaxResultsPerQuery,
} from './apollo-cost-guardrails';

// ─── Techos del contrato Apollo ───────────────────────────────────────────────

export const APOLLO_CONTRACT_MAX_PER_PAGE = 100;
export const APOLLO_CONTRACT_MAX_VISIBLE_RESULTS = 50_000;
export const APOLLO_CONTRACT_MAX_PAGES = 500;

/**
 * Techo de páginas por ejecución del wizard. Muy por debajo del techo del
 * contrato a propósito: el wizard es una herramienta de descubrimiento acotado,
 * no un rastreador masivo.
 */
export const WIZARD_APOLLO_MAX_PAGES_HARD_CAP = 5;

/** Presupuesto temporal por ejecución de búsqueda Apollo. */
export const WIZARD_APOLLO_TIMEOUT_BUDGET_MS = 60_000;

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type ApolloPaginationBudget = {
  maxPages: number;
  maxCredits: number;
  maxCandidates: number;
  perPage: number;
  timeoutBudgetMs: number;
  /** De dónde salió cada límite. Trazabilidad, no decoración. */
  derivedFrom: {
    maxPages: string;
    maxCredits: string;
    maxCandidates: string;
    perPage: string;
    timeoutBudget: string;
  };
};

export type ApolloPaginationState = {
  /** Páginas ya solicitadas (exitosas o no). */
  pagesFetched: number;
  /** Créditos consumidos/estimados hasta ahora. */
  creditsUsed: number;
  /** Candidatos acumulados hasta ahora. */
  candidatesCollected: number;
  /** ms transcurridos desde el inicio de la búsqueda. */
  elapsedMs: number;
  /** `pagination.total_pages` de la última respuesta, si Apollo lo devolvió. */
  totalPages: number | null;
  /** Página que se acaba de procesar (1-indexed). null antes de la primera. */
  lastPage: number | null;
  /** Resultados devueltos por la última página. */
  lastPageResultCount: number | null;
  /** Cancelación externa (usuario/abort). */
  cancelled?: boolean;
  /** Guardrail operativo activado aguas arriba (p.ej. rate limit sin margen). */
  guardrailTripped?: string | null;
};

export type ApolloPaginationStopReason =
  | 'candidate_target_reached'
  | 'max_pages_reached'
  | 'max_credits_reached'
  | 'last_page_reached'
  | 'time_budget_exhausted'
  | 'cancelled'
  | 'operational_guardrail'
  | 'contract_page_ceiling';

export type ApolloPaginationDecision =
  | { shouldContinue: true; nextPage: number }
  | { shouldContinue: false; stopReason: ApolloPaginationStopReason };

// ─── Construcción del presupuesto ─────────────────────────────────────────────

export type ApolloPaginationBudgetOverrides = {
  maxPages?: number;
  maxCredits?: number;
  maxCandidates?: number;
  perPage?: number;
  timeoutBudgetMs?: number;
};

function clampPositive(value: number | undefined, fallback: number, hardCap: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), hardCap);
}

/**
 * Deriva el presupuesto desde los guardrails Apollo vigentes.
 *
 * - `perPage`   = AGENT1_APOLLO_MAX_RESULTS_PER_QUERY (default 3, hard cap 5),
 *                 acotado además por el techo del contrato (100).
 * - `maxPages`  = AGENT1_APOLLO_MAX_QUERIES_PER_RUN (default 1, hard cap 3),
 *                 acotado por el techo del wizard (5).
 * - `maxCredits`= maxPages × perPage — 1 crédito por resultado, que es cómo
 *                 factura Apollo organizations_search en este repo.
 * - `maxCandidates` = maxCredits, salvo override explícito.
 *
 * Ningún valor arbitrario nuevo: todo procede de una fuente ya existente.
 */
export function createApolloPaginationBudget(
  overrides?: ApolloPaginationBudgetOverrides,
): ApolloPaginationBudget {
  const guardrailPerPage = resolveApolloMaxResultsPerQuery();
  const guardrailMaxPages = resolveApolloMaxQueriesPerRun();

  const perPage = clampPositive(
    overrides?.perPage ?? guardrailPerPage,
    guardrailPerPage,
    APOLLO_CONTRACT_MAX_PER_PAGE,
  );

  const maxPages = clampPositive(
    overrides?.maxPages ?? guardrailMaxPages,
    guardrailMaxPages,
    WIZARD_APOLLO_MAX_PAGES_HARD_CAP,
  );

  const defaultCredits = maxPages * perPage;
  const maxCredits = clampPositive(
    overrides?.maxCredits ?? defaultCredits,
    defaultCredits,
    defaultCredits,
  );

  const maxCandidates = clampPositive(
    overrides?.maxCandidates ?? defaultCredits,
    defaultCredits,
    APOLLO_CONTRACT_MAX_VISIBLE_RESULTS,
  );

  const timeoutBudgetMs = clampPositive(
    overrides?.timeoutBudgetMs ?? WIZARD_APOLLO_TIMEOUT_BUDGET_MS,
    WIZARD_APOLLO_TIMEOUT_BUDGET_MS,
    WIZARD_APOLLO_TIMEOUT_BUDGET_MS,
  );

  return {
    maxPages,
    maxCredits,
    maxCandidates,
    perPage,
    timeoutBudgetMs,
    derivedFrom: {
      maxPages: 'agent1_apollo_max_queries_per_run',
      maxCredits: 'max_pages_x_per_page_1_credit_per_result',
      maxCandidates: 'max_pages_x_per_page',
      perPage: 'agent1_apollo_max_results_per_query',
      timeoutBudget: 'wizard_apollo_timeout_budget_ms',
    },
  };
}

// ─── Decisión de paginación ───────────────────────────────────────────────────

/**
 * Decide si pedir otra página.
 *
 * Precedencia: primero lo que ya no se puede deshacer (cancelación, guardrail,
 * tiempo), luego los topes de gasto, luego el estado del proveedor.
 *
 * Regla explícita: una página corta NO detiene la paginación. Apollo puede
 * devolver menos resultados que `per_page` en una página intermedia sin que eso
 * signifique que se acabaron los resultados; sólo `total_pages` y los topes
 * mandan.
 */
export function evaluateApolloPaginationDecision(
  budget: ApolloPaginationBudget,
  state: ApolloPaginationState,
): ApolloPaginationDecision {
  if (state.cancelled === true) {
    return { shouldContinue: false, stopReason: 'cancelled' };
  }
  if (state.guardrailTripped) {
    return { shouldContinue: false, stopReason: 'operational_guardrail' };
  }
  if (state.elapsedMs >= budget.timeoutBudgetMs) {
    return { shouldContinue: false, stopReason: 'time_budget_exhausted' };
  }
  if (state.candidatesCollected >= budget.maxCandidates) {
    return { shouldContinue: false, stopReason: 'candidate_target_reached' };
  }
  if (state.creditsUsed >= budget.maxCredits) {
    return { shouldContinue: false, stopReason: 'max_credits_reached' };
  }
  // Una página más no puede caber si el crédito restante no la cubre.
  if (budget.maxCredits - state.creditsUsed < 1) {
    return { shouldContinue: false, stopReason: 'max_credits_reached' };
  }
  if (state.pagesFetched >= budget.maxPages) {
    return { shouldContinue: false, stopReason: 'max_pages_reached' };
  }

  const nextPage = (state.lastPage ?? 0) + 1;

  if (nextPage > APOLLO_CONTRACT_MAX_PAGES) {
    return { shouldContinue: false, stopReason: 'contract_page_ceiling' };
  }
  if (state.totalPages !== null && state.lastPage !== null && state.lastPage >= state.totalPages) {
    return { shouldContinue: false, stopReason: 'last_page_reached' };
  }

  return { shouldContinue: true, nextPage };
}

// ─── Clave idempotente lógica ─────────────────────────────────────────────────

export type ApolloPageIdempotencyKeyInput = {
  wizardRunId: string;
  provider: 'apollo';
  filtersFingerprint: string;
  page: number;
};

/**
 * Clave lógica de una página concreta de una ejecución concreta.
 *
 * No es un candado distribuido: es la identidad estable que permite reconocer
 * que una página ya se pidió, para no repetir una página exitosa ni reintentar
 * a ciegas un timeout ambiguo (que Apollo puede haber cobrado).
 */
export function buildApolloPageIdempotencyKey(
  input: ApolloPageIdempotencyKeyInput,
): string {
  const fingerprint = input.filtersFingerprint.trim() || 'no_filters';
  return `${input.provider}:organizations_search:${input.wizardRunId}:${fingerprint}:page_${input.page}`;
}

/** Registro de páginas ya solicitadas dentro de una ejecución. */
export class ApolloPageLedger {
  private readonly attempted = new Set<string>();
  private readonly succeeded = new Set<string>();
  private readonly indeterminate = new Set<string>();

  markAttempted(key: string): void {
    this.attempted.add(key);
  }

  markSucceeded(key: string): void {
    this.attempted.add(key);
    this.succeeded.add(key);
    this.indeterminate.delete(key);
  }

  /**
   * Timeout ambiguo posterior al envío: Apollo pudo haber procesado y cobrado la
   * página. Se marca como indeterminada — nunca se reintenta automáticamente.
   */
  markIndeterminate(key: string): void {
    this.attempted.add(key);
    this.indeterminate.add(key);
  }

  hasSucceeded(key: string): boolean {
    return this.succeeded.has(key);
  }

  isIndeterminate(key: string): boolean {
    return this.indeterminate.has(key);
  }

  /** Una página sólo se pide si nunca se intentó. Éxito e indeterminado bloquean. */
  canRequest(key: string): boolean {
    return !this.attempted.has(key);
  }

  get indeterminateKeys(): string[] {
    return [...this.indeterminate].sort();
  }

  get succeededCount(): number {
    return this.succeeded.size;
  }
}
