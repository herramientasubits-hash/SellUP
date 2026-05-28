import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import type {
  SourceConnectionTestResult,
  SourceConnectionTestErrorCode,
} from '../types';
import {
  SOURCE_CONNECTION_TIMEOUT_MS,
  SOURCE_CONNECTION_MAX_BODY_BYTES,
} from '../types';
import {
  sanitizeErrorMessage,
  mapHttpStatusToErrorCode,
  nowIso,
  measureResponseTime,
} from '../helpers';

const BOT_PROTECTION_SIGNALS = ['captcha', 'cloudflare', 'access denied', 'bot protection'];

function detectBotProtection(status: number, body: string): boolean {
  if (status === 403) {
    const lower = body.toLowerCase();
    return BOT_PROTECTION_SIGNALS.some((s) => lower.includes(s));
  }
  return false;
}

export async function runHttpGetConnectionTest(
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
        method: 'GET',
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

    // Avoid reading large bodies
    const shouldReadBody =
      contentLength === null || contentLength <= SOURCE_CONNECTION_MAX_BODY_BYTES;

    let body = '';
    if (shouldReadBody) {
      try {
        const text = await response.text();
        body = text.slice(0, SOURCE_CONNECTION_MAX_BODY_BYTES);
      } catch {
        // Ignore body read errors
      }
    } else {
      // Consume without storing to release the connection
      try {
        response.body?.cancel();
      } catch {
        // Ignore
      }
    }

    const httpStatus = response.status;
    const isBotProtected = detectBotProtection(httpStatus, body);

    if (isBotProtected) {
      return {
        sourceKey: source.key,
        strategy: 'http_get',
        status: 'blocked',
        httpStatus,
        responseTimeMs,
        checkedAt,
        testedUrl: url,
        contentType,
        contentLength,
        errorCode: 'CAPTCHA_OR_BOT_PROTECTION',
        errorMessage: 'La fuente está protegida por CAPTCHA o sistema anti-bot.',
        recommendation:
          'Esta fuente requiere interacción humana o credenciales para acceder. Considera estrategia manual o acuerdo de acceso.',
        metadata: { botProtectionDetected: true },
      };
    }

    const errorCode: SourceConnectionTestErrorCode =
      response.ok ? 'OK' : mapHttpStatusToErrorCode(httpStatus);

    const status = response.ok ? 'success' : 'failed';

    return {
      sourceKey: source.key,
      strategy: 'http_get',
      status,
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
        : `La fuente respondió con HTTP ${httpStatus}. Verifica el endpoint antes de integrar.`,
      metadata: { bodyRead: shouldReadBody },
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
      strategy: 'http_get',
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
        'No se pudo conectar a la fuente. Verifica la URL, la red y los requisitos de acceso.',
      metadata: {},
    };
  }
}
