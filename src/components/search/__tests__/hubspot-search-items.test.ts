/**
 * Resultados de HubSpot en la búsqueda general: a qué grupo van y qué abren.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HUBSPOT_SEARCH_GROUP, hubspotSearchItems } from '../hubspot-search-items';
import { readHubSpotParam } from '@/modules/hubspot-lookup/types';
import type { HubSpotCompanyHit, HubSpotContactHit } from '@/modules/hubspot-lookup/types';

const company = (over: Partial<HubSpotCompanyHit>): HubSpotCompanyHit => ({
  id: '100',
  name: 'ARCOR Chile',
  domain: 'arcor.cl',
  website: 'https://arcor.cl',
  country: 'Chile',
  city: null,
  region: null,
  industry: 'Consumo Masivo',
  employees: null,
  taxId: null,
  ownerId: null,
  lifecycle: null,
  phone: null,
  linkedinUrl: null,
  description: null,
  createdAt: null,
  lastActivityAt: null,
  contactsCount: null,
  sellup: { status: 'none' },
  ownerName: null,
  ...over,
});

const contact = (over: Partial<HubSpotContactHit>): HubSpotContactHit => ({
  id: '200',
  fullName: 'Ana Acosta',
  firstName: 'Ana',
  lastName: 'Acosta',
  email: 'ana@arcor.cl',
  phone: null,
  mobilePhone: null,
  jobTitle: 'Gerente',
  companyName: 'ARCOR Chile',
  companyId: '100',
  linkedinUrl: null,
  ownerId: null,
  lifecycle: null,
  city: null,
  country: null,
  createdAt: null,
  lastActivityAt: null,
  sellup: { status: 'none' },
  ownerName: null,
  ...over,
});

describe('resultados de HubSpot en la búsqueda general', () => {
  it('lo que no está en SellUp va a «En HubSpot» y abre la consulta', () => {
    const opened: string[] = [];
    const [c, p] = hubspotSearchItems([company({})], [contact({})], (kind, id) => opened.push(`${kind}:${id}`));
    assert.equal(c.group, HUBSPOT_SEARCH_GROUP);
    assert.equal(c.href, '/accounts?hubspot=100');
    assert.equal(c.actionLabel, 'Consultar');
    assert.equal(p.group, HUBSPOT_SEARCH_GROUP);
    assert.equal(p.href, '/contacts?hubspot=200');
    c.onSelect?.();
    p.onSelect?.();
    assert.deepEqual(opened, ['company:100', 'contact:200']);
  });

  it('lo que ya está en SellUp (y se puede abrir) va a su grupo con el mismo id que la lista', () => {
    const [c, p] = hubspotSearchItems(
      [company({ sellup: { status: 'visible', id: 'acc-1' } })],
      [contact({ sellup: { status: 'visible', id: 'con-1' } })],
    );
    assert.equal(c.id, 'account-acc-1');
    assert.equal(c.group, 'Empresas');
    assert.equal(c.href, '/accounts/acc-1');
    assert.equal(p.id, 'contact-con-1');
    assert.equal(p.group, 'Contactos');
  });

  it('si la lleva otra persona, se consulta y se dice quién', () => {
    const [c] = hubspotSearchItems([company({ sellup: { status: 'other_owner', ownerName: 'Carla Reyes' } })], []);
    assert.equal(c.group, HUBSPOT_SEARCH_GROUP);
    assert.ok(c.meta?.includes('En SellUp la lleva Carla Reyes'));
  });
});

describe('?hubspot= en la dirección', () => {
  it('lee el id y devuelve la dirección sin él', () => {
    assert.deepEqual(readHubSpotParam('?hubspot=123&vista=lista'), { hubspotId: '123', rest: '?vista=lista' });
    assert.deepEqual(readHubSpotParam('?hubspot=123'), { hubspotId: '123', rest: '' });
  });

  it('ignora lo que no es un id de HubSpot', () => {
    assert.equal(readHubSpotParam('?hubspot=<script>').hubspotId, null);
    assert.equal(readHubSpotParam('').hubspotId, null);
  });
});
