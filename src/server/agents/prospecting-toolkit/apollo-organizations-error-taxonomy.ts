/**
 * A1-APOLLO-WIZARD-1 — Taxonomía de errores de Apollo Organization Search.
 *
 * Puro y determinista: el jitter y el reloj se inyectan.
 *
 * Regla central: un error de Apollo NUNCA se convierte en "cero resultados"
 * silenciosos. Un 401 y una búsqueda legítimamente vacía tienen consecuencias
 * opuestas — la primera exige intervención, la segunda es un resultado válido —
 * y colapsarlas fue históricamente la fuente de diagnósticos falsos.
 */

import type { ApolloRateLimitSnapshot } from '@/server/integrations/apollo-rate-limit-headers';
import { identifyExhaustedRateLimitWindow } from '@/server/integrations/apollo-rate-limit-headers';

// ─── Categorías ───────────────────────────────────────────────────────────────

export type ApolloErrorCategory =
  | 'invalid_credential'
  | 'insufficient_plan_or_scope'
  | 'invalid_request'
  | 'rate_limited'
  | 'provider_failure'
  | 'network_timeout'
  | 'malformed_response'
  | 'budget_exceeded'
  | 'feature_disabled'
  | 'provider_unavailable';

/**
 * Estado de facturación del intento.
 *
 * `unknown` es una categoría de primera clase: si el request salió y la
 * respuesta nunca llegó, Apollo pudo haber cobrado. Registrarlo como `not_charged`
 * sería inventar un hecho.
 */
export type ApolloAttemptBillingState = 'not_charged' | 'charged' | 'unknown';

export type ApolloErrorClassification = {
  category: ApolloErrorCategory;
  /** Código estático, seguro de loggear y de comparar en tests. */
  code: string;
  httpStatus: number | null;
  /** Si es seguro reintentar la MISMA página automáticamente. */
  retryable: boolean;
  billingState: ApolloAttemptBillingState;
  /** Si debe detener la paginación de esta ejecución. */
  terminatesPagination: boolean;
  /** Ventana de cuota excedida, cuando la respuesta permite determinarla. */
  exhaustedWindow: 'minute' | 'hourly' | 'daily' | null;
  /** Espera sugerida antes de un reintento permitido. null si no procede. */
  retryAfterMs: number | null;
  /** De dónde salió la espera. */
  retryAfterSource: 'retry_after_header' | 'exponential_backoff_with_jitter' | null;
};

// ─── Backoff ──────────────────────────────────────────────────────────────────

export const APOLLO_BACKOFF_BASE_MS = 1_000;
export const APOLLO_BACKOFF_MAX_MS = 30_000;
export const APOLLO_MAX_RETRY_ATTEMPTS = 3;

/**
 * Backoff exponencial con jitter. `jitterFactor` ∈ [0,1] se inyecta: sin eso,
 * el backoff no sería testeable de forma determinista.
 */
export function computeApolloBackoffMs(
  attempt: number,
  jitterFactor: number,
): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
  const safeJitter = Number.isFinite(jitterFactor)
    ? Math.min(1, Math.max(0, jitterFactor))
    : 0;

  const exponential = Math.min(
    APOLLO_BACKOFF_MAX_MS,
    APOLLO_BACKOFF_BASE_MS * 2 ** (safeAttempt - 1),
  );
  // Jitter completo (0..exponencial) para evitar reintentos sincronizados.
  return Math.round(exponential * safeJitter);
}

// ─── Clasificación ────────────────────────────────────────────────────────────

export type ApolloErrorClassificationInput = {
  /** Status HTTP; null si nunca hubo respuesta (timeout / fallo de red). */
  httpStatus: number | null;
  /** True si el request llegó a enviarse. Decide si el cobro es "unknown". */
  requestSent: boolean;
  /** True si el fallo fue timeout / abort. */
  timedOut?: boolean;
  /** True si hubo 200 pero el cuerpo no era interpretable. */
  malformedBody?: boolean;
  rateLimit?: ApolloRateLimitSnapshot | null;
  /** Intento actual (1-indexed) para el backoff. */
  attempt?: number;
  /** Jitter inyectado ∈ [0,1]. */
  jitterFactor?: number;
};

/**
 * Clasifica un fallo de Apollo Organization Search en una categoría estable.
 *
 * Precedencia deliberada: primero los estados donde no hubo respuesta (timeout /
 * red), porque ahí el cobro es desconocido y esa incertidumbre manda sobre
 * cualquier otra lectura.
 */
export function classifyApolloOrganizationsError(
  input: ApolloErrorClassificationInput,
): ApolloErrorClassification {
  const attempt = input.attempt ?? 1;
  const jitterFactor = input.jitterFactor ?? 0;
  const rateLimit = input.rateLimit ?? null;

  const base = {
    httpStatus: input.httpStatus,
    exhaustedWindow: rateLimit ? identifyExhaustedRateLimitWindow(rateLimit) : null,
    retryAfterMs: null as number | null,
    retryAfterSource: null as ApolloErrorClassification['retryAfterSource'],
  };

  // ── Timeout / red ──────────────────────────────────────────────────────────
  if (input.timedOut === true || (input.httpStatus === null && input.requestSent)) {
    // El request salió y la respuesta nunca llegó: Apollo pudo procesarlo y
    // cobrarlo. Reintentar la misma página a ciegas puede duplicar el cargo,
    // así que este caso NO es reintentable automáticamente.
    return {
      ...base,
      category: 'network_timeout',
      code: 'apollo_timeout_after_request_sent',
      retryable: false,
      billingState: 'unknown',
      terminatesPagination: true,
    };
  }

  if (input.httpStatus === null && !input.requestSent) {
    // Nunca salió del proceso: no hay cobro posible y reintentar es seguro.
    return {
      ...base,
      category: 'network_timeout',
      code: 'apollo_request_not_sent',
      retryable: true,
      billingState: 'not_charged',
      terminatesPagination: false,
      retryAfterMs: computeApolloBackoffMs(attempt, jitterFactor),
      retryAfterSource: 'exponential_backoff_with_jitter',
    };
  }

  if (input.malformedBody === true) {
    // 200 con cuerpo ilegible: Apollo probablemente cobró la búsqueda.
    return {
      ...base,
      category: 'malformed_response',
      code: 'apollo_malformed_response',
      retryable: false,
      billingState: 'unknown',
      terminatesPagination: true,
    };
  }

  const status = input.httpStatus;

  if (status === 401) {
    return {
      ...base,
      category: 'invalid_credential',
      code: 'apollo_http_401_invalid_credential',
      retryable: false,
      billingState: 'not_charged',
      terminatesPagination: true,
    };
  }

  if (status === 403) {
    return {
      ...base,
      category: 'insufficient_plan_or_scope',
      code: 'apollo_http_403_insufficient_plan_or_scope',
      retryable: false,
      billingState: 'not_charged',
      terminatesPagination: true,
    };
  }

  if (status === 422) {
    // Filtro o parámetro inválido: reintentar el mismo body repite el error.
    return {
      ...base,
      category: 'invalid_request',
      code: 'apollo_http_422_invalid_request',
      retryable: false,
      billingState: 'not_charged',
      terminatesPagination: true,
    };
  }

  if (status === 429) {
    const headerRetryAfter = rateLimit?.retryAfterSeconds ?? null;
    const usedHeader = headerRetryAfter !== null;
    return {
      ...base,
      category: 'rate_limited',
      code: 'apollo_http_429_rate_limited',
      retryable: true,
      billingState: 'not_charged',
      terminatesPagination: false,
      retryAfterMs: usedHeader
        ? headerRetryAfter * 1000
        : computeApolloBackoffMs(attempt, jitterFactor),
      retryAfterSource: usedHeader
        ? 'retry_after_header'
        : 'exponential_backoff_with_jitter',
    };
  }

  if (typeof status === 'number' && status >= 500) {
    return {
      ...base,
      category: 'provider_failure',
      code: `apollo_http_${status}_provider_failure`,
      retryable: true,
      billingState: 'not_charged',
      terminatesPagination: false,
      retryAfterMs: computeApolloBackoffMs(attempt, jitterFactor),
      retryAfterSource: 'exponential_backoff_with_jitter',
    };
  }

  return {
    ...base,
    category: 'provider_failure',
    code: `apollo_http_${status ?? 'unknown'}_unclassified`,
    retryable: false,
    billingState: 'not_charged',
    terminatesPagination: true,
  };
}

// ─── Estados no-HTTP ──────────────────────────────────────────────────────────

/**
 * Clasificaciones para condiciones que se deciden ANTES de tocar la red. Ninguna
 * implica cobro porque ninguna llega a Apollo.
 */
export function classifyApolloPreflightBlock(
  reason: 'feature_disabled' | 'provider_unavailable' | 'budget_exceeded',
): ApolloErrorClassification {
  const codes: Record<typeof reason, string> = {
    feature_disabled: 'apollo_company_search_disabled',
    provider_unavailable: 'apollo_provider_unavailable',
    budget_exceeded: 'apollo_budget_exceeded',
  };

  return {
    category: reason,
    code: codes[reason],
    httpStatus: null,
    retryable: false,
    billingState: 'not_charged',
    terminatesPagination: true,
    exhaustedWindow: null,
    retryAfterMs: null,
    retryAfterSource: null,
  };
}

/** Metadata plana para `provider_usage_logs`. Sin secretos, sin PII. */
export function toApolloErrorLogMetadata(
  classification: ApolloErrorClassification,
): Record<string, string | number | boolean | null> {
  return {
    error_category: classification.category,
    error_code: classification.code,
    http_status: classification.httpStatus,
    retryable: classification.retryable,
    billing_state: classification.billingState,
    terminates_pagination: classification.terminatesPagination,
    exhausted_rate_limit_window: classification.exhaustedWindow,
    retry_after_ms: classification.retryAfterMs,
    retry_after_source: classification.retryAfterSource,
  };
}
