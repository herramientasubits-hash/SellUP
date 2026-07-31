// Tests for lusha-phone-fallback-client.ts (Agente 2A ·
// LUSHA-PHONE-FALLBACK-1S). All network calls are mocked — NO real Lusha
// calls, NO real API key. Node.js built-in test runner.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { enrichLushaContactPhonesForFallback } from '../lusha-phone-fallback-client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type CapturedRequest = { url: string; init?: RequestInit };

function mockFetchOnce(status: number, body: unknown): CapturedRequest {
  const captured: CapturedRequest = { url: '' };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = url.toString();
    captured.init = init;
    return new Response(JSON.stringify(body), {
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
    });
  }) as typeof fetch;
  return captured;
}

function mockFetchTimeout(): void {
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  }) as typeof fetch;
}

describe('enrichLushaContactPhonesForFallback — guardrails before any fetch', () => {
  test('allowPhoneReveal !== true never calls fetch', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const result = await enrichLushaContactPhonesForFallback({
      apiKey: 'test-key',
      timeoutMs: 1000,
      contactId: 'v1.abcdef1234567890',
      allowPhoneReveal: false as unknown as true,
    });

    assert.equal(fetchCalled, false);
    assert.equal(result.ok, false);
  });

  test('missing contactId never calls fetch', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const result = await enrichLushaContactPhonesForFallback({
      apiKey: 'test-key',
      timeoutMs: 1000,
      contactId: '',
      allowPhoneReveal: true,
    });

    assert.equal(fetchCalled, false);
    assert.equal(result.ok, false);
  });
});

describe('enrichLushaContactPhonesForFallback — request shape', () => {
  test('sends exactly reveal: ["phones"] and a single-id body to /v3/contacts/enrich', async () => {
    const captured = mockFetchOnce(200, {
      results: [{ phones: [] }],
      billing: { creditsCharged: 0 },
    });

    await enrichLushaContactPhonesForFallback({
      apiKey: 'test-key',
      timeoutMs: 1000,
      contactId: 'v1.abcdef1234567890',
      allowPhoneReveal: true,
    });

    assert.ok(captured.url.endsWith('/v3/contacts/enrich'));
    const body = JSON.parse(captured.init?.body as string);
    assert.deepEqual(body, { ids: ['v1.abcdef1234567890'], reveal: ['phones'] });

    const headers = captured.init?.headers as Record<string, string>;
    assert.equal(headers['api_key'], 'test-key');
  });

  test('never includes the API key in the response result', async () => {
    mockFetchOnce(200, { results: [{ phones: [] }], billing: { creditsCharged: 0 } });

    const result = await enrichLushaContactPhonesForFallback({
      apiKey: 'super-secret-key',
      timeoutMs: 1000,
      contactId: 'v1.abcdef1234567890',
      allowPhoneReveal: true,
    });

    assert.equal(JSON.stringify(result).includes('super-secret-key'), false);
  });

  test('never includes the full contact id in an error message', async () => {
    mockFetchTimeout();

    const result = await enrichLushaContactPhonesForFallback({
      apiKey: 'test-key',
      timeoutMs: 5,
      contactId: 'v1.abcdef1234567890fullidshouldnotappear',
      allowPhoneReveal: true,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorMessage.includes('v1.abcdef1234567890fullidshouldnotappear'), false);
    }
  });
});

describe('enrichLushaContactPhonesForFallback — response parsing', () => {
  test('phones present + credits charged → ok, revealed, phoneType unknown', async () => {
    mockFetchOnce(200, {
      results: [{ phones: [{ number: '+000000000' }] }],
      billing: { creditsCharged: 1 },
    });

    const result = await enrichLushaContactPhonesForFallback({
      apiKey: 'test-key',
      timeoutMs: 1000,
      contactId: 'v1.abcdef1234567890',
      allowPhoneReveal: true,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.candidateStatus, 'revealed');
      assert.equal(result.phoneType, 'unknown');
      assert.equal(result.phoneNumber, '+000000000');
      assert.equal(result.creditsCharged, 1);
      assert.equal(result.phonesReturned, 1);
    }
  });

  test('no phones + 0 credits → ok, no_phone_found', async () => {
    mockFetchOnce(200, {
      results: [{ phones: [] }],
      billing: { creditsCharged: 0 },
    });

    const result = await enrichLushaContactPhonesForFallback({
      apiKey: 'test-key',
      timeoutMs: 1000,
      contactId: 'v1.abcdef1234567890',
      allowPhoneReveal: true,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.candidateStatus, 'no_phone_found');
      assert.equal(result.phoneNumber, null);
      assert.equal(result.creditsCharged, 0);
    }
  });

  test('phone.type "mobile" present → parsed as mobile (LUSHA-PHONE-FALLBACK-1)', async () => {
    mockFetchOnce(200, {
      results: [{ phones: [{ number: '+000000000', type: 'mobile' }] }],
      billing: { creditsCharged: 1 },
    });

    const result = await enrichLushaContactPhonesForFallback({
      apiKey: 'test-key',
      timeoutMs: 1000,
      contactId: 'v1.abcdef1234567890',
      allowPhoneReveal: true,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.phoneNumber, '+000000000');
      assert.equal(result.phoneType, 'mobile');
      assert.equal(result.creditsCharged, 1);
    }
  });

  test('phone.type present but unrecognized → parsed as other, never silently unknown', async () => {
    mockFetchOnce(200, {
      results: [{ phones: [{ number: '+000000000', type: 'fax' }] }],
      billing: { creditsCharged: 1 },
    });

    const result = await enrichLushaContactPhonesForFallback({
      apiKey: 'test-key',
      timeoutMs: 1000,
      contactId: 'v1.abcdef1234567890',
      allowPhoneReveal: true,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.phoneType, 'other');
    }
  });

  test('403 → ok:true with error mapping (provider_permission_error)', async () => {
    mockFetchOnce(403, {});

    const result = await enrichLushaContactPhonesForFallback({
      apiKey: 'test-key',
      timeoutMs: 1000,
      contactId: 'v1.abcdef1234567890',
      allowPhoneReveal: true,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.candidateStatus, 'error');
      assert.equal(result.errorCode, 'provider_permission_error');
      assert.equal(result.creditsCharged, null);
    }
  });

  test('402 → ok:true with error mapping (insufficient_credits)', async () => {
    mockFetchOnce(402, {});

    const result = await enrichLushaContactPhonesForFallback({
      apiKey: 'test-key',
      timeoutMs: 1000,
      contactId: 'v1.abcdef1234567890',
      allowPhoneReveal: true,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.candidateStatus, 'error');
      assert.equal(result.errorCode, 'insufficient_credits');
    }
  });

  test('timeout → ok:false with sanitized timeout message', async () => {
    mockFetchTimeout();

    const result = await enrichLushaContactPhonesForFallback({
      apiKey: 'test-key',
      timeoutMs: 5,
      contactId: 'v1.abcdef1234567890',
      allowPhoneReveal: true,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errorMessage.includes('timeout'));
    }
  });
});
