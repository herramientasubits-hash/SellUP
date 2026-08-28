import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureHubSpotSellUpCreatedPropertyCached,
  resetHubSpotPropertyEnsureCacheForTests,
} from '../hubspot-property-ensure-cache';

describe('ensureHubSpotSellUpCreatedPropertyCached', () => {
  // El Set del caché es estado module-level compartido entre tests de este archivo (node --test
  // no reimporta el módulo por test). Se resetea explícitamente antes de cada test para que el
  // orden de ejecución no importe y ningún test dependa de un `objectType` distinto sólo para
  // evitar contaminación.
  beforeEach(() => {
    resetHubSpotPropertyEnsureCacheForTests();
  });

  it('sólo llama a fetchImpl UNA vez por tipo de objeto tras confirmar éxito', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    };

    const first = await ensureHubSpotSellUpCreatedPropertyCached('contacts', {
      token: 'tok',
      fetchImpl,
    });
    const second = await ensureHubSpotSellUpCreatedPropertyCached('contacts', {
      token: 'tok',
      fetchImpl,
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(calls, 1, 'la segunda llamada NO debe tocar fetchImpl');
  });

  it('un fallo NUNCA se cachea: el siguiente intento vuelve a intentar la red', async () => {
    let calls = 0;
    const failingFetch = async () => {
      calls += 1;
      return { ok: false, status: 403, json: async () => ({}) } as Response;
    };

    const first = await ensureHubSpotSellUpCreatedPropertyCached('companies', {
      token: 'tok',
      fetchImpl: failingFetch,
    });
    const second = await ensureHubSpotSellUpCreatedPropertyCached('companies', {
      token: 'tok',
      fetchImpl: failingFetch,
    });

    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.equal(calls, 2, 'un fallo no cachea: cada intento vuelve a tocar la red');
  });

  it('el caché es POR TIPO DE OBJETO: confirmar contacts no exime a companies', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    };

    await ensureHubSpotSellUpCreatedPropertyCached('contacts', { token: 'tok', fetchImpl });
    await ensureHubSpotSellUpCreatedPropertyCached('companies', { token: 'tok', fetchImpl });

    assert.equal(calls, 2, 'cada tipo de objeto debe confirmarse por separado');
  });
});
