/**
 * A1-APOLLO-WIZARD-1 — Presupuesto y paginación de Apollo Organization Search.
 *
 * Puro y determinista: sin env, sin reloj propio, sin fetch. El tiempo entra
 * como parámetro (`elapsedMs`) para que el agotamiento temporal sea testeable.
 *
 * Los límites del contrato de Apollo (per_page ≤ 100, ≤ 500 páginas, 50.000
 * resultados visibles) son el TECHO ABSOLUTO, no el presupuesto. Una ejecución
 * del wizard no debe llegar nunca a cientos de páginas.
 *
 * AGENT1-APOLLO-NET-NEW-PAGINATION § 4/§ 9 — Apollo Support confirmó que
 * Organization Search cobra 1 crédito por página NO VACÍA, sin importar
 * cuántos resultados traiga. Bajo ese modelo, `per_page` deja de ser una
 * palanca de gasto —100 cuesta lo mismo que 3— y el presupuesto real de una
 * ejecución es cuántas PÁGINAS puede pagar
 * (`WIZARD_APOLLO_MAX_SEARCH_CREDITS_DEFAULT`, el mismo techo monetario que
 * antes limitaba resultados), no cuántos resultados pide por página.
 */

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

/**
 * AGENT1-APOLLO-NET-NEW-PAGINATION § 4/§ 6 — techo de créditos de Search por
 * invocación. Apollo Support confirmó que Organization Search cobra 1 crédito
 * por página NO VACÍA (nunca por resultado devuelto), así que este mismo número
 * es ahora, directamente, el techo de PÁGINAS pagadas por invocación.
 *
 * Es el MISMO valor monetario que ya regía como
 * `MAX_APOLLO_ORGANIZATIONS_CREDITS` en el provider (10) — no se sube el techo,
 * sólo se reinterpreta bajo el modelo de facturación correcto y se centraliza
 * aquí para que el presupuesto de paginación y el provider lean el mismo
 * número.
 */
export const WIZARD_APOLLO_MAX_SEARCH_CREDITS_DEFAULT = 10;

/**
 * AGENT1-APOLLO-BILLING-MODE-V2 — páginas que paga UNA invocación de búsqueda
 * sin paginación net-new.
 *
 * Sin `netNewTarget` + evaluador de aceptación, el provider construye su
 * presupuesto con `{ maxPages: 1 }`: la invocación pide una sola página y por
 * tanto no puede costar más de un crédito. Ese número vive aquí, y no como
 * literal en el provider, porque la RESERVA lo multiplica
 * (`estimateApolloRunCreditBreakdown`): si el provider empezara a pedir dos
 * páginas y la reserva siguiera reservando una, la corrida gastaría por encima
 * de lo reservado y `budgetExceeded()` la cortaría a mitad, después de pagar.
 */
export const APOLLO_LEGACY_MAX_PAGES_PER_INVOCATION = 1;

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
  /**
   * AGENT1-APOLLO-NET-NEW-PAGINATION § 11 — candidatos NET-NEW aceptados hasta
   * ahora. `null` cuando la búsqueda no inyectó un evaluador de aceptación: la
   * autoridad de parada sigue siendo `candidatesCollected` / `maxCandidates`.
   */
  acceptedForTargetCount?: number | null;
  /** Objetivo NET-NEW restante. `null` ⇒ sin objetivo de negocio conocido. */
  netNewTarget?: number | null;
};

export type ApolloPaginationStopReason =
  | 'candidate_target_reached'
  | 'max_pages_reached'
  | 'max_credits_reached'
  | 'last_page_reached'
  | 'time_budget_exhausted'
  | 'cancelled'
  | 'operational_guardrail'
  | 'contract_page_ceiling'
  /**
   * AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING — una página anterior de ESTA
   * misma huella de búsqueda quedó con una valla durable de
   * `request_started` sin desenlace terminal (éxito o indeterminado)
   * cuando este intento arrancó. Apollo pudo haber cobrado esa página; no se
   * reintenta automáticamente, y esta invocación no pide ninguna página
   * nueva. Fail-closed a propósito (ver PARTE B § 8 del corte).
   */
  | 'indeterminate_prior_page_pending_reconciliation';

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
 * Deriva el presupuesto de paginación bajo el modelo de facturación REAL de
 * Apollo Organization Search (AGENT1-APOLLO-NET-NEW-PAGINATION § 4/§ 9).
 *
 * - `perPage`   = techo del contrato (100). Apollo cobra lo mismo por una
 *                 página no vacía sin importar cuántos resultados traiga, así
 *                 que pedir menos de 100 sólo obliga a pagar más páginas por
 *                 el mismo objetivo. `AGENT1_APOLLO_MAX_RESULTS_PER_QUERY`
 *                 (guardrail legacy de CONTEO de resultados) ya no gobierna
 *                 este número — sigue existiendo para otros consumidores, pero
 *                 no para `per_page`.
 * - `maxPages`  = techo de créditos de Search (10, el mismo valor que regía
 *                 como `MAX_APOLLO_ORGANIZATIONS_CREDITS`), acotado por el
 *                 techo del wizard (5). 1 página no vacía = 1 crédito, así que
 *                 el techo de créditos ES el techo de páginas.
 * - `maxCredits`= maxPages — 1 crédito por página no vacía.
 * - `maxCandidates` = maxPages × perPage, salvo override explícito: con
 *                 per_page=100 el tope de créditos ya no limita cuántas filas
 *                 crudas puede sostener una página, así que el tope de
 *                 candidatos debe poder alojarlas todas.
 *
 * Ningún valor arbitrario nuevo: el techo de créditos es el mismo que ya regía
 * en el provider; sólo se reinterpreta como páginas y se centraliza aquí.
 */
export function createApolloPaginationBudget(
  overrides?: ApolloPaginationBudgetOverrides,
): ApolloPaginationBudget {
  const perPage = clampPositive(
    overrides?.perPage ?? APOLLO_CONTRACT_MAX_PER_PAGE,
    APOLLO_CONTRACT_MAX_PER_PAGE,
    APOLLO_CONTRACT_MAX_PER_PAGE,
  );

  const maxPages = clampPositive(
    overrides?.maxPages ?? WIZARD_APOLLO_MAX_SEARCH_CREDITS_DEFAULT,
    WIZARD_APOLLO_MAX_SEARCH_CREDITS_DEFAULT,
    WIZARD_APOLLO_MAX_PAGES_HARD_CAP,
  );

  const maxCredits = clampPositive(
    overrides?.maxCredits ?? maxPages,
    maxPages,
    maxPages,
  );

  // AGENT1-APOLLO-BILLING-MODE-V2 — 🔴 `maxCandidates` NO puede derivarse de
  // `maxCredits`. Bajo v1 ambos valían `maxPages × perPage` y compartir la
  // variable era inocuo; con créditos por página, `maxCredits` vale `maxPages`
  // (5) y reutilizar esa cifra como tope de candidatos dejaría la corrida
  // recogiendo 5 organizaciones en vez de 500. Son dos magnitudes distintas:
  // una cuenta dinero, la otra filas. Hay trinquete que lo fija.
  const defaultCandidates = maxPages * perPage;
  const maxCandidates = clampPositive(
    overrides?.maxCandidates ?? defaultCandidates,
    defaultCandidates,
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
      maxPages: 'wizard_apollo_max_search_credits_1_credit_per_page',
      maxCredits: 'max_pages_1_credit_per_non_empty_page',
      maxCandidates: 'max_pages_x_per_page',
      perPage: 'apollo_contract_max_per_page',
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
  // AGENT1-APOLLO-NET-NEW-PAGINATION § 11/§ 17 — cuando la búsqueda conoce su
  // objetivo NET-NEW, ÉSA es la autoridad de parada: un duplicado histórico no
  // lo consume, así que una página de puro duplicado no basta para detenerse
  // aquí. Ausente cualquiera de los dos ⇒ criterio previo, sin cambios.
  if (
    typeof state.netNewTarget === 'number' &&
    typeof state.acceptedForTargetCount === 'number' &&
    state.acceptedForTargetCount >= state.netNewTarget
  ) {
    return { shouldContinue: false, stopReason: 'candidate_target_reached' };
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
