import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccountHubSpotCompany } from '../hubspot-company-resolution-runtime';
import type { HubSpotCompanyResolutionDeps } from '../hubspot-company-resolution-runtime';

const ACCOUNT_ID = 'account-1';

function harness(
  over: {
    hubspotCompanyId?: string | null;
    matchStatus?: string;
    createOk?: boolean;
  } = {},
): { deps: HubSpotCompanyResolutionDeps; createCalls: unknown[]; updateCalls: unknown[] } {
  const createCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const deps: HubSpotCompanyResolutionDeps = {
    loadAccount: async () => ({
      id: ACCOUNT_ID,
      name: 'Empresa S.A.',
      domain: 'empresa.com',
      country: 'México',
      countryCode: 'MX',
      city: null,
      region: null,
      taxIdentifier: null,
      legalName: null,
      companySize: null,
      hubspotCompanyId: over.hubspotCompanyId ?? null,
      metadata: {},
    }),
    checkCompanyMatch: async () => ({
      hubspotMatchStatus: (over.matchStatus ?? 'no_match') as never,
      match: over.matchStatus === 'possible_match_requires_review'
        ? {
            hubspotCompanyId: 'hs-999',
            name: 'Empresa parecida SA',
            domain: null,
            matchMethod: 'name',
            confidence: 65,
            reason: 'Match por nombre con confianza baja (65%)',
          }
        : null,
    }),
    createCompany: async (input) => {
      createCalls.push(input);
      return over.createOk === false
        ? { ok: false, error: 'HUBSPOT_CREATE_ERROR' }
        : { ok: true, hubspotCompanyId: 'hs-new-1' };
    },
    updateAccount: async (accountId, patch) => {
      updateCalls.push({ accountId, patch });
    },
    nowIso: '2026-08-27T21:30:00.000Z',
  };
  return { deps, createCalls, updateCalls };
}

describe('resolveAccountHubSpotCompany', () => {
  it('ya tiene hubspot_company_id: no busca ni crea nada', async () => {
    const { deps, createCalls } = harness({ hubspotCompanyId: 'hs-existing' });
    const result = await resolveAccountHubSpotCompany(ACCOUNT_ID, deps);
    assert.equal(result.status, 'ready');
    assert.equal(result.hubspotCompanyId, 'hs-existing');
    assert.equal(createCalls.length, 0);
  });

  it('no_match: crea la empresa y actualiza la cuenta', async () => {
    const { deps, createCalls, updateCalls } = harness({ matchStatus: 'no_match' });
    const result = await resolveAccountHubSpotCompany(ACCOUNT_ID, deps);
    assert.equal(result.status, 'ready');
    assert.equal(result.hubspotCompanyId, 'hs-new-1');
    assert.equal(createCalls.length, 1);
    assert.equal(updateCalls.length, 1);
  });

  it('coincidencia confiable (cliente existente): bloquea, NO crea', async () => {
    const { deps, createCalls } = harness({ matchStatus: 'exact_match_customer' });
    const result = await resolveAccountHubSpotCompany(ACCOUNT_ID, deps);
    assert.equal(result.status, 'blocked');
    assert.equal(createCalls.length, 0);
  });

  it('coincidencia dudosa: pausa y escribe el pendiente, NO crea', async () => {
    const { deps, createCalls, updateCalls } = harness({
      matchStatus: 'possible_match_requires_review',
    });
    const result = await resolveAccountHubSpotCompany(ACCOUNT_ID, deps);
    assert.equal(result.status, 'pending_review');
    assert.equal(createCalls.length, 0);
    assert.equal(updateCalls.length, 1);
    const patch = (updateCalls[0] as { patch: Record<string, unknown> }).patch;
    assert.equal(patch.metadata && (patch.metadata as Record<string, unknown>).hubspot_sync_status, 'pending_match_review');
  });

  it('la creación falla: reporta fallo, no lanza', async () => {
    const { deps } = harness({ matchStatus: 'no_match', createOk: false });
    const result = await resolveAccountHubSpotCompany(ACCOUNT_ID, deps);
    assert.equal(result.status, 'failed');
    assert.equal('reason' in result && result.reason, 'HUBSPOT_CREATE_ERROR');
  });

  it('possible_match_requires_review sin match (inconsistencia defensiva): bloquea, no lanza', async () => {
    const deps = { ...harness().deps };
    deps.checkCompanyMatch = async () => ({
      hubspotMatchStatus: 'possible_match_requires_review' as never,
      match: null,
    });
    const result = await resolveAccountHubSpotCompany(ACCOUNT_ID, deps);
    assert.equal(result.status, 'blocked');
  });
});
