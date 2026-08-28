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
import {
  createApolloProviderSeenLedger,
  recordApolloProviderSeenPage,
  type ApolloPriorProviderSeen,
  EMPTY_APOLLO_PROVIDER_SEEN_SUMMARY,
  type ApolloProviderSeenRecorder,
  type ApolloProviderSeenSummary,
} from './apollo-organizations-provider-seen';

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
  /**
   * P0-2 — memoria provider-seen. Se invoca con las identidades de una página YA
   * PAGADA, inmediatamente después de normalizarla y ANTES de cualquier filtro
   * local. Fail-soft por contrato: su fallo se cuenta y la búsqueda continúa.
   *
   * Ausente ⇒ no se escribe memoria; el resumen se sigue calculando, así que el
   * embudo de benchmark no se degrada por no tener store.
   */
  recordProviderSeen?: ApolloProviderSeenRecorder;
  /**
   * Instante observado, en ISO. Ausente ⇒ se deriva de `now()`, que en Producción
   * es `Date.now`. Inyectable para que las pruebas no dependan del reloj.
   */
  providerSeenNow?: () => string;
  /**
   * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 8, 12 — memoria provider-seen de
   * corridas ANTERIORES, ya cargada por la capa previa al pago.
   *
   * 🔴 Snapshot, no lector: llega resuelto y este módulo no lo muta ni lo
   * recarga. Es la única forma de garantizar que lo que esta búsqueda ESCRIBA no
   * pueda contarse después como conocimiento previo suyo.
   *
   * Ausente ⇒ el embudo publica `provider_seen_hit: null` con su motivo, nunca 0.
   */
  priorProviderSeen?: ApolloPriorProviderSeen;
  /**
   * AGENT1-APOLLO-NET-NEW-PAGINATION § 11 — evalúa si un candidato recién
   * recogido (deduplicado dentro de la página y entre páginas) cuenta para el
   * objetivo NET-NEW, o si es un duplicado histórico que no lo consume.
   *
   * Se invoca UNA vez por candidato nuevo, en el mismo orden en que Apollo lo
   * devolvió. Ausente ⇒ el motor no distingue net-new de duplicado histórico y
   * el tope de paginación sigue siendo `maxCandidates` (comportamiento previo,
   * byte a byte).
   *
   * Fail-closed: si lanza, el candidato se cuenta como NO aceptado — nunca
   * detiene la paginación antes de tiempo por un fallo del evaluador, pero
   * tampoco infla el objetivo con un candidato que no se pudo evaluar.
   */
  evaluateAcceptance?: (
    organization: NormalizedApolloOrganization,
  ) => boolean | Promise<boolean>;
  /**
   * AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING PARTE B — valla durable de página,
   * previa al envío.
   *
   * Ausente ⇒ comportamiento previo al corte, byte a byte: sin valla durable,
   * un proceso que muere a mitad de esta función puede volver a pedir páginas
   * ya pagadas al reintentar. Presente, las tres funciones se invocan en el
   * ORDEN que hace la valla real:
   *
   *   1. `beforeRequest` — se espera a que TERMINE antes de llamar a
   *      `deps.fetchPage`. Si nunca se resuelve o falla, esta función NO
   *      envía la petición (fail-closed sobre la valla misma: mejor no pedir
   *      que pedir sin haber podido registrar el intento).
   *   2. `onSucceeded` / `onIndeterminate` — se esperan ANTES de decidir la
   *      página siguiente, así que un desenlace nunca se pierde por seguir de
   *      largo.
   *
   * Quien implemente estas funciones decide su propia durabilidad (best-effort
   * o estricta); este módulo sólo garantiza el ORDEN relativo a la red.
   */
  durableFence?: {
    beforeRequest: (input: {
      page: number;
      requestFingerprint: string;
    }) => Promise<void>;
    onSucceeded: (input: {
      page: number;
      requestFingerprint: string;
      organizations: NormalizedApolloOrganization[];
      credits: number;
      resultsReturned: number;
      totalPages: number | null;
      acceptedCount: number | null;
    }) => Promise<void>;
    onIndeterminate: (input: {
      page: number;
      requestFingerprint: string;
    }) => Promise<void>;
  };
};

/** Una página ya conocida de forma durable ANTES de que esta invocación arrancara. */
export type ApolloDurablePageRecord = {
  page: number;
  /** Debe coincidir con el `requestFingerprint` que ESTA invocación calcule; si no, se ignora. */
  requestFingerprint: string;
  organizations: NormalizedApolloOrganization[];
  credits: number;
  resultsReturned: number;
  totalPages: number | null;
  /** `null` cuando esa página se pidió sin evaluador de aceptación NET-NEW. */
  acceptedCount: number | null;
};

/**
 * AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING PARTE B — lo que un reintento ya sabe
 * de forma durable sobre ESTA ronda/plan de búsqueda, antes de llamar a esta
 * función de nuevo.
 *
 * `succeededPages` con una huella que NO coincide con la que esta invocación
 * calcula se ignora por completo (§ B7/C13): no es una corrida vieja, es un
 * plan de búsqueda DISTINTO, y confundirlos sería exactamente el defecto que
 * la huella existe para prevenir.
 */
export type ApolloDurableResumeState = {
  succeededPages: ApolloDurablePageRecord[];
  /** Página con valla `request_started` sin desenlace terminal. `null` = ninguna. */
  indeterminatePage: { page: number; requestFingerprint: string } | null;
};

export type ApolloPaginatedSearchInput = {
  filters: Omit<ApolloOrganizationsRequestInput, 'page' | 'perPage'>;
  budget: ApolloPaginationBudget;
  wizardRunId: string;
  agentRunId?: string | null;
  /**
   * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 § 3 — primera página a pedir.
   *
   * Ausente o ≤ 1 ⇒ 1, que es lo que hacen todos los llamadores previos. La
   * modalidad de dos rondas la usa para pedir la página 2 de la misma búsqueda
   * cuando no existe una variante de términos genuinamente distinta: repetir la
   * página 1 con los mismos filtros no puede traer nada nuevo y sí volvería a
   * cobrar.
   */
  startPage?: number;
  /**
   * AGENT1-APOLLO-NET-NEW-PAGINATION § 11/§ 17 — cuántos candidatos NET-NEW
   * (aceptados por `deps.evaluateAcceptance`) hacen falta todavía.
   *
   * Es la autoridad de continuación de negocio: mientras no se alcance, la
   * paginación sigue pidiendo páginas (sujeta a los topes de crédito, páginas y
   * `total_pages`) aunque una página entera resulte ser puro duplicado
   * histórico. Ausente o sin `deps.evaluateAcceptance` ⇒ la autoridad de parada
   * sigue siendo `budget.maxCandidates`, como antes de este hito.
   */
  netNewTarget?: number | null;
  /**
   * AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING PARTE B — estado durable conocido
   * de esta ronda/plan de búsqueda antes de esta invocación. Ausente ⇒
   * comportamiento previo al corte, byte a byte.
   */
  durableResume?: ApolloDurableResumeState;
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
  /**
   * AGENT1-APOLLO-NET-NEW-PAGINATION § 11 — cuántos candidatos NUEVOS de
   * `organizations` fueron ACEPTADOS por `deps.evaluateAcceptance`. `null`
   * cuando ningún evaluador se inyectó: no hay autoridad de negocio con la que
   * distinguir net-new de duplicado histórico.
   */
  acceptedForTargetCount: number | null;
  stopReason:
    | ApolloPaginationStopReason
    | 'error_terminated'
    /**
     * AGENT1-APOLLO-FINAL-SAFETY-CLOSURE · PARTE A — la valla durable previa
     * al envío no pudo persistir `request_started`. PRE_PROVIDER_INFRA_FAILURE:
     * Apollo nunca fue contactado, 0 créditos, seguro de reintentar en una
     * invocación posterior.
     */
    | 'durable_fence_write_failed'
    /**
     * AGENT1-APOLLO-DURABLE-FENCE-HARD-CRASH-FIX · BLOQUEADOR 3 — la página SÍ
     * se pidió (y pudo cobrarse), pero el desenlace terminal (`succeeded` o
     * `indeterminate`) no se pudo persistir de forma durable. La valla durable
     * de esta página se queda en `request_started` — la verdad conservadora
     * que un reintento debe ver como posiblemente cobrada. Continuar pidiendo
     * páginas nuevas en ESTA invocación acumularía más páginas sin desenlace
     * durable confirmado; se detiene aquí, con lo que ya se cobró y recogió
     * conservado.
     */
    | 'durable_fence_terminal_write_failed';
  /** Clasificación del fallo que detuvo la búsqueda. null si terminó limpio. */
  terminalError: ApolloErrorClassification | null;
  /** Páginas cuyo resultado y cobro quedaron indeterminados. Requieren recuperación explícita. */
  indeterminatePages: number[];
  pageOutcomes: ApolloPageOutcome[];
  requestFingerprint: string;
  /**
   * HARDENING-3 § 2 — huella EFECTIVA (página incluida) del PRIMER body que salió
   * realmente al transporte.
   *
   * `requestFingerprint` es el ancla idempotente y excluye `page` a propósito, así
   * que no puede probar que la página construida es la página enviada. Ésta sí: se
   * toma del contrato de la página que se despachó, no del ancla con `page=1`.
   *
   * Null cuando ninguna petición salió (presupuesto agotado antes de la primera
   * página, parámetro prohibido, cancelación). Ausencia, no discrepancia.
   */
  effectiveRequestFingerprintSent: string | null;
  omittedFilters: ApolloOmittedFilter[];
  rejectedForbiddenParams: string[];
  rejectedUnknownParams: string[];
  /** Último snapshot de cuota observado. */
  lastRateLimit: ApolloRateLimitSnapshot | null;
  normalizationMeta: ApolloOrganizationsNormalizationMeta | null;
  /**
   * P0-2 — qué se recordó de lo que el proveedor devolvió, y qué no se pudo
   * recordar. Nunca influye en `organizations`.
   */
  providerSeen: ApolloProviderSeenSummary;
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
  // § 11 — sólo cuenta cuando hay evaluador: su ausencia deja la autoridad de
  // parada en `maxCandidates`, exactamente el comportamiento previo.
  let acceptedForTargetCount: number | null = deps.evaluateAcceptance ? 0 : null;
  const netNewTarget =
    typeof input.netNewTarget === 'number' && Number.isFinite(input.netNewTarget)
      ? Math.max(0, input.netNewTarget)
      : null;
  // P0-2 — el acumulador de memoria vive lo que vive esta búsqueda.
  // CUT-2 § 8 — y arranca con el snapshot PREVIO ya congelado.
  const providerSeenLedger = createApolloProviderSeenLedger(deps.priorProviderSeen);
  const providerSeenNow =
    deps.providerSeenNow ?? (() => new Date(deps.now()).toISOString());

  // § 3 — pedir desde la página N se expresa como "la página N-1 ya se vio": el
  // decisor de paginación calcula la siguiente a partir de la última, así que no
  // hace falta un segundo camino para arrancar en otro sitio.
  const startPage =
    typeof input.startPage === 'number' && Number.isFinite(input.startPage)
      ? Math.max(1, Math.floor(input.startPage))
      : 1;

  let estimatedCredits = 0;
  let pagesFetched = 0;
  let lastPage: number | null = startPage > 1 ? startPage - 1 : null;
  /**
   * Última página REALMENTE obtenida. `lastPage` arranca sembrada para que el
   * decisor pida `startPage`; reportar esa siembra como página observada diría
   * que se pidió una página que nunca salió.
   */
  let observedLastPage: number | null = null;
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
  /**
   * § 2 — se sella con la huella del contrato de la primera página DESPACHADA, y
   * sólo entonces. Mientras siga en null, ninguna petición salió.
   */
  let effectiveRequestFingerprintSent: string | null = null;

  // Un parámetro prohibido es un fallo de contrato, no un aviso. Se detiene
  // antes de gastar un solo crédito.
  if (anchorContract.rejectedForbiddenParams.length > 0) {
    return {
      organizations: [],
      pagesProcessed: 0,
      estimatedCredits: 0,
      acceptedForTargetCount,
      stopReason: 'error_terminated',
      terminalError: classifyApolloOrganizationsError({
        httpStatus: 422,
        requestSent: false,
      }),
      indeterminatePages: [],
      pageOutcomes: [],
      requestFingerprint,
      // Ni una petición salió: la invariante no tiene con qué compararse.
      effectiveRequestFingerprintSent: null,
      omittedFilters: anchorContract.omittedFilters,
      rejectedForbiddenParams: anchorContract.rejectedForbiddenParams,
      rejectedUnknownParams: anchorContract.rejectedUnknownParams,
      lastRateLimit: null,
      normalizationMeta: null,
      // Ni una petición salió: no hay nada visto que recordar.
      providerSeen: EMPTY_APOLLO_PROVIDER_SEEN_SUMMARY,
      paginationMeta: { totalEntries: null, totalPages: null, lastPage: null },
    };
  }

  // ── AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING PARTE B — resumen durable ──────
  //
  // Sólo se confía en un registro cuya huella coincide EXACTAMENTE con la de
  // ESTA invocación (§ B7/C13): una huella distinta describe otro plan de
  // búsqueda —otra ronda, otros filtros— y tratarlo como propio repetiría el
  // defecto que la huella existe para impedir.
  const relevantSucceededPages = (input.durableResume?.succeededPages ?? [])
    .filter((record) => record.requestFingerprint === requestFingerprint)
    .sort((a, b) => a.page - b.page);
  const relevantIndeterminatePage =
    input.durableResume?.indeterminatePage?.requestFingerprint === requestFingerprint
      ? input.durableResume.indeterminatePage
      : null;

  // § B8 — una página con valla `request_started` sin desenlace terminal
  // bloquea CUALQUIER página nueva de este plan de búsqueda. Apollo pudo
  // haberla cobrado; fail-closed, sin reintento automático, cero peticiones
  // nuevas en esta invocación.
  if (relevantIndeterminatePage !== null) {
    for (const record of relevantSucceededPages) {
      for (const organization of record.organizations) {
        const id = organization.providerReference.providerOrganizationId;
        const isNewOrganization = !seenOrganizationIds.has(id);
        if (!isNewOrganization) continue;
        seenOrganizationIds.add(id);
        collected.push(organization);
      }
      estimatedCredits += record.credits;
      pagesFetched++;
      if (typeof record.acceptedCount === 'number') {
        acceptedForTargetCount = (acceptedForTargetCount ?? 0) + record.acceptedCount;
      }
    }
    return {
      organizations: collected,
      pagesProcessed: pagesFetched,
      estimatedCredits,
      acceptedForTargetCount,
      stopReason: 'indeterminate_prior_page_pending_reconciliation',
      terminalError: null,
      indeterminatePages: [relevantIndeterminatePage.page],
      pageOutcomes: [],
      requestFingerprint,
      // Ninguna petición salió EN ESTA invocación: la que dejó la página
      // indeterminada fue un intento anterior.
      effectiveRequestFingerprintSent: null,
      omittedFilters: anchorContract.omittedFilters,
      rejectedForbiddenParams: anchorContract.rejectedForbiddenParams,
      rejectedUnknownParams: anchorContract.rejectedUnknownParams,
      lastRateLimit: null,
      normalizationMeta: null,
      providerSeen: EMPTY_APOLLO_PROVIDER_SEEN_SUMMARY,
      paginationMeta: {
        totalEntries: null,
        totalPages: relevantSucceededPages.at(-1)?.totalPages ?? null,
        lastPage: relevantSucceededPages.at(-1)?.page ?? null,
      },
    };
  }

  // Sin indeterminada pendiente: las páginas ya durablemente exitosas se
  // adoptan sin volver a pedirlas, y la paginación continúa desde la
  // siguiente.
  for (const record of relevantSucceededPages) {
    const key = buildApolloPageIdempotencyKey({
      wizardRunId: input.wizardRunId,
      provider: 'apollo',
      filtersFingerprint: requestFingerprint,
      page: record.page,
    });
    ledger.markSucceeded(key);
    for (const organization of record.organizations) {
      const id = organization.providerReference.providerOrganizationId;
      const isNewOrganization = !seenOrganizationIds.has(id);
      const hasRemainingCapacity = collected.length < budget.maxCandidates;
      if (!isNewOrganization) continue;
      if (!hasRemainingCapacity) break;
      seenOrganizationIds.add(id);
      collected.push(organization);
    }
    estimatedCredits += record.credits;
    pagesFetched++;
    lastPage = lastPage === null ? record.page : Math.max(lastPage, record.page);
    lastPageResultCount = record.resultsReturned;
    totalPages = record.totalPages ?? totalPages;
    if (typeof record.acceptedCount === 'number') {
      acceptedForTargetCount = (acceptedForTargetCount ?? 0) + record.acceptedCount;
    }
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
      acceptedForTargetCount,
      netNewTarget,
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
      // § 2 — el body sale AHORA: se sella la huella efectiva de lo enviado antes
      // de conocer el desenlace. Sólo la primera, que es la que el llamador
      // predijo; sellarla después dejaría la invariante sin dato cuando el
      // transporte falle, que es justo cuando hace falta.
      if (effectiveRequestFingerprintSent === null) {
        effectiveRequestFingerprintSent = pageContract.effectiveRequestFingerprint;
      }

      // AGENT1-APOLLO-FINAL-SAFETY-CLOSURE · PARTE A — la valla se escribe y
      // se ESPERA antes de la petición, y ahora es FAIL-CLOSED: si la
      // persistencia durable no confirma el `request_started`, la petición a
      // Apollo NUNCA sale. Es un PRE_PROVIDER_INFRA_FAILURE — un fallo de la
      // capa local/Supabase, no de Apollo — y se trata igual que cualquier
      // otro fallo terminal de esta página: se registra sin costo (0
      // peticiones, 0 créditos) y detiene la paginación de esta invocación.
      // Ninguna página quedó pedida sin registro: la próxima invocación puede
      // reintentarla con seguridad, porque no hay valla `request_started`
      // huérfana que la bloquee (§ B8) y Apollo nunca la cobró.
      if (deps.durableFence) {
        try {
          await deps.durableFence.beforeRequest({ page, requestFingerprint });
        } catch (fenceErr: unknown) {
          const fenceOutcome: ApolloPageOutcome = {
            page,
            status: 'error',
            resultsReturned: 0,
            estimatedCredits: 0,
            attempt,
            errorCode: 'durable_fence_write_failed',
            billingState: 'not_charged',
          };
          pageOutcomes.push(fenceOutcome);
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
            rateLimit: toRateLimitLogMetadata(parseApolloRateLimitHeaders(null, deps.now())),
            status: 'error',
            latencyMs: deps.now() - attemptStartedAt,
            attempt,
            errorCategory: 'pre_provider_infra_failure',
            errorCode: 'durable_fence_write_failed',
            billingState: 'not_charged',
            wizardRunId: input.wizardRunId,
            agentRunId: input.agentRunId ?? null,
          });
          void fenceErr;
          stopReason = 'durable_fence_write_failed';
          guardrailTripped = 'durable_fence_write_failed';
          pageSettled = true;
          break;
        }
      }

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

        // ── P0-2 · PROVIDER-SEEN — el momento, y sólo éste ─────────────────────
        //
        // Estamos DESPUÉS de comprobar `response.ok && !response.malformedBody` y
        // ANTES del dedupe entre páginas y del tope `maxCandidates`. Ese orden es
        // el hito entero: si la memoria se escribiera después del recorte
        // heredaría sus criterios y volvería a olvidar justo lo que hay que
        // recordar —lo truncado, lo repetido, lo descartado—, que ya se pagó.
        //
        // 🔴 La validez sale de `response.ok`, jamás de `organizations.length`.
        // Una lista vacía es una respuesta legítima sin empresas; un error no es
        // «cero empresas», es ninguna información.
        //
        // 🔴 Fail-soft por contrato: `recordApolloProviderSeenPage` nunca lanza.
        // Una página ya comprada no se puede perder por un fallo de memoria.
        await recordApolloProviderSeenPage(providerSeenLedger, normalized.organizations, {
          record: deps.recordProviderSeen,
          correlationId: input.wizardRunId,
          observedAt: providerSeenNow(),
        });

        // Dedup defensivo entre páginas: Apollo puede repetir una organización
        // en páginas contiguas si el índice cambia durante el recorrido.
        let newInThisPage = 0;
        // § B5/B6 — sólo lo NUEVO de esta página, para la valla durable: un
        // duplicado ya vive en el registro de la página que lo trajo primero.
        const newOrganizationsThisPage: NormalizedApolloOrganization[] = [];
        let acceptedInThisPage = 0;
        for (const organization of normalized.organizations) {
          const id = organization.providerReference.providerOrganizationId;
          if (seenOrganizationIds.has(id)) continue;
          if (collected.length >= budget.maxCandidates) break;
          seenOrganizationIds.add(id);
          collected.push(organization);
          newOrganizationsThisPage.push(organization);
          newInThisPage++;

          // § 11 — sólo el candidato NUEVO de esta página se evalúa: uno ya visto
          // en una página anterior no puede volver a contar para el objetivo.
          if (deps.evaluateAcceptance) {
            let accepted = false;
            try {
              accepted = await deps.evaluateAcceptance(organization);
            } catch {
              // Fail-closed: un evaluador que lanza no cuenta el candidato, pero
              // tampoco detiene la búsqueda — sólo se lo trata como no aceptado.
              accepted = false;
            }
            if (accepted) {
              acceptedForTargetCount = (acceptedForTargetCount ?? 0) + 1;
              acceptedInThisPage++;
            }
          }
        }

        const resultsReturned = normalized.organizations.length;
        // AGENT1-APOLLO-NET-NEW-PAGINATION § 4/§ 21 — Apollo Support confirmó el
        // modelo real de facturación de Organization Search: 1 crédito por página
        // NO VACÍA, sin importar cuántos resultados traiga (100 cuestan lo mismo
        // que 1). Cero créditos sólo cuando la página no trajo NADA.
        //
        // 🔴 La no-vacuidad se mide sobre la respuesta CRUDA (organizations[] o
        // accounts[]), no sobre `resultsReturned` — que ya perdió las filas
        // accounts-only tras el corte de fuga (§ 2). Una página accounts-only
        // sigue siendo una página con resultados y sigue costando 1 crédito
        // (Scenario H), aunque produzca cero candidatos de descubrimiento.
        const rawPageHadResults =
          normalized.meta.organizations_raw_count > 0 ||
          normalized.meta.accounts_raw_count > 0;
        const pageCredits = rawPageHadResults ? 1 : 0;

        estimatedCredits += pageCredits;
        pagesFetched++;
        lastPage = page;
        observedLastPage = page;
        lastPageResultCount = resultsReturned;
        totalPages = normalized.pagination.totalPages ?? totalPages;
        totalEntries = normalized.pagination.totalEntries ?? totalEntries;

        ledger.markSucceeded(idempotencyKey);
        pageSettled = true;

        // § B5 — el desenlace terminal se escribe y se ESPERA ANTES de decidir
        // la página siguiente.
        //
        // AGENT1-APOLLO-DURABLE-FENCE-HARD-CRASH-FIX · BLOQUEADOR 3 — antes de
        // este corte un fallo aquí era silencioso y la paginación seguía de
        // largo pidiendo la página siguiente, aunque la valla durable de ESTA
        // página se hubiera quedado en `request_started` (posiblemente
        // cobrada, nunca confirmada). Ahora se detiene: lo ya cobrado y
        // recogido en esta invocación se conserva, pero ninguna página nueva
        // se pide hasta que un reintento reconcilie esta página.
        let terminalFenceWriteFailed = false;
        if (deps.durableFence) {
          try {
            await deps.durableFence.onSucceeded({
              page,
              requestFingerprint,
              organizations: newOrganizationsThisPage,
              credits: pageCredits,
              resultsReturned,
              totalPages,
              acceptedCount: deps.evaluateAcceptance ? acceptedInThisPage : null,
            });
          } catch {
            terminalFenceWriteFailed = true;
          }
        }

        pageOutcomes.push({
          page,
          status: 'success',
          resultsReturned,
          estimatedCredits: pageCredits,
          attempt,
          errorCode: terminalFenceWriteFailed ? 'durable_fence_terminal_write_failed' : null,
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
          errorCategory: terminalFenceWriteFailed ? 'pre_provider_infra_failure' : null,
          errorCode: terminalFenceWriteFailed ? 'durable_fence_terminal_write_failed' : null,
          billingState: pageCredits > 0 ? 'charged' : 'not_charged',
          wizardRunId: input.wizardRunId,
          agentRunId: input.agentRunId ?? null,
        });

        if (terminalFenceWriteFailed) {
          stopReason = 'durable_fence_terminal_write_failed';
          guardrailTripped = 'durable_fence_terminal_write_failed';
        }

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
        // § B5/B8/B9 — el desenlace indeterminado también se espera antes de
        // seguir: es exactamente el estado que un reintento debe encontrar
        // para no repetir esta página automáticamente.
        //
        // BLOQUEADOR 3 — a diferencia de `onSucceeded`, un fallo AQUÍ no
        // necesita un `stopReason` explícito propio: `billingState ===
        // 'unknown'` sólo lo produce una clasificación con `retryable: false`
        // (ver `apollo-organizations-error-taxonomy.ts`), así que las líneas de
        // abajo YA fuerzan `stopReason = 'error_terminated'` para esta misma
        // página sin importar si esta escritura tuvo éxito. La verdad
        // conservadora que protege el reintento es la que `beforeRequest` ya
        // dejó durable (`request_started`): si esta escritura falla, esa
        // entrada simplemente no se actualiza a `indeterminate`, y § B1 del
        // adaptador de resumen (`toApolloDurableResumeState`) trata
        // `request_started` igual que `indeterminate`.
        if (deps.durableFence) {
          try {
            await deps.durableFence.onIndeterminate({ page, requestFingerprint });
          } catch {
            // Intencionalmente silencioso: ver comentario arriba.
          }
        }
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
    if (
      stopReason === 'durable_fence_write_failed' ||
      guardrailTripped === 'durable_fence_write_failed'
    ) {
      stopReason = 'durable_fence_write_failed';
      break;
    }
    if (
      stopReason === 'durable_fence_terminal_write_failed' ||
      guardrailTripped === 'durable_fence_terminal_write_failed'
    ) {
      stopReason = 'durable_fence_terminal_write_failed';
      break;
    }
  }

  return {
    organizations: collected,
    pagesProcessed: pagesFetched,
    estimatedCredits,
    acceptedForTargetCount,
    stopReason,
    terminalError,
    indeterminatePages: pageOutcomes
      .filter((outcome) => outcome.status === 'indeterminate')
      .map((outcome) => outcome.page),
    pageOutcomes,
    requestFingerprint,
    effectiveRequestFingerprintSent,
    omittedFilters: anchorContract.omittedFilters,
    rejectedForbiddenParams: anchorContract.rejectedForbiddenParams,
    rejectedUnknownParams: anchorContract.rejectedUnknownParams,
    lastRateLimit,
    normalizationMeta,
    providerSeen: providerSeenLedger.summary(),
    paginationMeta: { totalEntries, totalPages, lastPage: observedLastPage },
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
