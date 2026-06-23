/**
 * SUNAT Peru Bulk Connector — HTTP Client
 *
 * Cliente HTTP para verificar disponibilidad del Padrón Reducido RUC.
 * Solo HEAD request o rango mínimo para sample.
 * No descarga ZIP completo. No guarda archivos en disco.
 * No usa credenciales.
 */

import type { SunatBulkHttpMetadata } from './types';
import {
  SUNAT_BULK_URL,
  SUNAT_BULK_HEAD_TIMEOUT_MS,
  SUNAT_BULK_PROBE_TIMEOUT_MS,
} from './types';

const HEADERS = {
  'User-Agent': 'SellUp/0.1 data-source-audit',
};

export type SunatBulkHeadResult = {
  metadata: SunatBulkHttpMetadata;
};

export type SunatBulkProbeResult = {
  metadata: SunatBulkHttpMetadata;
  rawBytes: Uint8Array | null;
  isZipFile: boolean;
  error?: string;
};

async function measureFetchMetadata(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response | null; responseTimeMs: number; error?: string }> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const responseTimeMs = Date.now() - startTime;
    return { response, responseTimeMs };
  } catch (error: unknown) {
    const responseTimeMs = Date.now() - startTime;
    return { response: null, responseTimeMs, error: sanitizeFetchError(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function extractHttpMetadata(
  url: string,
  response: Response | null,
  responseTimeMs: number,
  error?: string,
): SunatBulkHttpMetadata {
  if (!response) {
    return { url, httpStatus: null, ok: false, responseTimeMs };
  }

  const contentType = response.headers.get('content-type') ?? undefined;
  const contentLengthRaw = response.headers.get('content-length');
  const contentLengthBytes = contentLengthRaw ? parseInt(contentLengthRaw, 10) : undefined;
  const lastModified = response.headers.get('last-modified') ?? undefined;
  const acceptRanges = response.headers.get('accept-ranges') ?? undefined;
  const supportsRangeRequests = acceptRanges === 'bytes';

  return {
    url,
    httpStatus: response.status,
    ok: response.ok,
    contentType: contentType ? contentType.split(';')[0].trim() : undefined,
    contentLengthBytes:
      contentLengthBytes !== undefined && !isNaN(contentLengthBytes)
        ? contentLengthBytes
        : undefined,
    lastModified,
    acceptRanges,
    supportsRangeRequests,
    responseTimeMs,
  };
}

function sanitizeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout')) {
      return 'Timeout al conectar con SUNAT';
    }
    if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
      return 'Error DNS al resolver sunat.gob.pe';
    }
    if (msg.includes('ssl') || msg.includes('certificate')) {
      return 'Error SSL al conectar con SUNAT';
    }
    return `Error de red: ${error.message.slice(0, 120)}`;
  }
  return 'Error desconocido al consultar SUNAT';
}

/**
 * Verifica disponibilidad del archivo Padrón Reducido RUC mediante HEAD request.
 * No descarga el ZIP completo. Solo lee metadata HTTP.
 */
export async function checkSunatBulkAvailability(): Promise<SunatBulkHeadResult> {
  const { response, responseTimeMs, error } = await measureFetchMetadata(
    SUNAT_BULK_URL,
    { method: 'HEAD', headers: HEADERS },
    SUNAT_BULK_HEAD_TIMEOUT_MS,
  );

  const metadata = extractHttpMetadata(SUNAT_BULK_URL, response, responseTimeMs, error);

  return { metadata };
}

/**
 * Intenta descargar un rango pequeño del ZIP para verificar formato.
 * Máximo 512 KB. No guarda archivos en disco.
 */
export async function probeSunatBulkRange(
  maxBytes: number = 512 * 1024,
): Promise<SunatBulkProbeResult> {
  const clampedBytes = Math.min(maxBytes, 512 * 1024);
  const rangeHeader = `bytes=0-${clampedBytes - 1}`;

  const { response, responseTimeMs, error } = await measureFetchMetadata(
    SUNAT_BULK_URL,
    {
      method: 'GET',
      headers: { ...HEADERS, Range: rangeHeader },
    },
    SUNAT_BULK_PROBE_TIMEOUT_MS,
  );

  const metadata = extractHttpMetadata(SUNAT_BULK_URL, response, responseTimeMs, error);

  if (error) {
    return { metadata, rawBytes: null, isZipFile: false, error };
  }

  if (!response) {
    return { metadata, rawBytes: null, isZipFile: false, error: 'No response from server' };
  }

  if (response.status !== 206) {
    await response.body?.cancel();
    return {
      metadata,
      rawBytes: null,
      isZipFile: false,
      error: `Server returned ${response.status} instead of 206 Partial Content`,
    };
  }

  const buffer = await response.arrayBuffer();
  const rawBytes = new Uint8Array(buffer);
  const isZipFile =
    rawBytes.length >= 4 &&
    rawBytes[0] === 0x50 &&
    rawBytes[1] === 0x4b &&
    rawBytes[2] === 0x03 &&
    rawBytes[3] === 0x04;

  return { metadata, rawBytes, isZipFile };
}
