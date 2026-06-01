/**
 * DENUE Mexico Connector — Read-only HTTP Client
 *
 * Consulta la API oficial DENUE v1 de INEGI mediante el método BuscarEntidad.
 * Token leído desde INEGI_DENUE_TOKEN (fallback env) o desde SourceConnectionResolver.
 * Nunca hardcodeado, nunca logueado.
 * Timeout máximo: 10s. Hard limit: 20 registros.
 * Sin writes. Sin logging de URLs completas con token.
 *
 * Nota de método: La API DENUE v1 expone BuscarEntidad para obtener
 * establecimientos por entidad federativa. El filtrado por código SCIAN
 * no está disponible en el path de BuscarEntidad; se realiza a nivel cliente.
 */

const DENUE_API_BASE = 'https://www.inegi.org.mx/app/api/denue/v1/consulta';
const DENUE_TIMEOUT_MS = 10_000;
const DENUE_DEFAULT_LIMIT = 5;
const DENUE_HARD_MAX_LIMIT = 20;
const DENUE_TEST_LIMIT = 1;

const DENUE_HEADERS = {
  'User-Agent': 'SellUp/0.1 data-source-audit',
};

export type FetchDenueParams = {
  /** Clave de entidad federativa INEGI — '09' para CDMX, '19' NL, '14' Jalisco */
  entidad?: string;
  /** Término de búsqueda para el campo condicion de BuscarEntidad.
   *  'todos' devuelve todos. Palabras como 'tecnologia', 'software', 'consultoria'
   *  filtran por nombre/actividad en el lado del API DENUE. */
  condicion?: string;
  /** Número de registro inicial (1-based) */
  registroInicio?: number;
  limit?: number;
  /** Token explícito — si se omite, usa env INEGI_DENUE_TOKEN */
  token?: string;
};

export type FetchDenueResult =
  | { ok: true; records: unknown[] }
  | { ok: false; error: string };

export type DenueConnectionTestResult = {
  ok: boolean;
  httpStatus?: number;
  responseTimeMs?: number;
  error?: string;
};

/**
 * Consulta el API DENUE mediante BuscarEntidad.
 * El token se agrega al path pero no se logueará nunca.
 *
 * Acepta token explícito en params.token; si no se provee usa INEGI_DENUE_TOKEN.
 * Esto permite que el SourceConnectionResolver inyecte el token resuelto desde Vault
 * sin romper el dry-run local que usa la variable de entorno directamente.
 *
 * URL pattern: /BuscarEntidad/{condicion}/{entidad}/{reg_ini}/{num_reg}/{token}
 *
 * Campos que devuelve la API (nombres reales, versión 2024+):
 *   CLEE, Id, Nombre, Razon_social, Clase_actividad, Estrato,
 *   Tipo_vialidad, Calle, Num_Exterior, Num_Interior, Colonia, CP,
 *   Ubicacion, Telefono, Correo_e, Sitio_internet, Tipo,
 *   Longitud, Latitud, tipo_corredor_industrial, nom_corredor_industrial, numero_local
 */
export async function fetchDenueDatasetSample(
  params: FetchDenueParams,
): Promise<FetchDenueResult> {
  const token = params.token?.trim() || process.env.INEGI_DENUE_TOKEN;
  if (!token || token.trim() === '') {
    return {
      ok: false,
      error: 'Missing DENUE token — set INEGI_DENUE_TOKEN or pass token explicitly',
    };
  }

  const limit = Math.min(
    params.limit ?? DENUE_DEFAULT_LIMIT,
    DENUE_HARD_MAX_LIMIT,
  );
  const entidad = params.entidad ?? '09';
  const condicion = params.condicion ?? 'todos';
  const registroInicio = params.registroInicio ?? 1;

  // Formato verificado en API DENUE v1:
  // /BuscarEntidad/{condicion}/{entidad}/{reg_ini}/{num_reg}/{token}
  // condicion puede ser 'todos' o un término de búsqueda (e.g. 'tecnologia').
  // No loguear la URL completa (contiene token en path).
  const url = `${DENUE_API_BASE}/BuscarEntidad/${encodeURIComponent(condicion)}/${encodeURIComponent(entidad)}/${registroInicio}/${limit}/${encodeURIComponent(token)}`;

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

    const responseText = await response.text();

    if (!response.ok) {
      // HTML en error HTTP indica token inválido o ruta incorrecta en INEGI
      if (responseText.trim().startsWith('<')) {
        return {
          ok: false,
          error: `HTTP ${response.status} DENUE — respuesta HTML (token inválido o expirado)`,
        };
      }
      return {
        ok: false,
        error: `HTTP ${response.status} desde API DENUE INEGI`,
      };
    }

    // INEGI puede devolver 200 con HTML "Página no encontrada" si el token es inválido
    if (responseText.trim().startsWith('<')) {
      return {
        ok: false,
        error: 'DENUE retornó HTML — token inválido, expirado, o ruta incorrecta',
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
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

/**
 * Prueba la conexión a la API DENUE con el token proporcionado.
 *
 * Usa limit=1 para minimizar costo. Solo lectura — no escribe nada.
 * No imprime el token. Devuelve resultado sanitizado.
 *
 * Usar para validar que un token recién guardado en Vault es funcional.
 */
export async function testDenueConnection(
  token: string,
): Promise<DenueConnectionTestResult> {
  if (!token || token.trim() === '') {
    return { ok: false, error: 'Token vacío — no se puede probar conexión DENUE' };
  }

  const url = `${DENUE_API_BASE}/BuscarEntidad/todos/09/1/${DENUE_TEST_LIMIT}/${encodeURIComponent(token.trim())}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DENUE_TIMEOUT_MS);
  const startMs = Date.now();

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

    const responseTimeMs = Date.now() - startMs;
    const responseText = await response.text();

    if (!response.ok) {
      if (responseText.trim().startsWith('<')) {
        return {
          ok: false,
          httpStatus: response.status,
          responseTimeMs,
          error: `HTTP ${response.status} — respuesta HTML (token inválido o expirado)`,
        };
      }
      return {
        ok: false,
        httpStatus: response.status,
        responseTimeMs,
        error: `HTTP ${response.status} desde API DENUE INEGI`,
      };
    }

    if (responseText.trim().startsWith('<')) {
      return {
        ok: false,
        httpStatus: response.status,
        responseTimeMs,
        error: 'DENUE retornó HTML — token inválido, expirado, o ruta incorrecta',
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      return {
        ok: false,
        httpStatus: response.status,
        responseTimeMs,
        error: 'Respuesta DENUE no es JSON válido',
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        httpStatus: response.status,
        responseTimeMs,
        error: 'Respuesta DENUE inesperada: no es un array JSON',
      };
    }

    return { ok: true, httpStatus: response.status, responseTimeMs };
  } catch (error: unknown) {
    return {
      ok: false,
      responseTimeMs: Date.now() - startMs,
      error: sanitizeDenueError(error),
    };
  }
}
