import type {
  InapiCkanResponse,
  InapiPackageShowResponse,
  InapiPackageShowResource,
  InapiTrademarkRawRecord,
  InapiPatentRawRecord,
} from './types';

export const CKAN_BASE = 'https://datos.gob.cl/api/3/action';
const CKAN_TIMEOUT_MS = 15_000;

export const CKAN_HEADERS = {
  'User-Agent': 'SellUp/0.1 inapi-signal-audit',
  Accept: 'application/json',
};

export type FetchCkanRecordsResult =
  | { ok: true; records: unknown[]; total: number }
  | { ok: false; error: string };

export type FetchResourceIdsResult =
  | { ok: true; resources: InapiPackageShowResource[] }
  | { ok: false; error: string };

async function ckanFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CKAN_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: CKAN_HEADERS,
    });
  } finally {
    clearTimeout(timeout);
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

async function parseCkanResponse(responseText: string): Promise<InapiCkanResponse> {
  if (responseText.trim().startsWith('<')) {
    throw new Error('CKAN retornó HTML — endpoint incorrecto o servicio no disponible');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error('Respuesta CKAN no es JSON válido');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Respuesta CKAN malformada: no es un objeto');
  }

  return parsed as InapiCkanResponse;
}

export async function fetchInapiResourceIds(
  datasetId: string,
): Promise<FetchResourceIdsResult> {
  const url = `${CKAN_BASE}/package_show?id=${encodeURIComponent(datasetId)}`;

  try {
    const response = await ckanFetch(url);
    const responseText = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} desde CKAN package_show`,
      };
    }

    const parsed = JSON.parse(responseText) as InapiPackageShowResponse;

    if (!parsed.success) {
      const errMsg = parsed.error?.message ?? 'Error desconocido CKAN package_show';
      return { ok: false, error: `CKAN success=false: ${errMsg}` };
    }

    if (!parsed.result?.resources || parsed.result.resources.length === 0) {
      return { ok: false, error: 'CKAN package_show no devolvió resources' };
    }

    return { ok: true, resources: parsed.result.resources };
  } catch (error: unknown) {
    return { ok: false, error: sanitizeCkanError(error) };
  }
}

export async function fetchInapiRecords(
  resourceId: string,
  limit: number,
  offset: number = 0,
): Promise<FetchCkanRecordsResult> {
  const params = new URLSearchParams({
    resource_id: resourceId,
    limit: String(Math.min(limit, 50)),
    offset: String(offset),
  });

  const url = `${CKAN_BASE}/datastore_search?${params.toString()}`;

  try {
    const response = await ckanFetch(url);
    const responseText = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} desde CKAN datastore_search`,
      };
    }

    const ckanResp = await parseCkanResponse(responseText);

    if (!ckanResp.success) {
      const errMsg = ckanResp.error?.message ?? 'Error desconocido CKAN';
      return { ok: false, error: `CKAN success=false: ${errMsg}` };
    }

    if (!ckanResp.result || !Array.isArray(ckanResp.result.records)) {
      return { ok: false, error: 'CKAN result.records ausente o no es array' };
    }

    return {
      ok: true,
      records: ckanResp.result.records,
      total: ckanResp.result.total ?? 0,
    };
  } catch (error: unknown) {
    return { ok: false, error: sanitizeCkanError(error) };
  }
}

export async function queryInapiByName(
  resourceId: string,
  query: string,
  limit: number,
): Promise<FetchCkanRecordsResult> {
  const params = new URLSearchParams({
    resource_id: resourceId,
    q: query,
    limit: String(Math.min(limit, 50)),
  });

  const url = `${CKAN_BASE}/datastore_search?${params.toString()}`;

  try {
    const response = await ckanFetch(url);
    const responseText = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} desde CKAN datastore_search (q)`,
      };
    }

    const ckanResp = await parseCkanResponse(responseText);

    if (!ckanResp.success) {
      const errMsg = ckanResp.error?.message ?? 'Error desconocido CKAN';
      return { ok: false, error: `CKAN success=false: ${errMsg}` };
    }

    if (!ckanResp.result || !Array.isArray(ckanResp.result.records)) {
      return { ok: false, error: 'CKAN result.records ausente o no es array' };
    }

    return {
      ok: true,
      records: ckanResp.result.records,
      total: ckanResp.result.total ?? 0,
    };
  } catch (error: unknown) {
    return { ok: false, error: sanitizeCkanError(error) };
  }
}

export function isTrademarkRecord(record: unknown): record is InapiTrademarkRawRecord {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  return 'BrandName' in r || 'ApplicationNumber' in r && 'NizaClasses' in r;
}

export function isPatentRecord(record: unknown): record is InapiPatentRawRecord {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  return 'Title' in r && 'IPC' in r;
}
