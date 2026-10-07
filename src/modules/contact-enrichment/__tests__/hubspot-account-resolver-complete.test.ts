import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOrCreateAccountForHubSpotCandidate,
  type HubSpotAccountResolutionDeps,
} from '../hubspot-account-resolver';

const INPUT = {
  hubspot_company_id: '58754366505',
  company_name: 'BYD Chile',
  company_domain: 'byd-auto.cl',
  run_id: null,
  country_code: 'CL',
};

function deps(over: Partial<HubSpotAccountResolutionDeps>, calls: Array<[string, string]>): HubSpotAccountResolutionDeps {
  return {
    findByHubspotId: async () => null,
    findByDomain: async () => null,
    createAccount: async () => ({ id: 'acc-new' }),
    linkHubspotId: async () => {},
    completeAccount: async (accountId, hubspotId) => {
      calls.push([accountId, hubspotId]);
    },
    ...over,
  };
}

describe('resolveOrCreateAccountForHubSpotCandidate · completar empresa (HUBSPOT-ACCOUNT-SYNC-1)', () => {
  it('empresa nueva: se completa con su ficha de HubSpot', async () => {
    const calls: Array<[string, string]> = [];
    const result = await resolveOrCreateAccountForHubSpotCandidate(INPUT, deps({}, calls));
    assert.ok(!('error' in result));
    assert.equal(result.outcome, 'created');
    assert.deepEqual(calls, [['acc-new', '58754366505']]);
  });

  it('empresa ya vinculada por ID: también se completa (sólo lo vacío lo decide el paso)', async () => {
    const calls: Array<[string, string]> = [];
    await resolveOrCreateAccountForHubSpotCandidate(INPUT, deps({ findByHubspotId: async () => ({ id: 'acc-1' }) }, calls));
    assert.deepEqual(calls, [['acc-1', '58754366505']]);
  });

  it('empresa encontrada por dominio con otro ID de HubSpot: se completa con SU ID', async () => {
    const calls: Array<[string, string]> = [];
    await resolveOrCreateAccountForHubSpotCandidate(
      INPUT,
      deps({ findByDomain: async () => ({ id: 'acc-2', hubspot_company_id: '111' }) }, calls),
    );
    assert.deepEqual(calls, [['acc-2', '111']]);
  });

  it('un fallo al completar no rompe la resolución', async () => {
    const result = await resolveOrCreateAccountForHubSpotCandidate(
      INPUT,
      deps({ completeAccount: async () => { throw new Error('HubSpot caído'); } }, []),
    );
    assert.ok(!('error' in result));
    assert.equal(result.accountId, 'acc-new');
  });
});
