import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountProfileUpdate,
  type AccountProfileSnapshot,
  type HubSpotAccountProfileLoad,
} from '../hubspot-company-profile-sync.server';
import { mapHubSpotCompanyProfile } from '../hubspot-company-profile-mapping';

const EMPTY_ACCOUNT: AccountProfileSnapshot = {
  id: 'acc-1',
  owner_id: null,
  domain: 'byd-auto.cl',
  website: null,
  country: null,
  country_code: null,
  city: null,
  region: null,
  industry: null,
  company_size: null,
  tax_identifier: null,
  linkedin_url: null,
  metadata: {},
};

function profile(ownerUserId: string | null): Extract<HubSpotAccountProfileLoad, { status: 'found' }> {
  return {
    status: 'found',
    mapping: mapHubSpotCompanyProfile(
      { pais: 'Chile', industriaespecifica: 'Industria / Manufactura / Químicos / Automotor', numberofemployees: '300' },
      (c) => (c === 'Chile' ? 'CL' : null),
    ),
    hubspotOwnerUserId: ownerUserId,
  };
}

describe('buildAccountProfileUpdate', () => {
  it('empresa traída de HubSpot: llena industria, tamaño, país y el dueño de HubSpot', () => {
    const update = buildAccountProfileUpdate(EMPTY_ACCOUNT, profile('u-hs'), 'u-busca');
    assert.equal(update.ownerSource, 'hubspot_owner');
    assert.deepEqual(update.patch, {
      country: 'Chile',
      country_code: 'CL',
      industry: 'Industria / Manufactura / Químicos / Automotor',
      company_size: '300',
      owner_id: 'u-hs',
    });
  });

  it('sin dueño de HubSpot en SellUp, queda como responsable quien buscó', () => {
    const update = buildAccountProfileUpdate(EMPTY_ACCOUNT, profile(null), 'u-busca');
    assert.equal(update.patch.owner_id, 'u-busca');
    assert.equal(update.ownerSource, 'searcher');
  });

  it('HubSpot caído: igual asigna a quien buscó y no inventa datos', () => {
    const update = buildAccountProfileUpdate(EMPTY_ACCOUNT, null, 'u-busca');
    assert.deepEqual(update.patch, { owner_id: 'u-busca' });
  });

  it('nunca cambia un responsable que ya existe', () => {
    const update = buildAccountProfileUpdate({ ...EMPTY_ACCOUNT, owner_id: 'u-actual' }, profile('u-hs'), 'u-busca');
    assert.equal(update.patch.owner_id, undefined);
    assert.equal(update.ownerSource, null);
  });
});
