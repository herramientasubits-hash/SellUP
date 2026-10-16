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

  // ALWAYS-OWNER-ON-CREATE-1 — la empresa recién creada ya nace con responsable
  // (quien buscó). Ese responsable es provisional: el dueño de HubSpot manda.
  it('empresa recién creada con responsable provisional: manda el dueño de HubSpot', () => {
    const update = buildAccountProfileUpdate(
      { ...EMPTY_ACCOUNT, owner_id: 'u-busca' },
      profile('u-hs'),
      'u-busca',
      { ownerIsProvisional: true },
    );
    assert.equal(update.patch.owner_id, 'u-hs');
    assert.equal(update.ownerSource, 'hubspot_owner');
  });

  it('empresa recién creada sin dueño de HubSpot: se queda quien la creó/buscó', () => {
    const update = buildAccountProfileUpdate(
      { ...EMPTY_ACCOUNT, owner_id: 'u-busca' },
      profile(null),
      'u-busca',
      { ownerIsProvisional: true },
    );
    assert.equal(update.patch.owner_id, undefined);
  });

  it('responsable provisional igual al de HubSpot: no reescribe nada', () => {
    const update = buildAccountProfileUpdate(
      { ...EMPTY_ACCOUNT, owner_id: 'u-hs' },
      profile('u-hs'),
      'u-busca',
      { ownerIsProvisional: true },
    );
    assert.equal(update.patch.owner_id, undefined);
    assert.equal(update.ownerSource, null);
  });
  // AUDIT-HARDENING-1 — empresa libre en HubSpot (Recycled con el vendedor anterior)
  // cuya toma no se escribió: el dueño viejo de HubSpot no le quita la empresa a
  // quien la aprobó.
  it('empresa libre sin toma escrita: el dueño anterior de HubSpot no manda', () => {
    const update = buildAccountProfileUpdate(
      { ...EMPTY_ACCOUNT, owner_id: 'u-busca' },
      profile('u-anterior'),
      'u-busca',
      { ownerIsProvisional: true, ignoreHubSpotOwner: true },
    );
    assert.equal(update.patch.owner_id, undefined);
    assert.equal(update.ownerSource, null);
  });

  it('empresa libre sin responsable: queda quien buscó, no el dueño anterior', () => {
    const update = buildAccountProfileUpdate(EMPTY_ACCOUNT, profile('u-anterior'), 'u-busca', {
      ignoreHubSpotOwner: true,
    });
    assert.equal(update.patch.owner_id, 'u-busca');
  });
});
