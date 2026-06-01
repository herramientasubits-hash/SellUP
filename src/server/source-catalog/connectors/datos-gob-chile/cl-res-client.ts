/**
 * Chile RES Connector — CKAN Client
 *
 * Consulta el CKAN de datos.gob.cl sin credenciales.
 * Endpoint: /api/3/action/datastore_search
 * Solo lectura. Timeout 15s. Hard limit 50 registros.
 * Sin writes. Sin logging de datos sensibles.
 */

import type { ResChileRawRecord } from './types';

const CKAN_BASE = 'https://datos.gob.cl/api/3/action/datastore_search';
const CKAN_TIMEOUT_MS = 15_000;
const CKAN_HARD_MAX_LIMIT = 50;
const CKAN_DEFAULT_LIMIT = 20;

/** Resource ID principal RES 2025 */
export const RES_RESOURCE_ID_2025 = '71c8e355-226a-461e-809a-870c2275a178';
/** Dataset ID Registro de Empresas y Sociedades */
export const RES_DATASET_ID = '363edd60-4919-4ff1-b85f-f8e14d61285a';

const CKAN_HEADERS = {
  'User-Agent': 'SellUp/0.1 data-source-audit',
  Accept: 'application/json',
};

export type FetchClResParams = {
  resourceId?: string;
  limit?: number;
  offset?: number;
  filters?: Record<string, string>;
  q?: string;
};

export type FetchClResResult =
  | { ok: true; records: ResChileRawRecord[]; total: number }
  | { ok: false; error: string };

/** Estructura de respuesta CKAN datastore_search. */
type CkanDatastoreResponse = {
  success: boolean;
  result?: {
    total?: number;
    records?: unknown[];
  };
  error?: {
    message?: string;
    __type?: string;
  };
};

/**
 * Consulta el CKAN datos.gob.cl para el recurso RES Chile.
 * No requiere token. Sin paginación masiva — solo muestra segura.
 */
export async function fetchClResRecords(
  params: FetchClResParams = {},
): Promise<FetchClResResult> {
  const resourceId = params.resourceId ?? RES_RESOURCE_ID_2025;
  const limit = Math.min(params.limit ?? CKAN_DEFAULT_LIMIT, CKAN_HARD_MAX_LIMIT);
  const offset = params.offset ?? 0;
  const filters = params.filters ?? { 'Tipo de actuacion': 'CONSTITUCIÓN' };

  const searchParams = new URLSearchParams({
    resource_id: resourceId,
    limit: String(limit),
    offset: String(offset),
    filters: JSON.stringify(filters),
  });

  if (params.q) {
    searchParams.set('q', params.q);
  }

  const url = `${CKAN_BASE}?${searchParams.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CKAN_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: CKAN_HEADERS,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text();

    if (!response.ok) {
      if (responseText.trim().startsWith('<')) {
        return {
          ok: false,
          error: `HTTP ${response.status} CKAN datos.gob.cl — respuesta HTML inesperada`,
        };
      }
      return {
        ok: false,
        error: `HTTP ${response.status} desde CKAN datos.gob.cl`,
      };
    }

    if (responseText.trim().startsWith('<')) {
      return {
        ok: false,
        error: 'CKAN retornó HTML — endpoint incorrecto o servicio no disponible',
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      return { ok: false, error: 'Respuesta CKAN no es JSON válido' };
    }

    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'Respuesta CKAN malformada: no es un objeto' };
    }

    const ckanResp = parsed as CkanDatastoreResponse;

    if (!ckanResp.success) {
      const errMsg = ckanResp.error?.message ?? ckanResp.error?.__type ?? 'Error desconocido CKAN';
      return { ok: false, error: `CKAN success=false: ${errMsg}` };
    }

    if (!ckanResp.result || !Array.isArray(ckanResp.result.records)) {
      return { ok: false, error: 'CKAN result.records ausente o no es array' };
    }

    return {
      ok: true,
      records: ckanResp.result.records as ResChileRawRecord[],
      total: ckanResp.result.total ?? 0,
    };
  } catch (error: unknown) {
    return { ok: false, error: sanitizeCkanError(error) };
  }
}

function sanitizeCkanError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout')) return 'Timeout al conectar con CKAN datos.gob.cl';
    if (msg.includes('enotfound') || msg.includes('getaddrinfo')) return 'Error DNS al resolver datos.gob.cl';
    if (msg.includes('ssl') || msg.includes('certificate')) return 'Error SSL al conectar con datos.gob.cl';
    return `Error de red CKAN: ${error.message.slice(0, 120)}`;
  }
  return 'Error desconocido al consultar CKAN datos.gob.cl';
}
