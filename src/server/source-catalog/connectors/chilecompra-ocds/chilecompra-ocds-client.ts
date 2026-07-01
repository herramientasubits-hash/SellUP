/**
 * ChileCompra / Mercado Público OCDS Connector — Read-only HTTP Client
 *
 * Endpoints OCDS abiertos (sin auth, sin API key):
 *   Listado: /APISOCDS/OCDS/listaOCDSAgnoMes/{year}/{month}/{offset}/{limit}
 *   Detalle: /APISOCDS/OCDS/tender/{tender_id}
 *
 * NOTA: el listado devuelve OCID completos (`ocds-70d2nz-4280-18-LP26`), pero el
 * endpoint de detalle espera el tender id de la licitación (`4280-18-LP26`).
 * Ver `extractTenderIdFromOcid`.
 *
 * Solo requests GET. Sin writes. Timeout 10s. Un solo intento.
 * Separado del connector legacy `chilecompra-chile` (ticket/Clave Única).
 */

import type { ChileCompraOcdsListItem, OcdsRelease } from './types';

export const OCDS_BASE = 'https://api.mercadopublico.cl/APISOCDS/OCDS';
const OCDS_TIMEOUT_MS = 10_000;
/** Límite máximo server-side documentado. */
export const OCDS_SERVER_MAX_LIMIT = 1000;

const OCDS_HEADERS = {
  'User-Agent': 'SellUp/0.1 data-source-audit',
  Accept: 'application/json',
};

// ─── URL builders ────────────────────────────────────────────────────────────────

export function buildListadoUrl(
  year: number,
  month: number,
  offset: number,
  limit: number,
): string {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), OCDS_SERVER_MAX_LIMIT));
  const safeOffset = Math.max(0, Math.trunc(offset));
  return `${OCDS_BASE}/listaOCDSAgnoMes/${year}/${month}/${safeOffset}/${safeLimit}`;
}

/**
 * Construye la URL de detalle a partir de un tender id ya extraído.
 * Builder de bajo nivel: NO normaliza ni remueve prefijos OCDS. Los callers
 * deben pasar el tender id (ver `extractTenderIdFromOcid`).
 */
export function buildTenderUrl(tenderId: string): string {
  return `${OCDS_BASE}/tender/${encodeURIComponent(tenderId)}`;
}

/**
 * Extrae el tender id de la licitación desde un OCID OCDS, conservando string.
 *
 * El OCID de Mercado Público tiene la forma `ocds-{publisherPrefix}-{tenderId}`,
 * p. ej. `ocds-70d2nz-4280-18-LP26` → `4280-18-LP26`.
 *
 * Regla:
 *  - Si empieza con prefijo OCDS (`ocds-<prefix>-`), se remueve y se conserva
 *    el identificador de licitación final (que puede contener más guiones).
 *  - Si ya es un tender id (no empieza con `ocds-`), se devuelve tal cual.
 *  - Nunca convierte a número; siempre string.
 */
export function extractTenderIdFromOcid(idOrOcid: string): string {
  const trimmed = idOrOcid.trim();
  const match = trimmed.match(/^ocds-[^-]+-(.+)$/i);
  return match ? match[1] : trimmed;
}

// ─── Result types ──────────────────────────────────────────────────────────────

export type ListadoErrorKind =
  | 'timeout'
  | 'http'
  | 'invalid_json'
  | 'unexpected_shape'
  | 'network';

export type FetchListadoResult =
  | {
      ok: true;
      /** null = `pagination.total` ausente o no numérico. */
      total: number | null;
      /** null = no se encontró ningún array de listado en la respuesta. */
      items: ChileCompraOcdsListItem[] | null;
    }
  | { ok: false; errorKind: ListadoErrorKind; error: string };

export type FetchTenderResult =
  | { ok: true; release: OcdsRelease }
  | { ok: false; error: string };

// ─── Listado ────────────────────────────────────────────────────────────────────

export async function fetchOcdsListado(params: {
  year: number;
  month: number;
  offset?: number;
  limit?: number;
}): Promise<FetchListadoResult> {
  const url = buildListadoUrl(
    params.year,
    params.month,
    params.offset ?? 0,
    params.limit ?? 5,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCDS_TIMEOUT_MS);

  let responseText: string;
  let status: number;
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: OCDS_HEADERS,
      });
    } finally {
      clearTimeout(timeout);
    }
    status = response.status;
    responseText = await response.text();
    if (!response.ok) {
      return { ok: false, errorKind: 'http', error: `HTTP ${status} desde Mercado Público OCDS` };
    }
  } catch (error: unknown) {
    return mapTransportError(error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return { ok: false, errorKind: 'invalid_json', error: 'La respuesta no es JSON válido.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, errorKind: 'unexpected_shape', error: 'La respuesta tiene un formato inesperado.' };
  }

  return {
    ok: true,
    total: extractTotal(parsed as Record<string, unknown>),
    items: extractListItems(parsed as Record<string, unknown>),
  };
}

/** Lee `pagination.total` (o `total` top-level) de forma defensiva. */
export function extractTotal(body: Record<string, unknown>): number | null {
  const pagination = body.pagination;
  if (pagination && typeof pagination === 'object') {
    const t = (pagination as Record<string, unknown>).total;
    if (typeof t === 'number' && Number.isFinite(t)) return t;
  }
  if (typeof body.total === 'number' && Number.isFinite(body.total)) return body.total;
  return null;
}

/**
 * Extrae el array de listado (ocid + urlTender) de forma defensiva.
 * Devuelve [] si el array existe pero viene vacío, null si no hay array reconocible.
 */
export function extractListItems(
  body: Record<string, unknown>,
): ChileCompraOcdsListItem[] | null {
  const candidateKeys = ['data', 'listado', 'items', 'Listado'];
  let rawArray: unknown = null;
  for (const key of candidateKeys) {
    if (Array.isArray(body[key])) {
      rawArray = body[key];
      break;
    }
  }
  if (rawArray === null) return null;

  return (rawArray as unknown[])
    .map((entry): ChileCompraOcdsListItem | null => {
      if (!entry || typeof entry !== 'object') return null;
      const obj = entry as Record<string, unknown>;
      const ocid = obj.ocid;
      if (typeof ocid !== 'string' || ocid.length === 0) return null;
      const urlTender =
        typeof obj.urlTender === 'string' && obj.urlTender.length > 0
          ? obj.urlTender
          : null;
      const urlAward =
        typeof obj.urlAward === 'string' && obj.urlAward.length > 0
          ? obj.urlAward
          : null;
      return { ocid, urlTender, urlAward };
    })
    .filter((x): x is ChileCompraOcdsListItem => x !== null);
}

// ─── Detalle ───────────────────────────────────────────────────────────────────

/**
 * Consulta el detalle de una licitación. Acepta un OCID completo o un tender id;
 * internamente extrae el tender id y construye la URL de detalle con él, no con
 * el OCID completo. El OCID original se conserva solo para trazabilidad de errores.
 */
export async function fetchOcdsTender(idOrOcid: string): Promise<FetchTenderResult> {
  const tenderId = extractTenderIdFromOcid(idOrOcid);
  const url = buildTenderUrl(tenderId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCDS_TIMEOUT_MS);

  let responseText: string;
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: OCDS_HEADERS,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} en detalle ${idOrOcid}` };
    }
    responseText = await response.text();
  } catch (error: unknown) {
    const t = mapTransportError(error);
    return { ok: false, error: t.error };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return { ok: false, error: 'Detalle no es JSON válido' };
  }

  const release = extractRelease(parsed);
  if (!release) {
    return { ok: false, error: 'Detalle sin release OCDS reconocible' };
  }
  return { ok: true, release };
}

/**
 * Extrae un release OCDS del detalle, tolerando varias envolturas:
 * `releases[0]`, `records[0].compiledRelease`, o el objeto plano si ya trae tender/ocid.
 */
export function extractRelease(body: unknown): OcdsRelease | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;

  if (Array.isArray(obj.releases) && obj.releases.length > 0) {
    const r = obj.releases[0];
    if (r && typeof r === 'object') return r as OcdsRelease;
  }

  if (Array.isArray(obj.records) && obj.records.length > 0) {
    const rec = obj.records[0];
    if (rec && typeof rec === 'object') {
      const compiled = (rec as Record<string, unknown>).compiledRelease;
      if (compiled && typeof compiled === 'object') return compiled as OcdsRelease;
    }
  }

  if ('ocid' in obj || 'tender' in obj || 'parties' in obj) {
    return obj as OcdsRelease;
  }

  return null;
}

export type FetchAwardResult =
  | { ok: true; release: OcdsRelease }
  | { ok: false; error: string };

/**
 * Consulta el endpoint de adjudicación usando la URL completa proveniente del listado.
 * El listado de Mercado Público devuelve urlAward con http://, pero el servidor solo
 * responde por HTTPS — forzamos https:// antes de fetchar.
 * Reutiliza `extractRelease` para tolerar distintas envolturas OCDS.
 */
export async function fetchOcdsAward(urlAward: string): Promise<FetchAwardResult> {
  const safeUrl = urlAward.replace(/^http:\/\//i, 'https://');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCDS_TIMEOUT_MS);

  let responseText: string;
  try {
    let response: Response;
    try {
      response = await fetch(safeUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: OCDS_HEADERS,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} en award ${safeUrl}` };
    }
    responseText = await response.text();
  } catch (error: unknown) {
    const t = mapTransportError(error);
    return { ok: false, error: t.error };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return { ok: false, error: 'Award no es JSON válido' };
  }

  const release = extractRelease(parsed);
  if (!release) {
    return { ok: false, error: 'Award sin release OCDS reconocible' };
  }
  return { ok: true, release };
}

// ─── Error sanitization ──────────────────────────────────────────────────────────

function mapTransportError(error: unknown): {
  ok: false;
  errorKind: ListadoErrorKind;
  error: string;
} {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout')) {
      return { ok: false, errorKind: 'timeout', error: 'El servicio OCDS no respondió a tiempo.' };
    }
    if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
      return { ok: false, errorKind: 'network', error: 'Error DNS al resolver Mercado Público OCDS.' };
    }
    if (msg.includes('ssl') || msg.includes('certificate')) {
      return { ok: false, errorKind: 'network', error: 'Error SSL al conectar con Mercado Público OCDS.' };
    }
    return { ok: false, errorKind: 'network', error: `Error de red: ${error.message.slice(0, 120)}` };
  }
  return { ok: false, errorKind: 'network', error: 'Error desconocido al consultar Mercado Público OCDS.' };
}
