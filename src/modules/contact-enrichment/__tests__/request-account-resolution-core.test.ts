/**
 * Tests — AGENT2A-HUBSPOT-ID-RESOLUTION: la cuenta SellUp se resuelve al crear la
 * request, no al aprobar el primer candidato. 0 Supabase, 0 red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveAccountForEnrichmentRequest,
  ACCOUNT_CREATION_NOT_ALLOWED,
} from '../request-account-resolution-core';
import type { HubSpotAccountResolutionDeps } from '../hubspot-account-resolver';

const HS_ID = '52817179673';

function fakeDeps(state: {
  byHubspot?: { id: string } | null;
  byDomain?: { id: string; hubspot_company_id: string | null } | null;
  createError?: string;
  throwOn?: 'findByHubspotId';
} = {}) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const deps: HubSpotAccountResolutionDeps = {
    findByHubspotId: async (hid) => {
      calls.push({ fn: 'findByHubspotId', args: hid });
      if (state.throwOn === 'findByHubspotId') throw new Error('db down');
      return state.byHubspot ?? null;
    },
    findByDomain: async (domain) => {
      calls.push({ fn: 'findByDomain', args: domain });
      return state.byDomain ?? null;
    },
    createAccount: async (input) => {
      calls.push({ fn: 'createAccount', args: input });
      return state.createError ? { error: state.createError } : { id: 'acc-new' };
    },
    linkHubspotId: async (accountId, hid) => {
      calls.push({ fn: 'linkHubspotId', args: { accountId, hid } });
    },
    updateAccountCountryCode: async (accountId, cc) => {
      calls.push({ fn: 'updateAccountCountryCode', args: { accountId, cc } });
    },
  };
  return { deps, calls };
}

const HUBSPOT_PIZZA = {
  source: 'hubspot' as const,
  hubspotCompanyId: HS_ID,
  name: 'Pizza Pizza',
  domain: 'www.pizzapizza.cl',
  countryCode: 'CL',
};

describe('resolveAccountForEnrichmentRequest', () => {
  it('empresa de HubSpot sin cuenta: crea la cuenta con nombre, dominio normalizado y país', async () => {
    const { deps, calls } = fakeDeps();
    const r = await resolveAccountForEnrichmentRequest(HUBSPOT_PIZZA, deps);

    assert.deepEqual(r, { accountId: 'acc-new', outcome: 'created' });
    const create = calls.find((c) => c.fn === 'createAccount')!.args as Record<string, unknown>;
    assert.equal(create.name, 'Pizza Pizza');
    assert.equal(create.domain, 'pizzapizza.cl');
    assert.equal(create.website, 'https://pizzapizza.cl');
    assert.equal(create.hubspot_company_id, HS_ID);
    assert.equal(create.country_code, 'CL');
  });

  it('reutiliza la cuenta ya vinculada al Company ID (no crea otra)', async () => {
    const { deps, calls } = fakeDeps({ byHubspot: { id: 'acc-existing' } });
    const r = await resolveAccountForEnrichmentRequest(HUBSPOT_PIZZA, deps);
    assert.deepEqual(r, { accountId: 'acc-existing', outcome: 'existing_by_hubspot' });
    assert.ok(!calls.some((c) => c.fn === 'createAccount'));
  });

  it('cuenta existente por dominio sin ID: la vincula al Company ID', async () => {
    const { deps, calls } = fakeDeps({ byDomain: { id: 'acc-dom', hubspot_company_id: null } });
    const r = await resolveAccountForEnrichmentRequest(HUBSPOT_PIZZA, deps);
    assert.deepEqual(r, { accountId: 'acc-dom', outcome: 'existing_by_domain_linked' });
    assert.deepEqual(calls.find((c) => c.fn === 'linkHubspotId')!.args, { accountId: 'acc-dom', hid: HS_ID });
  });

  it('ya trae cuenta SellUp: no toca nada', async () => {
    const { deps, calls } = fakeDeps();
    const r = await resolveAccountForEnrichmentRequest(
      { ...HUBSPOT_PIZZA, source: 'sellup', sellupAccountId: 'acc-1' },
      deps,
    );
    assert.deepEqual(r, { accountId: 'acc-1', outcome: 'already_linked' });
    assert.equal(calls.length, 0);
  });

  it('sin Company ID: no aplica (flujo anterior intacto)', async () => {
    const { deps, calls } = fakeDeps();
    const r = await resolveAccountForEnrichmentRequest(
      { source: 'manual', name: 'Tostadas charras', domain: 'charras.com' },
      deps,
    );
    assert.deepEqual(r, { accountId: null, outcome: 'not_applicable' });
    assert.equal(calls.length, 0);
  });

  it('empresa manual con ID tecleado: vincula si existe, pero NUNCA crea una cuenta', async () => {
    const { deps, calls } = fakeDeps();
    const r = await resolveAccountForEnrichmentRequest(
      { source: 'manual', hubspotCompanyId: HS_ID, name: HS_ID },
      deps,
    );
    assert.equal(r.accountId, null);
    assert.equal(r.outcome, 'failed');
    assert.equal((r as { reason: string }).reason, ACCOUNT_CREATION_NOT_ALLOWED);
    assert.ok(!calls.some((c) => c.fn === 'createAccount'));

    const linked = fakeDeps({ byHubspot: { id: 'acc-existing' } });
    const r2 = await resolveAccountForEnrichmentRequest(
      { source: 'manual', hubspotCompanyId: HS_ID, name: HS_ID },
      linked.deps,
    );
    assert.deepEqual(r2, { accountId: 'acc-existing', outcome: 'existing_by_hubspot' });
  });

  it('nunca bloquea: un fallo de base de datos devuelve accountId null', async () => {
    const { deps } = fakeDeps({ throwOn: 'findByHubspotId' });
    const r = await resolveAccountForEnrichmentRequest(HUBSPOT_PIZZA, deps);
    assert.equal(r.accountId, null);
    assert.equal(r.outcome, 'failed');
  });

  it('país en texto libre no se escribe en country_code', async () => {
    const { deps, calls } = fakeDeps();
    await resolveAccountForEnrichmentRequest({ ...HUBSPOT_PIZZA, countryCode: 'Chile' }, deps);
    const create = calls.find((c) => c.fn === 'createAccount')!.args as Record<string, unknown>;
    assert.equal(create.country_code, null);
  });
});
