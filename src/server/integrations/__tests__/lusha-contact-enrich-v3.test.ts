/**
 * Tests para enrichLushaContactsV3 — 17B.4E + 17B.4F
 *
 * 17B.4E cubre:
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
 *
 * 17B.4F agrega normalización de estructuras anidadas:
 * 17. Extrae jobTitle.title
 * 18. Extrae jobTitle.name
 * 19. Extrae company.name
 * 20. Extrae company.domain
 * 21. Extrae socialLinks.linkedin
 * 22. Extrae socialLinks.linkedinUrl
 * 23. Extrae LinkedIn desde array { type, url }
 * 24. Extrae emailDomain desde emails[0].email
 * 25. Extrae emailType desde emails[0].type
 * 26. No expone email completo (nested mock)
 * 27. No expone phone (nested mock)
 * 28. hasPhone siempre false (nested mock)
 * 29. Extrae creditsCharged desde billing.creditsCharged
 * 30. Si billing no tiene credits → creditsCharged null
 * 31. Compatibilidad con strings planos existentes
 * 32. Shape vacío no rompe
 * 33. Mock completo anidado (integración)
 * 34. results como objeto con contacts (shape alternativo)
 */

import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  enrichLushaContactsV3,
  extractLushaJobTitle,
  extractLushaCompanyName,
  extractLushaCompanyDomain,
  extractLushaLinkedinUrl,
  extractEmailInfoFromLushaEmails,
  extractLushaBilling,
} from '../lusha-client';

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

  // --- 17B.4F: nested structure normalization via enrichLushaContactsV3 ---

  it('test 17: extrae jobTitle.title desde objeto anidado', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, jobTitle: { title: 'HR Business Partner' }, emails: [{ email: 'x@acme.com', type: 'work' }] }],
      billing: { creditsCharged: 1 },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.sanitizedResults?.[0].title, 'HR Business Partner');
  });

  it('test 18: extrae jobTitle.name desde objeto anidado', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, jobTitle: { name: 'Sales Director' }, emails: [{ email: 'x@acme.com', type: 'work' }] }],
      billing: { creditsCharged: 1 },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.sanitizedResults?.[0].title, 'Sales Director');
  });

  it('test 19: extrae company.name desde objeto anidado', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, company: { name: 'Siesa', domain: 'siesa.com' }, emails: [{ email: 'x@siesa.com' }] }],
      billing: { creditsCharged: 1 },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.sanitizedResults?.[0].companyName, 'Siesa');
  });

  it('test 20: extrae company.domain desde objeto anidado', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, company: { name: 'Siesa', domain: 'siesa.com' }, emails: [{ email: 'x@siesa.com' }] }],
      billing: { creditsCharged: 1 },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.sanitizedResults?.[0].companyDomain, 'siesa.com');
  });

  it('test 21: extrae linkedin desde socialLinks.linkedin', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, socialLinks: { linkedin: 'http://www.linkedin.com/in/patricia' }, emails: [{ email: 'x@acme.com' }] }],
      billing: { creditsCharged: 1 },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.sanitizedResults?.[0].linkedinUrl, 'http://www.linkedin.com/in/patricia');
  });

  it('test 22: extrae linkedin desde socialLinks.linkedinUrl', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, socialLinks: { linkedinUrl: 'https://linkedin.com/in/john' }, emails: [{ email: 'x@acme.com' }] }],
      billing: { creditsCharged: 1 },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.sanitizedResults?.[0].linkedinUrl, 'https://linkedin.com/in/john');
  });

  it('test 23: extrae linkedin desde socialLinks array { type, url }', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, socialLinks: [{ type: 'linkedin', url: 'https://linkedin.com/in/maria' }], emails: [{ email: 'x@acme.com' }] }],
      billing: { creditsCharged: 1 },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.sanitizedResults?.[0].linkedinUrl, 'https://linkedin.com/in/maria');
  });

  it('test 24+25: extrae emailDomain y emailType desde emails[0]', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, emails: [{ email: 'user@corp.com', type: 'work' }] }],
      billing: { creditsCharged: 1 },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.sanitizedResults?.[0].emailDomain, 'corp.com');
    assert.equal(result.sanitizedResults?.[0].emailType, 'work');
  });

  it('test 26: no expone email completo en mock anidado', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, emails: [{ email: 'secret@siesa.com', type: 'work' }], jobTitle: { title: 'VP' } }],
      billing: { creditsCharged: 1 },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes('secret@siesa.com'), 'email completo no debe aparecer');
    assert.ok(!resultStr.includes('secret'), 'local-part no debe aparecer');
  });

  it('test 27+28: no expone phone y hasPhone siempre false en mock anidado', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{
        id: CONTACT_ID,
        emails: [{ email: 'x@acme.com', type: 'work' }],
        phoneNumbers: [{ number: '+57-no-exponer' }],
      }],
      billing: { creditsCharged: 1 },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    const sanitized = result.sanitizedResults?.[0];
    assert.equal(sanitized?.hasPhone, false);
    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes('+57-no-exponer'), 'teléfono no debe aparecer');
  });

  it('test 29: extrae creditsCharged desde billing.creditsCharged', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, emails: [{ email: 'x@acme.com' }] }],
      billing: { creditsCharged: 1 },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.creditsCharged, 1);
  });

  it('test 30: billing sin credits → creditsCharged null', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, emails: [{ email: 'x@acme.com' }] }],
      billing: { someOtherField: 'value' },
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.creditsCharged, null);
  });

  it('test 31: compatibilidad con strings planos (jobTitle string)', async () => {
    globalThis.fetch = makeMockFetch(200, {
      results: [{ id: CONTACT_ID, jobTitle: 'CEO', company: 'Acme', companyDomain: 'acme.com', emails: [{ email: 'x@acme.com', type: 'work' }] }],
      creditsCharged: 2,
    });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.sanitizedResults?.[0].title, 'CEO');
    assert.equal(result.creditsCharged, 2);
  });

  it('test 32: shape vacío no rompe', async () => {
    globalThis.fetch = makeMockFetch(200, { results: [{}] });
    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.ok, true);
    const s = result.sanitizedResults?.[0];
    assert.ok(s);
    assert.equal(s.hasEmail, false);
    assert.equal(s.hasPhone, false);
    assert.equal(s.title, null);
    assert.equal(s.companyName, null);
    assert.equal(s.linkedinUrl, null);
  });

  it('test 33: mock completo anidado (integración Patricia Valencia)', async () => {
    globalThis.fetch = makeMockFetch(200, {
      requestId: 'mock-request-id',
      results: [
        {
          id: 'v1.example',
          firstName: 'Patricia',
          lastName: 'HernáNdez',
          name: 'Patricia Valencia HernáNdez',
          jobTitle: { title: 'Human Resources Business Partner' },
          company: { id: 'company-1', name: 'Siesa', domain: 'siesa.com' },
          socialLinks: { linkedin: 'http://www.linkedin.com/in/patriciavalenciahernandez' },
          emails: [{ email: 'do-not-expose@siesa.com', type: 'work' }],
          phoneNumbers: [{ number: '+57-no-exponer' }],
        },
      ],
      billing: { creditsCharged: 1 },
    });

    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.equal(result.creditsCharged, 1);

    const s = result.sanitizedResults?.[0];
    assert.ok(s, 'debe haber resultado sanitizado');
    assert.equal(s.hasEmail, true);
    assert.equal(s.emailDomain, 'siesa.com');
    assert.equal(s.emailType, 'work');
    assert.equal(s.title, 'Human Resources Business Partner');
    assert.equal(s.companyName, 'Siesa');
    assert.equal(s.companyDomain, 'siesa.com');
    assert.equal(s.linkedinUrl, 'http://www.linkedin.com/in/patriciavalenciahernandez');
    assert.equal(s.hasPhone, false);

    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes('do-not-expose'), 'email completo no debe aparecer');
    assert.ok(!resultStr.includes('+57-no-exponer'), 'teléfono no debe aparecer');
  });

  it('test 34: results como objeto con contacts (shape alternativo)', async () => {
    globalThis.fetch = makeMockFetch(200, {
      requestId: 'mock-alt',
      results: {
        contacts: [
          {
            id: 'v1.alt',
            firstName: 'Juan',
            emails: [{ email: 'juan@alt.com', type: 'work' }],
            jobTitle: { title: 'CTO' },
            company: { name: 'AltCorp', domain: 'alt.com' },
          },
        ],
      },
      billing: { creditsCharged: 1 },
    });

    const result = await enrichLushaContactsV3(DEFAULT_INPUT);
    assert.equal(result.ok, true);
    assert.equal(result.resultsReturned, 1);
    assert.equal(result.sanitizedResults?.[0].title, 'CTO');
    assert.equal(result.sanitizedResults?.[0].companyName, 'AltCorp');
    assert.equal(result.sanitizedResults?.[0].emailDomain, 'alt.com');
  });
});
