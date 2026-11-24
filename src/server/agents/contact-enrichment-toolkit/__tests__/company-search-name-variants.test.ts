/**
 * Tests — variantes de nombre para buscar la empresa en Apollo/Lusha cuando no hay dominio.
 * Caso real (24-11): «Merck Sharp  Dohme Colombia SAS» (sin dominio, el «&» perdido) daba 0
 * contactos porque se buscaba el texto crudo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompanySearchNameVariants,
  cleanCompanySearchName,
} from '../company-search-name-variants';

describe('buildCompanySearchNameVariants', () => {
  it('caso Merck: colapsa espacios, quita «SAS» y luego el país', () => {
    assert.deepEqual(buildCompanySearchNameVariants('Merck Sharp  Dohme Colombia SAS'), [
      'Merck Sharp Dohme Colombia SAS',
      'Merck Sharp Dohme Colombia',
      'Merck Sharp Dohme',
    ]);
  });

  it('quita formas legales con puntos y variantes comunes', () => {
    assert.deepEqual(buildCompanySearchNameVariants('Alpina Productos Alimenticios S.A.S.'), [
      'Alpina Productos Alimenticios S.A.S.',
      'Alpina Productos Alimenticios',
    ]);
    assert.deepEqual(buildCompanySearchNameVariants('Grupo Bimbo, S.A.B. de C.V.'), [
      'Grupo Bimbo, S.A.B. de C.V.',
      'Grupo Bimbo',
    ]);
    assert.deepEqual(buildCompanySearchNameVariants('Siesa Ltda.'), ['Siesa Ltda.', 'Siesa']);
    assert.deepEqual(buildCompanySearchNameVariants('Acme Inc'), ['Acme Inc', 'Acme']);
  });

  it('sin forma legal ni país → una sola variante', () => {
    assert.deepEqual(buildCompanySearchNameVariants('Bancolombia'), ['Bancolombia']);
  });

  it('nunca deja el nombre vacío ni sólo el país', () => {
    assert.deepEqual(buildCompanySearchNameVariants('Colombia SAS'), ['Colombia SAS', 'Colombia']);
    assert.deepEqual(buildCompanySearchNameVariants('SAS'), ['SAS']);
    assert.deepEqual(buildCompanySearchNameVariants('   '), []);
  });

  it('no quita letras sueltas dentro del nombre (sólo al final)', () => {
    assert.deepEqual(buildCompanySearchNameVariants('SA Ingeniería'), ['SA Ingeniería']);
  });

  it('quita el país con tilde o «de»: «México», «de Colombia»', () => {
    assert.deepEqual(buildCompanySearchNameVariants('Nestlé de Colombia S.A.'), [
      'Nestlé de Colombia S.A.',
      'Nestlé de Colombia',
      'Nestlé',
    ]);
    assert.deepEqual(buildCompanySearchNameVariants('Bayer México'), ['Bayer México', 'Bayer']);
  });
});

describe('cleanCompanySearchName', () => {
  it('devuelve el nombre sin forma legal ni espacios dobles (país se conserva)', () => {
    assert.equal(cleanCompanySearchName('Merck Sharp  Dohme Colombia SAS'), 'Merck Sharp Dohme Colombia');
    assert.equal(cleanCompanySearchName('Bancolombia'), 'Bancolombia');
    assert.equal(cleanCompanySearchName(''), '');
  });
});
