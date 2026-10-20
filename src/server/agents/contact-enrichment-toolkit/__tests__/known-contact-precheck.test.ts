import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAlreadyKnownContact, parseObfuscatedLastName } from '../known-contact-precheck';
import { normalizeApolloPerson, type NormalizedApolloContact } from '../contact-normalizer';
import type { ApolloPerson } from '@/server/integrations/apollo-client';

function fromApollo(over: Partial<ApolloPerson>): NormalizedApolloContact {
  const contact = normalizeApolloPerson({
    id: '5f2a9c1e7b3d4a0012ab34cd',
    first_name: 'Laura',
    last_name: null,
    title: 'Gerente de Gestión Humana',
    email: null,
    linkedin_url: null,
    phone_numbers: [],
    organization: null,
    ...over,
  } as ApolloPerson);
  assert.ok(contact);
  return contact;
}

describe('apellido oculto de Apollo', () => {
  it('lee prefijo y sufijo, con o sin tildes', () => {
    assert.deepEqual(parseObfuscatedLastName('Gó***z'), { prefix: 'go', suffix: 'z' });
    assert.deepEqual(parseObfuscatedLastName('Ro*****'), { prefix: 'ro', suffix: '' });
    assert.equal(parseObfuscatedLastName('Gómez'), null);
    assert.equal(parseObfuscatedLastName('***'), null);
    assert.equal(parseObfuscatedLastName(null), null);
  });

  it('el normalizador conserva el apellido oculto en metadata sólo cuando viene', () => {
    assert.equal(fromApollo({ last_name_obfuscated: 'Go***z' }).enrichmentMetadata.last_name_obfuscated, 'Go***z');
    assert.equal('last_name_obfuscated' in fromApollo({}).enrichmentMetadata, false);
  });
});

describe('¿ya es contacto? — antes de pagar people/match', () => {
  const existing = ['Laura Gómez Pérez', 'Carlos Ruiz', 'María José Díaz'];

  it('mismo nombre de pila y apellido que encaja en el patrón oculto ⇒ ya conocido', () => {
    assert.equal(isAlreadyKnownContact(fromApollo({ last_name_obfuscated: 'Go***z' }), existing), true);
    assert.equal(isAlreadyKnownContact(fromApollo({ first_name: 'maría', last_name_obfuscated: 'Dí*z' }), existing), true);
  });

  it('apellido completo que coincide ⇒ ya conocido', () => {
    assert.equal(isAlreadyKnownContact(fromApollo({ first_name: 'Carlos', last_name: 'Ruiz' }), existing), true);
  });

  it('conservador: sin apellido, con otro apellido o con otro nombre NO se descarta', () => {
    assert.equal(isAlreadyKnownContact(fromApollo({}), existing), false);
    assert.equal(isAlreadyKnownContact(fromApollo({ last_name_obfuscated: 'Ma***n' }), existing), false);
    assert.equal(isAlreadyKnownContact(fromApollo({ first_name: 'Lucía', last_name_obfuscated: 'Go***z' }), existing), false);
    assert.equal(isAlreadyKnownContact(fromApollo({ first_name: 'Carlos', last_name: 'Ruiz Soto' }), existing), false);
  });

  it('el prefijo solo no basta: el apellido tiene que ser más largo que lo visible', () => {
    assert.equal(isAlreadyKnownContact(fromApollo({ last_name_obfuscated: 'Go***' }), ['Laura Go']), false);
  });

  it('sin contactos existentes nunca descarta', () => {
    assert.equal(isAlreadyKnownContact(fromApollo({ last_name_obfuscated: 'Go***z' }), []), false);
  });
});
