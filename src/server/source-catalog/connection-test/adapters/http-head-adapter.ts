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

export async function runHttpHeadConnectionTest(
  source: CatalogSource,
): Promise<SourceConnectionTestResult> {
  const url = source.url ?? '';
  const timer = measureResponseTime();
  const checkedAt = nowIso();

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
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;

    const httpStatus = response.status;

    // HEAD returning 405 Method Not Allowed — recommend http_get fallback
    if (httpStatus === 405) {
      return {
        sourceKey: source.key,
        strategy: 'http_head',
        status: 'failed',
        httpStatus,
        responseTimeMs,
        checkedAt,
        testedUrl: url,
        contentType,
        contentLength,
        errorCode: 'INVALID_RESPONSE_SHAPE',
        errorMessage: 'El servidor no soporta método HEAD (405 Method Not Allowed).',
        recommendation:
          'La fuente no soporta HEAD. Considera usar estrategia http_get para la siguiente prueba.',
        metadata: { headNotSupported: true, suggestedFallback: 'http_get' },
      };
    }

    const errorCode: SourceConnectionTestErrorCode =
      response.ok ? 'OK' : mapHttpStatusToErrorCode(httpStatus);

    return {
      sourceKey: source.key,
      strategy: 'http_head',
      status: response.ok ? 'success' : 'failed',
      httpStatus,
      responseTimeMs,
      checkedAt,
      testedUrl: url,
      contentType,
      contentLength,
      errorCode,
      errorMessage: response.ok ? null : `HTTP ${httpStatus}`,
      recommendation: response.ok
        ? null
        : `La fuente respondió con HTTP ${httpStatus} a la solicitud HEAD.`,
      metadata: {},
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
      strategy: 'http_head',
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
        'No se pudo conectar a la fuente con HEAD. Verifica la URL y los requisitos de red.',
      metadata: {},
    };
  }
}
