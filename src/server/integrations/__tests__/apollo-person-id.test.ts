/**
 * Agente 2A — Apollo person id validator (APOLLO-PHONE-CACHE-1a)
 *
 * Pruebas offline del validador puro `normalizeApolloPersonId`. Sin red, sin
 * Supabase, sin proveedores. Verifica que SOLO un id Apollo real (24 hex) se
 * acepte y que los ids de otros proveedores (Lusha `v1.*`) se rechacen.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeApolloPersonId,
  isValidApolloPersonId,
} from '../apollo-person-id';

// Apollo person id = MongoDB ObjectId (24 hex). Ejemplos reales usados en fixtures.
const VALID_APOLLO_ID = '6a6826ba804c600014ead739';
const VALID_APOLLO_ID_2 = 'deadbeefdeadbeefdeadbeef';

describe('APOLLO-PHONE-CACHE-1a — normalizeApolloPersonId acepta ids Apollo válidos', () => {
  it('acepta un ObjectId de 24 hex y lo devuelve trim', () => {
    assert.equal(normalizeApolloPersonId(VALID_APOLLO_ID), VALID_APOLLO_ID);
    assert.equal(normalizeApolloPersonId(VALID_APOLLO_ID_2), VALID_APOLLO_ID_2);
    assert.equal(normalizeApolloPersonId(`  ${VALID_APOLLO_ID}  `), VALID_APOLLO_ID);
    assert.equal(isValidApolloPersonId(VALID_APOLLO_ID), true);
  });

  it('acepta hex en mayúsculas (case-insensitive), preservando el valor', () => {
    const upper = VALID_APOLLO_ID.toUpperCase();
    assert.equal(normalizeApolloPersonId(upper), upper);
    assert.equal(isValidApolloPersonId(upper), true);
  });
});

describe('APOLLO-PHONE-CACHE-1a — rechaza ids Lusha `v1.*` y no-Apollo', () => {
  it('rechaza explícitamente ids Lusha tipo v1.<token>', () => {
    assert.equal(normalizeApolloPersonId('v1.some-lusha-token'), null);
    assert.equal(normalizeApolloPersonId('V1.MIXED-Case-Token'), null);
    assert.equal(isValidApolloPersonId('v1.abc'), false);
  });

  it('rechaza cualquier cosa que no tenga forma de ObjectId Apollo', () => {
    assert.equal(normalizeApolloPersonId('p-1'), null);
    assert.equal(normalizeApolloPersonId('not-an-id'), null);
    // 23 hex (corto) / 25 hex (largo) / con no-hex → inválidos.
    assert.equal(normalizeApolloPersonId('6a6826ba804c600014ead73'), null);
    assert.equal(normalizeApolloPersonId('6a6826ba804c600014ead7390'), null);
    assert.equal(normalizeApolloPersonId('6a6826ba804c600014ead73z'), null);
  });

  it('rechaza null / undefined / vacío / solo espacios', () => {
    assert.equal(normalizeApolloPersonId(null), null);
    assert.equal(normalizeApolloPersonId(undefined), null);
    assert.equal(normalizeApolloPersonId(''), null);
    assert.equal(normalizeApolloPersonId('   '), null);
    assert.equal(isValidApolloPersonId(null), false);
  });
});
