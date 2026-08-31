/**
 * AGENT1-LUSHA-CUT-L2 § I/J — Lectura de los headers de cuota de Lusha V3.
 *
 * ── El hecho HUMANO que gobierna este módulo ─────────────────────────────────
 *
 * El soporte de Lusha confirmó, por un agente HUMANO, que `POST
 * /v3/companies/prospecting` responde con estos cuatro headers:
 *
 *     x-rate-limit-minute       — límite de la ventana de minuto
 *     x-minute-requests-left    — peticiones restantes en el minuto
 *     x-rate-limit-daily        — límite de la ventana diaria
 *     x-daily-requests-left     — peticiones restantes en el día
 *
 * El repo leía `x-ratelimit-limit` / `x-ratelimit-remaining` / `x-ratelimit-reset`,
 * que no son los que Lusha envía: la cuota se registraba SIEMPRE como null y
 * nadie podía verlo, porque un null «header ausente» es indistinguible de un
 * null «header mal nombrado».
 *
 * 🔴 Los nominales que el soporte citó de pasada (40–300 RPM) NO se hardcodean.
 * La autoridad es el header de cada respuesta: el plan puede cambiar sin que este
 * repo se entere, y un tope inventado en el código mentiría en cuanto cambiara.
 *
 * Puro: recibe headers ya obtenidos, no hace fetch. No lee credenciales — estos
 * headers no contienen ninguna, y `api_key` jamás se lee aquí.
 *
 * Nunca lanza. Un header ausente, vacío, no numérico o negativo produce `null`,
 * que significa «Lusha no lo reportó» y NUNCA debe leerse como cero: cero es una
 * cuota agotada, y confundir «no sé» con «agotado» es la dirección equivocada.
 */

/**
 * Interfaz mínima de lectura — la cumple `Headers` del runtime y también un
 * objeto plano de test. `Headers.get()` es case-insensitive por especificación,
 * así que los nombres se escriben en minúscula y no se normaliza a mano.
 */
export type LushaHeaderReader = {
  get(name: string): string | null;
};

/** Nombres EXACTOS confirmados por el soporte humano de Lusha. */
export const LUSHA_RATE_LIMIT_HEADER_NAMES = {
  minuteLimit: 'x-rate-limit-minute',
  minuteRemaining: 'x-minute-requests-left',
  dailyLimit: 'x-rate-limit-daily',
  dailyRemaining: 'x-daily-requests-left',
} as const;

export type LushaRateLimitSnapshot = {
  /** Límite de la ventana de minuto. null si el header no vino o no es válido. */
  minuteLimit: number | null;
  /** Restantes en el minuto. null si el header no vino o no es válido. */
  minuteRemaining: number | null;
  /** Límite de la ventana diaria. null si el header no vino o no es válido. */
  dailyLimit: number | null;
  /** Restantes en el día. null si el header no vino o no es válido. */
  dailyRemaining: number | null;
  /** true si AL MENOS uno de los cuatro headers llegó con un valor utilizable. */
  anyHeaderPresent: boolean;
};

export function emptyLushaRateLimitSnapshot(): LushaRateLimitSnapshot {
  return {
    minuteLimit: null,
    minuteRemaining: null,
    dailyLimit: null,
    dailyRemaining: null,
    anyHeaderPresent: false,
  };
}

/**
 * Lee un header entero de cuota.
 *
 * Devuelve null —jamás lanza ni fabrica un default— cuando:
 *   · el header no vino;
 *   · `get()` lanzó (implementación hostil de headers);
 *   · el valor está vacío o no es un entero finito;
 *   · el valor es negativo, que es imposible para un contador de cuota.
 */
function readCountHeader(headers: LushaHeaderReader, name: string): number | null {
  let raw: string | null;
  try {
    raw = headers.get(name);
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return null;

  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Number() en vez de parseInt(): parseInt("12abc") daría 12, y un header
  // corrupto no debe convertirse en un número que parezca fiable.
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 0) return null;

  return parsed;
}

/**
 * Extrae el estado de cuota de una respuesta de Lusha Prospecting V3.
 *
 * `headers` null/undefined —no hubo respuesta— produce el snapshot vacío, no un
 * fallo: un timeout no tiene cuota que reportar.
 */
export function parseLushaRateLimitHeaders(
  headers: LushaHeaderReader | null | undefined,
): LushaRateLimitSnapshot {
  if (!headers || typeof headers.get !== 'function') {
    return emptyLushaRateLimitSnapshot();
  }

  const minuteLimit = readCountHeader(headers, LUSHA_RATE_LIMIT_HEADER_NAMES.minuteLimit);
  const minuteRemaining = readCountHeader(headers, LUSHA_RATE_LIMIT_HEADER_NAMES.minuteRemaining);
  const dailyLimit = readCountHeader(headers, LUSHA_RATE_LIMIT_HEADER_NAMES.dailyLimit);
  const dailyRemaining = readCountHeader(headers, LUSHA_RATE_LIMIT_HEADER_NAMES.dailyRemaining);

  return {
    minuteLimit,
    minuteRemaining,
    dailyLimit,
    dailyRemaining,
    anyHeaderPresent:
      minuteLimit !== null ||
      minuteRemaining !== null ||
      dailyLimit !== null ||
      dailyRemaining !== null,
  };
}

/**
 * Lee el trace de petición generado POR EL SERVIDOR de Lusha (`x-request-id`).
 *
 * 🔴 Sólo del header. Si Lusha no lo envía se devuelve null y ahí se acaba: NO se
 * sintetiza un identificador local para rellenar el hueco. El `client_request_id`
 * de SellUp existe y es útil, pero es NUESTRO y no identifica la petición dentro
 * de Lusha — usarlo aquí insinuaría una idempotencia de proveedor que el soporte
 * humano confirmó que NO existe (sin Idempotency-Key, sin requestId de cliente,
 * sin API de recuperación de respuesta).
 */
export function readLushaProviderRequestId(
  headers: LushaHeaderReader | null | undefined,
): string | null {
  if (!headers || typeof headers.get !== 'function') return null;
  let raw: string | null;
  try {
    raw = headers.get('x-request-id');
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}
