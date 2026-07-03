/**
 * Tests para enrichLushaContactsV3 — 17B.4E
 *
 * Cubre:
 * 1. Usa endpoint exacto /v3/contacts/enrich
 * 2. Usa header api_key
 * 3. Envía reveal: ["emails"]
 * 4. No envía phones
 * 5. Rechaza reveal vacío
 * 6. Rechaza reveal con phones
 * 7. Rechaza más de 1 contacto
 * 8. No expone API key
 * 9. Sanitiza email → hasEmail + emailDomain (no email completo)
 * 10. Sanitiza phone accidental (hasPhone: false)
 * 11. Success con email → status success
 * 12. Success sin email → status no_results
 * 13. Mapea 401 → provider_auth_error
 * 14. Mapea 402 → insufficient_credits
 * 15. Mapea 429 → rate_limited
 * 16. Timeout → provider_timeout
 */

import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { enrichLushaContactsV3 } from '../lusha-client';

const FAKE_API_KEY = 'test-api-key-not-real';
const CONTACT_ID = 'v1.bb35V7Pg17hk79ppMEi1RsXTwucz6TROeg';
const DEFAULT_INPUT = {
  apiKey: FAKE_API_KEY,
  timeoutMs: 5000,
  contacts: [{ id: CONTACT_ID }],
  reveal: ['emails'] as Array<'emails'>,
};

type FetchMock = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

let originalFetch: typeof globalThis.fetch;
let capturedUrl: string;
let capturedBody: Record<string, unknown>;
let capturedHeaders: Record<string, string>;

function makeMockFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): FetchMock {
  return async (url, init) => {
    capturedUrl = url.toString();
    capturedHeaders = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const k of Object.keys(h)) capturedHeaders[k.toLowerCase()] = h[k];
    }
    if (init?.body) {
      try { capturedBody = JSON.parse(init.body as string); } catch { capturedBody = {}; }
    }

    const responseHeaders = new Headers({
      'content-type': 'application/json',
      ...headers,
    });

    return new Response(JSON.stringify(body), { status, headers: responseHeaders });
  };
}

function makeTimeoutFetch(): FetchMock {
  return async (_url, init) => {
    const signal = (init as RequestInit & { signal?: AbortSignal })?.signal;
    return new Promise<Response>((_, reject) => {
      if (signal) {
        signal.addEventListener('abort', () => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }
    });
  };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  capturedUrl = '';
  capturedBody = {};
  capturedHeaders = {};
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('enrichLushaContactsV3', () => {
  // --- Guardrails antes de llamar API ---

  it('test 5: rechaza reveal vacío sin llamar API', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };

    const result = await enrichLushaContactsV3({ ...DEFAULT_INPUT, reveal: [] as unknown as Array<'emails'> });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.match(result.errorMessage ?? '', /reveal must not be empty/);
    assert.equal(fetchCalled, false, 'fetch no debe llamarse con reveal vacío');
  });

  it('test 6: rechaza reveal con phones sin llamar API', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };

    const result = await enrichLushaContactsV3({
      ...DEFAULT_INPUT,
      reveal: ['phones'] as unknown as Array<'emails'>,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.match(result.errorMessage ?? '', /reveal must not include phones/);
    assert.equal(fetchCalled, false, 'fetch no debe llamarse con phones en reveal');
  });

  it('test 7: rechaza más de 1 contacto sin llamar API', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };

    const result = await enrichLushaContactsV3({
      ...DEFAULT_INPUT,
      contacts: [{ id: 'a' }, { id: 'b' }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.match(result.errorMessage ?? '', /exactly 1 contact/);
    assert.equal(fetchCalled, false);
  });

  // --- Endpoint y headers ---

  it('test 1: usa endpoint exacto /v3/contacts/enrich', async () => {
    globalThis.fetch = makeMockFetch(200, { results: [], creditsCharged: 0 });
    await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.ok(capturedUrl.endsWith('/v3/contacts/enrich'), `URL incorrecta: ${capturedUrl}`);
  });

  it('test 2: usa header api_key', async () => {
    globalThis.fetch = makeMockFetch(200, { results: [], creditsCharged: 0 });
    await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(capturedHeaders['api_key'], FAKE_API_KEY);
  });

  it('test 8: no expone API key en resultado', async () => {
    globalThis.fetch = makeMockFetch(200, { results: [], creditsCharged: 0 });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes(FAKE_API_KEY), 'API key no debe aparecer en el resultado');
  });

  // --- Body del request ---

  it('test 3: envía reveal: ["emails"] en el body', async () => {
    globalThis.fetch = makeMockFetch(200, { results: [], creditsCharged: 0 });
    await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.deepEqual(capturedBody['reveal'], ['emails']);
    // Body uses "ids" not "contacts" — confirmed live 17B.4E
    assert.deepEqual(capturedBody['ids'], [CONTACT_ID]);
    assert.ok(!('contacts' in capturedBody), 'body no debe tener campo "contacts"');
  });

  it('test 4: no envía phones en el body', async () => {
    globalThis.fetch = makeMockFetch(200, { results: [], creditsCharged: 0 });
    await enrichLushaContactsV3(DEFAULT_INPUT);
    const revealArr = capturedBody['reveal'] as string[];
    assert.ok(!revealArr.includes('phones'), 'phones no debe estar en reveal');
    assert.ok(!('phones' in capturedBody), 'phones no debe ser campo separado');
  });

  // --- Sanitización email ---

  it('test 9: sanitiza email completo → hasEmail + emailDomain, no expone dirección', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{
        id: CONTACT_ID,
        emails: [{ email: 'patricia.valencia@siesa.com', emailType: 'professional' }],
        firstName: 'Patricia',
        lastName: 'Valencia',
      }],
      creditsCharged: 1,
    });

    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');

    const sanitized = result.sanitizedResults?.[0];
    assert.ok(sanitized, 'debe haber un resultado sanitizado');
    assert.equal(sanitized.hasEmail, true);
    assert.equal(sanitized.emailDomain, 'siesa.com');
    assert.equal(sanitized.emailType, 'professional');

    // Verificar que el email completo NO aparece en ningún lado
    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes('patricia.valencia@siesa.com'), 'email completo NO debe aparecer en resultado');
    assert.ok(!resultStr.includes('patricia.valencia'), 'local part del email NO debe aparecer en resultado');
  });

  // --- Sanitización phone accidental ---

  it('test 10: sanitiza phone accidental → hasPhone siempre false', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{
        id: CONTACT_ID,
        emails: [{ email: 'test@siesa.com' }],
        phoneNumbers: [{ localizedNumber: '+57 300 123 4567', type: 'direct' }],
        phones: ['+57 300 123 4567'],
      }],
      creditsCharged: 1,
    });

    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    const sanitized = result.sanitizedResults?.[0];
    assert.ok(sanitized);
    assert.equal(sanitized.hasPhone, false);

    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes('+57 300 123 4567'), 'teléfono NO debe aparecer en resultado');
  });

  // --- Success con email ---

  it('test 11: success con email → status success, hasEmail true', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{
        id: CONTACT_ID,
        emails: [{ email: 'user@example.com', emailType: 'professional' }],
        firstName: 'John',
        lastName: 'Doe',
      }],
      creditsCharged: 1,
    });

    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.equal(result.resultsReturned, 1);
    assert.equal(result.creditsCharged, 1);
    assert.equal(result.sanitizedResults?.[0].hasEmail, true);
    assert.equal(result.sanitizedResults?.[0].emailDomain, 'example.com');
    assert.equal(result.sanitizedResults?.[0].hasPhone, false);
  });

  // --- Success sin email ---

  it('test 12: success sin email → no_results (contacts vacío)', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [],
      creditsCharged: 0,
    });

    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'no_results');
    assert.equal(result.resultsReturned, 0);
  });

  it('test 12b: contacto sin emails → hasEmail false, status success', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, emails: [], firstName: 'John' }],
      creditsCharged: 0,
    });

    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.equal(result.sanitizedResults?.[0].hasEmail, false);
    assert.equal(result.sanitizedResults?.[0].emailDomain, null);
  });

  // --- HTTP error mapping ---

  it('test 13: 401 → provider_auth_error', async () => {
    globalThis.fetch = makeMockFetch(401, { error: 'Unauthorized' });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_auth_error');
    assert.equal(result.httpStatus, 401);
  });

  it('test 14: 402 → insufficient_credits', async () => {
    globalThis.fetch = makeMockFetch(402, { error: 'Insufficient credits' });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'insufficient_credits');
    assert.equal(result.httpStatus, 402);
  });

  it('test 15: 429 → rate_limited', async () => {
    globalThis.fetch = makeMockFetch(429, { error: 'Too Many Requests' });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'rate_limited');
    assert.equal(result.httpStatus, 429);
  });

  // --- Timeout ---

  it('test 16: timeout → provider_timeout', async () => {
    globalThis.fetch = makeTimeoutFetch() as typeof globalThis.fetch;
    const result = await enrichLushaContactsV3({ ...DEFAULT_INPUT, timeoutMs: 50 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_timeout');
  });
});
