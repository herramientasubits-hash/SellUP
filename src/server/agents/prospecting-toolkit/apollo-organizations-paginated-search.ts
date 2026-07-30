/**
 * A1-APOLLO-WIZARD-1 — Búsqueda paginada de Apollo Organization Search.
 *
 * Orquesta, por inyección de dependencias, las piezas puras del hito:
 *   contrato de request → transporte → normalización → taxonomía de errores
 *   → presupuesto/paginación → registro por página
 *
 * Todo lo no determinista se inyecta (`fetchPage`, `now`, `random`, `logPage`,
 * `sleep`), así que la suite completa corre sin una sola llamada real a Apollo.
 *
 * Invariantes que este módulo sostiene:
 *   - Una página exitosa NUNCA se vuelve a pedir.
 *   - Un timeout ambiguo posterior al envío NUNCA se reintenta automáticamente:
 *     Apollo pudo haber cobrado, y repetir duplicaría el cargo.
 *   - Una página corta NO detiene la paginación; sólo `total_pages` y los topes.
 *   - Un error de Apollo nunca se degrada a "cero resultados".
 */

import {
  buildApolloOrganizationsRequestContract,
  assertApolloOrganizationsBodySafe,
  type ApolloOrganizationsRequestInput,
  type ApolloOmittedFilter,
} from './apollo-organizations-request-contract';
import {
  normalizeApolloOrganizationsResponse,
  type NormalizedApolloOrganization,
  type ApolloOrganizationsNormalizationMeta,
} from './apollo-organizations-response-normalizer';
import {
  evaluateApolloPaginationDecision,
  buildApolloPageIdempotencyKey,
  ApolloPageLedger,
  type ApolloPaginationBudget,
  type ApolloPaginationStopReason,
} from './apollo-organizations-pagination-budget';
import {
  classifyApolloOrganizationsError,
  APOLLO_MAX_RETRY_ATTEMPTS,
  type ApolloErrorClassification,
} from './apollo-organizations-error-taxonomy';
import {
  parseApolloRateLimitHeaders,
  toRateLimitLogMetadata,
  type ApolloRateLimitSnapshot,
  type HeaderReader,
} from '@/server/integrations/apollo-rate-limit-headers';

// ─── Contrato de dependencias ─────────────────────────────────────────────────

export type ApolloPageFetchResult = {
  ok: boolean;
  status: number | null;
  requestSent: boolean;
  malformedBody: boolean;
  timedOut: boolean;
  payload: unknown;
  headers: HeaderReader | null;
  errorBody?: string;
};

export type ApolloPageLogEntry = {
  provider: 'apollo';
  operation: 'organizations_search';
  endpoint: string;
  requestFingerprint: string;
  idempotencyKey: string;
  page: number;
  perPage: number;
  resultsReturned: number;
  estimatedCredits: number;
  /** Créditos verificables. null cuando el proveedor no los expone. */
  actualCredits: number | null;
  rateLimit: Record<string, number | string | boolean | null>;
  status: 'success' | 'error' | 'rate_limited' | 'indeterminate';
  latencyMs: number;
  attempt: number;
  errorCategory: string | null;
  errorCode: string | null;
  billingState: 'not_charged' | 'charged' | 'unknown';
  wizardRunId: string;
  agentRunId: string | null;
};

export type ApolloPaginatedSearchDeps = {
  fetchPage: (body: Record<string, unknown>) => Promise<ApolloPageFetchResult>;
  /** Reloj monótono inyectado. */
  now: () => number;
  /** Jitter ∈ [0,1) inyectado. */
  random: () => number;
  /** Registro por página. Debe ser best-effort: no puede tumbar la búsqueda. */
  logPage?: (entry: ApolloPageLogEntry) => void | Promise<void>;
  /** Espera entre reintentos. Los tests la anulan con un no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Cancelación externa, consultada antes de cada página. */
  isCancelled?: () => boolean;
};

export type ApolloPaginatedSearchInput = {
  filters: Omit<ApolloOrganizationsRequestInput, 'page' | 'perPage'>;
  budget: ApolloPaginationBudget;
  wizardRunId: string;
  agentRunId?: string | null;
};

// ─── Resultado ────────────────────────────────────────────────────────────────

export type ApolloPageOutcome = {
  page: number;
  status: 'success' | 'error' | 'rate_limited' | 'indeterminate';
  resultsReturned: number;
  estimatedCredits: number;
  attempt: number;
  errorCode: string | null;
  billingState: 'not_charged' | 'charged' | 'unknown';
};

export type ApolloPaginatedSearchResult = {
  organizations: NormalizedApolloOrganization[];
  pagesProcessed: number;
  estimatedCredits: number;
  stopReason: ApolloPaginationStopReason | 'error_terminated';
  /** Clasificación del fallo que detuvo la búsqueda. null si terminó limpio. */
  terminalError: ApolloErrorClassification | null;
  /** Páginas cuyo resultado y cobro quedaron indeterminados. Requieren recuperación explícita. */
  indeterminatePages: number[];
  pageOutcomes: ApolloPageOutcome[];
  requestFingerprint: string;
  omittedFilters: ApolloOmittedFilter[];
  rejectedForbiddenParams: string[];
  rejectedUnknownParams: string[];
  /** Último snapshot de cuota observado. */
  lastRateLimit: ApolloRateLimitSnapshot | null;
  normalizationMeta: ApolloOrganizationsNormalizationMeta | null;
  paginationMeta: {
    totalEntries: number | null;
    totalPages: number | null;
    lastPage: number | null;
  };
};

const APOLLO_ENDPOINT = '/api/v1/mixed_companies/search';

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─── Orquestador ──────────────────────────────────────────────────────────────

/**
 * Ejecuta la búsqueda paginada dentro del presupuesto dado.
 *
 * Nunca lanza por causa de Apollo: un fallo del proveedor se devuelve
 * clasificado en `terminalError`, junto con los resultados que sí se obtuvieron
 * antes del fallo.
 */
export async function runApolloOrganizationsPaginatedSearch(
  input: ApolloPaginatedSearchInput,
  deps: ApolloPaginatedSearchDeps,
): Promise<ApolloPaginatedSearchResult> {
  const { budget } = input;
  const sleep = deps.sleep ?? defaultSleep;
  const startedAt = deps.now();
  const ledger = new ApolloPageLedger();

  const collected: NormalizedApolloOrganization[] = [];
  const seenOrganizationIds = new Set<string>();
  const pageOutcomes: ApolloPageOutcome[] = [];

  let estimatedCredits = 0;
  let pagesFetched = 0;
  let lastPage: number | null = null;
  let lastPageResultCount: number | null = null;
  let totalPages: number | null = null;
  let totalEntries: number | null = null;
  let lastRateLimit: ApolloRateLimitSnapshot | null = null;
  let normalizationMeta: ApolloOrganizationsNormalizationMeta | null = null;
  let terminalError: ApolloErrorClassification | null = null;
  let stopReason: ApolloPaginatedSearchResult['stopReason'] = 'max_pages_reached';
  let guardrailTripped: string | null = null;

  // La huella se calcula con page=1: es estable entre páginas por construcción
  // (buildFiltersFingerprint excluye `page`), así que sirve de ancla idempotente.
  const anchorContract = buildApolloOrganizationsRequestContract({
    ...input.filters,
    page: 1,
    perPage: budget.perPage,
  });
  const requestFingerprint = anchorContract.filtersFingerprint;

  // Un parámetro prohibido es un fallo de contrato, no un aviso. Se detiene
  // antes de gastar un solo crédito.
  if (anchorContract.rejectedForbiddenParams.length > 0) {
    return {
      organizations: [],
      pagesProcessed: 0,
      estimatedCredits: 0,
      stopReason: 'error_terminated',
      terminalError: classifyApolloOrganizationsError({
        httpStatus: 422,
        requestSent: false,
      }),
      indeterminatePages: [],
      pageOutcomes: [],
      requestFingerprint,
      omittedFilters: anchorContract.omittedFilters,
      rejectedForbiddenParams: anchorContract.rejectedForbiddenParams,
      rejectedUnknownParams: anchorContract.rejectedUnknownParams,
      lastRateLimit: null,
      normalizationMeta: null,
      paginationMeta: { totalEntries: null, totalPages: null, lastPage: null },
    };
  }

  // ── Bucle de paginación ─────────────────────────────────────────────────────
  for (;;) {
    const decision = evaluateApolloPaginationDecision(budget, {
      pagesFetched,
      creditsUsed: estimatedCredits,
      candidatesCollected: collected.length,
      elapsedMs: deps.now() - startedAt,
      totalPages,
      lastPage,
      lastPageResultCount,
      cancelled: deps.isCancelled?.() === true,
      guardrailTripped,
    });

    if (!decision.shouldContinue) {
      stopReason = decision.stopReason;
      break;
    }

    const page = decision.nextPage;
    const idempotencyKey = buildApolloPageIdempotencyKey({
      wizardRunId: input.wizardRunId,
      provider: 'apollo',
      filtersFingerprint: requestFingerprint,
      page,
    });

    // Una página ya intentada no se repite — ni exitosa ni indeterminada.
    if (!ledger.canRequest(idempotencyKey)) {
      guardrailTripped = 'page_already_attempted';
      stopReason = 'operational_guardrail';
      break;
    }

    const pageContract = buildApolloOrganizationsRequestContract({
      ...input.filters,
      page,
      perPage: budget.perPage,
    });
    // Defensa en profundidad justo antes de la red.
    assertApolloOrganizationsBodySafe(pageContract.body as unknown as Record<string, unknown>);

    let attempt = 1;
    let pageSettled = false;

    // ── Intentos de una misma página ─────────────────────────────────────────
    while (!pageSettled) {
      ledger.markAttempted(idempotencyKey);
      const attemptStartedAt = deps.now();

      // El transporte real no lanza, pero un transporte inyectado sí puede.
      // Una excepción aquí significa que el request salió y no volvió, así que
      // se trata como timeout ambiguo: cobro desconocido y sin reintento.
      let response: ApolloPageFetchResult;
      try {
        response = await deps.fetchPage(
          pageContract.body as unknown as Record<string, unknown>,
        );
      } catch (err: unknown) {
        response = {
          ok: false,
          status: null,
          requestSent: true,
          malformedBody: false,
          timedOut: true,
          payload: undefined,
          headers: null,
          errorBody: err instanceof Error ? err.message.slice(0, 500) : 'unknown error',
        };
      }

      const latencyMs = deps.now() - attemptStartedAt;
      const rateLimit = parseApolloRateLimitHeaders(response.headers, deps.now());
      lastRateLimit = rateLimit;

      // ── Éxito ──────────────────────────────────────────────────────────────
      if (response.ok && !response.malformedBody) {
        const normalized = normalizeApolloOrganizationsResponse(
          response.payload as Parameters<typeof normalizeApolloOrganizationsResponse>[0],
        );
        normalizationMeta = normalized.meta;

        // Dedup defensivo entre páginas: Apollo puede repetir una organización
        // en páginas contiguas si el índice cambia durante el recorrido.
        let newInThisPage = 0;
        for (const organization of normalized.organizations) {
          const id = organization.providerReference.providerOrganizationId;
          if (seenOrganizationIds.has(id)) continue;
          if (collected.length >= budget.maxCandidates) break;
          seenOrganizationIds.add(id);
          collected.push(organization);
          newInThisPage++;
        }

        const resultsReturned = normalized.organizations.length;
        // Apollo cobra por resultado devuelto. Una página vacía se espera que
        // cueste cero, pero eso está pendiente de confirmación por QA controlado:
        // hasta entonces se estima, no se afirma.
        const pageCredits = resultsReturned;

        estimatedCredits += pageCredits;
        pagesFetched++;
        lastPage = page;
        lastPageResultCount = resultsReturned;
        totalPages = normalized.pagination.totalPages ?? totalPages;
        totalEntries = normalized.pagination.totalEntries ?? totalEntries;

        ledger.markSucceeded(idempotencyKey);
        pageSettled = true;

        pageOutcomes.push({
          page,
          status: 'success',
          resultsReturned,
          estimatedCredits: pageCredits,
          attempt,
          errorCode: null,
          billingState: pageCredits > 0 ? 'charged' : 'not_charged',
        });

        await safeLog(deps.logPage, {
          provider: 'apollo',
          operation: 'organizations_search',
          endpoint: APOLLO_ENDPOINT,
          requestFingerprint,
          idempotencyKey,
          page,
          perPage: budget.perPage,
          resultsReturned,
          estimatedCredits: pageCredits,
          actualCredits: null,
          rateLimit: toRateLimitLogMetadata(rateLimit),
          status: 'success',
          latencyMs,
          attempt,
          errorCategory: null,
          errorCode: null,
          billingState: pageCredits > 0 ? 'charged' : 'not_charged',
          wizardRunId: input.wizardRunId,
          agentRunId: input.agentRunId ?? null,
        });

        // `newInThisPage === 0` con resultados devueltos significa solapamiento
        // total con lo ya recogido — no es motivo para detenerse por sí solo;
        // los topes y total_pages siguen mandando.
        void newInThisPage;
        break;
      }

      // ── Fallo ──────────────────────────────────────────────────────────────
      const classification = classifyApolloOrganizationsError({
        httpStatus: response.status,
        requestSent: response.requestSent,
        timedOut: response.timedOut,
        malformedBody: response.malformedBody,
        rateLimit,
        attempt,
        jitterFactor: deps.random(),
      });

      const outcomeStatus: ApolloPageOutcome['status'] =
        classification.billingState === 'unknown'
          ? 'indeterminate'
          : classification.category === 'rate_limited'
            ? 'rate_limited'
            : 'error';

      if (classification.billingState === 'unknown') {
        ledger.markIndeterminate(idempotencyKey);
      }

      pageOutcomes.push({
        page,
        status: outcomeStatus,
        resultsReturned: 0,
        estimatedCredits: 0,
        attempt,
        errorCode: classification.code,
        billingState: classification.billingState,
      });

      await safeLog(deps.logPage, {
        provider: 'apollo',
        operation: 'organizations_search',
        endpoint: APOLLO_ENDPOINT,
        requestFingerprint,
        idempotencyKey,
        page,
        perPage: budget.perPage,
        resultsReturned: 0,
        estimatedCredits: 0,
        actualCredits: null,
        rateLimit: toRateLimitLogMetadata(rateLimit),
        status: outcomeStatus,
        latencyMs,
        attempt,
        errorCategory: classification.category,
        errorCode: classification.code,
        billingState: classification.billingState,
        wizardRunId: input.wizardRunId,
        agentRunId: input.agentRunId ?? null,
      });

      const canRetry =
        classification.retryable && attempt < APOLLO_MAX_RETRY_ATTEMPTS;

      if (canRetry) {
        if (classification.retryAfterMs !== null && classification.retryAfterMs > 0) {
          await sleep(classification.retryAfterMs);
        }
        // El presupuesto temporal manda sobre el presupuesto de reintentos.
        if (deps.now() - startedAt >= budget.timeoutBudgetMs) {
          terminalError = classification;
          stopReason = 'time_budget_exhausted';
          pageSettled = true;
          break;
        }
        attempt++;
        continue;
      }

      terminalError = classification;
      pageSettled = true;

      if (classification.terminatesPagination || !classification.retryable) {
        stopReason = 'error_terminated';
        // Marca de salida del bucle externo.
        guardrailTripped = 'terminal_provider_error';
      }
      break;
    }

    if (stopReason === 'error_terminated' || guardrailTripped === 'terminal_provider_error') {
      stopReason = 'error_terminated';
      break;
    }
    if (stopReason === 'time_budget_exhausted') break;
  }

  return {
    organizations: collected,
    pagesProcessed: pagesFetched,
    estimatedCredits,
    stopReason,
    terminalError,
    indeterminatePages: pageOutcomes
      .filter((outcome) => outcome.status === 'indeterminate')
      .map((outcome) => outcome.page),
    pageOutcomes,
    requestFingerprint,
    omittedFilters: anchorContract.omittedFilters,
    rejectedForbiddenParams: anchorContract.rejectedForbiddenParams,
    rejectedUnknownParams: anchorContract.rejectedUnknownParams,
    lastRateLimit,
    normalizationMeta,
    paginationMeta: { totalEntries, totalPages, lastPage },
  };
}

/**
 * El registro es observabilidad: un fallo al loggear no puede tumbar una
 * búsqueda que ya gastó créditos reales.
 */
async function safeLog(
  logPage: ApolloPaginatedSearchDeps['logPage'],
  entry: ApolloPageLogEntry,
): Promise<void> {
  if (!logPage) return;
  try {
    await logPage(entry);
  } catch {
    // Intencionalmente silencioso: ver comentario arriba.
  }
}
