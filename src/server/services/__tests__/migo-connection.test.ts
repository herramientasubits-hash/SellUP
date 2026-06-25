import { describe, it, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testMigoConnection } from '../migo-connection';

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TEST_KEY = 'test-api-key-1234';

before(() => {
  process.env.MIGO_API_KEY = TEST_KEY;
});

after(() => {
  delete process.env.MIGO_API_KEY;
  mock.restoreAll();
});

describe('testMigoConnection', () => {
  it('returns success true on 200 with valid payload', async () => {
    mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      assert.equal(body.token, TEST_KEY);
      assert.equal(body.ruc, '20100047218');
      assert.equal(init.method, 'POST');
      const headers = init.headers as Record<string, string>;
      assert.equal(headers['Content-Type'], 'application/json');
      assert.ok(!('Authorization' in headers));
      return makeJsonResponse({
        success: true,
        ruc: '20100047218',
        nombre_o_razon_social: 'SUNAT',
      });
    });

    const result = await testMigoConnection();

    assert.equal(result.success, true);
    assert.equal(result.error, undefined);
    assert.ok(result.message);
    assert.equal(result.httpStatus, 200);
    assert.ok(result.responseTimeMs !== undefined);
    assert.ok(result.maskedKey);
    assert.ok(!result.maskedKey!.includes(TEST_KEY));
    assert.ok(result.maskedKey!.endsWith('1234'));
    assert.ok(result.checkedAt);
  });

  it('returns endpoint_not_found on 404', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return makeJsonResponse({ success: false, message: 'La página no se encontró' }, 404);
    });

    const result = await testMigoConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'ENDPOINT_NOT_FOUND');
    assert.ok(result.message);
    assert.equal(result.httpStatus, 404);
  });

  it('returns endpoint_not_found on 405', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return makeJsonResponse({ success: false }, 405);
    });

    const result = await testMigoConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'ENDPOINT_NOT_FOUND');
    assert.equal(result.httpStatus, 405);
  });

  it('returns auth failed on 401', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return makeJsonResponse({ success: false }, 401);
    });

    const result = await testMigoConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_API_KEY');
    assert.equal(result.httpStatus, 401);
  });

  it('returns auth failed on 403', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return makeJsonResponse({ success: false }, 403);
    });

    const result = await testMigoConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_API_KEY');
    assert.equal(result.httpStatus, 403);
  });

  it('returns rate limit on 429', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return makeJsonResponse({ success: false }, 429);
    });

    const result = await testMigoConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'RATE_LIMIT');
    assert.equal(result.httpStatus, 429);
  });

  it('returns invalid data error on 422', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return makeJsonResponse({ success: false }, 422);
    });

    const result = await testMigoConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'API_ERROR');
    assert.equal(result.httpStatus, 422);
  });

  it('returns server error on 5xx', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return makeJsonResponse({ success: false }, 500);
    });

    const result = await testMigoConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'API_ERROR');
    assert.equal(result.httpStatus, 500);
  });

  it('does not return raw payload in error messages', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return makeJsonResponse({
        success: false,
        ruc: '20100047218',
        nombre_o_razon_social: 'SUNAT',
        representantes_legales: [{ dni: '12345678', nombre: 'John Doe' }],
      }, 500);
    });

    const result = await testMigoConnection();

    assert.equal(result.success, false);
    assert.ok(result.message);
    assert.ok(!result.message!.includes('representantes_legales'));
    assert.ok(!result.message!.includes('12345678'));
    assert.ok(!result.message!.includes('John Doe'));
  });

  it('does not return Authorization header in mocked call', async () => {
    let capturedInit: RequestInit | undefined;
    mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      capturedInit = init;
      return makeJsonResponse({ success: true });
    });

    await testMigoConnection();

    const headers = capturedInit?.headers as Record<string, string> | undefined;
    assert.ok(headers);
    assert.ok(!('Authorization' in (headers ?? {})));
  });

  it('does not return the full API key', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return makeJsonResponse({ success: true });
    });

    const result = await testMigoConnection();

    assert.ok(result.maskedKey);
    assert.equal(result.maskedKey, '****1234');
    assert.ok(!result.message!.includes(TEST_KEY));
  });

  it('does not persist representatives (no DB write in test)', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return makeJsonResponse({ success: true });
    });

    const result = await testMigoConnection();

    assert.equal(typeof result, 'object');
    assert.equal('success' in result, true);
    assert.equal('representantes' in result, false);
    assert.equal('representantes_legales' in result, false);
  });

  it('sends POST request to correct URL', async () => {
    let capturedUrl: string | undefined;
    mock.method(globalThis, 'fetch', async (url: string) => {
      capturedUrl = url;
      return makeJsonResponse({ success: true });
    });

    await testMigoConnection();

    assert.equal(capturedUrl, 'https://api.migo.pe/api/v1/ruc');
  });

  it('sends token in body, not in Authorization header', async () => {
    let capturedInit: RequestInit | undefined;
    mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      capturedInit = init;
      return makeJsonResponse({ success: true });
    });

    await testMigoConnection();

    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], 'application/json');
    assert.ok(!('Authorization' in headers));
    const body = JSON.parse(capturedInit!.body as string);
    assert.equal(body.token, TEST_KEY);
    assert.equal(body.ruc, '20100047218');
  });
});
