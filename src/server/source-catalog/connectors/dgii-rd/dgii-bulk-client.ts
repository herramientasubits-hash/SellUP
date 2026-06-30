/**
 * DGII República Dominicana Bulk Connector — HTTP Client
 *
 * Cliente HTTP read-only para el padrón RNC de la DGII.
 * Siempre envía Referer header para evitar 403.
 * No usa WebForms POST. No usa Dominican Technology API. No usa SOAP.
 * No escribe en Supabase. No guarda archivos en disco.
 */

import type { DgiiHttpMetadata } from './types';
import {
  RD_DGII_RNC_PAGE_URL,
  RD_DGII_RNC_TXT_ZIP_URL,
  RD_DGII_BULK_HEAD_TIMEOUT_MS,
  RD_DGII_BULK_FETCH_TIMEOUT_MS,
  RD_DGII_BULK_MAX_SAMPLE_BYTES,
} from './types';

export const DGII_REQUEST_HEADERS = {
  Referer: RD_DGII_RNC_PAGE_URL,
  'User-Agent': 'SellUp/1.0 legal-enrichment-health-check',
} as const;

export type DgiiHeadResult = {
  metadata: DgiiHttpMetadata;
};

export type DgiiSampleResult = {
  metadata: DgiiHttpMetadata;
  rawBytes: Uint8Array | null;
  isZipFile: boolean;
  usedRangeRequest: boolean;
  error?: string;
};

async function measureFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response | null; responseTimeMs: number; error?: string }> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, responseTimeMs: Date.now() - startTime };
  } catch (error: unknown) {
    return { response: null, responseTimeMs: Date.now() - startTime, error: sanitizeError(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function extractMetadata(
  url: string,
  response: Response | null,
  responseTimeMs: number,
): DgiiHttpMetadata {
  if (!response) {
    return { url, httpStatus: null, ok: false, responseTimeMs };
  }

  const contentLengthRaw = response.headers.get('content-length');
  const contentLengthBytes = contentLengthRaw ? parseInt(contentLengthRaw, 10) : undefined;
  const acceptRanges = response.headers.get('accept-ranges') ?? undefined;

  return {
    url,
    httpStatus: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type')?.split(';')[0].trim() ?? undefined,
    contentLengthBytes:
      contentLengthBytes !== undefined && !isNaN(contentLengthBytes)
        ? contentLengthBytes
        : undefined,
    lastModified: response.headers.get('last-modified') ?? undefined,
    acceptRanges,
    supportsRangeRequests: acceptRanges === 'bytes',
    responseTimeMs,
  };
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout')) return 'Timeout al conectar con DGII';
    if (msg.includes('enotfound') || msg.includes('getaddrinfo'))
      return 'Error DNS al resolver dgii.gov.do';
    if (msg.includes('ssl') || msg.includes('certificate'))
      return 'Error SSL al conectar con DGII';
    return `Error de red: ${error.message.slice(0, 120)}`;
  }
  return 'Error desconocido al consultar DGII';
}

/**
 * HEAD del ZIP TXT de la DGII con Referer header.
 * Verifica disponibilidad sin descargar el archivo.
 */
export async function headDgiiRncZip(): Promise<DgiiHeadResult> {
  const { response, responseTimeMs } = await measureFetch(
    RD_DGII_RNC_TXT_ZIP_URL,
    { method: 'HEAD', headers: DGII_REQUEST_HEADERS },
    RD_DGII_BULK_HEAD_TIMEOUT_MS,
  );

  const metadata = extractMetadata(RD_DGII_RNC_TXT_ZIP_URL, response, responseTimeMs);
  return { metadata };
}

export type FetchRangeOptions = {
  maxBytes?: number;
};

/**
 * GET con Range header si el servidor lo soporta.
 * Descarga hasta maxBytes del ZIP TXT para inspeccionar formato.
 */
export async function fetchDgiiRncZipRange(options: FetchRangeOptions = {}): Promise<DgiiSampleResult> {
  const maxBytes = Math.min(options.maxBytes ?? 512 * 1024, RD_DGII_BULK_MAX_SAMPLE_BYTES);
  const rangeHeader = `bytes=0-${maxBytes - 1}`;

  const { response, responseTimeMs, error } = await measureFetch(
    RD_DGII_RNC_TXT_ZIP_URL,
    { method: 'GET', headers: { ...DGII_REQUEST_HEADERS, Range: rangeHeader } },
    RD_DGII_BULK_FETCH_TIMEOUT_MS,
  );

  const metadata = extractMetadata(RD_DGII_RNC_TXT_ZIP_URL, response, responseTimeMs);

  if (error || !response) {
    return { metadata, rawBytes: null, isZipFile: false, usedRangeRequest: true, error: error ?? 'No response' };
  }

  if (response.status !== 206) {
    await response.body?.cancel();
    return {
      metadata,
      rawBytes: null,
      isZipFile: false,
      usedRangeRequest: true,
      error: `Servidor devolvió ${response.status} en vez de 206 Partial Content`,
    };
  }

  const buffer = await response.arrayBuffer();
  const rawBytes = new Uint8Array(buffer);
  const isZipFile = isZipMagic(rawBytes);

  return { metadata, rawBytes, isZipFile, usedRangeRequest: true };
}

export type FetchSampleOptions = {
  maxBytes?: number;
};

/**
 * Descarga el ZIP completo o una muestra parcial.
 * Cuando maxBytes > RD_DGII_BULK_MAX_SAMPLE_BYTES (o no se especifica un límite),
 * descarga el ZIP completo directamente (sin Range) — necesario para descompresión.
 * No guarda en disco. No escribe en Supabase.
 */
export async function fetchDgiiRncZipSample(options: FetchSampleOptions = {}): Promise<DgiiSampleResult> {
  const requestedMax = options.maxBytes ?? 0;
  const forceFullDownload = requestedMax === 0 || requestedMax > RD_DGII_BULK_MAX_SAMPLE_BYTES;

  if (!forceFullDownload) {
    // Intentar Range para muestra pequeña
    const rangeResult = await fetchDgiiRncZipRange({ maxBytes: requestedMax });
    if (rangeResult.rawBytes && rangeResult.isZipFile) {
      return rangeResult;
    }
  }

  // Range falló o servidor no soporta — descargar ZIP completo
  const { response, responseTimeMs, error } = await measureFetch(
    RD_DGII_RNC_TXT_ZIP_URL,
    { method: 'GET', headers: DGII_REQUEST_HEADERS },
    RD_DGII_BULK_FETCH_TIMEOUT_MS,
  );

  const metadata = extractMetadata(RD_DGII_RNC_TXT_ZIP_URL, response, responseTimeMs);

  if (error || !response) {
    return { metadata, rawBytes: null, isZipFile: false, usedRangeRequest: false, error: error ?? 'No response' };
  }

  if (!response.ok) {
    await response.body?.cancel();
    return {
      metadata,
      rawBytes: null,
      isZipFile: false,
      usedRangeRequest: false,
      error: `HTTP ${response.status} al descargar ZIP DGII`,
    };
  }

  const buffer = await response.arrayBuffer();
  const rawBytes = new Uint8Array(buffer);
  const isZipFile = isZipMagic(rawBytes);

  return { metadata, rawBytes, isZipFile, usedRangeRequest: false };
}

function isZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}
