/**
 * Tests — Señal gratuita «Apollo tiene teléfono» (Agente 2A · APOLLO-DIRECT-PHONE-HINT-1)
 *
 * People API Search devuelve `has_direct_phone` ("Yes" | "Maybe: please request
 * direct dial via people/bulk_match"). Leerlo NO consume créditos (soporte humano
 * Apollo, 2026-10-21). Es una pista: no revela, no cobra, no garantiza número.
 *
 * Funciones puras. Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseApolloDirectPhoneHint,
  readApolloDirectPhoneHint,
  describeApolloDirectPhoneHint,
  APOLLO_DIRECT_PHONE_HINT_METADATA_KEY,
} from '../apollo-direct-phone-hint';

describe('parseApolloDirectPhoneHint', () => {
  it('"Yes" ⇒ yes (sin importar mayúsculas ni espacios)', () => {
    assert.equal(parseApolloDirectPhoneHint('Yes'), 'yes');
    assert.equal(parseApolloDirectPhoneHint('  yes '), 'yes');
  });

  it('"Maybe: …" ⇒ maybe', () => {
    assert.equal(
      parseApolloDirectPhoneHint('Maybe: please request direct dial via people/bulk_match'),
      'maybe',
    );
  });

  it('booleano true ⇒ yes; false ⇒ null (no se inventa "no tiene")', () => {
    assert.equal(parseApolloDirectPhoneHint(true), 'yes');
    assert.equal(parseApolloDirectPhoneHint(false), null);
  });

  it('ausente, vacío, "No" o valores raros ⇒ null', () => {
    for (const raw of [undefined, null, '', '   ', 'No', 'unknown', 1, {}, []]) {
      assert.equal(parseApolloDirectPhoneHint(raw), null, `raw=${JSON.stringify(raw)}`);
    }
  });
});

describe('readApolloDirectPhoneHint', () => {
  it('lee la clave normalizada de la metadata', () => {
    assert.equal(readApolloDirectPhoneHint({ [APOLLO_DIRECT_PHONE_HINT_METADATA_KEY]: 'yes' }), 'yes');
    assert.equal(readApolloDirectPhoneHint({ [APOLLO_DIRECT_PHONE_HINT_METADATA_KEY]: 'maybe' }), 'maybe');
  });

  it('metadata ausente, legacy o con valor manipulado ⇒ null', () => {
    assert.equal(readApolloDirectPhoneHint(null), null);
    assert.equal(readApolloDirectPhoneHint(undefined), null);
    assert.equal(readApolloDirectPhoneHint({}), null);
    assert.equal(readApolloDirectPhoneHint({ [APOLLO_DIRECT_PHONE_HINT_METADATA_KEY]: 'Yes' }), null);
    assert.equal(readApolloDirectPhoneHint({ [APOLLO_DIRECT_PHONE_HINT_METADATA_KEY]: true }), null);
  });
});

describe('describeApolloDirectPhoneHint', () => {
  it('yes ⇒ etiqueta afirmativa y aclara que revelar cobra', () => {
    const copy = describeApolloDirectPhoneHint('yes');
    assert.ok(copy);
    assert.equal(copy.label, 'Apollo tiene teléfono');
    assert.match(copy.description, /sin costo/i);
    assert.match(copy.description, /revelar/i);
  });

  it('maybe ⇒ etiqueta prudente, nunca afirma que existe', () => {
    const copy = describeApolloDirectPhoneHint('maybe');
    assert.ok(copy);
    assert.equal(copy.label, 'Apollo quizá tiene teléfono');
    assert.doesNotMatch(copy.label, /^Apollo tiene/);
  });

  it('null ⇒ no se muestra nada', () => {
    assert.equal(describeApolloDirectPhoneHint(null), null);
  });
});
