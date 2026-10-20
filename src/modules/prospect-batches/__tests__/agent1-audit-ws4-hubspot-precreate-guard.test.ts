/**
 * AGENT1-AUDIT-WS4 — guarda única antes de crear en HubSpot + creación con tope
 * de espera, reintento SÓLO ante 429 y metadata de propiedades en caché.
 *
 * Defecto que cierra: la aprobación actual creaba la empresa en HubSpot sin las
 * guardas de la conversión antigua (liquidación/inactividad + búsqueda en vivo
 * justo antes del POST), con `fetch` sin tope ni reintento, y leyendo la
 * metadata de propiedades en cada aprobación.
 *
 * Sin red: `fetch` inyectado. Sin env.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { hasLiquidationOrInactiveSignal, runHubSpotPreCreateGuard } from '../hubspot-precreate-guard';
import {
  createHubSpotCompany,
  getHubSpotCompanyPropertiesMetadata,
  HUBSPOT_PROPERTIES_METADATA_TTL_MS,
  resetHubSpotCompanyPropertiesMetadataCache,
  searchHubSpotCompaniesBeforeCreate,
  type HubSpotPreCreateLiveCheck,
} from '@/server/integrations/hubspot-company-create';
import { resetHubSpotPropertyEnsureCacheForTests } from '@/server/integrations/hubspot-property-ensure-cache';

const BASE = { name: 'Acme SAS', domain: 'acme.co', taxIdentifier: '900123456-7', countryCode: 'CO' };

const live = (result: HubSpotPreCreateLiveCheck) => ({ liveDuplicateCheck: async () => result });

describe('runHubSpotPreCreateGuard', () => {
  it('liquidación en el nombre o en la razón social ⇒ no se crea, ni se consulta HubSpot', async () => {
    let called = false;
    const ports = {
      liveDuplicateCheck: async (): Promise<HubSpotPreCreateLiveCheck> => {
        called = true;
        return { status: 'no_match' };
      },
    };
    const byName = await runHubSpotPreCreateGuard({ ...BASE, name: 'ACME SAS EN LIQUIDACION' }, ports);
    assert.deepEqual(byName, { allowed: false, syncStatus: 'blocked_inactive_or_liquidation', reason: 'inactive_or_liquidation_signal' });
    const byLegal = await runHubSpotPreCreateGuard({ ...BASE, legalName: 'Acme S.A.S. Disuelta' }, ports);
    assert.equal(byLegal.allowed, false);
    const byFlag = await runHubSpotPreCreateGuard({ ...BASE, candidateReviewFlags: ['inactive_company'] }, ports);
    assert.equal(byFlag.allowed, false);
    assert.equal(called, false);
  });

  it('sólo un no_match explícito deja crear', async () => {
    assert.deepEqual(await runHubSpotPreCreateGuard(BASE, live({ status: 'no_match' })), { allowed: true });
  });

  it('coincidencia en vivo ⇒ blocked_duplicate con las fichas', async () => {
    const out = await runHubSpotPreCreateGuard(BASE, live({ status: 'match', companyIds: ['1'], matchedBy: ['domain'] }));
    assert.deepEqual(out, {
      allowed: false,
      syncStatus: 'blocked_duplicate',
      reason: 'hubspot_live_match',
      companyIds: ['1'],
      matchedBy: ['domain'],
    });
  });

  it('error, excepción o respuesta dudosa ⇒ failed_lookup (nunca «crear a ciegas»)', async () => {
    const failed = await runHubSpotPreCreateGuard(BASE, live({ status: 'lookup_failed', error: 'search_http_500' }));
    assert.equal(failed.allowed, false);
    assert.equal(failed.allowed === false && failed.syncStatus, 'failed_lookup');
    const threw = await runHubSpotPreCreateGuard(BASE, {
      liveDuplicateCheck: async () => {
        throw new Error('red caída');
      },
    });
    assert.equal(threw.allowed === false && threw.syncStatus, 'failed_lookup');
    const weird = await runHubSpotPreCreateGuard(BASE, {
      liveDuplicateCheck: async () => ({ status: 'maybe' }) as unknown as HubSpotPreCreateLiveCheck,
    });
    assert.equal(weird.allowed === false && weird.syncStatus, 'failed_lookup');
  });

  it('hasLiquidationOrInactiveSignal mantiene las señales de siempre', () => {
    assert.equal(hasLiquidationOrInactiveSignal('Empresa Liquidada'), true);
    assert.equal(hasLiquidationOrInactiveSignal('Empresa Sana', null, ['possible_inactive']), true);
    assert.equal(hasLiquidationOrInactiveSignal('Empresa Sana', ['otra'], null), false);
  });
});

type Call = { method: string; url: string; body: unknown };

function jsonRes(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers });
}

const TAX_PROPS = [{ name: 'identificaci_n_fiscal', label: 'Identificación Fiscal (NIT - RFC - RUC)', fieldType: 'text', type: 'string' }];

function fakeSearch(handler: (body: Record<string, unknown>) => Response) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    if (url.endsWith('/crm/v3/properties/companies')) return jsonRes({ results: TAX_PROPS });
    if (url.endsWith('/crm/v3/objects/companies/search')) return handler(body);
    return jsonRes({}, 404);
  }) as typeof fetch;
  return { calls, fetchFn };
}

const noSleep = async () => {};

describe('searchHubSpotCompaniesBeforeCreate', () => {
  beforeEach(() => resetHubSpotCompanyPropertiesMetadataCache());

  it('sin coincidencias ⇒ no_match (dominio, fiscal en la propiedad del portal y nombre)', async () => {
    const hs = fakeSearch(() => jsonRes({ results: [] }));
    const out = await searchHubSpotCompaniesBeforeCreate(BASE, { fetchFn: hs.fetchFn, resolveToken: async () => 't', sleep: noSleep });
    assert.deepEqual(out, { status: 'no_match' });
    const searches = hs.calls.filter((c) => c.url.endsWith('/search')).map((c) => c.body as Record<string, unknown>);
    assert.equal(searches.length, 3);
    assert.deepEqual(searches[0].filterGroups, [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: 'acme.co' }] }]);
    // NIT de Colombia: crudo y sin dígito de verificación, en la propiedad fiscal del portal.
    assert.deepEqual(searches[1].filterGroups, [
      { filters: [{ propertyName: 'identificaci_n_fiscal', operator: 'EQ', value: '900123456-7' }] },
      { filters: [{ propertyName: 'identificaci_n_fiscal', operator: 'EQ', value: '900123456' }] },
    ]);
    assert.equal(searches[2].query, 'Acme SAS');
  });

  it('un nombre parecido NO es coincidencia; el mismo nombre normalizado sí', async () => {
    const fuzzy = fakeSearch((body) =>
      body.query ? jsonRes({ results: [{ id: '7', properties: { name: 'Acme Logística' } }] }) : jsonRes({ results: [] }),
    );
    assert.deepEqual(
      await searchHubSpotCompaniesBeforeCreate(BASE, { fetchFn: fuzzy.fetchFn, resolveToken: async () => 't', sleep: noSleep }),
      { status: 'no_match' },
    );
    const same = fakeSearch((body) =>
      body.query ? jsonRes({ results: [{ id: '8', properties: { name: 'ACME S.A.S.' } }] }) : jsonRes({ results: [] }),
    );
    assert.deepEqual(
      await searchHubSpotCompaniesBeforeCreate(BASE, { fetchFn: same.fetchFn, resolveToken: async () => 't', sleep: noSleep }),
      { status: 'match', companyIds: ['8'], matchedBy: ['name'] },
    );
  });

  it('dominio exacto ⇒ match', async () => {
    const hs = fakeSearch((body) =>
      Array.isArray(body.filterGroups) && JSON.stringify(body.filterGroups).includes('"domain"')
        ? jsonRes({ results: [{ id: '5', properties: { name: 'Otra razón' } }] })
        : jsonRes({ results: [] }),
    );
    const out = await searchHubSpotCompaniesBeforeCreate(BASE, { fetchFn: hs.fetchFn, resolveToken: async () => 't', sleep: noSleep });
    assert.deepEqual(out, { status: 'match', companyIds: ['5'], matchedBy: ['domain'] });
  });

  it('respuesta no-OK ⇒ lookup_failed (antes los lectores la leían como «no existe»)', async () => {
    const hs = fakeSearch(() => jsonRes({}, 500));
    const out = await searchHubSpotCompaniesBeforeCreate(BASE, { fetchFn: hs.fetchFn, resolveToken: async () => 't', sleep: noSleep });
    assert.deepEqual(out, { status: 'lookup_failed', error: 'search_http_500' });
  });

  it('429 se reintenta y, si luego responde, sigue', async () => {
    let first = true;
    const hs = fakeSearch(() => {
      if (first) {
        first = false;
        return jsonRes({}, 429, { 'retry-after': '0' });
      }
      return jsonRes({ results: [] });
    });
    const out = await searchHubSpotCompaniesBeforeCreate(BASE, { fetchFn: hs.fetchFn, resolveToken: async () => 't', sleep: noSleep });
    assert.deepEqual(out, { status: 'no_match' });
  });

  it('sin credencial ⇒ lookup_failed', async () => {
    const hs = fakeSearch(() => jsonRes({ results: [] }));
    const out = await searchHubSpotCompaniesBeforeCreate(BASE, { fetchFn: hs.fetchFn, resolveToken: async () => null });
    assert.deepEqual(out, { status: 'lookup_failed', error: 'token_unavailable' });
    assert.equal(hs.calls.length, 0);
  });
});

describe('createHubSpotCompany — reintento sólo ante 429, metadata en caché', () => {
  beforeEach(() => {
    resetHubSpotCompanyPropertiesMetadataCache();
    resetHubSpotPropertyEnsureCacheForTests();
  });

  function fakeCreate(postResponses: Array<() => Response | Promise<Response>>) {
    const calls: Call[] = [];
    let post = 0;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('/crm/v3/properties/companies/sellup_created')) return jsonRes({ name: 'sellup_created' });
      if (url.endsWith('/crm/v3/properties/companies') && method === 'GET') return jsonRes({ results: TAX_PROPS });
      if (url.endsWith('/crm/v3/objects/companies') && method === 'POST') {
        const respond = postResponses[Math.min(post, postResponses.length - 1)];
        post += 1;
        return respond();
      }
      return jsonRes({}, 404);
    }) as typeof fetch;
    return { calls, fetchFn, posts: () => post };
  }

  it('un 429 en el POST se reintenta (HubSpot no la procesó) y crea una sola vez', async () => {
    const hs = fakeCreate([() => jsonRes({}, 429, { 'retry-after': '0' }), () => jsonRes({ id: 'hs-1' }, 201)]);
    const out = await createHubSpotCompany({ name: 'Acme' }, { fetchFn: hs.fetchFn, resolveToken: async () => 't', sleep: noSleep });
    assert.equal(out.ok, true);
    assert.equal(out.hubspotCompanyId, 'hs-1');
    assert.equal(hs.posts(), 2);
  });

  it('un tope vencido / error de red en el POST NO se reintenta (podría duplicar)', async () => {
    const hs = fakeCreate([
      () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
    ]);
    const out = await createHubSpotCompany({ name: 'Acme' }, { fetchFn: hs.fetchFn, resolveToken: async () => 't', sleep: noSleep });
    assert.equal(out.ok, false);
    assert.equal(hs.posts(), 1);
  });

  it('la metadata de propiedades se lee una vez y se reutiliza dentro del TTL', async () => {
    let now = 1_000_000;
    const hs = fakeCreate([() => jsonRes({ id: 'hs-1' }, 201)]);
    const opts = { fetchFn: hs.fetchFn, now: () => now };
    await getHubSpotCompanyPropertiesMetadata('t', opts);
    await getHubSpotCompanyPropertiesMetadata('t', opts);
    const reads = () => hs.calls.filter((c) => c.url.endsWith('/crm/v3/properties/companies') && c.method === 'GET').length;
    assert.equal(reads(), 1);
    now += HUBSPOT_PROPERTIES_METADATA_TTL_MS + 1;
    await getHubSpotCompanyPropertiesMetadata('t', opts);
    assert.equal(reads(), 2);
  });

  it('una lectura vacía o fallida de la metadata no se guarda', async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return jsonRes({}, 500);
    }) as unknown as typeof fetch;
    assert.deepEqual(await getHubSpotCompanyPropertiesMetadata('t', { fetchFn }), []);
    assert.deepEqual(await getHubSpotCompanyPropertiesMetadata('t', { fetchFn }), []);
    assert.equal(calls, 2);
  });
});
