/**
 * Tests — searchLushaContactsV3 (Agente 2A · 17B.4C)
 *
 * Verifica POST /v3/contacts/search sin llamadas reales.
 * No crea candidatos. No revela emails ni teléfonos. No toca Apollo.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { searchLushaContactsV3 } from '../lusha-client';

const FAKE_KEY = 'test-lusha-key-not-real';
const SEARCH_ENDPOINT = 'https://api.lusha.com/v3/contacts/search';

type FetchMock = (url: string, opts?: RequestInit) => Promise<Response>;

let originalFetch: typeof global.fetch;

function mockFetch(impl: FetchMock) {
  // @ts-expect-error override for tests
  global.fetch = impl;
}

function makeResponse(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {}
): Response {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as Response;
}

const MINIMAL_INPUT = {
  apiKey: FAKE_KEY,
  timeoutMs: 5000,
  contacts: [{ fullName: 'Camila Fino Morales', companyDomain: 'siesa.com' }],
};

before(() => { originalFetch = global.fetch; });
after(() => { global.fetch = originalFetch; });

describe('searchLushaContactsV3', () => {
  it('usa el endpoint exacto /v3/contacts/search', async () => {
    let capturedUrl = '';
    mockFetch(async (url) => {
      capturedUrl = url;
      return makeResponse(200, { contacts: [] });
    });

    await searchLushaContactsV3(MINIMAL_INPUT);
    assert.equal(capturedUrl, SEARCH_ENDPOINT);
  });

  it('usa método POST', async () => {
    let capturedMethod = '';
    mockFetch(async (_url, opts) => {
      capturedMethod = opts?.method ?? '';
      return makeResponse(200, { contacts: [] });
    });

    await searchLushaContactsV3(MINIMAL_INPUT);
    assert.equal(capturedMethod, 'POST');
  });

  it('usa header api_key', async () => {
    let capturedKey = '';
    mockFetch(async (_url, opts) => {
      const h = opts?.headers as Record<string, string> | undefined;
      capturedKey = h?.['api_key'] ?? '';
      return makeResponse(200, { contacts: [] });
    });

    await searchLushaContactsV3(MINIMAL_INPUT);
    assert.equal(capturedKey, FAKE_KEY);
  });

  it('no envía campo reveal en el body', async () => {
    let capturedBody: Record<string, unknown> = {};
    mockFetch(async (_url, opts) => {
      capturedBody = JSON.parse(opts?.body as string ?? '{}') as Record<string, unknown>;
      return makeResponse(200, { contacts: [] });
    });

    await searchLushaContactsV3(MINIMAL_INPUT);
    assert.ok(!('reveal' in capturedBody), 'El body NO debe contener "reveal"');
    assert.ok(!('revealEmail' in capturedBody), 'El body NO debe contener "revealEmail"');
    assert.ok(!('revealPhone' in capturedBody), 'El body NO debe contener "revealPhone"');
  });

  it('no envía campo phone/phones en el body', async () => {
    let capturedBody: Record<string, unknown> = {};
    mockFetch(async (_url, opts) => {
      capturedBody = JSON.parse(opts?.body as string ?? '{}') as Record<string, unknown>;
      return makeResponse(200, { contacts: [] });
    });

    await searchLushaContactsV3(MINIMAL_INPUT);
    const bodyStr = JSON.stringify(capturedBody);
    assert.ok(!bodyStr.includes('"phone"'), 'El body NO debe contener "phone"');
    assert.ok(!bodyStr.includes('"phones"'), 'El body NO debe contener "phones"');
  });

  it('no expone la API key en el resultado', async () => {
    mockFetch(async () => makeResponse(200, { contacts: [] }));

    const result = await searchLushaContactsV3(MINIMAL_INPUT);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(FAKE_KEY), 'El resultado NO debe contener la API key');
  });

  it('sanitiza emails si Lusha los devuelve accidentalmente', async () => {
    mockFetch(async () =>
      makeResponse(200, {
        contacts: [{
          id: 'abc123',
          fullName: 'Camila Fino',
          title: 'CHRO',
          emails: [{ email: 'camila@siesa.com' }],
          email: 'camila@siesa.com',
        }],
      })
    );

    const result = await searchLushaContactsV3(MINIMAL_INPUT);
    const serialized = JSON.stringify(result.sanitizedResults ?? []);
    assert.ok(!serialized.includes('camila@siesa.com'), 'Los emails NO deben aparecer en sanitizedResults');
  });

  it('sanitiza teléfonos si Lusha los devuelve accidentalmente', async () => {
    mockFetch(async () =>
      makeResponse(200, {
        contacts: [{
          id: 'abc123',
          fullName: 'Camila Fino',
          phoneNumbers: [{ localizedNumber: '+57300000000' }],
          phone: '+57300000000',
        }],
      })
    );

    const result = await searchLushaContactsV3(MINIMAL_INPUT);
    const serialized = JSON.stringify(result.sanitizedResults ?? []);
    assert.ok(!serialized.includes('+57300000000'), 'Los teléfonos NO deben aparecer en sanitizedResults');
  });

  it('mapea 401 a provider_auth_error', async () => {
    mockFetch(async () => makeResponse(401, 'Unauthorized'));

    const result = await searchLushaContactsV3(MINIMAL_INPUT);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_auth_error');
    assert.equal(result.httpStatus, 401);
    assert.equal(result.resultsReturned, 0);
  });

  it('mapea 402 a insufficient_credits', async () => {
    mockFetch(async () => makeResponse(402, 'Payment Required'));

    const result = await searchLushaContactsV3(MINIMAL_INPUT);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'insufficient_credits');
    assert.equal(result.httpStatus, 402);
  });

  it('mapea 429 a rate_limited', async () => {
    mockFetch(async () => makeResponse(429, 'Too Many Requests'));

    const result = await searchLushaContactsV3(MINIMAL_INPUT);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'rate_limited');
    assert.equal(result.httpStatus, 429);
  });

  it('retorna provider_timeout cuando AbortController dispara', async () => {
    mockFetch(async (_url, opts) => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      void opts?.signal;
      throw err;
    });

    const result = await searchLushaContactsV3({ ...MINIMAL_INPUT, timeoutMs: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_timeout');
    assert.equal(result.resultsReturned, 0);
  });

  it('retorna status=success con resultados cuando Lusha encuentra contactos', async () => {
    mockFetch(async () =>
      makeResponse(200, {
        contacts: [{
          id: 'p-001',
          fullName: 'Camila Fino Morales',
          title: 'CHRO',
          companyName: 'Siesa',
          companyDomain: 'siesa.com',
          linkedinUrl: 'https://linkedin.com/in/camilafino',
          has: { email: true, phone: false },
          canReveal: { email: true, phone: false },
        }],
        creditsCharged: 1,
      })
    );

    const result = await searchLushaContactsV3(MINIMAL_INPUT);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.equal(result.resultsReturned, 1);
    assert.equal(result.creditsCharged, 1);
    const contact = result.sanitizedResults?.[0];
    assert.ok(contact);
    assert.equal(contact.id, 'p-001');
    assert.equal(contact.fullName, 'Camila Fino Morales');
    assert.equal(contact.title, 'CHRO');
    assert.equal(contact.companyDomain, 'siesa.com');
  });

  it('retorna status=no_results cuando contacts está vacío', async () => {
    mockFetch(async () =>
      makeResponse(200, { contacts: [], creditsCharged: 0 })
    );

    const result = await searchLushaContactsV3(MINIMAL_INPUT);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'no_results');
    assert.equal(result.resultsReturned, 0);
  });

  // --- Tests específicos para linkedinUrl (17B.4D) ---

  it('acepta linkedinUrl como único identificador y lo envía en el payload', async () => {
    let capturedBody: Record<string, unknown> = {};
    mockFetch(async (_url, opts) => {
      capturedBody = JSON.parse(opts?.body as string ?? '{}') as Record<string, unknown>;
      return makeResponse(200, { results: [] });
    });

    await searchLushaContactsV3({
      apiKey: FAKE_KEY,
      timeoutMs: 5000,
      contacts: [{ linkedinUrl: 'http://www.linkedin.com/in/patriciavalenciahernandez', companyDomain: 'siesa.com' }],
    });

    const contacts = capturedBody['contacts'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(contacts), 'El body debe tener contacts array');
    assert.equal(contacts[0]['linkedinUrl'], 'http://www.linkedin.com/in/patriciavalenciahernandez');
    assert.equal(contacts[0]['companyDomain'], 'siesa.com');
  });

  it('no incluye reveal ni phones cuando se usa linkedinUrl', async () => {
    let capturedBody: Record<string, unknown> = {};
    mockFetch(async (_url, opts) => {
      capturedBody = JSON.parse(opts?.body as string ?? '{}') as Record<string, unknown>;
      return makeResponse(200, { results: [] });
    });

    await searchLushaContactsV3({
      apiKey: FAKE_KEY,
      timeoutMs: 5000,
      contacts: [{ linkedinUrl: 'http://www.linkedin.com/in/patriciavalenciahernandez', companyDomain: 'siesa.com' }],
    });

    const bodyStr = JSON.stringify(capturedBody);
    assert.ok(!('reveal' in capturedBody), 'No debe haber campo reveal');
    assert.ok(!bodyStr.includes('"phone"'), 'No debe haber campo phone');
    assert.ok(!bodyStr.includes('"phones"'), 'No debe haber campo phones');
  });

  it('retorna status=success cuando Lusha encuentra contacto por linkedinUrl (results key)', async () => {
    mockFetch(async () =>
      makeResponse(200, {
        results: [{
          id: 'lp-001',
          fullName: 'Patricia Valencia Hernandez',
          title: 'HR Director',
          companyName: 'Siesa',
          companyDomain: 'siesa.com',
          linkedinUrl: 'http://www.linkedin.com/in/patriciavalenciahernandez',
          has: { email: true, phone: true },
          canReveal: { email: true, phone: false },
        }],
        creditsCharged: 1,
        requestId: 'req-linkedin-001',
      })
    );

    const result = await searchLushaContactsV3({
      apiKey: FAKE_KEY,
      timeoutMs: 5000,
      contacts: [{ linkedinUrl: 'http://www.linkedin.com/in/patriciavalenciahernandez', companyDomain: 'siesa.com' }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.equal(result.resultsReturned, 1);
    assert.equal(result.requestId, 'req-linkedin-001');
    const contact = result.sanitizedResults?.[0];
    assert.ok(contact);
    assert.equal(contact.fullName, 'Patricia Valencia Hernandez');
    assert.equal(contact.linkedinUrl, 'http://www.linkedin.com/in/patriciavalenciahernandez');
    const serialized = JSON.stringify(contact);
    assert.ok(!serialized.includes('@'), 'No debe haber emails en sanitizedResults');
  });

  it('retorna status=no_results cuando Lusha no encuentra por linkedinUrl', async () => {
    mockFetch(async () =>
      makeResponse(200, { results: [], creditsCharged: null })
    );

    const result = await searchLushaContactsV3({
      apiKey: FAKE_KEY,
      timeoutMs: 5000,
      contacts: [{ linkedinUrl: 'http://www.linkedin.com/in/patriciavalenciahernandez', companyDomain: 'siesa.com' }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'no_results');
    assert.equal(result.resultsReturned, 0);
  });

  it('retorna provider_error con mensaje sanitizado en 400 schema error', async () => {
    mockFetch(async () =>
      makeResponse(400, JSON.stringify({ error: 'contacts.0.property fullName should not exist' }))
    );

    const result = await searchLushaContactsV3(MINIMAL_INPUT);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(result.httpStatus, 400);
    assert.ok(result.errorMessage, 'Debe haber errorMessage');
    assert.ok(!result.errorMessage?.includes(FAKE_KEY), 'El errorMessage no debe exponer la API key');
  });
});
