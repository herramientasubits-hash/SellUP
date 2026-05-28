import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import type {
  SourceConnectionTestResult,
  SourceConnectionTestErrorCode,
} from '../types';
import { SOURCE_CONNECTION_TIMEOUT_MS } from '../types';
import {
  sanitizeErrorMessage,
  mapHttpStatusToErrorCode,
  nowIso,
  measureResponseTime,
} from '../helpers';

const BYTES_PER_MB = 1_048_576;

export async function runPartialDownloadHeadConnectionTest(
  source: CatalogSource,
): Promise<SourceConnectionTestResult> {
  const url = source.url ?? '';
  const timer = measureResponseTime();
  const checkedAt = nowIso();

  const isInsecureProtocol = url.startsWith('http://');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_CONNECTION_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'SellUp-ConnectionTest/1.0' },
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseTimeMs = timer.end();
    const contentType = response.headers.get('content-type');
    const contentLengthHeader = response.headers.get('content-length');
    const contentLengthBytes = contentLengthHeader
      ? parseInt(contentLengthHeader, 10)
      : null;
    const contentLengthMb =
      contentLengthBytes !== null
        ? Math.round((contentLengthBytes / BYTES_PER_MB) * 100) / 100
        : null;

    const httpStatus = response.status;

    const metadata: Record<string, unknown> = {
      largeDownloadProtected: true,
      bulkDownloadSkipped: true,
      contentLengthBytes,
      contentLengthMb,
      insecureProtocol: isInsecureProtocol,
    };

    const errorCode: SourceConnectionTestErrorCode =
      response.ok ? 'OK' : mapHttpStatusToErrorCode(httpStatus);

    return {
      sourceKey: source.key,
      strategy: 'partial_download_head',
      status: response.ok ? 'success' : 'failed',
      httpStatus,
      responseTimeMs,
      checkedAt,
      testedUrl: url,
      contentType,
      contentLength: contentLengthBytes,
      errorCode,
      errorMessage: response.ok ? null : `HTTP ${httpStatus}`,
      recommendation: response.ok
        ? 'Endpoint accesible. Descarga real debe hacerse en pipeline batch offline.'
        : `La fuente respondió con HTTP ${httpStatus}. Verifica el mirror o endpoint de descarga.`,
      metadata,
    };
  } catch (error: unknown) {
    const responseTimeMs = timer.end();
    const message = sanitizeErrorMessage(error);

    let errorCode: SourceConnectionTestErrorCode = 'UNKNOWN_ERROR';
    if (message.includes('abort') || message.includes('timeout')) {
      errorCode = 'TIMEOUT';
    } else if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
      errorCode = 'DNS_ERROR';
    } else if (message.includes('SSL') || message.includes('certificate') || message.includes('CERT')) {
      errorCode = 'SSL_ERROR';
    }

    return {
      sourceKey: source.key,
      strategy: 'partial_download_head',
      status: 'failed',
      httpStatus: null,
      responseTimeMs,
      checkedAt,
      testedUrl: url,
      contentType: null,
      contentLength: null,
      errorCode,
      errorMessage: message,
      recommendation:
        'No se pudo verificar el endpoint de descarga. Verifica la URL del archivo y la disponibilidad del servidor.',
      metadata: {
        largeDownloadProtected: true,
        bulkDownloadSkipped: true,
        insecureProtocol: isInsecureProtocol,
      },
    };
  }
}
