// Tests — SIIS Client: retry/backoff, error handling, URL builder
//
// Mockea global fetch para simular respuestas HTTP sin red real.
// Usa node:test (sin dependencias externas).

import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { downloadSiisExcel, getSiisExcelUrl } from '../siis-client';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const fakeBuffer = Buffer.from('fake-excel-content');

function makeResponse(
  status: number,
  body?: Buffer | null,
  statusText?: string,
): Response {
  return new Response(body ? new Uint8Array(body) : null, {
    status,
    statusText: statusText ?? '',
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': body ? String(body.byteLength) : '0',
    },
  });
}

// ─── 1. getSiisExcelUrl ────────────────────────────────────────────────────────

describe('getSiisExcelUrl', () => {
  it('builds URL with year and n=1000', () => {
    const url = getSiisExcelUrl(2024, 1000);
    assert.ok(url.includes('anio=2024'));
    assert.ok(url.includes('n=1000'));
    assert.ok(url.startsWith('https://siis.ia.supersociedades.gov.co/api/getExcel/'));
  });

  it('builds URL with year and n=10000', () => {
    const url = getSiisExcelUrl(2024, 10000);
    assert.ok(url.includes('anio=2024'));
    assert.ok(url.includes('n=10000'));
  });

  it('handles different years', () => {
    const url = getSiisExcelUrl(2023, 1000);
    assert.ok(url.includes('anio=2023'));
  });
});

// ─── 2. downloadSiisExcel — retry/backoff ──────────────────────────────────────

describe('downloadSiisExcel', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('succeeds on first attempt', async () => {
    const mockFetch = mock.method(globalThis, 'fetch', async () =>
      makeResponse(200, fakeBuffer),
    );
    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, true);
    assert.ok(result.buffer);
    assert.equal(mockFetch.mock.callCount(), 1);
  });

  it('retries on HTTP 502 and succeeds on second attempt', async () => {
    let callCount = 0;
    const mockFetch = mock.method(globalThis, 'fetch', async () => {
      callCount++;
      if (callCount === 1) return makeResponse(502, null, 'Bad Gateway');
      return makeResponse(200, fakeBuffer);
    });

    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, true);
    assert.ok(result.buffer);
    assert.equal(mockFetch.mock.callCount(), 2);
  });

  it('retries on HTTP 503 and succeeds on second attempt', async () => {
    let callCount = 0;
    const mockFetch = mock.method(globalThis, 'fetch', async () => {
      callCount++;
      if (callCount === 1) return makeResponse(503, null, 'Service Unavailable');
      return makeResponse(200, fakeBuffer);
    });

    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, true);
    assert.equal(mockFetch.mock.callCount(), 2);
  });

  it('retries on HTTP 504 and succeeds on second attempt', async () => {
    let callCount = 0;
    const mockFetch = mock.method(globalThis, 'fetch', async () => {
      callCount++;
      if (callCount === 1) return makeResponse(504, null, 'Gateway Timeout');
      return makeResponse(200, fakeBuffer);
    });

    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, true);
    assert.equal(mockFetch.mock.callCount(), 2);
  });

  it('does not retry on HTTP 404', async () => {
    const mockFetch = mock.method(globalThis, 'fetch', async () =>
      makeResponse(404, null, 'Not Found'),
    );

    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 404);
    assert.ok(result.error?.includes('404'));
    assert.equal(mockFetch.mock.callCount(), 1);
  });

  it('does not retry on HTTP 401', async () => {
    const mockFetch = mock.method(globalThis, 'fetch', async () =>
      makeResponse(401, null, 'Unauthorized'),
    );

    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 401);
    assert.equal(mockFetch.mock.callCount(), 1);
  });

  it('does not retry on HTTP 403', async () => {
    const mockFetch = mock.method(globalThis, 'fetch', async () =>
      makeResponse(403, null, 'Forbidden'),
    );

    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, false);
    assert.equal(mockFetch.mock.callCount(), 1);
  });

  it('does not retry on HTTP 400', async () => {
    const mockFetch = mock.method(globalThis, 'fetch', async () =>
      makeResponse(400, null, 'Bad Request'),
    );

    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, false);
    assert.equal(mockFetch.mock.callCount(), 1);
  });

  it('returns clear error after 3 failed attempts with 502', async () => {
    const mockFetch = mock.method(globalThis, 'fetch', async () =>
      makeResponse(502, null, 'Bad Gateway'),
    );

    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, false);
    assert.equal(mockFetch.mock.callCount(), 3);
    assert.ok(result.error);
    assert.ok(result.error!.includes('SIIS download failed after 3 attempts'));
    assert.ok(result.error!.includes('502'));
  });

  it('retries on network error (ECONNRESET emulation) and succeeds on second', async () => {
    let callCount = 0;
    const mockFetch = mock.method(globalThis, 'fetch', async () => {
      callCount++;
      if (callCount === 1) {
        throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      }
      return makeResponse(200, fakeBuffer);
    });

    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, true);
    assert.equal(mockFetch.mock.callCount(), 2);
  });

  it('returns clear error after 3 failed network errors', async () => {
    const mockFetch = mock.method(globalThis, 'fetch', async () => {
      throw new Error('read ECONNRESET');
    });

    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, false);
    assert.equal(mockFetch.mock.callCount(), 3);
    assert.ok(result.error!.includes('SIIS download failed after 3 attempts'));
    assert.ok(result.error!.includes('ECONNRESET'));
  });

  it('returns original error on abort (does not retry)', async () => {
    const abortController = new AbortController();
    mock.method(globalThis, 'fetch', async () => {
      abortController.abort();
      return makeResponse(502, null, 'Bad Gateway');
    });

    const result = await downloadSiisExcel(2024, 1000, abortController.signal);

    assert.equal(result.ok, false);
    assert.equal(result.error, 'Download aborted');
  });

  it('passes content-type and content-length on success', async () => {
    mock.method(globalThis, 'fetch', async () =>
      makeResponse(200, fakeBuffer),
    );

    const result = await downloadSiisExcel(2024, 1000);

    assert.equal(result.ok, true);
    assert.equal(result.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(result.contentLength, fakeBuffer.byteLength);
    assert.equal(result.statusCode, 200);
  });
});
