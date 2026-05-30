/**
 * DENUE Mexico Connector — Read-only HTTP Client
 *
 * Consulta la API oficial DENUE v1 de INEGI.
 * Token leído desde INEGI_DENUE_TOKEN — nunca hardcodeado, nunca logueado.
 * Timeout máximo: 10s. Hard limit: 20 registros.
 * Sin writes. Sin logging de URLs completas con token.
 */

const DENUE_API_BASE = 'https://www.inegi.org.mx/app/api/denue/v1/consulta';
const DENUE_TIMEOUT_MS = 10_000;
const DENUE_DEFAULT_LIMIT = 5;
const DENUE_HARD_MAX_LIMIT = 20;

const DENUE_HEADERS = {
  'User-Agent': 'SellUp/0.1 data-source-audit',
  Accept: 'application/json',
};

export type FetchDenueParams = {
  /** Código SCIAN de actividad — puede ser prefijo parcial como '5415' o 'todos' */
  codigoActividad?: string;
  /** Clave de entidad federativa INEGI — '09' para CDMX */
  entidad?: string;
  /** Número de registro inicial (1-based) */
  registroInicio?: number;
  limit?: number;
};

export type FetchDenueResult =
  | { ok: true; records: unknown[] }
  | { ok: false; error: string };

/**
 * Consulta el API DENUE BuscarAreaAct.
 * El token se agrega al path pero no se logueará nunca.
 *
 * URL pattern: /BuscarAreaAct/{actividad}/{area}/{registroInicio}/{numeroRegistros}/{token}
 */
export async function fetchDenueDatasetSample(
  params: FetchDenueParams,
): Promise<FetchDenueResult> {
  const token = process.env.INEGI_DENUE_TOKEN;
  if (!token || token.trim() === '') {
    return {
      ok: false,
      error: 'Missing INEGI_DENUE_TOKEN environment variable',
    };
  }

  const limit = Math.min(
    params.limit ?? DENUE_DEFAULT_LIMIT,
    DENUE_HARD_MAX_LIMIT,
  );
  const actividad = params.codigoActividad ?? '5415';
  const entidad = params.entidad ?? '09';
  const registroInicio = params.registroInicio ?? 1;

  // Construir URL con token en path — no loguear la URL completa
  const url = `${DENUE_API_BASE}/BuscarAreaAct/${encodeURIComponent(actividad)}/${encodeURIComponent(entidad)}/${registroInicio}/${limit}/${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DENUE_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: DENUE_HEADERS,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} desde API DENUE INEGI`,
      };
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { ok: false, error: 'Respuesta DENUE no es JSON válido' };
    }

    if (!Array.isArray(parsed)) {
      if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
        return { ok: false, error: 'API DENUE retornó error — verificar token y parámetros' };
      }
      return { ok: false, error: 'Respuesta DENUE inesperada: no es un array JSON' };
    }

    return { ok: true, records: parsed };
  } catch (error: unknown) {
    return { ok: false, error: sanitizeDenueError(error) };
  }
}

function sanitizeDenueError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout')) return 'Timeout al conectar con API DENUE INEGI';
    if (msg.includes('enotfound') || msg.includes('getaddrinfo')) return 'Error DNS al resolver API DENUE INEGI';
    if (msg.includes('ssl') || msg.includes('certificate')) return 'Error SSL al conectar con API DENUE INEGI';
    // No exponer stack trace ni paths ni tokens
    return `Error de red DENUE: ${error.message.slice(0, 120)}`;
  }
  return 'Error desconocido al consultar API DENUE INEGI';
}
