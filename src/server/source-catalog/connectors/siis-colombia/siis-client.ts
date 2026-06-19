/**
 * SIIS Colombia Connector — Client HTTP
 *
 * Descarga controlada del Excel público de SIIS.
 * Solo server-side. No usar en Client Components.
 *
 * Incluye retry/backoff para tolerar fallos temporales del upstream.
 */

const SIIS_BASE_URL = 'https://siis.ia.supersociedades.gov.co/api/getExcel/';

// ─── Retry policy ──────────────────────────────────────────────────────────────

export const MAX_DOWNLOAD_ATTEMPTS = 3;
export const RETRY_BACKOFF_MS: readonly number[] = [0, 1000, 3000];

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

function isRetryableHttpStatus(statusCode: number): boolean {
  return RETRYABLE_STATUS_CODES.has(statusCode);
}

function isNonRetryableHttpStatus(statusCode: number): boolean {
  return statusCode >= 400 && statusCode < 500 && !isRetryableHttpStatus(statusCode);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── URL builder ───────────────────────────────────────────────────────────────

export function getSiisExcelUrl(year: number, n: 1000 | 10000): string {
  const params = new URLSearchParams({
    anio: year.toString(),
    n: n.toString(),
  });
  return `${SIIS_BASE_URL}?${params.toString()}`;
}

// ─── Result type ───────────────────────────────────────────────────────────────

export type SiisDownloadResult = {
  ok: boolean;
  buffer?: Buffer;
  contentType?: string;
  contentLength?: number;
  error?: string;
  statusCode?: number;
};

// ─── Single attempt (no retry) ─────────────────────────────────────────────────

async function attemptDownload(
  year: number,
  n: 1000 | 10000,
  signal?: AbortSignal,
): Promise<SiisDownloadResult> {
  const url = getSiisExcelUrl(year, n);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, */*',
        'User-Agent': 'SellUp-SIIS-Connector/1.0',
      },
      signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const contentLength = response.headers.get('content-length')
      ? parseInt(response.headers.get('content-length')!, 10)
      : undefined;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      ok: true,
      buffer,
      contentType,
      contentLength,
      statusCode: response.status,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Download aborted' };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown download error',
    };
  }
}

// ─── Public function with retry ────────────────────────────────────────────────

export async function downloadSiisExcel(
  year: number,
  n: 1000 | 10000,
  signal?: AbortSignal,
): Promise<SiisDownloadResult> {
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 0);
    }

    if (signal?.aborted) {
      return { ok: false, error: 'Download aborted' };
    }

    const result = await attemptDownload(year, n, signal);

    if (result.ok) return result;

    // Never retry user-initiated aborts
    if (result.error === 'Download aborted') return result;

    // Never retry non-retryable 4xx errors
    if (result.statusCode !== undefined && isNonRetryableHttpStatus(result.statusCode)) {
      return result;
    }

    if (attempt < MAX_DOWNLOAD_ATTEMPTS) {
      console.warn(
        `[SIIS Client] Attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed: ${result.error}. Retrying...`,
      );
      continue;
    }

    // Last attempt failed — return with enhanced message
    return {
      ok: false,
      error: `SIIS download failed after ${MAX_DOWNLOAD_ATTEMPTS} attempts: ${result.error ?? 'Unknown error'}`,
      statusCode: result.statusCode,
    };
  }

  return { ok: false, error: 'SIIS download failed unexpectedly' };
}

// ─── Constants ─────────────────────────────────────────────────────────────────

export const SIIS_CONFIRMED_YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
export const SIIS_SUPPORTED_N_VALUES = [1000, 10000] as const;
