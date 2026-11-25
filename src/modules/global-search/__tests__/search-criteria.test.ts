/**
 * Buscador general por todos los criterios (dueña 25-11): qué se lee de lo escrito y cómo
 * se compara en SellUp (empresas y contactos).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { digitsInOrderPattern, parseSearchCriteria, phoneSuffix } from '../search-criteria';
import {
  accountMatchRank,
  accountOrFilter,
  contactMatchRank,
  contactOrFilter,
  otherOwnerNote,
  rankMatches,
  type DirectoryAccountRow,
  type DirectoryContactRow,
} from '../directory-search-core';

const account = (over: Partial<DirectoryAccountRow> = {}): DirectoryAccountRow => ({
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Sportium Colombia',
  legal_name: 'Sportium Colombia S.A.S.',
  domain: 'sportium.co',
  website: 'https://www.sportium.co',
  industry: 'Deportes',
  country: 'Colombia',
  tax_identifier: '900123456-7',
  hubspot_company_id: '10325097785',
  owner_id: 'u1',
  created_by: 'u1',
  archived_at: null,
  ...over,
});

const contact = (over: Partial<DirectoryContactRow> = {}): DirectoryContactRow => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  full_name: 'Ana María Pérez',
  email: 'ana_perez@sportium.co',
  phone: '+57 300 123 4567',
  mobile_phone: null,
  job_title: 'Gerente de Talento',
  hubspot_contact_id: '987654321',
  account: { id: 'acc', name: 'Sportium', owner_id: 'u1', created_by: 'u1', archived_at: null },
  ...over,
});

describe('parseSearchCriteria', () => {
  it('un número puede ser ID de HubSpot, NIT y teléfono a la vez', () => {
    const c = parseSearchCriteria('9001234567');
    assert.equal(c.hubspotId, '9001234567');
    assert.equal(c.taxDigits, '9001234567');
    assert.equal(c.phoneDigits, '9001234567');
    assert.equal(c.email, null);
  });

  it('NIT con puntos y dígito de verificación, y RUT con K', () => {
    assert.equal(parseSearchCriteria('900.123.456-7').taxDigits, '9001234567');
    assert.equal(parseSearchCriteria('76.123.456-K').taxDigits, '76123456');
    assert.equal(parseSearchCriteria('900.123.456-7').hubspotId, null);
  });

  it('RFC de México', () => {
    assert.equal(parseSearchCriteria('abc010203xy9').taxText, 'ABC010203XY9');
  });

  it('teléfono con indicativo y separadores', () => {
    const c = parseSearchCriteria('+57 (300) 123-4567');
    assert.equal(c.phoneDigits, '573001234567');
    assert.equal(phoneSuffix(c.phoneDigits!), '01234567');
    assert.equal(parseSearchCriteria('2024').phoneDigits, null);
  });

  it('correo (con «_») y su dominio; web y su dominio limpio', () => {
    const c = parseSearchCriteria('Ana_Perez@Sportium.co');
    assert.equal(c.email, 'ana_perez@sportium.co');
    assert.equal(c.domain, 'sportium.co');
    assert.equal(parseSearchCriteria('https://www.sportium.co/es').domain, 'sportium.co');
    assert.equal(parseSearchCriteria('sportium').domain, null);
  });

  it('id de SellUp', () => {
    assert.equal(parseSearchCriteria('11111111-2222-3333-4444-555555555555').sellupId, '11111111-2222-3333-4444-555555555555');
  });

  it('patrón de dígitos en orden: sólo dígitos y %', () => {
    assert.equal(digitsInOrderPattern('30-1'), '%3%0%1%');
    assert.equal(digitsInOrderPattern('abc'), '');
  });
});

describe('empresas de SellUp por criterio', () => {
  it('por ID de SellUp y de HubSpot (lo más seguro)', () => {
    assert.equal(accountMatchRank(account(), parseSearchCriteria('11111111-2222-3333-4444-555555555555')), 0);
    assert.equal(accountMatchRank(account(), parseSearchCriteria('10325097785')), 0);
  });

  it('por NIT con o sin dígito de verificación', () => {
    assert.equal(accountMatchRank(account(), parseSearchCriteria('900123456')), 1);
    assert.equal(accountMatchRank(account(), parseSearchCriteria('900.123.456-7')), 1);
    assert.equal(accountMatchRank(account({ tax_identifier: '900123456' }), parseSearchCriteria('9001234567')), 1);
    assert.equal(accountMatchRank(account(), parseSearchCriteria('800999111')), null);
  });

  it('por dominio o web, y por nombre sin tildes', () => {
    assert.equal(accountMatchRank(account(), parseSearchCriteria('www.sportium.co')), 2);
    assert.equal(accountMatchRank(account({ name: 'Logística Andina' }), parseSearchCriteria('logistica andina')), 3);
  });

  it('el filtro de la base no lleva comas ni paréntesis de lo escrito', () => {
    const filter = accountOrFilter(parseSearchCriteria('900.123.456-7'), '900.123.456-7');
    assert.match(filter, /tax_identifier\.ilike\.%9%0%0%1%2%3%4%5%6%/);
    assert.doesNotMatch(filter, /[()]/);
  });
});

describe('contactos de SellUp por criterio', () => {
  it('por teléfono, con o sin indicativo', () => {
    assert.equal(contactMatchRank(contact(), parseSearchCriteria('300 123 4567')), 1);
    assert.equal(contactMatchRank(contact(), parseSearchCriteria('+573001234567')), 1);
    // Mismos dígitos sueltos no bastan: tienen que ir seguidos.
    assert.equal(contactMatchRank(contact({ phone: '+57 3001 2 9 3 4567' }), parseSearchCriteria('3001234567')), null);
  });

  it('por celular', () => {
    assert.equal(contactMatchRank(contact({ phone: null, mobile_phone: '3001234567' }), parseSearchCriteria('300-123-4567')), 1);
  });

  it('por correo exacto, por dominio del correo y por nombre', () => {
    assert.equal(contactMatchRank(contact(), parseSearchCriteria('ANA_PEREZ@sportium.co')), 1);
    assert.equal(contactMatchRank(contact(), parseSearchCriteria('sportium.co')), 2);
    assert.equal(contactMatchRank(contact(), parseSearchCriteria('ana perez')), 3);
  });

  it('por ID de HubSpot del contacto', () => {
    assert.equal(contactMatchRank(contact(), parseSearchCriteria('987654321')), 0);
  });

  it('el filtro de la base busca teléfono y celular por sus últimos dígitos', () => {
    const filter = contactOrFilter(parseSearchCriteria('+57 300 123 4567'), '+57 300 123 4567');
    assert.match(filter, /phone\.ilike\.%0%1%2%3%4%5%6%7%/);
    assert.match(filter, /mobile_phone\.ilike\./);
  });
});

describe('orden y aviso', () => {
  it('lo más seguro primero y tope', () => {
    const ranked = rankMatches(['nombre', 'id', 'nada', 'nit'], (r) => ({ id: 0, nit: 1, nombre: 3 } as Record<string, 0 | 1 | 3>)[r] ?? null, 2);
    assert.deepEqual(ranked, ['id', 'nit']);
  });

  it('lo que lleva otra persona dice quién', () => {
    assert.equal(otherOwnerNote('Carla Pía'), 'En SellUp la lleva Carla Pía');
    assert.equal(otherOwnerNote(null), 'En SellUp la lleva otra persona');
  });
});
