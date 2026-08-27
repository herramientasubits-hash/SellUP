import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ensureHubSpotSellUpCreatedProperty } from '../hubspot-property-ensure';

describe('ensureHubSpotSellUpCreatedProperty — idempotente, fail-closed', () => {
  it('si la propiedad YA existe (GET 200), no llama a POST', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return { ok: true, status: 200, json: async () => ({ name: 'sellup_created' }) } as Response;
    };
    const result = await ensureHubSpotSellUpCreatedProperty('contacts', {
      token: 'tok',
      fetchImpl,
    });
    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    assert.deepEqual(calls, ['GET https://api.hubapi.com/crm/v3/properties/contacts/sellup_created']);
  });

  it('si NO existe (GET 404), la crea con POST', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if ((init?.method ?? 'GET') === 'GET') {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return { ok: true, status: 201, json: async () => ({ name: 'sellup_created' }) } as Response;
    };
    const result = await ensureHubSpotSellUpCreatedProperty('companies', {
      token: 'tok',
      fetchImpl,
    });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.deepEqual(calls, [
      'GET https://api.hubapi.com/crm/v3/properties/companies/sellup_created',
      'POST https://api.hubapi.com/crm/v3/properties/companies',
    ]);
  });

  it('sin permiso de esquema (POST 403), no lanza y reporta el motivo', async () => {
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return { ok: false, status: 403, json: async () => ({ message: 'missing scope' }) } as Response;
    };
    const result = await ensureHubSpotSellUpCreatedProperty('contacts', { token: 'tok', fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'HUBSPOT_PROPERTY_CREATE_HTTP_403');
  });

  it('sin token, falla cerrado sin llamar a fetch', async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    };
    const result = await ensureHubSpotSellUpCreatedProperty('contacts', {
      token: null,
      fetchImpl,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'TOKEN_UNAVAILABLE');
    assert.equal(called, false);
  });

  it('si fetchImpl LANZA (error de red), no propaga y reporta el motivo', async () => {
    const fetchImpl = async () => {
      throw new Error('ECONNRESET');
    };
    const result = await ensureHubSpotSellUpCreatedProperty('contacts', { token: 'tok', fetchImpl });
    assert.equal(result.ok, false);
    assert.equal('reason' in result && result.reason.includes('ECONNRESET'), true);
  });
});
