/**
 * AGENT1-HUBSPOT-NON-OK-IS-UNCHECKED-1 · AGENT1-SELLUP-CHECK-ERRORS-PROPAGATE-1 ·
 * AGENT1-NORMALIZED-NAME-LOOKUP-1 · AGENT1-ILIKE-ESCAPE-1 — una comprobación de
 * duplicados que NO pudo mirar nunca dice «empresa nueva».
 *
 * Sin red real: `fetch` se sustituye por un enrutador que responde a Supabase
 * (`supabase.test`) y a HubSpot (`api.hubapi.com`). 0 proveedores, 0 créditos.
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkHubSpotDuplicates, resolveHubSpotStatus } from '../hubspot-duplicate-checker';
import { checkSellUpDuplicates, SellUpDuplicateCheckError } from '../sellup-duplicate-checker';
import { checkCompanyDuplicate } from '../duplicate-checker';

type Route = (url: URL, init: RequestInit | undefined) => Response | null;

/**
 * supabase-js 2 exige `WebSocket` nativo para crear un cliente (Node ≥ 22; el CI
 * corre en Node 24). En Node 20 el cliente lanza al crearse y esta suite no puede
 * medir nada: se salta con el motivo, no se da por buena.
 */
const SKIP_WITHOUT_WEBSOCKET =
  typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined'
    ? 'supabase-js exige WebSocket nativo (Node ≥ 22); el CI corre en Node 24'
    : false;

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let seenUrls: URL[] = [];

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Supabase con HubSpot conectado y `accounts` vacío, salvo que una ruta lo cambie. */
function installFetch(routes: Route[], opts: { hubspotConnected?: boolean } = {}) {
  seenUrls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    seenUrls.push(url);
    for (const route of routes) {
      const res = route(url, init);
      if (res) return res;
    }
    if (url.hostname === 'supabase.test') {
      if (url.pathname.endsWith('/external_integrations')) {
        return opts.hubspotConnected === false ? json({}, 406) : json({ id: 'int-1' });
      }
      if (url.pathname.endsWith('/external_integration_connections')) {
        return json({ connection_status: 'connected', credentials_status: 'stored' });
      }
      if (url.pathname.endsWith('/rpc/get_vault_secret_decrypted')) return json('token-de-prueba');
      if (url.pathname.endsWith('/accounts')) return json([]);
    }
    if (url.hostname === 'api.hubapi.com') return json({ results: [] });
    throw new Error(`fetch inesperado: ${url.href}`);
  }) as typeof fetch;
}

const hubspotSearch = (status: number, headers: Record<string, string> = {}): Route => (url) =>
  url.hostname === 'api.hubapi.com' && url.pathname.endsWith('/companies/search')
    ? json({ message: 'x' }, status, headers)
    : null;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-prueba';
  delete process.env.ENABLE_HUBSPOT_FREE_POOL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('HubSpot no-OK ⇒ error, nunca «sin coincidencias»', { skip: SKIP_WITHOUT_WEBSOCKET }, () => {
  for (const [label, status, headers] of [
    ['503', 503, {}],
    ['401 (token vencido)', 401, {}],
    ['429 tras los reintentos', 429, { 'retry-after': '0' }],
  ] as const) {
    it(`🔴 ${label} en la búsqueda por dominio`, async () => {
      installFetch([hubspotSearch(status, headers)]);
      const outcome = await checkHubSpotDuplicates({ name: 'Acme', domain: 'acme.com' });
      assert.equal(outcome.connected, true);
      assert.match(outcome.error ?? '', new RegExp(`HTTP ${status}`));
      assert.equal(resolveHubSpotStatus(outcome).status, 'error', 'antes: new_candidate (85)');
    });
  }

  it('🔴 la búsqueda fiscal con 400 y respaldo 500 también es error', async () => {
    let calls = 0;
    installFetch([
      (url) => {
        if (url.hostname !== 'api.hubapi.com') return null;
        calls += 1;
        return json({}, calls === 1 ? 400 : 500);
      },
    ]);
    const outcome = await checkHubSpotDuplicates({ name: 'Acme', taxIdentifier: '900123456-7', countryCode: 'CO' });
    assert.match(outcome.error ?? '', /HTTP 500/);
  });

  it('🔴 checkCompanyDuplicate con HubSpot caído termina en error (no new_candidate)', async () => {
    installFetch([hubspotSearch(503)]);
    const result = await checkCompanyDuplicate({ name: 'Acme', domain: 'acme.com', countryCode: 'CO' });
    assert.equal(result.status, 'error');
  });

  it('HubSpot respondiendo bien y sin coincidencias sigue siendo new_candidate', async () => {
    installFetch([]);
    const result = await checkCompanyDuplicate({ name: 'Acme', domain: 'acme.com', countryCode: 'CO' });
    assert.equal(result.status, 'new_candidate');
  });
});

describe('SellUp con lectura fallida ⇒ error', { skip: SKIP_WITHOUT_WEBSOCKET }, () => {
  const accountsFail: Route = (url) =>
    url.hostname === 'supabase.test' && url.pathname.endsWith('/accounts') ? json({ code: '57014', message: 'timeout' }, 500) : null;

  it('🔴 checkSellUpDuplicates LANZA (antes: seguía como si no hubiera coincidencia)', async () => {
    installFetch([accountsFail]);
    await assert.rejects(
      checkSellUpDuplicates({ name: 'Acme', domain: 'acme.com', countryCode: 'CO' }),
      (err: unknown) => err instanceof SellUpDuplicateCheckError && err.axis === 'domain',
    );
  });

  it('🔴 SellUp caído + HubSpot sin coincidencias ⇒ error, no new_candidate', async () => {
    installFetch([accountsFail]);
    const result = await checkCompanyDuplicate({ name: 'Acme', domain: 'acme.com', countryCode: 'CO' });
    assert.equal(result.status, 'error');
    assert.ok((result.errors ?? []).some((e) => e.includes('SellUp')));
  });

  it('🔴 SellUp caído + HubSpot NO conectado ⇒ error (no «unchecked», que el corredor no lee como degradado)', async () => {
    installFetch([accountsFail], { hubspotConnected: false });
    const result = await checkCompanyDuplicate({ name: 'Acme', domain: 'acme.com', countryCode: 'CO' });
    assert.equal(result.status, 'error');
  });
});

describe('búsqueda por nombre en SellUp', { skip: SKIP_WITHOUT_WEBSOCKET }, () => {
  it('🔴 busca la forma GUARDADA con sufijo («acme s a s») además de «acme»', async () => {
    installFetch([]);
    await checkSellUpDuplicates({ name: 'Acme S.A.S.', countryCode: 'CO' });
    const nameQuery = seenUrls.find((u) => u.searchParams.get('normalized_name'));
    assert.ok(nameQuery, 'hubo consulta por normalized_name');
    const filter = nameQuery.searchParams.get('normalized_name') ?? '';
    assert.match(filter, /^in\./);
    assert.ok(filter.includes('acme s a s') && filter.includes('acme'), filter);
  });

  it('🔴 un nombre con % se busca literal en ilike', async () => {
    installFetch([]);
    await checkSellUpDuplicates({ name: '100% Natural', countryCode: 'CO' });
    const ilike = seenUrls.map((u) => u.searchParams.get('name')).find((v) => v?.startsWith('ilike.'));
    assert.equal(ilike, 'ilike.%100\\% Natural%');
  });
});
