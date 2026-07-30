/**
 * A1-APOLLO-WIZARD-1 — Lectura de headers de rate limit de Apollo.
 *
 * Puro: recibe headers ya obtenidos, no hace fetch. Sin secretos — los headers
 * de cuota no contienen credenciales y nunca se lee `X-Api-Key` aquí.
 *
 * Los límites nominales confirmados para la cuenta durante soporte son:
 *   mixed_companies/search → 200/min, 6.000/hora, 50.000/24h
 *
 * Esos números NO se hardcodean como fuente de verdad. La implementación confía
 * en los headers reales de cada respuesta, porque el plan puede cambiar sin que
 * este repo se entere. Los nominales quedan documentados sólo como referencia.
 */

/** Ventanas de cuota que Apollo reporta. */
export type ApolloRateLimitWindow = 'minute' | 'hourly' | 'daily';

export type ApolloRateLimitWindowState = {
  window: ApolloRateLimitWindow;
  /** Consumido en la ventana. null si el header no vino. */
  used: number | null;
  /** Restante en la ventana. null si el header no vino. */
  remaining: number | null;
  /** Límite de la ventana. null si el header no vino. */
  limit: number | null;
};

export type ApolloRateLimitSnapshot = {
  minute: ApolloRateLimitWindowState;
  hourly: ApolloRateLimitWindowState;
  daily: ApolloRateLimitWindowState;
  /** `Retry-After` en segundos, cuando Apollo lo envía. */
  retryAfterSeconds: number | null;
  /** True si algún header de cuota estaba presente. */
  anyHeaderPresent: boolean;
};

/** Interfaz mínima de lectura — sirve para `Headers` y para un objeto plano. */
export type HeaderReader = {
  get(name: string): string | null;
};

const HEADER_NAMES: Record<
  ApolloRateLimitWindow,
  { used: string; remaining: string; limit: string }
> = {
  minute: {
    used: 'x-minute-usage',
    remaining: 'x-minute-requests-left',
    limit: 'x-rate-limit-minute',
  },
  hourly: {
    used: 'x-hourly-usage',
    remaining: 'x-hourly-requests-left',
    limit: 'x-rate-limit-hourly',
  },
  daily: {
    used: 'x-24-hour-usage',
    remaining: 'x-24-hour-requests-left',
    limit: 'x-rate-limit-24-hour',
  },
};

function readIntHeader(headers: HeaderReader, name: string): number | null {
  let raw: string | null;
  try {
    raw = headers.get(name);
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `Retry-After` admite segundos o fecha HTTP. Se soportan ambos; la fecha se
 * resuelve contra `nowMs`, que se inyecta para que el parseo sea determinista.
 */
export function parseRetryAfterSeconds(
  raw: string | null | undefined,
  nowMs: number,
): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds)) {
    return asSeconds >= 0 ? Math.ceil(asSeconds) : null;
  }

  const asDateMs = Date.parse(trimmed);
  if (Number.isFinite(asDateMs)) {
    const deltaSeconds = Math.ceil((asDateMs - nowMs) / 1000);
    return deltaSeconds > 0 ? deltaSeconds : 0;
  }

  return null;
}

/**
 * Extrae el estado de cuota de una respuesta de Apollo.
 *
 * Nunca lanza: unos headers ausentes o corruptos producen nulls, no un fallo.
 * Un `null` significa "Apollo no lo reportó" y nunca debe leerse como cero.
 */
export function parseApolloRateLimitHeaders(
  headers: HeaderReader | null | undefined,
  nowMs: number,
): ApolloRateLimitSnapshot {
  const empty = (window: ApolloRateLimitWindow): ApolloRateLimitWindowState => ({
    window,
    used: null,
    remaining: null,
    limit: null,
  });

  if (!headers || typeof headers.get !== 'function') {
    return {
      minute: empty('minute'),
      hourly: empty('hourly'),
      daily: empty('daily'),
      retryAfterSeconds: null,
      anyHeaderPresent: false,
    };
  }

  const readWindow = (window: ApolloRateLimitWindow): ApolloRateLimitWindowState => ({
    window,
    used: readIntHeader(headers, HEADER_NAMES[window].used),
    remaining: readIntHeader(headers, HEADER_NAMES[window].remaining),
    limit: readIntHeader(headers, HEADER_NAMES[window].limit),
  });

  const minute = readWindow('minute');
  const hourly = readWindow('hourly');
  const daily = readWindow('daily');

  let retryAfterRaw: string | null = null;
  try {
    retryAfterRaw = headers.get('retry-after');
  } catch {
    retryAfterRaw = null;
  }

  const anyHeaderPresent = [minute, hourly, daily].some(
    (state) => state.used !== null || state.remaining !== null || state.limit !== null,
  );

  return {
    minute,
    hourly,
    daily,
    retryAfterSeconds: parseRetryAfterSeconds(retryAfterRaw, nowMs),
    anyHeaderPresent,
  };
}

/**
 * Ventana que quedó sin margen, si la respuesta lo permite determinar.
 *
 * Devuelve null cuando Apollo no envió los headers: ante un 429 sin evidencia,
 * "no se sabe" es la respuesta correcta, no una suposición.
 */
export function identifyExhaustedRateLimitWindow(
  snapshot: ApolloRateLimitSnapshot,
): ApolloRateLimitWindow | null {
  for (const state of [snapshot.minute, snapshot.hourly, snapshot.daily]) {
    if (state.remaining !== null && state.remaining <= 0) return state.window;
  }
  return null;
}

/** Metadata plana para `provider_usage_logs`. Sin secretos. */
export function toRateLimitLogMetadata(
  snapshot: ApolloRateLimitSnapshot,
): Record<string, number | string | boolean | null> {
  return {
    rate_limit_headers_present: snapshot.anyHeaderPresent,
    rate_limit_minute_used: snapshot.minute.used,
    rate_limit_minute_remaining: snapshot.minute.remaining,
    rate_limit_minute_limit: snapshot.minute.limit,
    rate_limit_hourly_used: snapshot.hourly.used,
    rate_limit_hourly_remaining: snapshot.hourly.remaining,
    rate_limit_hourly_limit: snapshot.hourly.limit,
    rate_limit_daily_used: snapshot.daily.used,
    rate_limit_daily_remaining: snapshot.daily.remaining,
    rate_limit_daily_limit: snapshot.daily.limit,
    rate_limit_retry_after_seconds: snapshot.retryAfterSeconds,
    rate_limit_exhausted_window: identifyExhaustedRateLimitWindow(snapshot),
  };
}
