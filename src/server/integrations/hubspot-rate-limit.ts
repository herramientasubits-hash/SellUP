/**
 * hubspot-rate-limit.ts — una petición a HubSpot que REINTENTA cuando HubSpot dice
 * «demasiadas peticiones» (429).
 *
 * HUBSPOT-FREE-POOL-SOURCE-1. Medido el 15-10 contra el portal real: 20 chequeos de
 * duplicado en paralelo ⇒ 23 de 46 peticiones con 429. Los lectores tratan una
 * respuesta no-OK como «sin resultados», así que una empresa que SÍ está en HubSpot
 * pasaba por nueva (y al aprobarse podía crearse duplicada en HubSpot). La búsqueda
 * de HubSpot permite ~5 peticiones por segundo por cuenta.
 *
 * Cada intento lleva su propio tope de espera (`timeoutMs`): un reintento no hereda
 * un reloj casi vencido. Respeta `Retry-After` cuando HubSpot lo manda; si no,
 * espera 1 s, 2 s, 4 s (+ azar para no volver a chocar todos a la vez).
 */

export const HUBSPOT_RATE_LIMIT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_WAIT_MS = 10_000;

export type HubSpotRetryOptions = {
  maxRetries?: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Espera antes del reintento `attempt` (0, 1, 2…). */
export function hubSpotRetryDelayMs(retryAfterHeader: string | null, attempt: number, random: () => number): number {
  const seconds = Number(retryAfterHeader);
  if (retryAfterHeader !== null && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_WAIT_MS, Math.round(seconds * 1000));
  }
  return Math.min(MAX_WAIT_MS, BASE_BACKOFF_MS * 2 ** attempt + Math.round(random() * 250));
}

export async function fetchHubSpotWithRetry(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  timeoutMs: number,
  options: HubSpotRetryOptions = {},
): Promise<Response> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const maxRetries = options.maxRetries ?? HUBSPOT_RATE_LIMIT_MAX_RETRIES;
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 429 || attempt >= maxRetries) {
      if (res.status === 429) {
        console.warn(`[hubspot] 429 tras ${attempt + 1} intentos: ${url.replace(/\?.*$/, '')}`);
      }
      return res;
    }
    await sleep(hubSpotRetryDelayMs(res.headers.get('retry-after'), attempt, random));
  }
}
